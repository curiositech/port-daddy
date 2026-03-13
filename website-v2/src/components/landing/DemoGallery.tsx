import * as React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Badge } from '@/components/ui/Badge'
import { Play, ExternalLink, Activity, Sparkles, Anchor, Share2 } from 'lucide-react'

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
      className="py-48 px-6 sm:px-8 lg:px-10 font-sans relative overflow-hidden bg-[var(--bg-base)]"
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
          className="text-center mb-40 flex flex-col items-center gap-12"
        >
          <Badge variant="teal" className="px-6 py-2 text-[10px] font-black uppercase tracking-[0.25em] shadow-xl">The Evidence</Badge>
          <motion.h2 className="text-6xl sm:text-9xl font-bold font-display tracking-tight leading-[0.9] m-0" style={{ color: 'var(--text-primary)' }}>
            Proof of <br />
            <motion.span className="text-[var(--brand-primary)]">Coordination.</motion.span>
          </motion.h2>
          <motion.p className="text-2xl sm:text-3xl max-w-4xl mx-auto leading-relaxed font-sans opacity-70" style={{ color: 'var(--text-secondary)' }}>
            These aren't mockups. These are <strong>VHS recordings</strong> of the Port Daddy CLI managing live agent swarms.
          </motion.p>
        </motion.div>

        <div className="grid lg:grid-cols-12 gap-20 items-start w-full">
          {/* Controls */}
          <div className="lg:col-span-4 space-y-8 flex flex-col items-center lg:items-stretch">
            {DEMOS.map((demo) => (
              <motion.button
                key={demo.id}
                onClick={() => setActiveTab(demo.id)}
                className="w-full max-w-md lg:max-w-none text-left p-12 rounded-[56px] border transition-all duration-[var(--p-transition-spring)] relative group overflow-hidden"
                style={{ 
                  borderColor: activeId === demo.id ? 'var(--brand-primary)' : 'var(--border-subtle)',
                  background: activeId === demo.id ? 'var(--bg-surface)' : 'transparent',
                  boxShadow: activeId === demo.id ? '0 40px 80px -20px rgba(58,173,173,0.15)' : 'none'
                }}
                whileHover={{ scale: activeId === demo.id ? 1 : 1.02 }}
              >
                <div className="flex items-center justify-between mb-8">
                   <Badge variant={demo.badgeColor === 'teal' ? 'teal' : 'amber'} className="text-[8px] font-black uppercase tracking-widest px-4 py-1.5 shadow-md">
                     {demo.badge}
                   </Badge>
                   <Play size={16} className={activeId === demo.id ? 'text-[var(--brand-primary)] animate-pulse' : 'opacity-20'} />
                </div>
                <h3 className="text-3xl font-display font-black mb-3" style={{ color: activeId === demo.id ? 'var(--text-primary)' : 'var(--text-secondary)' }}>{demo.title}</h3>
                <p className="text-base opacity-60 m-0 leading-relaxed">{demo.subtitle}</p>
                
                {activeId === demo.id && (
                  <motion.div 
                    layoutId="active-pill"
                    className="absolute left-0 top-1/4 bottom-1/4 w-1.5 bg-[var(--brand-primary)] rounded-full"
                  />
                )}
              </motion.button>
            ))}

            <motion.div 
              className="w-full max-w-md lg:max-w-none p-12 rounded-[56px] border border-dashed border-[var(--border-subtle)] bg-[var(--bg-overlay)] opacity-60 flex flex-col items-center text-center gap-6"
              whileHover={{ opacity: 1, borderColor: 'var(--brand-primary)' }}
            >
               <div className="flex items-center gap-3 text-[var(--brand-primary)]">
                  <Activity size={24} />
                  <span className="text-[10px] font-black uppercase tracking-[0.25em]">Automation Active</span>
               </div>
               <p className="text-base m-0 leading-relaxed font-sans">Our automated screenshot service verifies these tutorials on every commit using Playwright + VHS.</p>
            </motion.div>
          </div>

          {/* Visual Display */}
          <div className="lg:col-span-8 flex flex-col items-center">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeId}
                initial={{ opacity: 0, x: 32 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -32 }}
                transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                className="space-y-12 w-full flex flex-col items-center"
              >
                <div className="relative rounded-[80px] overflow-hidden border-8 border-[var(--border-strong)] shadow-2xl group w-full aspect-video bg-black flex items-center justify-center">
                   <div className="absolute inset-0 bg-gradient-to-t from-[var(--bg-base)] via-transparent to-transparent opacity-40 z-10" />
                   <motion.img 
                     src={activeDemo.gif} 
                     alt={activeDemo.title}
                     className="w-full h-auto relative z-0 scale-100 group-hover:scale-[1.05] transition-transform duration-[3s]"
                   />
                   <div className="absolute bottom-12 left-12 right-12 z-20 flex justify-between items-center">
                      <div className="flex items-center gap-5">
                         <div className="w-4 h-4 rounded-full bg-[var(--status-success)] pulse-active shadow-[0_0_20px_var(--status-success)]" />
                         <span className="text-[10px] font-black uppercase tracking-[0.3em] text-white drop-shadow-lg">Live Swarm Execution</span>
                      </div>
                      <ExternalLink size={20} className="text-white opacity-40" />
                   </div>
                </div>

                <div className="grid sm:grid-cols-3 gap-10 w-full">
                   {activeDemo.stats.map((stat, i) => (
                     <motion.div 
                       key={i} 
                       className="p-10 rounded-[48px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-center flex flex-col items-center gap-2 shadow-lg"
                       whileHover={{ y: -8, borderColor: 'var(--brand-primary)' }}
                     >
                        <div className="text-4xl font-display font-black text-[var(--brand-primary)] leading-none">{stat.value}</div>
                        <div className="text-[10px] font-black uppercase tracking-widest opacity-40">{stat.label}</div>
                     </motion.div>
                   ))}
                </div>

                <motion.div 
                  className="p-12 rounded-[56px] bg-[var(--bg-overlay)] border border-[var(--border-subtle)] w-full text-center relative overflow-hidden"
                  whileHover={{ borderColor: 'var(--border-strong)' }}
                >
                   <div className="absolute top-0 right-0 p-10 opacity-[0.03] pointer-events-none">
                      <Share2 size={300} />
                   </div>
                   <p className="text-2xl leading-relaxed opacity-70 m-0 font-sans max-w-3xl mx-auto">
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
