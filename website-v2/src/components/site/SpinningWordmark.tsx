import { useId } from 'react'
import { cn } from '@/lib/utils'

/**
 * The hero's spinning wordmark — rendered INLINE (not an <img>) so the colour
 * animation is CSS-driven: it only travels while the mark spins and FREEZES
 * under `prefers-reduced-motion`.
 *
 * Colour cadence: the p·d glyph flips 180° twice per 6s. The palette advances
 * exactly ONE notch per 180° turn — synced 1:1 to the flip — over an 18s,
 * 6-turn cycle (= 3 flip cycles, two full {cobalt,ink,seafoam} rotations, so it
 * loops seamlessly). Each change snaps in fast then brakes with a little
 * overshoot, and sweeps left→right across "Port Daddy" (radially on the pd).
 */

const PALETTE = {
  c1: 'var(--brand-primary)',
  c2: 'var(--text-primary)',
  c3: 'var(--brand-accent)',
  grid: 'var(--border-subtle)',
  sea: 'var(--brand-accent)',
  amber: 'var(--status-warning)',
  cobalt: 'var(--brand-primary)',
  ink: 'var(--text-primary)',
  muted: 'var(--text-muted)',
} as const

// Turn centres as % of the 18s colour cycle — the six 180° flips (two per 6s
// flip cycle, centred at 30% and 75% of each). One colour change at each.
const TURN_PCT = [10, 25, 43.33, 58.33, 76.67, 91.67]
const HALF = 1.6 // half-width of each (quick) transition window, in %
// Fast in, hard brake, slight overshoot — the "fly in and stop like braking".
const BRAKE = 'cubic-bezier(0.16, 1.3, 0.3, 1)'
const C = ['var(--c1)', 'var(--c2)', 'var(--c3)']

/** One keyframe track per base colour; advances one notch at each turn window. */
function turnKeyframes(base: number): string {
  let s = `@keyframes pdw-turn${base}{0%{stop-color:${C[base % 3]}}`
  TURN_PCT.forEach((c, k) => {
    const from = C[(base + k) % 3]
    const to = C[(base + k + 1) % 3]
    s += `${(c - HALF).toFixed(2)}%{stop-color:${from};animation-timing-function:${BRAKE};}`
    s += `${(c + HALF).toFixed(2)}%{stop-color:${to};}`
  })
  return s + `100%{stop-color:${C[base % 3]}}}`
}

const TURN_KEYFRAMES = [0, 1, 2].map(turnKeyframes).join('\n')

const STYLE = `
  .pdw-pivot { transform-origin: 150px 150px; }
  .pdw-s1 { animation: pdw-spin 10s linear infinite; }
  .pdw-s2 { animation: pdw-spin-r 7s ease-in-out infinite; }
  .pdw-s3 { animation: pdw-spin 5s linear infinite; }
  .pdw-flip { animation: pdw-flip 6s cubic-bezier(0.77,0,0.17,1) infinite; }
  @keyframes pdw-spin   { 100% { transform: rotate(360deg); } }
  @keyframes pdw-spin-r { 100% { transform: rotate(-360deg); } }
  @keyframes pdw-flip {
    0%,15% { transform: rotate(0deg); } 45%,65% { transform: rotate(180deg); } 85%,100% { transform: rotate(360deg); }
  }
  ${TURN_KEYFRAMES}
  /* base colours = the resting (reduced-motion) state */
  .pdw-t0 { stop-color: var(--c1); animation: pdw-turn0 18s linear infinite; }
  .pdw-t1 { stop-color: var(--c2); animation: pdw-turn1 18s linear infinite; }
  .pdw-t2 { stop-color: var(--c3); animation: pdw-turn2 18s linear infinite; }
  @media (prefers-reduced-motion: reduce) {
    .pdw-s1, .pdw-s2, .pdw-s3, .pdw-flip,
    .pdw-t0, .pdw-t1, .pdw-t2 { animation: none; }
  }
  .pdw-words { font-family: var(--font-display, "Radnika","Helvetica Neue",Helvetica,Arial,sans-serif); font-weight: 900; }
  .pdw-tag   { font-family: var(--font-display, "Radnika","Helvetica Neue",Helvetica,Arial,sans-serif); font-weight: 700; }
`

// Word gradient: 5 stops; small left→right stagger so the change sweeps across.
const WORD_STOPS = [0, 0.25, 0.5, 0.75, 1].map((offset, i) => ({
  offset,
  base: i % 3,
  delay: -0.12 * (4 - i), // left stops lead → left-to-right sweep
}))
// Radial gradient: 4 stops; inner leads → washes outward.
const RAD_STOPS = [0, 0.4, 0.72, 1].map((offset, i) => ({
  offset,
  base: i % 3,
  delay: -0.12 * i,
}))

export function SpinningWordmark({ className }: { className?: string }) {
  const id = useId().replaceAll(':', '')
  const maskId = `pdw-mask-${id}`
  const radialWashId = `pdw-rad-wash-${id}`
  const wordWashId = `pdw-word-wash-${id}`
  const p = PALETTE
  const rootStyle = { '--c1': p.c1, '--c2': p.c2, '--c3': p.c3 } as React.CSSProperties

  return (
    <svg
      className={cn('pdw block w-auto select-none', className)}
      style={rootStyle}
      viewBox="0 0 860 220"
      role="img"
      aria-label="Port Daddy"
      xmlns="http://www.w3.org/2000/svg"
    >
      <style>{STYLE}</style>
      <defs>
        {/* Tilted linear wash for the words (objectBoundingBox; y2 > 0 => tilt). */}
        <linearGradient id={wordWashId} x1="0" y1="0" x2="1" y2="0.16">
          {WORD_STOPS.map((s, i) => (
            <stop key={i} className={`pdw-t${s.base}`} offset={s.offset} style={{ animationDelay: `${s.delay}s` }} />
          ))}
        </linearGradient>
      </defs>

      {/* MARK */}
      <svg x="10" y="10" width="200" height="200" viewBox="0 0 300 300">
        <defs>
          <mask id={maskId} maskContentUnits="userSpaceOnUse">
            <g stroke="white" strokeWidth="14" strokeLinecap="butt" fill="none">
              <line x1="110" y1="110" x2="110" y2="210" />
              <circle cx="135" cy="135" r="25" />
            </g>
          </mask>
          {/* Radial wash for the p·d monogram, centred on the glyph. */}
          <radialGradient id={radialWashId} gradientUnits="userSpaceOnUse" cx="150" cy="150" r="72">
            {RAD_STOPS.map((s, i) => (
              <stop key={i} className={`pdw-t${s.base}`} offset={s.offset} style={{ animationDelay: `${s.delay}s` }} />
            ))}
          </radialGradient>
        </defs>

        <g stroke={p.grid} strokeWidth="1.5" fill="none">
          <circle cx="150" cy="150" r="45" />
          <circle cx="150" cy="150" r="90" />
          <circle cx="150" cy="150" r="135" />
          <line x1="15" y1="150" x2="285" y2="150" strokeDasharray="4 4" />
          <line x1="150" y1="15" x2="150" y2="285" strokeDasharray="4 4" />
          <line x1="55" y1="55" x2="245" y2="245" strokeDasharray="2 6" />
          <line x1="55" y1="245" x2="245" y2="55" strokeDasharray="2 6" />
        </g>
        <g className="pdw-pivot pdw-s1">
          <circle cx="150" cy="150" r="125" fill="none" stroke={p.sea} strokeWidth="2" strokeDasharray="1 8" strokeLinecap="round" opacity="0.7" />
          <path d="M 145 25 L 155 25" stroke={p.sea} strokeWidth="3" fill="none" />
          <path d="M 145 275 L 155 275" stroke={p.sea} strokeWidth="3" fill="none" />
          <path d="M 25 145 L 25 155" stroke={p.sea} strokeWidth="3" fill="none" />
          <path d="M 275 145 L 275 155" stroke={p.sea} strokeWidth="3" fill="none" />
        </g>
        <g className="pdw-pivot pdw-s2">
          <circle cx="150" cy="150" r="105" fill="none" stroke={p.amber} strokeWidth="2" strokeDasharray="40 10 5 10" opacity="0.8" />
          <circle cx="150" cy="150" r="115" fill="none" stroke={p.cobalt} strokeWidth="1.5" strokeDasharray="2 4" opacity="0.6" />
        </g>
        <g className="pdw-pivot pdw-s3" stroke={p.cobalt} strokeWidth="2" fill="none">
          <path d="M 213 87 A 90 90 0 0 0 187 68" />
          <path d="M 87 87 A 90 90 0 0 1 113 68" />
          <path d="M 213 213 A 90 90 0 0 1 187 232" />
          <path d="M 87 213 A 90 90 0 0 0 113 232" />
        </g>
        <g className="pdw-pivot pdw-flip">
          {/* p and d share the radial wash; amber intersection stays constant */}
          <g stroke={`url(#${radialWashId})`} strokeWidth="14" strokeLinecap="butt" fill="none">
            <line x1="110" y1="110" x2="110" y2="210" />
            <circle cx="135" cy="135" r="25" />
          </g>
          <g stroke={`url(#${radialWashId})`} strokeWidth="14" strokeLinecap="butt" fill="none">
            <line x1="190" y1="190" x2="190" y2="90" />
            <circle cx="165" cy="165" r="25" />
          </g>
          <g stroke={p.amber} strokeWidth="14" strokeLinecap="butt" fill="none" mask={`url(#${maskId})`}>
            <line x1="190" y1="190" x2="190" y2="90" />
            <circle cx="165" cy="165" r="25" />
          </g>
        </g>
        <circle cx="150" cy="150" r="4" fill="none" stroke={p.cobalt} strokeWidth="2" />
      </svg>

      {/* TYPE */}
      <text className="pdw-words" x="240" y="118" fontSize="74" letterSpacing="-1" fill={`url(#${wordWashId})`}>Port Daddy</text>
      <line x1="242" y1="146" x2="820" y2="146" stroke={p.ink} strokeWidth="3" />
      <text className="pdw-tag" x="242" y="178" fontSize="18" letterSpacing="2.6" fill={p.muted}>A HARBOR-MASTER FOR YOUR AGENTS</text>
    </svg>
  )
}
