export function formatTimestamp(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

export function parseTimestamp(ts: string): number | null {
  const parts = ts.split(':').map(Number)
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => !Number.isFinite(p))) return null
  return parts.reduce((acc, p) => acc * 60 + p, 0)
}

export const TIMESTAMP_RE = /\[((?:\d{1,2}:)?\d{1,2}:\d{2})\]/g
export const SEEK_RE = /\[\[seek ((?:\d{1,2}:)?\d{1,2}:\d{2})\]\]\s*/

// Pulls the assistant's seek command out of its reply text.
export function extractSeek(text: string): { seconds: number | null; text: string } {
  const m = text.match(SEEK_RE)
  if (!m) return { seconds: null, text }
  return { seconds: parseTimestamp(m[1]), text: text.replace(SEEK_RE, '') }
}
