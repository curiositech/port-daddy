/**
 * CapabilityBand — above-the-fold feature band advertising 4 shipped capabilities:
 *   1. Coast Guard   — agentic safety: sandbox + secret broker + hard spend caps
 *   2. pd dispatch   — intent → PR while you sleep
 *   3. pd tube       — one bus for the entire fleet
 *   4. Cockpit       — live operator view
 *
 * Design: 4-column card grid on desktop, 2-col on tablet, 1-col on mobile.
 * Tokens: brand-primary (cobalt) for primary accent, brand-accent (teal) for
 * secondary highlights. All type at/above --type-panel-body-size (18px body,
 * 13px / uppercase+bold+tracked for eyebrows only).
 */

import { ArrowRight, Compass, GitPullRequest, MonitorPlay, Radio } from 'lucide-react'
import { Link } from 'react-router-dom'
import {
  BracketLabel,
  PageContainer,
  PanelBody,
  PanelEyebrow,
  PanelTitle,
} from '@/components/site/primitives'

const CAPABILITIES = [
  {
    id: 'coast-guard',
    icon: Compass,
    eyebrow: 'Agentic safety',
    headline: 'Coast Guard',
    body: "Sandboxed, secret-blind, and spend-capped — the three walls your agents can't climb by default. Caps are hard limits, not gentle reminders that get ignored at 2 a.m.",
    tone: 'primary' as const,
    href: '/docs/coast-guard',
  },
  {
    id: 'dispatch',
    icon: GitPullRequest,
    eyebrow: 'Async execution',
    headline: 'pd dispatch',
    body: 'You write one sentence. Port Daddy writes the brief, picks the branch, runs the agent, and hands you a draft PR by morning — scope, output, evidence, the works. This is the thing sleep was invented for.',
    tone: 'default' as const,
    href: '/docs/dispatch',
  },
  {
    id: 'tube',
    icon: Radio,
    eyebrow: 'Fleet bus',
    headline: 'pd tube',
    body: 'One durable wire for the whole fleet — route a command to twelve agents at once, steer the ones you want, and watch it fail closed when the connection drops. No polling. No fragile IPC. No mystery.',
    tone: 'accent' as const,
    href: '/pd-tube',
  },
  {
    id: 'cockpit',
    icon: MonitorPlay,
    eyebrow: 'Operator surface',
    headline: 'Cockpit',
    body: "Every agent, every claim, every note — live, in one place you can act on. Not a dashboard that tells you what happened while you were looking elsewhere. A control plane you can steer from.",
    tone: 'default' as const,
    href: '/docs/cockpit',
  },
] as const

type CapabilityTone = 'primary' | 'accent' | 'default'

/** Returns surface + text token classes for a given tone */
function toneClasses(tone: CapabilityTone) {
  if (tone === 'primary') {
    return {
      surface: 'bg-[var(--brand-primary)]',
      border: 'border-[var(--brand-primary)]',
      iconBg: 'bg-[color:var(--brand-primary-foreground-subtle)]',
      iconColor: 'text-[var(--brand-primary)]',
      eyebrowTone: 'primary' as const,
      titleTone: 'primary' as const,
      bodyTone: 'primary' as const,
      arrowColor: 'text-[color:var(--brand-primary-foreground-muted)]',
      hoverBg: 'hover:bg-[var(--brand-primary-on-tint)]',
    }
  }
  if (tone === 'accent') {
    return {
      surface: 'bg-[var(--brand-accent)]',
      border: 'border-[var(--brand-accent)]',
      iconBg: 'bg-[color:var(--brand-accent-foreground-subtle)]',
      iconColor: 'text-[var(--brand-accent)]',
      eyebrowTone: 'accent' as const,
      titleTone: 'accent' as const,
      bodyTone: 'accent' as const,
      arrowColor: 'text-[color:var(--brand-accent-foreground-muted)]',
      hoverBg: 'hover:bg-[var(--brand-accent-on-tint)]',
    }
  }
  return {
    surface: 'bg-[var(--surface-raised)]',
    border: 'border-[var(--border-strong)]',
    iconBg: 'bg-[color:color-mix(in_srgb,var(--brand-primary)_10%,transparent)]',
    iconColor: 'text-[var(--brand-primary)]',
    eyebrowTone: 'default' as const,
    titleTone: 'default' as const,
    bodyTone: 'default' as const,
    arrowColor: 'text-[var(--text-muted)]',
    hoverBg: 'hover:bg-[var(--surface-strong)]',
  }
}

/**
 * Pure-CSS fleet topology diagram used as the visual fallback
 * behind the hero image slot. Renders at any size, both themes.
 */
function FleetTopologyDiagram() {
  const nodes = [
    { id: 'coast-guard', label: 'Coast Guard', col: 1, row: 1 },
    { id: 'dispatch', label: 'pd dispatch', col: 2, row: 1 },
    { id: 'tube', label: 'pd tube', col: 1, row: 2 },
    { id: 'cockpit', label: 'Cockpit', col: 2, row: 2 },
  ] as const

  return (
    <div
      className="relative flex min-h-[14rem] items-center justify-center overflow-hidden px-[var(--space-6)] py-[var(--space-6)]"
      style={{
        background:
          'linear-gradient(140deg, var(--brand-primary) 0%, color-mix(in srgb, var(--brand-primary) 55%, var(--brand-accent)) 60%, var(--brand-accent) 100%)',
      }}
    >
      {/* Dot-grid overlay */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.12]"
        style={{
          backgroundImage:
            'radial-gradient(circle, var(--brand-primary-foreground) 1px, transparent 1px)',
          backgroundSize: '20px 20px',
        }}
      />

      {/* Central hub → node connectors (SVG lines) */}
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <line x1="50" y1="50" x2="25" y2="28" stroke="rgba(255,255,255,0.2)" strokeWidth="0.5" />
        <line x1="50" y1="50" x2="75" y2="28" stroke="rgba(255,255,255,0.2)" strokeWidth="0.5" />
        <line x1="50" y1="50" x2="25" y2="72" stroke="rgba(255,255,255,0.2)" strokeWidth="0.5" />
        <line x1="50" y1="50" x2="75" y2="72" stroke="rgba(255,255,255,0.2)" strokeWidth="0.5" />
      </svg>

      {/* 2×2 grid of nodes */}
      <div className="relative z-10 grid w-full max-w-[36rem] grid-cols-2 gap-[var(--space-4)]">
        {nodes.map((node) => (
          <div
            key={node.id}
            className="flex items-center gap-[var(--space-3)] border border-[color:rgba(255,255,255,0.22)] bg-[color:rgba(255,255,255,0.07)] px-[var(--space-3)] py-[var(--space-3)]"
          >
            <div className="h-2 w-2 bg-[color:rgba(255,255,255,0.7)]" />
            <span
              className="font-mono text-[12px] font-black uppercase tracking-[0.14em] text-[var(--brand-primary-foreground)]"
              style={{ letterSpacing: '0.14em' }}
            >
              {node.label}
            </span>
          </div>
        ))}
      </div>

      {/* Central hub dot */}
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 bg-[color:rgba(255,255,255,0.55)]"
        aria-hidden="true"
      />
    </div>
  )
}

export function CapabilityBand() {
  return (
    <section
      id="capabilities"
      aria-labelledby="capabilities-heading"
      className="border-t-2 border-[var(--border-strong)] py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]"
    >
      <PageContainer width="wide">
        {/* Section intro row */}
        <div className="mb-[var(--space-6)] flex flex-wrap items-end justify-between gap-[var(--space-5)]">
          <div className="space-y-[var(--space-3)]">
            <BracketLabel>What ships in every install</BracketLabel>
            <PanelTitle
              as="h2"
              id="capabilities-heading"
              size="display"
              className="max-w-[18ch]"
            >
              Four primitives. No more lost agents.
            </PanelTitle>
          </div>
          <PanelBody className="max-w-[34rem]">
            Safety rails, async dispatch, a fleet bus, and a live operator view — the
            four things you were missing before agents got weird.{' '}
            <strong className="text-[var(--text-primary)]">
              Every one ships in the base install.
            </strong>
          </PanelBody>
        </div>

        {/* Capability card grid */}
        <div className="grid gap-[var(--space-5)] sm:grid-cols-2 xl:grid-cols-4">
          {CAPABILITIES.map((cap) => {
            const tc = toneClasses(cap.tone)
            const Icon = cap.icon

            return (
              <Link
                key={cap.id}
                to={cap.href}
                aria-label={`${cap.headline} — ${cap.eyebrow}`}
                className={[
                  'group relative flex flex-col gap-[var(--space-4)]',
                  'border-2 p-[var(--space-5)]',
                  'no-underline transition-colors duration-[var(--duration-normal)]',
                  tc.surface,
                  tc.border,
                  tc.hoverBg,
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--interactive-focus)]',
                ].join(' ')}
              >
                {/* Icon cell */}
                <span
                  className={[
                    'inline-flex h-11 w-11 items-center justify-center border-2 border-[var(--border-strong)]',
                    tc.iconBg,
                    tc.iconColor,
                  ].join(' ')}
                  aria-hidden="true"
                >
                  <Icon size={20} strokeWidth={1.75} />
                </span>

                {/* Text */}
                <div className="flex-1 space-y-[var(--space-2)]">
                  <PanelEyebrow tone={tc.eyebrowTone}>{cap.eyebrow}</PanelEyebrow>
                  <PanelTitle as="h3" size="nav" tone={tc.titleTone} className="max-w-none">
                    {cap.headline}
                  </PanelTitle>
                  <PanelBody size="compact" tone={tc.bodyTone} className="max-w-none">
                    {cap.body}
                  </PanelBody>
                </div>

                {/* Footer link hint */}
                <div
                  className={[
                    'mt-auto flex items-center gap-[var(--space-2)]',
                    'border-t-2 border-[var(--border-strong)]/20 pt-[var(--space-3)]',
                    'font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)]',
                    tc.arrowColor,
                  ].join(' ')}
                >
                  <span>Explore</span>
                  <ArrowRight
                    size={14}
                    aria-hidden="true"
                    className="transition-transform group-hover:translate-x-0.5"
                  />
                </div>
              </Link>
            )
          })}
        </div>

        {/* ─── Visual accent strip ────────────────────────────────────────────
            Operator fill: drop the nano-banana image at:
              website-v2/public/img/generated/capability-band-hero.png
              website-v2/public/img/generated/capability-band-hero.webp
            Suggested prompt (flat-blueprint style, same family as other PD art):
              "Flat architectural-blueprint illustration of four naval instruments —
               compass, radio handset, pull-request DAG graph, monitor cockpit display —
               arranged in a 2×2 grid on a deep cobalt background, crisp white hatching
               lines, hand-lettered italic monospace labels, no photographic realism,
               no text overlays."
            Until that image lands, the CSS topology diagram below renders in its place
            and looks complete on its own.
        ─────────────────────────────────────────────────────────────────── */}
        <div
          className="relative mt-[var(--space-7)] overflow-hidden border-2 border-[var(--border-strong)]"
          aria-hidden="true"
        >
          {/* CSS topology diagram — always renders; image overlays it when present */}
          <FleetTopologyDiagram />

          {/* Hero image — positioned over diagram when it loads */}
          <picture className="absolute inset-0 block h-full w-full">
            <source
              srcSet="/img/generated/capability-band-hero.webp"
              type="image/webp"
            />
            <img
              src="/img/generated/capability-band-hero.png"
              alt=""
              loading="lazy"
              decoding="async"
              fetchPriority="low"
              className="h-full w-full object-cover"
              onError={(e) => {
                /* hide broken-image icon without disturbing diagram */
                ;(e.currentTarget as HTMLImageElement).style.visibility = 'hidden'
              }}
            />
          </picture>
        </div>
      </PageContainer>
    </section>
  )
}
