import React, { useEffect, useMemo, useState } from "react";
import { User } from "firebase/auth";
import {
  Trophy,
  LogIn,
  LogOut,
  UploadCloud,
  ChevronLeft,
  ChevronRight,
  ArrowRight,
  AlertTriangle,
  CheckCircle2,
  Calendar,
  Download,
} from "lucide-react";
import {
  LeaderboardEntryRecord,
  sanitizeDisplayName,
  signInWithGoogle,
  signOutUser,
  submitLeaderboardScore,
  subscribeGlobalLeaderboard,
  subscribePuzzleLeaderboard,
} from "../lib/firebase";
import {
  TOTAL_PUZZLES,
  getDailyChallengeId,
  getPuzzle,
} from "../lib/puzzles";
import { SolvedRecord, ThemeMode } from "../types/app";
import { DifficultyDistributionChart } from "./DifficultyDistributionChart";

interface LeaderboardViewProps {
  user: User | null;
  authReady: boolean;
  activePuzzleId: number;
  solvedMap: Record<number, SolvedRecord>;
  theme: ThemeMode;
  onSelectPuzzle: (id: number) => void;
}

interface SolverAggregate {
  uid: string;
  displayName: string;
  puzzlesCount: number;
  parMetCount: number;
  totalSteps: number;
  bestRankCount: number;
}

export const LeaderboardView: React.FC<LeaderboardViewProps> = ({
  user,
  authReady,
  activePuzzleId,
  solvedMap,
  theme,
  onSelectPuzzle,
}) => {
  const [selectedPuzzleId, setSelectedPuzzleId] =
    useState<number>(activePuzzleId);
  const [jumpInput, setJumpInput] = useState<string>(String(activePuzzleId));
  const [handleInput, setHandleInput] = useState<string>(() =>
    user ? sanitizeDisplayName(user.displayName, user.uid) : ""
  );

  const [puzzleEntries, setPuzzleEntries] = useState<LeaderboardEntryRecord[]>(
    []
  );
  const [puzzleLoading, setPuzzleLoading] = useState<boolean>(true);
  const [puzzleError, setPuzzleError] = useState<string | null>(null);

  const [globalEntries, setGlobalEntries] = useState<LeaderboardEntryRecord[]>(
    []
  );
  const [globalError, setGlobalError] = useState<string | null>(null);

  const [authLoading, setAuthLoading] = useState<boolean>(false);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (user && !handleInput) {
      setHandleInput(sanitizeDisplayName(user.displayName, user.uid));
    }
  }, [user, handleInput]);

  // Real-time subscription for selected puzzle leaderboard
  useEffect(() => {
    setPuzzleLoading(true);
    setPuzzleError(null);
    const unsub = subscribePuzzleLeaderboard(
      selectedPuzzleId,
      (entries) => {
        setPuzzleEntries(entries);
        setPuzzleLoading(false);
      },
      (err) => {
        setPuzzleError(err.message);
        setPuzzleLoading(false);
      }
    );
    return () => unsub();
  }, [selectedPuzzleId]);

  // Real-time subscription for overall global leaderboard standings
  useEffect(() => {
    setGlobalError(null);
    const unsub = subscribeGlobalLeaderboard(
      (entries) => {
        setGlobalEntries(entries);
      },
      (err) => {
        setGlobalError(err.message);
      }
    );
    return () => unsub();
  }, []);

  const selectedPuzzle = useMemo(
    () => getPuzzle(selectedPuzzleId),
    [selectedPuzzleId]
  );

  const dailyChallengeId = useMemo(() => getDailyChallengeId(), []);
  const localSolvedForPuzzle = solvedMap[selectedPuzzleId];
  const localSolvedList = useMemo(() => Object.values(solvedMap), [solvedMap]);

  const puzzleMetrics = useMemo(() => {
    const count = puzzleEntries.length;
    if (count === 0) {
      return {
        solverCount: 0,
        averageSteps: null as number | null,
        bestSteps: null as number | null,
      };
    }
    const sum = puzzleEntries.reduce((acc, entry) => acc + entry.steps, 0);
    return {
      solverCount: count,
      averageSteps: sum / count,
      bestSteps: puzzleEntries[0].steps,
    };
  }, [puzzleEntries]);

  const userComparisonSteps = useMemo(() => {
    if (localSolvedForPuzzle) return localSolvedForPuzzle.bestSteps;
    if (user) {
      const own = puzzleEntries.find((e) => e.uid === user.uid);
      if (own) return own.steps;
    }
    return null;
  }, [localSolvedForPuzzle, puzzleEntries, user]);

  // Aggregate overall top solvers across submitted entries
  const overallStandings = useMemo<SolverAggregate[]>(() => {
    // Track minimum steps per puzzle to count #1 records
    const bestStepsByPuzzle = new Map<number, number>();
    for (const entry of globalEntries) {
      const curr = bestStepsByPuzzle.get(entry.puzzleId);
      if (curr === undefined || entry.steps < curr) {
        bestStepsByPuzzle.set(entry.puzzleId, entry.steps);
      }
    }

    const byUid = new Map<string, SolverAggregate>();
    for (const entry of globalEntries) {
      const existing = byUid.get(entry.uid) ?? {
        uid: entry.uid,
        displayName: entry.displayName,
        puzzlesCount: 0,
        parMetCount: 0,
        totalSteps: 0,
        bestRankCount: 0,
      };
      existing.displayName = entry.displayName;
      existing.puzzlesCount += 1;
      existing.totalSteps += entry.steps;
      if (entry.steps <= entry.parSteps) existing.parMetCount += 1;
      if (bestStepsByPuzzle.get(entry.puzzleId) === entry.steps) {
        existing.bestRankCount += 1;
      }
      byUid.set(entry.uid, existing);
    }

    return Array.from(byUid.values()).sort((a, b) => {
      if (b.puzzlesCount !== a.puzzlesCount) {
        return b.puzzlesCount - a.puzzlesCount;
      }
      if (b.bestRankCount !== a.bestRankCount) {
        return b.bestRankCount - a.bestRankCount;
      }
      return a.totalSteps - b.totalSteps;
    });
  }, [globalEntries]);

  // Puzzles with active global records for quick browsing
  const activeRecordPuzzles = useMemo(() => {
    const map = new Map<
      number,
      { puzzleId: number; bestSteps: number; solverCount: number; topSolver: string }
    >();
    for (const entry of globalEntries) {
      const curr = map.get(entry.puzzleId);
      if (!curr) {
        map.set(entry.puzzleId, {
          puzzleId: entry.puzzleId,
          bestSteps: entry.steps,
          solverCount: 1,
          topSolver: entry.displayName,
        });
      } else {
        curr.solverCount += 1;
        if (entry.steps < curr.bestSteps) {
          curr.bestSteps = entry.steps;
          curr.topSolver = entry.displayName;
        }
      }
    }
    return Array.from(map.values())
      .sort((a, b) => b.solverCount - a.solverCount || a.puzzleId - b.puzzleId)
      .slice(0, 12);
  }, [globalEntries]);

  const handleSignIn = async () => {
    setAuthLoading(true);
    setActionError(null);
    setActionMessage(null);
    try {
      await signInWithGoogle();
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Failed to sign in with Google."
      );
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignOut = async () => {
    setActionError(null);
    setActionMessage(null);
    await signOutUser();
  };

  const handleSubmitSingle = async () => {
    if (!localSolvedForPuzzle) return;
    setSyncing(true);
    setActionError(null);
    setActionMessage(null);
    try {
      const status = await submitLeaderboardScore({
        puzzleId: selectedPuzzleId,
        steps: localSolvedForPuzzle.bestSteps,
        parSteps: selectedPuzzle.parSteps,
        displayNameOverride: handleInput,
      });
      setActionMessage(
        status === "unchanged"
          ? `Your leaderboard record for Puzzle #${selectedPuzzleId} is already up to date.`
          : `Published ${localSolvedForPuzzle.bestSteps}-instruction solution for Puzzle #${selectedPuzzleId}.`
      );
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Failed to submit score."
      );
    } finally {
      setSyncing(false);
    }
  };

  const handleSyncAllSolved = async () => {
    if (localSolvedList.length === 0) return;
    setSyncing(true);
    setActionError(null);
    setActionMessage(null);
    try {
      let submitted = 0;
      for (const rec of localSolvedList) {
        const puz = getPuzzle(rec.puzzleId);
        const res = await submitLeaderboardScore({
          puzzleId: rec.puzzleId,
          steps: rec.bestSteps,
          parSteps: puz.parSteps,
          displayNameOverride: handleInput,
        });
        if (res === "created" || res === "updated") submitted++;
      }
      setActionMessage(
        submitted > 0
          ? `Synced ${submitted} personal-best puzzle score${submitted === 1 ? "" : "s"} to the global leaderboard.`
          : "All solved puzzles are already synced with the global leaderboard."
      );
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Failed to sync solved puzzles."
      );
    } finally {
      setSyncing(false);
    }
  };

  const handleJumpPuzzle = (e: React.FormEvent) => {
    e.preventDefault();
    const num = Number(jumpInput.trim());
    if (Number.isInteger(num) && num >= 1 && num <= TOTAL_PUZZLES) {
      setSelectedPuzzleId(num);
    }
  };

  const selectPuzzleForBoard = (id: number) => {
    const clamped = Math.max(1, Math.min(TOTAL_PUZZLES, id));
    setSelectedPuzzleId(clamped);
    setJumpInput(String(clamped));
  };

  const handleExportPuzzleCsv = () => {
    const csvEscape = (val: string | number) => {
      const str = String(val);
      return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
    };

    const avgStr =
      puzzleMetrics.averageSteps !== null
        ? puzzleMetrics.averageSteps.toFixed(2)
        : "";

    const headers = [
      "puzzle_id",
      "puzzle_title",
      "station",
      "par_steps",
      "community_average_steps",
      "rank",
      "solver",
      "steps",
      "par_delta",
      "source",
      "is_current_user",
      "updated_at",
    ];

    const rows: string[][] = [];

    puzzleEntries.forEach((entry, idx) => {
      const isSelf = Boolean(user && user.uid === entry.uid);
      rows.push([
        String(selectedPuzzle.id),
        selectedPuzzle.title,
        selectedPuzzle.station,
        String(selectedPuzzle.parSteps),
        avgStr,
        String(idx + 1),
        entry.displayName,
        String(entry.steps),
        String(entry.steps - selectedPuzzle.parSteps),
        "leaderboard",
        isSelf ? "true" : "false",
        new Date(entry.updatedAtMs).toISOString(),
      ]);
    });

    const userPublished = Boolean(
      user && puzzleEntries.some((entry) => entry.uid === user.uid)
    );
    if (localSolvedForPuzzle && !userPublished) {
      const localName = user
        ? sanitizeDisplayName(handleInput || user.displayName, user.uid)
        : "Local Solver";
      rows.push([
        String(selectedPuzzle.id),
        selectedPuzzle.title,
        selectedPuzzle.station,
        String(selectedPuzzle.parSteps),
        avgStr,
        "local",
        localName,
        String(localSolvedForPuzzle.bestSteps),
        String(localSolvedForPuzzle.bestSteps - selectedPuzzle.parSteps),
        "local_best",
        "true",
        localSolvedForPuzzle.updatedAt,
      ]);
    }

    const csvContent = [headers, ...rows]
      .map((row) => row.map(csvEscape).join(","))
      .join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `elf-calculator-puzzle-${selectedPuzzle.id}-leaderboard.csv`;
    a.click();
    URL.revokeObjectURL(url);

    setActionError(null);
    setActionMessage(
      `Exported ${rows.length} performance record${rows.length === 1 ? "" : "s"} for Puzzle #${selectedPuzzle.id} as CSV.`
    );
  };

  return (
    <div className="space-y-6">
      {/* Header + Auth Bar */}
      <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 lg:flex-row lg:items-end lg:justify-between dark:border-slate-800">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl dark:text-slate-100">
            Global Puzzle Leaderboard
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Top workshop solvers ranked by fewest instructions used for each of the 1,000 puzzles.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {!authReady ? (
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Checking session...
            </span>
          ) : !user ? (
            <button
              type="button"
              disabled={authLoading}
              onClick={handleSignIn}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white whitespace-nowrap shrink-0"
            >
              <LogIn className="h-3.5 w-3.5" />
              {authLoading ? "Signing in..." : "Sign in with Google to Compete"}
            </button>
          ) : (
            <>
              <input
                type="text"
                maxLength={60}
                value={handleInput}
                onChange={(e) => setHandleInput(e.target.value)}
                aria-label="Public leaderboard handle"
                placeholder="Public handle"
                className="w-40 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-emerald-700 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-emerald-500"
              />
              <button
                type="button"
                disabled={syncing || localSolvedList.length === 0}
                onClick={handleSyncAllSolved}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-emerald-800 disabled:opacity-45 dark:bg-emerald-600 dark:hover:bg-emerald-500 whitespace-nowrap shrink-0"
              >
                <UploadCloud className="h-3.5 w-3.5" />
                {syncing
                  ? "Syncing..."
                  : `Sync My Solves (${localSolvedList.length})`}
              </button>
              <button
                type="button"
                onClick={handleSignOut}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 whitespace-nowrap shrink-0"
              >
                <LogOut className="h-3.5 w-3.5" />
                Sign Out
              </button>
            </>
          )}
        </div>
      </div>

      {actionMessage && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2.5 text-xs font-medium text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-400" />
          <span>{actionMessage}</span>
        </div>
      )}

      {actionError && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-900 dark:border-red-800/80 dark:bg-red-950/50 dark:text-red-200">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{actionError}</span>
        </div>
      )}

      {/* Main Split: Per-Puzzle Top Solvers (7 cols) + Overall Standings (5 cols) */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-start">
        {/* Left: Per-Puzzle Top Solvers */}
        <section className="rounded-xl border border-slate-200 bg-white lg:col-span-7 dark:border-slate-800 dark:bg-slate-900">
          {/* Puzzle Selector Toolbar */}
          <div className="flex flex-col gap-3 border-b border-slate-200 p-5 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                <span className="font-mono font-semibold text-slate-900 tabular-nums dark:text-slate-100">
                  Puzzle #{selectedPuzzle.id}
                </span>
                <span aria-hidden="true">·</span>
                <span>{selectedPuzzle.station}</span>
                <span aria-hidden="true">·</span>
                <span className="tabular-nums">Par {selectedPuzzle.parSteps} steps</span>
              </div>
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                {selectedPuzzle.title}
              </h2>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 shrink-0">
              <button
                type="button"
                disabled={selectedPuzzleId <= 1}
                onClick={() => selectPuzzleForBoard(selectedPuzzleId - 1)}
                className="inline-flex items-center rounded-lg border border-slate-300 bg-white p-2 text-slate-700 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                title="Previous puzzle"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <form onSubmit={handleJumpPuzzle} className="flex items-center gap-1.5">
                <input
                  type="number"
                  min={1}
                  max={TOTAL_PUZZLES}
                  value={jumpInput}
                  onChange={(e) => setJumpInput(e.target.value)}
                  aria-label="Puzzle number"
                  className="w-20 rounded-lg border border-slate-300 bg-slate-50 px-2.5 py-1.5 font-mono text-xs text-slate-900 focus:border-emerald-700 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-emerald-500 dark:focus:bg-slate-900"
                />
                <button
                  type="submit"
                  className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 whitespace-nowrap shrink-0"
                >
                  View
                </button>
              </form>
              <button
                type="button"
                disabled={selectedPuzzleId >= TOTAL_PUZZLES}
                onClick={() => selectPuzzleForBoard(selectedPuzzleId + 1)}
                className="inline-flex items-center rounded-lg border border-slate-300 bg-white p-2 text-slate-700 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                title="Next puzzle"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => selectPuzzleForBoard(dailyChallengeId)}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 whitespace-nowrap shrink-0"
              >
                <Calendar className="h-3.5 w-3.5 text-emerald-700 dark:text-emerald-400" />
                Daily
              </button>
            </div>
          </div>

          {/* Community Average & Personal Efficiency Strip */}
          <div className="grid grid-cols-2 divide-y divide-slate-100 border-b border-slate-200 bg-slate-50/70 sm:grid-cols-4 sm:divide-x sm:divide-y-0 dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-950/60">
            <div className="px-5 py-3">
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                Community Average
              </div>
              <div className="mt-0.5 font-mono text-sm font-semibold text-slate-900 tabular-nums dark:text-slate-100">
                {puzzleMetrics.averageSteps !== null
                  ? `${puzzleMetrics.averageSteps.toFixed(1)} steps`
                  : "—"}
              </div>
              <div className="text-[11px] text-slate-500 tabular-nums dark:text-slate-400">
                {puzzleMetrics.solverCount} solver{puzzleMetrics.solverCount === 1 ? "" : "s"}
              </div>
            </div>

            <div className="px-5 py-3">
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                Best Record
              </div>
              <div className="mt-0.5 font-mono text-sm font-semibold text-emerald-700 tabular-nums dark:text-emerald-400">
                {puzzleMetrics.bestSteps !== null
                  ? `${puzzleMetrics.bestSteps} steps`
                  : "—"}
              </div>
              <div className="text-[11px] text-slate-500 tabular-nums dark:text-slate-400">
                Par {selectedPuzzle.parSteps} steps
              </div>
            </div>

            <div className="px-5 py-3">
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                Your Best
              </div>
              <div className="mt-0.5 font-mono text-sm font-semibold text-slate-900 tabular-nums dark:text-slate-100">
                {userComparisonSteps !== null ? `${userComparisonSteps} steps` : "Unsolved"}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                {localSolvedForPuzzle ? "Verified locally" : "Not solved yet"}
              </div>
            </div>

            <div className="px-5 py-3">
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                vs Community Avg
              </div>
              <div
                className={`mt-0.5 font-mono text-sm font-semibold tabular-nums ${
                  userComparisonSteps !== null &&
                  puzzleMetrics.averageSteps !== null &&
                  userComparisonSteps <= puzzleMetrics.averageSteps
                    ? "text-emerald-700 dark:text-emerald-400"
                    : "text-slate-900 dark:text-slate-100"
                }`}
              >
                {userComparisonSteps === null || puzzleMetrics.averageSteps === null
                  ? "—"
                  : (() => {
                      const diff = userComparisonSteps - puzzleMetrics.averageSteps;
                      if (Math.abs(diff) < 0.05) return "On average";
                      return diff < 0
                        ? `${Math.abs(diff).toFixed(1)} fewer`
                        : `+${diff.toFixed(1)} more`;
                    })()}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                {userComparisonSteps === null || puzzleMetrics.averageSteps === null
                  ? "Solve to compare"
                  : userComparisonSteps < puzzleMetrics.averageSteps - 0.05
                    ? "More efficient than avg"
                    : userComparisonSteps > puzzleMetrics.averageSteps + 0.05
                      ? "Room to shorten"
                      : "Matches community avg"}
              </div>
            </div>
          </div>

          {/* Your Personal Status Action Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50 px-5 py-2.5 text-xs dark:border-slate-800 dark:bg-slate-800/40">
            <div className="text-slate-600 dark:text-slate-400">
              {localSolvedForPuzzle ? (
                <span>
                  Local program recorded at{" "}
                  <strong className="font-mono text-slate-900 tabular-nums dark:text-slate-100">
                    {localSolvedForPuzzle.bestSteps} instruction
                    {localSolvedForPuzzle.bestSteps === 1 ? "" : "s"}
                  </strong>
                  .
                </span>
              ) : (
                <span>Solve Puzzle #{selectedPuzzleId} in the Workbench to publish a score.</span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {user && localSolvedForPuzzle && (
                <button
                  type="button"
                  disabled={syncing}
                  onClick={handleSubmitSingle}
                  className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-45 dark:border-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 dark:hover:bg-emerald-900/60 whitespace-nowrap shrink-0"
                >
                  Publish Score
                </button>
              )}
              <button
                type="button"
                disabled={puzzleEntries.length === 0 && !localSolvedForPuzzle}
                onClick={handleExportPuzzleCsv}
                className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 font-medium text-slate-800 hover:bg-slate-100 disabled:opacity-45 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 whitespace-nowrap shrink-0"
              >
                <Download className="h-3 w-3" />
                Export CSV
              </button>
              <button
                type="button"
                onClick={() => onSelectPuzzle(selectedPuzzleId)}
                className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 font-medium text-slate-800 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 whitespace-nowrap shrink-0"
              >
                Open in Workbench
                <ArrowRight className="h-3 w-3" />
              </button>
            </div>
          </div>

          {/* Per-Puzzle Ranked Table */}
          {puzzleError ? (
            <div className="p-5 text-xs text-red-800 dark:text-red-300">
              {puzzleError}
            </div>
          ) : puzzleLoading ? (
            <div className="space-y-2 p-5">
              <div className="h-9 w-full animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
              <div className="h-9 w-full animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
              <div className="h-9 w-full animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
            </div>
          ) : puzzleEntries.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <Trophy className="mx-auto h-7 w-7 text-slate-300 dark:text-slate-600" />
              <p className="mt-2 text-sm font-medium text-slate-800 dark:text-slate-200">
                No scores published for Puzzle #{selectedPuzzleId} yet
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Solve this puzzle in the Workbench and sign in with Google to claim Rank #1.
              </p>
              <button
                type="button"
                onClick={() => onSelectPuzzle(selectedPuzzleId)}
                className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white whitespace-nowrap shrink-0"
              >
                Solve Puzzle #{selectedPuzzleId}
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-300">
                    <th className="px-5 py-3 font-semibold">Rank</th>
                    <th className="px-4 py-3 font-semibold">Solver</th>
                    <th className="px-4 py-3 text-right font-semibold">Steps</th>
                    <th className="px-4 py-3 font-semibold">Par Standing</th>
                    <th className="px-5 py-3 text-right font-semibold">Updated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {puzzleEntries.map((entry, idx) => {
                    const isSelf = user?.uid === entry.uid;
                    const delta = entry.steps - entry.parSteps;
                    const standingLabel =
                      delta < 0
                        ? `Beat Par (${delta})`
                        : delta === 0
                          ? "Matched Par"
                          : `+${delta} Over Par`;

                    return (
                      <tr
                        key={entry.id}
                        className={`h-11 ${
                          isSelf
                            ? "bg-emerald-50/50 dark:bg-emerald-950/30"
                            : "hover:bg-slate-50 dark:hover:bg-slate-800/50"
                        }`}
                      >
                        <td className="px-5 py-2 font-mono font-semibold text-slate-900 tabular-nums dark:text-slate-100">
                          #{idx + 1}
                        </td>
                        <td className="px-4 py-2 font-medium text-slate-900 dark:text-slate-100">
                          {entry.displayName}
                          {isSelf && (
                            <span className="ml-2 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                              (You)
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-right font-mono font-semibold text-slate-900 tabular-nums dark:text-slate-100">
                          {entry.steps}
                        </td>
                        <td
                          className={`px-4 py-2 font-medium tabular-nums ${
                            delta <= 0
                              ? "text-emerald-700 dark:text-emerald-400"
                              : "text-slate-600 dark:text-slate-400"
                          }`}
                        >
                          {standingLabel}
                        </td>
                        <td className="px-5 py-2 text-right font-mono text-slate-500 tabular-nums dark:text-slate-400">
                          {new Date(entry.updatedAtMs).toLocaleDateString()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Right: Overall Standings & Active Record Puzzles */}
        <div className="space-y-6 lg:col-span-5">
          <section className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Top Workshop Solvers Overall
              </h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Ranked by puzzles on the leaderboard, #1 records held, and fewest total steps.
              </p>
            </div>

            {globalError ? (
              <div className="p-5 text-xs text-red-800 dark:text-red-300">
                {globalError}
              </div>
            ) : overallStandings.length === 0 ? (
              <div className="px-5 py-8 text-center text-xs text-slate-500 dark:text-slate-400">
                No global standings recorded yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-300">
                      <th className="px-4 py-2.5 font-semibold">Rank</th>
                      <th className="px-3 py-2.5 font-semibold">Solver</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Solved</th>
                      <th className="px-3 py-2.5 text-right font-semibold">#1s</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Steps</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {overallStandings.slice(0, 15).map((row, idx) => {
                      const isSelf = user?.uid === row.uid;
                      return (
                        <tr
                          key={row.uid}
                          className={`h-10 ${
                            isSelf
                              ? "bg-emerald-50/50 dark:bg-emerald-950/30"
                              : "hover:bg-slate-50 dark:hover:bg-slate-800/50"
                          }`}
                        >
                          <td className="px-4 py-2 font-mono font-semibold text-slate-900 tabular-nums dark:text-slate-100">
                            #{idx + 1}
                          </td>
                          <td className="max-w-[140px] truncate px-3 py-2 font-medium text-slate-900 dark:text-slate-100">
                            {row.displayName}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-slate-800 tabular-nums dark:text-slate-200">
                            {row.puzzlesCount}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-emerald-700 tabular-nums dark:text-emerald-400">
                            {row.bestRankCount}
                          </td>
                          <td className="px-4 py-2 text-right font-mono text-slate-600 tabular-nums dark:text-slate-400">
                            {row.totalSteps}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {activeRecordPuzzles.length > 0 && (
            <section className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Active Puzzle Records
                </h2>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  Select a puzzle to inspect its full ranking.
                </p>
              </div>
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {activeRecordPuzzles.map((item) => (
                  <button
                    key={item.puzzleId}
                    type="button"
                    onClick={() => selectPuzzleForBoard(item.puzzleId)}
                    className={`flex w-full items-center justify-between px-5 py-2.5 text-left text-xs transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50 ${
                      item.puzzleId === selectedPuzzleId
                        ? "bg-emerald-50/40 dark:bg-emerald-950/30"
                        : ""
                    }`}
                  >
                    <div>
                      <span className="font-mono font-semibold text-slate-900 tabular-nums dark:text-slate-100">
                        Puzzle #{item.puzzleId}
                      </span>
                      <span className="ml-2 text-slate-500 dark:text-slate-400">
                        Top: {item.topSolver} · {item.solverCount} solver{item.solverCount === 1 ? "" : "s"}
                      </span>
                    </div>
                    <span className="font-mono font-semibold text-emerald-700 tabular-nums dark:text-emerald-400">
                      {item.bestSteps} steps
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>

      {/* User Difficulty Distribution Over Time (D3) */}
      <DifficultyDistributionChart
        solvedMap={solvedMap}
        globalEntries={globalEntries}
        userUid={user?.uid ?? null}
        activePuzzleId={activePuzzleId}
        theme={theme}
        onOpenWorkbench={onSelectPuzzle}
      />
    </div>
  );
};
