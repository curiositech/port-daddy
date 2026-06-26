import { useTheme } from '@/lib/theme-context'
import { cn } from '@/lib/utils'

/**
 * The hero's spinning wordmark — rendered INLINE (not an <img>) so the colour
 * washes are CSS-driven and therefore (a) smooth gradient transitions rather
 * than discrete jumps, and (b) gated by `prefers-reduced-motion`, so the colours
 * only travel while the mark is actually spinning and freeze when it sits still.
 *
 *   - "Port Daddy" type: a slightly-tilted linear gradient that washes
 *     left → right across both words (animated stop-colours, smooth crossfade).
 *   - the p·d monogram: a radial gradient that washes outward from the centre
 *     while the glyph spins.
 *
 * The spin (CSS transforms) and both washes share one reduced-motion switch.
 */

const PALETTE = {
  light: { c1: '#2076FE', c2: '#121212', c3: '#12B88F', grid: '#DCE3EB', sea: '#12B88F', amber: '#F5A623', cobalt: '#2076FE', ink: '#121212', muted: '#47423A' },
  dark: { c1: '#7DB4FF', c2: '#F5F3ED', c3: '#20DEB0', grid: '#1A2434', sea: '#20DEB0', amber: '#FFB505', cobalt: '#2076FE', ink: '#F5F3ED', muted: '#A59F93' },
} as const

export function SpinningWordmark({ className }: { className?: string }) {
  const { theme } = useTheme()
  const p = PALETTE[theme === 'dark' ? 'dark' : 'light']

  const css = `
    .pdw { --c1:${p.c1}; --c2:${p.c2}; --c3:${p.c3}; }
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

    /* Smooth colour wash: stops crossfade through the palette; a per-stop phase
       offset makes the colour band travel along the gradient axis. */
    @keyframes pdw-wash {
      0% { stop-color: var(--c1); } 33.33% { stop-color: var(--c2); }
      66.66% { stop-color: var(--c3); } 100% { stop-color: var(--c1); }
    }
    .pdw-word-stop, .pdw-rad-stop { animation: pdw-wash 6s linear infinite; }
    /* Words wash left -> right: left stops lead the cycle. */
    .pdw-ws0 { stop-color: var(--c1); animation-delay: 0s; }
    .pdw-ws1 { stop-color: var(--c2); animation-delay: -1.2s; }
    .pdw-ws2 { stop-color: var(--c3); animation-delay: -2.4s; }
    .pdw-ws3 { stop-color: var(--c1); animation-delay: -3.6s; }
    .pdw-ws4 { stop-color: var(--c2); animation-delay: -4.8s; }
    /* Monogram washes outward: inner stop leads. */
    .pdw-rs0 { stop-color: var(--c1); animation-delay: 0s; }
    .pdw-rs1 { stop-color: var(--c2); animation-delay: -1.5s; }
    .pdw-rs2 { stop-color: var(--c3); animation-delay: -3s; }
    .pdw-rs3 { stop-color: var(--c1); animation-delay: -4.5s; }

    /* Sitting still (reduced motion): stop spinning AND stop the colour wash —
       the lockup holds its resting colours. */
    @media (prefers-reduced-motion: reduce) {
      .pdw-s1, .pdw-s2, .pdw-s3, .pdw-flip,
      .pdw-word-stop, .pdw-rad-stop { animation: none; }
    }

    .pdw-words { font-family: var(--font-display, "Radnika","Helvetica Neue",Helvetica,Arial,sans-serif); font-weight: 900; }
    .pdw-tag   { font-family: var(--font-display, "Radnika","Helvetica Neue",Helvetica,Arial,sans-serif); font-weight: 700; }
  `

  return (
    <svg
      className={cn('pdw w-auto select-none', className)}
      viewBox="0 0 720 220"
      role="img"
      aria-label="Port Daddy"
      xmlns="http://www.w3.org/2000/svg"
    >
      <style>{css}</style>
      <defs>
        {/* Tilted linear wash for the words (objectBoundingBox; y2 > 0 => tilt). */}
        <linearGradient id="pdw-word-wash" x1="0" y1="0" x2="1" y2="0.16">
          <stop className="pdw-word-stop pdw-ws0" offset="0" />
          <stop className="pdw-word-stop pdw-ws1" offset="0.25" />
          <stop className="pdw-word-stop pdw-ws2" offset="0.5" />
          <stop className="pdw-word-stop pdw-ws3" offset="0.75" />
          <stop className="pdw-word-stop pdw-ws4" offset="1" />
        </linearGradient>
      </defs>

      {/* MARK */}
      <svg x="10" y="10" width="200" height="200" viewBox="0 0 300 300">
        <defs>
          <mask id="pdw-mask" maskContentUnits="userSpaceOnUse">
            <g stroke="white" strokeWidth="14" strokeLinecap="butt" fill="none">
              <line x1="110" y1="110" x2="110" y2="210" />
              <circle cx="135" cy="135" r="25" />
            </g>
          </mask>
          {/* Radial wash for the p·d monogram, centred on the glyph. */}
          <radialGradient id="pdw-rad-wash" gradientUnits="userSpaceOnUse" cx="150" cy="150" r="72">
            <stop className="pdw-rad-stop pdw-rs0" offset="0" />
            <stop className="pdw-rad-stop pdw-rs1" offset="0.4" />
            <stop className="pdw-rad-stop pdw-rs2" offset="0.72" />
            <stop className="pdw-rad-stop pdw-rs3" offset="1" />
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
          <g stroke="url(#pdw-rad-wash)" strokeWidth="14" strokeLinecap="butt" fill="none">
            <line x1="110" y1="110" x2="110" y2="210" />
            <circle cx="135" cy="135" r="25" />
          </g>
          <g stroke="url(#pdw-rad-wash)" strokeWidth="14" strokeLinecap="butt" fill="none">
            <line x1="190" y1="190" x2="190" y2="90" />
            <circle cx="165" cy="165" r="25" />
          </g>
          <g stroke={p.amber} strokeWidth="14" strokeLinecap="butt" fill="none" mask="url(#pdw-mask)">
            <line x1="190" y1="190" x2="190" y2="90" />
            <circle cx="165" cy="165" r="25" />
          </g>
        </g>
        <circle cx="150" cy="150" r="4" fill="none" stroke={p.cobalt} strokeWidth="2" />
      </svg>

      {/* TYPE */}
      <text className="pdw-words" x="240" y="118" fontSize="74" letterSpacing="-1" fill="url(#pdw-word-wash)">Port Daddy</text>
      <line x1="242" y1="146" x2="700" y2="146" stroke={p.ink} strokeWidth="3" />
      <text className="pdw-tag" x="242" y="178" fontSize="18" letterSpacing="2.6" fill={p.muted}>A HARBOR-MASTER FOR YOUR AGENTS</text>
    </svg>
  )
}
