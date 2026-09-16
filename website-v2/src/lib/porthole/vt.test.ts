import { describe, expect, it } from 'vitest'
import { VT, resolve256, lineText, parseCast, replayToTranscript, sourceTimeAtDisplayTime } from './vt'

const THEME: readonly string[] = [
  '#000', '#f00', '#0f0', '#ff0', '#00f', '#f0f', '#0ff', '#fff',
  '#888', '#f88', '#8f8', '#ff8', '#88f', '#f8f', '#8ff', '#ffe',
]

describe('VT — malformed and unknown SGR sequences', () => {
  it('ignores an out-of-range SGR parameter instead of throwing or corrupting style', () => {
    const vt = new VT(20, 5, THEME)
    vt.feed('\x1b[999mhi')
    expect(() => vt.feed('\x1b[999mhi')).not.toThrow()
    expect(lineText(vt.lines[0])).toContain('hi')
    // An unrecognized code must not silently set fg/bg to something wrong.
    expect(vt.st.fg).toBeNull()
    expect(vt.st.bg).toBeNull()
  })

  it('treats an empty SGR parameter list as a full reset (ESC[m)', () => {
    const vt = new VT(20, 5, THEME)
    vt.feed('\x1b[31mred\x1b[mplain')
    expect(vt.st.fg).toBeNull()
    expect(lineText(vt.lines[0])).toBe('redplain')
  })

  it('does not throw on a truncated escape sequence at end of stream', () => {
    const vt = new VT(20, 5, THEME)
    expect(() => vt.feed('before\x1b[')).not.toThrow()
    // The dangling CSI introducer must not have consumed or corrupted the
    // text already written before it.
    expect(lineText(vt.lines[0])).toBe('before')
  })

  it('does not throw when fed byte-by-byte across multiple feed() calls', () => {
    // Mirrors how a real asciicast splits one logical write across many
    // PTY events — the exact scenario AUDIT-2026-08-18.md flagged.
    const vt = new VT(20, 5, THEME)
    const bytes = '\x1b[1;31mhello\x1b[0m'.split('')
    expect(() => {
      for (const b of bytes) vt.feed(b)
    }).not.toThrow()
    expect(lineText(vt.lines[0])).toBe('hello')
  })

  it('resolves 256-color and truecolor SGR codes without throwing on boundary indices', () => {
    const vt = new VT(20, 5, THEME)
    vt.feed('\x1b[38;5;0mlo')
    expect(vt.st.fg).toBe(THEME[0])
    vt.feed('\x1b[38;5;231mhi')
    expect(vt.st.fg).toMatch(/^rgb\(/)
    vt.feed('\x1b[38;5;255mgray')
    expect(vt.st.fg).toMatch(/^rgb\(/)
    vt.feed('\x1b[38;2;10;20;30mtruecolor')
    expect(vt.st.fg).toBe('rgb(10,20,30)')
  })
})

describe('resolve256 boundary fidelity', () => {
  it('passes indices 0-15 straight through the 16-slot base theme', () => {
    for (let i = 0; i < 16; i++) {
      expect(resolve256(i, THEME)).toBe(THEME[i])
    }
  })

  it('computes the 6x6x6 color cube for indices 16-231', () => {
    expect(resolve256(16, THEME)).toBe('rgb(0,0,0)')
    expect(resolve256(231, THEME)).toBe('rgb(255,255,255)')
  })

  it('computes the 24-step grayscale ramp for indices 232-255', () => {
    expect(resolve256(232, THEME)).toBe('rgb(8,8,8)')
    expect(resolve256(255, THEME)).toBe('rgb(238,238,238)')
  })
})

describe('VT — unbounded scrollback', () => {
  it('keeps every line ever produced, not just the last `rows`', () => {
    const rows = 10
    const vt = new VT(40, rows, THEME)
    const total = 500
    // `\r\n`, not bare `\n` — a bare line feed moves to the next row but does
    // NOT reset the column (ECMA-48: LF and CR are distinct), matching real
    // PTY output (canonical mode emits `\r\n`) and how every real cast in
    // this repo is actually captured.
    for (let i = 0; i < total; i++) vt.feed(`line-${i}\r\n`)
    // 500 newlines from a 1-line start produces 501 rows — well past the
    // 10-row viewport a fixed-viewport player (asciinema-player) would keep.
    expect(vt.lines.length).toBeGreaterThan(total)
    expect(vt.lines.length).toBeGreaterThan(rows * 10)
    expect(lineText(vt.lines[0])).toBe('line-0')
    expect(lineText(vt.lines[total - 1])).toBe(`line-${total - 1}`)
  })

  it('wraps a single line far longer than `cols` without dropping characters', () => {
    const cols = 20
    const vt = new VT(cols, 5, THEME)
    const long = Array.from({ length: 5000 }, (_, i) => String((i % 10)) ).join('')
    vt.feed(long)
    const reconstructed = vt.lines.map(lineText).join('')
    expect(reconstructed.length).toBe(long.length)
    expect(reconstructed).toBe(long)
  })
})

describe('parseCast + replayToTranscript', () => {
  it('normalizes v2 absolute and v3 delta timestamps into the same flat event shape', () => {
    const v2 = [
      JSON.stringify({ version: 2, width: 10, height: 3 }),
      JSON.stringify([0, 'o', 'a']),
      JSON.stringify([1.5, 'o', 'b']),
    ].join('\n')
    const v3 = [
      JSON.stringify({ version: 3, width: 10, height: 3 }),
      JSON.stringify([0, 'o', 'a']),
      JSON.stringify([1.5, 'o', 'b']),
    ].join('\n')

    const parsedV2 = parseCast(v2)
    const parsedV3 = parseCast(v3)
    expect(parsedV2.events).toEqual([[0, 'a'], [1.5, 'b']])
    expect(parsedV3.events).toEqual([[0, 'a'], [1.5, 'b']])
  })

  it('replays a full cast to a settled transcript with no timing dependency', () => {
    const cast = parseCast(
      [
        JSON.stringify({ version: 2, width: 10, height: 3 }),
        JSON.stringify([0, 'o', 'hello\r\n']),
        JSON.stringify([0.2, 'o', 'world']),
      ].join('\n'),
    )
    const { lines } = replayToTranscript(cast, THEME)
    expect(lineText(lines[0])).toBe('hello')
    expect(lineText(lines[1])).toBe('world')
  })

  it('turns a real quiet interval into a declared broken axis without dropping output', () => {
    const cast = parseCast(
      [
        JSON.stringify({ version: 2, width: 80, height: 20, timestamp: 1_700_000_000 }),
        JSON.stringify([1, 'o', 'before\r\n']),
        JSON.stringify([121, 'o', 'after']),
      ].join('\n'),
    )
    expect(cast.sourceDuration).toBe(121)
    expect(cast.duration).toBeCloseTo(1.85)
    expect(cast.jumpCuts).toEqual([
      expect.objectContaining({ sourceFrom: 1, sourceTo: 121, displayFrom: 1, displayTo: 1.85 }),
    ])
    expect(sourceTimeAtDisplayTime(cast, 1)).toBe(1)
    expect(sourceTimeAtDisplayTime(cast, 1.85)).toBeCloseTo(121)
    const { lines } = replayToTranscript(cast, THEME)
    expect(lines.map(lineText).join('\n')).toContain('before')
    expect(lines.map(lineText).join('\n')).toContain('after')
  })

  it('advances the v3 clock across ignored input and marker events', () => {
    const cast = parseCast([
      JSON.stringify({ version: 3, term: { cols: 20, rows: 5 } }),
      JSON.stringify([1, 'o', 'a']),
      JSON.stringify([2, 'i', 'secret input is intentionally not replayed']),
      JSON.stringify([3, 'm', 'marker']),
      JSON.stringify([4, 'o', 'b']),
    ].join('\n'))
    expect(cast.sourceDuration).toBe(10)
    expect(cast.events).toEqual([[1, 'a'], [10, 'b']])
  })
})
