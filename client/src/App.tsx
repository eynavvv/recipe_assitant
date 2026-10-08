import { useRef, useState } from 'react'
import type { ChatMessage, VideoContext } from './types'
import { useYouTubePlayer } from './hooks/useYouTubePlayer'
import { useSpeechSynthesis } from './hooks/useSpeech'
import { ChatPanel } from './components/ChatPanel'
import { SidePanel } from './components/SidePanel'
import { extractSeek, toSpeakable } from './time'

const newId = () => Math.random().toString(36).slice(2)

async function readError(res: Response): Promise<string> {
  try {
    const body = await res.json()
    return body.error ?? `Request failed (${res.status})`
  } catch {
    return `Request failed (${res.status})`
  }
}

export default function App() {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [video, setVideo] = useState<VideoContext | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [busy, setBusy] = useState(false)
  const [speakReplies, setSpeakReplies] = useState(false)

  const player = useYouTubePlayer(video?.videoId ?? null)
  const tts = useSpeechSynthesis()
  // Remembers whether the video was playing before a voice question paused it.
  const resumeAfterRef = useRef(false)

  const loadVideo = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!url.trim()) return
    setLoading(true)
    setLoadError(null)
    try {
      const res = await fetch('/api/video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      if (!res.ok) throw new Error(await readError(res))
      const ctx: VideoContext = await res.json()
      setVideo(ctx)
      setMessages([])
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load video')
    } finally {
      setLoading(false)
    }
  }

  const pasteTranscript = async (text: string) => {
    if (!video) return
    const res = await fetch(`/api/video/${video.videoId}/transcript`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
    if (!res.ok) throw new Error(await readError(res))
    setVideo(await res.json())
  }

  // Pause the video while the viewer asks a question out loud.
  const onListeningChange = (listening: boolean) => {
    if (!listening) return
    tts.cancel()
    resumeAfterRef.current = player.playing
    player.pause()
  }

  const send = async (text: string, viaVoice: boolean) => {
    if (!video || busy) return
    const userMsg: ChatMessage = { id: newId(), role: 'user', content: text }
    const assistantId = newId()
    const history = [...messages, userMsg]
    setMessages([...history, { id: assistantId, role: 'assistant', content: '', pending: true }])
    setBusy(true)
    if (!viaVoice) resumeAfterRef.current = false

    let full = ''
    let seeked = false
    const update = (content: string, pending = true) =>
      setMessages((ms) => ms.map((m) => (m.id === assistantId ? { ...m, content, pending } : m)))

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId: video.videoId,
          currentTime: player.getTime(),
          messages: history.map(({ role, content }) => ({ role, content })),
        }),
      })
      if (!res.ok || !res.body) throw new Error(await readError(res))
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        full += decoder.decode(value, { stream: true })
        const { seconds } = extractSeek(full)
        if (seconds !== null && !seeked) {
          seeked = true
          player.seekTo(seconds)
        }
        update(full)
      }
    } catch (err) {
      full = `Sorry, ${err instanceof Error ? err.message : 'something went wrong'}.`
    }

    const { text: visible } = extractSeek(full)
    update(full, false)
    setBusy(false)

    const resume = () => {
      if (!seeked && resumeAfterRef.current) player.play()
      resumeAfterRef.current = false
    }
    if (speakReplies || viaVoice) tts.speak(toSpeakable(visible), resume)
    else resume()
  }

  if (!video) {
    return (
      <main className="landing">
        <h1>Tutorial Video Assistant</h1>
        <p className="muted">Paste a YouTube tutorial link. Watch it here and ask questions by text or voice, or ask to jump to any part.</p>
        <form onSubmit={loadVideo} className="url-form">
          <input
            type="url"
            inputMode="url"
            placeholder="https://www.youtube.com/watch?v=…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            autoFocus
          />
          <button className="primary" disabled={loading || !url.trim()}>
            {loading ? 'Loading…' : 'Open video'}
          </button>
        </form>
        {loadError && <p className="error">{loadError}</p>}
      </main>
    )
  }

  // Seek commands stay in history so the model sees what it did, but aren't shown.
  const displayMessages = messages.map((m) => (m.role === 'assistant' ? { ...m, content: extractSeek(m.content).text } : m))

  return (
    <main className="app">
      <header className="topbar">
        <button className="ghost" onClick={() => setVideo(null)} aria-label="Open another video">
          ← New video
        </button>
        <div className="title">
          <h1>{video.metadata.title}</h1>
          <span className="muted">{video.metadata.author}</span>
        </div>
      </header>

      <div className="layout">
        <div className="left">
          <div className="player">
            <div ref={player.containerRef} />
          </div>
          <SidePanel video={video} currentTime={player.currentTime} onSeek={player.seekTo} onPasteTranscript={pasteTranscript} />
        </div>
        <ChatPanel
          messages={displayMessages}
          busy={busy}
          speakReplies={speakReplies}
          speaking={tts.speaking}
          ttsSupported={tts.supported}
          onToggleSpeak={() => {
            if (speakReplies) tts.cancel()
            setSpeakReplies((v) => !v)
          }}
          onStopSpeaking={tts.cancel}
          onSend={send}
          onSeek={player.seekTo}
          onListeningChange={onListeningChange}
        />
      </div>
    </main>
  )
}
