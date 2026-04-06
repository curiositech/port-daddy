import { Badge } from '@/components/ui/Badge'
import { Link } from 'react-router-dom'
import { ArrowRight, AlertCircle } from 'lucide-react'
import { DocsCodeBlock } from '@/components/docs/DocsCodeBlock'

export default function FleetFeature() {
  return (
    <div className="space-y-10">
      {/* Header */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Badge variant="teal">Feature</Badge>
          <Badge variant="default">New</Badge>
        </div>
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
              <Badge variant="teal">v3.8.2</Badge>
            </div>
            <p className="text-sm text-[var(--text-secondary)]">
              The Port Daddy daemon auto-discovers <code className="font-mono text-xs text-[var(--brand-primary)]">pd-fleet.yml</code> in
              all registered projects on boot. Fleets survive terminal close, system sleep,
              and restarts. Editing the config file triggers a hot-reload automatically.
            </p>
            <DocsCodeBlock
              language="bash"
              code={`# No command needed — daemon starts fleets on boot
curl localhost:9876/fleet          # Status
curl -XPOST localhost:9876/fleet/reload  # Reload configs
curl localhost:9876/fleet/events   # SSE stream`}
            />
          </div>
        </div>
      </div>

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
    max_spawns_per_hour: 20      # Rate cap (Ostrom Principle 2)
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
      backend: claude-cli
      allowed_tools: "Read,Grep,Glob,Bash(npm test*)"
      respawn: true              # Auto-restart on crash
      max_respawns: 3            # Circuit breaker — stop after 3 failures
      prompt: |
        Review the most recent commit for bugs.
        Write failing tests for any issues found.
      on_success: publish qa:clean
      on_failure: publish qa:findings
      identity: "{project}:fleet:qa"

    # Singleton — only one instance allowed at a time
    spark:
      schedule: "*/30 * * * *"
      backend: claude-cli
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
              <code className="ml-2 text-[var(--brand-primary)] font-mono text-xs">*/10 * * * *</code>
            </p>
            <p className="text-xs text-[var(--text-muted)]">Minimum interval: 1 minute</p>
          </div>

          <div className="border-l-4 border-[var(--brand-primary)] pl-4">
            <div className="font-semibold text-[var(--text-primary)]">Triggered agents</div>
            <p className="text-sm text-[var(--text-secondary)] mt-1">
              Subscribe to a pub/sub channel and run each time a message arrives.
              Uses <code className="text-[var(--brand-primary)] font-mono text-xs">pd watch</code> internally.
            </p>
            <p className="text-xs text-[var(--text-muted)]">Message payload available as env var PD_MESSAGE</p>
          </div>

          <div className="border-l-4 border-[var(--brand-primary)] pl-4">
            <div className="font-semibold text-[var(--text-primary)]">Watchers</div>
            <p className="text-sm text-[var(--text-secondary)] mt-1">
              Like triggered agents but run a raw shell command instead of an AI backend.
              Good for notifications, git operations, or lightweight automation.
            </p>
            <p className="text-xs text-[var(--text-muted)]">exec runs in project directory</p>
          </div>

          <div className="border-l-4 border-[var(--brand-primary)] pl-4">
            <div className="font-semibold text-[var(--text-primary)]">Singletons</div>
            <p className="text-sm text-[var(--text-secondary)] mt-1">
              Add <code className="text-[var(--brand-primary)] font-mono text-xs">singleton: true</code> to prevent
              multiple concurrent runs of the same agent — useful for expensive agents
              that should not overlap.
            </p>
            <p className="text-xs text-[var(--text-muted)]">Skips if already running</p>
          </div>
        </div>
      </div>

      {/* Backends */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">Backends</h2>
        <div className="space-y-2">
          {[
            { name: 'claude-cli', desc: 'Runs the Claude CLI directly. Uses your local auth context. Best for agents that need full Claude capabilities.' },
            { name: 'ollama', desc: 'Runs a local Ollama model via HTTP. Needs ollama running at localhost:11434.' },
            { name: 'claude', desc: 'Runs Claude via the Anthropic SDK. Needs ANTHROPIC_API_KEY.' },
            { name: 'gemini', desc: 'Runs Gemini via the Google SDK. Needs GOOGLE_API_KEY.' },
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
