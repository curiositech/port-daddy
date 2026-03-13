import * as React from 'react'
import { motion, useScroll, useTransform, AnimatePresence } from 'framer-motion'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import * as Tabs from '@radix-ui/react-tabs'
import { useTheme } from '@/lib/theme'
import { Copy, Check, Terminal, Zap, Shield, History, Sparkles, ArrowRight, Play } from 'lucide-react'
import { MaritimeSignalRow } from '@/components/viz/MaritimeFlags'

const RAINBOW_SEGMENTS = [
  '#4285f4', '#34a853', '#fbbc04', '#fa7b17', '#ea4335', '#a142f4', '#24c1e0'
]

function CopyButton({ text, className = '' }: { text: string; className?: string }) {
  const [copied, setCopied] = React.useState(false)
  const handleCopy = () => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <motion.button
      onClick={handleCopy}
      className={`p-1.5 rounded-md transition-all hover:bg-[var(--interactive-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] ${className}`}
      whileHover={{ scale: 1.1 }}
      whileTap={{ scale: 0.9 }}
    >
      {copied ? <Check size={14} className="text-[var(--status-success)]" /> : <Copy size={14} />}
    </motion.button>
  )
}

const CHANGELOG_ITEMS = [
  { version: 'v3.7.0', label: 'Harbors', badge: 'new', text: 'Permission namespaces with HMAC-signed tokens.', color: 'var(--p-teal-400)', icon: Shield },
  { version: 'v3.7.0', label: 'pd spawn', badge: 'new', text: 'Launch AI agents with coordination auto-wired.', color: 'var(--p-amber-400)', icon: Zap },
  { version: 'v3.7.0', label: 'Timeline', badge: 'new', text: 'Unified Swarm Radio merging infra logs and agent notes.', color: 'var(--p-blue-400)', icon: History },
]

const fadeUp = {
  initial: { opacity: 0, y: 32 },
  animate: { opacity: 1, y: 0 },
}

export function Hero() {
  const [activeTab, setActiveTab] = React.useState('brew')
  const { theme } = useTheme()
  const { scrollY } = useScroll()
  
  const y1 = useTransform(scrollY, [0, 500], [0, 200])
  const opacity = useTransform(scrollY, [0, 300], [1, 0])

  return (
    <motion.section
      id="hero"
      className="relative min-h-screen flex flex-col justify-center overflow-hidden py-32 font-sans selection:bg-[var(--brand-primary)] selection:text-white"
    >
      {/* Ideogram Background Art */}
      <motion.div 
        style={{ y: y1, opacity }}
        className="absolute inset-0 z-0 pointer-events-none"
      >
        <motion.div className="absolute inset-0 bg-gradient-to-b from-transparent via-[var(--bg-base)] to-[var(--bg-base)] z-10" />
        <motion.img 
          src="/assets/port_daddy_cover_art.webp" 
          className="w-full h-full object-cover opacity-20 scale-110 blur-sm"
          initial={{ scale: 1.2, opacity: 0 }}
          animate={{ scale: 1, opacity: 0.2 }}
          transition={{ duration: 2, ease: "easeOut" }}
        />
      </motion.div>

      {/* Floating Blobs */}
      <motion.div 
        className="absolute top-[-10%] right-[-5%] w-[600px] h-[600px] rounded-full blur-[120px] pointer-events-none opacity-20 z-0"
        animate={{ scale: [1, 1.1, 1], rotate: [0, 45, 0] }}
        transition={{ duration: 15, repeat: Infinity, ease: 'easeInOut' }}
      >
        <motion.div className="w-full h-full" style={{ background: 'radial-gradient(circle, var(--p-teal-500) 0%, transparent 70%)' }} />
      </motion.div>

      <motion.div className="relative z-20 max-w-7xl mx-auto px-6 sm:px-8 lg:px-10 font-sans">
        <motion.div className="flex flex-col items-center text-center gap-12 mb-24 font-sans">

          <motion.div 
            initial="initial"
            animate="animate"
            variants={fadeUp}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            className="flex flex-col items-center gap-8 relative"
          >
             <motion.div className="absolute -top-16 left-1/2 -translate-x-1/2 flex gap-6 items-center">
                <MaritimeSignalRow size={40} />
             </motion.div>
            
            <motion.div className="relative group">
               <motion.div 
                 className="absolute inset-0 blur-3xl opacity-20 group-hover:opacity-40 transition-opacity"
                 style={{ background: 'var(--brand-primary)' }}
                 animate={{ scale: [1, 1.2, 1] }}
                 transition={{ duration: 4, repeat: Infinity }}
               />
               <motion.img
                src={theme === 'dark' ? '/pd_logo_darkmode.svg' : '/pd_logo.svg'}
                alt="Port Daddy"
                className="relative h-[280px] w-auto drop-shadow-2xl"
                animate={{ y: [0, -12, 0], rotate: [0, -2, 2, 0] }}
                transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
              />
            </motion.div>

            <motion.div className="flex flex-col items-center gap-6">
              <motion.div className="flex gap-0 h-1.5 w-[280px] rounded-full overflow-hidden shadow-xl">
                {RAINBOW_SEGMENTS.map((color, i) => (
                  <motion.div 
                    key={i} 
                    className="flex-1" 
                    style={{ background: color }}
                    animate={{ opacity: [0.6, 1, 0.6] }}
                    transition={{ duration: 2, delay: i * 0.1, repeat: Infinity }}
                  />
                ))}
              </motion.div>
              
              <motion.div className="flex flex-wrap justify-center gap-4 items-center">
                <Badge variant="teal" className="px-6 py-2 text-[10px] font-black uppercase tracking-[0.2em] font-sans shadow-xl">v3.7.0 · The Control Plane</Badge>
                <motion.div className="flex items-center gap-2.5 px-4 py-1.5 rounded-full bg-[rgba(58,173,173,0.1)] border border-[rgba(58,173,173,0.2)]">
                  <motion.div className="w-2.5 h-2.5 rounded-full bg-[var(--p-teal-400)] shadow-[0_0_12px_var(--p-teal-400)] pulse-active" />
                  <motion.span className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--p-teal-300)] font-sans">Harbors Active</motion.span>
                </motion.div>
              </motion.div>
            </motion.div>

            <motion.div className="space-y-6 max-w-4xl">
               <motion.h1 
                 className="text-7xl sm:text-9xl font-bold tracking-tight font-display leading-[0.9]"
                 style={{ color: 'var(--text-primary)' }}
               >
                 Port Authority for <motion.span className="text-[var(--brand-primary)]">AI Swarms.</motion.span>
               </motion.h1>
               <motion.p 
                 className="text-2xl sm:text-3xl font-medium leading-relaxed opacity-70 max-w-3xl mx-auto"
                 style={{ color: 'var(--text-secondary)' }}
               >
                 Atomic port assignment, semantic DNS, and cryptographic harbors for multi-agent coordination.
               </motion.p>
            </motion.div>

            <motion.div className="flex flex-wrap justify-center gap-6 mt-6">
               <Link to="/tutorials/getting-started" className="no-underline">
                 <motion.button 
                   className="px-12 py-6 rounded-full bg-[var(--brand-primary)] text-[var(--bg-base)] font-black text-xl shadow-[0_24px_48px_rgba(58,173,173,0.3)] flex items-center gap-3 transition-all"
                   whileHover={{ scale: 1.05, y: -4, boxShadow: '0 32px 64px rgba(58,173,173,0.4)' }}
                   whileTap={{ scale: 0.95 }}
                 >
                   LAUNCH YOUR SWARM
                   <ArrowRight size={24} />
                 </motion.button>
               </Link>
               <Link to="/docs" className="no-underline">
                 <motion.button 
                   className="px-12 py-6 rounded-full bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-strong)] font-black text-xl flex items-center gap-3 transition-all"
                   whileHover={{ scale: 1.05, y: -4, background: 'var(--interactive-hover)' }}
                   whileTap={{ scale: 0.95 }}
                 >
                   DOCUMENTATION
                 </motion.button>
               </Link>
            </motion.div>
          </motion.div>
        </motion.div>

        {/* Quick Changelog / Info Panel */}
        <motion.div 
          className="grid sm:grid-cols-3 gap-8 mt-12"
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, delay: 0.4 }}
        >
          {CHANGELOG_ITEMS.map((item, i) => (
            <motion.div 
              key={i}
              className="p-10 rounded-[40px] border transition-all duration-300 hover:border-[var(--brand-primary)] group"
              style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
              whileHover={{ y: -8 }}
            >
              <motion.div 
                className="w-12 h-12 rounded-2xl flex items-center justify-center mb-6 transition-colors"
                style={{ background: `${item.color}15` }}
              >
                <item.icon size={24} style={{ color: item.color }} />
              </motion.div>
              <motion.div className="flex items-center gap-3 mb-4">
                <Badge variant="teal" className="text-[8px] font-black uppercase tracking-widest">{item.badge}</Badge>
                <motion.span className="text-[10px] font-black uppercase tracking-widest opacity-40 group-hover:opacity-60 transition-opacity">{item.label}</motion.span>
              </motion.div>
              <motion.p className="text-lg font-medium leading-snug m-0 opacity-80 group-hover:opacity-100 transition-opacity">
                {item.text}
              </motion.p>
            </motion.div>
          ))}
        </motion.div>
      </motion.div>
    </motion.section>
  )
}
