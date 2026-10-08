import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import { streamAnswer, type ChatTurn, type CookState } from "./assistant.js";
import { extractRecipe, type Recipe } from "./recipe.js";
import { loadVideoContext, parsePastedTranscript, parseVideoId, type VideoContext } from "./youtube.js";

const app = express();
app.use(express.json({ limit: "2mb" }));

// Video contexts and recipes are cached in memory; restart clears them.
const videos = new Map<string, VideoContext>();
const recipes = new Map<string, Promise<Recipe>>();
const readyRecipes = new Map<string, Recipe>();

function claudeErrorMessage(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "The server's Anthropic API key is missing or invalid.";
  if (err instanceof Anthropic.RateLimitError) return "Claude is rate limited right now, try again in a moment.";
  if (err instanceof Anthropic.APIConnectionError) return "Couldn't reach the Claude API.";
  if (err instanceof Error) return err.message;
  return "Something went wrong talking to Claude.";
}

function getRecipe(ctx: VideoContext): Promise<Recipe> {
  let p = recipes.get(ctx.videoId);
  if (!p) {
    p = extractRecipe(ctx);
    recipes.set(ctx.videoId, p);
    p.then(
      (r) => readyRecipes.set(ctx.videoId, r),
      () => recipes.delete(ctx.videoId), // let a later request retry
    );
  }
  return p;
}

app.post("/api/video", async (req, res) => {
  const videoId = parseVideoId(String(req.body?.url ?? ""));
  if (!videoId) {
    res.status(400).json({ error: "That doesn't look like a YouTube link." });
    return;
  }
  try {
    let ctx = videos.get(videoId);
    if (!ctx) {
      ctx = await loadVideoContext(videoId);
      videos.set(videoId, ctx);
    }
    res.json(ctx);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Failed to load video" });
  }
});

// Lets the user paste a transcript when YouTube has no captions or blocks fetching them.
app.post("/api/video/:id/transcript", (req, res) => {
  const ctx = videos.get(req.params.id);
  if (!ctx) {
    res.status(404).json({ error: "Load the video first." });
    return;
  }
  const transcript = parsePastedTranscript(String(req.body?.text ?? ""));
  if (!transcript.length) {
    res.status(400).json({ error: "Couldn't find any transcript text." });
    return;
  }
  ctx.transcript = transcript;
  ctx.transcriptSource = "manual";
  ctx.transcriptLanguage = undefined;
  recipes.delete(ctx.videoId); // re-extract with the new transcript
  readyRecipes.delete(ctx.videoId);
  res.json(ctx);
});

app.get("/api/video/:id/recipe", async (req, res) => {
  const ctx = videos.get(req.params.id);
  if (!ctx) {
    res.status(404).json({ error: "Load the video first." });
    return;
  }
  try {
    res.json(await getRecipe(ctx));
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
  const { videoId, messages, currentTime, cook } = req.body ?? {};
  const ctx = videos.get(String(videoId));
  if (!ctx) {
    res.status(404).json({ error: "Load the video first." });
    return;
  }
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

  // Use the recipe card if it's ready; never make a question wait for extraction.
  const recipe = readyRecipes.get(ctx.videoId);

  try {
    await streamAnswer(
      ctx,
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

// In production, serve the built client from the same origin.
const clientDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../client/dist");
app.use(express.static(clientDist));
app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(clientDist, "index.html")));

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => console.log(`Server listening on http://localhost:${port}`));
