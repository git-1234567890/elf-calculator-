import {
  SLOT_COUNT,
  createInitialSlots,
  executeProgram,
  matchTargetsInSlots,
  parseProgram,
} from "./elfVm";
import { Puzzle } from "./puzzles";

export interface SolveOutcome {
  program: string;
  steps: number;
  method: string;
}

/**
 * Computes a short valid program for a puzzle.
 * - For single small/medium targets from common seeds, runs a bounded BFS / addition-chain planner.
 * - Also validates the puzzle's reference program (if available) and picks whichever is strictly shorter.
 */
export function autoSolvePuzzle(puzzle: Puzzle): SolveOutcome {
  let bestProgram = puzzle.referenceProgram;
  let bestSteps = Infinity;
  let bestMethod = "Workshop Dependency Slice";

  if (bestProgram.trim().length > 0) {
    const parsed = parseProgram(bestProgram);
    if (parsed.errors.length === 0) {
      const check = executeProgram(
        createInitialSlots(puzzle.seeds),
        parsed.instructions,
        puzzle.targets
      );
      if (check.isSolved) {
        bestSteps = parsed.instructions.length;
      }
    }
  }

  // Try constructive binary addition-chain + factor synthesis for arbitrary custom puzzles
  const constructive = buildConstructiveProgram(puzzle.seeds, puzzle.targets);
  if (constructive) {
    const parsedC = parseProgram(constructive);
    if (parsedC.errors.length === 0) {
      const checkC = executeProgram(
        createInitialSlots(puzzle.seeds),
        parsedC.instructions,
        puzzle.targets
      );
      if (checkC.isSolved && parsedC.instructions.length < bestSteps) {
        bestProgram = constructive;
        bestSteps = parsedC.instructions.length;
        bestMethod = "Binary Chain Synthesizer";
      }
    }
  }

  // For short puzzles (<= 4 steps), run a quick bounded breadth-first search to find true shortest
  if (bestSteps > 1 && puzzle.targets.length <= 2) {
    const bfsProgram = runBoundedBfs(puzzle.seeds, puzzle.targets, Math.min(4, bestSteps - 1));
    if (bfsProgram) {
      const parsedB = parseProgram(bfsProgram);
      if (parsedB.errors.length === 0 && parsedB.instructions.length < bestSteps) {
        bestProgram = bfsProgram;
        bestSteps = parsedB.instructions.length;
        bestMethod = "Exact Shortest-Path Search";
      }
    }
  }

  return {
    program: bestProgram,
    steps: bestSteps === Infinity ? 0 : bestSteps,
    method: bestMethod,
  };
}

function buildConstructiveProgram(
  seeds: Record<number, bigint>,
  targets: bigint[]
): string | null {
  if (targets.length === 0) return "";
  const slots = createInitialSlots(seeds);
  const valToSlot = new Map<bigint, number>();
  let nextSlot = 0;

  for (let i = 0; i < SLOT_COUNT; i++) {
    if (slots[i] !== 0n || seeds[i] !== undefined) {
      if (!valToSlot.has(slots[i])) {
        valToSlot.set(slots[i], i);
      }
      nextSlot = Math.max(nextSlot, i + 1);
    }
  }

  // Find a 1 unit if available or derivable via x / x
  const lines: string[] = [];
  const emit = (dst: number, srcA: number, op: "+" | "-" | "*" | "/", srcB: number, res: bigint) => {
    slots[dst] = res;
    if (!valToSlot.has(res)) valToSlot.set(res, dst);
    lines.push(`R${dst} = R${srcA} ${op} R${srcB}`);
  };

  if (!valToSlot.has(1n)) {
    const nonZeroSlot = slots.findIndex((v) => v !== 0n);
    if (nonZeroSlot === -1 || nextSlot >= SLOT_COUNT) return null;
    const oneSlot = nextSlot++;
    emit(oneSlot, nonZeroSlot, "/", nonZeroSlot, 1n);
  }

  const ensureValue = (target: bigint): number | null => {
    const existing = valToSlot.get(target);
    if (existing !== undefined) return existing;
    if (target === 0n) {
      const zeroIdx = slots.findIndex((v) => v === 0n);
      if (zeroIdx !== -1) return zeroIdx;
      if (nextSlot >= SLOT_COUNT) return null;
      const s = nextSlot++;
      emit(s, 0, "-", 0, 0n);
      return s;
    }

    if (target < 0n) {
      const posSlot = ensureValue(-target);
      if (posSlot === null || nextSlot >= SLOT_COUNT) return null;
      const zeroSlot = ensureValue(0n);
      if (zeroSlot === null) return null;
      const dst = nextSlot++;
      emit(dst, zeroSlot, "-", posSlot, target);
      return dst;
    }

    // Binary doubling + addition from 1
    const oneSlot = valToSlot.get(1n)!;
    const bits = target.toString(2);
    let accSlot = oneSlot;
    let accVal = 1n;

    for (let i = 1; i < bits.length; i++) {
      if (nextSlot >= SLOT_COUNT) return null;
      const doubledVal = accVal * 2n;
      const doubledSlot = valToSlot.get(doubledVal);
      if (doubledSlot !== undefined) {
        accSlot = doubledSlot;
        accVal = doubledVal;
      } else {
        const dst = nextSlot++;
        emit(dst, accSlot, "+", accSlot, doubledVal);
        accSlot = dst;
        accVal = doubledVal;
      }

      if (bits[i] === "1") {
        const plusOneVal = accVal + 1n;
        const plusOneSlot = valToSlot.get(plusOneVal);
        if (plusOneSlot !== undefined) {
          accSlot = plusOneSlot;
          accVal = plusOneVal;
        } else {
          if (nextSlot >= SLOT_COUNT) return null;
          const dst = nextSlot++;
          emit(dst, accSlot, "+", oneSlot, plusOneVal);
          accSlot = dst;
          accVal = plusOneVal;
        }
      }
    }
    return accSlot;
  };

  for (const t of targets) {
    const res = ensureValue(t);
    if (res === null) return null;
  }

  return lines.join("\n");
}

function runBoundedBfs(
  seeds: Record<number, bigint>,
  targets: bigint[],
  maxDepth: number
): string | null {
  if (maxDepth <= 0) return null;

  interface BfsState {
    slots: bigint[];
    activeCount: number;
    lines: string[];
  }

  const initialSlots = createInitialSlots(seeds);
  let activeCount = 1;
  for (let i = 0; i < SLOT_COUNT; i++) {
    if (seeds[i] !== undefined) activeCount = Math.max(activeCount, i + 1);
  }

  if (matchTargetsInSlots(initialSlots, targets).length === targets.length) {
    return "";
  }

  const queue: BfsState[] = [
    { slots: initialSlots, activeCount, lines: [] },
  ];
  const visited = new Set<string>();
  const MAX_VISITED = 3500;

  while (queue.length > 0 && visited.size < MAX_VISITED) {
    const state = queue.shift()!;
    if (state.lines.length >= maxDepth) continue;

    const dst = Math.min(SLOT_COUNT - 1, state.activeCount);
    const ops: Array<"+" | "-" | "*" | "/"> = ["+", "*", "-", "/"];

    for (let a = 0; a < state.activeCount; a++) {
      for (let b = a; b < state.activeCount; b++) {
        for (const op of ops) {
          const pairs: Array<[number, number]> =
            op === "-" || op === "/" ? (a === b ? [[a, b]] : [[a, b], [b, a]]) : [[a, b]];
          for (const [sa, sb] of pairs) {
            const va = state.slots[sa];
            const vb = state.slots[sb];
            let val: bigint;
            if (op === "+") val = va + vb;
            else if (op === "-") val = va - vb;
            else if (op === "*") val = va * vb;
            else {
              if (vb === 0n || va % vb !== 0n) continue;
              val = va / vb;
            }
            if (val <= 0n || val > 1_000_000_000n) continue;

            // Skip redundant values already present
            let exists = false;
            for (let k = 0; k < state.activeCount; k++) {
              if (state.slots[k] === val) {
                exists = true;
                break;
              }
            }
            if (exists) continue;

            const nextSlots = state.slots.slice();
            nextSlots[dst] = val;
            const nextLines = [...state.lines, `R${dst} = R${sa} ${op} R${sb}`];

            if (matchTargetsInSlots(nextSlots, targets).length === targets.length) {
              return nextLines.join("\n");
            }

            const sig = nextSlots
              .slice(0, dst + 1)
              .map((x) => x.toString())
              .join(",");
            if (!visited.has(sig)) {
              visited.add(sig);
              queue.push({
                slots: nextSlots,
                activeCount: Math.min(SLOT_COUNT, dst + 1),
                lines: nextLines,
              });
            }
          }
        }
      }
    }
  }

  return null;
}
