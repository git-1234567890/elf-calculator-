import express from "express";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import {
  GoogleGenAI,
  LiveServerMessage,
  Modality,
  ThinkingLevel,
  Type,
} from "@google/genai";
import { WebSocket, WebSocketServer } from "ws";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);

function getGeminiClient(apiVersion?: string): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured. Please add your API key in Settings > Secrets.");
  }
  return new GoogleGenAI({
    apiKey,
    ...(apiVersion ? { apiVersion } : {}),
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const obj = err as { message?: unknown; error?: unknown; reason?: unknown };
    if (typeof obj.message === "string" && obj.message) return obj.message;
    if (obj.error) return extractErrorMessage(obj.error);
    if (typeof obj.reason === "string" && obj.reason) return obj.reason;
  }
  return String(err);
}

function formatGeminiError(err: unknown): { status: number; message: string } {
  const raw = extractErrorMessage(err);
  if (raw.includes("GEMINI_API_KEY is not configured")) {
    return { status: 500, message: raw };
  }
  if (raw.includes("PERMISSION_DENIED") || raw.includes("403")) {
    return {
      status: 403,
      message: "Permission denied by the Gemini API. Please check your API key in the Settings > Secrets panel.",
    };
  }
  if (raw.includes("API_KEY_INVALID") || raw.includes("API key not valid") || raw.includes("400")) {
    return {
      status: 400,
      message: `Invalid request or API key (${raw}). Please verify your API key in Settings > Secrets.`,
    };
  }
  if (raw.includes("RESOURCE_EXHAUSTED") || raw.includes("429")) {
    return {
      status: 429,
      message: "Gemini API quota exhausted. Wait a moment or attach a billing-enabled API key in Settings > Secrets.",
    };
  }
  if (raw.includes("NOT_FOUND") || raw.includes("404")) {
    return {
      status: 404,
      message: `Requested Gemini endpoint or model was not found: ${raw}`,
    };
  }
  return { status: 500, message: raw || "Unexpected Gemini API error." };
}

interface PuzzleContextPayload {
  id: number | string;
  title: string;
  station: string;
  initialSlots: Record<string, string>;
  targets: string[];
  parSteps: number;
  currentProgram?: string;
  currentSlotsSummary?: string;
}

function buildPuzzleSystemPrompt(puzzleContext?: PuzzleContextPayload): string {
  const base = `You are the Master Algorithmist in Santa's Workshop, mentoring engineers on the Elf Calculator.

ELF CALCULATOR RULES (exact semantics):
- Memory consists of exactly 48 integer storage slots: R0 through R47.
- Unseeded slots start at 0. Seeded slots start at the puzzle's exact initial values.
- Every instruction takes the form: R<dst> = R<srcA> <op> R<srcB>
  where dst, srcA, srcB are integers in 0..47, and <op> is one of: +, -, *, /
- All arithmetic uses exact arbitrary-precision integers (no floats).
- Exact integer division (/): R<srcB> must be non-zero AND R<srcA> must be evenly divisible by R<srcB> (remainder 0). Otherwise execution halts with an error.
- A slot can overwrite itself or either operand (e.g., R0 = R0 + R0, or R1 = R1 * R1).
- Goal: After the final instruction executes, every number in the puzzle's target list must simultaneously appear in the 48 slots (with multiplicity if targets repeat).
- Objective: Write the shortest valid program (fewest instructions).

RESPONSE STYLE:
- Be concise, mathematically rigorous, and practical.
- When suggesting a program, output clean lines in a fenced code block using exact syntax:
  R1 = R0 + R0
  R2 = R1 * R1
- Double-check your arithmetic step by step so every suggested instruction is 100% valid and exact.`;

  if (!puzzleContext) {
    return base;
  }

  const seeds = Object.entries(puzzleContext.initialSlots)
    .map(([slot, val]) => `${slot}=${val}`)
    .join(", ");

  return `${base}

ACTIVE PUZZLE CONTEXT:
- Puzzle #${puzzleContext.id}: ${puzzleContext.title} (${puzzleContext.station})
- Initial non-zero slots: ${seeds || "none (all 0)"} (all other slots R0..R47 start at 0)
- Target numbers required simultaneously: [${puzzleContext.targets.join(", ")}]
- Workshop Par: ${puzzleContext.parSteps} instructions
${puzzleContext.currentProgram ? `- User's current program:\n${puzzleContext.currentProgram}` : "- User's current program: (empty)"}
${puzzleContext.currentSlotsSummary ? `- Current non-zero slot state: ${puzzleContext.currentSlotsSummary}` : ""}`;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: "15mb" }));

  // Multi-turn Gemini chat endpoint
  app.post("/api/gemini/chat", async (req, res) => {
    try {
      const { messages, mode, puzzleContext } = req.body as {
        messages?: Array<{ role: "user" | "model"; text: string }>;
        mode?: "fast" | "balanced" | "deep";
        puzzleContext?: PuzzleContextPayload;
      };

      if (!Array.isArray(messages) || messages.length === 0) {
        res.status(400).json({ error: "messages array is required." });
        return;
      }

      const lastMsg = messages[messages.length - 1];
      if (!lastMsg || lastMsg.role !== "user" || !lastMsg.text.trim()) {
        res.status(400).json({ error: "Last message must be a non-empty user message." });
        return;
      }

      const ai = getGeminiClient();
      let model = "gemini-4-hydrogen";
      let thinkingLevel: ThinkingLevel | undefined = ThinkingLevel.MEDIUM;

      if (mode === "fast") {
        model = "gemini-3.1-flash-lite";
        thinkingLevel = ThinkingLevel.MINIMAL;
      } else if (mode === "deep") {
        model = "gemini-4-hydrogen";
        thinkingLevel = ThinkingLevel.XHIGH;
      }

      const history = messages.slice(0, -1).map((m) => ({
        role: m.role,
        parts: [{ text: m.text }],
      }));

      const chat = ai.chats.create({
        model,
        config: {
          systemInstruction: buildPuzzleSystemPrompt(puzzleContext),
          ...(thinkingLevel ? { thinkingConfig: { thinkingLevel } } : {}),
        },
        history,
      });

      const response = await chat.sendMessage({ message: lastMsg.text });
      const replyText = response.text ?? "";

      res.json({
        reply: replyText,
        modelUsed: model,
      });
    } catch (err) {
      const formatted = formatGeminiError(err);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  // Image analysis endpoint (whiteboards, handwritten math notes, target lists, calculator diagrams)
  app.post("/api/gemini/analyze-image", async (req, res) => {
    try {
      const { imageBase64, mimeType, prompt, puzzleContext } = req.body as {
        imageBase64?: string;
        mimeType?: string;
        prompt?: string;
        puzzleContext?: PuzzleContextPayload;
      };

      if (!imageBase64 || !mimeType) {
        res.status(400).json({ error: "imageBase64 and mimeType are required." });
        return;
      }

      const ai = getGeminiClient();
      const imagePart = {
        inlineData: {
          mimeType,
          data: imageBase64,
        },
      };

      const userInstruction =
        prompt && prompt.trim().length > 0
          ? prompt.trim()
          : "Inspect this image of math notes, equations, numbers, or diagrams. Extract any target integers and starting numbers, explain the mathematical relationship, and propose a valid shortest Elf Calculator program using registers R0..R47.";

      const textPart = {
        text: userInstruction,
      };

      const response = await ai.models.generateContent({
        model: "gemini-4-hydrogen",
        contents: { parts: [imagePart, textPart] },
        config: {
          systemInstruction: `${buildPuzzleSystemPrompt(puzzleContext)}

You are also analyzing an uploaded photo (handwritten worksheet, whiteboard, math puzzle, diagram, or number sequence).
Return structured JSON matching the requested schema.
For extractedTargets and extractedInitial, provide exact base-10 integer strings (e.g. "42", "343").
For suggestedProgram, provide valid Elf Calculator instructions like "R1 = R0 + R0" (each line verified mathematically from extractedInitial, or starting from R0="1" if no initial values are visible in the photo).`,
          thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              summary: {
                type: Type.STRING,
                description: "Concise description of what appears in the uploaded image and the math problem identified.",
              },
              extractedInitial: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "Starting integer values detected in the image (e.g. ['1', '2']), or ['1'] if implicit.",
              },
              extractedTargets: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "Exact target integer values detected in the image.",
              },
              suggestedProgram: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "Valid Elf Calculator instructions (e.g. 'R1 = R0 + R0') to reach the targets using R0..R47.",
              },
              coachingNotes: {
                type: Type.STRING,
                description: "Clear mathematical explanation of how to construct or shorten the program.",
              },
            },
            required: ["summary", "extractedInitial", "extractedTargets", "suggestedProgram", "coachingNotes"],
          },
        },
      });

      const rawJson = (response.text ?? "{}").trim();
      const parsed = JSON.parse(rawJson);
      res.json({
        analysis: parsed,
        modelUsed: "gemini-4-hydrogen",
      });
    } catch (err) {
      const formatted = formatGeminiError(err);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, "dist");
    app.use(express.static(distPath));
    app.get("/{*path}", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: "/api/gemini/live" });

  wss.on("connection", (clientWs) => {
    type LiveSession = Awaited<ReturnType<GoogleGenAI["live"]["connect"]>>;
    let sessionPromise: Promise<LiveSession | null> | null = null;
    let isClosed = false;
    let errorSent = false;

    const sendToClient = (payload: Record<string, unknown>) => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify(payload));
      }
    };

    const sendErrorToClient = (err: unknown) => {
      if (errorSent) return;
      errorSent = true;
      const formatted = formatGeminiError(err);
      sendToClient({ type: "error", message: formatted.message });
    };

    const startLiveSession = (
      voiceName: string,
      puzzleContext?: PuzzleContextPayload
    ) => {
      if (sessionPromise || isClosed) return;

      const allowedVoices = new Set([
        "Zephyr",
        "Puck",
        "Charon",
        "Kore",
        "Fenrir",
      ]);
      const safeVoice = allowedVoices.has(voiceName) ? voiceName : "Zephyr";

      try {
        // Live API (BidiGenerateContent) requires v1beta in @google/genai >= 3.x
        const ai = getGeminiClient("v1beta");
        const voicePrompt = `${buildPuzzleSystemPrompt(puzzleContext)}

LIVE VOICE COACHING MODE:
- You are speaking in real time with an engineer at the workbench.
- Keep spoken replies concise, clear, and conversational (typically 2-4 sentences unless asked for a full walkthrough).
- Read register names naturally (e.g., "R0", "R1") and confirm exact integer arithmetic.`;

        sessionPromise = ai.live
          .connect({
            model: "gemini-3.8-live",
            config: {
              responseModalities: [Modality.AUDIO],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName: safeVoice },
                },
              },
              inputAudioTranscription: {},
              outputAudioTranscription: {},
              systemInstruction: voicePrompt,
            },
            callbacks: {
              onopen: () => {
                sendToClient({ type: "ready", voiceName: safeVoice });
              },
              onmessage: (message: LiveServerMessage) => {
                const content = message.serverContent;
                if (content?.inputTranscription?.text) {
                  sendToClient({
                    type: "inputTranscript",
                    text: content.inputTranscription.text,
                  });
                }
                if (content?.outputTranscription?.text) {
                  sendToClient({
                    type: "outputTranscript",
                    text: content.outputTranscription.text,
                  });
                }
                for (const part of content?.modelTurn?.parts ?? []) {
                  if (part.inlineData?.data) {
                    sendToClient({
                      type: "audio",
                      data: part.inlineData.data,
                    });
                  }
                }
                if (content?.interrupted) {
                  sendToClient({ type: "interrupted" });
                }
                if (content?.turnComplete) {
                  sendToClient({ type: "turnComplete" });
                }
              },
              onerror: (err: unknown) => {
                sendErrorToClient(err);
              },
              onclose: (ev: { code?: number; reason?: string }) => {
                if (!isClosed) {
                  if (ev?.reason && ev.code && ev.code !== 1000 && !errorSent) {
                    sendErrorToClient(
                      `Live session closed (${ev.code}): ${ev.reason}`
                    );
                  }
                  sendToClient({ type: "closed" });
                }
              },
            },
          })
          .catch((err: unknown): LiveSession | null => {
            sendErrorToClient(err);
            return null;
          });
      } catch (err) {
        sendErrorToClient(err);
        sessionPromise = Promise.resolve(null);
      }
    };

    clientWs.on("message", (raw) => {
      let msg: {
        type?: string;
        data?: string;
        text?: string;
        voiceName?: string;
        puzzleContext?: PuzzleContextPayload;
      };
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (msg.type === "init") {
        startLiveSession(msg.voiceName || "Zephyr", msg.puzzleContext);
        return;
      }

      if (!sessionPromise) {
        startLiveSession(msg.voiceName || "Zephyr", msg.puzzleContext);
      }

      const activePromise = sessionPromise;
      if (!activePromise) return;

      if (msg.type === "audio" && typeof msg.data === "string") {
        activePromise
          .then((session) => {
            if (session && !isClosed) {
              session.sendRealtimeInput({
                audio: { data: msg.data!, mimeType: "audio/pcm;rate=16000" },
              });
            }
          })
          .catch(() => {
            // Error already surfaced to client
          });
      } else if (msg.type === "text" && typeof msg.text === "string" && msg.text.trim()) {
        activePromise
          .then((session) => {
            if (session && !isClosed) {
              session.sendRealtimeInput({ text: msg.text!.trim() });
            }
          })
          .catch(() => {
            // Error already surfaced to client
          });
      }
    });

    clientWs.on("close", () => {
      isClosed = true;
      if (sessionPromise) {
        sessionPromise
          .then((session) => {
            if (session) {
              session.close();
            }
          })
          .catch(() => {
            // Ignore cleanup errors
          });
      }
    });
  });

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Elf Calculator server listening on http://localhost:${PORT}`);
  });
}

startServer();
