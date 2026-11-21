import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Search,
  CheckCircle2,
  Circle,
  ArrowRight,
  Calendar,
  TrendingDown,
  TrendingUp,
  Minus,
  Database,
  RefreshCw,
  WifiOff,
  Tag,
  Gauge,
} from "lucide-react";
import { formatBigIntCompact } from "../lib/elfVm";
import {
  Difficulty,
  Puzzle,
  STATIONS,
  TOTAL_PUZZLES,
  getDailyChallengeId,
  getLocalDateKey,
} from "../lib/puzzles";
import { loadOrCacheAllPuzzles } from "../lib/puzzleCacheDb";
import {
  ALL_PUZZLE_TAGS,
  PuzzleComplexity,
  calculatePuzzleComplexity,
  getDefaultTagsForPuzzle,
} from "../lib/puzzleMetrics";
import { PuzzleTag, SolvedRecord } from "../types/app";

interface PuzzleDirectoryViewProps {
  activePuzzleId: number;
  solvedMap: Record<number, SolvedRecord>;
  dailyCompletions: string[];
  onSelectPuzzle: (id: number) => void;
}

type StatusFilter = "all" | "solved" | "unsolved" | "par_beaten";
type DifficultyFilter = "all" | Difficulty;
type TagFilter = "all" | PuzzleTag;
type SortOption =
  | "id_asc"
  | "difficulty_asc"
  | "difficulty_desc"
  | "complexity_asc"
  | "complexity_desc"
  | "solved_first"
  | "unsolved_first";

const DIFFICULTY_RANK: Record<Difficulty, number> = {
  Apprentice: 1,
  Journeyman: 2,
  Master: 3,
  Grandmaster: 4,
};

const STORAGE_PUZZLE_TAGS_KEY = "elf_calc_puzzle_tags_v1";
const PAGE_SIZE = 50;

function loadSavedTagOverrides(): Record<number, PuzzleTag[]> {
  try {
    const raw = localStorage.getItem(STORAGE_PUZZLE_TAGS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, PuzzleTag[]>;
    const normalized: Record<number, PuzzleTag[]> = {};
    for (const [k, tags] of Object.entries(parsed)) {
      const id = Number(k);
      if (Number.isInteger(id) && Array.isArray(tags)) {
        normalized[id] = tags.filter((t): t is PuzzleTag =>
          ALL_PUZZLE_TAGS.includes(t)
        );
      }
    }
    return normalized;
  } catch {
    return {};
  }
}

function computeDailyStreak(completedDates: string[]): number {
  if (completedDates.length === 0) return 0;
  const set = new Set(completedDates);
  const cursor = new Date();
  const todayKey = getLocalDateKey(cursor);
  if (!set.has(todayKey)) {
    cursor.setDate(cursor.getDate() - 1);
    if (!set.has(getLocalDateKey(cursor))) {
      return 0;
    }
  }
  let streak = 0;
  while (set.has(getLocalDateKey(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export const PuzzleDirectoryView: React.FC<PuzzleDirectoryViewProps> = ({
  activePuzzleId,
  solvedMap,
  dailyCompletions,
  onSelectPuzzle,
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [stationFilter, setStationFilter] = useState<number>(0); // 0 = All
  const [difficultyFilter, setDifficultyFilter] =
    useState<DifficultyFilter>("all");
  const [tagFilter, setTagFilter] = useState<TagFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortBy, setSortBy] = useState<SortOption>("id_asc");
  const [page, setPage] = useState<number>(1);
  const [jumpInput, setJumpInput] = useState<string>("");
  const [allPuzzles, setAllPuzzles] = useState<Puzzle[]>([]);
  const [tagOverrides, setTagOverrides] = useState<Record<number, PuzzleTag[]>>(
    loadSavedTagOverrides
  );
  const [editingTagsPuzzleId, setEditingTagsPuzzleId] = useState<number | null>(
    null
  );
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== "undefined" ? navigator.onLine : true
  );
  const [cacheState, setCacheState] = useState<
    "checking" | "cached" | "rebuilding" | "unavailable"
  >("checking");
  const [cachedAt, setCachedAt] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_PUZZLE_TAGS_KEY,
        JSON.stringify(tagOverrides)
      );
    } catch {
      // Ignore storage quota errors
    }
  }, [tagOverrides]);

  const complexityMap = useMemo(() => {
    const map = new Map<number, PuzzleComplexity>();
    for (const p of allPuzzles) {
      map.set(p.id, calculatePuzzleComplexity(p));
    }
    return map;
  }, [allPuzzles]);

  const defaultTagsMap = useMemo(() => {
    const map = new Map<number, PuzzleTag[]>();
    for (const p of allPuzzles) {
      map.set(p.id, getDefaultTagsForPuzzle(p));
    }
    return map;
  }, [allPuzzles]);

  const getTagsForPuzzle = useCallback(
    (id: number): PuzzleTag[] => {
      return tagOverrides[id] ?? defaultTagsMap.get(id) ?? [];
    },
    [tagOverrides, defaultTagsMap]
  );

  const handleTogglePuzzleTag = (puzzleId: number, tag: PuzzleTag) => {
    setTagOverrides((prev) => {
      const current = prev[puzzleId] ?? defaultTagsMap.get(puzzleId) ?? [];
      const exists = current.includes(tag);
      const next = exists
        ? current.filter((t) => t !== tag)
        : [...current, tag];
      return {
        ...prev,
        [puzzleId]: next,
      };
    });
  };

  const syncOfflineCache = useCallback(async (forceRebuild: boolean) => {
    setCacheState((prev) => (forceRebuild ? "rebuilding" : prev));
    try {
      const snap = await loadOrCacheAllPuzzles(forceRebuild);
      if (snap.puzzles.length === TOTAL_PUZZLES) {
        setAllPuzzles(snap.puzzles);
      }
      if (snap.fromIndexedDb) {
        setCacheState("cached");
        setCachedAt(snap.cachedAt);
      } else {
        setCacheState("unavailable");
      }
    } catch {
      setCacheState("unavailable");
    }
  }, []);

  useEffect(() => {
    syncOfflineCache(false);
  }, [syncOfflineCache]);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const todayDateLabel = useMemo(
    () =>
      new Date().toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
    []
  );
  const todayKey = useMemo(() => getLocalDateKey(), []);
  const dailyPuzzleId = useMemo(() => getDailyChallengeId(), []);
  const dailyPuzzle = allPuzzles[dailyPuzzleId - 1];
  const dailySolvedRecord = solvedMap[dailyPuzzleId];
  const isDailyCompletedToday =
    dailyCompletions.includes(todayKey) || Boolean(dailySolvedRecord);
  const dailyStreak = useMemo(
    () =>
      computeDailyStreak(
        isDailyCompletedToday && !dailyCompletions.includes(todayKey)
          ? [...dailyCompletions, todayKey]
          : dailyCompletions
      ),
    [dailyCompletions, isDailyCompletedToday, todayKey]
  );

  const stats = useMemo(() => {
    const records = Object.values(solvedMap);
    const solvedCount = records.length;
    let totalInstructions = 0;
    let parBeatenCount = 0;
    for (const rec of records) {
      totalInstructions += rec.bestSteps;
      const puz = allPuzzles[rec.puzzleId - 1];
      if (puz && rec.bestSteps <= puz.parSteps) {
        parBeatenCount++;
      }
    }
    const historicalAverageSteps =
      solvedCount > 0 ? totalInstructions / solvedCount : null;
    return {
      solvedCount,
      parBeatenCount,
      totalInstructions,
      historicalAverageSteps,
      completionPct: ((solvedCount / TOTAL_PUZZLES) * 100).toFixed(1),
    };
  }, [solvedMap, allPuzzles]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = allPuzzles.filter((p) => {
      if (stationFilter !== 0 && p.stationId !== stationFilter) return false;
      if (difficultyFilter !== "all" && p.difficulty !== difficultyFilter) {
        return false;
      }
      if (tagFilter !== "all") {
        const tags = getTagsForPuzzle(p.id);
        if (!tags.includes(tagFilter)) return false;
      }
      const rec = solvedMap[p.id];
      if (statusFilter === "solved" && !rec) return false;
      if (statusFilter === "unsolved" && rec) return false;
      if (statusFilter === "par_beaten" && (!rec || rec.bestSteps > p.parSteps)) {
        return false;
      }

      if (q) {
        const idMatch = String(p.id) === q || `#${p.id}` === q;
        const titleMatch = p.title.toLowerCase().includes(q);
        const targetMatch = p.targets.some((t) => t.toString().includes(q));
        if (!idMatch && !titleMatch && !targetMatch) return false;
      }
      return true;
    });

    if (sortBy === "id_asc") return list;

    return [...list].sort((a, b) => {
      if (sortBy === "difficulty_asc") {
        return (
          DIFFICULTY_RANK[a.difficulty] - DIFFICULTY_RANK[b.difficulty] ||
          a.id - b.id
        );
      }
      if (sortBy === "difficulty_desc") {
        return (
          DIFFICULTY_RANK[b.difficulty] - DIFFICULTY_RANK[a.difficulty] ||
          a.id - b.id
        );
      }
      if (sortBy === "complexity_asc") {
        const ca = complexityMap.get(a.id)?.score ?? 0;
        const cb = complexityMap.get(b.id)?.score ?? 0;
        return ca - cb || a.id - b.id;
      }
      if (sortBy === "complexity_desc") {
        const ca = complexityMap.get(a.id)?.score ?? 0;
        const cb = complexityMap.get(b.id)?.score ?? 0;
        return cb - ca || a.id - b.id;
      }
      const aSolved = Boolean(solvedMap[a.id]) ? 1 : 0;
      const bSolved = Boolean(solvedMap[b.id]) ? 1 : 0;
      if (sortBy === "solved_first") {
        return bSolved - aSolved || a.id - b.id;
      }
      return aSolved - bSolved || a.id - b.id;
    });
  }, [
    allPuzzles,
    stationFilter,
    difficultyFilter,
    tagFilter,
    statusFilter,
    sortBy,
    searchQuery,
    solvedMap,
    getTagsForPuzzle,
    complexityMap,
  ]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = filtered.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE
  );

  const handleJump = (e: React.FormEvent) => {
    e.preventDefault();
    const num = Number(jumpInput.trim());
    if (Number.isInteger(num) && num >= 1 && num <= TOTAL_PUZZLES) {
      onSelectPuzzle(num);
    }
  };

  const dailySeedsText = dailyPuzzle
    ? Object.entries(dailyPuzzle.seeds)
        .map(([s, v]) => `R${s}=${v}`)
        .join(", ")
    : "";
  const dailyTargetsText = dailyPuzzle
    ? dailyPuzzle.targets.map((t) => formatBigIntCompact(t)).join(", ")
    : "";

  const cachedTimeLabel = useMemo(() => {
    if (!cachedAt) return null;
    try {
      return new Date(cachedAt).toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return null;
    }
  }, [cachedAt]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 lg:flex-row lg:items-end lg:justify-between dark:border-slate-800">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl dark:text-slate-100">
            Workshop Directory (1,000 Puzzles)
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Select any toy-making station task to open it in the 48-slot Elf Calculator workbench.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs shrink-0">
          <div className="flex flex-wrap items-center gap-2 text-slate-600 dark:text-slate-400">
            {!isOnline && (
              <>
                <span className="inline-flex items-center gap-1 font-medium text-amber-700 dark:text-amber-400">
                  <WifiOff className="h-3.5 w-3.5" />
                  Offline mode
                </span>
                <span aria-hidden="true">·</span>
              </>
            )}
            <span className="inline-flex items-center gap-1.5 font-medium text-slate-700 dark:text-slate-300">
              <Database className="h-3.5 w-3.5 text-emerald-700 dark:text-emerald-400" />
              {cacheState === "cached"
                ? `IndexedDB offline cache: ${allPuzzles.length.toLocaleString()} / ${TOTAL_PUZZLES.toLocaleString()} puzzles`
                : cacheState === "rebuilding"
                  ? "Updating IndexedDB cache..."
                  : cacheState === "checking"
                    ? "Checking IndexedDB cache..."
                    : "In-memory puzzle index active"}
            </span>
            {cacheState === "cached" && cachedTimeLabel && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono text-[11px] text-slate-500 tabular-nums dark:text-slate-400">
                  Synced {cachedTimeLabel}
                </span>
              </>
            )}
          </div>

          <button
            type="button"
            disabled={cacheState === "rebuilding"}
            onClick={() => syncOfflineCache(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 whitespace-nowrap shrink-0"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${
                cacheState === "rebuilding" ? "animate-spin" : ""
              }`}
            />
            {cacheState === "rebuilding" ? "Caching..." : "Refresh Offline Cache"}
          </button>
        </div>
      </div>

      {/* Daily Challenge Spotlight */}
      {dailyPuzzle && (
        <section
          aria-label="Daily Challenge"
          className="flex flex-col justify-between gap-4 rounded-xl border border-emerald-300 bg-white p-5 lg:flex-row lg:items-center dark:border-emerald-800 dark:bg-slate-900"
        >
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-800 dark:text-emerald-400">
                <Calendar className="h-3.5 w-3.5" />
                Daily Challenge
              </span>
              <span aria-hidden="true">·</span>
              <span>{todayDateLabel}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">Puzzle #{dailyPuzzle.id}</span>
              <span aria-hidden="true">·</span>
              <span>{dailyPuzzle.station}</span>
              <span aria-hidden="true">·</span>
              <span>{dailyPuzzle.difficulty}</span>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">Par {dailyPuzzle.parSteps} instructions</span>
              {dailyStreak > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-medium text-slate-800 tabular-nums dark:text-slate-200">
                    Streak: {dailyStreak} day{dailyStreak === 1 ? "" : "s"}
                  </span>
                </>
              )}
            </div>

            <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100">
              {dailyPuzzle.title}
            </h2>

            <p className="text-xs text-slate-600 dark:text-slate-400">
              Seeds:{" "}
              <span className="font-mono font-medium text-slate-900 tabular-nums dark:text-slate-100">
                {dailySeedsText}
              </span>
              <span className="mx-2 text-slate-300 dark:text-slate-600" aria-hidden="true">
                /
              </span>
              Targets:{" "}
              <span className="font-mono font-medium text-slate-900 tabular-nums dark:text-slate-100">
                [{dailyTargetsText}]
              </span>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-4 shrink-0">
            <div className="text-left lg:text-right">
              <div className="inline-flex items-center gap-1.5 text-xs font-medium">
                {isDailyCompletedToday ? (
                  <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                    <CheckCircle2 className="h-4 w-4" />
                    Completed Today
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-slate-600 dark:text-slate-400">
                    <Circle className="h-4 w-4" />
                    Not Yet Solved
                  </span>
                )}
              </div>
              <div className="mt-0.5 font-mono text-xs text-slate-500 tabular-nums dark:text-slate-400">
                {dailySolvedRecord
                  ? `Your best: ${dailySolvedRecord.bestSteps} instructions`
                  : "Rotates daily at midnight"}
              </div>
            </div>

            <button
              type="button"
              onClick={() => onSelectPuzzle(dailyPuzzle.id)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-4 py-2.5 text-xs font-medium text-white transition-colors hover:bg-emerald-800 dark:bg-emerald-600 dark:hover:bg-emerald-500 whitespace-nowrap shrink-0"
            >
              {isDailyCompletedToday ? "Optimize in Workbench" : "Solve Daily Challenge"}
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </section>
      )}

      {/* 4-Column Summary Metric Strip */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3.5 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-xs text-slate-500 dark:text-slate-400">Puzzles Solved</div>
          <div className="mt-1 font-mono text-2xl font-semibold text-slate-900 tabular-nums dark:text-slate-100">
            {stats.solvedCount} / {TOTAL_PUZZLES}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3.5 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-xs text-slate-500 dark:text-slate-400">At or Under Par</div>
          <div className="mt-1 font-mono text-2xl font-semibold text-emerald-700 tabular-nums dark:text-emerald-400">
            {stats.parBeatenCount}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3.5 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Total Instructions
            </span>
            {stats.historicalAverageSteps !== null && (
              <span className="font-mono text-[11px] text-slate-500 tabular-nums dark:text-slate-400">
                Avg {stats.historicalAverageSteps.toFixed(1)}/puzzle
              </span>
            )}
          </div>
          <div className="mt-1 font-mono text-2xl font-semibold text-slate-900 tabular-nums dark:text-slate-100">
            {stats.totalInstructions}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3.5 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-xs text-slate-500 dark:text-slate-400">Workshop Completion</div>
          <div className="mt-1 font-mono text-2xl font-semibold text-slate-900 tabular-nums dark:text-slate-100">
            {stats.completionPct}%
          </div>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 lg:flex-row lg:items-center lg:justify-between dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-1 flex-wrap items-center gap-3">
          <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(1);
              }}
              placeholder="Search #ID, title, or target..."
              className="w-full rounded-lg border border-slate-300 bg-slate-50 py-2 pl-9 pr-3 text-xs text-slate-900 focus:border-emerald-700 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-emerald-500 dark:focus:bg-slate-900"
            />
          </div>

          <select
            aria-label="Filter by station"
            value={stationFilter}
            onChange={(e) => {
              setStationFilter(Number(e.target.value));
              setPage(1);
            }}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          >
            <option value={0}>All 5 Stations (#1–#1000)</option>
            {STATIONS.map((st) => (
              <option key={st.id} value={st.id}>
                {st.name} (#{st.rangeStart}–#{st.rangeEnd})
              </option>
            ))}
          </select>

          <select
            aria-label="Filter by difficulty"
            value={difficultyFilter}
            onChange={(e) => {
              setDifficultyFilter(e.target.value as DifficultyFilter);
              setPage(1);
            }}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          >
            <option value="all">Difficulty: All</option>
            <option value="Apprentice">Easy (Apprentice)</option>
            <option value="Journeyman">Medium (Journeyman)</option>
            <option value="Master">Hard (Master)</option>
            <option value="Grandmaster">Master (Grandmaster)</option>
          </select>

          <select
            aria-label="Filter by category tag"
            value={tagFilter}
            onChange={(e) => {
              setTagFilter(e.target.value as TagFilter);
              setPage(1);
            }}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          >
            <option value="all">Tag: All Categories</option>
            {ALL_PUZZLE_TAGS.map((tag) => (
              <option key={tag} value={tag}>
                {tag}
              </option>
            ))}
          </select>

          <select
            aria-label="Sort puzzles"
            value={sortBy}
            onChange={(e) => {
              setSortBy(e.target.value as SortOption);
              setPage(1);
            }}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          >
            <option value="id_asc">Sort: Puzzle ID (#1–#1000)</option>
            <option value="complexity_asc">Sort: Complexity (Lowest First)</option>
            <option value="complexity_desc">Sort: Complexity (Highest First)</option>
            <option value="difficulty_asc">Sort: Difficulty (Easy → Master)</option>
            <option value="difficulty_desc">Sort: Difficulty (Master → Easy)</option>
            <option value="solved_first">Sort: Status (Solved First)</option>
            <option value="unsolved_first">Sort: Status (Unsolved First)</option>
          </select>

          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
            {(
              [
                { id: "all", label: "All" },
                { id: "unsolved", label: "Unsolved" },
                { id: "solved", label: "Solved" },
                { id: "par_beaten", label: "Par Met" },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setStatusFilter(tab.id);
                  setPage(1);
                }}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  statusFilter === tab.id
                    ? "bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-slate-100"
                    : "text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <form onSubmit={handleJump} className="flex items-center gap-2 shrink-0">
          <input
            type="number"
            min={1}
            max={TOTAL_PUZZLES}
            value={jumpInput}
            onChange={(e) => setJumpInput(e.target.value)}
            placeholder="Go to #"
            className="w-24 rounded-lg border border-slate-300 bg-slate-50 px-2.5 py-2 font-mono text-xs text-slate-900 focus:border-emerald-700 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-emerald-500 dark:focus:bg-slate-900"
          />
          <button
            type="submit"
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 whitespace-nowrap shrink-0"
          >
            Open
          </button>
        </form>
      </div>

      {/* High-Density Puzzle Data Table */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-300">
                <th className="px-4 py-3 font-semibold">ID</th>
                <th className="px-4 py-3 font-semibold">Station Task &amp; Tags</th>
                <th className="px-4 py-3 font-semibold">Complexity</th>
                <th className="px-4 py-3 font-semibold">Seeds</th>
                <th className="px-4 py-3 font-semibold">Target Numbers</th>
                <th className="px-4 py-3 text-right font-semibold">Par</th>
                <th className="px-4 py-3 text-right font-semibold">Your Best</th>
                <th className="px-4 py-3 font-semibold">vs Your Avg</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 text-right font-semibold">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {pageItems.length === 0 ? (
                <tr>
                  <td
                    colSpan={10}
                    className="px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400"
                  >
                    {allPuzzles.length === 0 && cacheState === "checking"
                      ? "Loading 1,000 puzzles from local IndexedDB cache..."
                      : "No puzzles match the current search or filter."}
                  </td>
                </tr>
              ) : (
                pageItems.map((p) => {
                  const rec = solvedMap[p.id];
                  const isActive = p.id === activePuzzleId;
                  const isDaily = p.id === dailyPuzzleId;
                  const complexity =
                    complexityMap.get(p.id) ?? calculatePuzzleComplexity(p);
                  const puzzleTags = getTagsForPuzzle(p.id);
                  const isEditingTags = editingTagsPuzzleId === p.id;
                  const seedText = Object.entries(p.seeds)
                    .map(([s, v]) => `R${s}=${v}`)
                    .join(", ");
                  const targetsText = p.targets
                    .map((t) => formatBigIntCompact(t))
                    .join(", ");

                  const complexityBadgeClass =
                    complexity.tier === "Extreme"
                      ? "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/60 dark:text-rose-300"
                      : complexity.tier === "High"
                        ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                        : complexity.tier === "Moderate"
                          ? "border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-950/60 dark:text-sky-300"
                          : "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300";

                  return (
                    <tr
                      key={p.id}
                      className={`h-11 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50 ${
                        isActive
                          ? "bg-emerald-50/40 dark:bg-emerald-950/30"
                          : isDaily
                            ? "bg-amber-50/35 dark:bg-amber-950/20"
                            : ""
                      }`}
                    >
                      <td className="px-4 py-2 font-mono font-semibold text-slate-900 tabular-nums dark:text-slate-100">
                        #{p.id}
                      </td>
                      <td className="px-4 py-2">
                        <div className="font-medium text-slate-900 dark:text-slate-100">
                          {p.title}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                          {p.station} · {p.difficulty}
                          {isDaily && (
                            <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                              {" "}
                              · Daily Challenge
                            </span>
                          )}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-1">
                          {puzzleTags.map((tag) => (
                            <button
                              key={tag}
                              type="button"
                              onClick={() => {
                                setTagFilter((prev) =>
                                  prev === tag ? "all" : tag
                                );
                                setPage(1);
                              }}
                              title={`Filter by ${tag}`}
                              className={`rounded-md border px-1.5 py-0.5 text-[10px] font-medium transition-colors whitespace-nowrap shrink-0 ${
                                tagFilter === tag
                                  ? "border-emerald-500 bg-emerald-50 text-emerald-800 dark:border-emerald-600 dark:bg-emerald-950/70 dark:text-emerald-200"
                                  : "border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-slate-600"
                              }`}
                            >
                              {tag}
                            </button>
                          ))}
                          <button
                            type="button"
                            onClick={() =>
                              setEditingTagsPuzzleId((prev) =>
                                prev === p.id ? null : p.id
                              )
                            }
                            aria-label={`Edit tags for puzzle #${p.id}`}
                            title="Categorize puzzle tags"
                            className="inline-flex items-center gap-0.5 rounded-md border border-dashed border-slate-300 px-1.5 py-0.5 text-[10px] text-slate-500 hover:border-slate-400 hover:text-slate-800 dark:border-slate-700 dark:text-slate-400 dark:hover:border-slate-500 dark:hover:text-slate-200 whitespace-nowrap shrink-0"
                          >
                            <Tag className="h-2.5 w-2.5" />
                            {isEditingTags ? "Done" : "Tags"}
                          </button>
                        </div>
                        {isEditingTags && (
                          <div className="mt-1.5 flex flex-wrap items-center gap-1 rounded-md border border-slate-200 bg-white p-1.5 dark:border-slate-700 dark:bg-slate-900">
                            {ALL_PUZZLE_TAGS.map((tag) => {
                              const active = puzzleTags.includes(tag);
                              return (
                                <button
                                  key={tag}
                                  type="button"
                                  onClick={() => handleTogglePuzzleTag(p.id, tag)}
                                  className={`rounded-md border px-2 py-0.5 text-[10px] font-medium transition-colors whitespace-nowrap shrink-0 ${
                                    active
                                      ? "border-emerald-600 bg-emerald-600 text-white dark:border-emerald-500 dark:bg-emerald-600"
                                      : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                                  }`}
                                >
                                  {active ? `✓ ${tag}` : `+ ${tag}`}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        <span
                          title={complexity.summary}
                          className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-[11px] font-medium tabular-nums whitespace-nowrap shrink-0 ${complexityBadgeClass}`}
                        >
                          <Gauge className="h-3 w-3 shrink-0" />
                          {complexity.score} · {complexity.tier}
                        </span>
                      </td>
                      <td className="px-4 py-2 font-mono text-slate-700 tabular-nums dark:text-slate-300">
                        {seedText}
                      </td>
                      <td className="max-w-[220px] truncate px-4 py-2 font-mono text-slate-900 tabular-nums dark:text-slate-100">
                        [{targetsText}]
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-slate-700 tabular-nums dark:text-slate-300">
                        {p.parSteps}
                      </td>
                      <td className="px-4 py-2 text-right font-mono font-semibold text-slate-900 tabular-nums dark:text-slate-100">
                        {rec ? rec.bestSteps : "—"}
                      </td>
                      <td className="px-4 py-2">
                        {rec && stats.historicalAverageSteps !== null ? (
                          (() => {
                            const avg = stats.historicalAverageSteps;
                            const diff = rec.bestSteps - avg;
                            const attemptCount = rec.history?.length ?? 0;
                            const puzzleAttemptAvg =
                              attemptCount > 0 && rec.history
                                ? rec.history.reduce((sum, a) => sum + a.steps, 0) /
                                  attemptCount
                                : rec.bestSteps;
                            const tooltip =
                              `Best: ${rec.bestSteps} steps vs your historical average of ${avg.toFixed(1)} steps across ${stats.solvedCount} solved puzzle${stats.solvedCount === 1 ? "" : "s"}` +
                              (attemptCount > 1
                                ? ` (${attemptCount} attempts on #${p.id}, avg ${puzzleAttemptAvg.toFixed(1)} steps)`
                                : "");

                            if (diff < -0.05) {
                              return (
                                <span
                                  title={tooltip}
                                  className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-mono text-[11px] font-medium text-emerald-700 tabular-nums dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 whitespace-nowrap shrink-0"
                                >
                                  <TrendingDown className="h-3 w-3 shrink-0" />
                                  {diff.toFixed(1)} vs avg
                                </span>
                              );
                            }
                            if (diff > 0.05) {
                              return (
                                <span
                                  title={tooltip}
                                  className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 font-mono text-[11px] font-medium text-amber-800 tabular-nums dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300 whitespace-nowrap shrink-0"
                                >
                                  <TrendingUp className="h-3 w-3 shrink-0" />
                                  +{diff.toFixed(1)} vs avg
                                </span>
                              );
                            }
                            return (
                              <span
                                title={tooltip}
                                className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-100 px-2 py-0.5 font-mono text-[11px] font-medium text-slate-700 tabular-nums dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 whitespace-nowrap shrink-0"
                              >
                                <Minus className="h-3 w-3 shrink-0" />
                                On avg
                              </span>
                            );
                          })()
                        ) : (
                          <span className="text-slate-400 dark:text-slate-600">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        {rec ? (
                          <span className="inline-flex items-center gap-1 font-medium text-emerald-700 dark:text-emerald-400">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Solved
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-slate-500 dark:text-slate-400">
                            <Circle className="h-3.5 w-3.5" />
                            Pending
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => onSelectPuzzle(p.id)}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-800 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 whitespace-nowrap shrink-0"
                        >
                          {isActive ? "Active" : "Open"}
                          <ArrowRight className="h-3 w-3" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-400">
          <span className="tabular-nums">
            Showing {(safePage - 1) * PAGE_SIZE + (filtered.length > 0 ? 1 : 0)}–
            {Math.min(safePage * PAGE_SIZE, filtered.length)} of {filtered.length} puzzles
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={safePage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 whitespace-nowrap shrink-0"
            >
              Previous Page
            </button>
            <span className="font-mono tabular-nums">
              Page {safePage} / {totalPages}
            </span>
            <button
              type="button"
              disabled={safePage >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 whitespace-nowrap shrink-0"
            >
              Next Page
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
