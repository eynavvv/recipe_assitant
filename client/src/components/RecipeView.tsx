import { useState } from 'react'
import type { Recipe } from '../types'
import { formatTimestamp } from '../time'
import { scaleQuantity } from '../recipe'

interface Props {
  recipe: Recipe | null
  loading: boolean
  error: string | null
  servings: number | null
  onServingsChange: (n: number) => void
  onSeek: (seconds: number) => void
  onStartCooking: (stepIndex: number) => void
  onRetry: () => void
}

const SOURCE_LABEL = { spoken: 'said in video', description: 'from description', comment: 'from comments', inferred: 'seen in video, amount not given' }

export function RecipeView({ recipe, loading, error, servings, onServingsChange, onSeek, onStartCooking, onRetry }: Props) {
  const [checked, setChecked] = useState<Set<number>>(new Set())

  if (loading)
    return (
      <div className="recipe-loading">
        <span className="typing" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <p className="muted">Reading the video, description and comments to write up the recipe…</p>
      </div>
    )
  if (error)
    return (
      <div className="recipe-loading">
        <p className="error">{error}</p>
        <button className="ghost small" onClick={onRetry}>
          Try again
        </button>
      </div>
    )
  if (!recipe) return null
  if (!recipe.isRecipe)
    return <p className="muted pad">This doesn't look like a cooking video, so there's no recipe card. You can still ask questions in the chat.</p>

  const factor = recipe.servings && servings ? servings / recipe.servings : 1

  return (
    <div className="recipe" dir="auto">
      <div className="recipe-head">
        <div>
          <h3>{recipe.title}</h3>
          <p className="muted small">
            {[recipe.totalTime, `${recipe.steps.length} steps`, `${recipe.ingredients.length} ingredients`].filter(Boolean).join(' · ')}
          </p>
        </div>
        <button className="primary" onClick={() => onStartCooking(0)} disabled={!recipe.steps.length}>
          Start cooking
        </button>
      </div>

      {recipe.servings && servings && (
        <div className="servings">
          <span>Servings</span>
          <button className="ghost small" onClick={() => onServingsChange(Math.max(1, servings - 1))} aria-label="Fewer servings">
            −
          </button>
          <strong>{servings}</strong>
          <button className="ghost small" onClick={() => onServingsChange(servings + 1)} aria-label="More servings">
            +
          </button>
          {factor !== 1 && <span className="muted small">scaled from {recipe.servings}</span>}
        </div>
      )}

      <h4>Ingredients</h4>
      <ul className="ingredients">
        {recipe.ingredients.map((ing, i) => {
          const header = ing.group && ing.group !== recipe.ingredients[i - 1]?.group ? ing.group : null
          const qty = ing.quantity ? scaleQuantity(ing.quantity, factor) : null
          return (
            <li key={i}>
              {header && <div className="group">{header}</div>}
              <label className={checked.has(i) ? 'done' : ''}>
                <input
                  type="checkbox"
                  checked={checked.has(i)}
                  onChange={() =>
                    setChecked((s) => {
                      const next = new Set(s)
                      if (next.has(i)) next.delete(i)
                      else next.add(i)
                      return next
                    })
                  }
                />
                <span>
                  {qty && <strong>{[qty, ing.unit].filter(Boolean).join(' ')} </strong>}
                  {ing.name}
                  {ing.note && <span className="muted">, {ing.note}</span>}
                  {ing.source === 'inferred' && <span className="badge" title={SOURCE_LABEL.inferred}>?</span>}
                </span>
              </label>
            </li>
          )
        })}
      </ul>

      <h4>Steps</h4>
      <ol className="steps">
        {recipe.steps.map((step, i) => (
          <li key={i}>
            <span>{step.text}</span>
            <span className="step-actions">
              {step.start !== null && (
                <button className="ts-chip" onClick={() => onSeek(step.start!)}>
                  ▶ {formatTimestamp(step.start)}
                </button>
              )}
              <button className="link" onClick={() => onStartCooking(i)}>
                Cook from here
              </button>
            </span>
          </li>
        ))}
      </ol>

      {recipe.tips.length > 0 && (
        <>
          <h4>Tips</h4>
          <ul className="notes">
            {recipe.tips.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </>
      )}
      {recipe.gaps.length > 0 && (
        <>
          <h4>Not clear from the video</h4>
          <ul className="notes muted">
            {recipe.gaps.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
