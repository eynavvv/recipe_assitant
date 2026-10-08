import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatMessage, Recipe, VideoContext } from './types'
import { useYouTubePlayer } from './hooks/useYouTubePlayer'
import { useSpeechRecognition, useSpeechSynthesis } from './hooks/useSpeech'
import { useWakeLock } from './hooks/useWakeLock'
import { ChatPanel } from './components/ChatPanel'
import { SidePanel } from './components/SidePanel'
import { RecipeView } from './components/RecipeView'
import { CookMode } from './components/CookMode'
import { extractSeek, toSpeakable } from './time'
import { parseVoiceCommand } from './recipe'

const newId = () => Math.random().toString(36).slice(2)
// In hands-free mode the mic also hears the video, so free-form questions need a wake word
// unless the video is paused. Short commands like "next" always work.
const WAKE_RE = /^(hey |ok |okay )?(chef|cook|assistant)[,.!]?\s+/i

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

  const [recipe, setRecipe] = useState<Recipe | null>(null)
  const [recipeLoading, setRecipeLoading] = useState(false)
  const [recipeError, setRecipeError] = useState<string | null>(null)
  const [servings, setServings] = useState<number | null>(null)

  const [cookStep, setCookStep] = useState<number | null>(null)
  const [loopStep, setLoopStep] = useState(true)
  const [handsFree, setHandsFree] = useState(false)
  const [timerEndsAt, setTimerEndsAt] = useState<number | null>(null)

  const player = useYouTubePlayer(video?.videoId ?? null)
  const tts = useSpeechSynthesis()
  // Remembers whether the video was playing before a voice question paused it.
  const resumeAfterRef = useRef(false)
  const cooking = cookStep !== null && !!recipe?.steps.length
  useWakeLock(cooking)

  const loadRecipe = useCallback(async (videoId: string) => {
    setRecipe(null)
    setRecipeError(null)
    setRecipeLoading(true)
    try {
      const res = await fetch(`/api/video/${videoId}/recipe`)
      if (!res.ok) throw new Error(await readError(res))
      const r: Recipe = await res.json()
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
      const res = await fetch('/api/video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      if (!res.ok) throw new Error(await readError(res))
      const ctx: VideoContext = await res.json()
      setVideo(ctx)
      setMessages([])
      setCookStep(null)
      loadRecipe(ctx.videoId)
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
    const ctx: VideoContext = await res.json()
    setVideo(ctx)
    loadRecipe(ctx.videoId)
  }

  const say = (text: string, onDone?: () => void) => {
    if (speakReplies || handsFree) tts.speak(text, onDone)
    else onDone?.()
  }

  // ---- Cook mode ----

  const goToStep = (index: number, announce = handsFree || speakReplies) => {
    if (!recipe || index < 0 || index >= recipe.steps.length) return
    setCookStep(index)
    setTimerEndsAt(null)
    const step = recipe.steps[index]
    if (step.start !== null) player.seekTo(step.start)
    if (announce) tts.speak(`Step ${index + 1}. ${step.text}`)
  }

  const replayStep = () => {
    const step = cookStep !== null ? recipe?.steps[cookStep] : undefined
    if (step?.start != null) player.seekTo(step.start)
  }

  const exitCooking = () => {
    setCookStep(null)
    setHandsFree(false)
    setTimerEndsAt(null)
    tts.cancel()
  }

  // Loop the current step's clip so the cook can glance at it as often as needed.
  useEffect(() => {
    if (!cooking || !loopStep || !player.playing) return
    const step = recipe!.steps[cookStep!]
    if (step.start === null || step.end === null || step.end <= step.start) return
    if (player.currentTime >= step.end + 0.5) player.seekTo(step.start)
  }, [cooking, loopStep, player, recipe, cookStep])

  const { speak } = tts
  useEffect(() => {
    if (timerEndsAt === null) return
    const id = window.setTimeout(() => {
      speak("Time's up!")
      navigator.vibrate?.([300, 150, 300])
    }, Math.max(0, timerEndsAt - Date.now()))
    return () => window.clearTimeout(id)
  }, [timerEndsAt, speak])

  // ---- Chat ----

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

    const resume = () => {
      if (!seeked && resumeAfterRef.current) player.play()
      resumeAfterRef.current = false
    }
    if (viaVoice || speakReplies || handsFree) tts.speak(toSpeakable(full), resume)
    else resume()
  }

  // ---- Voice ----

  const handleVoice = (raw: string) => {
    if (cooking) {
      const cmd = parseVoiceCommand(raw)
      const step = recipe!.steps[cookStep!]
      switch (cmd) {
        case 'next':
          if (cookStep! < recipe!.steps.length - 1) goToStep(cookStep! + 1, true)
          else say("That was the last step. Enjoy your meal!")
          return
        case 'previous':
          goToStep(cookStep! - 1, true)
          return
        case 'repeat':
          tts.speak(`Step ${cookStep! + 1}. ${step.text}`)
          return
        case 'replay':
          replayStep()
          return
        case 'pause':
          player.pause()
          return
        case 'play':
          player.play()
          return
        case 'stop':
          tts.cancel()
          return
        case 'timer':
          if (step.timerSeconds) setTimerEndsAt(Date.now() + step.timerSeconds * 1000)
          tts.speak(step.timerSeconds ? 'Timer started.' : "This step doesn't have a timer.")
          return
      }
      if (handsFree && player.playing) {
        const m = raw.match(WAKE_RE)
        if (!m) return // probably the video talking
        raw = raw.slice(m[0].length)
      }
    }
    if (raw.trim()) send(raw.trim(), true)
  }

  const voice = useSpeechRecognition(handleVoice)

  // Pause the video while the viewer asks a question out loud (not in hands-free, where the mic is always on).
  useEffect(() => {
    if (!voice.listening || handsFree) return
    tts.cancel()
    resumeAfterRef.current = player.playing
    player.pause()
    // Only react to the mic turning on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice.listening])

  // Hands-free: keep listening whenever we're not talking or thinking.
  const { start: startListening } = voice
  useEffect(() => {
    if (!handsFree || !cooking || voice.listening || busy || tts.speaking || voice.error) return
    const id = window.setTimeout(startListening, 400)
    return () => window.clearTimeout(id)
  }, [handsFree, cooking, voice.listening, voice.error, busy, tts.speaking, startListening])

  useEffect(() => {
    if (voice.error) setHandsFree(false)
  }, [voice.error])

  if (!video) {
    return (
      <main className="landing">
        <h1>Recipe Video Assistant</h1>
        <p className="muted">
          Paste a YouTube cooking video. You'll get the recipe written out, a hands-free cook mode that walks you through each step, and
          answers to any question about the dish.
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
          <h1>{video.metadata.title}</h1>
          <span className="muted">{video.metadata.author}</span>
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
              handsFree={handsFree}
              listening={voice.listening}
              voiceSupported={voice.supported}
              timerEndsAt={timerEndsAt}
              onStep={(i) => goToStep(i)}
              onReplay={replayStep}
              onToggleLoop={() => setLoopStep((v) => !v)}
              onToggleHandsFree={() => {
                if (handsFree) voice.stop()
                setHandsFree((v) => !v)
              }}
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
                  onStartCooking={(i) => goToStep(i)}
                  onRetry={() => loadRecipe(video.videoId)}
                />
              }
            />
          )}
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
          voice={voice}
        />
      </div>
    </main>
  )
}
