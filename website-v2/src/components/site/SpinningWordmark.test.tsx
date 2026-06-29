// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { SpinningWordmark } from './SpinningWordmark'
import { ThemeContext } from '@/lib/theme-context'

afterEach(cleanup)

describe('SpinningWordmark', () => {
  it('generates unique SVG resource ids for each rendered instance', () => {
    render(
      <ThemeContext.Provider value={{ theme: 'light', toggle: () => {} }}>
        <SpinningWordmark />
        <SpinningWordmark />
      </ThemeContext.Provider>,
    )

    const wordmarks = screen.getAllByRole('img', { name: 'Port Daddy' })
    expect(wordmarks).toHaveLength(2)

    const instanceIds = wordmarks.map((svg) => {
      const ids = Array.from(svg.querySelectorAll('[id]'), (element) => element.id)
      const maskIds = ids.filter((id) => id.startsWith('pdw-mask-'))
      const radialWashIds = ids.filter((id) => id.startsWith('pdw-rad-wash-'))
      const wordWashIds = ids.filter((id) => id.startsWith('pdw-word-wash-'))
      expect(maskIds).toHaveLength(1)
      expect(radialWashIds).toHaveLength(1)
      expect(wordWashIds).toHaveLength(1)

      const [maskId] = maskIds
      const [radialWashId] = radialWashIds
      const [wordWashId] = wordWashIds
      expect(svg.querySelector(`[id="${maskId}"]`)?.localName).toBe('mask')
      expect(svg.querySelector(`[id="${radialWashId}"]`)?.localName).toBe('radialGradient')
      expect(svg.querySelector(`[id="${wordWashId}"]`)?.localName).toBe('linearGradient')

      const referencedResourceIds = new Set(
        Array.from(svg.querySelectorAll('*')).flatMap((element) =>
          ['fill', 'mask', 'stroke']
            .map((attribute) => element.getAttribute(attribute))
            .flatMap((value) => {
              const match = value?.match(/^url\(#(.+)\)$/)
              return match ? [match[1]] : []
            }),
        ),
      )
      expect(referencedResourceIds).toEqual(new Set(ids))

      return ids
    })
    const allIds = instanceIds.flat()

    expect(instanceIds[0]).toHaveLength(3)
    expect(instanceIds[1]).toHaveLength(3)
    expect(new Set(allIds).size).toBe(allIds.length)
    expect(allIds.every((id) => /^pdw-[A-Za-z0-9_-]+$/.test(id))).toBe(true)
  })
})
