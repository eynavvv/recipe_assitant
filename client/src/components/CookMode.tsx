import { useEffect, useState } from 'react'
import type { Recipe } from '../types'
import { formatTimestamp } from '../time'

interface Props {
  recipe: Recipe
  stepIndex: number
  loopStep: boolean
  timerEndsAt: number | null
  onStep: (index: number) => void
  onReplay: () => void
  onToggleLoop: () => void
  onStartTimer: (seconds: number) => void
  onCancelTimer: () => void
  onExit: () => void
}

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const tick = () => setNow(Date.now())
    const first = window.setTimeout(tick, 0)
    const id = window.setInterval(tick, 250)
    return () => {
      window.clearTimeout(first)
      window.clearInterval(id)
    }
  }, [active])
  return now
}

export function CookMode(props: Props) {
  const { recipe, stepIndex } = props
  const step = recipe.steps[stepIndex]
  const now = useNow(props.timerEndsAt !== null)
  // Clamp to the step's timer so a stale clock never shows more than was set.
  const remaining =
    props.timerEndsAt !== null ? Math.min(step.timerSeconds ?? Infinity, Math.max(0, Math.ceil((props.timerEndsAt - now) / 1000))) : null
  const isLast = stepIndex === recipe.steps.length - 1

  return (
    <section className="cook">
      <header className="cook-head">
        <span className="muted">
          Step {stepIndex + 1} of {recipe.steps.length}
        </span>
        <div className="progress" aria-hidden="true">
          <div style={{ width: `${((stepIndex + 1) / recipe.steps.length) * 100}%` }} />
        </div>
        <button className="ghost small" onClick={props.onExit}>
          Exit cooking
        </button>
      </header>

      <p className="cook-step" aria-live="polite" dir="auto">
        {step.text}
      </p>

      <div className="cook-tools">
        {step.start !== null && (
          <button className="ghost" onClick={props.onReplay}>
            ↻ Watch step {step.end !== null && `(${formatTimestamp(step.end - step.start)})`}
          </button>
        )}
        {step.timerSeconds !== null && remaining === null && (
          <button className="ghost" onClick={() => props.onStartTimer(step.timerSeconds!)}>
            ⏱ Start {formatTimestamp(step.timerSeconds)} timer
          </button>
        )}
        {remaining !== null && (
          <button className={`ghost timer ${remaining === 0 ? 'ring' : ''}`} onClick={props.onCancelTimer} title="Cancel timer">
            ⏱ {remaining === 0 ? "Time's up" : formatTimestamp(remaining)} ✕
          </button>
        )}
        <label className="toggle">
          <input type="checkbox" checked={props.loopStep} onChange={props.onToggleLoop} /> Loop this step
        </label>
      </div>

      <nav className="cook-nav">
        <button className="ghost big" onClick={() => props.onStep(stepIndex - 1)} disabled={stepIndex === 0}>
          ← Previous
        </button>
        <button className="primary big" onClick={() => (isLast ? props.onExit() : props.onStep(stepIndex + 1))}>
          {isLast ? 'Finish' : 'Next step →'}
        </button>
      </nav>
    </section>
  )
}
