import { describe, expect, test } from 'vitest'
import { VT } from './vt'
import { PORTHOLE_ANSI_THEME } from './theme'
import { readableTerminalStyle, terminalTone } from './readable-colors'
const style = { fg:null, bg:null, b:false, d:false, i:false, u:false, inv:false }
describe('theme-readable terminal presentation', () => {
  test('truecolor and256 color input retain their bytes while using paired website inks', () => {
    const vt=new VT(80,5,PORTHOLE_ANSI_THEME)
    vt.feed('\x1b[38;2;125;180;255mblue source\x1b[0m \x1b[38;5;114mgreen source')
    expect(vt.lines[0].map(cell=>cell.ch).join('')).toBe('blue source green source')
    expect(vt.lines[0][0].st.fg).toBe('rgb(125,180,255)')
    expect(readableTerminalStyle(vt.lines[0][0].st)).toContain('var(--ph-tone-blue-ink)')
    expect(readableTerminalStyle(vt.lines[0].at(-1)!.st)).toContain('var(--ph-tone-green-ink)')
  })
  test('inverse error runs get a paired foreground instead of white on pink', () => {
    const vt=new VT(80,5,PORTHOLE_ANSI_THEME)
    vt.feed('\x1b[31;47;7mcommand exited 1')
    const result=readableTerminalStyle(vt.lines[0][0].st)
    expect(result).toContain('color:var(--ph-tone-red-ink)')
    expect(result).toContain('background:var(--ph-tone-red-bg)')
  })
  test('dim remains distinguishable without opacity reducing foreground contrast', () => {
    const result=readableTerminalStyle({...style,d:true,fg:'var(--ph-flag)'})
    expect(result).toContain('var(--ph-tone-muted-ink)')
    expect(result).toContain('font-style:italic')
    expect(result).not.toContain('opacity')
  })
  test('unknown numeric colors fall into readable hue roles; arbitrary style content never passes through', () => {
    expect(terminalTone('rgb(242,190,81)')).toBe('yellow')
    expect(terminalTone('rgb(135,215,255)')).toBe('blue')
    expect(terminalTone('rgb(2,3,4)')).toBe('blue')
    expect(readableTerminalStyle({...style,fg:'red;background:url(javascript:evil)'})).toBe('color:var(--ph-tone-neutral-ink);')
  })
})
