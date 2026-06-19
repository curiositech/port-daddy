// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { ActivityFeed } from './ActivityFeed'
import { vi, describe, it, expect } from 'vitest'

vi.mock('@/hooks/useActivityStream', () => ({
  useActivityStream: () => ({ activities: [], connected: true })
}))

vi.mock('@/hooks/useTimeline', () => ({
  useTimeline: () => ({ events: [] })
}))

describe('ActivityFeed', () => {
  it('renders the feed header', () => {
    render(<ActivityFeed />)
    expect(screen.getByText(/Live Radio/i)).toBeDefined()
  })
})
