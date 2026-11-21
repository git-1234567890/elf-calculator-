import React, { useEffect, useRef, useState } from "react";
import { Send, Trash2, Code2, AlertTriangle, Mic, MessageSquare } from "lucide-react";
import { Puzzle } from "../lib/puzzles";
import { ChatMessage } from "../types/app";
import { VoiceLiveCoach } from "./VoiceLiveCoach";

interface AssistantViewProps {
  activePuzzle: Puzzle;
  activeProgram: string;
  messages: ChatMessage[];
  onChangeMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  onLoadSuggestedProgram: (programText: string) => void;
}

type ChatMode = "fast" | "balanced" | "deep";

function extractProgramBlock(text: string): string | null {
  const regex = /```(?:[a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const block = match[1].trim();
    if (/^[Rr]\d{1,2}\s*=\s*[Rr]\d{1,2}\s*[+\-*/]\s*[Rr]\d{1,2}/m.test(block)) {
      return block;
    }
  }
  return null;
}

export const AssistantView: React.FC<AssistantViewProps> = ({
  activePuzzle,
  activeProgram,
  messages,
  onChangeMessages,
  onLoadSuggestedProgram,
}) => {
  const [assistantMode, setAssistantMode] = useState<"text" | "voice">("text");
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<ChatMode>("balanced");
  const [includePuzzleContext, setIncludePuzzleContext] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const threadEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  const sendMessage = async (textToSend: string) => {
    const trimmed = textToSend.trim();
    if (!trimmed || sending) return;

    setError(null);
    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      text: trimmed,
      timestamp: new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
    };

    const nextHistory = [...messages, userMsg];
    onChangeMessages(nextHistory);
    setInput("");
    setSending(true);

    try {
      const seedsObj: Record<string, string> = {};
      for (const [k, v] of Object.entries(activePuzzle.seeds)) {
        seedsObj[`R${k}`] = v.toString();
      }

      const res = await fetch("/api/gemini/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextHistory.map((m) => ({ role: m.role, text: m.text })),
          mode,
          puzzleContext: includePuzzleContext
            ? {
                id: activePuzzle.id,
                title: activePuzzle.title,
                station: activePuzzle.station,
                initialSlots: seedsObj,
                targets: activePuzzle.targets.map((t) => t.toString()),
                parSteps: activePuzzle.parSteps,
                currentProgram: activeProgram,
              }
            : undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Assistant request failed.");
      }

      const modelMsg: ChatMessage = {
        id: `m-${Date.now()}`,
        role: "model",
        text: data.reply || "No response text returned.",
        modelUsed: data.modelUsed,
        timestamp: new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
      };

      onChangeMessages((prev) => [...prev, modelMsg]);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to reach the assistant."
      );
    } finally {
      setSending(false);
    }
  };

  const quickPrompts = [
    `Help me solve Puzzle #${activePuzzle.id} in ${activePuzzle.parSteps} instructions or fewer.`,
    "Review my current program and spot any redundant instructions.",
    "Explain how addition chains and squaring shorten large multiplications.",
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between dark:border-slate-800">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl dark:text-slate-100">
            Workshop Optimization Assistant
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Multi-turn mathematical coaching for shortening 48-slot register programs.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
            <button
              type="button"
              onClick={() => setAssistantMode("text")}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                assistantMode === "text"
                  ? "bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-slate-100"
                  : "text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
              }`}
            >
              <MessageSquare className="h-3.5 w-3.5" />
              Text Chat
            </button>
            <button
              type="button"
              onClick={() => setAssistantMode("voice")}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                assistantMode === "voice"
                  ? "bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-slate-100"
                  : "text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
              }`}
            >
              <Mic className="h-3.5 w-3.5" />
              Live Voice AI
            </button>
          </div>

          {assistantMode === "text" && (
            <>
              <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
                {(
                  [
                    { id: "fast", label: "Fast" },
                    { id: "balanced", label: "Balanced" },
                    { id: "deep", label: "Deep Reasoning" },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setMode(opt.id)}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                      mode === opt.id
                        ? "bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-slate-100"
                        : "text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => {
                  onChangeMessages([]);
                  setError(null);
                }}
                disabled={messages.length === 0 || sending}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 whitespace-nowrap shrink-0"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Clear Thread
              </button>
            </>
          )}
        </div>
      </div>

      {assistantMode === "voice" ? (
        <VoiceLiveCoach
          activePuzzle={activePuzzle}
          activeProgram={activeProgram}
          includePuzzleContext={includePuzzleContext}
          onLoadSuggestedProgram={onLoadSuggestedProgram}
        />
      ) : (
      /* Chat Container */
      <div className="flex h-[560px] flex-col rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        {/* Active Context Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-400">
          <label className="inline-flex cursor-pointer items-center gap-2 font-medium text-slate-800 dark:text-slate-200">
            <input
              type="checkbox"
              checked={includePuzzleContext}
              onChange={(e) => setIncludePuzzleContext(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-slate-300 accent-emerald-700 dark:border-slate-600 dark:accent-emerald-500"
            />
            Share active Puzzle #{activePuzzle.id} state ({activePuzzle.targets.length} targets, Par {activePuzzle.parSteps})
          </label>
          <span>Role: Santa&apos;s Workshop Master Algorithmist</span>
        </div>

        {/* Scrollable Message Thread */}
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <div className="max-w-lg space-y-4">
                <div className="space-y-1">
                  <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                    Ask About Any Register Strategy
                  </h2>
                  <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                    The assistant tracks your conversation history and can inspect your active puzzle&apos;s initial slots, target numbers, and current instructions.
                  </p>
                </div>
                <div className="flex flex-col gap-2">
                  {quickPrompts.map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => sendMessage(q)}
                      className="rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-left text-xs font-medium text-slate-800 transition-colors hover:border-slate-300 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:bg-slate-800"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            messages.map((msg) => {
              const isUser = msg.role === "user";
              const extractedCode = !isUser
                ? extractProgramBlock(msg.text)
                : null;

              return (
                <div
                  key={msg.id}
                  className={`flex flex-col ${
                    isUser ? "items-end" : "items-start"
                  }`}
                >
                  <div className="mb-1 flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                    <span className="font-medium text-slate-700 dark:text-slate-300">
                      {isUser ? "You" : "Master Algorithmist"}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="tabular-nums">{msg.timestamp}</span>
                  </div>
                  <div
                    className={`max-w-3xl rounded-xl border px-4 py-3 text-sm leading-relaxed ${
                      isUser
                        ? "border-slate-900 bg-slate-900 text-white dark:border-emerald-700 dark:bg-emerald-950/70 dark:text-slate-100"
                        : "border-slate-200 bg-slate-50 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    }`}
                  >
                    <div className="whitespace-pre-wrap break-words font-sans text-[13px]">
                      {msg.text}
                    </div>
                  </div>
                  {extractedCode && (
                    <button
                      type="button"
                      onClick={() => onLoadSuggestedProgram(extractedCode)}
                      className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 dark:hover:bg-emerald-900/60 whitespace-nowrap shrink-0"
                    >
                      <Code2 className="h-3.5 w-3.5" />
                      Load Suggested Program into Workbench
                    </button>
                  )}
                </div>
              );
            })
          )}

          {sending && (
            <div className="flex items-start">
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
                Calculating response...
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-900 dark:border-red-800/80 dark:bg-red-950/50 dark:text-red-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div ref={threadEndRef} />
        </div>

        {/* Message Input Form */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            sendMessage(input);
          }}
          className="flex items-end gap-2 border-t border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900"
        >
          <textarea
            rows={2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendMessage(input);
              }
            }}
            placeholder="Ask how to shorten your program, factor a target, or verify an exact division..."
            className="flex-1 resize-none rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-900 focus:border-emerald-700 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-emerald-500 dark:focus:bg-slate-900"
          />
          <button
            type="submit"
            disabled={!input.trim() || sending}
            className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-slate-900 px-4 text-xs font-medium text-white transition-colors hover:bg-slate-800 disabled:opacity-40 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white whitespace-nowrap shrink-0"
          >
            <Send className="h-3.5 w-3.5" />
            Send
          </button>
        </form>
      </div>
      )}
    </div>
  );
};
