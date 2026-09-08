import { describe, expect, test } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { contrastRatio, relativeLuminance, AA } from '../scripts/wcag.mjs'

// The figure-palette guard measures every registered ink's WCAG contrast on
// every ground it prints on. Its docstring once claimed that and the code did
// not do it; this file is what keeps the claim true. Three things are proved:
// the arithmetic against known pairs and the numbers BRAND.md records, that
// the guard passes the real tree, and -- the one that matters -- that it FAILS
// when an ink is paled below its floor, so the check cannot silently become a
// no-op again.

const here = fileURLToPath(new URL('.', import.meta.url))
const websiteRoot = join(here, '..')
const guard = join(websiteRoot, 'scripts', 'check-figure-palette.mjs')
const realTokens = join(websiteRoot, 'src', 'styles', 'tokens.semantic.css')

function runGuard(args: string[] = []) {
  const r = spawnSync('node', [guard, ...args], { cwd: websiteRoot, encoding: 'utf8' })
  return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

describe('wcag.mjs arithmetic', () => {
  test('the anchors of the scale', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 2)
    expect(contrastRatio('#123456', '#123456')).toBe(1)
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 6)
    expect(relativeLuminance('#000000')).toBe(0)
    // order of arguments does not matter
    expect(contrastRatio('#805a14', '#f2eee6')).toBe(contrastRatio('#f2eee6', '#805a14'))
  })

  test('the numbers BRAND.md records, to two decimals', () => {
    expect(contrastRatio('#805a14', '#f2eee6')).toBeCloseTo(5.35, 2) // maritime gold on the page
    expect(contrastRatio('#805a14', '#fbf7ef')).toBeCloseTo(5.8, 2)  // maritime gold on plate paper
    expect(contrastRatio('#a66f00', '#f2eee6')).toBeCloseTo(3.71, 2) // amber: large-only
    expect(contrastRatio('#da291c', '#f2eee6')).toBeCloseTo(4.21, 2) // Swiss red: mark-only
  })

  test('the floors are the AA floors', () => {
    expect(AA).toEqual({ text: 4.5, large: 3.0 })
    expect(() => relativeLuminance('#fff')).toThrow(TypeError)
  })

  test('the page check and the palette guard agree on what AA is', () => {
    // Two checks measure type against its ground: check_cover_title_band.py
    // reads its floors from type-over-art.json, this guard from wcag.mjs. A
    // floor edited in one and not the other would let a page pass one check
    // and fail the other for the same line, so they are pinned to each other.
    const manifest = JSON.parse(readFileSync(join(websiteRoot, '..', 'scripts', 'whitepaper-plates', 'type-over-art.json'), 'utf8'))
    expect(manifest.contrast.normal).toBe(AA.text)
    expect(manifest.contrast.large).toBe(AA.large)
  })
})

describe('check-figure-palette.mjs', () => {
  test('passes the real tree', () => {
    const { code, out } = runGuard()
    expect(out).toContain('✓ figure-palette guard')
    expect(code).toBe(0)
  })

  test('FAILS when an ink is paled below its floor (the negative control)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pd-palette-'))
    try {
      const paled = readFileSync(realTokens, 'utf8').replace('--story-rust: #7a4514', '--story-rust: #b07a44')
      expect(paled).not.toBe(readFileSync(realTokens, 'utf8')) // the substitution actually happened
      const fixture = join(dir, 'tokens.semantic.css')
      writeFileSync(fixture, paled)
      const { code, out } = runGuard(['--tokens', fixture])
      expect(code).toBe(1)
      // both halves fire: the LaTeX/token lockstep and the contrast floor
      expect(out).toMatch(/lockstep: pdrust is #7A4514 in pd-palette\.tex but --story-rust is #B07A44/)
      expect(out).toMatch(/contrast: --story-rust #b07a44 is 3\.18:1 on --surface-base .* below the 4\.5:1 floor for role "text"/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
