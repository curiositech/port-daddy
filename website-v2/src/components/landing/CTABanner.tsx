import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Anchor, Github, Terminal, Sparkles } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Surface } from '@/components/ui/Surface'

export function CTABanner() {
  return (
    <motion.section
      className="py-16 lg:py-24 px-6 lg:px-8 relative overflow-hidden font-sans flex flex-col items-center text-center"
      style={{ background: 'var(--surface-base)' }}
      initial={{ opacity: 0 }}
      whileInView={{ opacity: 1 }}
      viewport={{ once: true }}
    >
      {/* Background glow effects */}
      <motion.div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'linear-gradient(180deg, var(--surface-base) 0%, var(--surface-overlay) 50%, var(--surface-base) 100%)',
        }}
      />

      <motion.div
        initial={{ opacity: 0, y: 32 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        className="relative max-w-5xl mx-auto text-center flex flex-col items-center gap-8"
      >
        <motion.div className="flex flex-col items-center gap-6">
           <Badge variant="teal" className="px-8 py-3 text-[11px] font-black uppercase tracking-[0.25em]">The Departure</Badge>
           {/* Anchor icon in inset circle */}
           <Surface depth="inset" radius="3xl" padding="none" className="w-24 h-24 flex items-center justify-center">
              <motion.div
                animate={{ y: [0, -12, 0] }}
                transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
              >
                <Anchor style={{ color: 'var(--brand-primary)' }} size={48} />
              </motion.div>
           </Surface>
        </motion.div>

        <motion.div className="space-y-6 flex flex-col items-center">
           <motion.h2 className="text-2xl sm:text-4xl lg:text-6xl font-display font-black tracking-tighter leading-[0.85] m-0" style={{ color: 'var(--text-primary)' }}>
             Your agents deserve a <br />
             <motion.span style={{ color: 'var(--brand-primary)' }}>harbormaster.</motion.span>
           </motion.h2>

        <p className="text-base sm:text-lg text-[var(--text-secondary)] max-w-xl mx-auto mb-6 sm:mb-10 px-4">
          Port Daddy is open-source and installs in seconds. Start building your autonomous organization today.
        </p>

        <motion.div className="flex flex-col sm:flex-row flex-wrap gap-4 sm:gap-6 justify-center items-center pt-4 w-full sm:w-auto">
          {/* Primary CTA */}
          <motion.button
            className="w-full sm:w-auto px-8 sm:px-16 py-4 sm:py-8 rounded-full font-black text-base sm:text-2xl flex items-center justify-center gap-3 sm:gap-4 transition-all"
            style={{
              background: 'var(--brand-primary)',
              color: 'var(--text-inverse)',
              boxShadow: 'var(--shadow-sm)',
              border: 'none',
              cursor: 'pointer',
            }}
            whileHover={{ scale: 1.05, y: -6, boxShadow: 'var(--shadow-raised)' }}
            whileTap={{ scale: 0.95, boxShadow: 'var(--shadow-pressed)' }}
            onClick={() => window.open('https://github.com/curiositech/port-daddy', '_blank')}
          >
            <Github size={22} />
            STAR ON GITHUB
          </motion.button>

          {/* Secondary CTA */}
          <Link to="/tutorials/getting-started" className="no-underline w-full sm:w-auto">
            <motion.button
              className="w-full sm:w-auto px-8 sm:px-16 py-4 sm:py-8 rounded-full font-black text-base sm:text-2xl flex items-center justify-center gap-3 sm:gap-4 transition-all"
              style={{
                background: 'var(--surface-raised)',
                color: 'var(--text-primary)',
                boxShadow: 'var(--shadow-sm)',
                border: 'none',
                cursor: 'pointer',
              }}
              whileHover={{ scale: 1.05, y: -6, boxShadow: 'var(--shadow-flat)' }}
              whileTap={{ scale: 0.95, boxShadow: 'var(--shadow-pressed)' }}
            >
              <Sparkles size={22} style={{ color: 'var(--brand-accent)' }} />
              LEARN THE PROTOCOL
            </motion.button>
          </Link>
        </motion.div>

        <motion.div className="pt-16 flex flex-col items-center gap-6">
           {/* Install command in inset terminal */}
           <motion.div
             className="flex items-center gap-3 sm:gap-4 px-4 sm:px-8 py-3 sm:py-4 rounded-full font-mono text-[11px] sm:text-xs font-black uppercase tracking-widest"
             style={{
               color: 'var(--text-muted)',
             }}
           >
              <Terminal size={18} style={{ color: 'var(--brand-primary)' }} />
              npm install -g port-daddy
           </motion.div>
           <motion.p className="text-[11px] font-black uppercase tracking-[0.3em] m-0" style={{ color: 'var(--text-muted)', opacity: 0.5 }}>Free · Open Source · MIT License</motion.p>
        </motion.div>
        </motion.div>
      </motion.div>
    </motion.section>
  )
}
