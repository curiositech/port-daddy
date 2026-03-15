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
      className="relative min-h-[85vh] flex flex-col items-center justify-center py-24 overflow-hidden w-full bg-bg-base"
    >
      {/* Background Decor - Extremely subtle to not affect contrast */}
      <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
        <div 
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[1000px] h-[1000px] rounded-full blur-[160px] opacity-[0.03]"
          style={{ background: 'radial-gradient(circle, var(--brand-primary) 0%, transparent 70%)' }}
        />
      </div>

      <motion.div 
        className="relative z-10 w-full flex flex-col items-center text-center gap-12"
        initial="initial"
        animate="animate"
        transition={{ staggerChildren: 0.1 }}
      >
        {/* Signal Row */}
        <motion.div variants={fadeUp} className="opacity-60 flex justify-center w-full">
          <MaritimeSignalRow size={24} />
        </motion.div>
        
        {/* Logo */}
        <motion.div variants={fadeUp} className="relative group flex justify-center w-full">
           <div 
             className="absolute inset-0 blur-3xl opacity-10 group-hover:opacity-20 transition-opacity"
             style={{ background: 'var(--brand-primary)' }}
           />
           <img
            src={theme === 'dark' ? '/pd_logo_darkmode.svg' : '/pd_logo.svg'}
            alt="Port Daddy"
            className="relative h-[120px] sm:h-[160px] w-auto drop-shadow-2xl mx-auto"
          />
        </motion.div>

        {/* Badge & Text */}
        <motion.div variants={fadeUp} className="flex flex-col items-center gap-8 text-center px-4 w-full">
          <div className="flex flex-wrap justify-center gap-3">
            <Badge variant="teal" className="px-4 py-1.5 text-[10px] font-black uppercase tracking-widest bg-bg-overlay border border-brand-primary text-brand-primary">v3.7.0 STABLE</Badge>
            <div className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-bg-overlay border border-border-subtle">
              <div className="w-2 h-2 rounded-full bg-brand-primary pulse-active" />
              <span className="text-[10px] font-black uppercase tracking-widest text-text-secondary">Swarm Ready</span>
            </div>
          </div>

          <div className="space-y-6 max-w-4xl mx-auto">
             <h1 className="text-6xl sm:text-8xl font-display font-black tracking-tight leading-[0.95] text-text-primary">
               Port Authority for <br />
               <span className="text-brand-primary">AI Swarms.</span>
             </h1>
             <p className="text-xl sm:text-2xl font-bold leading-relaxed text-text-secondary max-w-2xl mx-auto">
               Atomic port assignment, semantic DNS, and cryptographic harbors for multi-agent coordination.
             </p>
          </div>

          {/* CTAs */}
          <div className="flex flex-wrap justify-center gap-6 pt-4 w-full">
             <Link to="/tutorials/getting-started" className="no-underline">
               <button className="px-10 py-5 rounded-full bg-brand-primary text-white font-black text-lg shadow-xl hover:scale-105 transition-transform flex items-center gap-2">
                 LAUNCH SWARM
                 <ArrowRight size={20} />
               </button>
             </Link>
             <Link to="/docs" className="no-underline">
               <button className="px-10 py-5 rounded-full bg-bg-surface text-text-primary border-2 border-border-strong font-black text-lg hover:bg-interactive-hover transition-all">
                 SDK MANUAL
               </button>
             </Link>
          </div>
        </motion.div>

        {/* Feature Highlights */}
        <motion.div 
          variants={fadeUp}
          className="grid sm:grid-cols-3 gap-8 w-full max-w-5xl mt-12 mx-auto"
        >
          {CHANGELOG_ITEMS.map((item, i) => (
            <div 
              key={i}
              className="p-8 rounded-[40px] bg-bg-surface border border-border-subtle flex flex-col items-center text-center group hover:border-brand-primary transition-all shadow-sm"
            >
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-6 bg-bg-overlay border border-border-subtle group-hover:scale-110 transition-transform mx-auto">
                <item.icon size={24} style={{ color: item.color }} />
              </div>
              <h3 className="text-lg font-black uppercase tracking-widest mb-2 text-text-muted">{item.label}</h3>
              <p className="text-base text-text-secondary leading-relaxed font-bold">
                {item.text}
              </p>
            </div>
          ))}
        </motion.div>
      </motion.div>
    </section>
  )
}
