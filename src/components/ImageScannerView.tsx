import React, { useRef, useState } from "react";
import {
  Upload,
  ScanLine,
  AlertTriangle,
  ArrowRight,
  Code2,
  Trash2,
} from "lucide-react";
import { Puzzle } from "../lib/puzzles";
import { ImageAnalysisResult } from "../types/app";

interface ImageScannerViewProps {
  activePuzzle: Puzzle;
  onLoadExtractedPuzzle: (
    seeds: Record<number, bigint>,
    targets: bigint[],
    suggestedProgram?: string
  ) => void;
  onApplyProgramToCurrent: (program: string) => void;
}

export const ImageScannerView: React.FC<ImageScannerViewProps> = ({
  activePuzzle,
  onLoadExtractedPuzzle,
  onApplyProgramToCurrent,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [mimeType, setMimeType] = useState<string>("image/png");
  const [fileName, setFileName] = useState<string>("");
  const [customPrompt, setCustomPrompt] = useState<string>(
    "Extract any starting numbers and target numbers from this image, explain the mathematical pattern, and suggest a short 48-slot Elf Calculator program."
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImageAnalysisResult | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const handleFile = (file: File) => {
    setError(null);
    setResult(null);
    setActionNotice(null);

    if (!file.type.startsWith("image/")) {
      setError("Please upload a valid image file (PNG, JPG, WebP, or GIF).");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("Image file must be under 10 MB.");
      return;
    }

    setMimeType(file.type);
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result ?? "");
      setPreviewUrl(dataUrl);
      const commaIdx = dataUrl.indexOf(",");
      setImageBase64(commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl);
    };
    reader.onerror = () => {
      setError("Failed to read the selected image file.");
    };
    reader.readAsDataURL(file);
  };

  const handleAnalyze = async () => {
    if (!imageBase64) return;
    setLoading(true);
    setError(null);
    setActionNotice(null);

    try {
      const seedsObj: Record<string, string> = {};
      for (const [k, v] of Object.entries(activePuzzle.seeds)) {
        seedsObj[`R${k}`] = v.toString();
      }

      const res = await fetch("/api/gemini/analyze-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageBase64,
          mimeType,
          prompt: customPrompt,
          puzzleContext: {
            id: activePuzzle.id,
            title: activePuzzle.title,
            station: activePuzzle.station,
            initialSlots: seedsObj,
            targets: activePuzzle.targets.map((t) => t.toString()),
            parSteps: activePuzzle.parSteps,
          },
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Image analysis request failed.");
      }

      setResult(data.analysis as ImageAnalysisResult);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to analyze the image."
      );
    } finally {
      setLoading(false);
    }
  };

  const handleClear = () => {
    setPreviewUrl(null);
    setImageBase64(null);
    setFileName("");
    setResult(null);
    setError(null);
    setActionNotice(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleOpenAsCustom = () => {
    if (!result) return;
    try {
      const seeds: Record<number, bigint> = {};
      const initialList =
        result.extractedInitial.length > 0 ? result.extractedInitial : ["1"];
      initialList.forEach((raw, idx) => {
        if (idx < 48) seeds[idx] = BigInt(raw.trim());
      });
      const targets = result.extractedTargets.map((raw) => BigInt(raw.trim()));
      if (targets.length === 0) {
        setActionNotice("No target integers were detected in this image.");
        return;
      }
      onLoadExtractedPuzzle(
        seeds,
        targets,
        result.suggestedProgram.join("\n")
      );
    } catch {
      setActionNotice(
        "Detected values contained non-integer tokens; load suggested program directly instead."
      );
    }
  };

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-200 pb-5 dark:border-slate-800">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl dark:text-slate-100">
          Workshop Image Scanner
        </h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Upload photos of handwritten math notes, whiteboard target lists, or calculator diagrams to extract exact targets and register programs.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-stretch">
        {/* Left Upload & Prompt Panel */}
        <section className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-5 lg:col-span-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                1. Upload Photo
              </h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Supports PNG, JPG, and WebP up to 10 MB.
              </p>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
              }}
            />

            {!previewUrl ? (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const file = e.dataTransfer.files?.[0];
                  if (file) handleFile(file);
                }}
                className="flex min-h-[240px] w-full flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-6 py-8 text-center transition-colors hover:border-emerald-600 hover:bg-emerald-50/30 dark:border-slate-700 dark:bg-slate-950/60 dark:hover:border-emerald-500 dark:hover:bg-emerald-950/30"
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                  <Upload className="h-5 w-5" />
                </div>
                <div className="space-y-1">
                  <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                    Click to select or drop an image here
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    Whiteboard sketches, printed number tables, or handwritten formulas
                  </div>
                </div>
              </button>
            ) : (
              <div className="space-y-2">
                <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-slate-950 dark:border-slate-700">
                  <img
                    src={previewUrl}
                    alt={fileName || "Uploaded workshop note"}
                    referrerPolicy="no-referrer"
                    className="max-h-[300px] w-full object-contain"
                  />
                </div>
                <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
                  <span className="truncate font-mono">{fileName}</span>
                  <button
                    type="button"
                    onClick={handleClear}
                    className="inline-flex items-center gap-1 text-red-700 hover:underline dark:text-red-400 whitespace-nowrap shrink-0"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Remove
                  </button>
                </div>
              </div>
            )}

            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                2. Analysis Instructions
              </span>
              <textarea
                rows={3}
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-slate-50 p-3 text-xs leading-relaxed text-slate-900 focus:border-emerald-700 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-emerald-500 dark:focus:bg-slate-900"
              />
            </label>

            {error && (
              <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-900 dark:border-red-800/80 dark:bg-red-950/50 dark:text-red-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>

          <div className="mt-5 flex items-center justify-end gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
            <button
              type="button"
              disabled={!imageBase64 || loading}
              onClick={handleAnalyze}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2.5 text-xs font-medium text-white transition-colors hover:bg-emerald-800 disabled:opacity-45 dark:bg-emerald-600 dark:hover:bg-emerald-500 whitespace-nowrap shrink-0"
            >
              <ScanLine className="h-4 w-4" />
              {loading ? "Analyzing Image..." : "Analyze Image"}
            </button>
          </div>
        </section>

        {/* Right Structured Analysis Results Panel */}
        <section className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-5 lg:col-span-7 dark:border-slate-800 dark:bg-slate-900">
          {!result && !loading && (
            <div className="flex h-full min-h-[320px] flex-col items-center justify-center text-center">
              <div className="max-w-md space-y-2">
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Ready to Inspect Your Photo
                </h2>
                <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                  Upload any photo of arithmetic problems, number sequences, or register sketches on the left and click Analyze Image. Extracted targets and programs can be sent directly to the Workbench.
                </p>
              </div>
            </div>
          )}

          {loading && (
            <div className="space-y-4 py-6">
              <div className="h-5 w-48 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
              <div className="h-20 w-full animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
              <div className="grid grid-cols-2 gap-4">
                <div className="h-16 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
                <div className="h-16 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
              </div>
              <div className="h-32 w-full animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
            </div>
          )}

          {result && !loading && (
            <div className="space-y-5">
              <div>
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Image Breakdown
                </h2>
                <p className="mt-1 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
                  {result.summary}
                </p>
              </div>

              <div className="grid grid-cols-1 gap-4 border-y border-slate-100 py-4 sm:grid-cols-2 dark:border-slate-800">
                <div>
                  <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                    Detected Initial Values
                  </div>
                  <div className="mt-1 font-mono text-sm font-semibold text-slate-900 tabular-nums dark:text-slate-100">
                    {result.extractedInitial.length > 0
                      ? result.extractedInitial
                          .map((v, i) => `R${i}=${v}`)
                          .join(", ")
                      : "R0=1 (default)"}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                    Detected Target Numbers
                  </div>
                  <div className="mt-1 font-mono text-sm font-semibold text-emerald-800 tabular-nums dark:text-emerald-400">
                    {result.extractedTargets.length > 0
                      ? `[${result.extractedTargets.join(", ")}]`
                      : "None detected"}
                  </div>
                </div>
              </div>

              <div>
                <h3 className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                  Mathematical Notes
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                  {result.coachingNotes}
                </p>
              </div>

              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                    Suggested 48-Slot Program
                  </h3>
                  <span className="font-mono text-xs text-slate-500 tabular-nums dark:text-slate-400">
                    {result.suggestedProgram.length} instructions
                  </span>
                </div>
                <pre className="max-h-48 overflow-auto rounded-lg border border-slate-200 bg-slate-950 p-3.5 font-mono text-xs leading-6 text-slate-100 dark:border-slate-700">
                  {result.suggestedProgram.length > 0
                    ? result.suggestedProgram.join("\n")
                    : "# No program lines generated."}
                </pre>
              </div>

              {actionNotice && (
                <p className="text-xs text-amber-800 dark:text-amber-300">
                  {actionNotice}
                </p>
              )}

              <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
                {result.suggestedProgram.length > 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      onApplyProgramToCurrent(result.suggestedProgram.join("\n"))
                    }
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 whitespace-nowrap shrink-0"
                  >
                    <Code2 className="h-3.5 w-3.5" />
                    Load Program into Active Puzzle
                  </button>
                )}
                {result.extractedTargets.length > 0 && (
                  <button
                    type="button"
                    onClick={handleOpenAsCustom}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white whitespace-nowrap shrink-0"
                  >
                    Open Extracted Targets in Workbench
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
