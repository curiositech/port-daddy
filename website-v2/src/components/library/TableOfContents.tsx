import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { PanelBody, PanelEyebrow, PanelTitle, SurfacePanel } from '@/components/site/primitives'
import { TABLE_OF_CONTENTS, TEXTBOOK, chapterRoleLabel, type WhitePaper } from '@/data/whitePapers'

/**
 * The Book's table of contents: four parts, eight chapters, in the order the
 * argument needs. It is the ONLY ordering the site draws. There is no
 * separate reading order, dependency DAG, or nesting diagram any more: the
 * order is the dependency order (each chapter stands on the ones before it,
 * and each proving chapter follows the chapter whose promises it keeps), and
 * every number here comes from whitepaper/textbook.json via ./textbook.json.
 *
 * Each row carries the chapter's question (the sentence its opening page asks)
 * rather than a page count or a per-chapter PDF: the Book is one document, and
 * the site points at the chapter, not at a detached file.
 *
 * Typography comes from the site primitives only (eyebrow, title, body), so
 * the contents read in the same three roles as every other public surface.
 */

const PART_RULE: Record<string, string> = {
  pdcobalt: 'bg-[var(--brand-primary)]',
  pdteal: 'bg-[var(--brand-accent)]',
  pdviolet: 'bg-[var(--story-violet)]',
  pdgold: 'bg-[var(--story-gold)]',
}

function chapterQuestion(id: string): string | undefined {
  return TEXTBOOK.chapters.find((chapter) => chapter.id === id)?.question
}

function ChapterRow({ paper, onSelect }: { paper: WhitePaper; onSelect?: (id: string) => void }) {
  const question = chapterQuestion(paper.id)
  return (
    <li className="grid grid-cols-[var(--space-7),1fr] gap-[var(--space-4)] border-t-2 border-[var(--border-default)] py-[var(--space-4)] first:border-t-0">
      <span aria-hidden="true">
        <PanelTitle as="span" size="card">
          {paper.chapter}
        </PanelTitle>
      </span>
      <div className="min-w-0 space-y-[var(--space-2)]">
        <PanelEyebrow>{chapterRoleLabel(paper)}</PanelEyebrow>
        <PanelTitle as="h4" size="nav">
          {onSelect ? (
            <button
              type="button"
              onClick={() => onSelect(paper.id)}
              className="text-left underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)]"
            >
              {paper.title}
            </button>
          ) : (
            <Link to={paper.readerHref} className="underline-offset-4 hover:underline">
              {paper.title}
            </Link>
          )}
        </PanelTitle>
        {question ? (
          <PanelBody size="compact" className="max-w-none italic text-[var(--text-primary)]">
            {question}
          </PanelBody>
        ) : null}
        <PanelBody size="compact" className="max-w-none">
          {paper.claim}
        </PanelBody>
        <Button asChild variant="ghost" size="sm" className="whitespace-normal text-left">
          <Link to={paper.readerHref}>
            Read the chapter
            <ArrowRight aria-hidden="true" size={14} />
          </Link>
        </Button>
      </div>
    </li>
  )
}

export function TableOfContents({ onSelect }: { onSelect?: (id: string) => void }) {
  return (
    <nav aria-label="Table of contents" className="grid gap-[var(--space-5)]">
      {TABLE_OF_CONTENTS.map((part) => (
        <SurfacePanel key={part.id} padding="compact" className="p-0">
          <section aria-labelledby={`toc-part-${part.id}`}>
            <div className={`h-[6px] w-full ${PART_RULE[part.color] ?? 'bg-[var(--brand-primary)]'}`} aria-hidden="true" />
            <header className="space-y-[var(--space-2)] border-b-2 border-[var(--border-strong)] p-[var(--panel-padding)]">
              <PanelEyebrow>Part {part.numeral}</PanelEyebrow>
              <PanelTitle as="h3" size="card" id={`toc-part-${part.id}`}>
                {part.title}
              </PanelTitle>
              <PanelBody size="compact">{part.blurb}</PanelBody>
            </header>
            <ol className="px-[var(--panel-padding)]">
              {part.papers.map((paper) => (
                <ChapterRow key={paper.id} paper={paper} onSelect={onSelect} />
              ))}
            </ol>
          </section>
        </SurfacePanel>
      ))}
    </nav>
  )
}
