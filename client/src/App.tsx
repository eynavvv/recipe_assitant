import { useCallback, useEffect, useState } from 'react'
import type { ChatMessage, Recipe, TranscriptSegment, VideoContext } from './types'
import { useYouTubePlayer } from './hooks/useYouTubePlayer'
import { useWakeLock } from './hooks/useWakeLock'
import { ChatPanel } from './components/ChatPanel'
import { SidePanel } from './components/SidePanel'
import { RecipeView } from './components/RecipeView'
import { CookMode } from './components/CookMode'
import { extractSeek } from './time'

const newId = () => Math.random().toString(36).slice(2)

async function readError(res: Response): Promise<string> {
  try {
    const body = await res.json()
    return body.error ?? `Request failed (${res.status})`
  } catch {
    return `Request failed (${res.status})`
  }
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await readError(res))
  return res.json()
}

// A short beep for the cooking timer, so it's noticeable across the kitchen.
function beep() {
  try {
    const ctx = new AudioContext()
    for (let i = 0; i < 3; i++) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.frequency.value = 880
      gain.gain.value = 0.2
      osc.connect(gain).connect(ctx.destination)
      osc.start(ctx.currentTime + i * 0.4)
      osc.stop(ctx.currentTime + i * 0.4 + 0.25)
    }
  } catch {
    // No audio available; the timer still turns red.
  }
}

export default function App() {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [video, setVideo] = useState<VideoContext | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [busy, setBusy] = useState(false)

  const [recipe, setRecipe] = useState<Recipe | null>(null)
  const [recipeLoading, setRecipeLoading] = useState(false)
  const [recipeError, setRecipeError] = useState<string | null>(null)
  const [servings, setServings] = useState<number | null>(null)

  const [cookStep, setCookStep] = useState<number | null>(null)
  const [loopStep, setLoopStep] = useState(true)
  const [timerEndsAt, setTimerEndsAt] = useState<number | null>(null)

  const player = useYouTubePlayer(video?.videoId ?? null)
  const cooking = cookStep !== null && !!recipe?.steps.length
  useWakeLock(cooking)

  // The server keeps no state, so the video context goes along with each request.
  const loadRecipe = useCallback(async (ctx: VideoContext) => {
    setRecipe(null)
    setRecipeError(null)
    setRecipeLoading(true)
    try {
      const r = await postJson<Recipe>('/api/recipe', { video: ctx })
      setRecipe(r)
      setServings(r.servings)
    } catch (err) {
      setRecipeError(err instanceof Error ? err.message : 'Failed to read the recipe')
    } finally {
      setRecipeLoading(false)
    }
  }, [])

  const loadVideo = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!url.trim()) return
    setLoading(true)
    setLoadError(null)
    try {
      const ctx = await postJson<VideoContext>('/api/video', { url })
      setVideo(ctx)
      setMessages([])
      setCookStep(null)
      loadRecipe(ctx)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load video')
    } finally {
      setLoading(false)
    }
  }

  const pasteTranscript = async (text: string) => {
    if (!video) return
    const { transcript } = await postJson<{ transcript: TranscriptSegment[] }>('/api/transcript', { text })
    const ctx: VideoContext = { ...video, transcript, transcriptSource: 'manual', transcriptLanguage: undefined }
    setVideo(ctx)
    loadRecipe(ctx)
  }

  // ---- Cook mode ----

  const goToStep = (index: number) => {
    if (!recipe || index < 0 || index >= recipe.steps.length) return
    setCookStep(index)
    setTimerEndsAt(null)
    const step = recipe.steps[index]
    if (step.start !== null) player.seekTo(step.start)
  }

  const replayStep = () => {
    const step = cookStep !== null ? recipe?.steps[cookStep] : undefined
    if (step?.start != null) player.seekTo(step.start)
  }

  const exitCooking = () => {
    setCookStep(null)
    setTimerEndsAt(null)
  }

  // Loop the current step's clip so the cook can glance at it as often as needed.
  useEffect(() => {
    if (!cooking || !loopStep || !player.playing) return
    const step = recipe!.steps[cookStep!]
    if (step.start === null || step.end === null || step.end <= step.start) return
    if (player.currentTime >= step.end + 0.5) player.seekTo(step.start)
  }, [cooking, loopStep, player, recipe, cookStep])

  useEffect(() => {
    if (timerEndsAt === null) return
    const id = window.setTimeout(() => {
      beep()
      navigator.vibrate?.([300, 150, 300])
    }, Math.max(0, timerEndsAt - Date.now()))
    return () => window.clearTimeout(id)
  }, [timerEndsAt])

  // ---- Chat ----

  const send = async (text: string) => {
    if (!video || busy) return
    const userMsg: ChatMessage = { id: newId(), role: 'user', content: text }
    const assistantId = newId()
    const history = [...messages, userMsg]
    setMessages([...history, { id: assistantId, role: 'assistant', content: '', pending: true }])
    setBusy(true)

    let full = ''
    let seeked = false
    const update = (content: string, pending = true) =>
      setMessages((ms) => ms.map((m) => (m.id === assistantId ? { ...m, content, pending } : m)))

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          video,
          recipe: recipe ?? undefined,
          currentTime: player.getTime(),
          cook: cooking ? { stepIndex: cookStep, servings } : servings ? { stepIndex: -1, servings } : undefined,
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

    update(full, false)
    setBusy(false)
  }

  if (!video) {
    return (
      <main className="landing">
        <h1>Recipe Video Assistant</h1>
        <p className="muted">
          Paste a YouTube cooking video. You'll get the recipe written out, a cook mode that walks you through each step, and answers to
          any question about the dish, in English or Hebrew.
        </p>
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
        <button
          className="ghost"
          onClick={() => {
            exitCooking()
            setVideo(null)
          }}
          aria-label="Open another video"
        >
          ← New video
        </button>
        <div className="title">
          <h1 dir="auto">{video.metadata.title}</h1>
          <span className="muted" dir="auto">
            {video.metadata.author}
          </span>
        </div>
      </header>

      <div className={`layout ${cooking ? 'cooking' : ''}`}>
        <div className="left">
          <div className="player">
            <div ref={player.containerRef} />
          </div>
          {cooking ? (
            <CookMode
              recipe={recipe!}
              stepIndex={cookStep!}
              loopStep={loopStep}
              timerEndsAt={timerEndsAt}
              onStep={goToStep}
              onReplay={replayStep}
              onToggleLoop={() => setLoopStep((v) => !v)}
              onStartTimer={(s) => setTimerEndsAt(Date.now() + s * 1000)}
              onCancelTimer={() => setTimerEndsAt(null)}
              onExit={exitCooking}
            />
          ) : (
            <SidePanel
              video={video}
              currentTime={player.currentTime}
              onSeek={player.seekTo}
              onPasteTranscript={pasteTranscript}
              recipe={
                <RecipeView
                  recipe={recipe}
                  loading={recipeLoading}
                  error={recipeError}
                  servings={servings}
                  onServingsChange={setServings}
                  onSeek={player.seekTo}
                  onStartCooking={goToStep}
                  onRetry={() => loadRecipe(video)}
                />
              }
            />
          )}
        </div>
        <ChatPanel messages={displayMessages} busy={busy} onSend={send} onSeek={player.seekTo} />
      </div>
    </main>
  )
}
