// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { COLLECTED_VOLUME, TABLE_OF_CONTENTS, TEXTBOOK } from '@/data/whitePapers'
import WhitepaperPage from './index'

afterEach(cleanup)

/** Render the actual route, including legacy pane URLs from old incoming links. */
function renderBook(path = '/whitepaper') {
  return render(<MemoryRouter initialEntries={[path]}><WhitepaperPage /></MemoryRouter>)
}

describe('book reading and navigation', () => {
  test.each(['/whitepaper', '/whitepaper?panel=read', '/whitepaper?panel=limits'])('keeps the full book and outline reachable at %s', (path) => {
    renderBook(path)
    const main = screen.getByRole('main')
    expect(within(main).getByRole('heading', { level: 1 }).textContent).toBe(TEXTBOOK.edition.title)
    const pdf = within(main).getByRole('link', { name: 'Read book (PDF)' })
    expect(pdf.getAttribute('href')).toBe(COLLECTED_VOLUME.pdfPath)
    expect(main.textContent).toContain(`${COLLECTED_VOLUME.pages} pages`)
    expect(screen.queryByRole('tablist')).toBeNull()
    const outline = within(main).getByRole('region', { name: 'Inside the book' })
    const chapters = within(outline).getAllByRole('link')
    const expected = TABLE_OF_CONTENTS.flatMap((part) => part.papers)
    expect(chapters).toHaveLength(8)
    expect(chapters.map((link) => link.getAttribute('href'))).toEqual(expected.map((paper) => paper.readerHref))
    expect(outline.textContent).toContain('chapter overview')
    for (const [index, chapter] of chapters.entries()) expect(chapter.textContent).toContain(expected[index].title)
    expect(within(outline).getAllByRole('heading', { level: 3 })).toHaveLength(4)
  })

  test('keeps optional edition history in a native disclosure after the outline', () => {
    const { container } = renderBook()
    const disclosure = container.querySelector('details')!
    expect(disclosure.open).toBe(false)
    expect(disclosure.querySelector('summary')?.textContent).toBe('About this edition')
    expect(disclosure.textContent).toContain('not deployed')
    expect(Array.from(disclosure.querySelectorAll('a'), (link) => link.getAttribute('href'))).toEqual(['/whitepaper/how-we-prove-game-theory', '/whitepaper/rounds'])
    expect(container.querySelector('#contents')!.compareDocumentPosition(disclosure) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
