import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/Badge'
import { Github, Terminal, Sparkles, Anchor } from 'lucide-react'

export function CTABanner() {
  return (
    <motion.section 
      className="py-20 px-6 sm:px-8 lg:px-10 relative overflow-hidden font-sans bg-[var(--bg-base)] flex flex-col items-center text-center"
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
        className="relative max-w-5xl mx-auto text-center flex flex-col items-center gap-8"
      >
        <motion.div className="flex flex-col items-center gap-6">
           <Badge variant="teal" className="px-8 py-3 text-[10px] font-black uppercase tracking-[0.25em] shadow-xl">The Departure</Badge>
           <motion.div 
             className="w-24 h-24 rounded-[40px] bg-[var(--interactive-active)] flex items-center justify-center border border-[var(--brand-primary)] shadow-[0_0_48px_rgba(58,173,173,0.3)]"
             animate={{ y: [0, -12, 0] }}
             transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
           >
              <Anchor className="text-[var(--brand-primary)]" size={48} />
           </motion.div>
        </motion.div>

        <motion.div className="space-y-6 flex flex-col items-center">
           <motion.h2 className="text-4xl sm:text-6xl font-display font-black tracking-tighter leading-[0.85] m-0" style={{ color: 'var(--text-primary)' }}>
             Your agents deserve a <br />
             <motion.span className="text-[var(--brand-primary)]">harbormaster.</motion.span>
           </motion.h2>

           <motion.p className="text-2xl sm:text-3xl max-w-3xl mx-auto leading-relaxed font-sans" style={{ color: 'var(--text-secondary)' }}>
             The era of wobbly scripts and port conflicts is over. Build swarms that are resilient, cryptographically secure, and always-on.
           </motion.p>
        </motion.div>

        <motion.div className="flex flex-wrap gap-6 justify-center items-center pt-4">
          <motion.button 
            className="px-16 py-8 rounded-full bg-[var(--brand-primary)] text-[var(--bg-base)] font-black text-2xl shadow-[0_32px_64px_rgba(58,173,173,0.3)] flex items-center gap-4 transition-all"
            whileHover={{ scale: 1.05, y: -6, boxShadow: '0 40px 80px rgba(58,173,173,0.4)' }}
            whileTap={{ scale: 0.95 }}
            onClick={() => window.open('https://github.com/curiositech/port-daddy', '_blank')}
          >
            <Github size={28} />
            STAR ON GITHUB
          </motion.button>
          
          <Link to="/tutorials/getting-started" className="no-underline">
            <motion.button 
              className="px-16 py-8 rounded-full bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-strong)] font-black text-2xl flex items-center gap-4 transition-all shadow-xl"
              whileHover={{ scale: 1.05, y: -6, background: 'var(--interactive-hover)' }}
              whileTap={{ scale: 0.95 }}
            >
              <Sparkles size={28} className="text-[var(--p-amber-400)]" />
              LEARN THE PROTOCOL
            </motion.button>
          </Link>
        </motion.div>

        <motion.div className="pt-16 flex flex-col items-center gap-6">
           <motion.div className="flex items-center gap-4 px-8 py-4 rounded-full bg-[var(--bg-overlay)] border border-[var(--border-subtle)] font-mono text-xs font-black uppercase tracking-widest shadow-lg" style={{ color: 'var(--text-muted)' }}>
              <Terminal size={18} className="text-[var(--brand-primary)]" />
              brew install erichowens/port-daddy
           </motion.div>
           <motion.p className="text-[10px] font-black uppercase tracking-[0.3em] m-0" style={{ color: 'var(--text-muted)', opacity: 0.5 }}>Free · Open Source · MIT License</motion.p>
        </motion.div>
      </motion.div>
    </motion.section>
  )
}
