import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatAmount, parseAmount, scaleQuantity } from './recipe.ts'

test('parseAmount', () => {
  assert.equal(parseAmount('200'), 200)
  assert.equal(parseAmount('1 1/2'), 1.5)
  assert.equal(parseAmount('3/4'), 0.75)
  assert.equal(parseAmount('1½'), 1.5)
  assert.equal(parseAmount('½'), 0.5)
  assert.equal(parseAmount('0,5'), 0.5)
  assert.equal(parseAmount('a pinch'), null)
})

test('formatAmount', () => {
  assert.equal(formatAmount(3), '3')
  assert.equal(formatAmount(1.5), '1 1/2')
  assert.equal(formatAmount(0.333), '1/3')
  assert.equal(formatAmount(450), '450')
  assert.equal(formatAmount(1.4), '1.4')
})

test('scaleQuantity', () => {
  assert.equal(scaleQuantity('1 1/2', 2), '3')
  assert.equal(scaleQuantity('200', 1.5), '300')
  assert.equal(scaleQuantity('2-3', 2), '4–6')
  assert.equal(scaleQuantity('1/2', 0.5), '1/4')
  assert.equal(scaleQuantity('a handful', 2), 'a handful')
})
