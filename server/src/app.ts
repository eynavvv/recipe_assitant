import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import { streamAnswer, type ChatTurn, type CookState } from "./assistant.js";
import { extractRecipe, RecipeSchema, type Recipe } from "./recipe.js";
import { loadVideoContext, parsePastedTranscript, parseVideoId, type VideoContext } from "./youtube.js";

// The API is stateless so it can run as serverless functions (Vercel): the client keeps the
// video context and recipe it got back and sends them with each later request.
export const app = express();
app.use(express.json({ limit: "4mb" }));

function claudeErrorMessage(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "The server's Anthropic API key is missing or invalid.";
  if (err instanceof Anthropic.RateLimitError) return "Claude is rate limited right now, try again in a moment.";
  if (err instanceof Anthropic.APIConnectionError) return "Couldn't reach the Claude API.";
  if (err instanceof Error) return err.message;
  return "Something went wrong talking to Claude.";
}

// Checks the shape of a video context sent back by the client.
export function readVideo(raw: unknown): VideoContext | null {
  if (!raw || typeof raw !== "object") return null;
  const v = raw as Partial<VideoContext>;
  if (typeof v.videoId !== "string" || !parseVideoId(v.videoId)) return null;
  const m = v.metadata;
  if (!m || typeof m.title !== "string" || typeof m.author !== "string") return null;
  if (!Array.isArray(v.chapters) || !Array.isArray(v.transcript)) return null;
  return {
    videoId: v.videoId,
    metadata: {
      ...m,
      description: typeof m.description === "string" ? m.description : "",
      lengthSeconds: Number(m.lengthSeconds) || 0,
      keywords: Array.isArray(m.keywords) ? m.keywords.map(String) : [],
    },
    chapters: v.chapters,
    comments: Array.isArray(v.comments) ? v.comments : [],
    transcript: v.transcript,
    transcriptLanguage: v.transcriptLanguage,
    transcriptSource: v.transcriptSource ?? "none",
  };
}

app.post("/api/video", async (req, res) => {
  const videoId = parseVideoId(String(req.body?.url ?? ""));
  if (!videoId) {
    res.status(400).json({ error: "That doesn't look like a YouTube link." });
    return;
  }
  try {
    res.json(await loadVideoContext(videoId));
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Failed to load video" });
  }
});

// Parses a transcript the user pasted when YouTube has no captions or blocks fetching them.
app.post("/api/transcript", (req, res) => {
  const transcript = parsePastedTranscript(String(req.body?.text ?? ""));
  if (!transcript.length) {
    res.status(400).json({ error: "Couldn't find any transcript text." });
    return;
  }
  res.json({ transcript });
});

app.post("/api/recipe", async (req, res) => {
  const video = readVideo(req.body?.video);
  if (!video) {
    res.status(400).json({ error: "Missing or invalid video." });
    return;
  }
  try {
    res.json(await extractRecipe(video));
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: claudeErrorMessage(err) });
  }
});

function parseCookState(raw: unknown): CookState | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const { stepIndex, servings } = raw as Record<string, unknown>;
  if (typeof stepIndex !== "number") return undefined;
  return { stepIndex, servings: typeof servings === "number" ? servings : undefined };
}

app.post("/api/chat", async (req, res) => {
  const { messages, currentTime, cook } = req.body ?? {};
  const video = readVideo(req.body?.video);
  if (!video) {
    res.status(400).json({ error: "Missing or invalid video." });
    return;
  }
  const parsedRecipe = RecipeSchema.safeParse(req.body?.recipe);
  const recipe: Recipe | undefined = parsedRecipe.success ? parsedRecipe.data : undefined;
  const history: ChatTurn[] = Array.isArray(messages)
    ? messages
        .filter((m: ChatTurn) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
        .slice(-30)
    : [];
  if (history.length === 0 || history[history.length - 1].role !== "user") {
    res.status(400).json({ error: "The last message must be from the user." });
    return;
  }

  const abort = new AbortController();
  res.on("close", () => abort.abort());
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.flushHeaders();

  try {
    await streamAnswer(
      video,
      recipe,
      history,
      typeof currentTime === "number" ? currentTime : undefined,
      parseCookState(cook),
      (t) => res.write(t),
      abort.signal,
    );
  } catch (err) {
    if (abort.signal.aborted) return;
    console.error(err);
    res.write(`\n\n[error] ${claudeErrorMessage(err)}`);
  }
  res.end();
});
