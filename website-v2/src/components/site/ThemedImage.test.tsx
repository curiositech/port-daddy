// @vitest-environment jsdom
import { render, cleanup, fireEvent } from '@testing-library/react'
import { afterEach, describe, it, expect } from 'vitest'
import { ThemeContext, type Theme } from '@/lib/theme-context'
import { ThemedImage, toDarkSrc } from './ThemedImage'

afterEach(cleanup)

function renderThemed(theme: Theme, props: Parameters<typeof ThemedImage>[0]) {
  return render(
    <ThemeContext.Provider value={{ theme, toggle: () => {} }}>
      <ThemedImage {...props} />
    </ThemeContext.Provider>,
  )
}

const getImg = (c: HTMLElement) => c.querySelector('img') as HTMLImageElement

describe('toDarkSrc', () => {
  it('inserts -dark before the extension', () => {
    expect(toDarkSrc('/img/manifesto/collision.webp')).toBe('/img/manifesto/collision-dark.webp')
  })

  it('preserves a query string and hash after the extension', () => {
    expect(toDarkSrc('/img/a.jpg?v=2#x')).toBe('/img/a-dark.jpg?v=2#x')
    expect(toDarkSrc('/img/a.jpg#frag')).toBe('/img/a-dark.jpg#frag')
  })

  it('does not treat a dot in a directory as an extension', () => {
    // The only dot is before the last slash → no extension to split on.
    expect(toDarkSrc('/img/v1.2/logo')).toBe('/img/v1.2/logo')
  })

  it('leaves an extensionless filename untouched', () => {
    expect(toDarkSrc('/img/banner')).toBe('/img/banner')
  })
})

describe('ThemedImage', () => {
  it('renders the light src in light mode', () => {
    const { container } = renderThemed('light', { src: '/img/x.webp', alt: 'x' })
    expect(getImg(container).getAttribute('src')).toBe('/img/x.webp')
  })

  it('renders the -dark sibling in dark mode', () => {
    const { container } = renderThemed('dark', { src: '/img/x.webp', alt: 'x' })
    expect(getImg(container).getAttribute('src')).toBe('/img/x-dark.webp')
  })

  it('forwards alt / className / loading to the underlying <img>', () => {
    const { container } = renderThemed('light', {
      src: '/img/x.webp',
      alt: 'a description',
      className: 'foo',
      loading: 'eager',
    })
    const img = getImg(container)
    expect(img.getAttribute('alt')).toBe('a description')
    expect(img.className).toBe('foo')
    expect(img.getAttribute('loading')).toBe('eager')
  })

  it('falls back to the light src when the dark sibling errors in dark mode', () => {
    const { container } = renderThemed('dark', { src: '/img/x.webp', alt: 'x' })
    const img = getImg(container)
    expect(img.getAttribute('src')).toBe('/img/x-dark.webp')
    // Simulate the dark variant 404 / decode failure.
    fireEvent.error(img)
    expect(getImg(container).getAttribute('src')).toBe('/img/x.webp')
  })

  it('re-attempts the dark sibling after the src changes', () => {
    const props = { alt: 'x' }
    const { container, rerender } = render(
      <ThemeContext.Provider value={{ theme: 'dark', toggle: () => {} }}>
        <ThemedImage src="/img/a.webp" {...props} />
      </ThemeContext.Provider>,
    )
    // Force a fallback on the first image.
    fireEvent.error(getImg(container))
    expect(getImg(container).getAttribute('src')).toBe('/img/a.webp')
    // A different src should optimistically try its dark sibling again.
    rerender(
      <ThemeContext.Provider value={{ theme: 'dark', toggle: () => {} }}>
        <ThemedImage src="/img/b.webp" {...props} />
      </ThemeContext.Provider>,
    )
    expect(getImg(container).getAttribute('src')).toBe('/img/b-dark.webp')
  })

  it('invokes a caller onError only after the light fallback is exhausted', () => {
    let calls = 0
    const { container } = renderThemed('dark', {
      src: '/img/x.webp',
      alt: 'x',
      onError: () => { calls += 1 },
    })
    const img = getImg(container)
    // First error → silent fallback to light, caller not notified yet.
    fireEvent.error(img)
    expect(calls).toBe(0)
    // Light source also fails → now the caller's handler fires.
    fireEvent.error(getImg(container))
    expect(calls).toBe(1)
  })
})
