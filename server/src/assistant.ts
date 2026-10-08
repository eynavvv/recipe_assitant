import Anthropic from "@anthropic-ai/sdk";
import { formatTimestamp, type TranscriptSegment, type VideoContext } from "./youtube.js";

export const MODEL = process.env.CLAUDE_MODEL ?? "claude-opus-5-5";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

// Merge short caption lines into ~20s blocks: fewer tokens, still precise enough to seek.
export function chunkTranscript(segments: TranscriptSegment[], maxSeconds = 20): string {
  const lines: string[] = [];
  let start: number | null = null;
  let buf: string[] = [];
  for (const seg of segments) {
    if (start === null) start = seg.start;
    buf.push(seg.text);
    if (seg.start + seg.duration - start >= maxSeconds) {
      lines.push(`[${formatTimestamp(start)}] ${buf.join(" ")}`);
      start = null;
      buf = [];
    }
  }
  if (start !== null && buf.length) lines.push(`[${formatTimestamp(start)}] ${buf.join(" ")}`);
  return lines.join("\n");
}

export function buildSystemPrompt(ctx: VideoContext): string {
  const m = ctx.metadata;
  const meta = [
    `Title: ${m.title}`,
    `Channel: ${m.author}`,
    `Duration: ${formatTimestamp(m.lengthSeconds)}`,
    m.publishDate && `Published: ${m.publishDate}`,
    m.category && `Category: ${m.category}`,
    m.viewCount !== undefined && `Views: ${m.viewCount.toLocaleString("en-US")}`,
    m.keywords.length > 0 && `Tags: ${m.keywords.join(", ")}`,
    `URL: https://www.youtube.com/watch?v=${ctx.videoId}`,
  ]
    .filter(Boolean)
    .join("\n");

  const chapters = ctx.chapters.length
    ? ctx.chapters.map((c) => `[${formatTimestamp(c.start)}] ${c.title}`).join("\n")
    : "(The video has no chapters.)";

  const transcript = ctx.transcript.length
    ? chunkTranscript(ctx.transcript)
    : "(No transcript is available. Answer from the metadata and description only, and say so when a question needs the spoken content.)";

  return `You are a study companion embedded next to a YouTube tutorial. The viewer is watching the video and asks you questions about it, by text or by voice.

How to answer:
- Ground answers in the transcript and metadata below. If the video doesn't cover something, say so briefly, then give a short general answer if it helps.
- Cite the moment in the video where something is covered with a timestamp in square brackets, like [4:05] or [1:02:30]. The app turns these into clickable links, so use only timestamps that exist in the video.
- When the viewer asks to go, jump, skip, rewind or replay to some part (e.g. "skip to the deployment part", "go back to where he explains hooks", "next chapter"), put a seek command on the very first line of your reply: [[seek 12:34]], with the best matching start time, then one short sentence saying where you jumped. Use the viewer's current position for relative requests like "next chapter" or "go back 30 seconds". Only emit a seek command when the viewer asks to move.
- Keep replies short and conversational (2 to 5 sentences unless the viewer asks for detail). Replies may be read aloud, so avoid tables and long code blocks unless asked; short inline code is fine.

<video_metadata>
${meta}
</video_metadata>

<description>
${m.description || "(empty)"}
</description>

<chapters>
${chapters}
</chapters>

<transcript language="${ctx.transcriptLanguage ?? "unknown"}">
${transcript}
</transcript>`;
}

// Created on first use so the server can start (and tests run) without credentials.
let client: Anthropic | undefined;

export async function streamAnswer(
  ctx: VideoContext,
  history: ChatTurn[],
  currentTime: number | undefined,
  onText: (text: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const messages: Anthropic.Beta.BetaMessageParam[] = history.map((turn, i) => {
    const isLast = i === history.length - 1;
    if (!isLast || turn.role !== "user" || currentTime === undefined) return turn;
    // Playback position travels with the newest question so the cached system prompt stays stable.
    return {
      role: "user",
      content: `${turn.content}\n\n(Viewer's current position: ${formatTimestamp(currentTime)})`,
    };
  });

  client ??= new Anthropic();
  const stream = client.beta.messages.stream(
    {
      model: MODEL,
      max_tokens: 8000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
      system: [{ type: "text", text: buildSystemPrompt(ctx), cache_control: { type: "ephemeral" } }],
      messages,
    },
    { signal },
  );

  stream.on("text", onText);
  const final = await stream.finalMessage();
  if (final.stop_reason === "refusal") {
    onText("\n\nSorry, I can't help with that one.");
  }
}
