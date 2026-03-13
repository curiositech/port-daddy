import { motion } from 'framer-motion'
import { Badge } from '@/components/ui/Badge'
import { Link } from 'react-router-dom'
import { Boxes, ChevronRight, Puzzle, Sparkles, Zap, Globe, Shield, Terminal, MessageSquare, Anchor } from 'lucide-react'
import { INTEGRATIONS } from '@/data/integrations'
import { Footer } from '@/components/layout/Footer'

const CATEGORY_ICONS: Record<string, any> = {
  LLM: Sparkles,
  Framework: Boxes,
  IDE: Terminal,
  Infrastructure: Anchor
}

export function IntegrationsPage() {
  return (
    <motion.div 
      className="min-h-screen font-sans flex flex-col selection:bg-[var(--brand-primary)] selection:text-white" 
      style={{ background: 'var(--bg-base)', color: 'var(--text-primary)', paddingTop: 'var(--nav-height)' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      {/* Hero Section */}
      <motion.section 
        className="py-48 px-6 sm:px-8 lg:px-10 border-b relative overflow-hidden flex flex-col items-center justify-center text-center" 
        style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
      >
        <motion.div 
          className="absolute top-0 right-0 w-[800px] h-[800px] rounded-full blur-[160px] opacity-[0.1] pointer-events-none" 
          style={{ background: 'radial-gradient(circle, var(--brand-primary) 0%, transparent 70%)' }} 
        />
        
        <motion.div className="max-w-5xl mx-auto relative z-10 flex flex-col items-center gap-12">
          <Badge variant="teal" className="px-8 py-3 text-[10px] font-black uppercase tracking-[0.25em] shadow-xl">The Swarm Ecosystem</Badge>
          <motion.h1 
            className="text-7xl sm:text-9xl font-black tracking-tighter font-display leading-[0.85] m-0"
            initial={{ opacity: 0, y: 32 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          >
            Connect <br />
            <motion.span className="text-[var(--brand-primary)]">Everything.</motion.span>
          </motion.h1>
          <motion.p 
            className="text-2xl sm:text-4xl max-w-4xl leading-relaxed opacity-70 font-medium"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.1 }}
          >
            Port Daddy is the universal coordination layer. Native integrations for the world's most powerful LLMs and agentic frameworks.
          </motion.p>
        </motion.div>
      </motion.section>

      {/* Grid Section */}
      <motion.main className="flex-1 max-w-7xl mx-auto px-6 sm:px-8 lg:px-10 py-48 font-sans flex flex-col items-center">
        <motion.div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-16 w-full">
          {INTEGRATIONS.map((int, i) => {
            const Icon = CATEGORY_ICONS[int.category] || Puzzle
            return (
              <motion.div
                key={int.id}
                initial={{ opacity: 0, y: 32 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: i * 0.05 }}
                className="group"
              >
                <Link to={`/integrations/${int.id}`} className="no-underline block h-full">
                  <motion.div 
                    className="h-full p-12 rounded-[56px] border transition-all duration-[var(--p-transition-spring)] flex flex-col items-center text-center gap-10"
                    style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}
                    whileHover={{ y: -12, borderColor: 'var(--brand-primary)', boxShadow: '0 40px 80px -20px rgba(58,173,173,0.15)' }}
                  >
                    <div className="w-full flex flex-col items-center gap-6">
                       <motion.div className="w-20 h-20 rounded-[32px] bg-[var(--interactive-active)] flex items-center justify-center border border-[var(--border-subtle)] group-hover:scale-110 transition-transform shadow-lg">
                          <Icon size={32} className="text-[var(--brand-primary)]" />
                       </motion.div>
                       <Badge variant={int.status === 'official' ? 'teal' : 'neutral'} className="text-[8px] font-black uppercase tracking-widest px-4 py-1.5 shadow-md">
                          {int.status}
                       </Badge>
                    </div>

                    <div className="space-y-6 flex-1 flex flex-col items-center">
                      <div className="flex flex-col items-center gap-2">
                         <motion.span className="text-[10px] font-black uppercase tracking-[0.3em] opacity-30 font-mono">{int.category}</motion.span>
                         <motion.h3 className="m-0 text-3xl font-display font-black leading-tight text-[var(--text-primary)]">
                           {int.name}
                         </motion.h3>
                      </div>
                      <motion.p className="m-0 text-lg opacity-60 leading-relaxed group-hover:opacity-100 transition-opacity max-w-xs">
                        {int.description}
                      </motion.p>
                    </div>

                    <div className="w-full flex items-center justify-between pt-10 border-t border-[var(--border-subtle)] group-hover:border-transparent transition-colors">
                       <div className="flex items-center gap-3 text-[10px] font-black uppercase tracking-widest text-[var(--brand-primary)] group-hover:gap-5 transition-all">
                          Setup Guide
                          <ChevronRight size={16} />
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
          className="mt-48 p-24 rounded-[100px] border border-dashed border-[var(--border-strong)] bg-gradient-to-br from-[var(--bg-surface)] to-[var(--bg-base)] flex flex-col items-center text-center gap-16 relative overflow-hidden w-full shadow-2xl"
          initial={{ opacity: 0, scale: 0.98 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
        >
           <div className="absolute top-0 right-0 p-10 opacity-[0.02] pointer-events-none">
              <Boxes size={800} />
           </div>
           
           <div className="max-w-4xl relative z-10 space-y-10 flex flex-col items-center">
              <Badge variant="amber" className="px-8 py-3 text-[10px] font-black uppercase tracking-widest shadow-xl">Architectural Mesh</Badge>
              <motion.h3 className="text-5xl sm:text-8xl font-display font-black tracking-tight leading-[0.95] m-0" style={{ color: 'var(--text-primary)' }}>
                One Mesh. <br />
                <span className="text-[var(--p-amber-400)]">Global Scale.</span>
              </motion.h3>
              <motion.p className="text-2xl sm:text-3xl leading-relaxed opacity-70 max-w-3xl">
                Integrations in Port Daddy are not mere API wrappers. They are high-fidelity bridges that allow different agent families to communicate using a single, secure protocol. Build your swarm with Claude, monitor it with Gemini, and orchestrate it with CrewAI.
              </motion.p>
           </div>

           <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-10 w-full max-w-6xl relative z-10">
              {[
                { label: 'Token Efficient', icon: Zap },
                { label: 'HMAC Verified', icon: Shield },
                { label: 'Real-time Radio', icon: MessageSquare },
                { label: 'Zero-Trust DNS', icon: Globe }
              ].map((item, i) => (
                <motion.div key={i} className="p-10 rounded-[48px] bg-[var(--bg-overlay)] border border-[var(--border-subtle)] flex flex-col items-center gap-6 group hover:border-[var(--brand-primary)] transition-all shadow-xl">
                   <motion.div className="w-14 h-14 rounded-2xl bg-[var(--bg-surface)] flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
                      <item.icon size={28} className="text-[var(--brand-primary)]" />
                   </motion.div>
                   <motion.span className="text-[10px] font-black uppercase tracking-[0.25em] opacity-40 group-hover:opacity-100 transition-opacity text-center">{item.label}</motion.span>
                </motion.div>
              ))}
           </div>
        </motion.div>
      </motion.main>

      <Footer />
    </motion.div>
  )
}
