import { Badge } from '@/components/ui/Badge'
import { Link } from 'react-router-dom'
import { ArrowRight, ShieldAlert, AlertTriangle, CheckCircle } from 'lucide-react'
import { DocsCodeBlock } from '@/components/docs/DocsCodeBlock'

export default function ArbiterFeature() {
  return (
    <div className="space-y-10">
      {/* Header */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Badge variant="teal">Feature</Badge>
          <Badge variant="default">Security</Badge>
        </div>
        <h1 className="text-4xl font-semibold text-[var(--text-primary)] tracking-tight">
          Arbiter
        </h1>
        <p className="text-lg text-[var(--text-secondary)] leading-relaxed max-w-3xl">
          Runtime invariant enforcement for agent swarms. The Arbiter subscribes to the
          activity log and checks every state transition against formally verified rules.
          Violations are recorded, broadcast via pub/sub, and — in strict mode — trigger
          automatic agent salvage.
        </p>
      </div>

      {/* How It Works */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">How It Works</h2>
        <p className="text-[var(--text-secondary)] leading-relaxed">
          The Arbiter starts with the daemon and subscribes to every activity log entry.
          On each entry it applies the relevant rule checks. Violations are stored in memory
          and logged to the activity system. In strict mode, critical violations trigger a
          man-overboard signal that queues the responsible agent for salvage.
        </p>

        <div className="space-y-3">
          <div className="flex items-start gap-3 border-l-4 border-[var(--brand-primary)] pl-4">
            <CheckCircle size={16} className="text-[var(--brand-primary)] mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-bold text-[var(--text-primary)] mb-0.5">LOG (always)</p>
              <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                Every violation is recorded with timestamp, rule name, severity, and agent ID.
                Available at <code className="text-[var(--brand-primary)] font-mono">/arbiter/violations</code>.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3 border-l-4 border-[var(--border-subtle)] pl-4">
            <AlertTriangle size={16} className="text-[var(--text-secondary)] mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-bold text-[var(--text-primary)] mb-0.5">ALERT (default)</p>
              <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                Violations are published to the{' '}
                <code className="text-[var(--brand-primary)] font-mono">security.violation</code>{' '}
                activity channel. Subscribers can react without blocking the offending agent.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3 border-l-4 border-[var(--border-subtle)] pl-4">
            <ShieldAlert size={16} className="text-[var(--text-secondary)] mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-bold text-[var(--text-primary)] mb-0.5">HALT (strictMode: true)</p>
              <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                Critical violations emit a{' '}
                <code className="text-[var(--brand-primary)] font-mono">system.man_overboard</code>{' '}
                activity entry, signalling the resurrection system to queue the agent for salvage.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* The Six Rules */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">The Six Rules</h2>
        <p className="text-[var(--text-secondary)] leading-relaxed">
          Rules map directly to the BondedCommons TLA+ specification. Each rule has a name,
          a trigger activity type, and a severity for violations.
        </p>

        <div className="space-y-2">
          {[
            {
              name: 'PID_SQUATTING',
              severity: 'critical',
              trigger: 'SERVICE_CLAIM',
              desc: 'An agent claims a service but its PID does not match the registered PID for that agent ID. Catches impersonation.',
            },
            {
              name: 'CAP_ESCALATION',
              severity: 'critical',
              trigger: 'LOCK_ACQUIRE',
              desc: 'An agent acquires a capability-scoped lock (e.g. db:write) without holding the required capability. Enforced via Rust FFI when available.',
            },
            {
              name: 'NOTE_MONOTONICITY',
              severity: 'critical',
              trigger: 'SESSION_NOTE',
              desc: 'Session note counts must never decrease. Enforces the immutability guarantee: notes are append-only and cannot be deleted via the API.',
            },
            {
              name: 'ESCROW_POSITIVE',
              severity: 'violation',
              trigger: 'SESSION_START',
              desc: "When Float Plans are active, every session must start with positive escrow. Currently checks for the field's presence; enforced when Float Plans ship.",
            },
            {
              name: 'LOCK_OWNER_VALID',
              severity: 'violation',
              trigger: 'LOCK_ACQUIRE',
              desc: 'Locks must be acquired by registered agents. An unregistered agent ID acquiring a lock is flagged as a coordination fault.',
            },
            {
              name: 'HEARTBEAT_FRESHNESS',
              severity: 'warning',
              trigger: 'AGENT_HEARTBEAT',
              desc: 'If a heartbeat arrives for an agent already flagged as stale, a warning is recorded — the early signal before an agent is declared dead.',
            },
          ].map(({ name, severity, trigger, desc }) => (
            <div key={name} className="border-l-4 border-[var(--border-subtle)] pl-4 py-2">
              <div className="flex items-center gap-2 mb-1">
                <code className="text-sm font-mono text-[var(--text-primary)] font-bold">{name}</code>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold uppercase ${
                  severity === 'critical'
                    ? 'bg-[var(--badge-teal-bg)] text-[var(--badge-teal-text)]'
                    : severity === 'violation'
                    ? 'bg-[var(--badge-amber-bg)] text-[var(--badge-amber-text)]'
                    : 'bg-[var(--badge-green-bg)] text-[var(--badge-green-text)]'
                }`}>
                  {severity}
                </span>
                <span className="text-xs text-[var(--text-muted)]">on {trigger}</span>
              </div>
              <p className="text-sm text-[var(--text-secondary)]">{desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* API Reference */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">API Endpoints</h2>

        <div className="space-y-2">
          {[
            {
              method: 'GET',
              path: '/arbiter/status',
              desc: 'Arbiter status: active, strictMode, enforcerLoaded, rulesCount, violationsCount, uptimeMs',
            },
            {
              method: 'GET',
              path: '/arbiter/violations',
              desc: 'List recorded violations. Query: ?limit=50&offset=0. Returns id, timestamp, rule, severity, details, agentId.',
            },
            {
              method: 'POST',
              path: '/arbiter/test-invariant/:name',
              desc: 'Inject a synthetic violation for testing. Valid names: PID_SQUATTING, CAP_ESCALATION, NOTE_MONOTONICITY, ESCROW_POSITIVE, LOCK_OWNER_VALID, HEARTBEAT_FRESHNESS',
            },
          ].map(({ method, path, desc }) => (
            <div key={path} className="flex items-start gap-3 border-l-4 border-[var(--border-subtle)] pl-4 py-1">
              <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded shrink-0 mt-0.5 ${
                method === 'POST'
                  ? 'bg-[var(--badge-teal-bg)] text-[var(--badge-teal-text)]'
                  : 'bg-[var(--badge-green-bg)] text-[var(--badge-green-text)]'
              }`}>
                {method}
              </span>
              <div>
                <code className="text-sm font-mono text-[var(--text-primary)]">{path}</code>
                <p className="text-sm text-[var(--text-secondary)] mt-1">{desc}</p>
              </div>
            </div>
          ))}
        </div>

        <DocsCodeBlock
          code={`# Check Arbiter status
curl http://localhost:9876/arbiter/status

# List recent violations
curl 'http://localhost:9876/arbiter/violations?limit=20'

# Inject a test violation
curl -X POST http://localhost:9876/arbiter/test-invariant/PID_SQUATTING`}
          output={`{
  "active": true,
  "strictMode": false,
  "enforcerLoaded": false,
  "rulesCount": 6,
  "rules": ["PID_SQUATTING","CAP_ESCALATION","NOTE_MONOTONICITY",
            "ESCROW_POSITIVE","LOCK_OWNER_VALID","HEARTBEAT_FRESHNESS"],
  "violationsCount": 0,
  "uptimeMs": 42391
}

{"success":true,"violations":[],"count":0,"total":0}

{"success":true,"violation":{"id":1,"rule":"PID_SQUATTING","severity":"critical",
  "details":"TEST: Simulated PID squatting detected","agentId":"test-agent"}}`}
        />
      </div>

      {/* Rust Enforcer */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">Rust Enforcer (Optional)</h2>
        <p className="text-[var(--text-secondary)] leading-relaxed">
          The <code className="text-[var(--brand-primary)] font-mono text-sm">CAP_ESCALATION</code> rule
          optionally uses a native Rust library (<code className="text-[var(--brand-primary)] font-mono text-sm">libharbor_card_rs</code>)
          for constant-time capability subset verification via FFI. When the compiled library is
          absent, capability escalation checking is skipped rather than failing. The{' '}
          <code className="text-[var(--brand-primary)] font-mono text-sm">enforcerLoaded</code>{' '}
          field in the status response tells you whether it is active.
        </p>
      </div>

      {/* Next */}
      <div className="flex items-center justify-between p-5 rounded-xl bg-gradient-to-r from-[var(--brand-primary)]/5 to-transparent border border-[var(--brand-primary)]/20">
        <div>
          <div className="text-sm text-[var(--text-muted)] mb-1">Related Feature</div>
          <div className="font-semibold text-[var(--text-primary)]">Harbors</div>
          <div className="text-sm text-[var(--text-muted)]">Capability scopes that the Arbiter enforces at the lock level</div>
        </div>
        <Link
          to="/docs/features/harbors"
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--brand-primary)] text-[var(--text-inverse)] font-medium hover:opacity-90 transition-opacity"
        >
          Learn More
          <ArrowRight size={16} />
        </Link>
      </div>
    </div>
  )
}
