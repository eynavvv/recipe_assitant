import { useEffect, useRef, useState } from 'react'
import type { ChatMessage } from '../types'
import { MessageText } from './MessageText'
import { useSpeechRecognition } from '../hooks/useSpeech'

interface Props {
  messages: ChatMessage[]
  busy: boolean
  speakReplies: boolean
  speaking: boolean
  ttsSupported: boolean
  onToggleSpeak: () => void
  onStopSpeaking: () => void
  onSend: (text: string, viaVoice: boolean) => void
  onSeek: (seconds: number) => void
  onListeningChange: (listening: boolean) => void
}

const SUGGESTIONS = ['Summarize this video', 'What do I need before starting?', 'Skip to the main demo', 'Who made this and when?']

export function ChatPanel(props: Props) {
  const { messages, busy, onSend, onSeek } = props
  const [input, setInput] = useState('')
  const endRef = useRef<HTMLDivElement>(null)
  const voice = useSpeechRecognition((text) => onSend(text, true))

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages])

  const onListeningChangeRef = useRef(props.onListeningChange)
  useEffect(() => {
    onListeningChangeRef.current = props.onListeningChange
  })
  useEffect(() => onListeningChangeRef.current(voice.listening), [voice.listening])

  const submit = () => {
    const text = input.trim()
    if (!text || busy) return
    setInput('')
    onSend(text, false)
  }

  return (
    <section className="chat">
      <header className="chat-header">
        <h2>Ask about this video</h2>
        {props.ttsSupported && (
          <label className="toggle" title="Read every answer aloud">
            <input type="checkbox" checked={props.speakReplies} onChange={props.onToggleSpeak} /> Speak answers
          </label>
        )}
        {props.speaking && (
          <button className="ghost small" onClick={props.onStopSpeaking}>
            Stop speaking
          </button>
        )}
      </header>

      <div className="messages">
        {messages.length === 0 && (
          <div className="empty">
            <p className="muted">Ask anything about the video, or tell me where to jump. Try:</p>
            <div className="suggestions">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => onSend(s, false)} disabled={busy}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`msg ${m.role}`}>
            {m.role === 'assistant' ? (
              m.content ? (
                <MessageText text={m.content} onSeek={onSeek} />
              ) : (
                <span className="typing" aria-label="Thinking">
                  <i />
                  <i />
                  <i />
                </span>
              )
            ) : (
              <p>{m.content}</p>
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {voice.error && <p className="error small">{voice.error}</p>}

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <textarea
          value={voice.listening ? voice.interim : input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
          placeholder={voice.listening ? 'Listening…' : 'Ask a question, or say "skip to…"'}
          rows={1}
          readOnly={voice.listening}
        />
        {voice.supported && (
          <button
            type="button"
            className={`mic ${voice.listening ? 'on' : ''}`}
            onClick={() => (voice.listening ? voice.stop() : voice.start())}
            disabled={busy && !voice.listening}
            aria-label={voice.listening ? 'Stop listening' : 'Ask by voice'}
            title={voice.listening ? 'Stop listening' : 'Ask by voice'}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path
                fill="currentColor"
                d="M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z"
              />
            </svg>
          </button>
        )}
        <button type="submit" className="primary" disabled={busy || !input.trim() || voice.listening}>
          Send
        </button>
      </form>
    </section>
  )
}
