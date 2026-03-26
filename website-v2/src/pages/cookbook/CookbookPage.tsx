import { motion } from 'framer-motion'
import { Badge } from '@/components/ui/Badge'
import { Link } from 'react-router-dom'
import { Book, Shield, Activity, Zap, MessageSquare, UserMinus, ChevronRight, Share2, Anchor, Cpu, Search, RefreshCw, Layers } from 'lucide-react'
import { COOKBOOK_RECIPES } from '@/data/cookbook'
import { Footer } from '@/components/layout/Footer'

const ICON_MAP: Record<string, any> = {
  Shield,
  Activity,
  Zap,
  MessageSquare,
  UserMinus,
  Share2,
  Anchor,
  Cpu,
  Search,
  RefreshCw,
  Layers
}

export function CookbookPage() {
  return (
    <motion.div
      className="min-h-screen font-sans flex flex-col selection:bg-[var(--brand-primary)] selection:text-white"
      style={{ background: 'var(--bg-base)', color: 'var(--text-primary)', paddingTop: 'var(--nav-height)' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      {/* Hero Section */}
      <motion.section
        className="py-12 sm:py-20 px-4 sm:px-6 lg:px-8 relative overflow-hidden"
        style={{ background: 'var(--surface-raised)', boxShadow: 'var(--shadow-raised)' }}
      >
        <motion.div
          className="absolute top-0 right-0 w-[600px] h-[600px] rounded-full blur-[140px] opacity-[0.1] pointer-events-none"
          style={{ background: 'radial-gradient(circle, var(--p-amber-500) 0%, transparent 70%)' }}
        />

        <motion.div className="max-w-7xl mx-auto text-center flex flex-col items-center gap-6 sm:gap-10 relative z-10">
          <Badge variant="gold" className="px-4 sm:px-6 py-2 text-[10px] font-black uppercase tracking-[0.25em]">Orchestration Patterns</Badge>
          <motion.h1
            className="text-3xl sm:text-6xl lg:text-8xl font-black tracking-tighter font-display leading-[0.9]"
            initial={{ opacity: 0, y: 32 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          >
            The <br />
            <motion.span className="text-[var(--p-amber-400)]">Cookbook.</motion.span>
          </motion.h1>
          <motion.p
            className="text-base sm:text-2xl lg:text-3xl max-w-3xl leading-relaxed text-[var(--text-secondary)] font-medium"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.1 }}
          >
            Don't build from scratch. Use these battle-tested recipes for coordinating autonomous agent swarms at scale.
          </motion.p>
        </motion.div>
      </motion.section>

      {/* Grid Section */}
      <motion.main id="main-content" className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-10 py-12 sm:py-20 font-sans">
        <motion.div className="grid sm:grid-cols-2 gap-6 sm:gap-8 lg:gap-12">
          {COOKBOOK_RECIPES.map((recipe, i) => {
            const Icon = ICON_MAP[recipe.icon] || Book
            return (
              <motion.div
                key={recipe.id}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: i * 0.05 }}
                className="group"
              >
                <Link to={`/cookbook/${recipe.id}`} className="no-underline block h-full">
                  <motion.div
                    className="h-full p-6 sm:p-8 lg:p-12 rounded-2xl sm:rounded-[40px] lg:rounded-[56px] transition-all duration-300 flex flex-col items-start gap-6 sm:gap-10"
                    style={{
                      background: 'var(--surface-raised)',
                      boxShadow: 'var(--shadow-raised)',
                    }}
                    whileHover={{ y: -8, boxShadow: 'var(--shadow-flat)' }}
                  >
                    <div className="w-full flex justify-between items-start">
                       <div
                         className="w-14 h-14 sm:w-20 sm:h-20 rounded-2xl sm:rounded-[32px] flex items-center justify-center group-hover:scale-110 transition-transform"
                         style={{ background: 'var(--surface-sunken)', boxShadow: 'var(--shadow-inset)' }}
                       >
                          <Icon size={28} className="text-[var(--p-amber-400)] sm:hidden" />
                          <Icon size={40} className="text-[var(--p-amber-400)] hidden sm:block" />
                       </div>
                       <Badge variant={recipe.difficulty === 'advanced' ? 'default' : 'teal'} className="text-[8px] font-black uppercase tracking-widest px-3 py-1">
                          {recipe.difficulty}
                       </Badge>
                    </div>

                    <div className="space-y-3 sm:space-y-4 flex-1">
                      <h3 className="m-0 text-xl sm:text-3xl lg:text-4xl font-display font-black leading-tight text-[var(--text-primary)] group-hover:text-[var(--p-amber-400)] transition-colors">
                        {recipe.title}
                      </h3>
                      <p className="m-0 text-sm sm:text-lg lg:text-xl leading-relaxed text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] transition-colors">
                        {recipe.description}
                      </p>
                    </div>

                    <div className="w-full flex items-center justify-between pt-4 sm:pt-8" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                       <div className="flex items-center gap-2 sm:gap-3">
                          <div className="w-2 h-2 rounded-full bg-[var(--status-success)] pulse-active" />
                          <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)] group-hover:text-[var(--text-secondary)]">Verified Recipe</span>
                       </div>
                       <div className="flex items-center gap-2 text-[9px] sm:text-[10px] font-black uppercase tracking-widest text-[var(--p-amber-400)] group-hover:gap-4 transition-all">
                          Read Pattern
                          <ChevronRight size={14} />
                       </div>
                    </div>
                  </motion.div>
                </Link>
              </motion.div>
            )
          })}
        </motion.div>

        {/* Vision Callout */}
        <motion.div
          className="mt-16 sm:mt-32 p-8 sm:p-14 lg:p-20 rounded-2xl sm:rounded-[48px] lg:rounded-[80px] flex flex-col items-center text-center gap-8 sm:gap-12 relative overflow-hidden"
          style={{
            background: 'var(--surface-raised)',
            boxShadow: 'var(--shadow-raised)',
          }}
          initial={{ opacity: 0, scale: 0.98 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
        >
           <div className="absolute top-0 right-0 p-10 opacity-[0.02] pointer-events-none">
              <RefreshCw size={600} />
           </div>

           <div className="space-y-4 sm:space-y-6 max-w-3xl relative z-10 flex flex-col items-center">
              <Badge variant="teal" className="px-4 sm:px-6 py-2 text-[10px] font-black uppercase tracking-widest">High-Fidelity Swarms</Badge>
              <h3 className="text-2xl sm:text-4xl lg:text-7xl font-display font-black tracking-tight leading-[0.95]" style={{ color: 'var(--text-primary)' }}>
                Soundness by <span className="text-[var(--p-teal-400)]">Pattern.</span>
              </h3>
              <p className="text-base sm:text-xl lg:text-2xl leading-relaxed text-[var(--text-secondary)]">
                The Cookbook isn't just a list of commands—it's a library of <strong>proven state machines</strong>. Every recipe is designed to converge your swarm on a result while maintaining the absolute integrity of your harbor.
              </p>
           </div>

           <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-8 w-full max-w-5xl">
              {[
                { label: 'Self-Healing', icon: RefreshCw },
                { label: 'Always-On', icon: Cpu },
                { label: 'Atomic Locks', icon: Anchor },
                { label: 'Secure Radio', icon: Zap }
              ].map((item, i) => (
                <div
                  key={i}
                  className="p-4 sm:p-8 rounded-2xl sm:rounded-[40px] flex flex-col items-center gap-3 sm:gap-4"
                  style={{ background: 'var(--surface-sunken)', boxShadow: 'var(--shadow-inset)' }}
                >
                   <item.icon size={20} className="text-[var(--p-amber-400)] sm:hidden" />
                   <item.icon size={24} className="text-[var(--p-amber-400)] hidden sm:block" />
                   <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)]">{item.label}</span>
                </div>
              ))}
           </div>
        </motion.div>
      </motion.main>

      <Footer />
    </motion.div>
  )
}
