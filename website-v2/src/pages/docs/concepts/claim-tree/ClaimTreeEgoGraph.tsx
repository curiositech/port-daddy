const stateColors = {
  VERIFY: 'var(--brand-accent)',
  RESCUE: 'var(--warning)',
  COORDINATE: 'var(--error)',
  INSPECT: 'var(--brand-accent)',
  RECONCILE: 'var(--warning)',
  WATCH: 'var(--success)',
  PROCEED: 'var(--success)',
} as const

/**
 * A deliberately bounded projection: the viewer sees their claim, the one
 * counterpart, the shared surface, and the classifier state. It is the same
 * ego graph delivered to agents as Mermaid, given a human-operable face.
 */
export function ClaimTreeEgoGraph() {
  const state = 'COORDINATE' as const
  const color = stateColors[state]
  return (
    <figure className="overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-4 sm:p-6">
      <svg viewBox="0 0 760 290" className="h-auto w-full" role="img" aria-labelledby="ego-title ego-desc">
        <title id="ego-title">Claim-tree trouble ego graph</title>
        <desc id="ego-desc">Your claim and another agent's claim converge on one file, producing a coordinate action.</desc>
        <defs>
          <linearGradient id="ego-beam" x1="0" x2="1">
            <stop offset="0" stopColor="var(--brand-accent)" />
            <stop offset="1" stopColor={color} />
          </linearGradient>
          <filter id="ego-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="7" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <path d="M185 78 C300 78 322 126 380 145" fill="none" stroke="url(#ego-beam)" strokeWidth="5" opacity=".9" />
        <path d="M575 214 C476 214 448 169 380 145" fill="none" stroke={color} strokeWidth="5" opacity=".85" />
        <circle cx="380" cy="145" r="82" fill="var(--surface-base)" stroke={color} strokeWidth="4" filter="url(#ego-glow)" />
        <circle cx="380" cy="145" r="62" fill="none" stroke="var(--border-strong)" strokeWidth="1.5" strokeDasharray="4 6" />
        <g transform="translate(35 35)">
          <rect width="190" height="85" rx="12" fill="var(--surface-base)" stroke="var(--brand-accent)" strokeWidth="3" />
          <text x="18" y="32" fill="var(--brand-accent)" fontSize="13" fontWeight="700" letterSpacing="1.6">YOU</text>
          <text x="18" y="58" fill="var(--text-primary)" fontSize="17" fontWeight="700">session-you</text>
          <text x="18" y="76" fill="var(--text-muted)" fontSize="12">claims this surface</text>
        </g>
        <g transform="translate(535 170)">
          <rect width="190" height="85" rx="12" fill="var(--surface-base)" stroke={color} strokeWidth="3" />
          <text x="18" y="32" fill={color} fontSize="13" fontWeight="700" letterSpacing="1.6">COUNTERPART</text>
          <text x="18" y="58" fill="var(--text-primary)" fontSize="17" fontWeight="700">session-other</text>
          <text x="18" y="76" fill="var(--text-muted)" fontSize="12">also claims it</text>
        </g>
        <text x="380" y="134" textAnchor="middle" fill="var(--text-muted)" fontSize="11" fontWeight="700" letterSpacing="1.4">SHARED SURFACE</text>
        <text x="380" y="155" textAnchor="middle" fill="var(--text-primary)" fontSize="15" fontWeight="700">lib/auth.ts</text>
        <text x="380" y="173" textAnchor="middle" fill={color} fontSize="13" fontWeight="800">{state}</text>
      </svg>
      <figcaption className="mt-4 flex flex-col gap-2 border-t border-[var(--border-soft)] pt-4 text-sm sm:flex-row sm:items-center sm:justify-between">
        <span className="font-mono font-semibold" style={{ color }}>{state}</span>
        <span className="text-[var(--text-secondary)]">Open a parley, hand off, or split the surface before proceeding.</span>
      </figcaption>
    </figure>
  )
}
