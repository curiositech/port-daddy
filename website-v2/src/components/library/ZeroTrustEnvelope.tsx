/**
 * The zero-trust message envelope (Cryptography §3), drawn so the *threat* is
 * visible. A sender seals and signs a message; on its way to the receiver it
 * passes through a middle nobody controls — drawn here as an attacker who has
 * fully captured the relay. The point of the figure is that capturing the
 * middle buys the attacker nothing: each of the three things they try (read,
 * alter, redirect) is defeated, with the reason shown.
 *
 *   SENDER  →  📨 sealed + signed  →  [ATTACKER owns the relay]  →  RECEIVER
 *                                      ✕ read   (it's sealed)
 *                                      ✕ alter  (signature breaks)
 *                                      ✕ reroute(address is signed in)
 *
 * Every color is a CSS custom property so the figure tracks the page theme via
 * the `[data-theme]` cascade with no JS. All `<text>` is ≥14px except the
 * uppercase tracked eyebrow labels (≥600 weight), matching the house style.
 */

import React from 'react'

const STAGE_W = 128
const STAGE_H = 76
const SENDER_X = 16
const ATTACKER_X = 236
const RECEIVER_X = 456

interface Attempt {
  label: string
  why: string
}

const ATTEMPTS: Attempt[] = [
  { label: 'read the contents', why: "it's sealed — only the receiver's key opens it" },
  { label: 'alter the message', why: 'any edit breaks the signature, so it gets rejected' },
  { label: 'reroute it elsewhere', why: 'the destination is signed in — a new address fails' },
]

export function ZeroTrustEnvelope() {
  const uid = React.useId()
  const titleId = `${uid}-zt-title`
  const descId = `${uid}-zt-desc`
  const arrowId = `${uid}-zt-arrow`
  return (
    <figure className="grid gap-[var(--space-4)] border-2 border-[var(--border-strong)] bg-[var(--surface-base)] shadow-[var(--shadow-brutal)]">
      <div className="overflow-x-auto p-[var(--space-5)]">
        <svg
          viewBox="0 0 600 340"
          role="img"
          aria-labelledby={`${titleId} ${descId}`}
          className="mx-auto block min-w-[34rem] max-w-[46rem]"
        >
          <title id={titleId}>A signed message defeating an attacker who controls the middle</title>
          <desc id={descId}>
            A sender on the left seals and signs a message. On its way to the
            receiver on the right it passes through an attacker who has taken over
            the relay in the middle. The attacker tries three things and fails at
            each: they cannot read the sealed contents, cannot alter the message
            without breaking its signature, and cannot reroute it because the
            destination is signed in. The receiver verifies the signature and
            address before acting.
          </desc>

          <defs>
            <marker id={arrowId} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--brand-primary)" />
            </marker>
          </defs>

          {/* Flow edges. */}
          <line x1={SENDER_X + STAGE_W} y1="60" x2={ATTACKER_X} y2="60" stroke="var(--brand-primary)" strokeWidth="2" markerEnd={`url(#${arrowId})`} />
          <line x1={ATTACKER_X + STAGE_W} y1="60" x2={RECEIVER_X} y2="60" stroke="var(--brand-primary)" strokeWidth="2" markerEnd={`url(#${arrowId})`} />

          {/* Sender */}
          <g transform={`translate(${SENDER_X}, 22)`}>
            <rect width={STAGE_W} height={STAGE_H} rx="6" fill="var(--surface-raised)" stroke="var(--border-strong)" strokeWidth="2" />
            <text x="14" y="26" fill="var(--brand-primary)" style={{ font: '800 13px var(--font-sans)', letterSpacing: '0.06em' }}>SENDER</text>
            <text x="14" y="48" fill="var(--text-primary)" style={{ font: '600 14px var(--font-sans)' }}>seals the</text>
            <text x="14" y="66" fill="var(--text-primary)" style={{ font: '600 14px var(--font-sans)' }}>message, signs it</text>
          </g>

          {/* The sealed envelope, riding the first edge. */}
          <g transform="translate(166, 34)">
            <rect width="44" height="34" rx="3" fill="var(--surface-base)" stroke="var(--brand-primary)" strokeWidth="2" />
            <path d="M 0 0 L 22 18 L 44 0" fill="none" stroke="var(--brand-primary)" strokeWidth="2" />
            <circle cx="22" cy="25" r="6" fill="var(--brand-accent)" stroke="var(--border-strong)" strokeWidth="1.5" />
            <text x="22" y="-8" textAnchor="middle" fill="var(--text-muted)" style={{ font: '700 14px var(--font-sans)' }}>sealed</text>
          </g>

          {/* Attacker who has captured the relay (the threat, made visible). */}
          <g transform={`translate(${ATTACKER_X}, 22)`}>
            <rect width={STAGE_W} height={STAGE_H} rx="6" fill="var(--surface-strong)" stroke="var(--brand-accent)" strokeWidth="2.5" strokeDasharray="7 4" />
            <text x="14" y="26" fill="var(--brand-accent)" style={{ font: '800 13px var(--font-sans)', letterSpacing: '0.06em' }}>ATTACKER</text>
            <text x="14" y="48" fill="var(--text-primary)" style={{ font: '600 14px var(--font-sans)' }}>owns the relay</text>
            <text x="14" y="66" fill="var(--text-muted)" style={{ font: '600 14px var(--font-sans)' }}>routes only</text>
          </g>

          {/* Receiver */}
          <g transform={`translate(${RECEIVER_X}, 22)`}>
            <rect width={STAGE_W} height={STAGE_H} rx="6" fill="var(--brand-primary)" stroke="var(--border-strong)" strokeWidth="2" />
            <text x="14" y="26" fill="var(--brand-primary-foreground)" style={{ font: '800 13px var(--font-sans)', letterSpacing: '0.06em' }}>RECEIVER</text>
            <text x="14" y="48" fill="var(--brand-primary-foreground)" style={{ font: '600 14px var(--font-sans)' }}>verifies sig</text>
            <text x="14" y="66" fill="var(--brand-primary-foreground)" style={{ font: '600 14px var(--font-sans)' }}>+ address, then acts</text>
          </g>

          {/* The three attacks, each defeated with the reason — the payoff. */}
          <g transform="translate(40, 132)">
            <rect width="520" height="184" rx="6" fill="var(--surface-base)" stroke="var(--brand-accent)" strokeWidth="2" strokeDasharray="6 4" />
            <text x="20" y="30" fill="var(--brand-accent)" style={{ font: '800 13px var(--font-sans)', letterSpacing: '0.06em' }}>
              WHAT THE ATTACKER TRIES — AND WHY IT FAILS
            </text>
            {ATTEMPTS.map((a, i) => (
              <g key={a.label} transform={`translate(20, ${58 + i * 42})`}>
                <text x="0" y="0" fill="var(--brand-accent)" style={{ font: '800 16px var(--font-sans)' }}>✕</text>
                <text x="24" y="0" fill="var(--text-primary)" style={{ font: '700 15px var(--font-sans)' }}>{a.label}</text>
                <text x="24" y="20" fill="var(--text-secondary)" style={{ font: '500 14px var(--font-sans)' }}>{a.why}</text>
              </g>
            ))}
          </g>
          {/* attacker → defeated-attempts tick */}
          <line x1={ATTACKER_X + STAGE_W / 2} y1="98" x2={ATTACKER_X + STAGE_W / 2} y2="132" stroke="var(--brand-accent)" strokeWidth="2" strokeDasharray="6 4" />
        </svg>
      </div>
      <figcaption className="border-t-2 border-[var(--border-strong)] p-[var(--space-4)] text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
        Even an attacker who completely owns the network in the middle gets{' '}
        <span className="font-black text-[var(--text-primary)]">nothing</span>: the
        message is sealed, signed, and addressed before it ever leaves the sender,
        so reading, altering, or rerouting it all fail. That is what &ldquo;zero
        trust&rdquo; means here — the middle was never trusted in the first place.
        (Plaintext exists only on the loopback interface; everything that leaves
        the machine is verified end to end.)
      </figcaption>
    </figure>
  )
}
