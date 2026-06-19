import { Link } from 'react-router-dom'
import { PageContainer, PanelEyebrow } from '@/components/site/primitives'

/**
 * FeaturedMarquee — an auto-scrolling band of clickable visual cards that
 * hot-links the most exciting posts and demos, and marquees the robots art.
 *
 * Behavior:
 *  - Auto-scrolls horizontally via a CSS keyframe (translateX). The card list
 *    is duplicated once so the loop is seamless (the animation travels exactly
 *    -50%, then snaps back to an identical frame).
 *  - Pauses on hover/focus-within so a reader can aim at a card.
 *  - Respects prefers-reduced-motion: the animation is disabled and the row
 *    becomes a normal horizontal scroll-snap strip (the duplicate is hidden).
 *  - Every card is a real <Link> (or <a> for cross-route targets), keyboard
 *    focusable, with an accessible label.
 */

type MarqueeCard = {
  /** Where the card links. Internal SPA routes use <Link>; everything else <a>. */
  href: string
  /** Visual media — either a still image or a looping video. */
  media:
    | { kind: 'image'; src: string; alt: string }
    | { kind: 'video'; src: string; poster?: string }
  title: string
  hook: string
}

const cards: MarqueeCard[] = [
  {
    href: '/blog/the-macaroon-gate',
    media: {
      kind: 'image',
      src: '/img/generated/macaroon-gate/leviathan.webp',
      alt: 'A leviathan rising over a sea of small agent-ships — the state-of-nature image for the macaroon gate.',
    },
    title: 'The Macaroon Gate',
    hook: 'A credential an agent can narrow but never widen.',
  },
  {
    href: '/pd-tube',
    media: {
      kind: 'image',
      src: '/img/generated/tube-multiplex/multiscreen-fanout.webp',
      alt: 'One request fanning out across a wall of screens, each running its own agent.',
    },
    title: 'pd tube fan-out',
    hook: 'One POST, many agents working at once.',
  },
  {
    href: '/pd-tube',
    media: {
      kind: 'video',
      src: '/demos/pd-tube/mission-control.mp4',
    },
    title: 'Button → a real agent',
    hook: 'A single click hands work to a live agent.',
  },
  {
    href: '/pd-tube/playground',
    media: {
      kind: 'video',
      src: '/demos/pd-tube/red-to-green.mp4',
    },
    title: 'A test fails, an agent fixes it',
    hook: 'Red turns green over one channel.',
  },
  {
    href: '/blog/attention-is-the-first-command',
    media: {
      kind: 'image',
      src: '/img/generated/attention-first-command/hero.webp',
      alt: 'A post office with a wall of pigeonholes and three closed CLI doors — nobody was checking the mail.',
    },
    title: 'Attention Is The First Command',
    hook: 'The fleet had a mailbox. Nobody was reading it.',
  },
  {
    href: '/blog/the-pr-that-reviews-itself',
    media: {
      kind: 'image',
      src: '/img/generated/pr-reviews-itself/hero.webp',
      alt: 'A kitchen brigade of six chefs already at work on a pull request the moment it opens.',
    },
    title: 'The PR That Reviews Itself',
    hook: 'Six paid critics on the diff in the same git push.',
  },
  {
    href: '/blog/your-ai-subscription-powers-the-fleet',
    media: {
      kind: 'image',
      src: '/img/generated/blog-ai-subscription-fleet-hero.jpg',
      alt: 'A single subscription badge fanning into a fleet of small ship-shaped agents.',
    },
    title: 'Your AI Subscription Already Powers A Fleet',
    hook: 'One cursor for you. Parallel capacity for the rest.',
  },
  {
    href: '/manifesto',
    media: {
      kind: 'image',
      src: '/img/manifesto/hero-harbor.webp',
      alt: 'A working harbor where agents dock, coordinate, and ship.',
    },
    title: 'Why a harbor has to come first',
    hook: 'Coordination is the substrate, not an afterthought.',
  },
]

function isInternal(href: string): boolean {
  return href.startsWith('/')
}

function CardMedia({ media }: { media: MarqueeCard['media'] }) {
  if (media.kind === 'video') {
    return (
      <video
        className="h-full w-full object-cover"
        src={media.src}
        poster={media.poster}
        autoPlay
        loop
        muted
        playsInline
        // Decorative within a labelled link; the title/hook carry meaning.
        aria-hidden="true"
      />
    )
  }
  return (
    <img
      className="h-full w-full object-cover transition-transform duration-[var(--duration-normal)] group-hover:scale-[1.03]"
      src={media.src}
      alt={media.alt}
      loading="lazy"
      decoding="async"
    />
  )
}

function MarqueeCardLink({ card, ariaHiddenClone }: { card: MarqueeCard; ariaHiddenClone: boolean }) {
  const label = `${card.title} — ${card.hook}`
  const inner = (
    <>
      <div className="aspect-[16/10] w-full overflow-hidden border-b-2 border-[var(--border-strong)] bg-[var(--surface-sunken)]">
        <CardMedia media={card.media} />
      </div>
      <div className="flex flex-1 flex-col gap-[var(--space-1)] p-[var(--space-3)]">
        <h3 className="font-display text-[1.05rem] font-black leading-[var(--leading-card)] text-[var(--text-primary)]">
          {card.title}
        </h3>
        <p className="text-[0.95rem] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
          {card.hook}
        </p>
      </div>
    </>
  )

  const sharedClass =
    'group flex w-[clamp(15rem,24vw,19rem)] shrink-0 flex-col overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] text-[var(--text-primary)] shadow-[var(--shadow-sm)] transition-colors duration-[var(--duration-normal)] hover:bg-[var(--surface-base)] focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-[var(--interactive-focus)]'

  // Cloned copies (used only to make the loop seamless) are removed from the
  // a11y/tab order so screen-reader and keyboard users meet each card once.
  if (ariaHiddenClone) {
    if (isInternal(card.href)) {
      return (
        <Link to={card.href} className={sharedClass} aria-hidden="true" tabIndex={-1}>
          {inner}
        </Link>
      )
    }
    return (
      <a href={card.href} className={sharedClass} aria-hidden="true" tabIndex={-1}>
        {inner}
      </a>
    )
  }

  if (isInternal(card.href)) {
    return (
      <Link to={card.href} className={sharedClass} aria-label={label}>
        {inner}
      </Link>
    )
  }
  return (
    <a href={card.href} className={sharedClass} aria-label={label}>
      {inner}
    </a>
  )
}

export function FeaturedMarquee() {
  return (
    <section
      aria-labelledby="featured-marquee-title"
      className="overflow-hidden border-t-2 border-[var(--border-strong)] bg-[var(--surface-base)] py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]"
      id="featured-marquee"
    >
      <style>{marqueeCss}</style>

      <PageContainer width="wide">
        <div className="mb-[var(--space-4)] flex flex-col gap-[var(--space-1)]">
          <PanelEyebrow>From the harbor</PanelEyebrow>
          <h2
            id="featured-marquee-title"
            className="max-w-[24ch] font-display text-[clamp(1.4rem,2.1vw,2rem)] font-black leading-[var(--leading-card)] text-[var(--text-primary)]"
          >
            Worth your time — the posts and demos people open first.
          </h2>
        </div>
      </PageContainer>

      {/* Full-bleed track so cards scroll edge to edge. */}
      <div
        className="wd-marquee"
        // The whole track gets a label so the scroll region is announced,
        // and a tabindex so keyboard users can scroll it in reduced-motion mode.
        role="group"
        aria-label="Featured posts and demos"
      >
        <ul className="wd-marquee__track" role="list">
          {cards.map((card) => (
            <li key={`a-${card.href}-${card.title}`} className="wd-marquee__item">
              <MarqueeCardLink card={card} ariaHiddenClone={false} />
            </li>
          ))}
          {/* Seamless-loop duplicate — hidden from a11y. */}
          {cards.map((card) => (
            <li key={`b-${card.href}-${card.title}`} className="wd-marquee__item" aria-hidden="true">
              <MarqueeCardLink card={card} ariaHiddenClone />
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

/**
 * Marquee CSS, scoped by class name. Kept inline so the component is
 * self-contained and the reduced-motion contract lives next to the markup.
 */
const marqueeCss = `
.wd-marquee {
  position: relative;
  width: 100%;
  padding-inline: var(--layout-gutter-lg, 32px);
}
.wd-marquee__track {
  display: flex;
  gap: var(--space-3, 12px);
  width: max-content;
  margin: 0;
  padding: var(--space-1, 4px) 0;
  list-style: none;
  animation: wd-marquee-scroll 48s linear infinite;
  will-change: transform;
}
.wd-marquee__item { display: flex; }
/* Pause when a reader is aiming at the strip. */
.wd-marquee:hover .wd-marquee__track,
.wd-marquee:focus-within .wd-marquee__track {
  animation-play-state: paused;
}
@keyframes wd-marquee-scroll {
  from { transform: translateX(0); }
  to { transform: translateX(-50%); }
}

/* Reduced motion: no animation. Become a normal scroll-snap row, drop the
   duplicate clones, and let the user scroll it themselves. */
@media (prefers-reduced-motion: reduce) {
  .wd-marquee {
    overflow-x: auto;
    scroll-snap-type: x mandatory;
    -webkit-overflow-scrolling: touch;
  }
  .wd-marquee__track {
    animation: none;
    width: auto;
  }
  .wd-marquee__item { scroll-snap-align: start; }
  .wd-marquee__item[aria-hidden='true'] { display: none; }
}
`
