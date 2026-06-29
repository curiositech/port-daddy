// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { useState } from 'react'
import { Hero } from './Hero'
import { SiteHeader } from '@/components/site/SiteHeader'
import { HeroWordmarkContext } from '@/lib/hero-brand-context'
import { ThemeContext } from '@/lib/theme-context'

vi.mock('./LiveGloryVideo', () => ({
  LiveGloryVideo: () => <div data-testid="live-glory-video" />,
}))

const originalIntersectionObserver = globalThis.IntersectionObserver

class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = []

  readonly observed: Element[] = []
  readonly root = null
  readonly rootMargin: string
  readonly thresholds: ReadonlyArray<number>

  constructor(
    private readonly callback: IntersectionObserverCallback,
    options?: IntersectionObserverInit,
  ) {
    this.rootMargin = options?.rootMargin ?? ''
    this.thresholds = Array.isArray(options?.threshold)
      ? options.threshold
      : [options?.threshold ?? 0]
    MockIntersectionObserver.instances.push(this)
  }

  observe = (element: Element) => {
    this.observed.push(element)
  }

  unobserve = vi.fn()
  disconnect = vi.fn()
  takeRecords = () => []

  trigger(target: Element, isIntersecting: boolean) {
    this.callback(
      [{ target, isIntersecting } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    )
  }
}

function renderHeroShell() {
  function Harness() {
    const [heroWordmarkVisible, setHeroWordmarkVisible] = useState(true)

    return (
      <MemoryRouter>
        <ThemeContext.Provider value={{ theme: 'dark', toggle: () => {} }}>
          <HeroWordmarkContext.Provider
            value={{ heroWordmarkVisible, setHeroWordmarkVisible }}
          >
            <SiteHeader />
            <Hero />
          </HeroWordmarkContext.Provider>
        </ThemeContext.Provider>
      </MemoryRouter>
    )
  }

  return render(<Harness />)
}

function homeLink() {
  const link = document.querySelector('header a[aria-label^="Port Daddy"]')
  expect(link).toBeInstanceOf(HTMLAnchorElement)
  return link as HTMLAnchorElement
}

function heroWordmarkContainers() {
  const svgs = document.querySelectorAll('section svg[aria-label="Port Daddy"]')
  expect(svgs).toHaveLength(2)

  return Array.from(svgs, (svg) => {
    const container = svg.closest('[aria-hidden="true"]')
    expect(container).toBeInstanceOf(HTMLElement)
    return container as HTMLElement
  })
}

beforeEach(() => {
  MockIntersectionObserver.instances = []
  globalThis.IntersectionObserver =
    MockIntersectionObserver as unknown as typeof IntersectionObserver
})

afterEach(() => {
  cleanup()
  globalThis.IntersectionObserver = originalIntersectionObserver
  vi.restoreAllMocks()
})

describe('Hero wordmark observer', () => {
  it('hides the navbar wordmark while either responsive hero wordmark is visible', () => {
    renderHeroShell()

    expect(MockIntersectionObserver.instances).toHaveLength(1)
    const [observer] = MockIntersectionObserver.instances
    expect(observer.rootMargin).toBe('-80px 0px 0px 0px')
    expect(observer.observed).toHaveLength(2)

    const [mobileMark, desktopMark] = heroWordmarkContainers()
    expect(observer.observed).toEqual([mobileMark, desktopMark])
    expect(mobileMark.className).toContain('float-right')
    expect(mobileMark.className).toContain('ml-[var(--space-3)]')
    expect(mobileMark.className).toContain('h-32')
    expect(mobileMark.className).toContain('min-[1100px]:hidden')
    expect(mobileMark.className).toContain('sm:h-40')
    expect(homeLink()).toHaveClass('opacity-0')

    act(() => observer.trigger(mobileMark, true))
    expect(homeLink()).toHaveAttribute('aria-hidden', 'true')
    expect(homeLink()).toHaveAttribute('tabindex', '-1')
    expect(homeLink()).toHaveClass('opacity-0')

    act(() => observer.trigger(mobileMark, false))
    expect(homeLink()).not.toHaveAttribute('aria-hidden')
    expect(homeLink()).not.toHaveAttribute('tabindex')
    expect(homeLink()).toHaveClass('opacity-100')

    act(() => observer.trigger(desktopMark, true))
    expect(homeLink()).toHaveAttribute('aria-hidden', 'true')
    expect(homeLink()).toHaveAttribute('tabindex', '-1')
    expect(homeLink()).toHaveClass('opacity-0')

    act(() => observer.trigger(desktopMark, false))
    expect(homeLink()).not.toHaveAttribute('aria-hidden')
    expect(homeLink()).not.toHaveAttribute('tabindex')
    expect(homeLink()).toHaveClass('opacity-100')
  })

  it('renders the compact product definition and mobile story panel', () => {
    renderHeroShell()

    expect(screen.getByRole('heading', { name: /runs a tight ship/i })).toBeInTheDocument()
    expect(screen.getByText('Agents are better when they coordinate.')).toBeInTheDocument()
    expect(screen.getByText('Port Daddy is')).toBeInTheDocument()
    expect(screen.getByText(/an agent event-triggering lab/i)).toBeInTheDocument()
    expect(screen.getByText(/Codex/i)).toBeInTheDocument()
    expect(document.querySelectorAll('[data-product-logo]')).toHaveLength(5)
    expect(document.querySelector('[data-product-logo="claude"]')).toHaveAttribute(
      'title',
      'Anthropic Claude',
    )
    expect(screen.queryByText('local install')).not.toBeInTheDocument()
    expect(screen.queryByText(/brew install curiositech/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /mac app/i })).not.toBeInTheDocument()
    expect(screen.getAllByTestId('live-glory-video')).toHaveLength(2)
  })
})
