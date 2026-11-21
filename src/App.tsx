import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Moon, Sun, Volume2, VolumeX } from "lucide-react";
import { User, onAuthStateChanged } from "firebase/auth";
import {
  createInitialSlots,
  executeProgram,
  parseProgram,
} from "./lib/elfVm";
import {
  Puzzle,
  getDailyChallengeId,
  getLocalDateKey,
  getPuzzle,
} from "./lib/puzzles";
import { loadOrCacheAllPuzzles } from "./lib/puzzleCacheDb";
import { decodeSharedPuzzleFromSearch } from "./lib/puzzleMetrics";
import { playSuccessChime } from "./lib/sound";
import { auth, submitLeaderboardScore } from "./lib/firebase";
import { WorkbenchView } from "./components/WorkbenchView";
import { PuzzleDirectoryView } from "./components/PuzzleDirectoryView";
import { LeaderboardView } from "./components/LeaderboardView";
import { ImageScannerView } from "./components/ImageScannerView";
import { AssistantView } from "./components/AssistantView";
import { ErrorBoundary } from "./components/ErrorBoundary";
import {
  ChatMessage,
  SolveAttempt,
  SolvedRecord,
  ThemeMode,
  ViewTab,
} from "./types/app";

const STORAGE_SOLVED_KEY = "elf_calc_solved_v1";
const STORAGE_DRAFTS_KEY = "elf_calc_drafts_v1";
const STORAGE_DAILY_KEY = "elf_calc_daily_v1";
const STORAGE_CUSTOM_KEY = "elf_calc_custom_v1";
const STORAGE_ACTIVE_PUZZLE_KEY = "elf_calc_active_puzzle_v1";
const STORAGE_THEME_KEY = "elf_calc_theme_v1";
const STORAGE_SOUND_KEY = "elf_calc_sound_v1";
const AUTO_SAVE_INTERVAL_MS = 30_000;
const MAX_HISTORY_PER_PUZZLE = 25;

interface StoredCustomState {
  seeds: Record<number, string>;
  targets: string[];
  program: string;
}

function loadJsonStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function loadNormalizedSolvedMap(): Record<number, SolvedRecord> {
  const rawMap = loadJsonStorage<Record<number, SolvedRecord>>(
    STORAGE_SOLVED_KEY,
    {}
  );
  const normalized: Record<number, SolvedRecord> = {};
  for (const [key, rec] of Object.entries(rawMap)) {
    const id = Number(key);
    if (!rec || typeof rec.puzzleId !== "number") continue;
    const history: SolveAttempt[] =
      Array.isArray(rec.history) && rec.history.length > 0
        ? rec.history
        : [
            {
              id: `legacy-${rec.puzzleId}-${rec.updatedAt}`,
              steps: rec.bestSteps,
              program: rec.program,
              solvedAt: rec.updatedAt,
            },
          ];
    normalized[id] = {
      ...rec,
      history,
    };
  }
  return normalized;
}

function loadInitialCustomState(): {
  puzzle: Puzzle | null;
  program: string;
} {
  try {
    if (typeof window !== "undefined" && window.location.search) {
      const shared = decodeSharedPuzzleFromSearch(window.location.search);
      if (shared) {
        return {
          puzzle: {
            id: 0,
            title: shared.title || "Shared Station Puzzle",
            station: "Custom Bench",
            stationId: 0,
            difficulty: "Master",
            seeds: shared.seeds,
            targets: shared.targets,
            parSteps: Math.max(1, shared.targets.length * 2),
            referenceProgram: shared.program ?? "",
            hint: "Shared custom puzzle loaded from URL parameters.",
          },
          program: shared.program ?? "",
        };
      }
    }

    const raw = localStorage.getItem(STORAGE_CUSTOM_KEY);
    if (!raw) return { puzzle: null, program: "" };
    const parsed = JSON.parse(raw) as StoredCustomState;
    const seeds: Record<number, bigint> = {};
    for (const [k, v] of Object.entries(parsed.seeds || {})) {
      seeds[Number(k)] = BigInt(v);
    }
    const targets = (parsed.targets || []).map((t) => BigInt(t));
    if (targets.length === 0) return { puzzle: null, program: "" };
    return {
      puzzle: {
        id: 0,
        title: "Custom Station Targets",
        station: "Custom Bench",
        stationId: 0,
        difficulty: "Master",
        seeds,
        targets,
        parSteps: Math.max(1, targets.length * 2),
        referenceProgram: parsed.program ?? "",
        hint: "Custom target set loaded into the 48-slot Elf Calculator.",
      },
      program: parsed.program ?? "",
    };
  } catch {
    return { puzzle: null, program: "" };
  }
}

export default function App() {
  const initialCustom = useMemo(() => loadInitialCustomState(), []);

  const [activeTab, setActiveTab] = useState<ViewTab>("workbench");
  const [activePuzzleId, setActivePuzzleId] = useState<number>(() => {
    const savedId = loadJsonStorage<number>(STORAGE_ACTIVE_PUZZLE_KEY, 1);
    return Number.isInteger(savedId) && savedId >= 1 && savedId <= 1000
      ? savedId
      : 1;
  });
  const [customPuzzle, setCustomPuzzle] = useState<Puzzle | null>(
    initialCustom.puzzle
  );

  const [drafts, setDrafts] = useState<Record<number, string>>(() =>
    loadJsonStorage<Record<number, string>>(STORAGE_DRAFTS_KEY, {
      1: "",
    })
  );

  const [solvedMap, setSolvedMap] = useState<Record<number, SolvedRecord>>(
    loadNormalizedSolvedMap
  );

  const [dailyCompletions, setDailyCompletions] = useState<string[]>(() =>
    loadJsonStorage<string[]>(STORAGE_DAILY_KEY, [])
  );

  const [customProgram, setCustomProgram] = useState<string>(
    initialCustom.program
  );
  const [practiceMode, setPracticeMode] = useState<boolean>(false);
  const [practiceDrafts, setPracticeDrafts] = useState<Record<number, string>>(
    {}
  );
  const [customPracticeProgram, setCustomPracticeProgram] =
    useState<string>("");
  const [stepCursor, setStepCursor] = useState<number | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState<boolean>(false);
  const [lastAutoSavedAt, setLastAutoSavedAt] = useState<string | null>(null);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_SOUND_KEY);
      if (saved === "false") return false;
      if (saved === "true") return true;
    } catch {
      // Ignore storage access errors
    }
    return true;
  });
  const [theme, setTheme] = useState<ThemeMode>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_THEME_KEY);
      if (saved === "dark" || saved === "light") return saved;
      if (document.documentElement.classList.contains("dark")) return "dark";
      if (
        window.matchMedia &&
        window.matchMedia("(prefers-color-scheme: dark)").matches
      ) {
        return "dark";
      }
    } catch {
      // Ignore storage access errors
    }
    return "light";
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_SOUND_KEY, String(soundEnabled));
    } catch {
      // Ignore storage quota errors
    }
  }, [soundEnabled]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    try {
      localStorage.setItem(STORAGE_THEME_KEY, theme);
    } catch {
      // Ignore storage quota errors
    }
  }, [theme]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setAuthUser(u);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  // Warm up IndexedDB offline cache for all 1,000 puzzles on startup
  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadOrCacheAllPuzzles(false).catch(() => {
        // Non-blocking background offline cache warm-up
      });
    }, 300);
    return () => window.clearTimeout(timer);
  }, []);

  const activePuzzle = useMemo(
    () => customPuzzle ?? getPuzzle(activePuzzleId),
    [customPuzzle, activePuzzleId]
  );

  const primaryProgram = customPuzzle
    ? customProgram
    : drafts[activePuzzleId] ?? "";

  const currentProgram = practiceMode
    ? customPuzzle
      ? customPracticeProgram
      : practiceDrafts[activePuzzleId] ?? primaryProgram
    : primaryProgram;

  const solvedTransitionRef = useRef<{ key: string; solved: boolean }>({
    key: "",
    solved: false,
  });

  const latestWorkbenchRef = useRef({
    activePuzzleId,
    drafts,
    customPuzzle,
    customProgram,
  });

  useEffect(() => {
    latestWorkbenchRef.current = {
      activePuzzleId,
      drafts,
      customPuzzle,
      customProgram,
    };
  }, [activePuzzleId, drafts, customPuzzle, customProgram]);

  const flushWorkbenchToStorage = () => {
    try {
      const snap = latestWorkbenchRef.current;
      localStorage.setItem(STORAGE_DRAFTS_KEY, JSON.stringify(snap.drafts));
      localStorage.setItem(
        STORAGE_ACTIVE_PUZZLE_KEY,
        JSON.stringify(snap.activePuzzleId)
      );
      if (snap.customPuzzle) {
        const serializedSeeds: Record<number, string> = {};
        for (const [k, v] of Object.entries(snap.customPuzzle.seeds)) {
          serializedSeeds[Number(k)] = v.toString();
        }
        const customPayload: StoredCustomState = {
          seeds: serializedSeeds,
          targets: snap.customPuzzle.targets.map((t) => t.toString()),
          program: snap.customProgram,
        };
        localStorage.setItem(STORAGE_CUSTOM_KEY, JSON.stringify(customPayload));
      } else {
        localStorage.removeItem(STORAGE_CUSTOM_KEY);
      }
      setLastAutoSavedAt(
        new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })
      );
    } catch {
      // Ignore storage quota errors
    }
  };

  // Periodic 30-second auto-save mechanism + unload flush
  useEffect(() => {
    const timerId = window.setInterval(() => {
      flushWorkbenchToStorage();
    }, AUTO_SAVE_INTERVAL_MS);

    const handleBeforeUnload = () => {
      flushWorkbenchToStorage();
    };
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.clearInterval(timerId);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, []);

  // Also persist drafts on edit for immediate durability
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_DRAFTS_KEY, JSON.stringify(drafts));
    } catch {
      // Ignore storage quota errors
    }
  }, [drafts]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_SOLVED_KEY, JSON.stringify(solvedMap));
    } catch {
      // Ignore storage quota errors
    }
  }, [solvedMap]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_DAILY_KEY, JSON.stringify(dailyCompletions));
    } catch {
      // Ignore storage quota errors
    }
  }, [dailyCompletions]);

  // Automatically record solved standard puzzles (unless Practice Mode is active)
  // and trigger subtle success chime on unsolved -> solved transition
  useEffect(() => {
    const parsed = parseProgram(currentProgram);
    const hasValidInstructions =
      parsed.errors.length === 0 && parsed.instructions.length > 0;

    const result = hasValidInstructions
      ? executeProgram(
          createInitialSlots(activePuzzle.seeds),
          parsed.instructions,
          activePuzzle.targets
        )
      : null;

    const isNowSolved = Boolean(result?.isSolved);
    const sessionKey = `${activePuzzle.id}:${customPuzzle ? "custom" : "std"}:${
      practiceMode ? "practice" : "ranked"
    }`;

    if (solvedTransitionRef.current.key !== sessionKey) {
      solvedTransitionRef.current = { key: sessionKey, solved: isNowSolved };
    } else {
      const wasSolved = solvedTransitionRef.current.solved;
      solvedTransitionRef.current.solved = isNowSolved;
      if (!wasSolved && isNowSolved && soundEnabled) {
        playSuccessChime();
      }
    }

    if (customPuzzle || practiceMode || !result || !result.isSolved) return;

    const steps = parsed.instructions.length;
    const trimmedProgram = currentProgram.trim();
    const nowIso = new Date().toISOString();

    setSolvedMap((prev) => {
      const existing = prev[activePuzzle.id];
      const prevHistory = existing?.history ?? [];

      // Skip recording if identical to the latest stored attempt
      if (
        prevHistory.length > 0 &&
        prevHistory[0].program.trim() === trimmedProgram
      ) {
        return prev;
      }

      // Also avoid duplicating if identical program already exists in history
      const alreadyInHistory = prevHistory.some(
        (item) => item.program.trim() === trimmedProgram
      );

      const nextHistory: SolveAttempt[] = alreadyInHistory
        ? prevHistory
        : [
            {
              id: `${activePuzzle.id}-${Date.now()}-${Math.random()
                .toString(36)
                .slice(2, 6)}`,
              steps,
              program: trimmedProgram,
              solvedAt: nowIso,
            },
            ...prevHistory,
          ].slice(0, MAX_HISTORY_PER_PUZZLE);

      const isNewBest = !existing || steps < existing.bestSteps;

      if (!isNewBest && alreadyInHistory) {
        return prev;
      }

      return {
        ...prev,
        [activePuzzle.id]: {
          puzzleId: activePuzzle.id,
          bestSteps: isNewBest ? steps : existing.bestSteps,
          program: isNewBest ? trimmedProgram : existing.program,
          updatedAt: isNewBest ? nowIso : existing.updatedAt,
          history: nextHistory,
        },
      };
    });

    const todayKey = getLocalDateKey();
    const dailyId = getDailyChallengeId();
    if (activePuzzle.id === dailyId) {
      setDailyCompletions((prev) =>
        prev.includes(todayKey) ? prev : [...prev, todayKey]
      );
    }

    if (authUser && authUser.emailVerified) {
      submitLeaderboardScore({
        puzzleId: activePuzzle.id,
        steps,
        parSteps: activePuzzle.parSteps,
      }).catch(() => {
        // Non-blocking auto-sync; manual sync & errors are surfaced in LeaderboardView
      });
    }
  }, [currentProgram, activePuzzle, customPuzzle, practiceMode, soundEnabled, authUser]);

  const handleChangeProgram = (next: string) => {
    if (practiceMode) {
      if (customPuzzle) {
        setCustomPracticeProgram(next);
      } else {
        setPracticeDrafts((prev) => ({
          ...prev,
          [activePuzzleId]: next,
        }));
      }
      return;
    }

    if (customPuzzle) {
      setCustomProgram(next);
    } else {
      setDrafts((prev) => ({
        ...prev,
        [activePuzzleId]: next,
      }));
    }
  };

  const handleTogglePracticeMode = () => {
    setPracticeMode((prev) => {
      const next = !prev;
      if (next) {
        if (customPuzzle) {
          setCustomPracticeProgram((cur) => cur || customProgram);
        } else {
          setPracticeDrafts((p) =>
            p[activePuzzleId] !== undefined
              ? p
              : { ...p, [activePuzzleId]: drafts[activePuzzleId] ?? "" }
          );
        }
      }
      setStepCursor(null);
      return next;
    });
  };

  const handleResetPracticeProgress = () => {
    if (customPuzzle) {
      setCustomPracticeProgram("");
    } else {
      setPracticeDrafts((prev) => ({
        ...prev,
        [activePuzzleId]: "",
      }));
    }
    setStepCursor(0);
  };

  const handleSelectPuzzleId = (id: number) => {
    setCustomPuzzle(null);
    setActivePuzzleId(id);
    setStepCursor(null);
    setActiveTab("workbench");
  };

  const handleLoadCustomPuzzle = (
    seeds: Record<number, bigint>,
    targets: bigint[],
    suggestedProgram?: string
  ) => {
    const custom: Puzzle = {
      id: 0,
      title: "Custom Station Targets",
      station: "Custom Bench",
      stationId: 0,
      difficulty: "Master",
      seeds,
      targets,
      parSteps: Math.max(1, targets.length * 2),
      referenceProgram: suggestedProgram ?? "",
      hint: "Custom target set loaded into the 48-slot Elf Calculator.",
    };
    setCustomPuzzle(custom);
    setCustomProgram(suggestedProgram ?? "");
    setStepCursor(null);
    setActiveTab("workbench");
  };

  const handleExportSolutions = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      solvedCount: Object.keys(solvedMap).length,
      solutions: Object.values(solvedMap).sort(
        (a, b) => a.puzzleId - b.puzzleId
      ),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `elf-calculator-solutions-${payload.solvedCount}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setExportNotice(`Exported ${payload.solvedCount} solved puzzle programs.`);
    window.setTimeout(() => setExportNotice(null), 3500);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 transition-colors dark:bg-slate-950 dark:text-slate-100">
      {/* Top Bar Contract: 3 zones separated by gap-8 */}
      <header className="no-print border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex max-w-[1360px] items-center justify-between gap-8 px-6 py-3.5">
          {/* Zone 1: Single-line Brand Wordmark */}
          <a
            href="#workbench"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab("workbench");
            }}
            className="font-display text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap shrink-0"
          >
            Elf Calculator
          </a>

          {/* Zone 2: 5 single-line nav links */}
          <nav className="flex items-center gap-6 overflow-x-auto text-sm font-medium">
            {(
              [
                { id: "workbench", label: "Workbench" },
                { id: "puzzles", label: "1,000 Puzzles" },
                { id: "leaderboard", label: "Leaderboard" },
                { id: "scanner", label: "Image Scanner" },
                { id: "assistant", label: "Assistant" },
              ] as const
            ).map((item) => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`border-b-2 py-1 text-sm transition-colors whitespace-nowrap shrink-0 ${
                    isActive
                      ? "border-emerald-700 font-semibold text-slate-900 dark:border-emerald-400 dark:text-white"
                      : "border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: Sound Toggle + Theme Toggle + Primary Action */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setSoundEnabled((prev) => !prev)}
              aria-label={
                soundEnabled
                  ? "Mute completion sound effects"
                  : "Enable completion sound effects"
              }
              aria-pressed={soundEnabled}
              title={
                soundEnabled
                  ? "Completion chime enabled (click to mute)"
                  : "Completion chime muted (click to enable)"
              }
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 whitespace-nowrap shrink-0"
            >
              {soundEnabled ? (
                <>
                  <Volume2 className="h-3.5 w-3.5 text-emerald-700 dark:text-emerald-400" />
                  <span>Sound</span>
                </>
              ) : (
                <>
                  <VolumeX className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500" />
                  <span>Muted</span>
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() =>
                setTheme((prev) => (prev === "dark" ? "light" : "dark"))
              }
              aria-label={
                theme === "dark"
                  ? "Switch to light mode"
                  : "Switch to dark mode"
              }
              aria-pressed={theme === "dark"}
              title={
                theme === "dark"
                  ? "Switch to light mode"
                  : "Switch to dark mode"
              }
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 whitespace-nowrap shrink-0"
            >
              {theme === "dark" ? (
                <>
                  <Sun className="h-3.5 w-3.5 text-amber-400" />
                  <span>Light</span>
                </>
              ) : (
                <>
                  <Moon className="h-3.5 w-3.5 text-slate-600" />
                  <span>Dark</span>
                </>
              )}
            </button>
            <button
              type="button"
              onClick={handleExportSolutions}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white whitespace-nowrap shrink-0"
            >
              <Download className="h-3.5 w-3.5" />
              Export Solutions
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="mx-auto max-w-[1360px] px-6 py-7">
        {exportNotice && (
          <div className="mb-4 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2 text-xs font-medium text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">
            {exportNotice}
          </div>
        )}

        {activeTab === "workbench" && (
          <WorkbenchView
            puzzle={activePuzzle}
            isCustomPuzzle={customPuzzle !== null}
            program={currentProgram}
            onChangeProgram={handleChangeProgram}
            stepCursor={stepCursor}
            onChangeStepCursor={setStepCursor}
            solvedRecord={
              customPuzzle ? undefined : solvedMap[activePuzzle.id]
            }
            practiceMode={practiceMode}
            onTogglePracticeMode={handleTogglePracticeMode}
            onResetPractice={handleResetPracticeProgress}
            lastAutoSavedAt={lastAutoSavedAt}
            theme={theme}
            onSelectPuzzleId={handleSelectPuzzleId}
            onLoadCustomPuzzle={(seeds, targets) =>
              handleLoadCustomPuzzle(seeds, targets)
            }
            onExitCustomPuzzle={() => {
              setCustomPuzzle(null);
              setStepCursor(null);
            }}
            onOpenAssistantForPuzzle={() => setActiveTab("assistant")}
          />
        )}

        {activeTab === "puzzles" && (
          <PuzzleDirectoryView
            activePuzzleId={activePuzzleId}
            solvedMap={solvedMap}
            dailyCompletions={dailyCompletions}
            onSelectPuzzle={handleSelectPuzzleId}
          />
        )}

        {activeTab === "leaderboard" && (
          <ErrorBoundary>
            <LeaderboardView
              user={authUser}
              authReady={authReady}
              activePuzzleId={activePuzzleId}
              solvedMap={solvedMap}
              theme={theme}
              onSelectPuzzle={handleSelectPuzzleId}
            />
          </ErrorBoundary>
        )}

        {activeTab === "scanner" && (
          <ImageScannerView
            activePuzzle={activePuzzle}
            onLoadExtractedPuzzle={handleLoadCustomPuzzle}
            onApplyProgramToCurrent={(prog) => {
              handleChangeProgram(prog);
              setStepCursor(null);
              setActiveTab("workbench");
            }}
          />
        )}

        {activeTab === "assistant" && (
          <AssistantView
            activePuzzle={activePuzzle}
            activeProgram={currentProgram}
            messages={chatMessages}
            onChangeMessages={setChatMessages}
            onLoadSuggestedProgram={(prog) => {
              handleChangeProgram(prog);
              setStepCursor(null);
              setActiveTab("workbench");
            }}
          />
        )}
      </main>
    </div>
  );
}
