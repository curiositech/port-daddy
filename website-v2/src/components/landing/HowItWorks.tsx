import { Badge } from '@/components/ui/Badge'
import { Anchor, Zap, RefreshCw, Cpu, Shield } from 'lucide-react'

interface Step {
  number: string
  title: string
  description: string
  code: string[]
  icon: typeof Anchor
}

const STEPS: Step[] = [
  {
    number: '01',
    title: 'Atomic Identity',
    description:
      'Summon a session. Port Daddy assigns a stable port and cryptographic identity, checking for orphaned work from previous swarms.',
    code: [
      '$ pd begin --identity swarm:analyst',
      '[pd] Handshake complete · agent-7f3a',
      '  Port 3102 assigned (deterministic)',
      '  Salvage: No dead agents detected',
    ],
    icon: Anchor,
  },
  {
    number: '02',
    title: 'Harbor Coordination',
    description:
      'Claim files, acquire locks, and broadcast events on Swarm Radio. All inter-agent signaling happens through the local daemon.',
    code: [
      '$ pd files claim src/models/*.py',
      '✓ Claimed · 0 conflicts',
      '',
      '$ pd pub swarm:events "model-ready"',
      '✓ Published to 12 subscribers',
    ],
    icon: Zap,
  },
  {
    number: '03',
    title: 'Self-Healing Done',
    description:
      'When a task finishes, pd done releases resources. If an agent crashes, work is escrowed for Always-On Avatars to salvage.',
    code: [
      '$ pd done --note "Training complete"',
      '✓ Resources released',
      '✓ Note pinned to harbor history',
    ],
    icon: RefreshCw,
  },
]

export function HowItWorks() {
  return (
    <section id="how-it-works" className="py-24 lg:py-32 bg-[var(--bg-surface)]">
      <div className="max-w-[1200px] mx-auto px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-16">
          <Badge variant="teal" className="mb-4">The Lifecycle</Badge>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-semibold text-[var(--text-primary)] mb-4">
            One daemon. <span className="text-[var(--brand-primary)]">Infinite Swarms.</span>
          </h2>
          <p className="text-lg text-[var(--text-secondary)] max-w-2xl mx-auto">
            Port Daddy manages the low-level coordination so your agents can focus on the logic.
          </p>
        </div>

        {/* Steps */}
        <div className="grid lg:grid-cols-3 gap-8 mb-16">
          {STEPS.map((step, i) => (
            <div key={step.number} className="relative">
              <div className="space-y-6">
                {/* Header */}
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-[var(--bg-overlay)] flex items-center justify-center">
                    <step.icon size={24} className="text-[var(--brand-primary)]" />
                  </div>
                  <div>
                    <span className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">
                      Step {step.number}
                    </span>
                    <h3 className="text-xl font-semibold text-[var(--text-primary)]">
                      {step.title}
                    </h3>
                  </div>
                </div>

                {/* Description */}
                <p className="text-[var(--text-secondary)] leading-relaxed">
                  {step.description}
                </p>

                {/* Code Block */}
                <div className="rounded-xl bg-[var(--bg-code)] border border-[var(--border-subtle)] p-4 font-mono text-sm overflow-x-auto">
                  {step.code.map((line, j) => (
                    <div
                      key={j}
                      className={`
                        ${line.startsWith('$') ? 'text-[var(--brand-primary)] font-semibold' : 'text-[var(--text-tertiary)]'}
                        ${line === '' ? 'h-4' : ''}
                      `}
                    >
                      {line}
                    </div>
                  ))}
                </div>
              </div>

              {/* Connector */}
              {i < STEPS.length - 1 && (
                <div className="hidden lg:block absolute top-6 -right-4 w-8 border-t-2 border-dashed border-[var(--border-subtle)]" />
              )}
            </div>
          ))}
        </div>

        {/* Self-Healing Feature */}
        <div className="rounded-2xl bg-[var(--bg-base)] border border-[var(--border-subtle)] p-8 lg:p-12">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div className="space-y-6">
              <Badge variant="teal">Autonomous Resilience</Badge>
              <h3 className="text-2xl lg:text-3xl font-semibold text-[var(--text-primary)]">
                The <span className="text-[var(--brand-primary)]">Self-Healing</span> Swarm
              </h3>
              <p className="text-[var(--text-secondary)] leading-relaxed">
                Port Daddy does not just manage ports—it manages <strong>resilience</strong>. If a critical 
                background agent dies, its state, file claims, and notes are held in escrow until a 
                replacement is spawned.
              </p>
              
              {/* Active Agents */}
              <div className="flex items-center gap-4 pt-2">
                <div className="flex -space-x-2">
                  {[1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className="w-10 h-10 rounded-full bg-[var(--brand-primary)]/10 border-2 border-[var(--bg-base)] flex items-center justify-center"
                    >
                      <Cpu size={16} className="text-[var(--brand-primary)]" />
                    </div>
                  ))}
                </div>
                <div>
                  <div className="text-sm font-medium text-[var(--text-primary)]">Active Swarm</div>
                  <div className="text-xs text-[var(--text-tertiary)]">3 Background Avatars</div>
                </div>
              </div>
            </div>

            {/* Resurrection Queue Card */}
            <div className="rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] p-6 shadow-[var(--shadow-md)]">
              <div className="flex items-center justify-between mb-6">
                <span className="text-xs font-semibold text-[var(--text-tertiary)] uppercase tracking-wide">
                  Resurrection Queue
                </span>
                <Badge variant="teal" size="sm">Escrow Active</Badge>
              </div>

              <div className="space-y-3">
                {/* Active Item */}
                <div className="flex items-center gap-4 p-4 rounded-lg bg-[var(--bg-overlay)] border border-[var(--brand-primary)]/20">
                  <RefreshCw size={20} className="text-[var(--brand-primary)]" />
                  <div className="flex-1">
                    <div className="text-sm font-medium text-[var(--text-primary)]">Refactor-Agent</div>
                    <div className="text-xs text-[var(--text-tertiary)]">State Preserved</div>
                  </div>
                  <span className="text-xs font-mono text-[var(--text-muted)]">2m ago</span>
                </div>

                {/* Locked Item */}
                <div className="flex items-center gap-4 p-4 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] opacity-60">
                  <Shield size={20} className="text-[var(--text-muted)]" />
                  <div className="flex-1">
                    <div className="text-sm font-medium text-[var(--text-secondary)]">Harbor Scopes</div>
                    <div className="text-xs text-[var(--text-tertiary)]">Tokens Locked</div>
                  </div>
                  <span className="text-xs font-mono text-[var(--text-muted)]">Active</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
