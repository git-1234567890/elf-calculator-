import {
  Op,
  ParsedInstruction,
  SLOT_COUNT,
  parseProgram,
} from "./elfVm";
import { Puzzle } from "./puzzles";
import { ComplexityTier, PuzzleTag } from "../types/app";

export const ALL_PUZZLE_TAGS: PuzzleTag[] = [
  "Beginner",
  "Advanced",
  "Multiplication-Heavy",
  "Logic-Only",
];

export interface PuzzleComplexity {
  score: number; // 1..100 normalized score
  opCount: number;
  parSteps: number;
  opToParRatio: number;
  weightedOpCost: number;
  tier: ComplexityTier;
  summary: string;
}

const OP_WEIGHTS: Record<Op, number> = {
  "+": 1.0,
  "-": 1.15,
  "*": 1.65,
  "/": 1.9,
};

const OP_CYCLES: Record<Op, number> = {
  "+": 1,
  "-": 1,
  "*": 3,
  "/": 4,
};

/**
 * Calculates a deterministic Complexity Score for a puzzle based on the
 * number of operations in its reference solution vs. par, operation weights,
 * and target breadth.
 */
export function calculatePuzzleComplexity(puzzle: Puzzle): PuzzleComplexity {
  const parsed = parseProgram(puzzle.referenceProgram);
  const opCount = Math.max(1, parsed.instructions.length);
  const parSteps = Math.max(1, puzzle.parSteps);
  const opToParRatio = opCount / parSteps;

  let weightedSum = 0;
  for (const inst of parsed.instructions) {
    weightedSum += OP_WEIGHTS[inst.op];
  }
  if (parsed.instructions.length === 0) {
    weightedSum = parSteps;
  }

  const avgOpWeight = weightedSum / opCount;
  const targetFactor = Math.max(1, puzzle.targets.length) * 3.5;
  const ratioBoost = Math.max(0, (opToParRatio - 1) * 18);
  const rawScore = Math.round(
    opCount * 3.8 * avgOpWeight + parSteps * 1.4 + targetFactor + ratioBoost
  );
  const score = Math.max(8, Math.min(99, rawScore));

  let tier: ComplexityTier = "Low";
  if (score >= 72) tier = "Extreme";
  else if (score >= 48) tier = "High";
  else if (score >= 26) tier = "Moderate";

  const summary = `Ops: ${opCount} vs Par: ${parSteps} (${opToParRatio.toFixed(
    2
  )}x) · Weighted Cost: ${weightedSum.toFixed(1)} · ${puzzle.targets.length} target${
    puzzle.targets.length === 1 ? "" : "s"
  }`;

  return {
    score,
    opCount,
    parSteps,
    opToParRatio,
    weightedOpCost: weightedSum,
    tier,
    summary,
  };
}

/**
 * Computes default tags for a puzzle from its difficulty and reference operators.
 */
export function getDefaultTagsForPuzzle(puzzle: Puzzle): PuzzleTag[] {
  const tags: PuzzleTag[] = [];
  const parsed = parseProgram(puzzle.referenceProgram);
  const ops = parsed.instructions.map((i) => i.op);
  const mulCount = ops.filter((op) => op === "*").length;

  if (puzzle.difficulty === "Apprentice" || puzzle.parSteps <= 4) {
    tags.push("Beginner");
  }
  if (
    puzzle.difficulty === "Master" ||
    puzzle.difficulty === "Grandmaster" ||
    puzzle.parSteps >= 8
  ) {
    tags.push("Advanced");
  }
  if (
    ops.length > 0 &&
    (mulCount >= 2 || mulCount / ops.length >= 0.4)
  ) {
    tags.push("Multiplication-Heavy");
  }
  if (ops.length > 0 && mulCount === 0) {
    tags.push("Logic-Only");
  }

  if (tags.length === 0) {
    tags.push(puzzle.difficulty === "Journeyman" ? "Beginner" : "Advanced");
  }

  return tags;
}

export interface ExecutionProfile {
  totalOperations: number;
  opCounts: Record<Op, number>;
  cycleCount: number;
  criticalPathCycles: number;
  registerReads: number;
  registerWrites: number;
  totalMemoryAccesses: number;
  uniqueRegistersUsed: number;
  memoryBandwidthPerCycle: number;
  bytesPerCycleLabel: string;
}

/**
 * Computes real-time execution telemetry (operations, cycle count,
 * critical-path dependency depth, and registry memory bandwidth).
 */
export function computeExecutionProfile(
  instructions: ParsedInstruction[],
  seeds: Record<number, bigint>
): ExecutionProfile {
  const opCounts: Record<Op, number> = {
    "+": 0,
    "-": 0,
    "*": 0,
    "/": 0,
  };

  let cycleCount = 0;
  const regReadyCycle = new Array<number>(SLOT_COUNT).fill(0);
  const touchedRegisters = new Set<number>();

  for (const key of Object.keys(seeds)) {
    const idx = Number(key);
    if (Number.isInteger(idx) && idx >= 0 && idx < SLOT_COUNT) {
      touchedRegisters.add(idx);
    }
  }

  let criticalPathCycles = 0;

  for (const inst of instructions) {
    opCounts[inst.op]++;
    const latency = OP_CYCLES[inst.op];
    cycleCount += latency;

    const readyA = regReadyCycle[inst.srcA];
    const readyB = regReadyCycle[inst.srcB];
    const finishCycle = Math.max(readyA, readyB) + latency;
    regReadyCycle[inst.dst] = finishCycle;
    if (finishCycle > criticalPathCycles) {
      criticalPathCycles = finishCycle;
    }

    touchedRegisters.add(inst.srcA);
    touchedRegisters.add(inst.srcB);
    touchedRegisters.add(inst.dst);
  }

  const totalOperations = instructions.length;
  const registerReads = totalOperations * 2;
  const registerWrites = totalOperations;
  const totalMemoryAccesses = registerReads + registerWrites;
  const memoryBandwidthPerCycle =
    cycleCount > 0 ? totalMemoryAccesses / cycleCount : 0;

  // Assume 8-byte (64-bit) register word transfers for human-friendly bandwidth readout
  const bytesPerCycle = memoryBandwidthPerCycle * 8;

  return {
    totalOperations,
    opCounts,
    cycleCount,
    criticalPathCycles,
    registerReads,
    registerWrites,
    totalMemoryAccesses,
    uniqueRegistersUsed: touchedRegisters.size,
    memoryBandwidthPerCycle,
    bytesPerCycleLabel: `${bytesPerCycle.toFixed(1)} B/cyc`,
  };
}

export interface SharedPuzzlePayload {
  title?: string;
  seeds: Record<number, string>;
  targets: string[];
  program?: string;
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(encoded: string): string {
  const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + "=".repeat(padLen);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

export function encodeSharedPuzzleUrl(puzzle: Puzzle, program?: string): string {
  const seeds: Record<number, string> = {};
  for (const [k, v] of Object.entries(puzzle.seeds)) {
    seeds[Number(k)] = v.toString(10);
  }
  const payload: SharedPuzzlePayload = {
    title: puzzle.title,
    seeds,
    targets: puzzle.targets.map((t) => t.toString(10)),
    ...(program && program.trim() ? { program: program.trim() } : {}),
  };
  const encoded = toBase64Url(JSON.stringify(payload));
  const url = new URL(window.location.href);
  url.searchParams.set("puzzle", encoded);
  return url.toString();
}

export function decodeSharedPuzzleFromSearch(search: string): {
  seeds: Record<number, bigint>;
  targets: bigint[];
  title?: string;
  program?: string;
} | null {
  try {
    const params = new URLSearchParams(search);
    const rawParam = params.get("puzzle") ?? params.get("custom");
    if (!rawParam) return null;

    const json = fromBase64Url(rawParam);
    const parsed = JSON.parse(json) as SharedPuzzlePayload;
    if (!parsed || !Array.isArray(parsed.targets) || parsed.targets.length === 0) {
      return null;
    }

    const seeds: Record<number, bigint> = {};
    for (const [k, v] of Object.entries(parsed.seeds || {})) {
      const idx = Number(k);
      if (Number.isInteger(idx) && idx >= 0 && idx < SLOT_COUNT) {
        seeds[idx] = BigInt(v);
      }
    }
    const targets = parsed.targets.map((t) => BigInt(t));
    return {
      seeds,
      targets,
      title: typeof parsed.title === "string" ? parsed.title : undefined,
      program: typeof parsed.program === "string" ? parsed.program : undefined,
    };
  } catch {
    return null;
  }
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fallback below
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}
