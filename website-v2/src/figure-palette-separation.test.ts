import { describe, expect, test } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deltaE, oklab, oklch, separation, simulate, GATED_CVD } from '../scripts/oklab-cvd.mjs'

// The separation guard answers a question contrast cannot: can two story
// colours be told APART. A check like that is only worth having if it fails
// when the palette regresses, so this file proves three things: that the
// colour arithmetic matches values that can be derived independently, that the
// guard passes the real tree, and -- the one that matters -- that reverting
// either re-stepped ink to what it used to be turns the guard red again.

const here = fileURLToPath(new URL('.', import.meta.url))
const websiteRoot = join(here, '..')
const guard = join(websiteRoot, 'scripts', 'check-figure-palette-separation.mjs')
const realTokens = join(websiteRoot, 'src', 'styles', 'tokens.semantic.css')

function runGuard(args: string[] = []) {
  const r = spawnSync('node', [guard, ...args], { cwd: websiteRoot, encoding: 'utf8' })
  return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

function withTokens(replacements: [string, string][], run: (path: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'pd-separation-'))
  try {
    const original = readFileSync(realTokens, 'utf8')
    let edited = original
    for (const [from, to] of replacements) {
      expect(edited).toContain(from)
      edited = edited.replace(from, to)
    }
    expect(edited).not.toBe(original) // the substitution actually happened
    const fixture = join(dir, 'tokens.semantic.css')
    writeFileSync(fixture, edited)
    run(fixture)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('oklab-cvd.mjs arithmetic', () => {
  test('the anchors of OKLab', () => {
    // Ottosson's reference points: white is L=1 with no chroma, black is L=0.
    const [Lw, aw, bw] = oklab('#ffffff')
    expect(Lw).toBeCloseTo(1, 5)
    expect(aw).toBeCloseTo(0, 5)
    expect(bw).toBeCloseTo(0, 5)
    expect(oklab('#000000')[0]).toBeCloseTo(0, 6)
    // A grey has no chroma at all, whatever its lightness.
    expect(oklch('#808080')[1]).toBeCloseTo(0, 5)
    // Distance is a metric: zero to itself, symmetric.
    expect(deltaE('#003fb8', '#003fb8')).toBe(0)
    expect(deltaE('#003fb8', '#312865')).toBeCloseTo(deltaE('#312865', '#003fb8'), 10)
    // White to black is the full lightness axis, x100.
    expect(deltaE('#ffffff', '#000000')).toBeCloseTo(100, 4)
  })

  test('a grey is unchanged by every CVD simulation', () => {
    // The Machado matrices are near-rows-sum-to-one, so an achromatic colour
    // comes back achromatic. If this drifts, the matrices were mistranscribed.
    for (const kind of ['protanopia', 'deuteranopia', 'tritanopia'] as const) {
      const [, a, b] = simulate('#808080', kind)
      expect(Math.hypot(a, b)).toBeLessThan(0.01)
    }
  })

  test('red-green pairs collapse under protanopia, and blue-yellow do not', () => {
    // The direction of the effect, not just its magnitude: a red/green pair
    // must lose far more separation than a blue/yellow pair under protanopia.
    const redGreen = deltaE('#bf2f2f', '#1f7a4d') / separation('#bf2f2f', '#1f7a4d').protanopia
    const blueYellow = deltaE('#003fb8', '#666a00') / separation('#003fb8', '#666a00').protanopia
    expect(redGreen).toBeGreaterThan(blueYellow)
  })

  test('only protanopia and deuteranopia gate', () => {
    // The >= 8 / >= 6 thresholds are calibrated on the two red-green forms.
    // Gating on tritanopia as well would have failed pdcobalt/pdteal, which is
    // a perfectly separable pair under every form the standard measures.
    expect([...GATED_CVD]).toEqual(['protanopia', 'deuteranopia'])
    const s = separation('#003fb8', '#006b5f')
    expect(s.tritanopia).toBeLessThan(6)
    expect(s.worstGated).toBeGreaterThan(15)
  })

  test('the separations this palette is documented on', () => {
    // The numbers BRAND.md and tokens.semantic.css state in prose.
    expect(separation('#003fb8', '#312865').normal).toBeCloseTo(15.1, 1)
    expect(separation('#003fb8', '#312865').worstGated).toBeCloseTo(14.7, 1)
    expect(separation('#003fb8', '#822586').protanopia).toBeCloseTo(8.6, 1)
    expect(deltaE('#312865', '#822586')).toBeCloseTo(17.0, 1)
    // ...and the collapse each replaced.
    expect(separation('#003fb8', '#353a85').normal).toBeCloseTo(9.1, 1)
    expect(separation('#003fb8', '#933fa5').protanopia).toBeCloseTo(4.8, 1)
  })

  test('the pair that cannot be fixed really is that close', () => {
    // pdteal/pdhealth: 6.4 against a floor of 15. If this ever rises above the
    // floor on its own, the waiver in the guard is wrong and should be deleted.
    expect(separation('#006b5f', '#1f7a4d').normal).toBeLessThan(15)
  })
})

describe('check-figure-palette-separation.mjs', () => {
  test('passes the real tree', () => {
    const { code, out } = runGuard()
    expect(out).toContain('✓ figure-palette separation')
    expect(code).toBe(0)
  })

  test('FAILS when indigo is reverted to the step that collapsed into cobalt', () => {
    withTokens([['--story-indigo: #312865', '--story-indigo: #353a85']], (fixture) => {
      const { code, out } = runGuard(['--tokens', fixture])
      expect(code).toBe(1)
      expect(out).toMatch(/pdcobalt\/pdindigo: normal-vision Delta E 9\.1 is below the 15 floor/)
    })
  })

  test('FAILS when violet is reverted to the step that collapsed under protanopia', () => {
    withTokens([['--story-violet: #822586', '--story-violet: #933fa5']], (fixture) => {
      const { code, out } = runGuard(['--tokens', fixture])
      expect(code).toBe(1)
      expect(out).toMatch(/pdcobalt\/pdviolet: Delta E 4\.8 under simulated CVD is below the 6 floor/)
    })
  })

  test('FAILS when a waived pair is made worse rather than better', () => {
    // A pair that cannot be fixed is pinned, not ignored. Paling gold drives
    // pdgold/pdrust below the value it is pinned at, and that is a regression
    // even though the pair is already under the floor.
    withTokens([['--story-gold: #666a00', '--story-gold: #6d5010']], (fixture) => {
      const { code, out } = runGuard(['--tokens', fixture])
      expect(code).toBe(1)
      expect(out).toMatch(/pdgold\/pdrust: normal-vision Delta E fell to/)
    })
  })

  test('FAILS when an ink drops below its contrast floor on the cream', () => {
    withTokens([['--story-rust: #7a4514', '--story-rust: #b07a44']], (fixture) => {
      const { code, out } = runGuard(['--tokens', fixture])
      expect(code).toBe(1)
      expect(out).toMatch(/pdrust #b07a44 is 3\.18:1 on the cream/)
    })
  })
})
