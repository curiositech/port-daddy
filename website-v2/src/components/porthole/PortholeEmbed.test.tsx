// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PortholeEmbed } from './PortholeEmbed'

const loadMock = vi.fn().mockResolvedValue(undefined)
const destroyMock = vi.fn()
const constructorSpy = vi.fn()

vi.mock('@/lib/porthole/player', () => ({
  PortholePlayer: class {
    constructor(root: HTMLElement, opts: { reducedMotion?: boolean; autoplay?: boolean }) {
      constructorSpy(opts)
    }
    load = loadMock
    destroy = destroyMock
  },
}))

class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = []
  readonly observed: Element[] = []

  constructor(private readonly callback: IntersectionObserverCallback) {
    MockIntersectionObserver.instances.push(this)
  }

  observe = (element: Element) => {
    this.observed.push(element)
  }
  unobserve = vi.fn()
  disconnect = vi.fn()
  takeRecords = () => []
  root = null
  rootMargin = ''
  thresholds: ReadonlyArray<number> = [0]

  trigger(target: Element, isIntersecting: boolean) {
    this.callback([{ target, isIntersecting } as IntersectionObserverEntry], this as unknown as IntersectionObserver)
  }
}

function mockMatchMedia(reducedMotion: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query === '(prefers-reduced-motion: reduce)' ? reducedMotion : false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

beforeEach(() => {
  MockIntersectionObserver.instances = []
  globalThis.IntersectionObserver = MockIntersectionObserver as unknown as typeof IntersectionObserver
  mockMatchMedia(false)
  loadMock.mockClear()
  destroyMock.mockClear()
  constructorSpy.mockClear()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('PortholeEmbed', () => {
  it('does not load until IntersectionObserver reports the embed is visible', () => {
    render(<PortholeEmbed src="/casts/porthole/collision.cast" label="collision" />)
    expect(loadMock).not.toHaveBeenCalled()

    const observer = MockIntersectionObserver.instances[0]
    expect(observer.observed).toHaveLength(1)
    observer.trigger(observer.observed[0], true)

    expect(loadMock).toHaveBeenCalledWith('/casts/porthole/collision.cast')
  })

  it('loads immediately when eager, skipping the IntersectionObserver gate', () => {
    render(<PortholeEmbed src="/casts/porthole/collision.cast" label="collision" eager />)
    expect(loadMock).toHaveBeenCalledWith('/casts/porthole/collision.cast')
  })

  it('does not construct a player with reducedMotion/autoplay true simultaneously', () => {
    mockMatchMedia(false)
    render(<PortholeEmbed src="/casts/porthole/collision.cast" label="collision" eager />)
    expect(constructorSpy).toHaveBeenCalledWith({ reducedMotion: false, autoplay: true })
  })

  it('respects prefers-reduced-motion: disables autoplay and marks the player reduced-motion', () => {
    mockMatchMedia(true)
    render(<PortholeEmbed src="/casts/porthole/collision.cast" label="collision" eager />)
    expect(constructorSpy).toHaveBeenCalledWith({ reducedMotion: true, autoplay: false })
  })

  it('destroys the player and disconnects the observer on unmount', () => {
    const { unmount } = render(<PortholeEmbed src="/casts/porthole/collision.cast" label="collision" />)
    const observer = MockIntersectionObserver.instances[0]
    unmount()
    expect(destroyMock).toHaveBeenCalledTimes(1)
    expect(observer.disconnect).toHaveBeenCalledTimes(1)
  })

  it('exposes an accessible group with the given label', () => {
    const { getByRole } = render(<PortholeEmbed src="/casts/porthole/collision.cast" label="No Collisions demo" />)
    expect(getByRole('group', { name: 'No Collisions demo' })).toBeInTheDocument()
  })
})
