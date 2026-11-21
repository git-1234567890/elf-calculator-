export type ThemeMode = "light" | "dark";
export type ViewTab = "workbench" | "puzzles" | "leaderboard" | "scanner" | "assistant";

export type PuzzleTag =
  | "Beginner"
  | "Advanced"
  | "Multiplication-Heavy"
  | "Logic-Only";

export type ComplexityTier = "Low" | "Moderate" | "High" | "Extreme";

export interface SolveAttempt {
  id: string;
  steps: number;
  program: string;
  solvedAt: string;
}

export interface SolvedRecord {
  puzzleId: number;
  bestSteps: number;
  program: string;
  updatedAt: string;
  history?: SolveAttempt[];
}

export interface RegistrySnapshot {
  id: string;
  label: string;
  puzzleId: number;
  program: string;
  slots: string[]; // 48 exact BigInt strings
  stepCount: number;
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "model";
  text: string;
  modelUsed?: string;
  timestamp: string;
}

export interface ImageAnalysisResult {
  summary: string;
  extractedInitial: string[];
  extractedTargets: string[];
  suggestedProgram: string[];
  coachingNotes: string;
}
