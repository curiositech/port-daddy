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
      style={{ background: 'var(--surface-base)', color: 'var(--text-primary)', paddingTop: 'var(--nav-height)' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      {/* Hero Section */}
      <motion.section
        className="py-12 sm:py-24 px-4 sm:px-6 lg:px-10 relative overflow-hidden flex flex-col items-center justify-center text-center"
        style={{ background: 'var(--surface-raised)', boxShadow: 'var(--shadow-raised)' }}
      >
        <motion.div
          className="absolute top-0 right-0 w-[800px] h-[800px] rounded-full blur-[160px] opacity-[0.1] pointer-events-none"
          style={{ background: 'radial-gradient(circle, var(--brand-primary) 0%, transparent 70%)' }}
        />

        <div className="max-w-5xl mx-auto relative z-10 flex flex-col items-center gap-6 sm:gap-12">
          <Badge variant="teal" className="px-6 sm:px-8 py-2 sm:py-3 text-[10px] font-black uppercase tracking-[0.25em]">The Swarm Ecosystem</Badge>
          <motion.h1
            className="text-3xl sm:text-6xl lg:text-8xl font-black tracking-tighter font-display leading-[0.85] m-0"
            initial={{ opacity: 0, y: 32 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          >
            Connect <br />
            <motion.span className="text-[var(--brand-primary)]">Everything.</motion.span>
          </motion.h1>
          <motion.p
            className="text-base sm:text-2xl lg:text-3xl max-w-4xl leading-relaxed text-[var(--text-secondary)] font-medium"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.1 }}
          >
            Port Daddy is the universal coordination layer. Native integrations for the world's most powerful LLMs and agentic frameworks.
          </motion.p>
        </div>
      </motion.section>

      {/* Grid Section */}
      <motion.main id="main-content" className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-10 py-12 sm:py-24 font-sans flex flex-col items-center">
        <motion.div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-10 lg:gap-16 w-full">
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
                    className="h-full p-6 sm:p-8 lg:p-12 rounded-2xl sm:rounded-[36px] lg:rounded-[56px] transition-all duration-300 flex flex-col items-center text-center gap-6 sm:gap-10"
                    style={{
                      background: 'var(--surface-raised)',
                      boxShadow: 'var(--shadow-raised)',
                    }}
                    whileHover={{ y: -8, boxShadow: 'var(--shadow-flat)' }}
                  >
                    <div className="w-full flex flex-col items-center gap-4 sm:gap-6">
                       <div
                         className="w-14 h-14 sm:w-20 sm:h-20 rounded-2xl sm:rounded-[32px] flex items-center justify-center group-hover:scale-110 transition-transform"
                         style={{ background: 'var(--surface-sunken)', boxShadow: 'var(--shadow-inset)' }}
                       >
                          <Icon size={24} className="text-[var(--brand-primary)] sm:hidden" />
                          <Icon size={32} className="text-[var(--brand-primary)] hidden sm:block" />
                       </div>
                       <Badge variant={int.status === 'official' ? 'teal' : 'default'} className="text-[8px] font-black uppercase tracking-widest px-4 py-1.5">
                          {int.status}
                       </Badge>
                    </div>

                    <div className="space-y-3 sm:space-y-6 flex-1 flex flex-col items-center">
                      <div className="flex flex-col items-center gap-2">
                         <span className="text-[10px] font-black uppercase tracking-[0.3em] text-[var(--text-muted)] font-mono">{int.category}</span>
                         <h3 className="m-0 text-xl sm:text-3xl font-display font-black leading-tight text-[var(--text-primary)]">
                           {int.name}
                         </h3>
                      </div>
                      <p className="m-0 text-sm sm:text-lg text-[var(--text-secondary)] leading-relaxed group-hover:text-[var(--text-primary)] transition-colors max-w-xs">
                        {int.description}
                      </p>
                    </div>

                    <div className="w-full flex items-center justify-between pt-6 sm:pt-10" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                       <div className="flex items-center gap-2 sm:gap-3 text-[9px] sm:text-[10px] font-black uppercase tracking-widest text-[var(--brand-primary)] group-hover:gap-4 sm:group-hover:gap-5 transition-all">
                          Setup Guide
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
          className="mt-16 sm:mt-24 p-8 sm:p-16 lg:p-24 rounded-2xl sm:rounded-[60px] lg:rounded-[100px] flex flex-col items-center text-center gap-8 sm:gap-16 relative overflow-hidden w-full"
          style={{
            background: 'var(--surface-raised)',
            boxShadow: 'var(--shadow-raised)',
          }}
          initial={{ opacity: 0, scale: 0.98 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
        >
           <div className="absolute top-0 right-0 p-10 opacity-[0.02] pointer-events-none">
              <Boxes size={800} />
           </div>

           <div className="max-w-4xl relative z-10 space-y-6 sm:space-y-10 flex flex-col items-center">
              <Badge variant="gold" className="px-6 sm:px-8 py-2 sm:py-3 text-[10px] font-black uppercase tracking-widest">Architectural Mesh</Badge>
              <h3 className="text-2xl sm:text-5xl lg:text-7xl font-display font-black tracking-tight leading-[0.95] m-0" style={{ color: 'var(--text-primary)' }}>
                One Mesh. <br />
                <span className="text-[var(--brand-accent)]">Global Scale.</span>
              </h3>
              <p className="text-base sm:text-2xl lg:text-3xl leading-relaxed text-[var(--text-secondary)] max-w-3xl">
                Integrations in Port Daddy are not mere API wrappers. They are high-fidelity bridges that allow different agent families to communicate using a single, secure protocol. Build your swarm with Claude, monitor it with Gemini, and orchestrate it with CrewAI.
              </p>
           </div>

           <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-10 w-full max-w-6xl relative z-10">
              {[
                { label: 'Token Efficient', icon: Zap },
                { label: 'HMAC Verified', icon: Shield },
                { label: 'Real-time Radio', icon: MessageSquare },
                { label: 'Zero-Trust DNS', icon: Globe }
              ].map((item, i) => (
                <div
                  key={i}
                  className="p-4 sm:p-10 rounded-2xl sm:rounded-[48px] flex flex-col items-center gap-3 sm:gap-6 group transition-all"
                  style={{ background: 'var(--surface-sunken)', boxShadow: 'var(--shadow-inset)' }}
                >
                   <div
                     className="w-10 h-10 sm:w-14 sm:h-14 rounded-xl sm:rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform"
                     style={{ background: 'var(--surface-raised)', boxShadow: 'var(--shadow-sm)' }}
                   >
                      <item.icon size={20} className="text-[var(--brand-primary)] sm:hidden" />
                      <item.icon size={28} className="text-[var(--brand-primary)] hidden sm:block" />
                   </div>
                   <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-[0.25em] text-[var(--text-muted)] group-hover:text-[var(--text-primary)] transition-colors text-center">{item.label}</span>
                </div>
              ))}
           </div>
        </motion.div>
      </motion.main>

      <Footer />
    </motion.div>
  )
}
