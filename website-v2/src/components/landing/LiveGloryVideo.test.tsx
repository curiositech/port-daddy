// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement, type ComponentPropsWithoutRef, type ElementType, type ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeContext } from '@/lib/theme-context'
import { LiveGloryVideo } from './LiveGloryVideo'

const useReducedMotionMock = vi.fn()

type MotionProps<T extends ElementType> = ComponentPropsWithoutRef<T> & {
  children?: ReactNode
  initial?: unknown
  animate?: unknown
  exit?: unknown
  transition?: unknown
  whileHover?: unknown
}

function motionElement<T extends ElementType>(tag: T) {
  return (props: MotionProps<T>) => {
    const domProps = { ...props } as Record<string, unknown>
    delete domProps.initial
    delete domProps.animate
    delete domProps.exit
    delete domProps.transition
    delete domProps.whileHover
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

function renderLiveGloryVideo() {
  return render(
    <MemoryRouter>
      <ThemeContext.Provider value={{ theme: 'dark', toggle: () => {} }}>
        <LiveGloryVideo />
      </ThemeContext.Provider>
    </MemoryRouter>,
  )
}

function spotlightLinkFor(text: string) {
  const match = screen.getAllByText(text).find((node) => node.closest('a'))
  expect(match).toBeInTheDocument()
  const link = match?.closest('a')
  expect(link).toBeInstanceOf(HTMLAnchorElement)
  return link as HTMLAnchorElement
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

describe('LiveGloryVideo', () => {
  it('starts on the subscription fleet story and uses the dark blog image variant', () => {
    renderLiveGloryVideo()

    expect(
      screen.getByRole('button', {
        name: /your ai subscription is already fleet capacity/i,
      }),
    ).toHaveAttribute('aria-pressed', 'true')
    expect(
      spotlightLinkFor('Your AI subscription is already fleet capacity'),
    ).toHaveAttribute('href', '/blog/your-ai-subscription-powers-the-fleet')
    expect(
      screen.getAllByAltText(/single ai subscription badge fanning into many ship-shaped agents/i)[0],
    ).toHaveAttribute('src', '/img/generated/blog-ai-subscription-fleet-hero-dark.jpg')
  })

  it('switches the hero story from the selector', () => {
    renderLiveGloryVideo()

    fireEvent.click(
      screen.getByRole('button', {
        name: /the first command is attention/i,
      }),
    )

    expect(
      screen.getByRole('button', {
        name: /the first command is attention/i,
      }),
    ).toHaveAttribute('aria-pressed', 'true')
    expect(spotlightLinkFor('The first command is attention')).toHaveAttribute(
      'href',
      '/blog/attention-is-the-first-command',
    )
  })

  it('auto-advances unless reduced motion is active', () => {
    renderLiveGloryVideo()

    act(() => {
      vi.advanceTimersByTime(6800)
    })

    expect(
      screen.getByRole('button', {
        name: /one local channel, every trigger/i,
      }),
    ).toHaveAttribute('aria-pressed', 'true')

    cleanup()
    useReducedMotionMock.mockReturnValue(true)
    const intervalSpy = vi.spyOn(window, 'setInterval')
    renderLiveGloryVideo()

    expect(intervalSpy).not.toHaveBeenCalled()
  })
})
