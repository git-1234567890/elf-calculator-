import { Difficulty, Puzzle, TOTAL_PUZZLES, getPuzzleRange, hydratePuzzleCache } from "./puzzles";

const DB_NAME = "elf_calculator_puzzles_v1";
const DB_VERSION = 1;
const STORE_PUZZLES = "puzzles";
const STORE_META = "meta";
const MANIFEST_KEY = "directory_manifest";

interface SerializedPuzzleRecord {
  id: number;
  title: string;
  station: string;
  stationId: number;
  difficulty: Difficulty;
  seeds: Record<string, string>;
  targets: string[];
  parSteps: number;
  referenceProgram: string;
  hint: string;
}

interface CacheManifestRecord {
  key: string;
  version: number;
  totalCount: number;
  cachedAt: string;
}

export interface PuzzleCacheSnapshot {
  puzzles: Puzzle[];
  cachedAt: string | null;
  fromIndexedDb: boolean;
}

function isIndexedDbAvailable(): boolean {
  return typeof window !== "undefined" && "indexedDB" in window;
}

function openPuzzleDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!isIndexedDbAvailable()) {
      reject(new Error("IndexedDB is not supported in this browser."));
      return;
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_PUZZLES)) {
        db.createObjectStore(STORE_PUZZLES, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: "key" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Failed to open IndexedDB puzzle cache."));
  });
}

function serializePuzzle(puzzle: Puzzle): SerializedPuzzleRecord {
  const seeds: Record<string, string> = {};
  for (const [slot, val] of Object.entries(puzzle.seeds)) {
    seeds[String(slot)] = val.toString();
  }
  return {
    id: puzzle.id,
    title: puzzle.title,
    station: puzzle.station,
    stationId: puzzle.stationId,
    difficulty: puzzle.difficulty,
    seeds,
    targets: puzzle.targets.map((t) => t.toString()),
    parSteps: puzzle.parSteps,
    referenceProgram: puzzle.referenceProgram,
    hint: puzzle.hint,
  };
}

function deserializePuzzle(raw: SerializedPuzzleRecord): Puzzle {
  const seeds: Record<number, bigint> = {};
  for (const [slot, val] of Object.entries(raw.seeds || {})) {
    seeds[Number(slot)] = BigInt(val);
  }
  return {
    id: raw.id,
    title: raw.title,
    station: raw.station,
    stationId: raw.stationId,
    difficulty: raw.difficulty,
    seeds,
    targets: (raw.targets || []).map((t) => BigInt(t)),
    parSteps: raw.parSteps,
    referenceProgram: raw.referenceProgram,
    hint: raw.hint,
  };
}

export async function getCachedPuzzlesFromIndexedDb(): Promise<{
  puzzles: Puzzle[];
  cachedAt: string | null;
}> {
  const db = await openPuzzleDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_PUZZLES, STORE_META], "readonly");
      const puzzleStore = tx.objectStore(STORE_PUZZLES);
      const metaStore = tx.objectStore(STORE_META);

      const puzzlesReq = puzzleStore.getAll();
      const metaReq = metaStore.get(MANIFEST_KEY);

      tx.oncomplete = () => {
        const rawList = (puzzlesReq.result ?? []) as SerializedPuzzleRecord[];
        const manifest = metaReq.result as CacheManifestRecord | undefined;
        const puzzles = rawList
          .map(deserializePuzzle)
          .sort((a, b) => a.id - b.id);
        resolve({
          puzzles,
          cachedAt: manifest?.cachedAt ?? null,
        });
      };

      tx.onerror = () =>
        reject(tx.error ?? new Error("Failed to read puzzles from IndexedDB."));
    });
  } finally {
    db.close();
  }
}

export async function cacheAllPuzzlesToIndexedDb(
  puzzles: Puzzle[]
): Promise<string> {
  const db = await openPuzzleDb();
  const cachedAt = new Date().toISOString();

  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE_PUZZLES, STORE_META], "readwrite");
      const puzzleStore = tx.objectStore(STORE_PUZZLES);
      const metaStore = tx.objectStore(STORE_META);

      for (const puzzle of puzzles) {
        puzzleStore.put(serializePuzzle(puzzle));
      }

      const manifest: CacheManifestRecord = {
        key: MANIFEST_KEY,
        version: DB_VERSION,
        totalCount: puzzles.length,
        cachedAt,
      };
      metaStore.put(manifest);

      tx.oncomplete = () => resolve();
      tx.onerror = () =>
        reject(tx.error ?? new Error("Failed to save puzzles to IndexedDB."));
    });
    return cachedAt;
  } finally {
    db.close();
  }
}

export async function loadOrCacheAllPuzzles(
  forceRebuild = false
): Promise<PuzzleCacheSnapshot> {
  if (!isIndexedDbAvailable()) {
    const generated = getPuzzleRange(1, TOTAL_PUZZLES);
    return {
      puzzles: generated,
      cachedAt: null,
      fromIndexedDb: false,
    };
  }

  if (!forceRebuild) {
    try {
      const existing = await getCachedPuzzlesFromIndexedDb();
      if (existing.puzzles.length === TOTAL_PUZZLES) {
        hydratePuzzleCache(existing.puzzles);
        return {
          puzzles: existing.puzzles,
          cachedAt: existing.cachedAt,
          fromIndexedDb: true,
        };
      }
    } catch {
      // Fall through to regenerate and persist
    }
  }

  const generated = getPuzzleRange(1, TOTAL_PUZZLES);
  try {
    const cachedAt = await cacheAllPuzzlesToIndexedDb(generated);
    return {
      puzzles: generated,
      cachedAt,
      fromIndexedDb: true,
    };
  } catch {
    return {
      puzzles: generated,
      cachedAt: null,
      fromIndexedDb: false,
    };
  }
}
