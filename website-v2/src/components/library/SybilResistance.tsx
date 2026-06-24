/**
 * Sybil resistance (Cryptography). The cheapest attack on any open system is to
 * spin up a thousand fake identities and overwhelm it by sheer count. Port Daddy
 * defeats that without an account gate: identity is cheap to *create* but
 * worthless until it has earned a track record, and earning one costs real
 * collateral and real time.
 *
 *   1000 fresh spawns  →  each must post a bond to act, and starts at zero
 *                          reputation  →  influence comes from continuity, not
 *                          count: one agent with history outweighs a swarm of
 *                          newborns.
 *
 * Left: a crowd of identical newborn spawns (cheap, but weightless). Right: one
 * agent with a continuity history (a bond + a track record) that actually
 * carries weight. The scale between them tips to the right.
 *
 * Theme-aware via `var(--token)`; all `<text>` ≥14px except uppercase tracked
 * eyebrow labels (≥600 weight).
 */

import React from 'react'

export function SybilResistance() {
  const uid = React.useId()
  const titleId = `${uid}-sybil-title`
  const descId = `${uid}-sybil-desc`
  // A small grid of newborn-spawn dots on the left pan.
  const spawnDots = Array.from({ length: 24 }, (_, i) => ({
    cx: 70 + (i % 6) * 22,
    cy: 150 + Math.floor(i / 6) * 22,
  }))
  return (
    <figure className="grid gap-[var(--space-4)] border-2 border-[var(--border-strong)] bg-[var(--surface-base)] shadow-[var(--shadow-brutal)]">
      <div className="overflow-x-auto p-[var(--space-5)]">
        <svg
          viewBox="0 0 600 320"
          role="img"
          aria-labelledby={`${titleId} ${descId}`}
          className="mx-auto block min-w-[34rem] max-w-[46rem]"
        >
          <title id={titleId}>Why a thousand fake identities cannot overwhelm the system</title>
          <desc id={descId}>
            On the left, a crowd of identical newborn spawns — cheap to create but
            each weightless, starting at zero reputation and required to post a
            bond to act. On the right, a single agent with a continuity history: a
            posted bond and a track record. A balance scale tips toward the one
            agent with history, showing that influence comes from continuity, not
            from count.
          </desc>

          {/* Eyebrow labels for the two pans. */}
          <text x="150" y="34" textAnchor="middle" fill="var(--brand-accent)" style={{ font: '800 13px var(--font-sans)', letterSpacing: '0.06em' }}>
            THE ATTACK — 1000 FAKE SPAWNS
          </text>
          <text x="450" y="34" textAnchor="middle" fill="var(--brand-primary)" style={{ font: '800 13px var(--font-sans)', letterSpacing: '0.06em' }}>
            WHAT ACTUALLY CARRIES WEIGHT
          </text>

          {/* Left pan: crowd of identical newborn spawns. */}
          <g transform="translate(0, -16)">
            <rect x="44" y="132" width="160" height="120" rx="6" fill="var(--surface-raised)" stroke="var(--border-strong)" strokeWidth="2" strokeDasharray="6 4" />
            {spawnDots.map((d, i) => (
              <circle key={i} cx={d.cx} cy={d.cy} r="7" fill="var(--surface-strong)" stroke="var(--brand-accent)" strokeWidth="1.5" />
            ))}
          </g>
          <text x="124" y="262" textAnchor="middle" fill="var(--text-secondary)" style={{ font: '500 14px var(--font-sans)' }}>
            cheap to create · zero reputation
          </text>
          <text x="124" y="282" textAnchor="middle" fill="var(--text-secondary)" style={{ font: '500 14px var(--font-sans)' }}>
            each must post a bond to act
          </text>

          {/* Right pan: one weighty agent with history. */}
          <g transform="translate(384, 116)">
            <rect width="172" height="100" rx="6" fill="var(--brand-primary)" stroke="var(--border-strong)" strokeWidth="2" />
            <text x="16" y="30" fill="var(--brand-primary-foreground)" style={{ font: '900 16px var(--font-display)' }}>
              one agent
            </text>
            <text x="16" y="54" fill="var(--brand-primary-foreground)" style={{ font: '600 14px var(--font-sans)' }}>
              posted bond
            </text>
            <text x="16" y="76" fill="var(--brand-primary-foreground)" style={{ font: '600 14px var(--font-sans)' }}>
              + a track record
            </text>
          </g>
          <text x="470" y="262" textAnchor="middle" fill="var(--text-secondary)" style={{ font: '500 14px var(--font-sans)' }}>
            reputation earned over time
          </text>
          <text x="470" y="282" textAnchor="middle" fill="var(--text-secondary)" style={{ font: '500 14px var(--font-sans)' }}>
            continuity, not count
          </text>

          {/* The verdict in the middle: weight tips right. */}
          <g transform="translate(268, 150)">
            <text x="32" y="6" textAnchor="middle" fill="var(--text-muted)" style={{ font: '700 22px var(--font-sans)' }}>&gt;</text>
            <text x="32" y="34" textAnchor="middle" fill="var(--text-muted)" style={{ font: '600 14px var(--font-sans)' }}>outweighs</text>
          </g>
        </svg>
      </div>
      <figcaption className="border-t-2 border-[var(--border-strong)] p-[var(--space-4)] text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
        Making a new identity is cheap &mdash; on purpose. What is{' '}
        <span className="font-black text-[var(--text-primary)]">not</span> cheap is
        making one that anyone trusts: that takes a posted bond and a track record
        built over time. A thousand newborn spawns still add up to zero standing,
        so flooding the system with fakes accomplishes nothing.
      </figcaption>
    </figure>
  )
}
