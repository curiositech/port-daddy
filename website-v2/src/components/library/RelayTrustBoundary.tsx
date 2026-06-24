/**
 * The relay trust boundary (Cryptography). From ADR-0048: cryptography is never
 * needed locally — it is needed the instant another operator's fleet touches
 * your repo. This figure draws that line. Inside your machine, agents talk over
 * loopback in plaintext because the boundary of trust is the machine itself.
 * The moment a message crosses to another harbor you do not own, it is signed,
 * verified, and capability-scoped.
 *
 *   [ YOUR MACHINE ]            ║              [ ANOTHER HARBOR ]
 *   daemon ↔ agents            ║ trust         the relay carries signed,
 *   loopback, plaintext OK     ║ boundary      verified, scoped envelopes only
 *
 * Theme-aware via `var(--token)`; all `<text>` ≥14px except uppercase tracked
 * eyebrow labels (≥600 weight).
 */

import React from 'react'

export function RelayTrustBoundary() {
  const uid = React.useId()
  const titleId = `${uid}-rtb-title`
  const descId = `${uid}-rtb-desc`
  const arrowId = `${uid}-rtb-arrow`
  return (
    <figure className="grid gap-[var(--space-4)] border-2 border-[var(--border-strong)] bg-[var(--surface-base)] shadow-[var(--shadow-brutal)]">
      <div className="overflow-x-auto p-[var(--space-5)]">
        <svg
          viewBox="0 0 600 300"
          role="img"
          aria-labelledby={`${titleId} ${descId}`}
          className="mx-auto block min-w-[34rem] max-w-[46rem]"
        >
          <title id={titleId}>Where trust ends: inside your machine versus across the wire</title>
          <desc id={descId}>
            On the left, a trusted zone — your machine — where the daemon and its
            agents talk over loopback in plaintext. A vertical trust boundary
            separates it from the right, an untrusted zone holding another
            operator's harbor. Messages crossing the boundary are signed,
            verified, and capability-scoped.
          </desc>

          <defs>
            <marker id={arrowId} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--brand-primary)" />
            </marker>
          </defs>

          {/* Trusted zone — your machine. */}
          <rect x="20" y="40" width="248" height="220" rx="8" fill="var(--surface-raised)" stroke="var(--border-strong)" strokeWidth="2" />
          <text x="40" y="68" fill="var(--brand-primary)" style={{ font: '800 13px var(--font-sans)', letterSpacing: '0.06em' }}>
            YOUR MACHINE — TRUSTED
          </text>
          {/* daemon + agents inside */}
          <g transform="translate(60, 92)">
            <rect width="168" height="44" rx="6" fill="var(--brand-primary)" stroke="var(--border-strong)" strokeWidth="2" />
            <text x="84" y="28" textAnchor="middle" fill="var(--brand-primary-foreground)" style={{ font: '800 15px var(--font-sans)' }}>daemon</text>
          </g>
          <g transform="translate(60, 158)">
            <rect width="78" height="40" rx="6" fill="var(--surface-base)" stroke="var(--border-strong)" strokeWidth="2" />
            <text x="39" y="25" textAnchor="middle" fill="var(--text-primary)" style={{ font: '600 14px var(--font-sans)' }}>agent</text>
          </g>
          <g transform="translate(150, 158)">
            <rect width="78" height="40" rx="6" fill="var(--surface-base)" stroke="var(--border-strong)" strokeWidth="2" />
            <text x="39" y="25" textAnchor="middle" fill="var(--text-primary)" style={{ font: '600 14px var(--font-sans)' }}>agent</text>
          </g>
          <text x="144" y="240" textAnchor="middle" fill="var(--text-secondary)" style={{ font: '500 14px var(--font-sans)' }}>
            loopback · plaintext is fine here
          </text>

          {/* The trust boundary — a bold dashed vertical seam. */}
          <line x1="300" y1="32" x2="300" y2="268" stroke="var(--brand-accent)" strokeWidth="3" strokeDasharray="8 5" />
          <text x="300" y="22" textAnchor="middle" fill="var(--brand-accent)" style={{ font: '800 13px var(--font-sans)', letterSpacing: '0.06em' }}>
            TRUST BOUNDARY
          </text>

          {/* Crossing arrow, labelled with what travels across (label sits in
              the clear band below the boundary caption, above the arrow). */}
          <text x="300" y="190" textAnchor="middle" fill="var(--text-primary)" style={{ font: '700 14px var(--font-sans)' }}>
            signed
          </text>
          <text x="300" y="208" textAnchor="middle" fill="var(--text-primary)" style={{ font: '700 14px var(--font-sans)' }}>
            verified
          </text>
          <text x="300" y="226" textAnchor="middle" fill="var(--text-primary)" style={{ font: '700 14px var(--font-sans)' }}>
            scoped
          </text>
          <line x1="268" y1="138" x2="332" y2="138" stroke="var(--brand-primary)" strokeWidth="2" markerEnd={`url(#${arrowId})`} />

          {/* Untrusted zone — another harbor. */}
          <rect x="332" y="40" width="248" height="220" rx="8" fill="var(--surface-base)" stroke="var(--brand-accent)" strokeWidth="2" strokeDasharray="6 4" />
          <text x="352" y="68" fill="var(--brand-accent)" style={{ font: '800 13px var(--font-sans)', letterSpacing: '0.06em' }}>
            ANOTHER HARBOR — UNTRUSTED
          </text>
          <g transform="translate(372, 110)">
            <rect width="168" height="44" rx="6" fill="var(--surface-strong)" stroke="var(--border-strong)" strokeWidth="2" />
            <text x="84" y="28" textAnchor="middle" fill="var(--text-primary)" style={{ font: '700 15px var(--font-sans)' }}>someone else&rsquo;s fleet</text>
          </g>
          <text x="456" y="200" textAnchor="middle" fill="var(--text-secondary)" style={{ font: '500 14px var(--font-sans)' }}>
            you don&rsquo;t own it, so you
          </text>
          <text x="456" y="220" textAnchor="middle" fill="var(--text-secondary)" style={{ font: '500 14px var(--font-sans)' }}>
            never trust it by default
          </text>
        </svg>
      </div>
      <figcaption className="border-t-2 border-[var(--border-strong)] p-[var(--space-4)] text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
        Cryptography is never needed inside your own machine &mdash; the boundary
        of trust is the machine itself. It is needed{' '}
        <span className="font-black text-[var(--text-primary)]">the instant another operator&rsquo;s fleet touches your repo</span>.
        That is why local coordination stays fast and plaintext, while everything
        crossing the boundary is signed, verified, and capability-scoped.
      </figcaption>
    </figure>
  )
}
