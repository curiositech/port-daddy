import { createContext, useContext, useState, type ElementType, type ReactNode } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { ArrowDown, ArrowRight, Box, Check, Copy, Cpu, Lock } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { CodeBlock } from '@/components/ui/CodeBlock'
import { CommandTerminal } from '@/components/ui/CommandTerminal'
import { useTheme } from '@/lib/theme-context'
import { cn } from '@/lib/utils'
import type { AccentTone, CommercialTrack, ProofPanel, TruthState } from '@/data/publicSite'

const truthTone: Record<TruthState, string> = {
  Live: 'bg-[var(--brand-primary)] text-[var(--brand-primary-foreground)]',
  Roadmap: 'bg-[var(--brand-accent)] text-[var(--brand-accent-foreground)]',
}

const docsCardTone: Record<AccentTone, string> = {
  paper: 'bg-[var(--surface-raised)] text-[var(--text-primary)]',
  blue: 'bg-[var(--brand-primary)] text-[var(--brand-primary-foreground)]',
  accent: 'bg-[var(--brand-accent)] text-[var(--brand-accent-foreground)]',
}

const panelToneMap: Record<AccentTone, 'default' | 'primary' | 'accent'> = {
  paper: 'default',
  blue: 'primary',
  accent: 'accent',
}

const surfaceBracketTone: Record<AccentTone, string> = {
  paper: 'border-[var(--border-default)] text-[var(--text-secondary)]',
  blue: 'border-[color:var(--brand-primary-foreground-subtle)] text-[var(--brand-primary-foreground)]',
  accent: 'border-[color:var(--brand-accent-foreground-muted)] text-[var(--brand-accent-foreground)]',
}

const SurfaceToneContext = createContext<AccentTone>('paper')

const panelEyebrowClass =
  'font-sans text-[length:var(--type-meta-size)] font-medium uppercase tracking-[var(--tracking-meta)]'

const panelTitleSize = {
  hero: 'text-[length:var(--type-hero-size)] leading-[var(--leading-display-tight)] tracking-[var(--tracking-display-tight)]',
  section:
    'text-[length:var(--type-panel-title-display-size)] leading-[var(--leading-display)] tracking-[var(--tracking-display-tight)]',
  display:
    'text-[length:var(--type-panel-title-display-size)] leading-[var(--leading-display)] tracking-[var(--tracking-display-tight)]',
  card:
    'text-[length:var(--type-panel-title-card-size)] leading-[var(--leading-card)] tracking-[var(--tracking-display-card)]',
  nav:
    'text-[length:var(--type-panel-title-nav-size)] leading-[var(--leading-nav)] tracking-[var(--tracking-display-nav)]',
} as const

const panelBodySize = {
  default: 'text-[length:var(--type-panel-body-size)] leading-[var(--leading-body)]',
  compact: 'text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)]',
} as const

const panelBodyTone = {
  default: 'text-[var(--text-secondary)]',
  primary: 'text-[color:var(--brand-primary-foreground-muted)]',
  accent: 'text-[color:var(--brand-accent-foreground-muted)]',
} as const

const surfaceBodyTone: Record<AccentTone, keyof typeof panelBodyTone> = {
  paper: 'default',
  blue: 'primary',
  accent: 'accent',
}

const navTone = {
  blue: {
    active: 'border-[var(--border-strong)] bg-[var(--brand-primary)] text-[var(--brand-primary-foreground)]',
    hover: 'hover:border-[var(--border-strong)] hover:bg-[var(--brand-primary)] hover:text-[var(--brand-primary-foreground)]',
    body: 'text-[color:var(--brand-primary-foreground-muted)]',
    bracket:
      'border-[color:var(--brand-primary-foreground-subtle)] text-[var(--brand-primary-foreground)]',
  },
  accent: {
    active: 'border-[var(--border-strong)] bg-[var(--brand-accent)] text-[var(--brand-accent-foreground)]',
    hover: 'hover:border-[var(--border-strong)] hover:bg-[var(--brand-accent)] hover:text-[var(--brand-accent-foreground)]',
    body: 'text-[color:var(--brand-accent-foreground-muted)]',
    bracket:
      'border-[color:var(--brand-accent-foreground-muted)] text-[var(--brand-accent-foreground)]',
  },
} as const

const landingStatTone = {
  paper: 'bg-[var(--surface-raised)] text-[var(--text-primary)]',
  blue: 'bg-[var(--brand-primary)] text-[var(--brand-primary-foreground)]',
  accent: 'bg-[var(--brand-accent)] text-[var(--brand-accent-foreground)]',
} as const

type DocsCodeLanguage = 'cli' | 'text' | 'typescript'

function panelToneForAccent(tone: AccentTone): 'default' | 'primary' | 'accent' {
  return panelToneMap[tone]
}

function useSurfaceTone(explicitTone?: AccentTone) {
  const inheritedTone = useContext(SurfaceToneContext)
  return explicitTone ?? inheritedTone
}

export function BrandMark({ className }: { className?: string }) {
  const { theme } = useTheme()

  return (
    <img
      aria-hidden="true"
      src={theme === 'dark' ? '/pd_logo_darkmode.svg' : '/pd_logo.svg'}
      alt=""
      className={cn(
        'h-11 w-11 shrink-0',
        className,
      )}
    />
  )
}

export function TruthBadge({ truth }: { truth: TruthState }) {
  return (
    <span
      className={cn(
        'inline-flex items-center border-2 border-[var(--border-strong)] px-[var(--space-2)] py-[var(--space-1)] font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)]',
        truthTone[truth],
      )}
    >
      {truth}
    </span>
  )
}

export function PanelEyebrow({
  children,
  className,
  tone = 'default',
}: {
  children: ReactNode
  className?: string
  tone?: 'default' | 'primary' | 'accent'
}) {
  const toneClass =
    tone === 'primary'
      ? 'text-[color:var(--brand-primary-foreground-subtle)]'
      : tone === 'accent'
        ? 'text-[color:var(--brand-accent-foreground-subtle)]'
        : 'text-[var(--text-secondary)]'

  return (
    <div data-slot="panel-eyebrow" className={cn(panelEyebrowClass, toneClass, className)}>
      {children}
    </div>
  )
}

export function PanelTitle({
  as,
  children,
  className,
  id,
  size = 'card',
  tone = 'default',
  caps = false,
}: {
  as?: ElementType
  children: ReactNode
  className?: string
  id?: string
  size?: keyof typeof panelTitleSize
  tone?: 'default' | 'primary' | 'accent'
  caps?: boolean
}) {
  const Component = as ?? 'h2'
  const toneClass =
    tone === 'primary'
      ? '!text-[var(--brand-primary-foreground)]'
      : tone === 'accent'
        ? '!text-[var(--brand-accent-foreground)]'
        : '!text-[var(--text-primary)]'

  return (
    <Component
      data-slot="panel-title"
      id={id}
      className={cn(
        'font-display font-black',
        caps ? 'uppercase' : 'normal-case',
        panelTitleSize[size],
        toneClass,
        className,
      )}
    >
      {children}
    </Component>
  )
}

export function PanelBody({
  as,
  children,
  className,
  size = 'default',
  tone = 'default',
}: {
  as?: ElementType
  children: ReactNode
  className?: string
  size?: keyof typeof panelBodySize
  tone?: keyof typeof panelBodyTone
}) {
  const Component = as ?? 'p'

  return (
    <Component
      data-slot="panel-body"
      className={cn('max-w-[44rem] font-sans', panelBodySize[size], panelBodyTone[tone], className)}
    >
      {children}
    </Component>
  )
}

export function PanelList({
  items,
  className,
  size = 'compact',
  tone = 'default',
}: {
  items: string[]
  className?: string
  size?: keyof typeof panelBodySize
  tone?: keyof typeof panelBodyTone
}) {
  return (
    <div data-slot="panel-list" className={cn('space-y-[var(--panel-gap-tight)]', className)}>
      {items.map((item) => (
        <PanelBody key={item} as="p" size={size} tone={tone} className="max-w-none">
          {item}
        </PanelBody>
      ))}
    </div>
  )
}

const pageContainerWidthClass = {
  default: 'max-w-[var(--layout-max-width)]',
  wide: 'max-w-[var(--layout-max-width-wide)]',
} as const

const swissGridSpanClass = {
  full: 'lg:col-span-12',
  half: 'lg:col-span-6',
  third: 'lg:col-span-4',
  twoThirds: 'lg:col-span-8',
  narrow: 'lg:col-span-5',
  wide: 'lg:col-span-7',
  rail: 'lg:col-span-3',
  body: 'lg:col-span-9',
} as const

export function PageContainer({
  children,
  className,
  width = 'default',
}: {
  children: ReactNode
  className?: string
  width?: keyof typeof pageContainerWidthClass
}) {
  return (
    <div
      className={cn(
        'mx-auto w-full min-w-0 px-[var(--layout-gutter)] lg:px-[var(--layout-gutter-lg)]',
        pageContainerWidthClass[width],
        className,
      )}
    >
      {children}
    </div>
  )
}

export function SwissGrid({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      data-slot="swiss-grid"
      className={cn('grid min-w-0 grid-cols-1 gap-[var(--grid-gap)] lg:grid-cols-12', className)}
    >
      {children}
    </div>
  )
}

export function SwissGridItem({
  children,
  className,
  span = 'full',
}: {
  children: ReactNode
  className?: string
  span?: keyof typeof swissGridSpanClass
}) {
  return (
    <div data-slot="swiss-grid-item" className={cn('min-w-0', swissGridSpanClass[span], className)}>
      {children}
    </div>
  )
}

export function SectionIntro({
  eyebrow,
  title,
  description,
  className,
  titleAs,
  titleClassName,
  titleSize = 'display',
  bodyClassName,
}: {
  eyebrow: string
  title: ReactNode
  description: ReactNode
  className?: string
  titleAs?: ElementType
  titleClassName?: string
  titleSize?: keyof typeof panelTitleSize
  bodyClassName?: string
}) {
  return (
    <div className={cn('space-y-[var(--section-intro-gap)]', className)}>
      <BracketLabel>{eyebrow}</BracketLabel>
      <PanelTitle as={titleAs} size={titleSize} className={titleClassName}>
        {title}
      </PanelTitle>
      <PanelBody className={cn('max-w-[var(--measure-copy)]', bodyClassName)}>{description}</PanelBody>
    </div>
  )
}

export function SectionFrame({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <section className="border-t-2 border-[var(--border-strong)] py-[var(--space-7)] lg:py-[var(--space-8)]">
      <PageContainer width="wide" className="grid grid-cols-1 gap-[var(--space-6)] lg:grid-cols-12">
        <div className="lg:col-span-4">
          <div className="space-y-[var(--section-intro-gap)]">
            <div className="inline-flex border-2 border-[var(--border-strong)] px-[var(--space-3)] py-[var(--space-2)]">
              <PanelEyebrow>{eyebrow}</PanelEyebrow>
            </div>
            <div className="space-y-[var(--panel-gap-tight)]">
              <PanelTitle size="display">{title}</PanelTitle>
              {description ? (
                <PanelBody className="max-w-[34rem]">{description}</PanelBody>
              ) : null}
            </div>
          </div>
        </div>
        <div className="lg:col-span-8">{children}</div>
      </PageContainer>
    </section>
  )
}

export function LandingSection({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <section className="border-b-2 border-[var(--border-strong)]">
      <PageContainer width="wide" className={cn('py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]', className)}>
        {children}
      </PageContainer>
    </section>
  )
}

export function LandingSectionIntro({
  eyebrow,
  title,
  description,
  className,
}: {
  eyebrow: string
  title: ReactNode
  description: ReactNode
  className?: string
}) {
  return (
    <SectionIntro
      eyebrow={eyebrow}
      title={title}
      description={description}
      className={className}
      titleAs="h2"
      titleSize="display"
      titleClassName="max-w-[14ch]"
      bodyClassName="max-w-[46rem]"
    />
  )
}

export function LandingProofCard({
  panel,
}: {
  panel: ProofPanel
}) {
  const transcript = [`$ ${panel.command}`, ...panel.output, '', panel.result].join('\n')

  return (
    <SurfacePanel className="space-y-[var(--panel-gap)]">
      <div className="flex items-start gap-[var(--panel-gap-tight)] border-b-2 border-[var(--border-strong)]/12 pb-[var(--panel-gap)]">
        <div className="font-display text-[length:var(--type-panel-title-nav-size)] font-black leading-[var(--leading-nav)] text-[var(--text-primary)]">
          {panel.id}
        </div>
        <div className="h-[var(--space-5)] w-px bg-[var(--border-default)]" />
        <div className="space-y-[var(--space-1)]">
          <PanelEyebrow>{panel.subtitle}</PanelEyebrow>
          <PanelTitle as="h3" size="nav">
            {panel.tool}
          </PanelTitle>
        </div>
      </div>

      <DocsCodeBlock code={transcript} language="text" label={`${panel.tool} output`} />

      <div className="space-y-[var(--space-2)]">
        {panel.checks.map((check) => (
          <div
            key={check.label}
            className="flex items-center justify-between border-t-2 border-[var(--border-strong)]/12 pt-[var(--space-2)]"
          >
            <PanelEyebrow>{check.label}</PanelEyebrow>
            <PanelEyebrow className="text-[var(--brand-primary)]">{check.value}</PanelEyebrow>
          </div>
        ))}
      </div>
    </SurfacePanel>
  )
}

export function LandingStatsStrip({
  stats,
}: {
  stats: ReadonlyArray<{ value: string; label: string; tone: AccentTone }>
}) {
  return (
    <div className="grid border-2 border-[var(--border-strong)] md:grid-cols-3">
      {stats.map((stat, index) => (
        <div
          key={stat.label}
          className={cn(
            'p-[var(--panel-padding)]',
            landingStatTone[stat.tone],
            index < stats.length - 1 ? 'border-b-2 border-[var(--border-strong)] md:border-b-0 md:border-r-2' : '',
          )}
        >
          <PanelTitle
            as="p"
            size="card"
            tone={stat.tone === 'blue' ? 'primary' : stat.tone === 'accent' ? 'accent' : 'default'}
            className="normal-case"
          >
            {stat.value}
          </PanelTitle>
          <PanelEyebrow
            tone={stat.tone === 'blue' ? 'primary' : stat.tone === 'accent' ? 'accent' : 'default'}
            className="mt-[var(--space-2)]"
          >
            {stat.label}
          </PanelEyebrow>
        </div>
      ))}
    </div>
  )
}

export function LandingArchitectureCard() {
  return (
    <SurfacePanel className="space-y-[var(--panel-gap-loose)]">
      <div className="space-y-[var(--panel-gap)]">
        <PanelEyebrow className="text-center">Agent layer</PanelEyebrow>
        <div className="grid grid-cols-4 border-2 border-[var(--border-strong)]">
          {['Agent A', 'Agent B', 'Agent C', 'Agent D'].map((agent, index) => (
            <div
              key={agent}
              className={cn(
                'p-[var(--space-3)] text-center',
                index < 3 ? 'border-r-2 border-[var(--border-strong)]' : '',
                index === 0 ? 'bg-[var(--brand-primary)] text-[var(--brand-primary-foreground)]' : 'bg-[var(--surface-raised)] text-[var(--text-primary)]',
              )}
            >
              <Box className="mx-auto h-[var(--space-4)] w-[var(--space-4)]" />
              <PanelEyebrow
                tone={index === 0 ? 'primary' : 'default'}
                className="mt-[var(--space-2)] justify-center text-center"
              >
                {agent}
              </PanelEyebrow>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-col items-center gap-[var(--space-1)]">
        <div className="h-[var(--space-5)] w-px bg-[var(--border-default)]" />
        <ArrowDown className="h-[var(--space-3)] w-[var(--space-3)] text-[var(--text-secondary)]" />
        <PanelEyebrow>Harbor / session authority</PanelEyebrow>
        <div className="h-[var(--space-5)] w-px bg-[var(--border-default)]" />
      </div>

      <div className="space-y-[var(--panel-gap)]">
        <PanelEyebrow className="text-center">Control plane</PanelEyebrow>
        <div className="border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]">
          <div className="border-b-2 border-[var(--border-strong)] p-[var(--panel-padding)]">
            <div className="flex items-center justify-center gap-[var(--panel-gap-tight)]">
              <Cpu className="h-[var(--space-5)] w-[var(--space-5)]" />
              <div className="space-y-[var(--space-1)] text-center">
                <PanelTitle as="p" size="nav">
                  Port Daddy
                </PanelTitle>
                <PanelEyebrow>Node.js daemon process</PanelEyebrow>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-3">
            {['Sessions', 'Registry', 'Locks'].map((item, index) => (
              <div
                key={item}
                className={cn(
                  'px-[var(--space-3)] py-[var(--space-2)] text-center',
                  index < 2 ? 'border-r-2 border-[var(--border-strong)]' : '',
                  item === 'Registry' ? 'bg-[var(--brand-accent)] text-[var(--brand-accent-foreground)]' : 'bg-[var(--surface-raised)] text-[var(--text-primary)]',
                )}
              >
                <PanelEyebrow
                  tone={item === 'Registry' ? 'accent' : 'default'}
                  className="justify-center text-center font-semibold"
                >
                  {item}
                </PanelEyebrow>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-col items-center gap-[var(--space-1)]">
        <div className="h-[var(--space-5)] w-px bg-[var(--border-default)]" />
        <ArrowDown className="h-[var(--space-3)] w-[var(--space-3)] text-[var(--text-secondary)]" />
        <PanelEyebrow>FFI bridge</PanelEyebrow>
        <div className="h-[var(--space-5)] w-px bg-[var(--border-default)]" />
      </div>

      <div className="space-y-[var(--panel-gap)]">
        <PanelEyebrow className="text-center">Cryptographic core</PanelEyebrow>
        <div className="border-2 border-[var(--border-strong)] bg-[var(--brand-primary)] text-[var(--brand-primary-foreground)]">
          <div className="border-b-2 border-[color:var(--brand-primary-foreground-subtle)] p-[var(--panel-padding)]">
            <div className="flex items-center justify-center gap-[var(--panel-gap-tight)]">
              <Lock className="h-[var(--space-5)] w-[var(--space-5)]" />
              <div className="space-y-[var(--space-1)] text-center">
                <PanelTitle as="p" size="nav" tone="primary">
                  verified core
                </PanelTitle>
                <PanelEyebrow tone="primary">Rust cryptographic library</PanelEyebrow>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2">
            {['Ed25519 signing', 'Harbor verification', 'FFI bridge', 'Model-checked logic'].map((item, index) => (
              <div
                key={item}
                className={cn(
                  'px-[var(--space-3)] py-[var(--space-2)] text-center',
                  index % 2 === 0 ? 'border-r border-[color:var(--brand-primary-foreground-subtle)]' : '',
                  index < 2 ? 'border-b border-[color:var(--brand-primary-foreground-subtle)]' : '',
                )}
              >
                <PanelEyebrow tone="primary" className="justify-center text-center">
                  {item}
                </PanelEyebrow>
              </div>
            ))}
          </div>
        </div>
      </div>
    </SurfacePanel>
  )
}

export function LandingNarrativeStack({
  items,
}: {
  items: ReadonlyArray<{ label: string; text: string }>
}) {
  return (
    <div className="grid gap-[var(--panel-gap)]">
      {items.map((item) => (
        <DocsNoteCard key={item.label} label={item.label}>
          <PanelBody size="compact" className="max-w-none">
            {item.text}
          </PanelBody>
        </DocsNoteCard>
      ))}
    </div>
  )
}

export function LandingCommercialCard({
  track,
}: {
  track: CommercialTrack
}) {
  const panelTone = panelToneForAccent(track.tone)

  return (
    <SurfacePanel tone={track.tone} className="flex h-full flex-col gap-[var(--panel-gap)]">
      <div className="flex items-start justify-between gap-[var(--panel-gap)] border-b-2 border-current/20 pb-[var(--panel-gap)]">
        <div className="space-y-[var(--space-1)]">
          <div className="flex items-center gap-[var(--panel-gap-tight)]">
            <div className="font-display text-[length:var(--type-panel-title-nav-size)] font-black leading-[var(--leading-nav)]">
              {track.id}
            </div>
            <div className="h-[var(--space-5)] w-px bg-current/30" />
            <PanelEyebrow tone={panelTone}>{track.subtitle}</PanelEyebrow>
          </div>
          <PanelTitle as="h3" size="card" tone={panelTone}>
            {track.name}
          </PanelTitle>
        </div>
        <BracketLabel tone={panelTone}>{track.badge}</BracketLabel>
      </div>

      <PanelBody tone={surfaceBodyTone[track.tone]} className="max-w-none">
        {track.description}
      </PanelBody>

      <div className="space-y-[var(--space-2)]">
        {track.bullets.map((item) => (
          <div key={item} className="flex items-start gap-[var(--space-2)]">
            <Check
              className={cn(
                'mt-[2px] h-[var(--space-3)] w-[var(--space-3)] flex-none',
                track.tone === 'blue'
                  ? 'text-[var(--brand-primary-foreground)]'
                  : track.tone === 'accent'
                    ? 'text-[var(--brand-accent-foreground)]'
                    : 'text-[var(--brand-primary)]',
              )}
              strokeWidth={2.5}
            />
            <PanelBody size="compact" tone={surfaceBodyTone[track.tone]} className="max-w-none">
              {item}
            </PanelBody>
          </div>
        ))}
      </div>
    </SurfacePanel>
  )
}

const surfaceElevationClass = {
  raised: 'border-2 border-[var(--border-strong)] shadow-none',
  quiet: 'border border-[var(--border-default)] shadow-none',
} as const

const surfacePaddingClass = {
  default: 'p-[var(--panel-padding)]',
  compact: 'p-[var(--space-4)]',
} as const

export function SurfacePanel({
  className,
  children,
  tone = 'paper',
  elevation = 'raised',
  padding = 'default',
}: {
  className?: string
  children: ReactNode
  tone?: AccentTone
  elevation?: keyof typeof surfaceElevationClass
  padding?: keyof typeof surfacePaddingClass
}) {
  return (
    <SurfaceToneContext.Provider value={tone}>
      <div
        className={cn(
          'min-w-0',
          surfaceElevationClass[elevation],
          surfacePaddingClass[padding],
          docsCardTone[tone],
          className,
        )}
      >
        {children}
      </div>
    </SurfaceToneContext.Provider>
  )
}

export function BracketLabel({
  children,
  side = 'both',
  className,
  tone = 'default',
  surface,
}: {
  children: ReactNode
  side?: 'left' | 'right' | 'both'
  className?: string
  tone?: 'default' | 'primary' | 'accent'
  surface?: AccentTone
}) {
  const resolvedSurface = useSurfaceTone(surface)
  const toneClass =
    tone === 'primary'
      ? 'border-[color:var(--brand-primary-foreground-subtle)] text-[var(--brand-primary-foreground)]'
      : tone === 'accent'
        ? 'border-[color:var(--brand-accent-foreground-muted)] text-[var(--brand-accent-foreground)]'
        : surfaceBracketTone[resolvedSurface]

  return (
    <span
      data-slot="bracket-label"
      className={cn(
        panelEyebrowClass,
        'inline-flex items-center px-[var(--panel-bracket-pad-inline)] py-[var(--panel-bracket-pad-block)] transition-colors',
        side === 'left'
          ? 'border-l-2'
          : side === 'right'
            ? 'border-r-2'
            : 'border-l-2 border-r-2',
        toneClass,
        className,
      )}
    >
      {children}
    </span>
  )
}

export function BracketAnchor({
  href,
  children,
  side = 'both',
  tone = 'blue',
  active = false,
  className,
  surface,
}: {
  href: string
  children: ReactNode
  side?: 'left' | 'right' | 'both'
  tone?: 'blue' | 'accent'
  active?: boolean
  className?: string
  surface?: AccentTone
}) {
  const interactive = navTone[tone]
  const resolvedSurface = useSurfaceTone(surface)
  const activeToneClass =
    tone === 'blue'
      ? 'border-[var(--border-strong)] bg-[var(--brand-primary)] text-[var(--brand-primary-foreground)]'
      : 'border-[var(--border-strong)] bg-[var(--brand-accent)] text-[var(--brand-accent-foreground)]'
  const hoverToneClass =
    tone === 'blue'
      ? 'group-hover:border-[var(--border-strong)] group-hover:bg-[var(--brand-primary)] group-hover:text-[var(--brand-primary-foreground)]'
      : 'group-hover:border-[var(--border-strong)] group-hover:bg-[var(--brand-accent)] group-hover:text-[var(--brand-accent-foreground)]'

  return (
    <a
      href={href}
      className={cn(
        'group inline-flex items-center justify-start transition-colors duration-[var(--duration-fast)]',
        active ? 'pointer-events-none' : '',
        className,
      )}
    >
      <BracketLabel
        side={side}
        surface={resolvedSurface}
        className={cn(
          'min-h-[calc(var(--space-6)+var(--space-1))] px-[var(--space-3)] py-[var(--space-2)] font-semibold',
          active ? activeToneClass : hoverToneClass,
          active && interactive.bracket,
        )}
      >
        {children}
      </BracketLabel>
    </a>
  )
}

export function DocsNoteCard({
  label,
  title,
  tone = 'paper',
  className,
  children,
  titleSize = 'card',
  titleClassName,
  elevation = 'raised',
  padding = 'default',
}: {
  label?: string
  title?: string
  tone?: AccentTone
  className?: string
  children?: ReactNode
  titleSize?: keyof typeof panelTitleSize
  titleClassName?: string
  elevation?: keyof typeof surfaceElevationClass
  padding?: keyof typeof surfacePaddingClass
}) {
  const panelTone = panelToneForAccent(tone)

  return (
    <SurfacePanel
      tone={tone}
      elevation={elevation}
      padding={padding}
      className={cn('space-y-[var(--panel-gap)]', className)}
    >
      {label ? (
        <BracketLabel tone={panelTone} surface={tone} className="self-start">
          {label}
        </BracketLabel>
      ) : null}
      {title ? (
        <PanelTitle size={titleSize} tone={panelTone} className={titleClassName}>
          {title}
        </PanelTitle>
      ) : null}
      {children}
    </SurfacePanel>
  )
}

export function DocsCodeBlock({
  code,
  language = 'cli',
  label,
  className,
}: {
  code: string
  language?: DocsCodeLanguage
  label?: string
  className?: string
}) {
  const [copied, setCopied] = useState(false)
  const surface = useSurfaceTone()
  const terminalLabel = label ?? (language === 'cli' ? 'CLI' : language === 'typescript' ? 'TypeScript' : 'Text')

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  if (language === 'cli') {
    return (
      <div className={cn('min-w-0 space-y-[var(--space-2)]', className)}>
        <div className="flex items-center justify-between gap-[var(--panel-gap-tight)]">
          <BracketLabel surface={surface}>{terminalLabel}</BracketLabel>
          <Button type="button" variant="secondary" size="sm" aria-label={`Copy ${terminalLabel}`} onClick={handleCopy}>
            <Copy size={14} />
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
        <CommandTerminal
          code={code}
          title={terminalLabel}
          language="bash"
          animate={false}
          copyable={false}
        />
        <span className="sr-only" aria-live="polite">
          {copied ? `${terminalLabel} copied to clipboard` : ''}
        </span>
      </div>
    )
  }

  return (
    <div className={cn('min-w-0 space-y-[var(--space-2)]', className)}>
      <div className="flex items-center justify-between gap-[var(--panel-gap-tight)]">
        <BracketLabel surface={surface}>{terminalLabel}</BracketLabel>
        <Button type="button" variant="secondary" size="sm" aria-label={`Copy ${terminalLabel}`} onClick={handleCopy}>
          <Copy size={14} />
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <CodeBlock language={language === 'typescript' ? 'typescript' : undefined} filename={terminalLabel}>
        {code}
      </CodeBlock>
      <span className="sr-only" aria-live="polite">
        {copied ? `${terminalLabel} copied to clipboard` : ''}
      </span>
    </div>
  )
}

export function CopyableCommandBlock({
  command,
  label = 'Command',
  copyLabel = 'Copy',
  copiedLabel = 'Copied',
  ariaLabel,
  className,
}: {
  command: string
  label?: string
  copyLabel?: string
  copiedLabel?: string
  ariaLabel?: string
  className?: string
}) {
  const [copied, setCopied] = useState(false)
  const surface = useSurfaceTone()
  const labelTone = panelToneForAccent(surface)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(command)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  return (
    <div className={cn('grid min-w-0 gap-[var(--space-2)]', className)}>
      <div className="flex items-center justify-between gap-[var(--space-3)]">
        <PanelEyebrow tone={labelTone} className="max-w-none">
          {label}
        </PanelEyebrow>
        <Button type="button" variant="secondary" size="sm" aria-label={ariaLabel ?? `Copy ${label}`} onClick={handleCopy}>
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? copiedLabel : copyLabel}
        </Button>
      </div>
      <div
        className="min-w-0 overflow-hidden border-2 border-[var(--border-strong)] px-[var(--space-3)] py-[var(--space-3)] font-mono text-[13px] leading-[1.65]"
        style={{ background: 'var(--code-bg)', color: 'var(--code-text)' }}
      >
        <code
          className="block"
          style={{
            background: 'transparent',
            border: 0,
            borderRadius: 0,
            color: 'inherit',
            overflowWrap: 'anywhere',
            padding: 0,
            whiteSpace: 'pre-wrap',
          }}
        >
          {command}
        </code>
      </div>
      <span className="sr-only" aria-live="polite">
        {copied ? `${label} copied to clipboard` : ''}
      </span>
    </div>
  )
}

export function CommandBlock({
  title,
  command,
  truth,
  label,
  hideLabel = false,
  tone = 'paper',
  elevation = 'raised',
  description,
}: {
  title: string
  command: string
  truth?: TruthState
  label?: string
  hideLabel?: boolean
  tone?: AccentTone
  elevation?: keyof typeof surfaceElevationClass
  description?: ReactNode
}) {
  return (
    <DocsNoteCard
      label={hideLabel ? undefined : label ?? (truth ? truth : 'Command')}
      title={title}
      tone={tone}
      elevation={elevation}
      titleSize="nav"
      titleClassName="tracking-[var(--tracking-display-nav)]"
    >
      <DocsCodeBlock code={command} language="cli" label={title} />
      {description ? (
        <PanelBody size="compact" tone={surfaceBodyTone[tone]} className="max-w-none">
          {description}
        </PanelBody>
      ) : null}
    </DocsNoteCard>
  )
}

export function BracketLink({
  to,
  children,
  side = 'both',
  tone = 'blue',
  className,
  surface,
}: {
  to: string
  children: ReactNode
  side?: 'left' | 'right' | 'both'
  tone?: 'blue' | 'accent'
  className?: string
  surface?: AccentTone
}) {
  const resolvedSurface = useSurfaceTone(surface)
  const hoverToneClass =
    tone === 'blue'
      ? 'group-hover:border-[var(--border-strong)] group-hover:bg-[var(--brand-primary)] group-hover:text-[var(--brand-primary-foreground)]'
      : 'group-hover:border-[var(--border-strong)] group-hover:bg-[var(--brand-accent)] group-hover:text-[var(--brand-accent-foreground)]'

  return (
    <Link
      to={to}
      className={cn(
        'group inline-flex items-center justify-start transition-colors duration-[var(--duration-fast)]',
        className,
      )}
    >
      <BracketLabel
        side={side}
        surface={resolvedSurface}
        className={cn(
          'min-h-[calc(var(--space-6)+var(--space-1))] px-[var(--space-3)] py-[var(--space-2)] font-semibold',
          hoverToneClass,
        )}
      >
        {children}
      </BracketLabel>
    </Link>
  )
}

export function BracketNavLink({
  to,
  children,
  side = 'both',
  tone = 'blue',
  className,
  surface,
  end,
}: {
  to: string
  children: ReactNode
  side?: 'left' | 'right' | 'both'
  tone?: 'blue' | 'accent'
  className?: string
  surface?: AccentTone
  end?: boolean
}) {
  const interactive = navTone[tone]
  const resolvedSurface = useSurfaceTone(surface)

  return (
    <NavLink to={to} end={end} className={cn('group inline-flex items-center justify-start', className)}>
      {({ isActive }) => (
        <BracketLabel
          side={side}
          surface={resolvedSurface}
          className={cn(
            'min-h-[calc(var(--space-6)+var(--space-1))] px-[var(--space-3)] py-[var(--space-2)] font-semibold transition-colors duration-[var(--duration-fast)]',
            isActive
              ? cn(
                  tone === 'blue'
                    ? 'border-[var(--border-strong)] bg-[var(--brand-primary)] text-[var(--brand-primary-foreground)]'
                    : 'border-[var(--border-strong)] bg-[var(--brand-accent)] text-[var(--brand-accent-foreground)]',
                  interactive.bracket,
                )
              : tone === 'blue'
                ? 'group-hover:border-[var(--border-strong)] group-hover:bg-[var(--brand-primary)] group-hover:text-[var(--brand-primary-foreground)]'
                : 'group-hover:border-[var(--border-strong)] group-hover:bg-[var(--brand-accent)] group-hover:text-[var(--brand-accent-foreground)]',
          )}
        >
          {children}
        </BracketLabel>
      )}
    </NavLink>
  )
}

export function DocsHero({
  eyebrow,
  title,
  summary,
  paragraphs = [],
  aside,
  titleClassName,
}: {
  eyebrow: string
  title: string
  summary: string
  paragraphs?: string[]
  aside?: ReactNode
  titleClassName?: string
}) {
  return (
    <SurfaceToneContext.Provider value="paper">
      <SurfacePanel>
        <div className="grid gap-[var(--panel-gap-loose)] lg:grid-cols-12">
          <div className={cn('space-y-[var(--panel-gap)]', aside ? 'lg:col-span-7' : 'lg:col-span-12')}>
            <BracketLabel>{eyebrow}</BracketLabel>
            <PanelTitle as="h1" size="section" className={cn('max-w-[13ch]', titleClassName)}>
              {title}
            </PanelTitle>
            <PanelBody className="max-w-[46rem]">{summary}</PanelBody>
            {paragraphs.length ? (
              <div className="space-y-[var(--panel-gap-tight)]">
                {paragraphs.map((paragraph) => (
                  <PanelBody key={paragraph}>{paragraph}</PanelBody>
                ))}
              </div>
            ) : null}
          </div>

          {aside ? <div className="grid content-start gap-[var(--panel-gap)] lg:col-span-5">{aside}</div> : null}
        </div>
      </SurfacePanel>
    </SurfaceToneContext.Provider>
  )
}

export function DocsModulePanel({
  truth,
  title,
  body,
  bullets,
  code,
  tone = 'paper',
  featured = false,
}: {
  truth: TruthState
  title: string
  body?: string[]
  bullets?: string[]
  code?: string
  tone?: AccentTone
  featured?: boolean
}) {
  const panelTone = panelToneForAccent(tone)
  const explicitTitleToneClass =
    tone === 'blue'
      ? '!text-[var(--brand-primary-foreground)]'
      : tone === 'accent'
        ? '!text-[var(--brand-accent-foreground)]'
        : ''

  return (
    <SurfacePanel tone={tone} className={cn('space-y-[var(--panel-gap)]', featured ? 'min-h-[20rem]' : '')}>
      <div className="space-y-[var(--panel-gap-tight)]">
        <TruthBadge truth={truth} />
        <PanelTitle
          size={featured ? 'display' : 'card'}
          tone={panelTone}
          className={cn(featured ? 'max-w-[14ch]' : '', explicitTitleToneClass)}
        >
          {title}
        </PanelTitle>
      </div>

      {body?.length ? (
        <div className="space-y-[var(--panel-gap-tight)]">
          {body.map((paragraph) => (
            <PanelBody key={paragraph} tone={panelTone}>
              {paragraph}
            </PanelBody>
          ))}
        </div>
      ) : null}

      {bullets?.length ? <PanelList items={bullets} tone={surfaceBodyTone[tone]} /> : null}

      {code ? <DocsCodeBlock code={code} language="text" label={title} /> : null}
    </SurfacePanel>
  )
}

export function DocsCard({
  kicker,
  title,
  summary,
  href,
  tone = 'paper',
  variant = 'feature',
  active = false,
  highlightTone = 'blue',
  bracketSide = 'both',
  linked = true,
  className,
}: {
  kicker?: string
  title: string
  summary: string
  href: string
  tone?: AccentTone
  variant?: 'feature' | 'nav'
  active?: boolean
  highlightTone?: 'blue' | 'accent'
  bracketSide?: 'left' | 'right' | 'both'
  linked?: boolean
  className?: string
}) {
  const interactive = navTone[highlightTone]
  const navSummaryTone =
    active
      ? highlightTone === 'blue'
        ? 'primary'
        : 'accent'
      : 'default'

  const content = (
    <div
      className={cn(
        'flex h-full flex-col justify-between gap-[var(--panel-gap-loose)] border-2 p-[var(--panel-padding)] shadow-none transition-colors duration-150',
        variant === 'nav'
          ? [
              'border border-[var(--border-default)] bg-[var(--surface-raised)] p-[var(--space-4)] text-[var(--text-primary)] shadow-none',
              active
                ? interactive.active
                : `hover:border-[var(--border-strong)] ${interactive.hover}`,
            ]
          : ['border-[var(--border-strong)]', docsCardTone[tone]],
      )}
    >
      <div className="space-y-[var(--panel-gap)]">
        {variant === 'feature' && kicker ? (
          <div className="flex items-center gap-[var(--panel-gap-tight)] border-b-2 border-current/20 pb-[var(--panel-gap-tight)]">
            <div className="font-sans text-xl font-black">{kicker}</div>
            <div className="h-5 w-px bg-current/30" />
            <PanelEyebrow
              tone={tone === 'blue' ? 'primary' : tone === 'accent' ? 'accent' : 'default'}
            >
              Docs
            </PanelEyebrow>
          </div>
        ) : null}

        {variant === 'nav' ? (
          <BracketLabel
            side={bracketSide}
            className={cn(
              active
                ? interactive.bracket
                : 'text-[var(--text-secondary)] group-hover:border-current group-hover:text-current',
            )}
          >
            {title}
          </BracketLabel>
        ) : (
          <PanelTitle
            as="h3"
            size="nav"
            tone={tone === 'blue' ? 'primary' : tone === 'accent' ? 'accent' : 'default'}
          >
            {title}
          </PanelTitle>
        )}

        <PanelBody
          size="compact"
          tone={variant === 'nav' ? navSummaryTone : surfaceBodyTone[tone]}
          className={cn(
            'max-w-[34rem]',
            variant === 'nav' && !active ? 'group-hover:text-current' : '',
            variant === 'nav' && active ? interactive.body : '',
          )}
        >
          {summary}
        </PanelBody>
      </div>
      {variant === 'feature' ? (
        <div
          className={cn(
            'inline-flex items-center gap-2 font-sans text-[length:var(--type-meta-size)] font-medium uppercase tracking-[var(--tracking-meta)]',
            tone === 'blue'
              ? 'text-[color:var(--brand-primary-foreground-subtle)] group-hover:text-[var(--brand-primary-foreground)]'
              : tone === 'accent'
                ? 'text-[color:var(--brand-accent-foreground-subtle)] group-hover:text-[var(--brand-accent-foreground)]'
                : 'text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]',
          )}
        >
          Read section
          <ArrowRight size={14} />
        </div>
      ) : (
        <div
          className={cn(
            'inline-flex items-center gap-2 font-sans text-[length:var(--type-meta-size)] font-medium uppercase tracking-[var(--tracking-meta)]',
            active
              ? highlightTone === 'blue'
                ? 'text-[color:var(--brand-primary-foreground-muted)]'
                : 'text-[color:var(--brand-accent-foreground-muted)]'
              : 'text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]',
          )}
        >
          {active ? 'Current section' : 'Open section'}
          <ArrowRight size={14} />
        </div>
      )}
    </div>
  )

  if (!linked) {
    return <div className={cn('group block', className)}>{content}</div>
  }

  return (
    <Link to={href} className={cn('group block', className)}>
      {content}
    </Link>
  )
}
