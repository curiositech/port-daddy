import { motion } from 'framer-motion'
import { Badge } from '@/components/ui/Badge'
import { Card, CardContent } from '@/components/ui/Card'
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
        className="py-32 px-4 sm:px-6 lg:px-8 border-b relative overflow-hidden" 
        style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
      >
        <motion.div 
          className="absolute top-0 right-0 w-[600px] h-[600px] rounded-full blur-[140px] opacity-[0.1] pointer-events-none" 
          style={{ background: 'radial-gradient(circle, var(--p-amber-500) 0%, transparent 70%)' }} 
        />
        
        <motion.div className="max-w-7xl mx-auto text-center flex flex-col items-center gap-10 relative z-10">
          <Badge variant="amber" className="px-6 py-2 text-[10px] font-black uppercase tracking-[0.25em] shadow-xl">Orchestration Patterns</Badge>
          <motion.h1 
            className="text-6xl sm:text-9xl font-black tracking-tighter font-display leading-[0.9]"
            initial={{ opacity: 0, y: 32 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          >
            The <br />
            <motion.span className="text-[var(--p-amber-400)]">Cookbook.</motion.span>
          </motion.h1>
          <motion.p 
            className="text-2xl sm:text-3xl max-w-3xl leading-relaxed opacity-70 font-medium"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.1 }}
          >
            Don't build from scratch. Use these battle-tested recipes for coordinating autonomous agent swarms at scale.
          </motion.p>
        </motion.div>
      </motion.section>

      {/* Grid Section */}
      <motion.main className="flex-1 max-w-7xl mx-auto px-6 sm:px-8 lg:px-10 py-32 font-sans">
        <div className="grid sm:grid-cols-2 lg:grid-cols-2 gap-12">
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
                    className="h-full p-12 rounded-[56px] border transition-all duration-[var(--p-transition-spring)] flex flex-col items-start gap-10"
                    style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}
                    whileHover={{ y: -12, borderColor: 'var(--p-amber-400)', boxShadow: '0 40px 80px -20px rgba(251,191,36,0.15)' }}
                  >
                    <div className="w-full flex justify-between items-start">
                       <div className="w-20 h-20 rounded-[32px] bg-[var(--p-amber-400)]/10 flex items-center justify-center border border-[var(--p-amber-400)]/20 group-hover:scale-110 transition-transform shadow-xl">
                          <Icon size={40} className="text-[var(--p-amber-400)]" />
                       </div>
                       <Badge variant={recipe.difficulty === 'advanced' ? 'neutral' : 'teal'} className="text-[8px] font-black uppercase tracking-widest px-3 py-1">
                          {recipe.difficulty}
                       </Badge>
                    </div>

                    <div className="space-y-4 flex-1">
                      <h3 className="m-0 text-3xl sm:text-4xl font-display font-black leading-tight text-[var(--text-primary)] group-hover:text-[var(--p-amber-400)] transition-colors">
                        {recipe.title}
                      </h3>
                      <p className="m-0 text-xl opacity-60 leading-relaxed text-[var(--text-secondary)] group-hover:opacity-100 transition-opacity">
                        {recipe.description}
                      </p>
                    </div>

                    <div className="w-full flex items-center justify-between pt-8 border-t border-[var(--border-subtle)] group-hover:border-[var(--p-amber-400)]/20 transition-colors">
                       <div className="flex items-center gap-3">
                          <div className="w-2 h-2 rounded-full bg-[var(--status-success)] pulse-active" />
                          <span className="text-[10px] font-black uppercase tracking-widest opacity-40 group-hover:opacity-60">Verified Recipe</span>
                       </div>
                       <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-[var(--p-amber-400)] group-hover:gap-4 transition-all">
                          Read Pattern
                          <ChevronRight size={14} />
                       </div>
                    </div>
                  </motion.div>
                </Link>
              </motion.div>
            )
          })}
        </div>

        {/* Vision Callout */}
        <motion.div 
          className="mt-32 p-20 rounded-[80px] border border-dashed border-[var(--border-strong)] bg-gradient-to-br from-[var(--bg-surface)] to-[var(--bg-base)] flex flex-col items-center text-center gap-12 relative overflow-hidden"
          initial={{ opacity: 0, scale: 0.98 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
        >
           <div className="absolute top-0 right-0 p-10 opacity-[0.02] pointer-events-none">
              <RefreshCw size={600} />
           </div>
           
           <div className="space-y-6 max-w-3xl relative z-10">
              <Badge variant="teal" className="px-6 py-2 text-[10px] font-black uppercase tracking-widest shadow-xl">High-Fidelity Swarms</Badge>
              <h3 className="text-4xl sm:text-7xl font-display font-black tracking-tight leading-[0.95]" style={{ color: 'var(--text-primary)' }}>
                Soundness by <span className="text-[var(--p-teal-400)]">Pattern.</span>
              </h3>
              <p className="text-2xl leading-relaxed opacity-70">
                The Cookbook isn't just a list of commands—it's a library of **proven state machines**. Every recipe is designed to converge your swarm on a result while maintaining the absolute integrity of your harbor.
              </p>
           </div>

           <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8 w-full max-w-5xl">
              {[
                { label: 'Self-Healing', icon: RefreshCw },
                { label: 'Always-On', icon: Cpu },
                { label: 'Atomic Locks', icon: Anchor },
                { label: 'Secure Radio', icon: Zap }
              ].map((item, i) => (
                <div key={i} className="p-8 rounded-[40px] bg-[var(--bg-overlay)] border border-[var(--border-subtle)] flex flex-col items-center gap-4">
                   <item.icon size={24} className="text-[var(--p-amber-400)]" />
                   <span className="text-[10px] font-black uppercase tracking-widest opacity-60">{item.label}</span>
                </div>
              ))}
           </div>
        </motion.div>
      </motion.main>

      <Footer />
    </motion.div>
  )
}
