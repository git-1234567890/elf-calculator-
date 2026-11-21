import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Mic,
  MicOff,
  PhoneOff,
  Radio,
  Volume2,
  AlertTriangle,
  Send,
  Code2,
} from "lucide-react";
import { Puzzle } from "../lib/puzzles";

interface VoiceLiveCoachProps {
  activePuzzle: Puzzle;
  activeProgram: string;
  includePuzzleContext: boolean;
  onLoadSuggestedProgram: (programText: string) => void;
}

type VoiceName = "Zephyr" | "Puck" | "Charon" | "Kore" | "Fenrir";

interface TranscriptEntry {
  id: string;
  speaker: "user" | "model";
  text: string;
  timestamp: string;
}

function downsampleAndEncodePcm16(
  input: Float32Array,
  inputSampleRate: number,
  targetSampleRate = 16000
): string {
  let samples = input;
  if (inputSampleRate !== targetSampleRate && inputSampleRate > 0) {
    const ratio = inputSampleRate / targetSampleRate;
    const outLength = Math.max(1, Math.round(input.length / ratio));
    const resampled = new Float32Array(outLength);
    for (let i = 0; i < outLength; i++) {
      const idx = i * ratio;
      const idx0 = Math.floor(idx);
      const idx1 = Math.min(input.length - 1, idx0 + 1);
      const frac = idx - idx0;
      resampled[i] = input[idx0] * (1 - frac) + input[idx1] * frac;
    }
    samples = resampled;
  }

  const buffer = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(
      i * 2,
      clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff,
      true
    );
  }

  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function decodePcm16ToFloat32(base64: string): Float32Array {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const view = new DataView(bytes.buffer);
  const sampleCount = Math.floor(bytes.byteLength / 2);
  const float32 = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    const int16 = view.getInt16(i * 2, true);
    float32[i] = int16 / 32768;
  }
  return float32;
}

function extractInlineInstructions(text: string): string | null {
  const lines = text
    .split(/\r?\n|;/)
    .map((l) => l.trim())
    .filter((l) => /^[Rr]\d{1,2}\s*=\s*[Rr]\d{1,2}\s*[+\-*/]\s*[Rr]\d{1,2}$/.test(l));
  return lines.length > 0 ? lines.join("\n") : null;
}

export const VoiceLiveCoach: React.FC<VoiceLiveCoachProps> = ({
  activePuzzle,
  activeProgram,
  includePuzzleContext,
  onLoadSuggestedProgram,
}) => {
  const [status, setStatus] = useState<
    "idle" | "connecting" | "connected" | "error"
  >("idle");
  const [voiceName, setVoiceName] = useState<VoiceName>("Zephyr");
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [isModelSpeaking, setIsModelSpeaking] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [textFollowup, setTextFollowup] = useState<string>("");
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const inputCtxRef = useRef<AudioContext | null>(null);
  const outputCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const isMutedRef = useRef<boolean>(false);
  const isLiveReadyRef = useRef<boolean>(false);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcripts]);

  const stopOutputPlayback = useCallback(() => {
    activeSourcesRef.current.forEach((src) => {
      try {
        src.stop();
      } catch {
        // Ignore already-stopped nodes
      }
    });
    activeSourcesRef.current.clear();
    nextStartTimeRef.current = 0;
    setIsModelSpeaking(false);
  }, []);

  const cleanupSession = useCallback(() => {
    isLiveReadyRef.current = false;
    stopOutputPlayback();

    if (processorRef.current) {
      processorRef.current.onaudioprocess = null;
      try {
        processorRef.current.disconnect();
      } catch {
        // Ignore disconnect errors
      }
      processorRef.current = null;
    }

    if (sourceRef.current) {
      try {
        sourceRef.current.disconnect();
      } catch {
        // Ignore
      }
      sourceRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    if (inputCtxRef.current) {
      void inputCtxRef.current.close().catch(() => {});
      inputCtxRef.current = null;
    }

    if (outputCtxRef.current) {
      void outputCtxRef.current.close().catch(() => {});
      outputCtxRef.current = null;
    }

    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {
        // Ignore
      }
      wsRef.current = null;
    }
  }, [stopOutputPlayback]);

  useEffect(() => {
    return () => {
      cleanupSession();
    };
  }, [cleanupSession]);

  const appendTranscript = useCallback(
    (speaker: "user" | "model", chunk: string) => {
      const cleaned = chunk.trim();
      if (!cleaned) return;
      const nowLabel = new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
      setTranscripts((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.speaker === speaker) {
          const updated = [...prev];
          const needsSpace =
            last.text.length > 0 &&
            !last.text.endsWith(" ") &&
            !/^[.,!?;:]/.test(cleaned);
          updated[updated.length - 1] = {
            ...last,
            text: `${last.text}${needsSpace ? " " : ""}${cleaned}`,
          };
          return updated;
        }
        return [
          ...prev,
          {
            id: `${speaker}-${Date.now()}-${Math.random()
              .toString(36)
              .slice(2, 6)}`,
            speaker,
            text: cleaned,
            timestamp: nowLabel,
          },
        ];
      });
    },
    []
  );

  const scheduleAudioChunk = useCallback((base64Pcm: string) => {
    const outCtx = outputCtxRef.current;
    if (!outCtx) return;

    if (outCtx.state === "suspended") {
      void outCtx.resume().catch(() => {});
    }

    const float32 = decodePcm16ToFloat32(base64Pcm);
    if (float32.length === 0) return;

    const audioBuffer = outCtx.createBuffer(1, float32.length, 24000);
    audioBuffer.getChannelData(0).set(float32);

    const src = outCtx.createBufferSource();
    src.buffer = audioBuffer;
    src.connect(outCtx.destination);

    const now = outCtx.currentTime;
    const startTime = Math.max(now, nextStartTimeRef.current);
    nextStartTimeRef.current = startTime + audioBuffer.duration;

    activeSourcesRef.current.add(src);
    setIsModelSpeaking(true);

    src.onended = () => {
      activeSourcesRef.current.delete(src);
      if (activeSourcesRef.current.size === 0) {
        setIsModelSpeaking(false);
      }
    };

    src.start(startTime);
  }, []);

  const handleStartSession = async () => {
    if (status === "connecting" || status === "connected") return;
    setError(null);
    setStatus("connecting");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const InputCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const inputCtx = new InputCtx({ sampleRate: 16000 });
      const outputCtx = new InputCtx({ sampleRate: 24000 });
      inputCtxRef.current = inputCtx;
      outputCtxRef.current = outputCtx;

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(
        `${protocol}//${window.location.host}/api/gemini/live`
      );
      wsRef.current = ws;

      ws.onopen = () => {
        const seedsObj: Record<string, string> = {};
        for (const [k, v] of Object.entries(activePuzzle.seeds)) {
          seedsObj[`R${k}`] = v.toString();
        }

        ws.send(
          JSON.stringify({
            type: "init",
            voiceName,
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
          })
        );

        const source = inputCtx.createMediaStreamSource(stream);
        const processor = inputCtx.createScriptProcessor(4096, 1, 1);
        sourceRef.current = source;
        processorRef.current = processor;

        processor.onaudioprocess = (e) => {
          if (
            !isLiveReadyRef.current ||
            isMutedRef.current ||
            !wsRef.current ||
            wsRef.current.readyState !== WebSocket.OPEN
          ) {
            return;
          }
          const pcmBase64 = downsampleAndEncodePcm16(
            e.inputBuffer.getChannelData(0),
            inputCtx.sampleRate,
            16000
          );
          wsRef.current.send(
            JSON.stringify({ type: "audio", data: pcmBase64 })
          );
        };

        source.connect(processor);
        processor.connect(inputCtx.destination);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as {
            type?: string;
            data?: string;
            text?: string;
            message?: string;
          };
          if (msg.type === "ready") {
            isLiveReadyRef.current = true;
            setStatus("connected");
          } else if (msg.type === "audio" && msg.data) {
            scheduleAudioChunk(msg.data);
          } else if (msg.type === "inputTranscript" && msg.text) {
            appendTranscript("user", msg.text);
          } else if (msg.type === "outputTranscript" && msg.text) {
            appendTranscript("model", msg.text);
          } else if (msg.type === "interrupted") {
            stopOutputPlayback();
          } else if (msg.type === "error") {
            setError(msg.message || "Live Voice session encountered an error.");
            setStatus("error");
            cleanupSession();
          } else if (msg.type === "closed") {
            setStatus("idle");
            cleanupSession();
          }
        } catch {
          // Ignore malformed WS frames
        }
      };

      ws.onerror = () => {
        setError("WebSocket connection to Live Voice AI failed.");
        setStatus("error");
        cleanupSession();
      };

      ws.onclose = () => {
        setStatus((prev) => (prev === "error" ? "error" : "idle"));
        cleanupSession();
      };
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Microphone access is required for Live Voice AI."
      );
      setStatus("error");
      cleanupSession();
    }
  };

  const handleStopSession = () => {
    cleanupSession();
    setStatus("idle");
  };

  const handleSendTextToLive = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = textFollowup.trim();
    if (!trimmed || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      return;
    }
    wsRef.current.send(JSON.stringify({ type: "text", text: trimmed }));
    appendTranscript("user", trimmed);
    setTextFollowup("");
  };

  const isActive = status === "connected" || status === "connecting";

  return (
    <div className="flex h-[560px] flex-col rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      {/* Voice Session Header Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-800/60">
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <div className="inline-flex items-center gap-1.5 font-semibold text-slate-900 dark:text-slate-100">
            <Radio
              className={`h-4 w-4 ${
                status === "connected"
                  ? "text-emerald-700 dark:text-emerald-400"
                  : "text-slate-400 dark:text-slate-500"
              }`}
            />
            <span>
              {status === "connected"
                ? isModelSpeaking
                  ? "Live Voice Active · Coach Speaking"
                  : isMuted
                    ? "Live Voice Active · Mic Muted"
                    : "Live Voice Active · Listening"
                : status === "connecting"
                  ? "Connecting Live Audio Session..."
                  : "Real-Time Voice Coach (Gemini Live)"}
            </span>
          </div>

          <span className="text-slate-300 dark:text-slate-600" aria-hidden="true">
            |
          </span>

          <label className="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
            <span>Voice:</span>
            <select
              aria-label="Select AI coach voice"
              value={voiceName}
              disabled={isActive}
              onChange={(e) => setVoiceName(e.target.value as VoiceName)}
              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-800 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            >
              <option value="Zephyr">Zephyr</option>
              <option value="Puck">Puck</option>
              <option value="Charon">Charon</option>
              <option value="Kore">Kore</option>
              <option value="Fenrir">Fenrir</option>
            </select>
          </label>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {isActive && (
            <button
              type="button"
              onClick={() => setIsMuted((m) => !m)}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                isMuted
                  ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950/60 dark:text-amber-300"
                  : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              }`}
            >
              {isMuted ? (
                <>
                  <MicOff className="h-3.5 w-3.5" />
                  Unmute Mic
                </>
              ) : (
                <>
                  <Mic className="h-3.5 w-3.5 text-emerald-700 dark:text-emerald-400" />
                  Mute Mic
                </>
              )}
            </button>
          )}

          {isActive ? (
            <button
              type="button"
              onClick={handleStopSession}
              className="inline-flex items-center gap-1.5 rounded-lg bg-red-700 px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-800 dark:bg-red-600 dark:hover:bg-red-500 whitespace-nowrap shrink-0"
            >
              <PhoneOff className="h-3.5 w-3.5" />
              End Voice Session
            </button>
          ) : (
            <button
              type="button"
              onClick={handleStartSession}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-800 dark:bg-emerald-600 dark:hover:bg-emerald-500 whitespace-nowrap shrink-0"
            >
              <Mic className="h-3.5 w-3.5" />
              Start Live Voice
            </button>
          )}
        </div>
      </div>

      {/* Live Transcript Thread */}
      <div className="flex-1 space-y-3 overflow-y-auto p-5">
        {transcripts.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="max-w-md space-y-2.5">
              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-emerald-700 dark:border-slate-700 dark:bg-slate-800 dark:text-emerald-400">
                <Volume2 className="h-5 w-5" />
              </div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Hands-Free Register Coaching
              </h2>
              <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                Start a live voice session to talk through addition chains, factorizations, and 48-slot optimizations in real time while keeping your workbench open.
              </p>
              <p className="font-mono text-[11px] text-slate-400 dark:text-slate-500">
                16kHz PCM mic input · 24kHz PCM spoken responses · Interruptible
              </p>
            </div>
          </div>
        ) : (
          transcripts.map((entry) => {
            const isUser = entry.speaker === "user";
            const extracted = !isUser
              ? extractInlineInstructions(entry.text)
              : null;

            return (
              <div
                key={entry.id}
                className={`flex flex-col ${
                  isUser ? "items-end" : "items-start"
                }`}
              >
                <div className="mb-1 flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                  <span className="font-medium text-slate-700 dark:text-slate-300">
                    {isUser ? "You (Voice)" : `Coach (${voiceName})`}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="tabular-nums">{entry.timestamp}</span>
                </div>
                <div
                  className={`max-w-3xl rounded-xl border px-4 py-2.5 text-xs leading-relaxed ${
                    isUser
                      ? "border-slate-900 bg-slate-900 text-white dark:border-emerald-700 dark:bg-emerald-950/70 dark:text-slate-100"
                      : "border-slate-200 bg-slate-50 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  }`}
                >
                  {entry.text}
                </div>
                {extracted && (
                  <button
                    type="button"
                    onClick={() => onLoadSuggestedProgram(extracted)}
                    className="mt-1.5 inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 dark:hover:bg-emerald-900/60"
                  >
                    <Code2 className="h-3.5 w-3.5" />
                    Load Spoken Program into Workbench
                  </button>
                )}
              </div>
            );
          })
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-900 dark:border-red-800/80 dark:bg-red-950/50 dark:text-red-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div ref={transcriptEndRef} />
      </div>

      {/* Optional Text Prompt Injection During Live Session */}
      <form
        onSubmit={handleSendTextToLive}
        className="flex items-center gap-2 border-t border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900"
      >
        <input
          type="text"
          value={textFollowup}
          disabled={status !== "connected"}
          onChange={(e) => setTextFollowup(e.target.value)}
          placeholder={
            status === "connected"
              ? "Speak into your microphone, or send a quick text cue to the live voice coach..."
              : "Click 'Start Live Voice' to begin a real-time spoken coaching session..."
          }
          className="flex-1 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-900 focus:border-emerald-700 focus:bg-white focus:outline-none disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-emerald-500 dark:focus:bg-slate-900"
        />
        <button
          type="submit"
          disabled={status !== "connected" || !textFollowup.trim()}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 text-xs font-medium text-white transition-colors hover:bg-slate-800 disabled:opacity-40 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white whitespace-nowrap shrink-0"
        >
          <Send className="h-3.5 w-3.5" />
          Cue
        </button>
      </form>
    </div>
  );
};
