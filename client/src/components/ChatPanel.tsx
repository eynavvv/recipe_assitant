import { useEffect, useRef, useState } from 'react'
import type { ChatMessage } from '../types'
import { MessageText } from './MessageText'

interface Props {
  messages: ChatMessage[]
  busy: boolean
  onSend: (text: string) => void
  onSeek: (seconds: number) => void
}

const SUGGESTIONS = ['What do I need to buy?', 'Can I make this ahead?', 'What can I use instead of butter?', 'Show me the hardest part']

export function ChatPanel(props: Props) {
  const { messages, busy, onSend, onSeek } = props
  const [input, setInput] = useState('')
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages])

  const submit = () => {
    const text = input.trim()
    if (!text || busy) return
    setInput('')
    onSend(text)
  }

  return (
    <section className="chat">
      <header className="chat-header">
        <h2>Ask the cook</h2>
      </header>

      <div className="messages">
        {messages.length === 0 && (
          <div className="empty">
            <p className="muted">Ask about ingredients, steps, swaps or timing, in English or Hebrew, or ask to see a part again. Try:</p>
            <div className="suggestions">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => onSend(s)} disabled={busy}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`msg ${m.role}`} dir="auto">
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


      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
          placeholder='Ask a question, or "show me…"'
          rows={1}
          dir="auto"
        />
        <button type="submit" className="primary" disabled={busy || !input.trim()}>
          Send
        </button>
      </form>
    </section>
  )
}
