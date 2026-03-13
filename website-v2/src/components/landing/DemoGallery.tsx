import * as React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Badge } from '@/components/ui/Badge'
import { Play, ExternalLink, Activity } from 'lucide-react'

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
      { value: '0ms', label: 'overhead' },
      { value: '100%', label: 'persistence' },
      { value: '∞', label: 'scale' },
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
      { value: '60+', label: 'frameworks' },
      { value: '< 50ms', label: 'latency' },
      { value: 'SQLite', label: 'backed' },
    ],
  },
]

export function DemoGallery() {
  const [activeId, setActiveTab] = React.useState(DEMOS[0].id)
  const activeDemo = DEMOS.find((d) => d.id === activeId)!

  return (
    <motion.section 
      id="demo" 
      className="py-32 px-4 sm:px-6 lg:px-8 font-sans relative overflow-hidden"
      initial={{ opacity: 0 }}
      whileInView={{ opacity: 1 }}
      viewport={{ once: true }}
    >
      <motion.div className="max-w-7xl mx-auto font-sans">
        <motion.div
          initial={{ opacity: 0, y: 32 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          className="text-center mb-24"
        >
          <Badge variant="teal" className="mb-10 px-6 py-2 text-[10px] font-black uppercase tracking-[0.25em] shadow-xl">The Evidence</Badge>
          <motion.h2 className="text-5xl sm:text-8xl font-bold font-display tracking-tight leading-[0.95] mb-10" style={{ color: 'var(--text-primary)' }}>
            Proof of <motion.span className="text-[var(--brand-primary)]">Coordination.</motion.span>
          </motion.h2>
          <motion.p className="text-xl sm:text-2xl max-w-4xl mx-auto leading-relaxed opacity-70" style={{ color: 'var(--text-secondary)' }}>
            These aren't mockups. These are <strong>VHS recordings</strong> of the Port Daddy CLI managing live agent swarms.
          </motion.p>
        </motion.div>

        <motion.div className="grid lg:grid-cols-12 gap-12 items-start">
          {/* Controls */}
          <motion.div className="lg:col-span-4 space-y-6">
            {DEMOS.map((demo) => (
              <motion.button
                key={demo.id}
                onClick={() => setActiveTab(demo.id)}
                className="w-full text-left p-10 rounded-[40px] border transition-all duration-[var(--p-transition-spring)] relative group overflow-hidden"
                style={{ 
                  borderColor: activeId === demo.id ? 'var(--brand-primary)' : 'var(--border-subtle)',
                  background: activeId === demo.id ? 'var(--bg-surface)' : 'transparent',
                  boxShadow: activeId === demo.id ? '0 32px 64px -12px rgba(58,173,173,0.15)' : 'none'
                }}
                whileHover={{ scale: activeId === demo.id ? 1 : 1.02 }}
              >
                <motion.div className="flex items-center justify-between mb-6">
                   <Badge variant={demo.badgeColor === 'teal' ? 'teal' : 'amber'} className="text-[8px] font-black uppercase tracking-widest px-3 py-1">
                     {demo.badge}
                   </Badge>
                   <Play size={14} className={activeId === demo.id ? 'text-[var(--brand-primary)]' : 'opacity-20'} />
                </motion.div>
                <motion.h3 className="text-2xl font-display font-black mb-2" style={{ color: activeId === demo.id ? 'var(--text-primary)' : 'var(--text-secondary)' }}>{demo.title}</motion.h3>
                <motion.p className="text-sm opacity-60 m-0 leading-relaxed">{demo.subtitle}</motion.p>
                
                {activeId === demo.id && (
                  <motion.div 
                    layoutId="active-pill"
                    className="absolute left-0 top-1/4 bottom-1/4 w-1 bg-[var(--brand-primary)] rounded-full"
                  />
                )}
              </motion.button>
            ))}

            <motion.div className="p-10 rounded-[40px] border border-dashed border-[var(--border-subtle)] bg-[var(--bg-overlay)] opacity-60">
               <motion.div className="flex items-center gap-3 mb-4 text-[var(--brand-primary)]">
                  <Activity size={18} />
                  <motion.span className="text-[10px] font-black uppercase tracking-widest">Automation Active</motion.span>
               </motion.div>
               <motion.p className="text-sm m-0 leading-relaxed">Our automated screenshot service verifies these tutorials on every commit using Playwright + VHS.</motion.p>
            </motion.div>
          </motion.div>

          {/* Visual Display */}
          <motion.div className="lg:col-span-8">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeId}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                className="space-y-10"
              >
                <motion.div className="relative rounded-[60px] overflow-hidden border-4 border-[var(--border-strong)] shadow-2xl group">
                   <motion.div className="absolute inset-0 bg-gradient-to-t from-[var(--bg-base)] via-transparent to-transparent opacity-40 z-10" />
                   <img 
                     src={activeDemo.gif} 
                     alt={activeDemo.title}
                     className="w-full h-auto relative z-0 scale-100 group-hover:scale-[1.02] transition-transform duration-[2s]"
                   />
                   <motion.div className="absolute bottom-10 left-10 right-10 z-20 flex justify-between items-center">
                      <motion.div className="flex items-center gap-4">
                         <motion.div className="w-3 h-3 rounded-full bg-[var(--status-success)] pulse-active shadow-[0_0_12px_var(--status-success)]" />
                         <motion.span className="text-[10px] font-black uppercase tracking-[0.2em] text-white drop-shadow-md">Live CLI Recording</motion.span>
                      </motion.div>
                      <ExternalLink size={16} className="text-white opacity-40" />
                   </motion.div>
                </motion.div>

                <motion.div className="grid sm:grid-cols-3 gap-8">
                   {activeDemo.stats.map((stat, i) => (
                     <motion.div key={i} className="p-8 rounded-[32px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-center">
                        <motion.div className="text-3xl font-display font-black text-[var(--brand-primary)] mb-1">{stat.value}</motion.div>
                        <motion.div className="text-[10px] font-black uppercase tracking-widest opacity-40">{stat.label}</motion.div>
                     </motion.div>
                   ))}
                </motion.div>

                <motion.div className="p-10 rounded-[40px] bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
                   <motion.p className="text-xl leading-relaxed opacity-80 m-0">
                     {activeDemo.description}
                   </motion.p>
                </motion.div>
              </motion.div>
            </AnimatePresence>
          </motion.div>
        </motion.div>
      </motion.div>
    </motion.section>
  )
}
