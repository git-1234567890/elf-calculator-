export const SLOT_COUNT = 48;

export type Op = "+" | "-" | "*" | "/";

export interface ParsedInstruction {
  lineNumber: number;
  raw: string;
  dst: number;
  srcA: number;
  op: Op;
  srcB: number;
}

export interface ParseResult {
  instructions: ParsedInstruction[];
  errors: Array<{ lineNumber: number; message: string }>;
}

export interface ExecutionStep {
  stepIndex: number; // 0 = initial state, 1..N = after instruction
  instruction: ParsedInstruction | null;
  slots: bigint[];
  changedSlot: number | null;
  error: string | null;
}

export interface ExecutionResult {
  steps: ExecutionStep[];
  finalSlots: bigint[];
  error: { lineNumber: number; message: string } | null;
  matchedTargetIndices: number[];
  isSolved: boolean;
}

const LINE_REGEX =
  /^[Rr](\d{1,2})\s*=\s*[Rr](\d{1,2})\s*([+\-*/])\s*[Rr](\d{1,2})$/;

export function formatSlotName(index: number): string {
  return `R${index}`;
}

export function formatBigIntExact(value: bigint): string {
  return value.toString(10);
}

export function formatBigIntCompact(value: bigint): string {
  const s = value.toString(10);
  if (s.length <= 12) return s;
  const neg = s.startsWith("-");
  const digits = neg ? s.slice(1) : s;
  return `${neg ? "-" : ""}${digits.slice(0, 5)}…${digits.slice(-4)} (${digits.length}d)`;
}

export function createInitialSlots(seeds: Record<number, bigint>): bigint[] {
  const slots = new Array<bigint>(SLOT_COUNT).fill(0n);
  for (const [key, val] of Object.entries(seeds)) {
    const idx = Number(key);
    if (Number.isInteger(idx) && idx >= 0 && idx < SLOT_COUNT) {
      slots[idx] = val;
    }
  }
  return slots;
}

export function parseProgram(source: string): ParseResult {
  const lines = source.split(/\r?\n/);
  const instructions: ParsedInstruction[] = [];
  const errors: Array<{ lineNumber: number; message: string }> = [];

  for (let i = 0; i < lines.length; i++) {
    const lineNumber = i + 1;
    const rawLine = lines[i];
    const withoutComment = rawLine.replace(/(#|\/\/).*$/, "").trim();
    if (!withoutComment) continue;

    const match = withoutComment.match(LINE_REGEX);
    if (!match) {
      errors.push({
        lineNumber,
        message: `Invalid syntax "${withoutComment}". Expected format: R2 = R0 + R1`,
      });
      continue;
    }

    const dst = Number(match[1]);
    const srcA = Number(match[2]);
    const op = match[3] as Op;
    const srcB = Number(match[4]);

    if (dst < 0 || dst >= SLOT_COUNT) {
      errors.push({
        lineNumber,
        message: `Destination slot R${dst} is out of range (must be R0–R${SLOT_COUNT - 1}).`,
      });
      continue;
    }
    if (srcA < 0 || srcA >= SLOT_COUNT) {
      errors.push({
        lineNumber,
        message: `Operand slot R${srcA} is out of range (must be R0–R${SLOT_COUNT - 1}).`,
      });
      continue;
    }
    if (srcB < 0 || srcB >= SLOT_COUNT) {
      errors.push({
        lineNumber,
        message: `Operand slot R${srcB} is out of range (must be R0–R${SLOT_COUNT - 1}).`,
      });
      continue;
    }

    instructions.push({
      lineNumber,
      raw: `R${dst} = R${srcA} ${op} R${srcB}`,
      dst,
      srcA,
      op,
      srcB,
    });
  }

  return { instructions, errors };
}

export function matchTargetsInSlots(
  slots: bigint[],
  targets: bigint[]
): number[] {
  // Multiset matching: each target instance must match a distinct slot
  const available = new Map<bigint, number>();
  for (const val of slots) {
    available.set(val, (available.get(val) ?? 0) + 1);
  }

  const matched: number[] = [];
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    const count = available.get(t) ?? 0;
    if (count > 0) {
      matched.push(i);
      available.set(t, count - 1);
    }
  }
  return matched;
}

export function executeProgram(
  initialSlots: bigint[],
  instructions: ParsedInstruction[],
  targets: bigint[]
): ExecutionResult {
  const current = initialSlots.slice();
  const steps: ExecutionStep[] = [
    {
      stepIndex: 0,
      instruction: null,
      slots: current.slice(),
      changedSlot: null,
      error: null,
    },
  ];

  let runtimeError: { lineNumber: number; message: string } | null = null;

  for (let i = 0; i < instructions.length; i++) {
    const inst = instructions[i];
    const a = current[inst.srcA];
    const b = current[inst.srcB];
    let result = 0n;
    let stepErr: string | null = null;

    switch (inst.op) {
      case "+":
        result = a + b;
        break;
      case "-":
        result = a - b;
        break;
      case "*":
        result = a * b;
        break;
      case "/":
        if (b === 0n) {
          stepErr = `Line ${inst.lineNumber}: Division by zero (R${inst.srcB} is 0).`;
        } else if (a % b !== 0n) {
          stepErr = `Line ${inst.lineNumber}: ${a} / ${b} is not an exact integer division (remainder ${a % b}).`;
        } else {
          result = a / b;
        }
        break;
    }

    if (stepErr) {
      runtimeError = { lineNumber: inst.lineNumber, message: stepErr };
      steps.push({
        stepIndex: i + 1,
        instruction: inst,
        slots: current.slice(),
        changedSlot: null,
        error: stepErr,
      });
      break;
    }

    current[inst.dst] = result;
    steps.push({
      stepIndex: i + 1,
      instruction: inst,
      slots: current.slice(),
      changedSlot: inst.dst,
      error: null,
    });
  }

  const finalSlots = steps[steps.length - 1].slots;
  const matchedTargetIndices = matchTargetsInSlots(finalSlots, targets);

  return {
    steps,
    finalSlots,
    error: runtimeError,
    matchedTargetIndices,
    isSolved:
      runtimeError === null && matchedTargetIndices.length === targets.length,
  };
}
