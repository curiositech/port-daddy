// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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
  })

  it('changes the evidence panel when a station is selected', () => {
    render(<HarnessLifecycleVessel />)
    fireEvent.click(screen.getByRole('tab', { name: /PreCompact/i }))
    expect(screen.getByRole('tabpanel').textContent).toContain('Context pressure rises')
    expect(screen.getByRole('tabpanel').textContent).toContain('Compaction packet + successor edges')
  })
})
