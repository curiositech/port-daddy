import { motion, useScroll, useSpring } from 'framer-motion'
import { useParams, Link, Navigate } from 'react-router-dom'
import { Badge } from '@/components/ui/Badge'
import { CodeBlock } from '@/components/ui/CodeBlock'
import { BLUEPRINTS } from '@/data/blueprints'
import { ChevronLeft, Box, Zap, Shield, Rocket, Cpu, Terminal, Sparkles, Globe, MessageSquare, ArrowRight, Info, Activity, Users, Layers, Share2 } from 'lucide-react'
import { Footer } from '@/components/layout/Footer'

export function TemplatePage() {
  const { id } = useParams<{ id: string }>();
  const bp = BLUEPRINTS.find(b => b.id === id);
  const { scrollYProgress } = useScroll()
  
  const scaleX = useSpring(scrollYProgress, {
    stiffness: 100,
    damping: 30,
    restDelta: 0.001
  })

  if (!bp) return <Navigate to="/#blueprints" replace />;

  return (
    <motion.div 
      className="min-h-screen bg-[var(--bg-base)] flex flex-col pt-[var(--nav-height)] font-sans selection:bg-[var(--brand-primary)] selection:text-white"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      <motion.div
        className="fixed top-0 left-0 right-0 h-1 bg-[var(--brand-primary)] z-[100] origin-left shadow-[0_0_12px_rgba(58,173,173,0.5)]"
        style={{ scaleX, top: 'var(--nav-height)' }}
      />

      {/* Hero Section */}
      <motion.header 
        className="py-32 px-6 sm:px-8 lg:px-10 border-b relative overflow-hidden" 
        style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
      >
        <motion.div 
          className="absolute top-0 right-0 w-[600px] h-[600px] rounded-full blur-[140px] opacity-[0.08] pointer-events-none" 
          style={{ background: 'radial-gradient(circle, var(--brand-primary) 0%, transparent 70%)' }} 
        />
        
        <div className="max-w-4xl mx-auto relative z-10 flex flex-col items-center text-center gap-10">
           <Link to="/#blueprints" className="no-underline group">
              <motion.div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.25em] opacity-40 group-hover:opacity-100 group-hover:text-[var(--brand-primary)] transition-all">
                 <ChevronLeft size={14} className="group-hover:-translate-x-1 transition-transform" />
                 Back to Blueprints
              </motion.div>
           </Link>

           <div className="flex items-center gap-6">
              <div className="w-24 h-24 rounded-[32px] bg-[var(--interactive-active)] flex items-center justify-center border border-[var(--brand-primary)] shadow-2xl shadow-[var(--brand-primary)]/10 group-hover:scale-110 transition-transform">
                 <Box size={48} className="text-[var(--brand-primary)]" />
              </div>
           </div>

           <div className="space-y-4">
              <Badge variant="teal" className="px-4 py-1.5 text-[8px] font-black uppercase tracking-widest">Official Swarm Blueprint</Badge>
              <motion.h1 
                className="text-5xl sm:text-7xl font-black tracking-tighter font-display leading-[1.05]"
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
              >
                {bp.title}
              </motion.h1>
           </div>

           <motion.p 
             className="text-2xl leading-relaxed opacity-70 font-medium max-w-2xl"
             initial={{ opacity: 0, y: 20 }}
             animate={{ opacity: 1, y: 0 }}
             transition={{ duration: 0.8, delay: 0.1 }}
           >
             {bp.description}
           </motion.p>

           <div className="flex flex-wrap justify-center gap-3">
              {bp.tags.map(tag => (
                <Badge key={tag} variant="neutral" className="px-4 py-1.5 text-[8px] font-black uppercase tracking-widest bg-[var(--bg-overlay)]">{tag}</Badge>
              ))}
           </div>
        </div>
      </motion.header>

      {/* Main Content */}
      <motion.main className="flex-1 py-24 px-6 sm:px-8 lg:px-10 max-w-4xl mx-auto w-full font-sans">
        <div className="space-y-24">
           
           {/* Quick Start */}
           <section className="space-y-12">
              <div className="flex items-center gap-4 border-b border-[var(--border-subtle)] pb-8">
                 <div className="w-10 h-10 rounded-xl bg-[var(--brand-primary)]/10 flex items-center justify-center border border-[var(--brand-primary)]/20">
                    <Rocket size={20} className="text-[var(--brand-primary)]" />
                 </div>
                 <h2 className="text-3xl font-display font-black m-0">Bootstrap the Swarm</h2>
              </div>
              
              <div className="p-10 rounded-[48px] bg-[var(--bg-overlay)] border border-[var(--border-subtle)] space-y-8 shadow-2xl relative overflow-hidden">
                 <div className="absolute top-0 right-0 p-8 opacity-5">
                    <Terminal size={100} />
                 </div>
                 <p className="text-sm font-black uppercase tracking-widest opacity-40 m-0">Terminal Execution</p>
                 <CodeBlock language="bash">
                   {`mkdir ${bp.id}\ncd ${bp.id}\n\npd init --template ${bp.id}\npd up`}
                 </CodeBlock>
                 <div className="flex items-center gap-3 p-4 rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
                    <Info size={16} className="text-[var(--brand-primary)] shrink-0" />
                    <p className="text-sm m-0 opacity-60">This template includes pre-configured harbor cards and Swarm Radio channels.</p>
                 </div>
              </div>
           </section>

           {/* Architecture */}
           <section className="space-y-12">
              <div className="flex items-center gap-4 border-b border-[var(--border-subtle)] pb-8">
                 <div className="w-10 h-10 rounded-xl bg-[var(--p-teal-500)]/10 flex items-center justify-center border border-[var(--p-teal-500)]/20">
                    <Layers size={20} className="text-[var(--p-teal-400)]" />
                 </div>
                 <h2 className="text-3xl font-display font-black m-0">Swarm Architecture</h2>
              </div>

              <div className="grid sm:grid-cols-2 gap-8">
                 <div className="p-8 rounded-[32px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] space-y-4 group hover:border-[var(--brand-primary)] transition-colors">
                    <div className="w-10 h-10 rounded-xl bg-[var(--p-teal-500)]/10 flex items-center justify-center border border-[var(--p-teal-500)]/20">
                       <Users size={20} className="text-[var(--p-teal-400)]" />
                    </div>
                    <h3 className="text-xl font-display font-black m-0">Role-Based Agents</h3>
                    <p className="text-base opacity-60 m-0 leading-relaxed">Dedicated identities for planners, coders, and reviewers with scoped file access.</p>
                 </div>
                 <div className="p-8 rounded-[32px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] space-y-4 group hover:border-[var(--p-amber-400)] transition-colors">
                    <div className="w-10 h-10 rounded-xl bg-[var(--p-amber-500)]/10 flex items-center justify-center border border-[var(--p-amber-500)]/20">
                       <Zap size={20} className="text-[var(--p-amber-400)]" />
                    </div>
                    <h3 className="text-xl font-display font-black m-0">Reactive Signaling</h3>
                    <p className="text-base opacity-60 m-0 leading-relaxed">Pre-wired Swarm Radio channels for automatic handoffs and error reporting.</p>
                 </div>
              </div>
           </section>

           {/* Security Note */}
           <motion.div 
             className="p-16 rounded-[60px] border border-dashed border-[var(--brand-primary)] bg-[var(--bg-overlay)] flex flex-col items-center text-center gap-8 relative overflow-hidden"
             whileHover={{ scale: 1.01 }}
           >
              <div className="absolute top-0 right-0 p-10 opacity-[0.03] pointer-events-none">
                 <Shield size={400} />
              </div>
              <Badge variant="teal" className="px-6 py-2 text-[10px] font-black uppercase tracking-widest shadow-xl">Formal Integrity</Badge>
              <h3 className="text-4xl font-display font-black m-0" style={{ color: 'var(--text-primary)' }}>Mathematically Sound.</h3>
              <p className="text-xl max-w-xl opacity-70">
                Like all Port Daddy templates, this blueprint is verified against our formal state machine. We ensure that the coordination logic cannot result in unauthorized port claims or "zombie" process cycles.
              </p>
              <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-[var(--brand-primary)]">
                 <Activity size={14} className="animate-pulse" />
                 Anchor Protocol v4 Active
              </div>
           </motion.div>
        </div>
      </motion.main>

      <Footer />
    </motion.div>
  )
}
