import * as React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Badge } from '@/components/ui/Badge'
import { useTheme } from '@/lib/theme-context'
import { Play, ExternalLink, Activity, Share2 } from 'lucide-react'

interface Demo {
  id: string
  gif: string | { light: string; dark: string }
  title: string
  subtitle: string
  badge: string
  badgeVariant: 'teal' | 'gold' | 'default'
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
    badgeVariant: 'gold',
    description:
      'If an agent crashes, Port Daddy preserves its work context. A fresh agent can instantly salvage the session, inheriting all notes and file claims.',
    stats: [
      { value: '100%', label: 'persistence' },
      { value: 'Zero', label: 'data loss' },
      { value: 'ACID', label: 'backed' },
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
    <motion.section
      id="demo"
      className="py-16 lg:py-24 px-6 lg:px-8 font-sans relative overflow-hidden"
      style={{ background: 'var(--surface-base)' }}
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
          <Badge variant="teal" className="px-6 py-2 text-[12px] font-black uppercase tracking-[0.25em]">The Evidence</Badge>
          <motion.h2 className="text-4xl sm:text-6xl lg:text-9xl font-bold font-display tracking-tight leading-[0.9] m-0" style={{ color: 'var(--text-primary)' }}>
            Proof of <br />
            <motion.span style={{ color: 'var(--brand-primary)' }}>Coordination.</motion.span>
          </motion.h2>
          <motion.p className="text-2xl sm:text-3xl max-w-4xl mx-auto leading-relaxed font-sans font-bold" style={{ color: 'var(--text-secondary)' }}>
            Watch Port Daddy's core primitives do real coordination work, captured live.
          </motion.p>
        </motion.div>

        <div className="grid lg:grid-cols-12 gap-8 lg:gap-20 items-start w-full">
          {/* Tab Controls */}
          <div className="lg:col-span-4 space-y-8 flex flex-col items-center lg:items-stretch">
            {DEMOS.map((demo) => (
              <motion.button
                key={demo.id}
                onClick={() => setActiveTab(demo.id)}
                className="w-full max-w-md lg:max-w-none text-left p-6 lg:p-12 rounded-[var(--radius-4xl)] transition-all duration-300 relative group overflow-hidden"
                style={{
                  background: activeId === demo.id ? 'var(--surface-raised)' : 'var(--surface-base)',
                  boxShadow: activeId === demo.id ? 'var(--shadow-raised)' : 'var(--shadow-flat)',
                  border: 'none',
                  cursor: 'pointer',
                }}
                whileHover={{ scale: activeId === demo.id ? 1 : 1.02 }}
              >
                <div className="flex items-center justify-between mb-8">
                   <Badge variant={demo.badgeVariant === 'teal' ? 'teal' : demo.badgeVariant === 'gold' ? 'gold' : 'default'} className="text-[12px] font-black uppercase tracking-widest px-4 py-1.5">
                     {demo.badge}
                   </Badge>
                   <Play size={16} style={{ color: activeId === demo.id ? 'var(--brand-primary)' : 'var(--text-muted)', opacity: activeId === demo.id ? 1 : 0.4 }} className={activeId === demo.id ? 'animate-pulse' : ''} />
                </div>
                <h3 className="text-3xl font-display font-black mb-3" style={{ color: activeId === demo.id ? 'var(--text-primary)' : 'var(--text-secondary)' }}>{demo.title}</h3>
                <p className="text-base m-0 leading-relaxed font-bold" style={{ color: 'var(--text-muted)' }}>{demo.subtitle}</p>

                {activeId === demo.id && (
                  <motion.div
                    layoutId="active-pill"
                    className="absolute left-0 top-1/4 bottom-1/4 w-1.5 rounded-full"
                    style={{ background: 'var(--brand-primary)' }}
                  />
                )}
              </motion.button>
            ))}

            {/* Automation notice */}
            <motion.div
              className="w-full max-w-md lg:max-w-none p-6 lg:p-12 rounded-[var(--radius-4xl)] flex flex-col items-center text-center gap-6"
              style={{
                background: 'var(--surface-raised)',
                boxShadow: 'var(--shadow-raised)',
              }}
              whileHover={{ boxShadow: 'var(--shadow-sm)' }}
            >
               <div className="flex items-center gap-3" style={{ color: 'var(--brand-primary)' }}>
                  <Activity size={24} />
                  <span className="text-[12px] font-black uppercase tracking-[0.25em]">Automation Active</span>
               </div>
               <p className="text-base m-0 leading-relaxed font-sans font-bold" style={{ color: 'var(--text-secondary)' }}>Our automated screenshot service verifies these scenarios on every commit using Playwright + VHS.</p>
            </motion.div>
          </div>

          {/* Visual Display */}
          <div className="lg:col-span-8 flex flex-col items-center">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeId + theme}
                initial={{ opacity: 0, x: 32 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -32 }}
                transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                className="space-y-12 w-full flex flex-col items-center"
              >
                {/* Video display with flat frame */}
                <div
                  className="relative rounded-[var(--radius-4xl)] overflow-hidden group w-full aspect-video flex items-center justify-center"
                  style={{
                    background: 'var(--code-bg)',
                    boxShadow: 'var(--shadow-inset)',
                  }}
                >
                   <div className="absolute inset-0 bg-gradient-to-t from-media-scrim via-transparent to-transparent z-10" />
                   <motion.img
                     src={getGifSrc(activeDemo)}
                     alt={activeDemo.title}
                     className="w-full h-auto relative z-0 scale-100 group-hover:scale-[1.02] transition-transform duration-700"
                   />
                   <div className="absolute bottom-12 left-12 right-12 z-20 flex justify-between items-center">
                      <div className="flex items-center gap-5">
                         <div className="w-4 h-4 rounded-full border border-[var(--text-inverse)]" style={{ background: 'var(--brand-primary)' }} />
                         <span className="text-[12px] font-black uppercase tracking-[0.3em]" style={{ color: 'var(--text-inverse)' }}>Live Swarm Execution</span>
                      </div>
                      <ExternalLink size={20} style={{ color: 'var(--text-inverse)', opacity: 0.6 }} />
                   </div>
                </div>

                {/* Stat cards */}
                <div className="grid sm:grid-cols-3 gap-10 w-full">
                   {activeDemo.stats.map((stat, i) => (
                     <motion.div
                       key={i}
                       className="p-10 rounded-[var(--radius-4xl)] text-center flex flex-col items-center gap-2"
                       style={{
                         background: 'var(--surface-raised)',
                         boxShadow: 'var(--shadow-raised)',
                       }}
                       whileHover={{ y: -8, boxShadow: 'var(--shadow-sm)' }}
                     >
                        <div className="text-4xl font-display font-black leading-none" style={{ color: 'var(--brand-primary)' }}>{stat.value}</div>
                        <div className="text-[12px] font-black uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>{stat.label}</div>
                     </motion.div>
                   ))}
                </div>

                {/* Description panel */}
                <motion.div
                  className="p-6 sm:p-8 lg:p-12 rounded-[var(--radius-4xl)] w-full text-center relative overflow-hidden"
                  style={{
                    background: 'var(--surface-raised)',
                    boxShadow: 'var(--shadow-raised)',
                  }}
                >
                   <div className="absolute top-0 right-0 p-10 opacity-[0.03] pointer-events-none">
                      <Share2 size={300} style={{ color: 'var(--text-muted)' }} />
                   </div>
                   <p className="text-2xl leading-relaxed m-0 font-sans max-w-3xl mx-auto font-bold" style={{ color: 'var(--text-secondary)' }}>
                     {activeDemo.description}
                   </p>
                </motion.div>
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </motion.div>
    </motion.section>
  )
}
