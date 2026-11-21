import {
  SLOT_COUNT,
  Op,
  createInitialSlots,
  executeProgram,
  parseProgram,
} from "./elfVm";

export type Difficulty =
  | "Apprentice"
  | "Journeyman"
  | "Master"
  | "Grandmaster";

export interface StationMeta {
  id: number;
  name: string;
  rangeStart: number;
  rangeEnd: number;
  focus: string;
}

export const STATIONS: StationMeta[] = [
  {
    id: 1,
    name: "Ribbon & Wrapping Bench",
    rangeStart: 1,
    rangeEnd: 200,
    focus: "Addition chains, doubling, and starter integers",
  },
  {
    id: 2,
    name: "Clockwork Gear Lathe",
    rangeStart: 201,
    rangeEnd: 400,
    focus: "Prime products, powers, and coupled gear ratios",
  },
  {
    id: 3,
    name: "Candy Cane Batching",
    rangeStart: 401,
    rangeEnd: 600,
    focus: "Subtraction and exact integer division",
  },
  {
    id: 4,
    name: "Sleigh Navigation Deck",
    rangeStart: 601,
    rangeEnd: 800,
    focus: "Recurrences, squares, and polynomial sequences",
  },
  {
    id: 5,
    name: "Master Toymaker Vault",
    rangeStart: 801,
    rangeEnd: 1000,
    focus: "Dense multi-target packing within 48 slots",
  },
];

export interface Puzzle {
  id: number;
  title: string;
  station: string;
  stationId: number;
  difficulty: Difficulty;
  seeds: Record<number, bigint>;
  targets: bigint[];
  parSteps: number;
  referenceProgram: string;
  hint: string;
}

export const TOTAL_PUZZLES = 1000;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface DagNode {
  value: bigint;
  op: Op | "seed";
  left: number;
  right: number;
  seedSlot?: number;
}

function buildDependencySlicedProgram(
  seeds: Record<number, bigint>,
  nodes: DagNode[],
  targetNodeIndices: number[]
): string[] {
  // Mark reachable DAG nodes from targetNodeIndices
  const needed = new Set<number>();
  const stack = [...targetNodeIndices];
  while (stack.length > 0) {
    const idx = stack.pop()!;
    if (needed.has(idx)) continue;
    needed.add(idx);
    const node = nodes[idx];
    if (node.op !== "seed") {
      stack.push(node.left, node.right);
    }
  }

  // Topological order of non-seed needed nodes (indices are already topological)
  const ordered = Array.from(needed)
    .filter((idx) => nodes[idx].op !== "seed")
    .sort((a, b) => a - b);

  // Map DAG node index -> slot index in 0..47
  const nodeToSlot = new Map<number, number>();
  let nextFreeSlot = 0;
  for (const key of Object.keys(seeds)) {
    const s = Number(key);
    if (s >= nextFreeSlot) nextFreeSlot = s + 1;
  }

  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].op === "seed" && nodes[i].seedSlot !== undefined) {
      nodeToSlot.set(i, nodes[i].seedSlot!);
    }
  }

  const lines: string[] = [];
  for (const idx of ordered) {
    const node = nodes[idx];
    const slotA = nodeToSlot.get(node.left)!;
    const slotB = nodeToSlot.get(node.right)!;
    // Reuse a non-seed slot if free slots run low, though DAG steps <= 24 < 48
    const dst =
      nextFreeSlot < SLOT_COUNT
        ? nextFreeSlot++
        : Math.min(SLOT_COUNT - 1, Math.max(slotA, slotB) + 1);
    nodeToSlot.set(idx, dst);
    lines.push(`R${dst} = R${slotA} ${node.op} R${slotB}`);
  }

  return lines;
}

function getStationForId(id: number): StationMeta {
  return (
    STATIONS.find((s) => id >= s.rangeStart && id <= s.rangeEnd) ?? STATIONS[0]
  );
}

const STATION_NOUNS = [
  "Spool",
  "Pinion",
  "Ratchet",
  "Baton",
  "Compass",
  "Sextant",
  "Pendulum",
  "Bobbin",
  "Sprocket",
  "Tinsel",
  "Bell",
  "Lantern",
  "Nutcracker",
  "Whistle",
  "Top",
  "Sleigh",
  "Gyro",
  "Chronometer",
  "Prism",
  "Abacus",
];

const puzzleCache = new Map<number, Puzzle>();

export function getPuzzle(id: number): Puzzle {
  const clamped = Math.max(1, Math.min(TOTAL_PUZZLES, Math.floor(id)));
  const cached = puzzleCache.get(clamped);
  if (cached) return cached;

  const station = getStationForId(clamped);
  const rng = mulberry32(clamped * 7919 + 104729);
  const randInt = (min: number, max: number) =>
    Math.floor(rng() * (max - min + 1)) + min;

  let difficulty: Difficulty = "Apprentice";
  if (clamped > 750) difficulty = "Grandmaster";
  else if (clamped > 450) difficulty = "Master";
  else if (clamped > 150) difficulty = "Journeyman";

  const seeds: Record<number, bigint> = {};
  const nodes: DagNode[] = [];
  const seenValues = new Set<bigint>();

  const addSeed = (slot: number, value: bigint) => {
    seeds[slot] = value;
    nodes.push({ value, op: "seed", left: -1, right: -1, seedSlot: slot });
    seenValues.add(value);
  };

  const tryAddOp = (op: Op, aIdx: number, bIdx: number): number | null => {
    const a = nodes[aIdx].value;
    const b = nodes[bIdx].value;
    let res: bigint;
    if (op === "+") res = a + b;
    else if (op === "-") res = a - b;
    else if (op === "*") res = a * b;
    else {
      if (b === 0n || a % b !== 0n) return null;
      res = a / b;
    }

    // Keep numbers exact, positive/moderate so puzzles are pleasant to solve
    if (res <= 0n || res > 99_999_999n || seenValues.has(res)) {
      return null;
    }
    seenValues.add(res);
    nodes.push({ value: res, op, left: aIdx, right: bIdx });
    return nodes.length - 1;
  };

  let targetCount = 1;
  let desiredDepth = 4;
  let hint = "";

  if (station.id === 1) {
    // Ribbon & Wrapping Bench: addition chains & doubling
    addSeed(0, 1n);
    if (clamped > 80 && rng() > 0.45) {
      addSeed(1, BigInt(randInt(2, 5)));
    }
    targetCount = clamped <= 40 ? 1 : clamped <= 130 ? 2 : 3;
    desiredDepth = clamped <= 20 ? randInt(2, 4) : randInt(4, 7);
    hint =
      "Use doubling (R1 = R0 + R0) and reuse intermediate sums instead of adding 1 repeatedly.";
  } else if (station.id === 2) {
    // Clockwork Gear Lathe: products & powers
    const p1 = BigInt([2, 3, 5, 7][randInt(0, 3)]);
    const p2 = BigInt([3, 5, 7, 11][randInt(0, 3)]);
    addSeed(0, p1);
    addSeed(1, p1 === p2 ? p2 + 2n : p2);
    if (rng() > 0.6) addSeed(2, 1n);
    targetCount = randInt(2, 4);
    desiredDepth = randInt(5, 9);
    hint =
      "Square intermediate gear values (Rx * Rx) to reach high powers in logarithmic steps.";
  } else if (station.id === 3) {
    // Candy Cane Batching: subtraction & exact division
    const divisorA = BigInt(randInt(2, 7));
    const divisorB = BigInt(randInt(3, 9));
    const factor = BigInt(randInt(4, 15));
    addSeed(0, divisorA * divisorB * factor);
    addSeed(1, divisorA);
    addSeed(2, divisorB);
    targetCount = randInt(2, 4);
    desiredDepth = randInt(5, 9);
    hint =
      "Factor out large batches with exact division (/) before scaling or subtracting remainders.";
  } else if (station.id === 4) {
    // Sleigh Navigation Deck: recurrences & polynomials
    addSeed(0, 1n);
    addSeed(1, BigInt(randInt(2, 6)));
    if (rng() > 0.5) addSeed(2, BigInt(randInt(3, 8)));
    targetCount = randInt(3, 5);
    desiredDepth = randInt(6, 11);
    hint =
      "Chain previous slots forward like a recurrence, keeping key intermediate terms in dedicated slots.";
  } else {
    // Master Toymaker Vault: dense multi-target packing
    addSeed(0, BigInt(randInt(1, 3)));
    addSeed(1, BigInt(randInt(4, 9)));
    addSeed(2, BigInt(randInt(5, 12)));
    targetCount = randInt(4, 6);
    desiredDepth = randInt(8, 14);
    hint =
      "Plan register reuse carefully and look for shared sub-expressions across your target numbers.";
  }

  // Synthesize constructive DAG operations
  const opsPool: Op[] =
    station.id === 1
      ? ["+", "+", "*", "-"]
      : station.id === 2
        ? ["*", "*", "+", "-"]
        : station.id === 3
          ? ["/", "-", "*", "+"]
          : station.id === 4
            ? ["+", "*", "-", "/"]
            : ["*", "+", "-", "/"];

  let guard = 0;
  while (nodes.length < Object.keys(seeds).length + desiredDepth && guard < 180) {
    guard++;
    // Bias toward using newer nodes so chains actually build deeper values
    const aIdx =
      rng() > 0.35
        ? randInt(Math.max(0, nodes.length - 4), nodes.length - 1)
        : randInt(0, nodes.length - 1);
    const bIdx = randInt(0, nodes.length - 1);
    const op = opsPool[randInt(0, opsPool.length - 1)];

    // Guarantee at least one exact division in Station 3
    if (
      station.id === 3 &&
      guard === 1 &&
      nodes.length >= 3 &&
      nodes[0].value % nodes[1].value === 0n
    ) {
      tryAddOp("/", 0, 1);
      continue;
    }

    tryAddOp(op, aIdx, bIdx);
  }

  // Pick target node indices from generated non-seed nodes (falling back if needed)
  const nonSeedIndices: number[] = [];
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].op !== "seed") nonSeedIndices.push(i);
  }

  if (nonSeedIndices.length === 0) {
    // Safety fallback: double R0
    const idx = tryAddOp("+", 0, 0);
    if (idx !== null) nonSeedIndices.push(idx);
  }

  // Select diverse targets biased toward deeper nodes
  const chosenNodeIndices: number[] = [];
  const reversed = [...nonSeedIndices].reverse();
  for (const idx of reversed) {
    if (chosenNodeIndices.length >= targetCount) break;
    if (
      chosenNodeIndices.length === 0 ||
      rng() > 0.25 ||
      reversed.length - chosenNodeIndices.length <= targetCount
    ) {
      chosenNodeIndices.push(idx);
    }
  }
  while (
    chosenNodeIndices.length < Math.min(targetCount, nonSeedIndices.length)
  ) {
    const candidate = nonSeedIndices[randInt(0, nonSeedIndices.length - 1)];
    if (!chosenNodeIndices.includes(candidate)) {
      chosenNodeIndices.push(candidate);
    }
  }

  const targets = chosenNodeIndices
    .map((idx) => nodes[idx].value)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  const programLines = buildDependencySlicedProgram(
    seeds,
    nodes,
    chosenNodeIndices
  );
  const referenceProgram = programLines.join("\n");

  // Verify deterministically with VM
  const parsed = parseProgram(referenceProgram);
  const initial = createInitialSlots(seeds);
  const exec = executeProgram(initial, parsed.instructions, targets);

  const noun = STATION_NOUNS[clamped % STATION_NOUNS.length];
  const puzzle: Puzzle = {
    id: clamped,
    title: `${noun} Calibration #${String(clamped).padStart(4, "0")}`,
    station: station.name,
    stationId: station.id,
    difficulty,
    seeds,
    targets,
    parSteps: Math.max(1, exec.isSolved ? parsed.instructions.length : programLines.length),
    referenceProgram,
    hint,
  };

  puzzleCache.set(clamped, puzzle);
  return puzzle;
}

export function hydratePuzzleCache(puzzles: Puzzle[]): void {
  for (const puzzle of puzzles) {
    puzzleCache.set(puzzle.id, puzzle);
  }
}

export function getPuzzleRange(startId: number, endId: number): Puzzle[] {
  const result: Puzzle[] = [];
  for (let id = startId; id <= endId; id++) {
    result.push(getPuzzle(id));
  }
  return result;
}

export function getLocalDateKey(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getDailyChallengeId(date: Date = new Date()): number {
  const key = getLocalDateKey(date);
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const rng = mulberry32(hash >>> 0);
  // Warm up PRNG slightly for uniform spread across 1..1000
  rng();
  return Math.floor(rng() * TOTAL_PUZZLES) + 1;
}

