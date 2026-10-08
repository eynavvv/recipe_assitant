import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import { streamAnswer, type ChatTurn } from "./assistant.js";
import { loadVideoContext, parsePastedTranscript, parseVideoId, type VideoContext } from "./youtube.js";

const app = express();
app.use(express.json({ limit: "2mb" }));

// Video contexts are cached in memory; restart clears them.
const videos = new Map<string, VideoContext>();

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
  res.json(ctx);
});

app.post("/api/chat", async (req, res) => {
  const { videoId, messages, currentTime } = req.body ?? {};
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

  try {
    await streamAnswer(ctx, history, typeof currentTime === "number" ? currentTime : undefined, (t) => res.write(t), abort.signal);
  } catch (err) {
    if (abort.signal.aborted) return;
    console.error(err);
    let msg = "Something went wrong talking to Claude.";
    if (err instanceof Anthropic.AuthenticationError) msg = "The server's Anthropic API key is missing or invalid.";
    else if (err instanceof Anthropic.RateLimitError) msg = "Claude is rate limited right now, try again in a moment.";
    else if (err instanceof Anthropic.APIConnectionError) msg = "Couldn't reach the Claude API.";
    res.write(`\n\n[error] ${msg}`);
  }
  res.end();
});

// In production, serve the built client from the same origin.
const clientDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../client/dist");
app.use(express.static(clientDist));
app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(clientDist, "index.html")));

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => console.log(`Server listening on http://localhost:${port}`));
