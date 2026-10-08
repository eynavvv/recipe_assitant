const UNICODE_FRACTIONS: Record<string, number> = {
  '¼': 0.25, '½': 0.5, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875,
}

// "1 1/2" | "1½" | "200" | "0.5" | "3/4" -> number
export function parseAmount(s: string): number | null {
  let text = s.trim()
  let total = 0
  const uni = text.match(/[¼½¾⅓⅔⅛⅜⅝⅞]$/)
  if (uni) {
    total += UNICODE_FRACTIONS[uni[0]]
    text = text.slice(0, -1).trim()
    if (!text) return total
  }
  const m = text.match(/^(?:(\d+(?:[.,]\d+)?)\s+)?(\d+(?:[.,]\d+)?)(?:\/(\d+))?$/)
  if (!m) return null
  const whole = m[1] ? Number(m[1].replace(',', '.')) : 0
  const num = Number(m[2].replace(',', '.'))
  const frac = m[3] ? num / Number(m[3]) : num
  if (m[1] && !m[3]) return null // "1 2" isn't a quantity
  return total + whole + frac
}

const NICE_FRACTIONS: [number, string][] = [
  [0.125, '1/8'], [0.25, '1/4'], [1 / 3, '1/3'], [0.5, '1/2'], [2 / 3, '2/3'], [0.75, '3/4'],
]

export function formatAmount(n: number): string {
  if (n >= 10) return String(Math.round(n))
  const whole = Math.floor(n)
  const rest = n - whole
  if (rest < 0.06) return String(whole || n.toFixed(2).replace(/0+$/, ''))
  if (rest > 0.94) return String(whole + 1)
  const near = NICE_FRACTIONS.find(([v]) => Math.abs(v - rest) < 0.04)
  if (near) return whole ? `${whole} ${near[1]}` : near[1]
  return String(Math.round(n * 10) / 10)
}

// Scales a quantity as written; ranges like "2-3" scale both ends. Unparseable text is kept.
export function scaleQuantity(quantity: string, factor: number): string {
  if (factor === 1) return quantity
  const range = quantity.split(/\s*[-–]\s*/)
  const scaled = range.map((part) => {
    const n = parseAmount(part)
    return n === null ? null : formatAmount(n * factor)
  })
  if (scaled.some((p) => p === null)) return quantity
  return scaled.join('–')
}
