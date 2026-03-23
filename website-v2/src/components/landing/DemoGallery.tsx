import * as React from 'react'
import { Badge } from '@/components/ui/Badge'
import { useTheme } from '@/lib/theme'
import { Play, ExternalLink, Activity } from 'lucide-react'

interface Demo {
  id: string
  gif: string | { light: string; dark: string }
  title: string
  subtitle: string
  badge: string
  badgeVariant: 'teal' | 'amber' | 'neutral'
  description: string
  stats: Array<{ value: string; label: string }>
}

const DEMOS: Demo[] = [
  {
<<<<<<< HEAD
    id: 'mayday',
    gif: '/gifs/mayday.gif',
    title: 'Mayday Rollback',
    subtitle: 'Automated error signaling & recovery',
    badge: 'Maritime Signals',
    badgeVariant: 'teal',
    description:
      'When an agent detects a critical failure, it broadcasts a MAYDAY signal. Port Daddy watchers catch the pheromone and trigger a safe rollback automatically.',
    stats: [
      { value: '< 10ms', label: 'signal time' },
      { value: '100%', label: 'recovery rate' },
      { value: 'Secure', label: 'channel' },
    ],
  },
  {
    id: 'salvage',
    gif: '/gifs/salvage.gif',
    title: 'Ghost Salvage',
    subtitle: 'Never lose a dead agent\'s context',
    badge: 'Zombie Protocol',
    badgeVariant: 'amber',
    description:
      'If an agent crashes, Port Daddy preserves its work context. A fresh agent can instantly salvage the session, inheriting all notes and file claims.',
    stats: [
      { value: '100%', label: 'persistence' },
      { value: 'Zero', label: 'data loss' },
      { value: 'ACID', label: 'backed' },
    ],
  },
  {
    id: 'auction',
    gif: { light: '/gifs/auction-light.gif', dark: '/gifs/auction-dark.gif' },
    title: 'Stigmergic Auction',
    subtitle: 'Competitive task allocation',
    badge: 'Pheromones',
    badgeVariant: 'neutral',
    description:
      'Agents bid on shared goals by spraying pheromones on the concept graph. The highest confidence scent wins the resource lock, enabling masterless coordination.',
    stats: [
      { value: 'Dynamic', label: 'decay' },
      { value: 'SOMA', label: 'inspired' },
      { value: 'Swarm', label: 'ready' },
=======
    id: 'salvage',
    gif: '/gifs/salvage.gif',
    title: 'Session Salvage',
    subtitle: 'Recover crashed agent context',
    badge: 'Crash Recovery',
    badgeColor: 'amber',
    description:
      'If an agent crashes, Port Daddy preserves its session notes and file claims in the salvage queue. A fresh agent can claim the dead agent\'s work and continue where it left off.',
    stats: [
      { value: 'SQLite', label: 'backed' },
      { value: 'Immutable', label: 'notes' },
      { value: 'Advisory', label: 'claims' },
>>>>>>> worktree-agent-ae9460d3
    ],
  },
]

export function DemoGallery() {
  const [activeId, setActiveTab] = React.useState(DEMOS[0].id)
  const { theme } = useTheme()
  const activeDemo = DEMOS.find((d) => d.id === activeId)!

  const getGifSrc = (demo: Demo) => {
    if (typeof demo.gif === 'string') return demo.gif
    return theme === 'dark' ? demo.gif.dark : demo.gif.light
  }

  return (
<<<<<<< HEAD
    <section id="demo" className="py-24 lg:py-32 bg-[var(--bg-base)]">
      <div className="max-w-[1200px] mx-auto px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-16">
          <Badge variant="teal" className="mb-4">Live Demos</Badge>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-semibold text-[var(--text-primary)] mb-4">
            Proof of <span className="text-[var(--brand-primary)]">Coordination</span>
          </h2>
          <p className="text-lg text-[var(--text-secondary)] max-w-2xl mx-auto">
            High-fidelity recordings of the Anchor Protocol managing live agent swarms.
          </p>
        </div>
=======
    <motion.section 
      id="demo" 
      className="py-24 px-6 sm:px-8 lg:px-10 font-sans relative overflow-hidden bg-bg-base"
      initial={{ opacity: 0 }}
      whileInView={{ opacity: 1 }}
      viewport={{ once: true }}
    >
      <motion.div className="max-w-7xl mx-auto font-sans flex flex-col items-center">
        <motion.div
          initial={{ opacity: 0, y: 32 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          className="text-center mb-16 flex flex-col items-center gap-12"
        >
          <Badge variant="teal" className="px-6 py-2 text-[10px] font-black uppercase tracking-[0.25em] shadow-xl bg-bg-overlay border border-brand-primary text-brand-primary">The Evidence</Badge>
          <motion.h2 className="text-6xl sm:text-9xl font-bold font-display tracking-tight leading-[0.9] m-0 text-text-primary">
            Proof of <br />
            <motion.span className="text-brand-primary">Coordination.</motion.span>
          </motion.h2>
          <motion.p className="text-2xl sm:text-3xl max-w-4xl mx-auto leading-relaxed font-sans text-text-secondary font-bold">
            These aren't mockups. These are <strong>high-fidelity recordings</strong> of Port Daddy managing live agent coordination.
          </motion.p>
        </motion.div>
>>>>>>> worktree-agent-ae9460d3

        <div className="grid lg:grid-cols-12 gap-8 items-start">
          {/* Demo Selector */}
          <div className="lg:col-span-4 space-y-3">
            {DEMOS.map((demo) => (
              <button
                key={demo.id}
                onClick={() => setActiveTab(demo.id)}
                className={`w-full text-left p-4 rounded-xl border transition-all ${
                  activeId === demo.id
                    ? 'bg-[var(--bg-surface)] border-[var(--brand-primary)] shadow-[var(--shadow-md)]'
                    : 'bg-transparent border-transparent hover:bg-[var(--bg-surface)] hover:border-[var(--border-subtle)]'
                }`}
              >
                <div className="flex items-start justify-between mb-2">
                  <Badge variant={demo.badgeVariant} size="sm">{demo.badge}</Badge>
                  {activeId === demo.id && (
                    <Play size={14} className="text-[var(--brand-primary)]" />
                  )}
                </div>
                <h3 className={`font-semibold mb-1 ${
                  activeId === demo.id ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'
                }`}>
                  {demo.title}
                </h3>
                <p className="text-sm text-[var(--text-tertiary)]">{demo.subtitle}</p>
              </button>
            ))}

            {/* Automation Note */}
            <div className="p-4 rounded-xl border border-dashed border-[var(--border-default)] bg-[var(--bg-overlay)]">
              <div className="flex items-center gap-2 text-[var(--brand-primary)] mb-2">
                <Activity size={16} />
                <span className="text-xs font-semibold uppercase tracking-wide">Automation Active</span>
              </div>
              <p className="text-sm text-[var(--text-tertiary)]">
                Screenshots verified on every commit using Playwright + VHS.
              </p>
            </div>
          </div>

          {/* Demo Display */}
          <div className="lg:col-span-8">
            <div className="space-y-6">
              {/* Main Demo Image */}
              <div className="relative rounded-2xl overflow-hidden border border-[var(--border-subtle)] bg-[var(--bg-code)] shadow-[var(--shadow-lg)]">
                <div className="aspect-video relative">
                  <img
                    src={getGifSrc(activeDemo)}
                    alt={activeDemo.title}
                    className="w-full h-full object-cover"
                  />
                  {/* Overlay */}
                  <div className="absolute inset-0 bg-gradient-to-t from-[var(--bg-base)]/60 via-transparent to-transparent" />
                  
                  {/* Live Indicator */}
                  <div className="absolute bottom-4 left-4 flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-[var(--success)] animate-pulse" />
                    <span className="text-xs font-medium text-white/90 uppercase tracking-wide">
                      Live Execution
                    </span>
                  </div>

                  <button className="absolute bottom-4 right-4 p-2 rounded-lg bg-white/10 backdrop-blur-sm text-white hover:bg-white/20 transition-all">
                    <ExternalLink size={16} />
                  </button>
                </div>
              </div>

              {/* Stats */}
              <div className="grid sm:grid-cols-3 gap-4">
                {activeDemo.stats.map((stat, i) => (
                  <div
                    key={i}
                    className="p-4 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-center"
                  >
                    <div className="text-2xl font-semibold text-[var(--brand-primary)] mb-1">
                      {stat.value}
                    </div>
                    <div className="text-xs font-medium text-[var(--text-tertiary)] uppercase tracking-wide">
                      {stat.label}
                    </div>
                  </div>
                ))}
              </div>

              {/* Description */}
              <div className="p-6 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
                <p className="text-[var(--text-secondary)] leading-relaxed">
                  {activeDemo.description}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
