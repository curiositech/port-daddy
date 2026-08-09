import { Link } from 'react-router-dom'
import { ArrowRight, GitCommit, Zap, Clock, Shield, RefreshCw, FileText } from 'lucide-react'
import { DocsCodeBlock } from '@/components/docs/DocsCodeBlock'

export default function AvatarsFeature() {
  return (
    <div className="space-y-10">
      {/* Header */}
      <div className="space-y-4">
        <p className="font-mono text-[length:var(--type-meta-size)] font-bold uppercase tracking-[var(--tracking-meta)] text-[var(--brand-primary)]">
          Feature · Avatars
        </p>
        <h1 className="text-4xl font-semibold text-[var(--text-primary)] tracking-tight">
          Always-On Fleet Agents
        </h1>
        <p className="text-lg text-[var(--text-secondary)] leading-relaxed max-w-3xl">
          Background AI agents that run while you sleep. Declare them in YAML, wire them to git commits or cron schedules, and let them do QA, docs, roadmap tracking, and creative ideation automatically.
        </p>
      </div>

      {/* Quick Start */}
      <div>
        <div className="lw-sect-head flex items-baseline gap-[var(--space-3)]">
          <span className="font-mono text-[length:var(--type-meta-size)] font-bold text-[var(--brand-primary)]">01</span>
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">Get Started in 30 Seconds</h2>
        </div>
        <DocsCodeBlock code={`cd ~/my-project
pd fleet init          # Creates pd-fleet.yml + git hook
pd fleet up            # Starts 5 agents
git commit -m "test"   # QA, docs, cartographer fire automatically`} />
        <p className="text-sm text-[var(--text-muted)] mt-2">
          Requires <code>ANTHROPIC_API_KEY</code> in <code>.env.local</code>.
        </p>
      </div>

      {/* How It Works */}
      <div className="space-y-4">
        <div className="lw-sect-head flex items-baseline gap-[var(--space-3)]">
          <span className="font-mono text-[length:var(--type-meta-size)] font-bold text-[var(--brand-primary)]">02</span>
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">How It Works</h2>
        </div>
        <div className="space-y-3">
          <div className="flex items-start gap-3 border-l-[length:var(--lw-stripe)] border-[var(--brand-primary)] pl-4">
            <FileText size={16} className="text-[var(--brand-primary)] mt-0.5 shrink-0" />
            <div>
              <h3 className="text-sm font-bold text-[var(--text-primary)] m-0">1. Declare</h3>
              <p className="text-[length:var(--type-panel-body-compact-size)] text-[var(--text-secondary)] m-0 leading-relaxed">
                Write a <code>pd-fleet.yml</code> at your project root. Each agent has a name, a trigger, a backend, and a prompt.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3 border-l-[length:var(--lw-stripe)] border-[var(--brand-secondary)] pl-4">
            <GitCommit size={16} className="text-[var(--brand-secondary)] mt-0.5 shrink-0" />
            <div>
              <h3 className="text-sm font-bold text-[var(--text-primary)] m-0">2. Wire</h3>
              <p className="text-[length:var(--type-panel-body-compact-size)] text-[var(--text-secondary)] m-0 leading-relaxed">
                A git post-commit hook publishes to the <code>git:committed</code> channel. Fleet agents trigger automatically on every commit.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3 border-l-[length:var(--lw-stripe)] border-[var(--brand-accent)] pl-4">
            <Zap size={16} className="text-[var(--brand-accent)] mt-0.5 shrink-0" />
            <div>
              <h3 className="text-sm font-bold text-[var(--text-primary)] m-0">3. Run</h3>
              <p className="text-[length:var(--type-panel-body-compact-size)] text-[var(--text-secondary)] m-0 leading-relaxed">
                <code>pd fleet up</code> starts everything. Agents spawn, do their work, publish results, and chain to downstream agents.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Activation Modes */}
      <div className="space-y-4">
        <div className="lw-sect-head flex items-baseline gap-[var(--space-3)]">
          <span className="font-mono text-[length:var(--type-meta-size)] font-bold text-[var(--brand-primary)]">03</span>
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">Two Activation Modes</h2>
        </div>
        <div className="space-y-3">
          <div className="border-l-[length:var(--lw-stripe)] border-[var(--brand-secondary)] pl-4">
            <div className="flex items-center gap-2">
              <Zap size={14} className="text-[var(--brand-secondary)]" />
              <h3 className="text-sm font-bold text-[var(--text-primary)] m-0">Triggered</h3>
            </div>
            <p className="text-[length:var(--type-panel-body-compact-size)] text-[var(--text-secondary)] m-0 mt-1">
              Fires when a message arrives on a pub/sub channel. Reactive, event-driven. Good for: code review, docs sync, roadmap updates.
            </p>
            <DocsCodeBlock code={`qa:\n  trigger: git:committed\n  backend: cloudflare\n  model: '@cf/qwen/qwen3-30b-a3b-fp8'`} />
          </div>
          <div className="border-l-[length:var(--lw-stripe)] border-[var(--brand-secondary)] pl-4">
            <div className="flex items-center gap-2">
              <Clock size={14} className="text-[var(--brand-secondary)]" />
              <h3 className="text-sm font-bold text-[var(--text-primary)] m-0">Scheduled</h3>
            </div>
            <p className="text-[length:var(--type-panel-body-compact-size)] text-[var(--text-secondary)] m-0 mt-1">
              Runs on a cron interval. Periodic, ambient. Good for: health checks, idea generation, cleanup, status reports.
            </p>
            <DocsCodeBlock code={`spark:\n  schedule: "*/30 * * * *"\n  backend: codex\n  model: gpt-5.4-mini`} />
          </div>
        </div>
        <p className="text-sm text-[var(--text-secondary)]">
          Agents can have both &mdash; Spider runs every 2 hours and also triggers on <code>spark:idea</code>.
        </p>
      </div>

      {/* Agent Chaining */}
      <div className="space-y-3">
        <div className="lw-sect-head flex items-baseline gap-[var(--space-3)]">
          <span className="font-mono text-[length:var(--type-meta-size)] font-bold text-[var(--brand-primary)]">04</span>
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">Agent Chaining</h2>
        </div>
        <p className="text-[var(--text-secondary)] leading-relaxed">
          One agent&apos;s output becomes another agent&apos;s trigger. <code>on_success: publish channel</code> pushes
          a message to a pub/sub channel. Any agent with <code>trigger: channel</code> fires automatically.
        </p>
        <DocsCodeBlock code={`# Spark publishes ideas → Spider reacts → finds connections
spark:
  on_success: publish spark:idea

spider:
  trigger: spark:idea
  on_success: publish spider:connections`} />
        <p className="text-sm text-[var(--text-muted)]">
          Port Daddy validates the trigger graph is a DAG (no cycles) before starting the fleet.
        </p>
      </div>

      {/* Safety */}
      <div className="space-y-3">
        <div className="lw-sect-head flex items-baseline gap-[var(--space-3)]">
          <span className="font-mono text-[length:var(--type-meta-size)] font-bold text-[var(--brand-primary)]">05</span>
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">Safety</h2>
        </div>
        <div className="space-y-2">
          {[
            { icon: <Shield size={14} />, title: 'Scoped tools', desc: 'Each agent declares exactly which tools it can use' },
            { icon: <RefreshCw size={14} />, title: 'Singleton mode', desc: 'Prevents duplicate instances from fast triggers' },
            { icon: <GitCommit size={14} />, title: 'DAG validation', desc: 'Cycle detection at config time, not runtime' },
            { icon: <FileText size={14} />, title: 'Immutable notes', desc: 'Session notes cannot be edited or deleted' },
          ].map(item => (
            <div key={item.title} className="flex items-start gap-3 border-l-[length:var(--lw-stripe)] border-[var(--border-subtle)] pl-4 py-1">
              <span className="text-[var(--brand-primary)] mt-0.5">{item.icon}</span>
              <div>
                <p className="text-[length:var(--type-meta-size)] font-bold text-[var(--text-primary)] m-0">{item.title}</p>
                <p className="text-[length:var(--type-panel-body-compact-size)] text-[var(--text-secondary)] m-0">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Templates */}
      <div className="space-y-3">
        <div className="lw-sect-head flex items-baseline gap-[var(--space-3)]">
          <span className="font-mono text-[length:var(--type-meta-size)] font-bold text-[var(--brand-primary)]">06</span>
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">Templates</h2>
        </div>
        <p className="text-[var(--text-secondary)] leading-relaxed">
          Two template packs ship with Port Daddy:
        </p>
        <div className="space-y-2">
          <div className="border-l-[length:var(--lw-stripe)] border-[var(--brand-primary)] pl-4 py-1">
            <p className="text-sm font-bold text-[var(--text-primary)] m-0">Starter Fleet</p>
            <p className="text-[length:var(--type-panel-body-compact-size)] text-[var(--text-secondary)] m-0 mt-1">QA, Documentarian, Cartographer, Spark, Spider. Commit-triggered.</p>
            <code className="text-[length:var(--type-meta-size)] text-[var(--brand-primary)] mt-1 block">pd fleet init</code>
          </div>
          <div className="border-l-[length:var(--lw-stripe)] border-[var(--brand-primary)] pl-4 py-1">
            <p className="text-sm font-bold text-[var(--text-primary)] m-0">Always-On Fleet</p>
            <p className="text-[length:var(--type-panel-body-compact-size)] text-[var(--text-secondary)] m-0 mt-1">Health monitor, lock janitor, session reaper, dep watcher, changelog writer.</p>
            <code className="text-[length:var(--type-meta-size)] text-[var(--brand-primary)] mt-1 block">templates/pd-fleet-always-on.yml</code>
          </div>
        </div>
      </div>

      {/* Next */}
      <div className="flex flex-wrap items-center justify-between gap-4 border border-[var(--border-subtle)] bg-[color-mix(in_oklab,var(--brand-primary)_10%,var(--surface-base))] p-5">
        <div>
          <div className="text-sm text-[var(--text-muted)] mb-1">Learn More</div>
          <div className="font-semibold text-[var(--text-primary)]">Fleet Tutorial</div>
          <div className="text-sm text-[var(--text-muted)]">Step-by-step guide to setting up your fleet</div>
        </div>
        <Link
          to="/tutorials/fleet"
          className="flex items-center gap-2 bg-[var(--brand-primary)] px-4 py-2 font-medium text-[var(--brand-primary-foreground)]"
        >
          Read Tutorial
          <ArrowRight size={16} />
        </Link>
      </div>
    </div>
  )
}
