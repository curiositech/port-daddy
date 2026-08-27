// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { HarnessLifecycleVessel, HARNESS_LIFECYCLE_STAGES } from './HarnessLifecycleVessel'

afterEach(cleanup)

describe('HarnessLifecycleVessel', () => {
  it('exposes all lifecycle stations as keyboard-addressable tabs', () => {
    render(<HarnessLifecycleVessel />)
    const tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(HARNESS_LIFECYCLE_STAGES.length)
    expect(tabs[0].getAttribute('aria-selected')).toBe('true')

    fireEvent.keyDown(tabs[0], { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: /UserPromptSubmit/i }).getAttribute('aria-selected')).toBe('true')

    fireEvent.keyDown(screen.getByRole('tab', { name: /SessionStart/i }), { key: 'ArrowDown' })
    expect(screen.getByRole('tab', { name: /UserPromptSubmit/i }).getAttribute('aria-selected')).toBe('true')

    fireEvent.keyDown(screen.getByRole('tab', { name: /Stop \/ SessionEnd/i }), { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: /SessionStart/i }).getAttribute('aria-selected')).toBe('true')
  })

  it('supports reverse navigation and wraps the first station to the last', () => {
    render(<HarnessLifecycleVessel />)

    const sessionStart = screen.getByRole('tab', { name: /SessionStart/i })
    fireEvent.keyDown(sessionStart, { key: 'ArrowLeft' })
    expect(screen.getByRole('tab', { name: /Stop \/ SessionEnd/i }).getAttribute('aria-selected')).toBe('true')

    fireEvent.keyDown(screen.getByRole('tab', { name: /Stop \/ SessionEnd/i }), { key: 'ArrowUp' })
    expect(screen.getByRole('tab', { name: /PreCompact/i }).getAttribute('aria-selected')).toBe('true')
  })

  it('moves both directions between ordinary middle stations', () => {
    render(<HarnessLifecycleVessel />)

    const preTool = screen.getByRole('tab', { name: /PreToolUse/i })
    preTool.focus()
    fireEvent.keyDown(preTool, { key: 'ArrowRight' })
    const postTool = screen.getByRole('tab', { name: /PostToolUse/i })
    expect(postTool.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(postTool)

    fireEvent.keyDown(postTool, { key: 'ArrowLeft' })
    expect(preTool.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(preTool)

    fireEvent.keyDown(preTool, { key: 'ArrowDown' })
    expect(screen.getByRole('tab', { name: /PostToolUse/i }).getAttribute('aria-selected')).toBe('true')

    fireEvent.keyDown(screen.getByRole('tab', { name: /PostToolUse/i }), { key: 'ArrowUp' })
    expect(preTool.getAttribute('aria-selected')).toBe('true')
  })

  it('keeps focus, selection, and roving tab stops aligned during rapid navigation', () => {
    render(<HarnessLifecycleVessel />)

    const sessionStart = screen.getByRole('tab', { name: /SessionStart/i })
    sessionStart.focus()
    fireEvent.keyDown(sessionStart, { key: 'ArrowRight' })
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowRight' })
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowRight' })

    const postTool = screen.getByRole('tab', { name: /PostToolUse/i })
    expect(document.activeElement).toBe(postTool)
    expect(postTool.getAttribute('aria-selected')).toBe('true')
    expect(postTool.getAttribute('tabindex')).toBe('0')
    expect(
      screen.getAllByRole('tab').filter((tab) => tab.getAttribute('tabindex') === '0'),
    ).toEqual([postTool])
  })

  it('retains native Enter and Space activation for every station button', async () => {
    const user = userEvent.setup()
    render(<HarnessLifecycleVessel />)

    const preCompact = screen.getByRole('tab', { name: /PreCompact/i })
    preCompact.focus()
    await user.keyboard('{Enter}')
    expect(preCompact.getAttribute('aria-selected')).toBe('true')

    const sessionEnd = screen.getByRole('tab', { name: /Stop \/ SessionEnd/i })
    sessionEnd.focus()
    await user.keyboard(' ')
    expect(sessionEnd.getAttribute('aria-selected')).toBe('true')
  })

  it('changes the evidence panel when a station is selected', () => {
    render(<HarnessLifecycleVessel />)
    fireEvent.click(screen.getByRole('tab', { name: /PreCompact/i }))
    expect(screen.getByRole('tabpanel').textContent).toContain('Context pressure rises')
    expect(screen.getByRole('tabpanel').textContent).toContain('Compaction packet + successor edges')
  })
})
