// Fetches everything the assistant needs to know about a YouTube video:
// metadata, chapters, and the caption transcript.

export interface TranscriptSegment {
  start: number; // seconds
  duration: number; // seconds
  text: string;
}

export interface Chapter {
  start: number; // seconds
  title: string;
}

export interface VideoMetadata {
  title: string;
  author: string;
  channelId?: string;
  description: string;
  lengthSeconds: number;
  viewCount?: number;
  publishDate?: string;
  category?: string;
  keywords: string[];
  thumbnailUrl?: string;
}

export interface Comment {
  author: string;
  text: string;
  likes: number;
  byCreator: boolean;
}

export interface VideoContext {
  videoId: string;
  metadata: VideoMetadata;
  chapters: Chapter[];
  comments: Comment[];
  transcript: TranscriptSegment[];
  transcriptLanguage?: string;
  transcriptSource: "captions" | "manual" | "none";
}

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

export function parseVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (VIDEO_ID_RE.test(trimmed)) return trimmed;
  let url: URL;
  try {
    url = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www\.|m\.|music\.)/, "");
  let id: string | null = null;
  if (host === "youtu.be") {
    id = url.pathname.split("/")[1] ?? null;
  } else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (url.pathname === "/watch") id = url.searchParams.get("v");
    else {
      const m = url.pathname.match(/^\/(embed|shorts|live|v)\/([^/?#]+)/);
      if (m) id = m[2];
    }
  }
  return id && VIDEO_ID_RE.test(id) ? id : null;
}

// "1:02:03" | "12:34" | "0:05" -> seconds
export function parseTimestamp(ts: string): number | null {
  const parts = ts.split(":").map((p) => Number(p));
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => !Number.isFinite(p))) return null;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

export function formatTimestamp(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

// YouTube builds chapters from description lines that start with timestamps,
// as long as the first one is 0:00 and there are at least three.
export function parseChaptersFromDescription(description: string): Chapter[] {
  const chapters: Chapter[] = [];
  const lineRe = /^\s*[([]?((?:\d{1,2}:)?\d{1,2}:\d{2})[)\]]?\s*[-–—:|.]?\s*(.+?)\s*$/;
  for (const line of description.split(/\r?\n/)) {
    const m = line.match(lineRe);
    if (!m) continue;
    const start = parseTimestamp(m[1]);
    if (start === null) continue;
    const title = m[2].replace(/^[-–—:|.\s]+/, "").trim();
    if (title) chapters.push({ start, title });
  }
  if (chapters.length < 2 || chapters[0].start !== 0) return [];
  // Keep chapters strictly increasing; descriptions sometimes list other timestamps.
  return chapters.filter((c, i) => i === 0 || c.start > chapters[i - 1].start);
}

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";

export interface CaptionTrack {
  baseUrl: string;
  languageCode: string;
  kind?: string; // "asr" for auto-generated
  name?: { simpleText?: string; runs?: { text: string }[] };
}

interface PlayerResponse {
  playabilityStatus?: { status?: string; reason?: string };
  videoDetails?: {
    videoId: string;
    title: string;
    author: string;
    channelId?: string;
    shortDescription?: string;
    lengthSeconds?: string;
    viewCount?: string;
    keywords?: string[];
    thumbnail?: { thumbnails?: { url: string; width: number }[] };
  };
  microformat?: {
    playerMicroformatRenderer?: {
      publishDate?: string;
      category?: string;
      description?: { simpleText?: string };
    };
  };
  captions?: {
    playerCaptionsTracklistRenderer?: { captionTracks?: CaptionTrack[] };
  };
}

// Extracts a JSON object assigned in a script, e.g. `var ytInitialPlayerResponse = {...};`
export function extractJsonAfter(html: string, marker: string): unknown | null {
  const idx = html.indexOf(marker);
  if (idx === -1) return null;
  const start = html.indexOf("{", idx + marker.length);
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

// Chapters YouTube shows in the player, which also covers auto-generated ones.
export function extractChaptersFromInitialData(data: unknown): Chapter[] {
  const json = JSON.stringify(data ?? {});
  const chapters: Chapter[] = [];
  const re = /"chapterRenderer":\{"title":\{"simpleText":"((?:[^"\\]|\\.)*)"\},"timeRangeStartMillis":(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(json))) {
    chapters.push({ title: JSON.parse(`"${m[1]}"`), start: Math.round(Number(m[2]) / 1000) });
  }
  const seen = new Set<number>();
  return chapters.filter((c) => !seen.has(c.start) && seen.add(c.start));
}

async function fetchWatchPage(videoId: string): Promise<{ player: PlayerResponse | null; initialData: unknown }> {
  const res = await fetch(`https://www.youtube.com/watch?v=${videoId}&hl=en`, {
    headers: { "User-Agent": USER_AGENT, "Accept-Language": "en-US,en;q=0.9", Cookie: "CONSENT=YES+1" },
  });
  if (!res.ok) throw new Error(`YouTube returned ${res.status} for the watch page`);
  const html = await res.text();
  return {
    player: extractJsonAfter(html, "ytInitialPlayerResponse") as PlayerResponse | null,
    initialData: extractJsonAfter(html, "ytInitialData"),
  };
}

// The Android client's player response usually carries caption URLs that work
// without the web client's proof-of-origin token.
async function fetchInnertubePlayer(videoId: string): Promise<PlayerResponse | null> {
  const res = await fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip",
    },
    body: JSON.stringify({
      videoId,
      context: { client: { clientName: "ANDROID", clientVersion: "20.10.38", androidSdkVersion: 34, hl: "en" } },
    }),
  });
  if (!res.ok) return null;
  return (await res.json()) as PlayerResponse;
}

// Prefer captions in the language actually spoken. The auto-generated ("asr") track tells us
// which language that is; a human-made track in the same language beats it.
export function pickCaptionTrack(tracks: CaptionTrack[]): CaptionTrack | undefined {
  const lang = (t: CaptionTrack) => t.languageCode.split("-")[0];
  const asr = tracks.find((t) => t.kind === "asr");
  if (asr) return tracks.find((t) => t.kind !== "asr" && lang(t) === lang(asr)) ?? asr;
  return tracks.find((t) => lang(t) === "en") ?? tracks[0];
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

// Handles both caption XML formats: legacy <text start dur> and srv3 <p t d>.
export function parseCaptionXml(xml: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  const legacy = /<text start="([\d.]+)"(?: dur="([\d.]+)")?[^>]*>([\s\S]*?)<\/text>/g;
  const srv3 = /<p t="(\d+)"(?: d="(\d+)")?[^>]*>([\s\S]*?)<\/p>/g;
  let m: RegExpExecArray | null;
  while ((m = legacy.exec(xml))) {
    segments.push({ start: Number(m[1]), duration: Number(m[2] ?? 0), text: m[3] });
  }
  if (segments.length === 0) {
    while ((m = srv3.exec(xml))) {
      segments.push({ start: Number(m[1]) / 1000, duration: Number(m[2] ?? 0) / 1000, text: m[3] });
    }
  }
  return segments
    .map((s) => ({ ...s, text: decodeEntities(decodeEntities(s.text.replace(/<[^>]+>/g, ""))).replace(/\s+/g, " ").trim() }))
    .filter((s) => s.text.length > 0);
}

async function fetchTranscript(track: CaptionTrack): Promise<TranscriptSegment[]> {
  const res = await fetch(track.baseUrl, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) return [];
  return parseCaptionXml(await res.text());
}

// Accepts transcripts pasted from YouTube's "Show transcript" panel,
// where timestamps sit on their own line or at the start of a line.
export function parsePastedTranscript(text: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  let pendingStart: number | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^\[?((?:\d{1,2}:)?\d{1,2}:\d{2})\]?\s*(.*)$/);
    if (m) {
      const start = parseTimestamp(m[1]);
      if (start !== null) {
        if (m[2]) segments.push({ start, duration: 0, text: m[2] });
        else pendingStart = start;
        continue;
      }
    }
    if (pendingStart !== null) {
      segments.push({ start: pendingStart, duration: 0, text: line });
      pendingStart = null;
    } else if (segments.length > 0) {
      segments[segments.length - 1].text += ` ${line}`;
    } else {
      segments.push({ start: 0, duration: 0, text: line });
    }
  }
  for (let i = 0; i < segments.length - 1; i++) {
    segments[i].duration = Math.max(0, segments[i + 1].start - segments[i].start);
  }
  return segments;
}

interface CommentThreadsResponse {
  items?: {
    snippet: {
      topLevelComment: {
        snippet: {
          authorDisplayName: string;
          authorChannelId?: { value: string };
          textOriginal: string;
          likeCount: number;
        };
      };
    };
  }[];
}

// Recipes often live in the creator's pinned comment. Needs a YouTube Data API key;
// without one, the app works from captions and the description only.
export async function fetchTopComments(videoId: string, channelId?: string, max = 20): Promise<Comment[]> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return [];
  const url = new URL("https://www.googleapis.com/youtube/v3/commentThreads");
  url.search = new URLSearchParams({
    part: "snippet",
    videoId,
    order: "relevance",
    textFormat: "plainText",
    maxResults: String(max),
    key,
  }).toString();
  const res = await fetch(url);
  if (!res.ok) return [];
  return parseCommentThreads((await res.json()) as CommentThreadsResponse, channelId);
}

export function parseCommentThreads(data: CommentThreadsResponse, channelId?: string): Comment[] {
  const comments = (data.items ?? []).map(({ snippet }) => {
    const c = snippet.topLevelComment.snippet;
    return {
      author: c.authorDisplayName,
      text: c.textOriginal,
      likes: c.likeCount,
      byCreator: !!channelId && c.authorChannelId?.value === channelId,
    };
  });
  // Creator comments first: that's where the written recipe usually is.
  return [...comments.filter((c) => c.byCreator), ...comments.filter((c) => !c.byCreator)];
}

export async function loadVideoContext(videoId: string): Promise<VideoContext> {
  const [page, innertube] = await Promise.all([
    fetchWatchPage(videoId).catch(() => ({ player: null, initialData: null })),
    fetchInnertubePlayer(videoId).catch(() => null),
  ]);
  const player = page.player?.videoDetails ? page.player : innertube;
  const details = player?.videoDetails ?? innertube?.videoDetails;
  if (!details) {
    const reason = page.player?.playabilityStatus?.reason ?? innertube?.playabilityStatus?.reason;
    throw new Error(reason ? `YouTube says: ${reason}` : "Could not load this video from YouTube");
  }
  const micro = page.player?.microformat?.playerMicroformatRenderer ?? player?.microformat?.playerMicroformatRenderer;
  const description = details.shortDescription ?? micro?.description?.simpleText ?? "";
  const thumbs = details.thumbnail?.thumbnails ?? [];

  const metadata: VideoMetadata = {
    title: details.title,
    author: details.author,
    channelId: details.channelId,
    description,
    lengthSeconds: Number(details.lengthSeconds ?? 0),
    viewCount: details.viewCount ? Number(details.viewCount) : undefined,
    publishDate: micro?.publishDate,
    category: micro?.category,
    keywords: details.keywords ?? [],
    thumbnailUrl: thumbs.length ? thumbs[thumbs.length - 1].url : undefined,
  };

  let chapters = extractChaptersFromInitialData(page.initialData);
  if (chapters.length === 0) chapters = parseChaptersFromDescription(description);

  // Try caption tracks from both responses; the first that yields text wins.
  const trackSources = [innertube, page.player];
  let transcript: TranscriptSegment[] = [];
  let transcriptLanguage: string | undefined;
  for (const src of trackSources) {
    const tracks = src?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
    const track = pickCaptionTrack(tracks);
    if (!track) continue;
    transcript = await fetchTranscript(track).catch(() => []);
    if (transcript.length) {
      transcriptLanguage = track.languageCode;
      break;
    }
  }

  const comments = await fetchTopComments(videoId, details.channelId).catch(() => []);

  return {
    videoId,
    metadata,
    chapters,
    comments,
    transcript,
    transcriptLanguage,
    transcriptSource: transcript.length ? "captions" : "none",
  };
}
