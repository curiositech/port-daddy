/**
 * Capability attenuation under delegation (Chapter 2, `fig-anchor-capability-attenuation.tex`),
 * drawn as three nested rings — a Russian doll of authority. Each child capability is
 * a *strict subset* of its parent's: both the granted rights and the TTL shrink
 * monotonically across every delegation hop. A macaroon-style chain only ever
 * contracts; it can never widen.
 *
 *   Daemon  → Root cap   db:*, fs:*, net:*   TTL 1h
 *   AgentA  → AgentA cap  db:write, fs:read   TTL 15m
 *   AgentB  → AgentB cap  db:write            TTL 5m   (cannot re-grant net:*)
 *
 * Every color is a CSS custom property (`var(--token)`), so the figure tracks the
 * page theme via the `[data-theme]` cascade with no JS. All `<text>` is sized ≥13px;
 * the rights codes are mono and the ring titles are bold uppercase meta text.
 */

import React from 'react'

interface Ring {
  holder: string
  rights: string
  ttl: string
  /** Concentric box geometry — each strictly inside the one before it. */
  x: number
  y: number
  w: number
  h: number
  fill: string
  /** Header tint opacity over the fill. */
  emphasis: boolean
}

// Each ring is inset 56px on every side from its parent and given enough
// vertical room (≥72px) that its header and rights line never crowd the inner
// ring's border. The Russian-doll nesting reads clearly with real breathing
// room between the three cards.
const RINGS: Ring[] = [
  { holder: 'Root cap · daemon', rights: 'db:*  fs:*  net:*', ttl: 'TTL 1h', x: 16, y: 16, w: 408, h: 268, fill: 'var(--surface-raised)', emphasis: false },
  { holder: 'AgentA cap', rights: 'db:write  fs:read', ttl: 'TTL 15m', x: 72, y: 72, w: 296, h: 156, fill: 'var(--surface-base)', emphasis: false },
  { holder: 'AgentB cap', rights: 'db:write', ttl: 'TTL 5m', x: 128, y: 128, w: 184, h: 44, fill: 'var(--brand-primary)', emphasis: true },
]

export function AnchorCapabilityAttenuation() {
  const uid = React.useId()
  const titleId = `${uid}-atten-title`
  const descId = `${uid}-atten-desc`
  const arrowId = `${uid}-deny-arrow`
  return (
    <figure className="grid gap-[var(--space-4)] border-2 border-[var(--border-strong)] bg-[var(--surface-base)] shadow-[var(--shadow-brutal)]">
      <div className="overflow-x-auto p-[var(--space-5)]">
        <svg
          viewBox="0 0 600 360"
          role="img"
          aria-labelledby={`${titleId} ${descId}`}
          className="mx-auto block min-w-[30rem] max-w-[42rem]"
        >
          <title id={titleId}>Capability attenuation, drawn as three nested rings</title>
          <desc id={descId}>
            Three concentric rounded rectangles, each a strict subset of the one
            around it. Outermost is the daemon&apos;s root cap (db, fs, net; one
            hour). Inside it, AgentA&apos;s cap (db:write, fs:read; fifteen minutes).
            Innermost, AgentB&apos;s cap (db:write only; five minutes). A side panel
            states the attenuation invariants, and a denied arrow shows AgentB cannot
            re-grant net access it never held.
          </desc>

          <defs>
            <marker id={arrowId} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--brand-primary)" />
            </marker>
          </defs>

          {/* Nested capability rings, outermost first so inner paints on top. */}
          {RINGS.map((ring) => (
            <g key={ring.holder} transform={`translate(${ring.x}, ${ring.y})`}>
              <rect width={ring.w} height={ring.h} rx="8" fill={ring.fill} stroke="var(--border-strong)" strokeWidth="2" />
              {ring.emphasis ? (
                <>
                  <text x="14" y="22" fill="var(--brand-primary-foreground)" style={{ font: '800 13px var(--font-sans)', letterSpacing: '0.04em' }}>
                    {ring.holder.toUpperCase()}
                  </text>
                  <text x="14" y="40" fill="var(--brand-primary-foreground)" style={{ font: '600 13px var(--font-mono)' }}>
                    {ring.rights}  ·  {ring.ttl}
                  </text>
                </>
              ) : (
                <>
                  <text x="14" y="20" fill="var(--text-muted)" style={{ font: '800 12px var(--font-sans)', letterSpacing: '0.08em' }}>
                    {ring.holder.toUpperCase()}
                  </text>
                  <text x="14" y="38" fill="var(--text-primary)" style={{ font: '600 13px var(--font-mono)' }}>
                    {ring.rights}
                  </text>
                  <text x={ring.w - 14} y="20" textAnchor="end" fill="var(--brand-primary)" style={{ font: '700 13px var(--font-sans)' }}>
                    {ring.ttl}
                  </text>
                </>
              )}
            </g>
          ))}

          {/* Attenuation invariants panel, to the right of the rings. */}
          <g transform="translate(444, 24)">
            <rect width="140" height="140" rx="6" fill="var(--surface-strong)" stroke="var(--border-strong)" strokeWidth="2" />
            <text x="14" y="26" fill="var(--text-primary)" style={{ font: '800 13px var(--font-sans)', letterSpacing: '0.04em' }}>
              INVARIANTS
            </text>
            <text x="14" y="54" fill="var(--text-secondary)" style={{ font: '500 13px var(--font-sans)' }}>
              child cap ⊊ parent
            </text>
            <text x="14" y="80" fill="var(--text-secondary)" style={{ font: '500 13px var(--font-sans)' }}>
              child TTL &lt; parent
            </text>
            <text x="14" y="106" fill="var(--text-secondary)" style={{ font: '500 13px var(--font-sans)' }}>
              cannot re-grant
            </text>
            <text x="14" y="124" fill="var(--text-secondary)" style={{ font: '500 13px var(--font-sans)' }}>
              beyond own cap
            </text>
          </g>

          {/* Denied re-grant: AgentB cannot push net:* downstream. */}
          <g transform="translate(16, 304)">
            <rect width="408" height="40" rx="6" fill="var(--surface-base)" stroke="var(--brand-primary)" strokeWidth="2" strokeDasharray="6 4" />
            <text x="204" y="25" textAnchor="middle" fill="var(--brand-primary)" style={{ font: '700 13px var(--font-sans)' }}>
              ✕ AgentB cannot grant net:* downstream
            </text>
          </g>
          <line x1="220" y1="172" x2="220" y2="304" stroke="var(--brand-primary)" strokeWidth="2" strokeDasharray="6 4" markerEnd={`url(#${arrowId})`} />
        </svg>
      </div>
      <figcaption className="border-t-2 border-[var(--border-strong)] p-[var(--space-4)] text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
        From Chapter 2, <span className="font-black text-[var(--text-primary)]">The Anchor Protocol</span>.
        Each delegation hop can only <span className="font-black text-[var(--text-primary)]">contract</span> authority:
        the child capability is a strict subset of its parent&apos;s, and its TTL is
        shorter. AgentB inherits only what AgentA explicitly hands down — and cannot
        re-grant rights it never held. Enforced at issuance (the parent signs the
        child&apos;s attenuated claim set) and re-checked at verification.
      </figcaption>
    </figure>
  )
}
