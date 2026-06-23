/**
 * The zero-trust message envelope (Cryptography §3). Every message between
 * agents and operators is a signed, sealed envelope. The relay that carries it
 * can route it but cannot read its contents, cannot alter it without detection,
 * and cannot redirect it to an address it was not sent to. The receiver checks
 * the signature and the addressing before it acts on anything.
 *
 * Drawn left-to-right as Sender → [sealed + signed envelope] → Relay (route
 * only) → Receiver (verify, then act). The relay's three "cannot" guarantees
 * are stacked beneath it. Every color is a CSS custom property so the figure
 * tracks the page theme via the `[data-theme]` cascade with no JS. All `<text>`
 * is ≥13px; section labels are bold uppercase tracked meta text.
 */

import React from 'react'

const STAGE_W = 132
const STAGE_H = 72
// Sender at left, relay in the middle, receiver at right.
const SENDER_X = 24
const RELAY_X = 234
const RECEIVER_X = 444

export function ZeroTrustEnvelope() {
  const uid = React.useId()
  const titleId = `${uid}-zt-title`
  const descId = `${uid}-zt-desc`
  const arrowId = `${uid}-zt-arrow`
  return (
    <figure className="grid gap-[var(--space-4)] border-2 border-[var(--border-strong)] bg-[var(--surface-base)] shadow-[var(--shadow-brutal)]">
      <div className="overflow-x-auto p-[var(--space-5)]">
        <svg
          viewBox="0 0 600 300"
          role="img"
          aria-labelledby={`${titleId} ${descId}`}
          className="mx-auto block min-w-[34rem] max-w-[46rem]"
        >
          <title id={titleId}>A signed message envelope passing through an untrusted relay</title>
          <desc id={descId}>
            A sender on the left seals and signs an envelope. It passes to a relay
            in the middle that can route it but cannot read, alter, or redirect
            it. The receiver on the right verifies the signature and the address
            before acting. Three guarantees are listed under the relay: cannot
            read, cannot alter undetected, cannot redirect.
          </desc>

          <defs>
            <marker id={arrowId} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--brand-primary)" />
            </marker>
          </defs>

          {/* Flow edges, under the stages. */}
          <line x1={SENDER_X + STAGE_W} y1="64" x2={RELAY_X} y2="64" stroke="var(--brand-primary)" strokeWidth="2" markerEnd={`url(#${arrowId})`} />
          <line x1={RELAY_X + STAGE_W} y1="64" x2={RECEIVER_X} y2="64" stroke="var(--brand-primary)" strokeWidth="2" markerEnd={`url(#${arrowId})`} />

          {/* Sender */}
          <g transform={`translate(${SENDER_X}, 28)`}>
            <rect width={STAGE_W} height={STAGE_H} rx="6" fill="var(--surface-raised)" stroke="var(--border-strong)" strokeWidth="2" />
            <text x="14" y="26" fill="var(--brand-primary)" style={{ font: '800 13px var(--font-sans)', letterSpacing: '0.06em' }}>SENDER</text>
            <text x="14" y="48" fill="var(--text-primary)" style={{ font: '600 14px var(--font-sans)' }}>seals + signs</text>
          </g>

          {/* The envelope, riding the first edge. */}
          <g transform="translate(168, 36)">
            <rect width="48" height="36" rx="3" fill="var(--surface-base)" stroke="var(--brand-primary)" strokeWidth="2" />
            <path d="M 0 0 L 24 20 L 48 0" fill="none" stroke="var(--brand-primary)" strokeWidth="2" />
            {/* wax-seal dot */}
            <circle cx="24" cy="26" r="6" fill="var(--brand-accent)" stroke="var(--border-strong)" strokeWidth="1.5" />
            <text x="24" y="-6" textAnchor="middle" fill="var(--text-muted)" style={{ font: '700 14px var(--font-mono)' }}>sig</text>
          </g>

          {/* Relay */}
          <g transform={`translate(${RELAY_X}, 28)`}>
            <rect width={STAGE_W} height={STAGE_H} rx="6" fill="var(--surface-strong)" stroke="var(--border-strong)" strokeWidth="2" strokeDasharray="6 4" />
            <text x="14" y="26" fill="var(--text-muted)" style={{ font: '800 13px var(--font-sans)', letterSpacing: '0.06em' }}>RELAY</text>
            <text x="14" y="48" fill="var(--text-primary)" style={{ font: '600 14px var(--font-sans)' }}>routes only</text>
          </g>

          {/* Receiver */}
          <g transform={`translate(${RECEIVER_X}, 28)`}>
            <rect width={STAGE_W} height={STAGE_H} rx="6" fill="var(--brand-primary)" stroke="var(--border-strong)" strokeWidth="2" />
            <text x="14" y="26" fill="var(--brand-primary-foreground)" style={{ font: '800 13px var(--font-sans)', letterSpacing: '0.06em' }}>RECEIVER</text>
            <text x="14" y="48" fill="var(--brand-primary-foreground)" style={{ font: '600 14px var(--font-sans)' }}>verify, then act</text>
          </g>

          {/* The relay's three "cannot" guarantees, stacked beneath it. */}
          <g transform="translate(150, 140)">
            <rect width="300" height="128" rx="6" fill="var(--surface-base)" stroke="var(--brand-primary)" strokeWidth="2" strokeDasharray="6 4" />
            <text x="150" y="26" textAnchor="middle" fill="var(--brand-primary)" style={{ font: '800 13px var(--font-sans)', letterSpacing: '0.06em' }}>
              WHAT THE MIDDLE CANNOT DO
            </text>
            <text x="20" y="56" fill="var(--text-primary)" style={{ font: '600 14px var(--font-sans)' }}>✕  read the contents</text>
            <text x="20" y="82" fill="var(--text-primary)" style={{ font: '600 14px var(--font-sans)' }}>✕  alter it without detection</text>
            <text x="20" y="108" fill="var(--text-primary)" style={{ font: '600 14px var(--font-sans)' }}>✕  redirect it elsewhere</text>
          </g>
          {/* relay → guarantees tick */}
          <line x1="300" y1="100" x2="300" y2="140" stroke="var(--brand-primary)" strokeWidth="2" strokeDasharray="6 4" />
        </svg>
      </div>
      <figcaption className="border-t-2 border-[var(--border-strong)] p-[var(--space-4)] text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
        Loopback-only plaintext; everything that leaves the machine is{' '}
        <span className="font-black text-[var(--text-primary)]">signed and verified end to end</span>.
        The relay is a postal service, not a confidant — being &ldquo;in the
        middle&rdquo; buys an attacker nothing, because the middle was never
        trusted.
      </figcaption>
    </figure>
  )
}
