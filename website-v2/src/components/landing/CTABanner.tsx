import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/Badge'
import { Github, Terminal, Sparkles, Anchor } from 'lucide-react'

export function CTABanner() {
  return (
    <motion.section 
      className="py-32 px-4 sm:px-6 lg:px-8 relative overflow-hidden font-sans"
      initial={{ opacity: 0 }}
      whileInView={{ opacity: 1 }}
      viewport={{ once: true }}
    >
      {/* Background glow effects */}
      <motion.div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'radial-gradient(circle at 50% 50%, var(--brand-primary) 0%, transparent 70%)',
        }}
        animate={{ opacity: [0.05, 0.1, 0.05], scale: [1, 1.1, 1] }}
        transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
      />

      <motion.div
        initial={{ opacity: 0, y: 32 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        className="relative max-w-5xl mx-auto text-center flex flex-col items-center gap-12"
      >
        <motion.div className="flex flex-col items-center gap-6">
           <Badge variant="teal" className="px-6 py-2 text-[10px] font-black uppercase tracking-[0.25em] shadow-xl">The Departure</Badge>
           <motion.div 
             className="w-20 h-20 rounded-[32px] bg-[var(--interactive-active)] flex items-center justify-center border border-[var(--brand-primary)] shadow-[0_0_32px_rgba(58,173,173,0.3)]"
             animate={{ y: [0, -8, 0] }}
             transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
           >
              <Anchor className="text-[var(--brand-primary)]" size={40} />
           </motion.div>
        </motion.div>

        <motion.div className="space-y-6">
           <motion.h2 className="text-5xl sm:text-8xl font-display font-black tracking-tight leading-[0.9]" style={{ color: 'var(--text-primary)' }}>
             Your agents deserve a <br />
             <motion.span className="text-[var(--brand-primary)]">harbormaster.</motion.span>
           </motion.h2>

           <motion.p className="text-xl sm:text-2xl max-w-2xl mx-auto leading-relaxed opacity-70 font-sans">
             The era of wobbly scripts and port conflicts is over. Build swarms that are resilient, cryptographically secure, and always-on.
           </motion.p>
        </motion.div>

        <motion.div className="flex flex-wrap gap-6 justify-center items-center">
          <motion.button 
            className="px-12 py-6 rounded-full bg-[var(--brand-primary)] text-[var(--bg-base)] font-black text-xl shadow-[0_24px_48px_rgba(58,173,173,0.3)] flex items-center gap-3 transition-all"
            whileHover={{ scale: 1.05, y: -4, boxShadow: '0 32px 64px rgba(58,173,173,0.4)' }}
            whileTap={{ scale: 0.95 }}
            onClick={() => window.open('https://github.com/erichowens/port-daddy', '_blank')}
          >
            <Github size={24} />
            STAR ON GITHUB
          </motion.button>
          
          <Link to="/tutorials/getting-started" className="no-underline">
            <motion.button 
              className="px-12 py-6 rounded-full bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-strong)] font-black text-xl flex items-center gap-3 transition-all"
              whileHover={{ scale: 1.05, y: -4, background: 'var(--interactive-hover)' }}
              whileTap={{ scale: 0.95 }}
            >
              <Sparkles size={24} className="text-[var(--p-amber-400)]" />
              LEARN THE PROTOCOL
            </motion.button>
          </Link>
        </motion.div>

        <motion.div className="pt-12 flex flex-col items-center gap-4">
           <motion.div className="flex items-center gap-3 px-6 py-3 rounded-full bg-[var(--bg-overlay)] border border-[var(--border-subtle)] font-mono text-[10px] font-black uppercase tracking-widest opacity-60">
              <Terminal size={14} className="text-[var(--brand-primary)]" />
              brew install erichowens/port-daddy
           </motion.div>
           <motion.p className="text-[10px] font-black uppercase tracking-[0.2em] opacity-30 m-0">Free · Open Source · MIT License</motion.p>
        </motion.div>
      </motion.div>
    </motion.section>
  )
}
