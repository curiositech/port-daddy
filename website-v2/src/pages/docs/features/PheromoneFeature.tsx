import { Link } from 'react-router-dom'
import { ArrowRight, AlertCircle } from 'lucide-react'
import { DocsCodeBlock } from '@/components/docs/DocsCodeBlock'
import { TerminalGif } from '@/components/site/TerminalGif'

export default function PheromoneFeature() {
  return (
    <div className="space-y-10">
      {/* Header */}
      <div className="space-y-4">
        <p className="font-mono text-[length:var(--type-meta-size)] font-bold uppercase tracking-[var(--tracking-meta)] text-[var(--brand-primary)]">
          Feature · Pheromone
        </p>
        <h1 className="text-4xl font-semibold text-[var(--text-primary)] tracking-tight">
          Pheromone Trails
        </h1>
        <p className="text-lg text-[var(--text-secondary)] leading-relaxed max-w-3xl">
          Agents leave numeric signals on services, sessions, and projects — the way ants leave
          a scent trail. Signals fade over time, so hot spots show where work is concentrated and
          cold spots show what has been left behind. This is called a pheromone trail.
        </p>
      </div>

      {/* The Problem */}
      <div>
        <div className="lw-sect-head flex items-baseline gap-[var(--space-3)]">
          <span className="font-mono text-[length:var(--type-meta-size)] font-bold text-[var(--brand-primary)]">01</span>
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">The Problem</h2>
        </div>
        <p className="text-[var(--text-secondary)] leading-relaxed mb-3">
          When many agents work in parallel on the same codebase, they need to know
          where other agents are focused — without explicit coordination messages.
          Traditional approaches have costs:
        </p>
        <ul className="space-y-2 text-[var(--text-secondary)]">
          <li className="flex items-start gap-2">
            <AlertCircle size={16} className="text-[var(--error)] mt-1 shrink-0" />
            <span>Centralized task assignment creates bottlenecks and a single point of failure</span>
          </li>
          <li className="flex items-start gap-2">
            <AlertCircle size={16} className="text-[var(--error)] mt-1 shrink-0" />
            <span>Pub/sub messaging requires explicit subscription and produces noise at scale</span>
          </li>
          <li className="flex items-start gap-2">
            <AlertCircle size={16} className="text-[var(--error)] mt-1 shrink-0" />
            <span>Lock-based approaches block rather than guide — agents can't see the lay of the land</span>
          </li>
        </ul>
      </div>

      {/* How It Works */}
      <div className="space-y-4">
        <div className="lw-sect-head flex items-baseline gap-[var(--space-3)]">
          <span className="font-mono text-[length:var(--type-meta-size)] font-bold text-[var(--brand-primary)]">02</span>
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">How It Works</h2>
        </div>
        <p className="text-[var(--text-secondary)] leading-relaxed">
          Pheromones are numeric values (0.0–1.0) stored in an entity's metadata under
          arbitrary keys. An agent <em>sprays</em> a pheromone to mark interest or activity.
          Every minute, the evaporator decays all pheromones by a configurable rate (default 5% loss
          per cycle). Agents <em>sniff</em> to read the current — already-decayed — values.
        </p>
        <p className="text-[var(--text-secondary)] leading-relaxed">
          Pheromones work across four entity types: <code className="text-[var(--brand-primary)] font-mono text-sm">services</code>,{' '}
          <code className="text-[var(--brand-primary)] font-mono text-sm">sessions</code>,{' '}
          <code className="text-[var(--brand-primary)] font-mono text-sm">projects</code>, and{' '}
          <code className="text-[var(--brand-primary)] font-mono text-sm">agents</code>.
          Sniffing applies additional time-based decay on read, so values are always current
          regardless of when the background tick last ran.
        </p>

        <DocsCodeBlock
          language="bash"
          code={`# Spray: mark this service as actively worked on
curl -X POST http://localhost:9876/pheromone/spray \\
  -H 'Content-Type: application/json' \\
  -d '{"table":"services","id":"myapp:api:main","key":"focus","strength":0.9}'

# Sniff: read pheromones on a service
curl http://localhost:9876/pheromone/services/myapp:api:main

# List: scan all non-zero pheromones across the system
curl http://localhost:9876/pheromone`}
          output={`# Spray response
{"success":true,"table":"services","id":"myapp:api:main","key":"focus","strength":0.9,"pheromones":{"focus":0.9}}

# Sniff response (10 minutes later — decayed)
{"success":true,"table":"services","id":"myapp:api:main","pheromones":{"focus":0.618}}

# List response
{"success":true,"count":2,"pheromones":[
  {"table":"services","id":"myapp:api:main","pheromones":{"focus":0.618}},
  {"table":"sessions","id":"sess_abc123","pheromones":{"review":0.41}}
]}`}
        />

        <TerminalGif
          src="/gifs/docs/pheromone.gif"
          title="Watch a signal decay and show up as file heat"
          caption="This clip shows the actual pheromone loop from the page: spray a signal, read it back, then inspect which files the fleet is treating as hot."
        />
      </div>

      {/* Decay Model */}
      <div className="space-y-3">
        <div className="lw-sect-head flex items-baseline gap-[var(--space-3)]">
          <span className="font-mono text-[length:var(--type-meta-size)] font-bold text-[var(--brand-primary)]">03</span>
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">Decay Model</h2>
        </div>
        <p className="text-[var(--text-secondary)] leading-relaxed">
          Decay is exponential. The default rate is <strong>0.95 per minute</strong> — a value
          sprayed at strength 1.0 drops below 0.5 in about 14 minutes and below 0.01
          (auto-pruned) in about 90 minutes. A fresh spray resets the clock.
        </p>

        <div className="grid sm:grid-cols-3 gap-4">
          <div className="lw-stripe-card p-3">
            <div className="text-lg font-mono font-semibold text-[var(--brand-primary)]">1.0</div>
            <div className="text-sm text-[var(--text-muted)] mt-1">Just sprayed — maximum signal</div>
          </div>
          <div className="lw-stripe-card p-3">
            <div className="text-lg font-mono font-semibold text-[var(--brand-primary)]">0.5</div>
            <div className="text-sm text-[var(--text-muted)] mt-1">~14 min ago — recent activity</div>
          </div>
          <div className="lw-stripe-card p-3">
            <div className="text-lg font-mono font-semibold text-[var(--text-muted)]">&lt;0.01</div>
            <div className="text-sm text-[var(--text-muted)] mt-1">~90 min ago — auto-pruned</div>
          </div>
        </div>
      </div>

      {/* File Heat Map */}
      <div className="space-y-3">
        <div className="lw-sect-head flex items-baseline gap-[var(--space-3)]">
          <span className="font-mono text-[length:var(--type-meta-size)] font-bold text-[var(--brand-primary)]">04</span>
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">File Heat Map</h2>
        </div>
        <p className="text-[var(--text-secondary)] leading-relaxed">
          The <code className="text-[var(--brand-primary)] font-mono text-sm">GET /pheromone/files</code> endpoint
          aggregates session file claims into a heat map. Files with active claims score high;
          recently-claimed but released files decay exponentially. The response shows files
          ranked by heat, directory rollups, and any conflicts (multiple agents on the same file).
        </p>

        <DocsCodeBlock
          language="bash"
          code={`# Full heat map
curl http://localhost:9876/pheromone/files

# Filter to a subtree
curl 'http://localhost:9876/pheromone/files?path=src/lib/&depth=3'`}
          output={`{
  "success": true,
  "files": [
    {"path":"src/lib/sessions.ts","heat":0.91,"activeClaims":2,"totalClaims":5,
     "agents":["agent-1","agent-2"],"conflict":true,"lastActivity":"2026-03-27T..."},
    {"path":"src/routes/agents.ts","heat":0.62,"activeClaims":1,"totalClaims":3,...}
  ],
  "directories": [
    {"path":"src/lib/","heat":0.91,"fileCount":12,"conflictCount":1}
  ],
  "summary": {
    "totalFiles":14,"activeConflicts":1,
    "hottestFile":"src/lib/sessions.ts","hottestDir":"src/lib/"
  }
}`}
        />
      </div>

      {/* Pheromone Keys */}
      <div className="space-y-3">
        <div className="lw-sect-head flex items-baseline gap-[var(--space-3)]">
          <span className="font-mono text-[length:var(--type-meta-size)] font-bold text-[var(--brand-primary)]">05</span>
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">Suggested Keys</h2>
        </div>
        <p className="text-[var(--text-secondary)] leading-relaxed">
          Keys are free-form strings. Use whatever names make sense for your workflow.
          These are conventions the Port Daddy fleet uses:
        </p>

        <div className="space-y-2">
          {[
            { key: 'focus', desc: 'Agent is actively working on this entity' },
            { key: 'review', desc: 'Agent is reviewing this entity' },
            { key: 'blocked', desc: 'Agent is blocked waiting on this entity' },
            { key: 'done', desc: 'Agent completed work here (fades quickly)' },
            { key: 'risky', desc: 'Agent flagged this as high-risk' },
            { key: 'stale', desc: 'Agent believes this needs attention' },
          ].map(({ key, desc }) => (
            <div key={key} className="flex items-start gap-3 border-l-[length:var(--lw-stripe)] border-[var(--border-subtle)] pl-4 py-1">
              <code className="text-[var(--brand-primary)] font-mono text-sm shrink-0 mt-0.5">{key}</code>
              <span className="text-sm text-[var(--text-secondary)]">{desc}</span>
            </div>
          ))}
        </div>
      </div>

      {/* API Reference */}
      <div className="space-y-3">
        <div className="lw-sect-head flex items-baseline gap-[var(--space-3)]">
          <span className="font-mono text-[length:var(--type-meta-size)] font-bold text-[var(--brand-primary)]">06</span>
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">API Endpoints</h2>
        </div>

        <div className="space-y-2">
          {[
            {
              method: 'POST',
              path: '/pheromone/spray',
              desc: 'Set a pheromone value on an entity. Body: { table, id, key, strength }',
            },
            {
              method: 'GET',
              path: '/pheromone/:table/:id',
              desc: 'Read all pheromone values for an entity. Applies time-based decay on read.',
            },
            {
              method: 'GET',
              path: '/pheromone',
              desc: 'List all non-zero pheromones across all tracked tables.',
            },
            {
              method: 'GET',
              path: '/pheromone/files',
              desc: 'File heat map from session file claims. Query: ?path= ?depth=',
            },
          ].map(({ method, path, desc }) => (
            <div key={path} className="flex items-start gap-3 border-l-[length:var(--lw-stripe)] border-[var(--border-subtle)] pl-4 py-1">
              <span className={`text-[length:var(--type-meta-size)] font-mono font-bold px-2 py-0.5 shrink-0 mt-0.5 ${
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
      </div>

      {/* Next */}
      <div className="flex flex-wrap items-center justify-between gap-4 border border-[var(--border-subtle)] bg-[color-mix(in_oklab,var(--brand-primary)_10%,var(--surface-base))] p-5">
        <div>
          <div className="text-sm text-[var(--text-muted)] mb-1">Next Feature</div>
          <div className="font-semibold text-[var(--text-primary)]">Fleet Agents</div>
          <div className="text-sm text-[var(--text-muted)]">Declarative background agent management from pd-fleet.yml</div>
        </div>
        <Link
          to="/docs/features/fleet"
          className="flex items-center gap-2 bg-[var(--brand-primary)] px-4 py-2 font-medium text-[var(--text-inverse)]"
        >
          Learn More
          <ArrowRight size={16} />
        </Link>
      </div>
    </div>
  )
}
