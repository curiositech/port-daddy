import { Link } from 'react-router-dom'
import { ArrowRight, AlertCircle } from 'lucide-react'
import { DocsCodeBlock } from '@/components/docs/DocsCodeBlock'
import { AgentAnatomy } from '@/components/agents/AgentAnatomy'

export default function FleetFeature() {
  return (
    <div className="space-y-10">
      {/* Header */}
      <div className="space-y-4">
        <h1 className="text-4xl font-semibold text-[var(--text-primary)] tracking-tight">
          Fleet Agents
        </h1>
        <p className="text-lg text-[var(--text-secondary)] leading-relaxed max-w-3xl">
          Declare your background agent workforce in a single YAML file. Port Daddy reads
          <code className="text-[var(--brand-primary)] font-mono text-sm mx-1">pd-fleet.yml</code>
          and manages scheduled agents, channel-triggered agents, and watchers —
          all with full Port Daddy coordination built in.
        </p>
      </div>

      {/* The Problem */}
      <div>
        <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-3">The Problem</h2>
        <p className="text-[var(--text-secondary)] leading-relaxed mb-3">
          Running background AI agents on a project requires wiring together scheduling,
          triggering, identity, coordination, and error recovery. Without a fleet layer:
        </p>
        <ul className="space-y-2 text-[var(--text-secondary)]">
          <li className="flex items-start gap-2">
            <AlertCircle size={16} className="text-[var(--error)] mt-1 shrink-0" />
            <span>Each agent is a bespoke shell script with no shared lifecycle management</span>
          </li>
          <li className="flex items-start gap-2">
            <AlertCircle size={16} className="text-[var(--error)] mt-1 shrink-0" />
            <span>Agents that die mid-task leave no trace and can't be salvaged</span>
          </li>
          <li className="flex items-start gap-2">
            <AlertCircle size={16} className="text-[var(--error)] mt-1 shrink-0" />
            <span>No way to see which agents are running, what they last did, or why they failed</span>
          </li>
        </ul>
      </div>

      {/* How It Works */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">How It Works</h2>
        <p className="text-[var(--text-secondary)] leading-relaxed">
          Fleet agents run in two modes. Both read the same
          <code className="text-[var(--brand-primary)] font-mono text-sm mx-1">pd-fleet.yml</code>
          and use the same YAML schema.
        </p>

        <div className="grid sm:grid-cols-2 gap-4">
          <div className="border border-[var(--border-subtle)] rounded-xl p-4 space-y-2">
            <div className="font-semibold text-[var(--text-primary)]">CLI Mode</div>
            <p className="text-sm text-[var(--text-secondary)]">
              Runs in your terminal. Stops when you close the terminal or press Ctrl+C.
              Good for development and one-off fleet runs.
            </p>
            <DocsCodeBlock
              language="bash"
              code={`pd fleet init    # First-time setup
pd fleet up      # Start (runs until Ctrl+C)
pd fleet status  # Inspect
pd fleet down    # Stop`}
            />
          </div>
          <div className="border border-[var(--border-subtle)] rounded-xl p-4 space-y-2">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-[var(--text-primary)]">Daemon Mode</span>
            </div>
            <p className="text-sm text-[var(--text-secondary)]">
              The Port Daddy daemon auto-discovers <code className="font-mono text-[length:var(--type-meta-size)] text-[var(--brand-primary)]">pd-fleet.yml</code> in
              all registered projects on boot. Fleets survive terminal close, system sleep,
              and restarts. Editing the config file triggers a hot-reload automatically.
            </p>
            <DocsCodeBlock
              language="bash"
              code={`# No command needed — daemon starts fleets on boot
PD_URL="\${PORT_DADDY_URL:-http://localhost:9876}"   # Use pd status if yours differs
curl "$PD_URL/fleet"          # Status
curl -XPOST "$PD_URL/fleet/reload"  # Reload configs
curl "$PD_URL/fleet/events"   # SSE stream`}
            />
          </div>
        </div>
      </div>

      {/* One real agent, labeled — the visual lead-in to the schema reference. */}
      <AgentAnatomy />

      {/* Fleet YAML */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">pd-fleet.yml Schema</h2>
        <p className="text-[var(--text-secondary)] leading-relaxed">
          The fleet file has three sections: <strong>agents</strong>, <strong>watchers</strong>,
          and <strong>channels</strong>. Template variables in curly braces are resolved at startup.
        </p>

        <DocsCodeBlock
          language="bash"
          code={`fleet:
  name: myapp-dev
  harbor: "{project}:fleet"      # All agents share this harbor namespace

  limits:
    max_concurrent_spawns: 2     # At most 2 agents running in parallel
    max_spawns_per_hour: 10      # Rate cap (Ostrom Principle 2)
    budget_usd_per_day: 5        # Daily LLM spend ceiling in USD

  agents:
    # Scheduled agent — runs every 10 minutes
    gardener:
      schedule: "*/10 * * * *"
      backend: custom
      prompt: "git status --porcelain"
      on_success: publish git:status
      identity: "{project}:fleet:gardener"

    # Triggered agent — runs whenever git:committed is published
    qa:
      trigger: git:committed
      backend: cloudflare
      model: '@cf/qwen/qwen3-30b-a3b-fp8'
      respawn: true              # Auto-restart on crash
      max_respawns: 3            # Circuit breaker — stop after 3 failures
      prompt: |
        Review the most recent commit for bugs.
        Write failing tests for any issues found.
      on_success: publish qa:clean
      on_failure: publish qa:findings
      identity: "{project}:fleet:qa"

    # Focused higher-signal code worker
    test-hunter:
      trigger: git:committed
      backend: cloudflare
      model: '@cf/qwen/qwen3-30b-a3b-fp8'
      singleton: true
      prompt: |
        Run tests, expand coverage around changed code, and report
        the highest-value failing reproduction first.
      identity: "{project}:fleet:test-hunter"

    # Singleton — only one instance allowed at a time
    spark:
      schedule: "*/30 * * * *"
      backend: cloudflare
      model: '@cf/moonshotai/kimi-k2.6'
      singleton: true
      prompt: |
        Read the roadmap and recent commits.
        Propose one achievable improvement.
        Save it to .spark/ideas/.
      on_success: publish spark:idea
      identity: "{project}:fleet:spark"

  watchers:
    # Watcher — runs a shell command on each channel message
    notify-findings:
      trigger: qa:findings
      exec: "pd note 'QA found issues — check qa:findings channel' --type warning"

  channels:
    git:committed:
      description: "Fired after a successful commit"
      consumers: [qa, test-hunter]
    qa:findings:
      description: "QA agent found bugs"
      consumers: [notify-findings]`}
        />
      </div>

      {/* Agent Types */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">Agent Types</h2>

        <div className="space-y-3">
          <div className="border-l-4 border-[var(--brand-primary)] pl-4">
            <div className="font-semibold text-[var(--text-primary)]">Scheduled agents</div>
            <p className="text-sm text-[var(--text-secondary)] mt-1">
              Run on a cron interval. Use simplified cron syntax:
              <code className="ml-2 text-[var(--brand-primary)] font-mono text-[length:var(--type-meta-size)]">*/10 * * * *</code>
            </p>
            <p className="text-[length:var(--type-meta-size)] text-[var(--text-muted)]">Minimum interval: 1 minute</p>
          </div>

          <div className="border-l-4 border-[var(--brand-primary)] pl-4">
            <div className="font-semibold text-[var(--text-primary)]">Triggered agents</div>
            <p className="text-sm text-[var(--text-secondary)] mt-1">
              Subscribe to a pub/sub channel and run each time a message arrives.
              Uses <code className="text-[var(--brand-primary)] font-mono text-[length:var(--type-meta-size)]">pd watch</code> internally.
            </p>
            <p className="text-[length:var(--type-meta-size)] text-[var(--text-muted)]">Message payload available as env var PD_MESSAGE</p>
          </div>

          <div className="border-l-4 border-[var(--brand-primary)] pl-4">
            <div className="font-semibold text-[var(--text-primary)]">Watchers</div>
            <p className="text-sm text-[var(--text-secondary)] mt-1">
              Like triggered agents but run a raw shell command instead of an AI backend.
              Good for notifications, git operations, or lightweight automation.
            </p>
            <p className="text-[length:var(--type-meta-size)] text-[var(--text-muted)]">exec runs in project directory</p>
          </div>

          <div className="border-l-4 border-[var(--brand-primary)] pl-4">
            <div className="font-semibold text-[var(--text-primary)]">Singletons</div>
            <p className="text-sm text-[var(--text-secondary)] mt-1">
              Add <code className="text-[var(--brand-primary)] font-mono text-[length:var(--type-meta-size)]">singleton: true</code> to prevent
              multiple concurrent runs of the same agent — useful for expensive agents
              that should not overlap.
            </p>
            <p className="text-[length:var(--type-meta-size)] text-[var(--text-muted)]">Skips if already running</p>
          </div>
        </div>
      </div>

      {/* Backends */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">Backends</h2>
        <p className="text-sm text-[var(--text-secondary)]">
          By default the fleet picks the cheapest backend it can find on your machine. If you
          already pay for Claude Max or ChatGPT Pro, the local CLI wins — marginal cost is $0
          per spawn. Cloudflare Workers AI and API-direct backends are the fallback rungs.{' '}
          <Link to="/cli-backend" className="text-[var(--brand-primary)] underline">See the CLI-backend pitch.</Link>
        </p>
        <div className="space-y-2">
          {[
            { name: 'claude-cli', desc: 'Runs the local Claude Code CLI directly under your Claude Max / Pro login. First-class default if the binary is on PATH — marginal cost is $0 because the seat is already paid for.' },
            { name: 'codex', desc: 'Runs OpenAI Codex through the local CLI under your ChatGPT Pro login. Default if the binary is on PATH and you have a Pro seat — marginal cost is $0, and the low/mid/high tier ladder works the same way.' },
            { name: 'cloudflare', desc: 'Runs Qwen3 30B (and others) on Cloudflare Workers AI. Cheap fallback when you don't have a subscription seat.' },
            { name: 'claude', desc: 'Runs Claude via the Anthropic SDK with ANTHROPIC_API_KEY. Use when you need a specific model the subscription does not expose, or per-call metered billing.' },
            { name: 'ollama', desc: 'Runs a local Ollama model via HTTP. Best for fully offline / private fleets when latency on subscription CLIs is unacceptable.' },
            { name: 'gemini', desc: 'Runs Gemini via the Google SDK. Needs GOOGLE_API_KEY.' },
            { name: 'aider', desc: 'Runs Aider as the execution backend. Useful when you want Aider to manage the model conversation and file edits.' },
            { name: 'custom', desc: 'Runs the prompt as a shell command. The prompt field is the command to execute.' },
          ].map(({ name, desc }) => (
            <div key={name} className="flex items-start gap-3 border-l-4 border-[var(--border-subtle)] pl-4 py-1">
              <code className="text-sm font-mono font-semibold text-[var(--brand-primary)] shrink-0 mt-0.5 w-24">{name}</code>
              <span className="text-sm text-[var(--text-secondary)]">{desc}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Template Variables */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">Template Variables</h2>
        <p className="text-[var(--text-secondary)] leading-relaxed">
          Use <code className="text-[var(--brand-primary)] font-mono text-sm">{'{variable}'}</code> anywhere in the YAML.
          Variables are resolved at fleet startup:
        </p>
        <div className="grid sm:grid-cols-2 gap-2">
          {[
            { v: '{project}', desc: 'Directory basename (e.g., myapp)' },
            { v: '{project_dir}', desc: 'Absolute path to the project root' },
            { v: '{branch}', desc: 'Current git branch (e.g., main)' },
            { v: '{sha}', desc: 'Short git commit SHA (e.g., a930413)' },
          ].map(({ v, desc }) => (
            <div key={v} className="flex items-center gap-3 border-l-4 border-[var(--border-subtle)] pl-4 py-1">
              <code className="text-sm font-mono text-[var(--brand-primary)] shrink-0">{v}</code>
              <span className="text-sm text-[var(--text-secondary)]">{desc}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Config file locations */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">Config File Locations</h2>
        <p className="text-[var(--text-secondary)] leading-relaxed">
          The fleet engine checks these paths in order, using the first one found:
        </p>
        <DocsCodeBlock
          code={`pd-fleet.yml          # project root (preferred)
pd-fleet.yaml         # project root (alt extension)
.portdaddy/fleet.yml  # hidden directory
.portdaddy/fleet.yaml # hidden directory`}
        />
      </div>

      {/* Next */}
      <div className="flex items-center justify-between p-5 rounded-xl bg-gradient-to-r from-[var(--brand-primary)]/5 to-transparent border border-[var(--brand-primary)]/20">
        <div>
          <div className="text-sm text-[var(--text-muted)] mb-1">CLI Reference</div>
          <div className="font-semibold text-[var(--text-primary)]">pd fleet</div>
          <div className="text-sm text-[var(--text-muted)]">Start, stop, and inspect your agent fleet</div>
        </div>
        <Link
          to="/docs/cli/fleet"
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--brand-primary)] text-[var(--text-inverse)] font-medium hover:opacity-90 transition-opacity"
        >
          CLI Reference
          <ArrowRight size={16} />
        </Link>
      </div>
    </div>
  )
}
