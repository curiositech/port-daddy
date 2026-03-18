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
