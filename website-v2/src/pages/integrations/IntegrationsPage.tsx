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
        className="py-32 px-4 sm:px-6 lg:px-8 border-b relative overflow-hidden" 
        style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
      >
        <motion.div 
          className="absolute top-0 right-0 w-[600px] h-[600px] rounded-full blur-[140px] opacity-[0.1] pointer-events-none" 
          style={{ background: 'radial-gradient(circle, var(--brand-primary) 0%, transparent 70%)' }} 
        />
        
        <motion.div className="max-w-7xl mx-auto text-center flex flex-col items-center gap-10 relative z-10">
          <Badge variant="teal" className="px-6 py-2 text-[10px] font-black uppercase tracking-[0.25em] shadow-xl">The Swarm Ecosystem</Badge>
          <motion.h1 
            className="text-6xl sm:text-9xl font-black tracking-tighter font-display leading-[0.9]"
            initial={{ opacity: 0, y: 32 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          >
            Connect <br />
            <motion.span className="text-[var(--brand-primary)]">Everything.</motion.span>
          </motion.h1>
          <motion.p 
            className="text-2xl sm:text-3xl max-w-3xl leading-relaxed opacity-70 font-medium"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.1 }}
          >
            Port Daddy is the universal coordination layer. Native integrations for the world's most powerful LLMs and agentic frameworks.
          </motion.p>
        </motion.div>
      </motion.section>

      {/* Grid Section */}
      <motion.main className="flex-1 max-w-7xl mx-auto px-6 sm:px-8 lg:px-10 py-32 font-sans">
        <motion.div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-10">
          {INTEGRATIONS.map((int, i) => {
            const Icon = CATEGORY_ICONS[int.category] || Puzzle
            return (
              <motion.div
                key={int.id}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: i * 0.05 }}
                className="group"
              >
                <Link to={`/integrations/${int.id}`} className="no-underline block h-full">
                  <motion.div 
                    className="h-full p-10 rounded-[48px] border transition-all duration-[var(--p-transition-spring)] flex flex-col items-start gap-8"
                    style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}
                    whileHover={{ y: -10, borderColor: 'var(--brand-primary)', boxShadow: '0 32px 64px -12px rgba(58,173,173,0.15)' }}
                  >
                    <motion.div className="w-full flex justify-between items-start">
                       <motion.div className="w-16 h-16 rounded-[24px] bg-[var(--interactive-active)] flex items-center justify-center border border-[var(--border-subtle)] group-hover:scale-110 transition-transform">
                          <Icon size={28} className="text-[var(--brand-primary)]" />
                       </motion.div>
                       <Badge variant={int.status === 'official' ? 'teal' : 'neutral'} className="text-[8px] font-black uppercase tracking-widest px-3 py-1">
                          {int.status}
                       </Badge>
                    </motion.div>

                    <motion.div className="space-y-4 flex-1">
                      <motion.div className="space-y-1">
                         <motion.span className="text-[10px] font-black uppercase tracking-widest opacity-40">{int.category}</motion.span>
                         <motion.h3 className="m-0 text-3xl font-display font-black leading-tight text-[var(--text-primary)]">
                           {int.name}
                         </motion.h3>
                      </motion.div>
                      <motion.p className="m-0 text-base opacity-60 leading-relaxed group-hover:opacity-100 transition-opacity">
                        {int.description}
                      </motion.p>
                    </motion.div>

                    <motion.div className="w-full flex items-center justify-between pt-6 border-t border-[var(--border-subtle)] group-hover:border-[var(--brand-primary)]/20 transition-colors">
                       <motion.div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-[var(--brand-primary)] group-hover:gap-4 transition-all">
                          Setup Guide
                          <ChevronRight size={14} />
                       </motion.div>
                    </motion.div>
                  </motion.div>
                </Link>
              </motion.div>
            )
          })}
        </motion.div>

        {/* Vision Callout */}
        <motion.div 
          className="mt-32 p-20 rounded-[80px] border border-dashed border-[var(--border-strong)] bg-gradient-to-br from-[var(--bg-surface)] to-[var(--bg-base)] flex flex-col items-center text-center gap-12 relative overflow-hidden"
          initial={{ opacity: 0, scale: 0.98 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
        >
           <motion.div className="absolute top-0 right-0 p-10 opacity-[0.02] pointer-events-none">
              <Boxes size={600} />
           </motion.div>
           
           <motion.div className="space-y-6 max-w-3xl relative z-10">
              <Badge variant="amber" className="px-6 py-2 text-[10px] font-black uppercase tracking-widest shadow-xl">Architectural Mesh</Badge>
              <motion.h3 className="text-4xl sm:text-7xl font-display font-black tracking-tight leading-[0.95]" style={{ color: 'var(--text-primary)' }}>
                One Mesh. <motion.span className="text-[var(--p-amber-400)]">Global Scale.</motion.span>
              </motion.h3>
              <motion.p className="text-2xl leading-relaxed opacity-70">
                Integrations in Port Daddy are not mere API wrappers. They are high-fidelity bridges that allow different agent families to communicate using a single, secure protocol. Build your swarm with Claude, monitor it with Gemini, and orchestrate it with CrewAI.
              </motion.p>
           </motion.div>

           <motion.div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8 w-full max-w-5xl">
              {[
                { label: 'Token Efficient', icon: Zap },
                { label: 'HMAC Verified', icon: Shield },
                { label: 'Real-time Radio', icon: MessageSquare },
                { label: 'Zero-Trust DNS', icon: Globe }
              ].map((item, i) => (
                <motion.div key={i} className="p-8 rounded-[40px] bg-[var(--bg-overlay)] border border-[var(--border-subtle)] flex flex-col items-center gap-4">
                   <item.icon size={24} className="text-[var(--brand-primary)]" />
                   <motion.span className="text-[10px] font-black uppercase tracking-widest opacity-60">{item.label}</motion.span>
                </motion.div>
              ))}
           </motion.div>
        </motion.div>
      </motion.main>

      <Footer />
    </motion.div>
  )
}
