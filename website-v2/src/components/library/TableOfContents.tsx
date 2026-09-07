import { Link } from 'react-router-dom'
import { ArrowRight, FileText } from 'lucide-react'
import { TABLE_OF_CONTENTS, chapterRoleLabel, type WhitePaper } from '@/data/whitePapers'

/**
 * The Book's table of contents: four parts, seven chapters, in the order the
 * argument needs. It is the ONLY ordering the site draws. There is no
 * separate reading order, dependency DAG, or nesting diagram any more: the
 * order is the dependency order (each chapter stands on the ones before it,
 * and each proving chapter follows the chapter whose promises it keeps), and
 * every number here comes from whitepaper/textbook.json via ./textbook.json.
 *
 * Each part row carries the part's hue as a rule; the hue is the part's, not
 * the chapter's, so a chapter never competes with the part it sits in.
 */

const PART_RULE: Record<string, string> = {
  pdcobalt: 'bg-[var(--brand-primary)]',
  pdteal: 'bg-[var(--brand-accent)]',
  pdviolet: 'bg-[var(--story-violet)]',
  pdgold: 'bg-[var(--story-gold)]',
}

function ChapterRow({ paper, onSelect }: { paper: WhitePaper; onSelect?: (id: string) => void }) {
  const title = onSelect ? (
    <button
      type="button"
      onClick={() => onSelect(paper.id)}
      className="text-left font-display text-[length:var(--text-lg)] font-black leading-[var(--leading-nav)] text-[var(--text-primary)] underline-offset-4 hover:text-[var(--brand-primary)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)]"
    >
      {paper.title}
    </button>
  ) : (
    <Link
      to={paper.readerHref}
      className="font-display text-[length:var(--text-lg)] font-black leading-[var(--leading-nav)] text-[var(--text-primary)] underline-offset-4 hover:text-[var(--brand-primary)] hover:underline"
    >
      {paper.title}
    </Link>
  )
  return (
    <li className="grid grid-cols-[2.75rem,1fr] gap-[var(--space-3)] border-t-2 border-[var(--border-default)] py-[var(--space-3)] first:border-t-0">
      <span className="font-mono text-[length:var(--text-xl)] font-black leading-none text-[var(--text-primary)]">
        {paper.chapter}
      </span>
      <div className="min-w-0 space-y-[var(--space-1)]">
        <div className="flex flex-wrap items-baseline gap-x-[var(--space-3)] gap-y-[var(--space-1)]">
          {title}
          <span className="font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
            {chapterRoleLabel(paper)} · {paper.pages} pp
          </span>
        </div>
        <p className="text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
          {paper.claim}
        </p>
        <div className="flex flex-wrap gap-[var(--space-3)] pt-[var(--space-1)] font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)]">
          <Link
            to={paper.readerHref}
            className="inline-flex items-center gap-[var(--space-1)] text-[var(--text-primary)] underline underline-offset-4 hover:text-[var(--brand-primary)] hover:no-underline"
          >
            Read
            <ArrowRight aria-hidden="true" size={12} />
          </Link>
          <a
            href={paper.pdfPath}
            className="inline-flex items-center gap-[var(--space-1)] text-[var(--text-secondary)] underline underline-offset-4 hover:text-[var(--brand-primary)] hover:no-underline"
          >
            <FileText aria-hidden="true" size={12} />
            PDF
          </a>
        </div>
      </div>
    </li>
  )
}

export function TableOfContents({ onSelect }: { onSelect?: (id: string) => void }) {
  return (
    <nav aria-label="Table of contents" className="grid gap-[var(--space-5)]">
      {TABLE_OF_CONTENTS.map((part) => (
        <section
          key={part.id}
          aria-labelledby={`toc-part-${part.id}`}
          className="border-2 border-[var(--border-strong)] bg-[var(--surface-base)] shadow-[var(--shadow-brutal)]"
        >
          <div className={`h-[6px] w-full ${PART_RULE[part.color] ?? 'bg-[var(--brand-primary)]'}`} aria-hidden="true" />
          <header className="grid gap-[var(--space-2)] border-b-2 border-[var(--border-strong)] p-[var(--space-5)]">
            <span className="font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
              Part {part.numeral}
            </span>
            <h3
              id={`toc-part-${part.id}`}
              className="font-display text-[length:var(--text-2xl)] font-black leading-[var(--leading-display-tight)] text-[var(--text-primary)]"
            >
              {part.title}
            </h3>
            <p className="max-w-[64ch] text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
              {part.blurb}
            </p>
          </header>
          <ol className="px-[var(--space-5)]">
            {part.papers.map((paper) => (
              <ChapterRow key={paper.id} paper={paper} onSelect={onSelect} />
            ))}
          </ol>
        </section>
      ))}
    </nav>
  )
}
