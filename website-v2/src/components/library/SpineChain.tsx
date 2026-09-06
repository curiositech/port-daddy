import * as React from 'react'
import { ArrowRight } from 'lucide-react'

/**
 * The spine sentence as a visual chain. Each link is one transformation that
 * makes the next possible; the arrow between links is the "makes" relation.
 * Read left to right, it is the whole library in seven words.
 *
 * Themed through `var(--token)`; switches light/dark with the page. The link
 * captions are ≥14px sans; the small "what makes it" glosses are ≥13px.
 */

interface Link {
  word: string
  gloss: string
  /** The chapter (Book number) where this link is built. */
  chapter?: string
}

const LINKS: Link[] = [
  { word: 'Memory', gloss: 'a durable record that survives the process', chapter: '1' },
  { word: 'Continuity', gloss: 'the same someone across runs', chapter: '5' },
  { word: 'A person', gloss: 'not a spawn — a role plus a history', chapter: '5' },
  { word: 'A record', gloss: 'witnessed outcomes you can point at', chapter: '5' },
  { word: 'Reputation', gloss: 'the record, scored on several axes', chapter: '5' },
  { word: 'An asset', gloss: 'a reputation worth renting', chapter: '6' },
  { word: 'A market', gloss: 'trade between operators who never met', chapter: '6' },
]

export function SpineChain() {
  return (
    <figure className="grid gap-[var(--space-4)] border-2 border-[var(--border-strong)] bg-[var(--surface-base)] shadow-[var(--shadow-brutal)]">
      <div className="p-[var(--space-5)]">
        <ol className="flex flex-wrap items-stretch gap-x-[var(--space-2)] gap-y-[var(--space-3)]">
          {LINKS.map((link, index) => (
            <React.Fragment key={link.word}>
              <li className="grid min-w-[8.5rem] flex-1 content-start gap-[var(--space-1)] border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-3)]">
                <div className="flex items-baseline justify-between gap-[var(--space-2)]">
                  <span className="font-display text-[length:var(--text-lg)] font-black leading-[var(--leading-nav)] text-[var(--text-primary)]">
                    {link.word}
                  </span>
                  {link.chapter ? (
                    <span className="shrink-0 font-mono text-[length:var(--type-meta-size)] font-black text-[var(--brand-primary)]">
                      {link.chapter}
                    </span>
                  ) : null}
                </div>
                <span className="text-[length:var(--type-meta-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
                  {link.gloss}
                </span>
              </li>
              {index < LINKS.length - 1 ? (
                <li
                  aria-hidden="true"
                  className="hidden shrink-0 items-center self-center text-[var(--brand-primary)] sm:flex"
                >
                  <ArrowRight size={18} strokeWidth={2.5} />
                </li>
              ) : null}
            </React.Fragment>
          ))}
        </ol>
      </div>
      <figcaption className="border-t-2 border-[var(--border-strong)] p-[var(--space-4)] text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
        Each link is what makes the next one possible. The chapter tag is where
        the library builds it. Pull out any link — memory, continuity,
        personhood, a witnessed record — and every link to its right falls with
        it. That is why memory, not cryptography, is the foundation.
      </figcaption>
    </figure>
  )
}
