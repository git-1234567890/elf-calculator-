import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Play,
  Pause,
  SkipForward,
  SkipBack,
  RotateCcw,
  Wand2,
  CheckCircle2,
  Circle,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Plus,
  Trash2,
  SlidersHorizontal,
  MessageSquare,
  Save,
  History,
  HelpCircle,
  Copy,
  Check,
  Share2,
  Camera,
  FileText,
  FlaskConical,
  Zap,
  Activity,
} from "lucide-react";
import {
  SLOT_COUNT,
  Op,
  createInitialSlots,
  executeProgram,
  formatBigIntCompact,
  formatBigIntExact,
  matchTargetsInSlots,
  parseProgram,
} from "../lib/elfVm";
import { Puzzle, TOTAL_PUZZLES } from "../lib/puzzles";
import { autoSolvePuzzle } from "../lib/solver";
import {
  calculatePuzzleComplexity,
  computeExecutionProfile,
  copyTextToClipboard,
  encodeSharedPuzzleUrl,
} from "../lib/puzzleMetrics";
import { RegistrySnapshot, SolvedRecord, ThemeMode } from "../types/app";
import { RegisterUtilizationChart } from "./RegisterUtilizationChart";
import { InstructionCardModal } from "./InstructionCardModal";

interface WorkbenchViewProps {
  puzzle: Puzzle;
  isCustomPuzzle: boolean;
  program: string;
  onChangeProgram: (next: string) => void;
  stepCursor: number | null;
  onChangeStepCursor: (next: number | null) => void;
  solvedRecord?: SolvedRecord;
  practiceMode: boolean;
  onTogglePracticeMode: () => void;
  onResetPractice: () => void;
  lastAutoSavedAt?: string | null;
  theme: ThemeMode;
  onSelectPuzzleId: (id: number) => void;
  onLoadCustomPuzzle: (seeds: Record<number, bigint>, targets: bigint[]) => void;
  onExitCustomPuzzle: () => void;
  onOpenAssistantForPuzzle: () => void;
}

const STORAGE_ANIMATE_KEY = "elf_calc_animate_v1";
const STORAGE_SNAPSHOTS_KEY = "elf_calc_snapshots_v1";

function loadSavedSnapshots(): RegistrySnapshot[] {
  try {
    const raw = localStorage.getItem(STORAGE_SNAPSHOTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as RegistrySnapshot[]) : [];
  } catch {
    return [];
  }
}

export const WorkbenchView: React.FC<WorkbenchViewProps> = ({
  puzzle,
  isCustomPuzzle,
  program,
  onChangeProgram,
  stepCursor,
  onChangeStepCursor,
  solvedRecord,
  practiceMode,
  onTogglePracticeMode,
  onResetPractice,
  lastAutoSavedAt,
  theme,
  onSelectPuzzleId,
  onLoadCustomPuzzle,
  onExitCustomPuzzle,
  onOpenAssistantForPuzzle,
}) => {
  // Quick instruction builder state
  const [builderDst, setBuilderDst] = useState<number>(1);
  const [builderSrcA, setBuilderSrcA] = useState<number>(0);
  const [builderOp, setBuilderOp] = useState<Op>("+");
  const [builderSrcB, setBuilderSrcB] = useState<number>(0);
  const [builderTargetField, setBuilderTargetField] = useState<
    "dst" | "srcA" | "srcB"
  >("dst");

  // Custom puzzle editor state
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [customSeedsInput, setCustomSeedsInput] = useState("1");
  const [customTargetsInput, setCustomTargetsInput] = useState("15, 45");
  const [customFormError, setCustomFormError] = useState<string | null>(null);
  const [solveNote, setSolveNote] = useState<string | null>(null);
  const [focusedSlot, setFocusedSlot] = useState<number>(0);
  const [showHistory, setShowHistory] = useState<boolean>(false);
  const [showShortcuts, setShowShortcuts] = useState<boolean>(false);
  const [animateExecution, setAnimateExecution] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_ANIMATE_KEY);
      if (saved === "false") return false;
    } catch {
      // Ignore storage access errors
    }
    return true;
  });
  const [isAnimating, setIsAnimating] = useState<boolean>(false);
  const [snapshots, setSnapshots] = useState<RegistrySnapshot[]>(
    loadSavedSnapshots
  );
  const [showSnapshots, setShowSnapshots] = useState<boolean>(false);
  const [inspectedSnapshotId, setInspectedSnapshotId] = useState<string | null>(
    null
  );
  const [copiedProgram, setCopiedProgram] = useState<boolean>(false);
  const [sharedUrlNotice, setSharedUrlNotice] = useState<string | null>(null);
  const [showInstructionCard, setShowInstructionCard] =
    useState<boolean>(false);

  const gridRef = useRef<HTMLDivElement | null>(null);
  const slotRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const shortcutsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_ANIMATE_KEY, String(animateExecution));
    } catch {
      // Ignore storage quota errors
    }
  }, [animateExecution]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_SNAPSHOTS_KEY, JSON.stringify(snapshots));
    } catch {
      // Ignore storage quota errors
    }
  }, [snapshots]);

  const initialSlots = useMemo(
    () => createInitialSlots(puzzle.seeds),
    [puzzle.seeds]
  );

  const parsed = useMemo(() => parseProgram(program), [program]);

  const execution = useMemo(
    () => executeProgram(initialSlots, parsed.instructions, puzzle.targets),
    [initialSlots, parsed.instructions, puzzle.targets]
  );

  const executionProfile = useMemo(
    () => computeExecutionProfile(parsed.instructions, puzzle.seeds),
    [parsed.instructions, puzzle.seeds]
  );

  const puzzleComplexity = useMemo(
    () => calculatePuzzleComplexity(puzzle),
    [puzzle]
  );

  // Active step shown in the 48-slot memory grid
  const maxStepIndex = execution.steps.length - 1;
  const activeStepIndex =
    stepCursor === null
      ? maxStepIndex
      : Math.max(0, Math.min(maxStepIndex, stepCursor));

  const activeStep = execution.steps[activeStepIndex] ?? execution.steps[0];
  const displayedSlots = activeStep.slots;
  const displayedMatchedIndices = useMemo(
    () => matchTargetsInSlots(displayedSlots, puzzle.targets),
    [displayedSlots, puzzle.targets]
  );

  const targetValueSet = useMemo(() => {
    const set = new Set<bigint>();
    for (const t of puzzle.targets) set.add(t);
    return set;
  }, [puzzle.targets]);

  // Step-by-step animated execution loop
  useEffect(() => {
    if (!isAnimating) return;
    if (maxStepIndex <= 0) {
      setIsAnimating(false);
      onChangeStepCursor(null);
      return;
    }

    const prefersReducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (prefersReducedMotion || !animateExecution) {
      setIsAnimating(false);
      onChangeStepCursor(null);
      return;
    }

    const timer = window.setInterval(() => {
      const curr = stepCursor === null ? 0 : stepCursor;
      if (curr >= maxStepIndex) {
        setIsAnimating(false);
        onChangeStepCursor(null);
      } else {
        onChangeStepCursor(curr + 1);
      }
    }, 220);

    return () => window.clearInterval(timer);
  }, [isAnimating, animateExecution, maxStepIndex, stepCursor, onChangeStepCursor]);

  const handleRunAll = useCallback(() => {
    if (isAnimating) {
      setIsAnimating(false);
      setSolveNote("Paused animated execution.");
      return;
    }

    const prefersReducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (animateExecution && !prefersReducedMotion && maxStepIndex > 0) {
      onChangeStepCursor(0);
      setIsAnimating(true);
      setSolveNote(
        `Animating ${parsed.instructions.length} instruction${parsed.instructions.length === 1 ? "" : "s"}...`
      );
    } else {
      onChangeStepCursor(null);
      setSolveNote(
        `Executed program (${parsed.instructions.length} instruction${parsed.instructions.length === 1 ? "" : "s"}).`
      );
    }
  }, [
    isAnimating,
    animateExecution,
    maxStepIndex,
    onChangeStepCursor,
    parsed.instructions.length,
  ]);

  const handleSaveAndExportDraft = useCallback(() => {
    const label = isCustomPuzzle ? "custom" : `puzzle-${puzzle.id}`;
    const seedsHeader = Object.entries(puzzle.seeds)
      .map(([k, v]) => `R${k}=${formatBigIntExact(v)}`)
      .join(", ");
    const targetsHeader = puzzle.targets
      .map((t) => formatBigIntExact(t))
      .join(", ");
    const content = [
      `# Elf Calculator Draft — ${puzzle.title}`,
      `# Seeds: ${seedsHeader}`,
      `# Targets: [${targetsHeader}]`,
      `# Par: ${puzzle.parSteps}`,
      "",
      program.trimEnd(),
      "",
    ].join("\n");

    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `elf-${label}-draft.txt`;
    a.click();
    URL.revokeObjectURL(url);

    setSolveNote(`Saved and exported draft (elf-${label}-draft.txt).`);
  }, [isCustomPuzzle, program, puzzle]);

  const handleCopyProgram = async () => {
    const ok = await copyTextToClipboard(program);
    if (ok) {
      setCopiedProgram(true);
      setSolveNote("Copied 48-slot program to clipboard.");
      window.setTimeout(() => setCopiedProgram(false), 2200);
    } else {
      setSolveNote("Clipboard access unavailable in this browser frame.");
    }
  };

  const handleSharePuzzle = async () => {
    const shareUrl = encodeSharedPuzzleUrl(puzzle, program);
    const ok = await copyTextToClipboard(shareUrl);
    setSharedUrlNotice(
      ok
        ? `Shareable puzzle URL copied to clipboard (${shareUrl.length} chars).`
        : shareUrl
    );
    window.setTimeout(() => setSharedUrlNotice(null), 5000);
  };

  const puzzleSnapshots = useMemo(
    () => snapshots.filter((s) => s.puzzleId === puzzle.id),
    [snapshots, puzzle.id]
  );

  const handleTakeSnapshot = () => {
    const snap: RegistrySnapshot = {
      id: `snap-${puzzle.id}-${Date.now()}`,
      label: `Snapshot #${puzzleSnapshots.length + 1} (Step ${activeStepIndex})`,
      puzzleId: puzzle.id,
      program,
      slots: displayedSlots.slice(0, SLOT_COUNT).map((v) => formatBigIntExact(v)),
      stepCount: parsed.instructions.length,
      createdAt: new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
    };
    setSnapshots((prev) => [snap, ...prev].slice(0, 30));
    setShowSnapshots(true);
    setInspectedSnapshotId(snap.id);
    setSolveNote(`Captured 48-slot registry state (${snap.label}).`);
  };

  const handleStepForward = () => {
    setIsAnimating(false);
    setSolveNote(null);
    if (stepCursor === null) {
      onChangeStepCursor(Math.min(1, maxStepIndex));
    } else {
      onChangeStepCursor(Math.min(maxStepIndex, stepCursor + 1));
    }
  };

  const handleStepBack = () => {
    setIsAnimating(false);
    setSolveNote(null);
    const curr = stepCursor === null ? maxStepIndex : stepCursor;
    onChangeStepCursor(Math.max(0, curr - 1));
  };

  const handleResetExecution = () => {
    setIsAnimating(false);
    setSolveNote(null);
    onChangeStepCursor(0);
  };

  const handleAutoSolve = () => {
    setIsAnimating(false);
    const result = autoSolvePuzzle(puzzle);
    onChangeProgram(result.program);
    onChangeStepCursor(null);
    setSolveNote(`Loaded ${result.steps}-instruction solution via ${result.method}.`);
  };

  const handleAppendInstruction = () => {
    setIsAnimating(false);
    const line = `R${builderDst} = R${builderSrcA} ${builderOp} R${builderSrcB}`;
    const trimmed = program.trimEnd();
    onChangeProgram(trimmed ? `${trimmed}\n${line}` : line);
    onChangeStepCursor(null);
    setSolveNote(null);
  };

  // Global keyboard shortcuts for Workbench
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;

      // Ctrl+Enter / Cmd+Enter -> Run program
      if (mod && e.key === "Enter") {
        e.preventDefault();
        handleRunAll();
        return;
      }

      // Ctrl+S / Cmd+S -> Save & export draft
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        handleSaveAndExportDraft();
        return;
      }

      // Arrow keys -> Navigate between 48 register slots when not editing text/selects
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const isTextControl =
        tag === "TEXTAREA" ||
        tag === "INPUT" ||
        tag === "SELECT" ||
        Boolean(target?.isContentEditable);

      if (
        !isTextControl &&
        !mod &&
        !e.altKey &&
        (e.key === "ArrowLeft" ||
          e.key === "ArrowRight" ||
          e.key === "ArrowUp" ||
          e.key === "ArrowDown")
      ) {
        e.preventDefault();

        let cols = 8;
        if (gridRef.current) {
          const template = window.getComputedStyle(gridRef.current).gridTemplateColumns;
          const count = template ? template.split(" ").filter(Boolean).length : 8;
          if (count > 0) cols = count;
        }

        setFocusedSlot((prev) => {
          let next = prev;
          if (e.key === "ArrowRight") next = Math.min(SLOT_COUNT - 1, prev + 1);
          else if (e.key === "ArrowLeft") next = Math.max(0, prev - 1);
          else if (e.key === "ArrowDown") next = Math.min(SLOT_COUNT - 1, prev + cols);
          else if (e.key === "ArrowUp") next = Math.max(0, prev - cols);

          window.requestAnimationFrame(() => {
            slotRefs.current[next]?.focus();
          });
          return next;
        });
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleRunAll, handleSaveAndExportDraft]);

  // Dismiss shortcuts popover on Escape or outside click
  useEffect(() => {
    if (!showShortcuts) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (
        shortcutsRef.current &&
        !shortcutsRef.current.contains(e.target as Node)
      ) {
        setShowShortcuts(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowShortcuts(false);
    };
    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleEsc);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleEsc);
    };
  }, [showShortcuts]);

  const handleSlotClick = (slotIdx: number) => {
    if (builderTargetField === "dst") {
      setBuilderDst(slotIdx);
      setBuilderTargetField("srcA");
    } else if (builderTargetField === "srcA") {
      setBuilderSrcA(slotIdx);
      setBuilderTargetField("srcB");
    } else {
      setBuilderSrcB(slotIdx);
      setBuilderTargetField("dst");
    }
  };

  const handleCreateCustomPuzzle = (e: React.FormEvent) => {
    e.preventDefault();
    setCustomFormError(null);
    try {
      const seedParts = customSeedsInput
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const targetParts = customTargetsInput
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      if (seedParts.length === 0 || seedParts.length > 16) {
        setCustomFormError("Enter between 1 and 16 starting values.");
        return;
      }
      if (targetParts.length === 0 || targetParts.length > 12) {
        setCustomFormError("Enter between 1 and 12 target values.");
        return;
      }

      const seeds: Record<number, bigint> = {};
      seedParts.forEach((raw, idx) => {
        seeds[idx] = BigInt(raw);
      });
      const targets = targetParts.map((raw) => BigInt(raw));
      onLoadCustomPuzzle(seeds, targets);
      setShowCustomForm(false);
    } catch {
      setCustomFormError("All starting and target numbers must be valid integers.");
    }
  };

  const instructionCount = parsed.instructions.length;
  const hasSyntaxErrors = parsed.errors.length > 0;
  const hasRuntimeError = execution.error !== null;
  const isSolvedAtEnd = !hasSyntaxErrors && execution.isSolved;
  const seedSummary = Object.entries(puzzle.seeds)
    .map(([slot, val]) => `R${slot}=${formatBigIntExact(val)}`)
    .join(", ");

  return (
    <>
    <div className="no-print space-y-6">
      {/* Puzzle Header & Unboxed Metadata Strip */}
      <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 lg:flex-row lg:items-end lg:justify-between dark:border-slate-800">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span>{isCustomPuzzle ? "Custom Station" : `Puzzle #${puzzle.id} of ${TOTAL_PUZZLES}`}</span>
            <span aria-hidden="true">·</span>
            <span>{puzzle.station}</span>
            <span aria-hidden="true">·</span>
            <span>{puzzle.difficulty}</span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">Par {puzzle.parSteps} instructions</span>
            {solvedRecord && !isCustomPuzzle && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-medium text-emerald-700 tabular-nums dark:text-emerald-400">
                  Best recorded: {solvedRecord.bestSteps} instructions
                </span>
              </>
            )}
            {practiceMode && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-semibold text-amber-700 dark:text-amber-400">
                  Practice Mode (Score Protected)
                </span>
              </>
            )}
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl dark:text-slate-100">
            {puzzle.title}
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Initial slots:{" "}
            <span className="font-mono text-slate-900 dark:text-slate-100">
              {seedSummary}
            </span>{" "}
            <span className="text-slate-400 dark:text-slate-500">
              (remaining slots start at 0)
            </span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {isCustomPuzzle ? (
            <button
              type="button"
              onClick={onExitCustomPuzzle}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 whitespace-nowrap shrink-0"
            >
              Return to Puzzle #1
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => onSelectPuzzleId(Math.max(1, puzzle.id - 1))}
                disabled={puzzle.id <= 1}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 whitespace-nowrap shrink-0"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Previous
              </button>
              <button
                type="button"
                onClick={() =>
                  onSelectPuzzleId(Math.min(TOTAL_PUZZLES, puzzle.id + 1))
                }
                disabled={puzzle.id >= TOTAL_PUZZLES}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 whitespace-nowrap shrink-0"
              >
                Next
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </>
          )}

          <button
            type="button"
            aria-pressed={practiceMode}
            onClick={onTogglePracticeMode}
            title="Experiment & reset progress without changing your Best Score or Attempt History"
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              practiceMode
                ? "border-amber-400 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950/60 dark:text-amber-200"
                : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            }`}
          >
            <FlaskConical className="h-3.5 w-3.5" />
            Practice Mode
          </button>

          <button
            type="button"
            onClick={() => setShowCustomForm((prev) => !prev)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 whitespace-nowrap shrink-0"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Custom Puzzle
          </button>

          <button
            type="button"
            onClick={handleSharePuzzle}
            title="Generate shareable URL encoding seeds & targets"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 whitespace-nowrap shrink-0"
          >
            <Share2 className="h-3.5 w-3.5" />
            Share Puzzle
          </button>

          <button
            type="button"
            onClick={() => setShowInstructionCard(true)}
            title="Preview & export printable PDF Workshop Instruction Card"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 whitespace-nowrap shrink-0"
          >
            <FileText className="h-3.5 w-3.5" />
            Instruction Card
          </button>

          <button
            type="button"
            onClick={onOpenAssistantForPuzzle}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-emerald-800 dark:bg-emerald-600 dark:hover:bg-emerald-500 whitespace-nowrap shrink-0"
          >
            <MessageSquare className="h-3.5 w-3.5" />
            Ask Assistant
          </button>
        </div>
      </div>

      {practiceMode && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50/80 px-4 py-2.5 text-xs text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          <span>
            <strong>Practice Mode active:</strong> Edits and resets happen in an isolated scratch buffer and will not alter your recorded Best Score or Version History.
          </span>
          <button
            type="button"
            onClick={() => {
              onResetPractice();
              setSolveNote("Reset practice buffer without modifying Best Score or history.");
            }}
            className="inline-flex items-center gap-1 rounded-md border border-amber-400 bg-white px-2.5 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100 dark:border-amber-700 dark:bg-slate-900 dark:text-amber-200 dark:hover:bg-amber-950 whitespace-nowrap shrink-0"
          >
            <RotateCcw className="h-3 w-3" />
            Reset Practice
          </button>
        </div>
      )}

      {sharedUrlNotice && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">
          <span className="break-all font-mono">{sharedUrlNotice}</span>
          <button
            type="button"
            onClick={() => setSharedUrlNotice(null)}
            className="text-xs font-medium underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Optional Custom Puzzle Builder Drawer */}
      {showCustomForm && (
        <form
          onSubmit={handleCreateCustomPuzzle}
          className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
        >
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Define Custom Station Targets
            </h2>
            <button
              type="button"
              onClick={() => setShowCustomForm(false)}
              className="text-xs text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
            >
              Close
            </button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Starting Slots (R0, R1, ... comma-separated integers)
              </span>
              <input
                type="text"
                value={customSeedsInput}
                onChange={(e) => setCustomSeedsInput(e.target.value)}
                placeholder="e.g. 1, 3"
                className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 font-mono text-sm text-slate-900 focus:border-emerald-700 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-emerald-500 dark:focus:bg-slate-900"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Target Numbers (comma-separated integers)
              </span>
              <input
                type="text"
                value={customTargetsInput}
                onChange={(e) => setCustomTargetsInput(e.target.value)}
                placeholder="e.g. 15, 45, 135"
                className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 font-mono text-sm text-slate-900 focus:border-emerald-700 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-emerald-500 dark:focus:bg-slate-900"
              />
            </label>
          </div>
          {customFormError && (
            <p className="mt-2 text-xs text-red-700 dark:text-red-400">
              {customFormError}
            </p>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="submit"
              className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white whitespace-nowrap shrink-0"
            >
              Load Custom Puzzle
            </button>
          </div>
        </form>
      )}

      {/* Two-Zone Interactive Workbench */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-stretch">
        {/* Left Zone (60% / 7 cols): Targets + 48-Slot Calculator Memory */}
        <section className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-5 lg:col-span-7 dark:border-slate-800 dark:bg-slate-900">
          <div className="space-y-5">
            {/* Target List */}
            <div>
              <div className="mb-2.5 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Required Station Numbers
                </h2>
                <span className="text-xs text-slate-500 tabular-nums dark:text-slate-400">
                  {displayedMatchedIndices.length} of {puzzle.targets.length} matched at step{" "}
                  {activeStepIndex}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {puzzle.targets.map((targetVal, idx) => {
                  const matched = displayedMatchedIndices.includes(idx);
                  return (
                    <div
                      key={`${idx}-${targetVal.toString()}`}
                      className={`flex items-center justify-between rounded-lg border px-3 py-2 ${
                        matched
                          ? "border-emerald-300 bg-emerald-50/70 text-emerald-950 dark:border-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-100"
                          : "border-slate-200 bg-slate-50 text-slate-800 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200"
                      }`}
                    >
                      <span
                        className="font-mono text-sm font-semibold tabular-nums truncate"
                        title={formatBigIntExact(targetVal)}
                      >
                        {formatBigIntCompact(targetVal)}
                      </span>
                      <span
                        className={`inline-flex items-center gap-1 text-[11px] font-medium shrink-0 ${
                          matched
                            ? "text-emerald-700 dark:text-emerald-400"
                            : "text-slate-500 dark:text-slate-400"
                        }`}
                      >
                        {matched ? (
                          <>
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Matched
                          </>
                        ) : (
                          <>
                            <Circle className="h-3.5 w-3.5" />
                            Pending
                          </>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 48-Slot Storage Grid */}
            <div>
              <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    48-Slot Calculator Memory (R0–R47)
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Click any slot to assign{" "}
                    <span className="font-mono font-medium text-slate-800 dark:text-slate-200">
                      {builderTargetField}
                    </span>{" "}
                    in the instruction builder.
                  </p>
                </div>
                <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                  <span>Step {activeStepIndex} / {maxStepIndex}</span>
                  {activeStep.instruction && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono text-slate-800 dark:text-slate-200">
                        {activeStep.instruction.raw}
                      </span>
                    </>
                  )}
                </div>
              </div>

              <div
                ref={gridRef}
                role="grid"
                aria-label="48-slot calculator registers"
                className="grid grid-cols-4 gap-1.5 sm:grid-cols-6 xl:grid-cols-8"
              >
                {displayedSlots.slice(0, SLOT_COUNT).map((val, idx) => {
                  const isSeed = puzzle.seeds[idx] !== undefined;
                  const isChanged = activeStep.changedSlot === idx;
                  const isTargetMatch = targetValueSet.has(val) && (val !== 0n || puzzle.targets.includes(0n));
                  const isNonZero = val !== 0n;
                  const isFocused = focusedSlot === idx;

                  let cellClass =
                    "border-slate-200 bg-slate-50/70 text-slate-500 hover:border-slate-400 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-400 dark:hover:border-slate-600";
                  if (isTargetMatch) {
                    cellClass =
                      "border-emerald-400 bg-emerald-50 text-emerald-950 hover:border-emerald-500 dark:border-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-100 dark:hover:border-emerald-500";
                  } else if (isChanged) {
                    cellClass =
                      "border-amber-400 bg-amber-50 text-slate-900 hover:border-amber-500 dark:border-amber-700 dark:bg-amber-950/60 dark:text-amber-100 dark:hover:border-amber-500";
                  } else if (isNonZero || isSeed) {
                    cellClass =
                      "border-slate-300 bg-white text-slate-900 hover:border-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:border-slate-500";
                  }

                  return (
                    <button
                      key={idx}
                      ref={(el) => {
                        slotRefs.current[idx] = el;
                      }}
                      type="button"
                      onClick={() => {
                        setFocusedSlot(idx);
                        handleSlotClick(idx);
                      }}
                      onFocus={() => setFocusedSlot(idx)}
                      title={`R${idx}: ${formatBigIntExact(val)}${isSeed ? " (Initial seed)" : ""}${isTargetMatch ? " (Target match)" : ""}`}
                      className={`flex flex-col items-start justify-between rounded-md border px-2 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 dark:focus-visible:ring-emerald-400 ${cellClass} ${
                        isFocused ? "ring-1 ring-slate-400 dark:ring-slate-500" : ""
                      }`}
                    >
                      <div className="flex w-full items-center justify-between text-[10px] font-mono">
                        <span className="font-semibold text-slate-500 dark:text-slate-400">
                          R{idx}
                        </span>
                        {isTargetMatch ? (
                          <span className="font-sans font-semibold text-emerald-700 dark:text-emerald-400">
                            HIT
                          </span>
                        ) : isChanged ? (
                          <span className="font-sans font-semibold text-amber-700 dark:text-amber-400">
                            SET
                          </span>
                        ) : isSeed ? (
                          <span className="font-sans text-slate-400 dark:text-slate-500">
                            IN
                          </span>
                        ) : null}
                      </div>
                      <span className="mt-0.5 w-full truncate font-mono text-xs font-medium tabular-nums">
                        {formatBigIntCompact(val)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* D3 Register Utilization Bar Chart */}
            <RegisterUtilizationChart
              seeds={puzzle.seeds}
              instructions={parsed.instructions}
              theme={theme}
            />
          </div>

          {/* Bottom Guidance Note & Keyboard Shortcuts Help Trigger */}
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
            <span>Workshop note: {puzzle.hint}</span>

            <div className="flex items-center gap-3 shrink-0">
              <span className="font-mono text-[11px] text-slate-400 tabular-nums dark:text-slate-500">
                {lastAutoSavedAt ? `Auto-saved ${lastAutoSavedAt}` : "Auto-save 30s"}
              </span>
              <div ref={shortcutsRef} className="relative shrink-0">
                <button
                  type="button"
                  aria-label="Keyboard shortcuts"
                  aria-expanded={showShortcuts}
                  onClick={() => setShowShortcuts((prev) => !prev)}
                  title="View active keyboard shortcuts"
                  className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    showShortcuts
                      ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-200"
                      : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:text-slate-100"
                  }`}
                >
                  <HelpCircle className="h-3.5 w-3.5" />
                  <span>Shortcuts</span>
                </button>

                {showShortcuts && (
                  <div
                    role="dialog"
                    aria-label="Workbench keyboard shortcuts"
                    className="absolute bottom-full right-0 z-20 mb-2 w-72 rounded-xl border border-slate-200 bg-white p-3.5 shadow-lg dark:border-slate-700 dark:bg-slate-900"
                  >
                    <div className="mb-2 flex items-center justify-between border-b border-slate-100 pb-1.5 dark:border-slate-800">
                      <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                        Workbench Shortcuts
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowShortcuts(false)}
                        className="text-[11px] text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                      >
                        Close
                      </button>
                    </div>
                    <dl className="space-y-2 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <dt className="text-slate-600 dark:text-slate-400">
                          Run program
                        </dt>
                        <dd className="font-mono text-[11px] font-medium text-slate-900 dark:text-slate-100">
                          Ctrl + Enter
                        </dd>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <dt className="text-slate-600 dark:text-slate-400">
                          Save &amp; export draft
                        </dt>
                        <dd className="font-mono text-[11px] font-medium text-slate-900 dark:text-slate-100">
                          Ctrl + S
                        </dd>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <dt className="text-slate-600 dark:text-slate-400">
                          Navigate registers
                        </dt>
                        <dd className="font-mono text-[11px] font-medium text-slate-900 dark:text-slate-100">
                          Arrow Keys
                        </dd>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <dt className="text-slate-600 dark:text-slate-400">
                          Assign focused slot
                        </dt>
                        <dd className="font-mono text-[11px] font-medium text-slate-900 dark:text-slate-100">
                          Enter / Space
                        </dd>
                      </div>
                    </dl>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Right Zone (40% / 5 cols): Program Editor & Execution Deck */}
        <section className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-5 lg:col-span-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="space-y-4">
            {/* Transport, Animation Toggle & Auto-Solve Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleRunAll}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white whitespace-nowrap shrink-0"
                >
                  {isAnimating ? (
                    <>
                      <Pause className="h-3.5 w-3.5" />
                      Pause
                    </>
                  ) : (
                    <>
                      <Play className="h-3.5 w-3.5" />
                      Run
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={handleStepBack}
                  disabled={activeStepIndex <= 0}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 whitespace-nowrap shrink-0"
                >
                  <SkipBack className="h-3.5 w-3.5" />
                  Back
                </button>
                <button
                  type="button"
                  onClick={handleStepForward}
                  disabled={activeStepIndex >= maxStepIndex}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 whitespace-nowrap shrink-0"
                >
                  <SkipForward className="h-3.5 w-3.5" />
                  Step
                </button>
                <button
                  type="button"
                  onClick={handleResetExecution}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 whitespace-nowrap shrink-0"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Reset
                </button>
                <button
                  type="button"
                  aria-pressed={animateExecution}
                  onClick={() => {
                    setIsAnimating(false);
                    setAnimateExecution((prev) => !prev);
                  }}
                  title={
                    animateExecution
                      ? "Animated step-by-step run enabled (click for instant simulation)"
                      : "Instant simulation enabled (click to animate steps)"
                  }
                  className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    animateExecution
                      ? "border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-700 dark:bg-sky-950/60 dark:text-sky-300"
                      : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                  }`}
                >
                  <Zap className="h-3.5 w-3.5" />
                  {animateExecution ? "Animate: On" : "Instant"}
                </button>
              </div>

              <button
                type="button"
                onClick={handleAutoSolve}
                className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800 transition-colors hover:bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 dark:hover:bg-emerald-900/60 whitespace-nowrap shrink-0"
              >
                <Wand2 className="h-3.5 w-3.5" />
                Auto-Solve
              </button>
            </div>

            {/* Quick Instruction Builder */}
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/60">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  Quick Instruction Builder
                </span>
                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                  Syntax: R[dst] = R[srcA] op R[srcB]
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <select
                  aria-label="Destination slot"
                  value={builderDst}
                  onChange={(e) => setBuilderDst(Number(e.target.value))}
                  className="rounded-md border border-slate-300 bg-white px-2 py-1.5 font-mono text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                >
                  {Array.from({ length: SLOT_COUNT }, (_, i) => (
                    <option key={i} value={i}>
                      R{i}
                    </option>
                  ))}
                </select>
                <span className="font-mono text-xs text-slate-500 dark:text-slate-400">=</span>
                <select
                  aria-label="First operand slot"
                  value={builderSrcA}
                  onChange={(e) => setBuilderSrcA(Number(e.target.value))}
                  className="rounded-md border border-slate-300 bg-white px-2 py-1.5 font-mono text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                >
                  {Array.from({ length: SLOT_COUNT }, (_, i) => (
                    <option key={i} value={i}>
                      R{i}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Arithmetic operator"
                  value={builderOp}
                  onChange={(e) => setBuilderOp(e.target.value as Op)}
                  className="rounded-md border border-slate-300 bg-white px-2 py-1.5 font-mono text-xs font-semibold text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                >
                  <option value="+">+</option>
                  <option value="-">-</option>
                  <option value="*">*</option>
                  <option value="/">/</option>
                </select>
                <select
                  aria-label="Second operand slot"
                  value={builderSrcB}
                  onChange={(e) => setBuilderSrcB(Number(e.target.value))}
                  className="rounded-md border border-slate-300 bg-white px-2 py-1.5 font-mono text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                >
                  {Array.from({ length: SLOT_COUNT }, (_, i) => (
                    <option key={i} value={i}>
                      R{i}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={handleAppendInstruction}
                  className="ml-auto inline-flex items-center gap-1 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white whitespace-nowrap shrink-0"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add
                </button>
              </div>
            </div>

            {/* Assembly Program Editor */}
            <div>
              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                <label
                  htmlFor="elf-program-editor"
                  className="text-xs font-semibold text-slate-800 dark:text-slate-200"
                >
                  Program Instructions
                </label>
                <div className="flex flex-wrap items-center gap-2.5 text-xs text-slate-500 dark:text-slate-400">
                  <span className="tabular-nums">
                    Length:{" "}
                    <strong className="text-slate-900 dark:text-slate-100">
                      {instructionCount}
                    </strong>
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="tabular-nums">Par: {puzzle.parSteps}</span>
                  <button
                    type="button"
                    onClick={handleTakeSnapshot}
                    title="Save a snapshot of the current 48-slot registry state & program"
                    className="inline-flex items-center gap-1 text-slate-600 hover:text-emerald-700 dark:text-slate-300 dark:hover:text-emerald-400 whitespace-nowrap"
                  >
                    <Camera className="h-3 w-3" />
                    Take Snapshot
                  </button>
                  {puzzleSnapshots.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowSnapshots((prev) => !prev)}
                      className={`inline-flex items-center gap-1 whitespace-nowrap ${
                        showSnapshots
                          ? "font-semibold text-emerald-700 dark:text-emerald-400"
                          : "text-slate-600 hover:text-emerald-700 dark:text-slate-300 dark:hover:text-emerald-400"
                      }`}
                    >
                      Snapshots ({puzzleSnapshots.length})
                    </button>
                  )}
                  {!isCustomPuzzle &&
                    solvedRecord?.history &&
                    solvedRecord.history.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setShowHistory((prev) => !prev)}
                        className={`inline-flex items-center gap-1 whitespace-nowrap ${
                          showHistory
                            ? "font-semibold text-emerald-700 dark:text-emerald-400"
                            : "text-slate-600 hover:text-emerald-700 dark:text-slate-300 dark:hover:text-emerald-400"
                        }`}
                      >
                        <History className="h-3 w-3" />
                        History ({solvedRecord.history.length})
                      </button>
                    )}
                  <button
                    type="button"
                    onClick={handleCopyProgram}
                    title="Copy 48-slot program to clipboard"
                    className="inline-flex items-center gap-1 text-slate-600 hover:text-emerald-700 dark:text-slate-300 dark:hover:text-emerald-400 whitespace-nowrap"
                  >
                    {copiedProgram ? (
                      <>
                        <Check className="h-3 w-3 text-emerald-700 dark:text-emerald-400" />
                        <span className="text-emerald-700 dark:text-emerald-400">
                          Copied
                        </span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3" />
                        Copy
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveAndExportDraft}
                    title="Save & export draft (Ctrl+S)"
                    className="inline-flex items-center gap-1 text-slate-600 hover:text-emerald-700 dark:text-slate-300 dark:hover:text-emerald-400 whitespace-nowrap"
                  >
                    <Save className="h-3 w-3" />
                    Save Draft
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsAnimating(false);
                      onChangeProgram("");
                      onChangeStepCursor(null);
                      setSolveNote(null);
                    }}
                    className="inline-flex items-center gap-1 text-slate-500 hover:text-red-700 dark:text-slate-400 dark:hover:text-red-400 whitespace-nowrap"
                  >
                    <Trash2 className="h-3 w-3" />
                    Clear
                  </button>
                </div>
              </div>

              <textarea
                id="elf-program-editor"
                value={program}
                onChange={(e) => {
                  setIsAnimating(false);
                  onChangeProgram(e.target.value);
                  onChangeStepCursor(null);
                  setSolveNote(null);
                }}
                spellCheck={false}
                rows={11}
                placeholder={`# Write one instruction per line:\nR1 = R0 + R0\nR2 = R1 * R1`}
                className="w-full rounded-lg border border-slate-300 bg-slate-950 p-3.5 font-mono text-xs leading-6 text-slate-100 placeholder:text-slate-500 focus:border-emerald-600 focus:outline-none dark:border-slate-700 dark:focus:border-emerald-500"
              />
            </div>

            {/* Real-Time Execution Profile Panel */}
            <div
              aria-label="Execution Profile"
              className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 dark:border-slate-800 dark:bg-slate-950/60"
            >
              <div className="mb-2.5 flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-800 dark:text-slate-200">
                  <Activity className="h-3.5 w-3.5 text-emerald-700 dark:text-emerald-400" />
                  Execution Profile
                </span>
                <span className="font-mono text-[11px] text-slate-500 tabular-nums dark:text-slate-400">
                  {executionProfile.uniqueRegistersUsed} / {SLOT_COUNT} slots active
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2.5">
                <div className="rounded-md border border-slate-200 bg-white px-2.5 py-2 dark:border-slate-800 dark:bg-slate-900">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    Operations
                  </div>
                  <div className="mt-0.5 font-mono text-sm font-semibold text-slate-900 tabular-nums dark:text-slate-100">
                    {executionProfile.totalOperations} ops
                  </div>
                  <div className="mt-0.5 font-mono text-[10px] text-slate-500 tabular-nums dark:text-slate-400">
                    +{executionProfile.opCounts["+"]} -{executionProfile.opCounts["-"]} *
                    {executionProfile.opCounts["*"]} /{executionProfile.opCounts["/"]}
                  </div>
                </div>
                <div className="rounded-md border border-slate-200 bg-white px-2.5 py-2 dark:border-slate-800 dark:bg-slate-900">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    Cycle Count
                  </div>
                  <div className="mt-0.5 font-mono text-sm font-semibold text-slate-900 tabular-nums dark:text-slate-100">
                    {executionProfile.cycleCount} cyc
                  </div>
                  <div className="mt-0.5 font-mono text-[10px] text-slate-500 tabular-nums dark:text-slate-400">
                    Critical depth: {executionProfile.criticalPathCycles}
                  </div>
                </div>
                <div className="rounded-md border border-slate-200 bg-white px-2.5 py-2 dark:border-slate-800 dark:bg-slate-900">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    Memory Bandwidth
                  </div>
                  <div className="mt-0.5 font-mono text-sm font-semibold text-slate-900 tabular-nums dark:text-slate-100">
                    {executionProfile.bytesPerCycleLabel}
                  </div>
                  <div className="mt-0.5 font-mono text-[10px] text-slate-500 tabular-nums dark:text-slate-400">
                    {executionProfile.registerReads}R / {executionProfile.registerWrites}W
                  </div>
                </div>
              </div>
            </div>

            {/* Syntax & Runtime Validation Feedback */}
            {solveNote && (
              <p className="text-xs text-emerald-800 dark:text-emerald-300">
                {solveNote}
              </p>
            )}

            {hasSyntaxErrors && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-900 dark:border-red-800/80 dark:bg-red-950/50 dark:text-red-200">
                <div className="mb-1 flex items-center gap-1.5 font-semibold">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Syntax Validation Error
                </div>
                <ul className="space-y-0.5 font-mono">
                  {parsed.errors.slice(0, 3).map((err) => (
                    <li key={err.lineNumber}>
                      Line {err.lineNumber}: {err.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {!hasSyntaxErrors && hasRuntimeError && execution.error && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-900 dark:border-red-800/80 dark:bg-red-950/50 dark:text-red-200">
                <div className="mb-1 flex items-center gap-1.5 font-semibold">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Exact Division / Runtime Halt
                </div>
                <p className="font-mono">{execution.error.message}</p>
              </div>
            )}

            {/* Version History Browser */}
            {showHistory &&
              !isCustomPuzzle &&
              solvedRecord?.history &&
              solvedRecord.history.length > 0 && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950/60">
                  <div className="flex items-center justify-between border-b border-slate-200 px-3.5 py-2.5 dark:border-slate-800">
                    <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                      Successful Attempt History ({solvedRecord.history.length})
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowHistory(false)}
                      className="text-xs text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                    >
                      Hide
                    </button>
                  </div>
                  <div className="max-h-56 divide-y divide-slate-200 overflow-y-auto dark:divide-slate-800">
                    {solvedRecord.history.map((attempt, idx) => {
                      const versionNumber = solvedRecord.history!.length - idx;
                      const isBest = attempt.steps === solvedRecord.bestSteps;
                      const isCurrent =
                        attempt.program.trim() === program.trim();
                      const formattedTime = new Date(
                        attempt.solvedAt
                      ).toLocaleString([], {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      });

                      return (
                        <div
                          key={attempt.id}
                          className="flex items-start justify-between gap-3 px-3.5 py-2.5 text-xs"
                        >
                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                              <span className="font-mono font-semibold text-slate-900 tabular-nums dark:text-slate-100">
                                v{versionNumber}
                              </span>
                              <span aria-hidden="true">·</span>
                              <span className="font-mono font-medium text-slate-800 tabular-nums dark:text-slate-200">
                                {attempt.steps} instruction
                                {attempt.steps === 1 ? "" : "s"}
                              </span>
                              {isBest && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                                    Personal Best
                                  </span>
                                </>
                              )}
                              <span aria-hidden="true">·</span>
                              <span className="tabular-nums">{formattedTime}</span>
                            </div>
                            <pre className="truncate font-mono text-[11px] text-slate-600 dark:text-slate-400">
                              {attempt.program.split(/\r?\n/).join(" ; ")}
                            </pre>
                          </div>

                          <button
                            type="button"
                            disabled={isCurrent}
                            onClick={() => {
                              onChangeProgram(attempt.program);
                              onChangeStepCursor(null);
                              setSolveNote(
                                `Reverted to v${versionNumber} (${attempt.steps} instructions).`
                              );
                            }}
                            className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-800 hover:bg-slate-100 disabled:opacity-45 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 whitespace-nowrap shrink-0"
                          >
                            {isCurrent ? "Active" : "Revert"}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            {/* Captured 48-Slot Registry Snapshots */}
            {showSnapshots && puzzleSnapshots.length > 0 && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950/60">
                <div className="flex items-center justify-between border-b border-slate-200 px-3.5 py-2.5 dark:border-slate-800">
                  <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                    Saved 48-Slot Registry Snapshots ({puzzleSnapshots.length})
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowSnapshots(false)}
                    className="text-xs text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                  >
                    Hide
                  </button>
                </div>
                <div className="max-h-60 divide-y divide-slate-200 overflow-y-auto dark:divide-slate-800">
                  {puzzleSnapshots.map((snap) => {
                    const isExpanded = inspectedSnapshotId === snap.id;
                    const nonZeroSlots = snap.slots
                      .map((val, idx) => ({ idx, val }))
                      .filter((item) => item.val !== "0");
                    return (
                      <div key={snap.id} className="space-y-2 px-3.5 py-2.5 text-xs">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                              <span className="font-semibold text-slate-900 dark:text-slate-100">
                                {snap.label}
                              </span>
                              <span aria-hidden="true">·</span>
                              <span className="font-mono tabular-nums">
                                {snap.stepCount} ops
                              </span>
                              <span aria-hidden="true">·</span>
                              <span className="tabular-nums">{snap.createdAt}</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() =>
                                setInspectedSnapshotId((prev) =>
                                  prev === snap.id ? null : snap.id
                                )
                              }
                              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                            >
                              {isExpanded ? "Hide Slots" : "Inspect"}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setIsAnimating(false);
                                onChangeProgram(snap.program);
                                onChangeStepCursor(null);
                                setSolveNote(`Restored ${snap.label}.`);
                              }}
                              className="rounded-md border border-emerald-300 bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-800 hover:bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 dark:hover:bg-emerald-900/60"
                            >
                              Restore
                            </button>
                            <button
                              type="button"
                              aria-label={`Delete ${snap.label}`}
                              onClick={() =>
                                setSnapshots((prev) =>
                                  prev.filter((s) => s.id !== snap.id)
                                )
                              }
                              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-500 hover:text-red-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:text-red-400"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        </div>
                        {isExpanded && (
                          <div className="rounded-md border border-slate-200 bg-white p-2 font-mono text-[11px] text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                            {nonZeroSlots.length > 0
                              ? nonZeroSlots
                                  .map((item) => `R${item.idx}=${item.val}`)
                                  .join(", ")
                              : "All 48 slots are 0"}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Solved State Footer Banner */}
          {isSolvedAtEnd && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 dark:border-emerald-800 dark:bg-emerald-950/50">
              <div>
                <div className="flex items-center gap-1.5 text-sm font-semibold text-emerald-900 dark:text-emerald-200">
                  <CheckCircle2 className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
                  Station Targets Verified
                </div>
                <p className="text-xs text-emerald-800 tabular-nums dark:text-emerald-300">
                  Solved in {instructionCount} instruction{instructionCount === 1 ? "" : "s"}
                  {instructionCount < puzzle.parSteps
                    ? ` (Beat par of ${puzzle.parSteps} by ${puzzle.parSteps - instructionCount})`
                    : instructionCount === puzzle.parSteps
                      ? ` (Matched par of ${puzzle.parSteps})`
                      : ` (Par is ${puzzle.parSteps} — try shortening!)`}
                </p>
              </div>
              {!isCustomPuzzle && puzzle.id < TOTAL_PUZZLES && (
                <button
                  type="button"
                  onClick={() => onSelectPuzzleId(puzzle.id + 1)}
                  className="inline-flex items-center gap-1 rounded-lg bg-emerald-700 px-3.5 py-2 text-xs font-medium text-white hover:bg-emerald-800 dark:bg-emerald-600 dark:hover:bg-emerald-500 whitespace-nowrap shrink-0"
                >
                  Next Puzzle
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )}
        </section>
      </div>
    </div>

    {showInstructionCard && (
      <InstructionCardModal
        puzzle={puzzle}
        isCustomPuzzle={isCustomPuzzle}
        instructions={parsed.instructions}
        finalSlots={execution.finalSlots}
        isSolved={isSolvedAtEnd}
        profile={executionProfile}
        complexity={puzzleComplexity}
        onClose={() => setShowInstructionCard(false)}
      />
    )}
    </>
  );
};
