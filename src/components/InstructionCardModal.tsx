import React from "react";
import { Printer, X } from "lucide-react";
import {
  ParsedInstruction,
  SLOT_COUNT,
  formatBigIntExact,
} from "../lib/elfVm";
import { Puzzle } from "../lib/puzzles";
import {
  ExecutionProfile,
  PuzzleComplexity,
} from "../lib/puzzleMetrics";

interface InstructionCardModalProps {
  puzzle: Puzzle;
  isCustomPuzzle: boolean;
  instructions: ParsedInstruction[];
  finalSlots: bigint[];
  isSolved: boolean;
  profile: ExecutionProfile;
  complexity: PuzzleComplexity;
  onClose: () => void;
}

export const InstructionCardModal: React.FC<InstructionCardModalProps> = ({
  puzzle,
  isCustomPuzzle,
  instructions,
  finalSlots,
  isSolved,
  profile,
  complexity,
  onClose,
}) => {
  const seedEntries = Object.entries(puzzle.seeds);
  const nonZeroFinal = finalSlots
    .slice(0, SLOT_COUNT)
    .map((val, idx) => ({ idx, val }))
    .filter((entry) => entry.val !== 0n || puzzle.seeds[entry.idx] !== undefined);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Workshop Instruction Card"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs print:static print:block print:bg-white print:p-0"
    >
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900 print:max-h-none print:max-w-none print:rounded-none print:border-0 print:shadow-none">
        {/* Modal Actions (hidden on print) */}
        <div className="no-print flex items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-3.5 dark:border-slate-800 dark:bg-slate-800/60">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Workshop Instruction Card (Printable PDF)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Formatted offline reference sheet for your 48-slot register program.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-emerald-800 dark:bg-emerald-600 dark:hover:bg-emerald-500 whitespace-nowrap shrink-0"
            >
              <Printer className="h-3.5 w-3.5" />
              Print / Save PDF
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close instruction card"
              className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              <X className="h-3.5 w-3.5" />
              Close
            </button>
          </div>
        </div>

        {/* Printable Sheet Content */}
        <div className="overflow-y-auto p-6 print:overflow-visible print:p-0">
          <article
            id="workshop-instruction-card"
            className="space-y-5 rounded-lg border border-slate-200 bg-white p-6 text-slate-900 print:border-0 print:p-0"
          >
            {/* Card Header */}
            <header className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-slate-900 pb-4">
              <div className="space-y-1">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Elf Calculator · Workshop Instruction Card
                </div>
                <h1 className="text-xl font-bold tracking-tight text-slate-900">
                  {isCustomPuzzle ? "Custom Station Bench" : `Puzzle #${puzzle.id}`}:{" "}
                  {puzzle.title}
                </h1>
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                  <span>{puzzle.station}</span>
                  <span aria-hidden="true">·</span>
                  <span>{puzzle.difficulty}</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono">Par {puzzle.parSteps}</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono">
                    Complexity {complexity.score}/100 ({complexity.tier})
                  </span>
                </div>
              </div>
              <div className="rounded-md border border-slate-300 px-3 py-2 text-right font-mono text-xs">
                <div className="font-semibold text-slate-900">
                  {isSolved ? "VERIFIED PASS" : "DRAFT IN PROGRESS"}
                </div>
                <div className="text-[11px] text-slate-500">
                  {instructions.length} instruction{instructions.length === 1 ? "" : "s"}
                </div>
              </div>
            </header>

            {/* Seeds & Targets */}
            <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3.5">
                <h2 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Initial Seed Registers
                </h2>
                <div className="font-mono text-xs text-slate-900">
                  {seedEntries.length > 0
                    ? seedEntries
                        .map(([k, v]) => `R${k} = ${formatBigIntExact(v)}`)
                        .join(", ")
                    : "All slots R0–R47 start at 0"}
                </div>
              </div>

              <div className="rounded-md border border-slate-200 bg-slate-50 p-3.5">
                <h2 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Required Target Numbers
                </h2>
                <div className="font-mono text-xs text-slate-900 break-all">
                  [{puzzle.targets.map((t) => formatBigIntExact(t)).join(", ")}]
                </div>
              </div>
            </section>

            {/* Execution Profile Metrics */}
            <section className="grid grid-cols-3 gap-3 rounded-md border border-slate-200 p-3.5 text-xs">
              <div>
                <div className="text-[11px] text-slate-500">Operations</div>
                <div className="font-mono text-sm font-semibold text-slate-900">
                  {profile.totalOperations} ops (+{profile.opCounts["+"]} -{profile.opCounts["-"]} *
                  {profile.opCounts["*"]} /{profile.opCounts["/"]})
                </div>
              </div>
              <div>
                <div className="text-[11px] text-slate-500">Cycle Count / Depth</div>
                <div className="font-mono text-sm font-semibold text-slate-900">
                  {profile.cycleCount} cyc (depth {profile.criticalPathCycles})
                </div>
              </div>
              <div>
                <div className="text-[11px] text-slate-500">Register Bandwidth</div>
                <div className="font-mono text-sm font-semibold text-slate-900">
                  {profile.totalMemoryAccesses} R/W · {profile.uniqueRegistersUsed}/48 slots
                </div>
              </div>
            </section>

            {/* 48-Slot Program Listing */}
            <section>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                48-Slot Program Instructions
              </h2>
              {instructions.length === 0 ? (
                <div className="rounded-md border border-dashed border-slate-300 p-4 text-center font-mono text-xs text-slate-500">
                  (No valid instructions in current program)
                </div>
              ) : (
                <ol className="grid grid-cols-1 gap-1.5 rounded-md border border-slate-200 bg-slate-50 p-3.5 font-mono text-xs sm:grid-cols-2">
                  {instructions.map((inst, idx) => (
                    <li
                      key={`${idx}-${inst.lineNumber}`}
                      className="flex items-center gap-2 text-slate-900"
                    >
                      <span className="w-6 text-right text-[11px] text-slate-400">
                        {String(idx + 1).padStart(2, "0")}.
                      </span>
                      <span>{inst.raw}</span>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            {/* Non-Zero Final Registers */}
            <section>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                Resulting Non-Zero Registers (R0–R47)
              </h2>
              <div className="grid grid-cols-2 gap-1.5 font-mono text-xs sm:grid-cols-4">
                {nonZeroFinal.map((entry) => (
                  <div
                    key={entry.idx}
                    className="flex items-center justify-between rounded border border-slate-200 px-2.5 py-1.5"
                  >
                    <span className="font-semibold text-slate-600">
                      R{entry.idx}
                    </span>
                    <span className="truncate pl-2 text-slate-900">
                      {formatBigIntExact(entry.val)}
                    </span>
                  </div>
                ))}
              </div>
            </section>

            <footer className="border-t border-slate-200 pt-3 text-[11px] text-slate-500">
              Workshop Note: {puzzle.hint}
            </footer>
          </article>
        </div>
      </div>
    </div>
  );
};
