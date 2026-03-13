import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/Badge'
import { useTheme } from '@/lib/theme'
import { Zap, Shield, History, ArrowRight } from 'lucide-react'
import { MaritimeSignalRow } from '@/components/viz/MaritimeFlags'

const CHANGELOG_ITEMS = [
  { version: 'v3.7.0', label: 'Harbors', badge: 'new', text: 'Permission namespaces with signed tokens.', color: 'var(--brand-primary)', icon: Shield },
  { version: 'v3.7.0', label: 'pd spawn', badge: 'new', text: 'Launch AI agents with auto-wiring.', color: 'var(--brand-secondary)', icon: Zap },
  { version: 'v3.7.0', label: 'Timeline', badge: 'new', text: 'Unified Radio merging infra and agent notes.', color: 'var(--brand-accent)', icon: History },
]

const fadeUp = {
  initial: { opacity: 0, y: 24 },
  animate: { opacity: 1, y: 0 },
}

export function Hero() {
  const { theme } = useTheme()

  return (
    <section
      id="hero"
      className="relative min-h-[85vh] flex flex-col items-center justify-center py-20 overflow-hidden"
    >
      {/* Background Decor */}
      <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
        <div 
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[1000px] h-[1000px] rounded-full blur-[160px] opacity-[0.05]"
          style={{ background: 'radial-gradient(circle, var(--brand-primary) 0%, transparent 70%)' }}
        />
      </div>

      <motion.div 
        className="relative z-10 w-full flex flex-col items-center gap-12"
        initial="initial"
        animate="animate"
        transition={{ staggerChildren: 0.1 }}
      >
        {/* Signal Row */}
        <motion.div variants={fadeUp} className="opacity-40">
          <MaritimeSignalRow size={24} />
        </motion.div>
        
        {/* Logo */}
        <motion.div variants={fadeUp} className="relative group">
           <div 
             className="absolute inset-0 blur-3xl opacity-20 group-hover:opacity-30 transition-opacity"
             style={{ background: 'var(--brand-primary)' }}
           />
           <img
            src={theme === 'dark' ? '/pd_logo_darkmode.svg' : '/pd_logo.svg'}
            alt="Port Daddy"
            className="relative h-[120px] sm:h-[160px] w-auto drop-shadow-2xl"
          />
        </motion.div>

        {/* Badge & Text */}
        <motion.div variants={fadeUp} className="flex flex-col items-center gap-8 text-center px-4">
          <div className="flex flex-wrap justify-center gap-3">
            <Badge variant="teal" className="px-4 py-1.5 text-[10px] font-black uppercase tracking-widest bg-[var(--bg-overlay)] border border-[var(--brand-primary)]">v3.7.0 STABLE</Badge>
            <div className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-[var(--bg-overlay)] border border-[var(--border-subtle)]">
              <div className="w-2 h-2 rounded-full bg-[var(--status-success)] pulse-active" />
              <span className="text-[10px] font-black uppercase tracking-widest opacity-60">Swarm Ready</span>
            </div>
          </div>

          <div className="space-y-6 max-w-4xl">
             <h1 className="text-6xl sm:text-8xl font-display font-black tracking-tight leading-[0.95] text-[var(--text-primary)]">
               Port Authority for <br />
               <span className="text-[var(--brand-primary)]">AI Swarms.</span>
             </h1>
             <p className="text-xl sm:text-2xl font-medium leading-relaxed text-[var(--text-secondary)] max-w-2xl mx-auto">
               Atomic port assignment, semantic DNS, and cryptographic harbors for multi-agent coordination.
             </p>
          </div>

          {/* CTAs */}
          <div className="flex flex-wrap justify-center gap-6 pt-4">
             <Link to="/tutorials/getting-started" className="no-underline">
               <button className="px-10 py-5 rounded-full bg-[var(--brand-primary)] text-white font-black text-lg shadow-xl hover:scale-105 transition-transform flex items-center gap-2">
                 LAUNCH SWARM
                 <ArrowRight size={20} />
               </button>
             </Link>
             <Link to="/docs" className="no-underline">
               <button className="px-10 py-5 rounded-full bg-[var(--bg-surface)] text-[var(--text-primary)] border-2 border-[var(--border-strong)] font-black text-lg hover:bg-[var(--interactive-hover)] transition-all">
                 SDK MANUAL
               </button>
             </Link>
          </div>
        </motion.div>

        {/* Feature Highlights */}
        <motion.div 
          variants={fadeUp}
          className="grid sm:grid-cols-3 gap-8 w-full max-w-5xl mt-12"
        >
          {CHANGELOG_ITEMS.map((item, i) => (
            <div 
              key={i}
              className="p-8 rounded-[40px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] flex flex-col items-center text-center group hover:border-[var(--brand-primary)] transition-all shadow-sm"
            >
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-6 bg-[var(--bg-overlay)] border border-[var(--border-subtle)] group-hover:scale-110 transition-transform">
                <item.icon size={24} style={{ color: item.color }} />
              </div>
              <h3 className="text-lg font-black uppercase tracking-widest mb-2 opacity-40">{item.label}</h3>
              <p className="text-base text-[var(--text-secondary)] leading-relaxed font-medium">
                {item.text}
              </p>
            </div>
          ))}
        </motion.div>
      </motion.div>
    </section>
  )
}
