import { Link } from 'react-router-dom'
import { ArrowRight, ShieldCheck } from 'lucide-react'
import { DocsCodeBlock } from '@/components/docs/DocsCodeBlock'

export default function RelayPkiFeature() {
  return (
    <div className="space-y-10">
      <div className="space-y-4">
        <p className="font-mono text-[length:var(--type-meta-size)] font-bold uppercase tracking-[var(--tracking-meta)] text-[var(--brand-primary)]">
          Feature · Relay PKI
        </p>
        <h1 className="text-4xl font-semibold tracking-tight text-[var(--text-primary)]">
          Relay PKI
        </h1>
        <p className="max-w-3xl text-lg leading-relaxed text-[var(--text-secondary)]">
          How Port Daddy decides which agents to trust when they connect through a relay. The
          managed setup uses OIDC sign-in first; ACME certificate proofs are a supported
          alternative; and a self-vouching trust network is allowed only for self-hosted,
          harbor-local deployments.
        </p>
      </div>

      <p className="border-l-[length:var(--lw-stripe)] border-[var(--brand-accent)] pl-4 leading-relaxed text-[var(--text-secondary)]">
        <strong className="text-[var(--text-primary)]">ADR-0025 is the authority.</strong>{' '}
        The relay routes ciphertext and identity metadata. It does not become the daemon transport credential, and v0
        does not accept self-attested fingerprints into a managed global registry.
      </p>

      <div className="space-y-4">
        <div className="lw-sect-head flex items-baseline gap-[var(--space-3)]">
          <span className="font-mono text-[length:var(--type-meta-size)] font-bold text-[var(--brand-primary)]">01</span>
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">Decision Shape</h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            ['OIDC', 'v0 primary for managed workload publishers and explicit daemon bootstrap.'],
            ['ACME', 'Reserved proof method for DNS/name control, bound to daemon Ed25519 fingerprints.'],
            ['WoT', 'Self-hosted and harbor-local only, requiring an admin allowlist or pairing receipt.'],
          ].map(([label, body]) => (
            <div key={label} className="lw-stripe-card p-4">
              <code className="font-mono text-[var(--brand-primary)]">{label}</code>
              <p className="mt-2 text-sm text-[var(--text-secondary)]">{body}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        <div className="lw-sect-head flex items-baseline gap-[var(--space-3)]">
          <span className="font-mono text-[length:var(--type-meta-size)] font-bold text-[var(--brand-primary)]">02</span>
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">Reproduce The Score</h2>
        </div>
        <DocsCodeBlock
          code={`printf '%s\\n' '{"kind":"request","version":"1","command":"pki.score","payload":{"options":["ACME","OIDC","WoT","Hybrid"]}}' \\
  | python3 skills/pd-relay-zero-trust/scripts/pki_decision.py \\
  | jq -r '.result.ranked[] | "\\(.option) \\(.score)"'`}
          output={`OIDC 153
Hybrid 153
WoT 141
ACME 137`}
        />
      </div>

      <div className="space-y-4">
        <div className="lw-sect-head flex items-baseline gap-[var(--space-3)]">
          <span className="font-mono text-[length:var(--type-meta-size)] font-bold text-[var(--brand-primary)]">03</span>
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">Security Commitments</h2>
        </div>
        <ul className="space-y-3 text-[var(--text-secondary)]">
          <li className="flex gap-2">
            <ShieldCheck size={16} className="mt-1 shrink-0 text-[var(--brand-primary)]" />
            <span>Fail closed on unknown issuers, wrong audience, expired claims, ambiguous namespace mapping, and missing repository owner.</span>
          </li>
          <li className="flex gap-2">
            <ShieldCheck size={16} className="mt-1 shrink-0 text-[var(--brand-primary)]" />
            <span>Persist proof metadata for issuer/JTI/time, ACME account and DNS identity, or WoT allowlist receipt.</span>
          </li>
          <li className="flex gap-2">
            <ShieldCheck size={16} className="mt-1 shrink-0 text-[var(--brand-primary)]" />
            <span>Keep payload secrecy orthogonal to PKI: relay traffic is TLS protected and payloads remain end-to-end encrypted.</span>
          </li>
        </ul>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 border border-[var(--border-subtle)] bg-[color-mix(in_oklab,var(--brand-primary)_10%,var(--surface-base))] p-5">
        <div>
          <div className="text-sm text-[var(--text-muted)]">Read next</div>
          <div className="font-semibold text-[var(--text-primary)]">PD Tube</div>
          <div className="text-sm text-[var(--text-muted)]">See the operator-visible coordination channel used by this PR.</div>
        </div>
        <Link
          to="/docs/cli/tube"
          className="flex items-center gap-2 bg-[var(--brand-primary)] px-4 py-2 font-medium text-[var(--text-inverse)]"
        >
          Open command
          <ArrowRight size={16} />
        </Link>
      </div>
    </div>
  )
}
