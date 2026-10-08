import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { VideoContext } from '../types'
import { formatTimestamp } from '../time'

interface Props {
  video: VideoContext
  currentTime: number
  onSeek: (seconds: number) => void
  onPasteTranscript: (text: string) => Promise<void>
  recipe: ReactNode
}

type Tab = 'recipe' | 'chapters' | 'transcript' | 'info'

const TAB_LABEL: Record<Tab, string> = { recipe: 'Recipe', chapters: 'Chapters', transcript: 'Transcript', info: 'Info' }

function activeIndex(starts: number[], t: number): number {
  let idx = -1
  for (let i = 0; i < starts.length; i++) {
    if (starts[i] <= t + 0.25) idx = i
    else break
  }
  return idx
}

export function SidePanel({ video, currentTime, onSeek, onPasteTranscript, recipe }: Props) {
  const [tab, setTab] = useState<Tab>('recipe')
  const [follow, setFollow] = useState(true)
  const listRef = useRef<HTMLDivElement>(null)

  const chapterIdx = activeIndex(video.chapters.map((c) => c.start), currentTime)
  const transcriptStarts = useMemo(() => video.transcript.map((s) => s.start), [video.transcript])
  const lineIdx = activeIndex(transcriptStarts, currentTime)

  useEffect(() => {
    if (!follow || tab !== 'transcript' || lineIdx < 0) return
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${lineIdx}"]`)
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [lineIdx, follow, tab])

  return (
    <section className="side-panel">
      <div className="tabs" role="tablist">
        {(Object.keys(TAB_LABEL) as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>

      <div className="tab-body" ref={listRef}>
        {tab === 'recipe' && recipe}
        {tab === 'chapters' &&
          (video.chapters.length ? (
            <ol className="chapters">
              {video.chapters.map((c, i) => (
                <li key={c.start}>
                  <button className={i === chapterIdx ? 'current' : ''} onClick={() => onSeek(c.start)}>
                    <span className="time">{formatTimestamp(c.start)}</span>
                    <span dir="auto">{c.title}</span>
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <p className="muted">This video has no chapters. Ask the assistant to find a section, e.g. "skip to the part about testing".</p>
          ))}

        {tab === 'transcript' &&
          (video.transcript.length ? (
            <>
              <label className="follow">
                <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> Follow along
                {video.transcriptSource === 'manual' && <span className="muted"> · pasted transcript</span>}
              </label>
              <div className="transcript">
                {video.transcript.map((s, i) => (
                  <button key={i} data-idx={i} className={i === lineIdx ? 'current' : ''} onClick={() => onSeek(s.start)}>
                    <span className="time">{formatTimestamp(s.start)}</span>
                    <span dir="auto">{s.text}</span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <PasteTranscript onSubmit={onPasteTranscript} />
          ))}

        {tab === 'info' && <Info video={video} />}
      </div>
    </section>
  )
}

function PasteTranscript({ onSubmit }: { onSubmit: (text: string) => Promise<void> }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <div className="paste">
      <p className="muted">
        No captions could be fetched for this video, so answers rely on the title and description. If the video has a transcript on
        YouTube (⋯ → Show transcript), copy it and paste it here.
      </p>
      <textarea dir="auto" value={text} onChange={(e) => setText(e.target.value)} rows={8} placeholder={'0:00\nWelcome to the course…'} />
      {error && <p className="error">{error}</p>}
      <button
        className="primary"
        disabled={!text.trim() || busy}
        onClick={async () => {
          setBusy(true)
          setError(null)
          try {
            await onSubmit(text)
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to save transcript')
          } finally {
            setBusy(false)
          }
        }}
      >
        {busy ? 'Saving…' : 'Use this transcript'}
      </button>
    </div>
  )
}

function Info({ video }: { video: VideoContext }) {
  const m = video.metadata
  return (
    <div className="info">
      <dl>
        <dt>Channel</dt>
        <dd>{m.author}</dd>
        <dt>Length</dt>
        <dd>{formatTimestamp(m.lengthSeconds)}</dd>
        {m.publishDate && (
          <>
            <dt>Published</dt>
            <dd>{new Date(m.publishDate).toLocaleDateString()}</dd>
          </>
        )}
        {m.viewCount !== undefined && (
          <>
            <dt>Views</dt>
            <dd>{m.viewCount.toLocaleString()}</dd>
          </>
        )}
        {m.category && (
          <>
            <dt>Category</dt>
            <dd>{m.category}</dd>
          </>
        )}
        <dt>Comments</dt>
        <dd>{video.comments.length ? `${video.comments.length} top comments read` : 'Not available'}</dd>
        <dt>Transcript</dt>
        <dd>
          {video.transcript.length
            ? `${video.transcript.length} lines${video.transcriptLanguage ? ` (${video.transcriptLanguage})` : ''}`
            : 'Not available'}
        </dd>
      </dl>
      {m.keywords.length > 0 && (
        <div className="tags">
          {m.keywords.slice(0, 20).map((k) => (
            <span key={k}>{k}</span>
          ))}
        </div>
      )}
      {m.description && <p className="description" dir="auto">{m.description}</p>}
    </div>
  )
}
