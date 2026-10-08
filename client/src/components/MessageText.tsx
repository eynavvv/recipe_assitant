import type { ReactNode } from 'react'
import { TIMESTAMP_RE, parseTimestamp } from '../time'

interface Props {
  text: string
  onSeek: (seconds: number) => void
}

// Renders inline `code`, **bold** and clickable [m:ss] timestamps.
function renderInline(text: string, onSeek: (s: number) => void, keyBase: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = new RegExp(`${TIMESTAMP_RE.source}|\`([^\`]+)\`|\\*\\*([^*]+)\\*\\*`, 'g')
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const key = `${keyBase}-${i++}`
    if (m[1]) {
      const seconds = parseTimestamp(m[1])
      out.push(
        seconds === null ? (
          m[0]
        ) : (
          <button key={key} className="ts-chip" onClick={() => onSeek(seconds)} title={`Jump to ${m[1]}`}>
            ▶ {m[1]}
          </button>
        ),
      )
    } else if (m[2]) out.push(<code key={key}>{m[2]}</code>)
    else if (m[3]) out.push(<strong key={key}>{m[3]}</strong>)
    last = re.lastIndex
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export function MessageText({ text, onSeek }: Props) {
  // Split out fenced code blocks first; everything else is paragraphs.
  const parts = text.split(/```(?:[\w-]+)?\n?([\s\S]*?)(?:```|$)/)
  return (
    <>
      {parts.map((part, idx) =>
        idx % 2 === 1 ? (
          <pre key={idx}>
            <code>{part.replace(/\n$/, '')}</code>
          </pre>
        ) : (
          part
            .split(/\n{2,}/)
            .filter((p) => p.trim())
            .map((para, j) => (
              <p key={`${idx}-${j}`}>
                {para.split('\n').map((line, k) => (
                  <span key={k}>
                    {k > 0 && <br />}
                    {renderInline(line, onSeek, `${idx}-${j}-${k}`)}
                  </span>
                ))}
              </p>
            ))
        ),
      )}
    </>
  )
}
