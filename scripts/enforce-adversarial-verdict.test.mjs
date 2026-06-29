// Pure-parse tests for enforce-adversarial-verdict. Run with: node --test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractFinalText, parseVerdict } from './enforce-adversarial-verdict.mjs'

test('extractFinalText prefers the result event', () => {
  const raw = JSON.stringify([
    { type: 'system', subtype: 'init' },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'thinking…' }] } },
    { type: 'result', subtype: 'success', result: 'Final review.\nVERDICT: SHIP' },
  ])
  assert.equal(extractFinalText(raw), 'Final review.\nVERDICT: SHIP')
})

test('extractFinalText falls back to last assistant text blocks', () => {
  const raw = JSON.stringify([
    { type: 'assistant', message: { content: [{ type: 'text', text: 'first' }] } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'VERDICT: DO-NOT-SHIP' }] } },
  ])
  assert.equal(extractFinalText(raw), 'VERDICT: DO-NOT-SHIP')
})

test('extractFinalText handles newline-delimited JSON', () => {
  const raw = [
    JSON.stringify({ type: 'system', subtype: 'init' }),
    JSON.stringify({ type: 'result', result: 'NDJSON works. VERDICT: SHIP-AFTER-FIX' }),
  ].join('\n')
  assert.equal(extractFinalText(raw), 'NDJSON works. VERDICT: SHIP-AFTER-FIX')
})

test('extractFinalText returns null on garbage', () => {
  assert.equal(extractFinalText('not json at all'), null)
})

test('parseVerdict picks the last verdict, case-insensitive', () => {
  assert.equal(parseVerdict('VERDICT: SHIP\n...later...\nVERDICT: do-not-ship'), 'DO-NOT-SHIP')
  assert.equal(parseVerdict('VERDICT: SHIP-AFTER-FIX — one fix'), 'SHIP-AFTER-FIX')
  assert.equal(parseVerdict('VERDICT: SHIP'), 'SHIP')
})

test('parseVerdict returns null when absent', () => {
  assert.equal(parseVerdict('no verdict here'), null)
  assert.equal(parseVerdict(null), null)
})

test('SHIP does not match the DO-NOT-SHIP token greedily', () => {
  // ensure DO-NOT-SHIP is captured whole, not as trailing "SHIP"
  assert.equal(parseVerdict('text VERDICT: DO-NOT-SHIP end'), 'DO-NOT-SHIP')
})
