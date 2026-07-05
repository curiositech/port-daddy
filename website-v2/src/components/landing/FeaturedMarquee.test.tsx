// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement, type ComponentPropsWithoutRef, type ElementType, type ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FeaturedMarquee } from './FeaturedMarquee'

const useReducedMotionMock = vi.fn()

type MotionProps<T extends ElementType> = ComponentPropsWithoutRef<T> & {
  children?: ReactNode
  initial?: unknown
  animate?: unknown
  exit?: unknown
  transition?: unknown
}

function motionElement<T extends ElementType>(tag: T) {
  return (props: MotionProps<T>) => {
    const domProps = { ...props } as Record<string, unknown>
    delete domProps.initial
    delete domProps.animate
    delete domProps.exit
    delete domProps.transition
    return createElement(tag, domProps)
  }
}

vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
  motion: {
    div: motionElement('div'),
  },
  useReducedMotion: () => useReducedMotionMock(),
}))

function renderFeaturedMarquee() {
  return render(
    <MemoryRouter>
      <FeaturedMarquee />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  useReducedMotionMock.mockReturnValue(false)
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('FeaturedMarquee', () => {
  it('renders concrete audience cards and switches the active spotlight by click', () => {
    renderFeaturedMarquee()

    expect(
      screen.getByRole('heading', { name: /stories that make agent fleets feel real/i }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /how a pr reviews itself/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    fireEvent.click(
      screen.getByRole('button', {
        name: /a credential an agent can narrow, not widen/i,
      }),
    )

    expect(
      screen.getByRole('button', {
        name: /a credential an agent can narrow, not widen/i,
      }),
    ).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getAllByAltText(/leviathan rising over many small agent-ships/i)[0]).toHaveStyle({
      objectPosition: 'center 46%',
    })
  })

  it('auto-advances unless reduced motion is active', () => {
    renderFeaturedMarquee()

    act(() => {
      vi.advanceTimersByTime(6800)
    })

    expect(
      screen.getByRole('button', {
        name: /your ai subscription is already fleet capacity/i,
      }),
    ).toHaveAttribute('aria-pressed', 'true')

    cleanup()
    useReducedMotionMock.mockReturnValue(true)
    const intervalSpy = vi.spyOn(window, 'setInterval')
    renderFeaturedMarquee()

    expect(intervalSpy).not.toHaveBeenCalled()
  })

  it('clears the auto-advance interval on unmount', () => {
    const clearIntervalSpy = vi.spyOn(window, 'clearInterval')
    const { unmount } = renderFeaturedMarquee()

    unmount()

    expect(clearIntervalSpy).toHaveBeenCalledTimes(1)
  })
})
