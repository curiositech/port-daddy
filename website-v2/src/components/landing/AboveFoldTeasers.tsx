import { Link } from 'react-router-dom'
import { ArrowUpRight, BookOpenText, FileCode2, Route } from 'lucide-react'
import {
  homepageTeasers,
  homepageTeaserStats,
  type HomepageTeaser,
  type HomepageTeaserAccent,
  type HomepageTeaserKind,
} from '@/data/homepageTeasers'

const iconByKind: Record<HomepageTeaserKind, typeof BookOpenText> = {
  Article: BookOpenText,
  Guide: Route,
  Example: FileCode2,
}

const accentByTone: Record<HomepageTeaserAccent, { text: string; bg: string; border: string }> = {
  blue: {
    text: 'var(--brand-primary)',
    bg: 'color-mix(in srgb, var(--brand-primary) 10%, transparent)',
    border: 'color-mix(in srgb, var(--brand-primary) 34%, var(--border-subtle))',
  },
  green: {
    text: 'var(--brand-accent)',
    bg: 'color-mix(in srgb, var(--brand-accent) 12%, transparent)',
    border: 'color-mix(in srgb, var(--brand-accent) 34%, var(--border-subtle))',
  },
  amber: {
    text: 'var(--status-warning)',
    bg: 'color-mix(in srgb, var(--status-warning) 13%, transparent)',
    border: 'color-mix(in srgb, var(--status-warning) 38%, var(--border-subtle))',
  },
}

const featuredTeaser = homepageTeasers.find((item) => item.featured) ?? homepageTeasers[0]
const supportingTeasers = homepageTeasers.filter((item) => item !== featuredTeaser)

export function AboveFoldTeasers() {
  return (
    <div
      aria-labelledby="featured-dispatches-title"
      className="border-2 border-[var(--border-strong)] bg-[var(--surface-base)] shadow-[var(--shadow-sm)]"
      id="featured-dispatches"
    >
      <div className="grid gap-[var(--space-3)] border-b-2 border-[var(--border-strong)] p-[var(--space-3)] min-[980px]:grid-cols-[minmax(0,1fr)_auto] min-[980px]:items-end min-[1200px]:p-[var(--space-4)]">
        <div className="space-y-[var(--space-2)]">
          <div className="inline-flex border-2 border-[var(--border-strong)] bg-[var(--text-primary)] px-[var(--space-2)] py-[var(--space-1)] font-mono text-[0.68rem] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--surface-base)]">
            Best proofs
          </div>
          <div className="grid gap-[var(--space-3)] min-[980px]:grid-cols-[minmax(16rem,0.48fr)_minmax(0,1fr)] min-[980px]:items-end">
            <h2
              id="featured-dispatches-title"
              className="max-w-[12ch] font-display text-[clamp(1.55rem,2.4vw,2.35rem)] font-black leading-[var(--leading-card)] text-[var(--text-primary)]"
            >
              Open the sharpest Port Daddy proofs.
            </h2>
            <p className="max-w-[58rem] text-[0.98rem] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
              The work worth evaluating, right up front: the product thesis, runnable agent loops,
              and guides that show how the local control plane changes day-to-day software work.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-3 border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]">
          {homepageTeaserStats.map((stat) => (
            <div
              className="min-w-[5.25rem] border-r-2 border-[var(--border-strong)] px-[var(--space-3)] py-[var(--space-2)] text-center last:border-r-0"
              key={stat.label}
            >
              <div className="font-mono text-[1.25rem] font-black leading-none text-[var(--brand-primary)]">
                {stat.value}
              </div>
              <div className="mt-[var(--space-1)] font-sans text-[0.66rem] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
                {stat.label}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid min-[980px]:grid-cols-[minmax(22rem,0.92fr)_minmax(0,1.08fr)]">
        <FeaturedTeaser teaser={featuredTeaser} />

        <div className="grid border-t-2 border-[var(--border-strong)] min-[720px]:grid-cols-2 min-[980px]:border-l-2 min-[980px]:border-t-0">
          {supportingTeasers.map((teaser, index) => (
            <CompactTeaser
              index={index}
              key={teaser.href}
              teaser={teaser}
              total={supportingTeasers.length}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function TeaserBadge({ teaser }: { teaser: HomepageTeaser }) {
  const Icon = iconByKind[teaser.kind]
  const accent = accentByTone[teaser.accent]

  return (
    <span
      className="inline-flex w-fit items-center gap-[var(--space-1)] border px-[var(--space-2)] py-[3px] font-mono text-[0.66rem] font-semibold uppercase tracking-[var(--tracking-meta)]"
      style={{ background: accent.bg, borderColor: accent.border, color: accent.text }}
    >
      <Icon size={12} aria-hidden="true" />
      {teaser.kind}
    </span>
  )
}

function FeaturedTeaser({ teaser }: { teaser: HomepageTeaser }) {
  return (
    <Link
      aria-label={`Open ${teaser.title}`}
      className="group grid min-h-[14rem] gap-[var(--space-3)] p-[var(--space-3)] text-[var(--text-primary)] transition-colors duration-[var(--duration-normal)] hover:bg-[var(--surface-raised)] focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-[var(--interactive-focus)] min-[640px]:grid-cols-[minmax(7rem,0.34fr)_minmax(0,1fr)] min-[980px]:min-h-[16rem] min-[1200px]:p-[var(--space-4)]"
      to={teaser.href}
    >
      <TeaserImage teaser={teaser} featured />

      <div className="flex min-w-0 flex-col justify-between gap-[var(--space-4)]">
        <div className="space-y-[var(--space-3)]">
          <div className="flex flex-wrap items-center gap-[var(--space-2)]">
            <TeaserBadge teaser={teaser} />
            <span className="font-mono text-[0.68rem] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
              {teaser.eyebrow}
            </span>
          </div>

          <div className="space-y-[var(--space-2)]">
            <h3 className="max-w-[14ch] font-display text-[clamp(1.55rem,2.35vw,2.4rem)] font-black leading-[var(--leading-card)] text-[var(--text-primary)]">
              {teaser.title}
            </h3>
            <p className="max-w-[38rem] text-[0.98rem] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
              {teaser.summary}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-[var(--space-3)] border-t-2 border-[var(--border-strong)] pt-[var(--space-3)]">
          <div className="min-w-0">
            <div className="font-mono text-[0.72rem] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
              {teaser.meta}
            </div>
            <div className="mt-[var(--space-1)] text-sm font-semibold text-[var(--text-primary)]">
              {teaser.proof}
            </div>
          </div>
          <span className="grid h-10 w-10 shrink-0 place-items-center border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] text-[var(--brand-primary)] transition-colors group-hover:bg-[var(--brand-primary)] group-hover:text-[var(--brand-primary-foreground)]">
            <ArrowUpRight size={18} aria-hidden="true" />
          </span>
        </div>
      </div>
    </Link>
  )
}

function CompactTeaser({ teaser, index, total }: { teaser: HomepageTeaser; index: number; total: number }) {
  const isRightColumn = index % 2 === 1
  const isLastRow = index >= total - 2
  const isLastItem = index === total - 1

  return (
    <Link
      aria-label={`Open ${teaser.title}`}
      className={[
        'group grid min-h-[7.4rem] border-b-2 border-[var(--border-strong)] p-[var(--space-3)] text-[var(--text-primary)] transition-colors duration-[var(--duration-normal)] hover:bg-[var(--surface-raised)] focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-[var(--interactive-focus)] min-[720px]:border-r-2',
        isRightColumn ? 'min-[720px]:border-r-0' : '',
        isLastRow ? 'min-[720px]:border-b-0' : '',
        isLastItem ? 'border-b-0' : '',
      ].join(' ')}
      to={teaser.href}
    >
      <div className="flex min-w-0 flex-col justify-between gap-[var(--space-2)]">
        <div className="space-y-[var(--space-2)]">
          <div className="flex items-start justify-between gap-[var(--space-2)]">
            <TeaserBadge teaser={teaser} />
            <ArrowUpRight
              aria-hidden="true"
              className="mt-[2px] shrink-0 text-[var(--text-muted)] transition-colors group-hover:text-[var(--brand-primary)]"
              size={16}
            />
          </div>

          <div className="space-y-[var(--space-2)]">
            <h3 className="font-display text-[1rem] font-black leading-[var(--leading-nav)] text-[var(--text-primary)] min-[1200px]:text-[1.06rem]">
              {teaser.title}
            </h3>
            <p className="sr-only">
              {teaser.summary}
            </p>
          </div>
        </div>

        <div className="grid gap-[var(--space-1)] border-t border-[var(--border-subtle)] pt-[var(--space-2)]">
          <span className="font-mono text-[0.66rem] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
            {teaser.eyebrow} / {teaser.meta}
          </span>
          <span className="text-sm font-semibold text-[var(--text-primary)]">{teaser.proof}</span>
        </div>
      </div>
    </Link>
  )
}

function TeaserImage({ teaser, featured = false }: { teaser: HomepageTeaser; featured?: boolean }) {
  if (!teaser.imageSrc) {
    return (
      <div
        aria-hidden="true"
        className="grid min-h-[10rem] place-items-center border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]"
      >
        <div className="grid h-16 w-16 place-items-center border-2 border-[var(--border-strong)] bg-[var(--surface-base)] text-[var(--brand-primary)]">
          {teaser.kind === 'Guide' ? <Route size={26} /> : <BookOpenText size={26} />}
        </div>
      </div>
    )
  }

  return (
    <picture
      className={[
        'block overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]',
        featured ? 'min-h-[11rem]' : 'min-h-[8rem]',
      ].join(' ')}
    >
      {teaser.imageWebpSrc ? <source srcSet={teaser.imageWebpSrc} type="image/webp" /> : null}
      <img
        alt={teaser.imageAlt ?? ''}
        className="h-full min-h-[inherit] w-full object-cover transition-transform duration-[var(--duration-slow)] group-hover:scale-[1.025]"
        decoding="async"
        fetchPriority={featured ? 'high' : 'low'}
        loading={featured ? 'eager' : 'lazy'}
        src={teaser.imageSrc}
      />
    </picture>
  )
}
