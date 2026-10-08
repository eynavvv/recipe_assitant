import { formatTimestamp, type TranscriptSegment, type VideoContext } from "./youtube.js";

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

// Everything we know about the video, as tagged sections for a prompt.
export function buildSourceMaterial(ctx: VideoContext): string {
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

  const comments = ctx.comments.length
    ? ctx.comments
        .map((c) => `--- ${c.author}${c.byCreator ? " (video creator)" : ""}, ${c.likes} likes\n${c.text}`)
        .join("\n")
    : "(Comments not available.)";

  const transcript = ctx.transcript.length
    ? chunkTranscript(ctx.transcript)
    : "(No transcript is available. Work from the metadata, description and comments only, and say so when something needs the spoken content.)";

  return `<video_metadata>
${meta}
</video_metadata>

<description>
${m.description || "(empty)"}
</description>

<chapters>
${chapters}
</chapters>

<top_comments>
${comments}
</top_comments>

<transcript language="${ctx.transcriptLanguage ?? "unknown"}">
${transcript}
</transcript>`;
}
