import * as React from 'react'
import { motion, AnimatePresence } from 'framer-motion'

interface Demo {
  id: string
  gif: string
  title: string
  subtitle: string
  badge: string
  badgeColor: 'teal' | 'amber'
  description: string
  stats: Array<{ value: string; label: string }>
}

const DEMOS: Demo[] = [
  {
    id: 'agents',
    gif: '/demo-agents.gif',
    title: 'Multi-Agent Coordination',
    subtitle: 'Two Claude agents, zero collisions',
    badge: 'Sessions & Salvage',
    badgeColor: 'teal',
    description:
      'Watch two agents register, claim files, exchange notes, then one agent dies mid-task. Port Daddy preserves its work — the second agent salvages and continues exactly where it left off.',
    stats: [
      { value: '0ms', label: 'coordination overhead' },
      { value: '100%', label: 'work preserved on crash' },
      { value: '∞', label: 'agents supported' },
    ],
  },
  {
    id: 'fleet',
    gif: '/demo-fleet.gif',
    title: 'Fleet Management',
    subtitle: 'Spin up a full service mesh in seconds',
    badge: 'Port Assignment',
    badgeColor: 'amber',
    description:
      'Port Daddy scans a monorepo, detects 12 services, assigns ports atomically, and starts them all with a single command. No conflicts. No hardcoded ports. No race conditions.',
    stats: [
      { value: '60+', label: 'frameworks auto-detected' },
      { value: '< 50ms', label: 'port assignment latency' },
      { value: 'SQLite', label: 'backed, survives restarts' },
    ],
  },
]

const BADGE_STYLES = {
  teal: {
    background: 'var(--badge-teal-bg)',
    color: 'var(--badge-teal-text)',
    border: '1px solid var(--badge-teal-border)',
  },
  amber: {
    background: 'var(--badge-amber-bg)',
    color: 'var(--badge-amber-text)',
    border: '1px solid rgba(251, 191, 36, 0.25)',
  },
}

export function DemoGallery() {
  const [active, setActive] = React.useState(0)
  const demo = DEMOS[active]

  // Auto-cycle every 12s
  React.useEffect(() => {
    const t = setInterval(() => setActive(i => (i + 1) % DEMOS.length), 12000)
    return () => clearInterval(t)
  }, [])

  return (
    <section
      className="py-10 px-4 sm:px-6 lg:px-8 relative overflow-hidden"
      style={{
        background:
          'linear-gradient(180deg, var(--bg-base) 0%, var(--bg-surface) 50%, var(--bg-base) 100%)',
      }}
    >
      {/* Subtle glow behind the terminal */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse 60% 40% at 50% 50%, rgba(30,107,107,0.12) 0%, transparent 70%)',
        }}
      />

      <div className="relative max-w-7xl mx-auto">
        {/* Section header */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center mb-12"
        >
          <h2 className="text-3xl sm:text-4xl font-bold mb-4" style={{ color: 'var(--text-primary)' }}>
            See it in action
          </h2>
          <p className="text-lg max-w-xl mx-auto" style={{ color: 'var(--text-secondary)' }}>
            Real terminal recordings. No cuts, no staging.
          </p>
        </motion.div>

        {/* Tab selector */}
        <div className="flex justify-center gap-3 mb-8">
          {DEMOS.map((d, i) => (
            <button
              key={d.id}
              onClick={() => setActive(i)}
              className="px-4 py-2 rounded-full text-sm font-medium transition-all"
              style={{
                background: active === i ? 'var(--bg-overlay)' : 'transparent',
                color: active === i ? 'var(--text-primary)' : 'var(--text-muted)',
                border: '1px solid',
                borderColor: active === i ? 'var(--border-default)' : 'transparent',
              }}
            >
              {d.title}
            </button>
          ))}
        </div>

        {/* Main layout */}
        <div className="grid lg:grid-cols-5 gap-8 items-start">
          {/* GIF — takes 3 of 5 columns */}
          <div className="lg:col-span-3">
            <AnimatePresence mode="wait">
              <motion.div
                key={demo.id}
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.97 }}
                transition={{ duration: 0.3 }}
                className="rounded-xl overflow-hidden"
                style={{
                  border: '1px solid var(--border-default)',
                  boxShadow: '0 0 60px rgba(58, 173, 173, 0.12), var(--p-shadow-xl)',
                }}
              >
                {/* Terminal chrome */}
                <div
                  className="flex items-center gap-3 px-4 py-3"
                  style={{
                    background: 'var(--codeblock-header-bg)',
                    borderBottom: '1px solid var(--border-subtle)',
                  }}
                >
                  <div className="flex gap-1.5">
                    <span className="w-3 h-3 rounded-full" style={{ background: 'var(--p-red-500)', opacity: 0.7 }} />
                    <span className="w-3 h-3 rounded-full" style={{ background: 'var(--p-amber-500)', opacity: 0.7 }} />
                    <span className="w-3 h-3 rounded-full" style={{ background: 'var(--p-green-500)', opacity: 0.7 }} />
                  </div>
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {demo.subtitle}
                  </span>
                  {/* Progress bar */}
                  <div className="flex-1 ml-2">
                    <ProgressBar key={demo.id} duration={12000} />
                  </div>
                </div>

                {/* GIF */}
                <div style={{ background: 'var(--bg-base)' }}>
                  <img
                    src={demo.gif}
                    alt={demo.title}
                    className="w-full block"
                    style={{ maxHeight: '480px', objectFit: 'contain' }}
                  />
                </div>
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Copy — takes 2 of 5 columns */}
          <div className="lg:col-span-2 flex flex-col justify-center gap-6">
            <AnimatePresence mode="wait">
              <motion.div
                key={demo.id + '-copy'}
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12 }}
                transition={{ duration: 0.3 }}
                className="flex flex-col gap-5"
              >
                <span
                  className="text-xs font-semibold uppercase tracking-wider px-2.5 py-1 rounded-full w-fit"
                  style={BADGE_STYLES[demo.badgeColor]}
                >
                  {demo.badge}
                </span>

                <h3 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
                  {demo.title}
                </h3>

                <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                  {demo.description}
                </p>

                {/* Stats */}
                <div className="grid grid-cols-3 gap-3">
                  {demo.stats.map(s => (
                    <div
                      key={s.label}
                      className="rounded-lg p-3 text-center"
                      style={{ background: 'var(--bg-overlay)', border: '1px solid var(--border-subtle)' }}
                    >
                      <div
                        className="text-base font-bold font-mono"
                        style={{ color: 'var(--brand-primary)' }}
                      >
                        {s.value}
                      </div>
                      <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                        {s.label}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Dot nav */}
                <div className="flex gap-2">
                  {DEMOS.map((_, i) => (
                    <button
                      key={i}
                      onClick={() => setActive(i)}
                      className="rounded-full transition-all"
                      style={{
                        width: active === i ? '24px' : '8px',
                        height: '8px',
                        background: active === i ? 'var(--brand-primary)' : 'var(--border-default)',
                      }}
                      aria-label={`Demo ${i + 1}`}
                    />
                  ))}
                </div>
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </section>
  )
}

function ProgressBar({ duration }: { duration: number }) {
  return (
    <div className="h-0.5 rounded-full overflow-hidden" style={{ background: 'var(--border-subtle)' }}>
      <motion.div
        className="h-full rounded-full"
        style={{ background: 'var(--brand-primary)' }}
        initial={{ width: '0%' }}
        animate={{ width: '100%' }}
        transition={{ duration: duration / 1000, ease: 'linear' }}
      />
    </div>
  )
}
