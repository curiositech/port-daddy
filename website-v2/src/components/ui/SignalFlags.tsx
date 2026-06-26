import * as React from 'react'
import { cn } from '@/lib/utils'
import { SIGNAL_FLAG_META, type FlagName } from './signalFlagMeta'

/**
 * Maritime Signal Flags — SVG renderings of the 6 ICS flags
 * used as status indicators throughout Port Daddy (ADR-0010).
 *
 * These are the REAL International Code of Signals flag patterns.
 * The SVGs use traditional ICS colors (blue/white/red/yellow/black),
 * NOT the --signal-* CSS tokens (which are for text coloring).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SignalFlagProps {
  flag: FlagName
  size?: 'sm' | 'md' | 'lg'
  className?: string
  title?: string
}

// ---------------------------------------------------------------------------
// ICS flag colors — traditional standardized colors
// ---------------------------------------------------------------------------

const ICS = {
  blue: '#003399',
  white: '#FFFFFF',
  red: '#CC0000',
  yellow: '#FFD100',
  black: '#000000',
} as const

// ---------------------------------------------------------------------------
// Size mapping
// ---------------------------------------------------------------------------

const sizeClasses: Record<NonNullable<SignalFlagProps['size']>, string> = {
  sm: 'w-4 h-4',
  md: 'w-6 h-6',
  lg: 'w-8 h-8',
}

// ---------------------------------------------------------------------------
// Individual flag SVG renderers
//
// Each returns the inner SVG elements for a 24x24 viewBox.
// The viewBox is always 0 0 24 24 regardless of rendered size.
// ---------------------------------------------------------------------------

/** Charlie (C): Five horizontal stripes — blue, white, red, white, blue */
function CharliePattern() {
  const h = 24 / 5 // 4.8 per stripe
  return (
    <>
      <rect x="0" y="0" width="24" height={h} fill={ICS.blue} />
      <rect x="0" y={h} width="24" height={h} fill={ICS.white} />
      <rect x="0" y={h * 2} width="24" height={h} fill={ICS.red} />
      <rect x="0" y={h * 3} width="24" height={h} fill={ICS.white} />
      <rect x="0" y={h * 4} width="24" height={h} fill={ICS.blue} />
    </>
  )
}

/** November (N): Blue and white checkerboard (4x4) */
function NovemberPattern() {
  const s = 6 // cell size: 24 / 4
  const cells: React.ReactElement[] = []
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      const isBlue = (row + col) % 2 === 0
      cells.push(
        <rect
          key={`${row}-${col}`}
          x={col * s}
          y={row * s}
          width={s}
          height={s}
          fill={isBlue ? ICS.blue : ICS.white}
        />
      )
    }
  }
  return <>{cells}</>
}

/** Kilo (K): Vertical split — yellow left, blue right */
function KiloPattern() {
  return (
    <>
      <rect x="0" y="0" width="12" height="24" fill={ICS.yellow} />
      <rect x="12" y="0" width="12" height="24" fill={ICS.blue} />
    </>
  )
}

/** Uniform (U): Four quadrants — red TL, white TR, white BL, red BR */
function UniformPattern() {
  return (
    <>
      <rect x="0" y="0" width="12" height="12" fill={ICS.red} />
      <rect x="12" y="0" width="12" height="12" fill={ICS.white} />
      <rect x="0" y="12" width="12" height="12" fill={ICS.white} />
      <rect x="12" y="12" width="12" height="12" fill={ICS.red} />
    </>
  )
}

/** Victor (V): White field with red St. Andrew's cross (X) */
function VictorPattern() {
  return (
    <>
      <rect x="0" y="0" width="24" height="24" fill={ICS.white} />
      <line x1="0" y1="0" x2="24" y2="24" stroke={ICS.red} strokeWidth="5" />
      <line x1="24" y1="0" x2="0" y2="24" stroke={ICS.red} strokeWidth="5" />
    </>
  )
}

/** Lima (L): Four quadrants — yellow TL, black TR, black BL, yellow BR */
function LimaPattern() {
  return (
    <>
      <rect x="0" y="0" width="12" height="12" fill={ICS.yellow} />
      <rect x="12" y="0" width="12" height="12" fill={ICS.black} />
      <rect x="0" y="12" width="12" height="12" fill={ICS.black} />
      <rect x="12" y="12" width="12" height="12" fill={ICS.yellow} />
    </>
  )
}

const FLAG_PATTERNS: Record<FlagName, () => React.ReactElement> = {
  charlie: CharliePattern,
  november: NovemberPattern,
  kilo: KiloPattern,
  uniform: UniformPattern,
  victor: VictorPattern,
  lima: LimaPattern,
}

// ---------------------------------------------------------------------------
// SignalFlag component
// ---------------------------------------------------------------------------

export function SignalFlag({ flag, size = 'md', className, title }: SignalFlagProps) {
  const meta = SIGNAL_FLAG_META[flag]
  const accessibleTitle = title ?? `${meta.name} — ${meta.meaning}`
  const Pattern = FLAG_PATTERNS[flag]

  return (
    <svg
      viewBox="0 0 24 24"
      role="img"
      aria-label={accessibleTitle}
      className={cn(sizeClasses[size], 'rounded-sm', className)}
      style={{ overflow: 'hidden' }}
    >
      <title>{accessibleTitle}</title>
      <Pattern />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// SignalFlagLegend — all 6 flags in a row with labels
// ---------------------------------------------------------------------------

export interface SignalFlagLegendProps {
  size?: SignalFlagProps['size']
  className?: string
  /** When true, show the "used for" text below the meaning */
  verbose?: boolean
}

const FLAG_ORDER: FlagName[] = ['charlie', 'november', 'kilo', 'uniform', 'victor', 'lima']

export function SignalFlagLegend({ size = 'md', className, verbose = false }: SignalFlagLegendProps) {
  return (
    <div className={cn('flex flex-wrap items-start gap-4', className)}>
      {FLAG_ORDER.map((name) => {
        const meta = SIGNAL_FLAG_META[name]
        return (
          <div key={name} className="flex items-center gap-2">
            <SignalFlag flag={name} size={size} />
            <div className="flex flex-col">
              <span
                className="text-[length:var(--type-meta-size)] font-semibold leading-tight"
                style={{ color: 'var(--text-primary)' }}
              >
                {meta.name}
              </span>
              <span
                className="text-[length:var(--type-meta-size)] leading-tight"
                style={{ color: 'var(--text-secondary)' }}
              >
                {meta.meaning}
              </span>
              {verbose && (
                <span
                  className="text-[length:var(--type-meta-size)] leading-tight"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {meta.usedFor}
                </span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export type { FlagName, SignalFlagMeta } from './signalFlagMeta'
