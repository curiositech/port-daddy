import { Link } from 'react-router-dom'
import {
  chapterRecordFor,
  COLLECTED_VOLUME,
  LIBRARY_CHANGELOG,
  TABLE_OF_CONTENTS,
  TEXTBOOK,
} from '@/data/whitePapers'
import './book.css'

/** Accessible part inks follow the site's theme-aware text palette. */
const PART_INK: Record<string, string> = {
  pdcobalt: 'var(--ui-ink-blue)',
  pdteal: 'var(--ui-ink-teal)',
  pdviolet: 'var(--ui-ink-violet)',
  pdgold: 'var(--ui-ink-gold)',
}

/** One navigable outline; chapter destinations are explicitly labelled overviews. */
function BookContents() {
  return (
    <section className="book-contents" aria-labelledby="book-contents-title" id="contents">
      <h2 id="book-contents-title">Inside the book</h2>
      <p className="book-secondary">Four parts, eight chapters. Follow a title for its chapter overview; the complete book is in the PDF.</p>
      {TABLE_OF_CONTENTS.map((part) => (
        <section className="book-part" key={part.id} aria-labelledby={`part-${part.id}`}>
          <h3 id={`part-${part.id}`} style={{ color: PART_INK[part.color] }}>
            <span className="book-part-number">Part {part.numeral}</span>
            {part.title}
          </h3>
          <ol className="book-chapters">
            {part.papers.map((paper) => {
              const record = chapterRecordFor(paper.id)
              return (
                <li key={paper.id}>
                  <Link className="book-chapter-link" to={paper.readerHref}>
                    <span className="book-chapter-number">{String(paper.chapter).padStart(2, '0')}</span>
                    <span>
                      <span className="book-chapter-title"><span>{paper.title}</span><span aria-hidden="true">→</span></span>
                      <span className="book-chapter-purpose">{record?.oneLine ?? paper.thesis}</span>
                    </span>
                  </Link>
                </li>
              )
            })}
          </ol>
        </section>
      ))}
    </section>
  )
}

/** Book landing page in normal document flow, including historical ?panel= links. */
export default function WhitepaperPage() {
  return (
    <main id="main-content" className="book-page">
      <header className="book-intro">
        <div className="book-intro-copy">
          <p className="book-eyebrow">The Port Daddy book</p>
          <h1>{TEXTBOOK.edition.title}</h1>
          <p className="book-claim">{TEXTBOOK.edition.claim}</p>
        </div>
        <div className="book-reading">
          <p className="book-edition">{TEXTBOOK.edition.version} · {TEXTBOOK.edition.date}</p>
          <a className="book-read" href={COLLECTED_VOLUME.pdfPath}>Read book (PDF) <span aria-hidden="true">→</span></a>
          <p className="book-file-info">{COLLECTED_VOLUME.pages} pages · about {Math.round(COLLECTED_VOLUME.sizeKb / 1024)} MB · free</p>
        </div>
        <img
          className="book-cover"
          src="/whitepaper/plates/cover-swiss.jpg"
          width={1000}
          height={1429}
          alt={`Cover of ${TEXTBOOK.edition.title}`}
          loading="eager"
          decoding="async"
        />
      </header>
      <BookContents />
      <details className="book-about">
        <summary>About this edition</summary>
        <div className="book-about-body">
          <h2>Claims and limits</h2>
          <p>The book distinguishes theorems, design invariants, bounded model-checked properties, and empirical hypotheses. Each chapter ends with its own limitations and boundaries.</p>
          <p>The harbor runs today. The market is specified and, in places, proved; it is not deployed.</p>
          <Link className="book-edition-link" to="/whitepaper/how-we-prove-game-theory">How the game-theory claims are checked <span aria-hidden="true">→</span></Link>
          <br />
          <Link className="book-edition-link" to="/whitepaper/rounds">Read the adversarial review history <span aria-hidden="true">→</span></Link>
          <h2>Edition history</h2>
          <ul className="book-history">
            {LIBRARY_CHANGELOG.slice(0, 3).map((entry) => (
              <li key={entry.dateIso}>
                <time dateTime={entry.dateIso}>{entry.date}</time>
                <h3>{entry.title}</h3>
                <p>{entry.summary}</p>
              </li>
            ))}
          </ul>
        </div>
      </details>
    </main>
  )
}
