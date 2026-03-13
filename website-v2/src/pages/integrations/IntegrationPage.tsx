import { motion, useScroll, useSpring } from 'framer-motion'
import { useParams, Link, Navigate } from 'react-router-dom'
import { Badge } from '@/components/ui/Badge'
import { CodeBlock } from '@/components/ui/CodeBlock'
import { INTEGRATIONS } from '@/data/integrations'
import { ChevronLeft, Puzzle, CheckCircle2, Rocket, Terminal, Sparkles, ArrowRight, Info, BookOpen } from 'lucide-react'
import { Footer } from '@/components/layout/Footer'

export function IntegrationPage() {
  const { id } = useParams<{ id: string }>();
  const integration = INTEGRATIONS.find(i => i.id === id);
  const { scrollYProgress } = useScroll()
  
  const scaleX = useSpring(scrollYProgress, {
    stiffness: 100,
    damping: 30,
    restDelta: 0.001
  })

  if (!integration) return <Navigate to="/integrations" replace />;

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
        
        <motion.div className="max-w-4xl mx-auto relative z-10 flex flex-col items-center text-center gap-10">
           <Link to="/integrations" className="no-underline group">
              <motion.div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.25em] opacity-40 group-hover:opacity-100 group-hover:text-[var(--brand-primary)] transition-all">
                 <ChevronLeft size={14} className="group-hover:-translate-x-1 transition-transform" />
                 Back to Swarm Ecosystem
              </motion.div>
           </Link>

           <motion.div className="flex items-center gap-6">
              <motion.div className="w-24 h-24 rounded-[32px] bg-[var(--interactive-active)] flex items-center justify-center border border-[var(--brand-primary)] shadow-2xl shadow-[var(--brand-primary)]/10">
                 <Puzzle size={48} className="text-[var(--brand-primary)]" />
              </motion.div>
           </motion.div>

           <motion.div className="space-y-4">
              <Badge variant={integration.status === 'official' ? 'teal' : 'neutral'} className="px-4 py-1.5 text-[8px] font-black uppercase tracking-widest">{integration.status} Integration</Badge>
              <motion.h1 
                className="text-5xl sm:text-7xl font-black tracking-tighter font-display leading-[1.05]"
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
              >
                {integration.name}
              </motion.h1>
           </motion.div>

           <motion.p 
             className="text-2xl leading-relaxed opacity-70 font-medium max-w-2xl"
             initial={{ opacity: 0, y: 20 }}
             animate={{ opacity: 1, y: 0 }}
             transition={{ duration: 0.8, delay: 0.1 }}
           >
             {integration.description}
           </motion.p>
        </motion.div>
      </motion.header>

      {/* Main Content */}
      <motion.main className="flex-1 py-24 px-6 sm:px-8 lg:px-10 max-w-4xl mx-auto w-full font-sans">
        <motion.div className="space-y-24">
           
           {/* Detailed Features */}
           <section className="space-y-12">
              <motion.div className="flex items-center gap-4 border-b border-[var(--border-subtle)] pb-8">
                 <motion.div className="w-10 h-10 rounded-xl bg-[var(--p-teal-500)]/10 flex items-center justify-center border border-[var(--p-teal-500)]/20">
                    <Sparkles size={20} className="text-[var(--p-teal-400)]" />
                 </motion.div>
                 <motion.h2 className="text-3xl font-display font-black m-0">Integration Capabilities</motion.h2>
              </motion.div>
              
              <motion.div className="grid gap-6">
                 {integration.details.map((detail, i) => (
                   <motion.div 
                     key={i}
                     className="p-8 rounded-[32px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] flex items-start gap-6 group hover:border-[var(--brand-primary)] transition-colors"
                     initial={{ opacity: 0, x: -20 }}
                     whileInView={{ opacity: 1, x: 0 }}
                     viewport={{ once: true }}
                     transition={{ delay: i * 0.1 }}
                   >
                      <motion.div className="w-10 h-10 rounded-full bg-[var(--bg-overlay)] flex items-center justify-center shrink-0 border border-[var(--border-subtle)] group-hover:scale-110 transition-transform">
                         <CheckCircle2 size={18} className="text-[var(--p-teal-400)]" />
                      </motion.div>
                      <motion.p className="text-lg leading-relaxed opacity-70 m-0 group-hover:opacity-100 transition-opacity">{detail}</motion.p>
                   </motion.div>
                 ))}
              </motion.div>
           </section>

           {/* Setup Guide */}
           <section className="space-y-12">
              <motion.div className="flex items-center gap-4 border-b border-[var(--border-subtle)] pb-8">
                 <motion.div className="w-10 h-10 rounded-xl bg-[var(--p-amber-500)]/10 flex items-center justify-center border border-[var(--p-amber-500)]/20">
                    <Terminal size={20} className="text-[var(--p-amber-400)]" />
                 </motion.div>
                 <motion.h2 className="text-3xl font-display font-black m-0">Quick Start</motion.h2>
              </motion.div>

              <motion.div className="p-10 rounded-[48px] bg-[var(--bg-overlay)] border border-[var(--border-subtle)] space-y-8 shadow-2xl relative overflow-hidden">
                 <motion.div className="absolute top-0 right-0 p-8 opacity-5">
                    <Rocket size={100} />
                 </motion.div>
                 <motion.p className="text-sm font-black uppercase tracking-widest opacity-40 m-0">Terminal Setup</motion.p>
                 <CodeBlock language="bash">{integration.setupCode}</CodeBlock>
                 <motion.div className="flex items-center gap-3 p-4 rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
                    <Info size={16} className="text-[var(--brand-primary)] shrink-0" />
                    <motion.p className="text-sm m-0 opacity-60">This integration requires Port Daddy v3.7.0+ running in the background.</motion.p>
                 </motion.div>
              </motion.div>
           </section>

           {/* Documentation CTA */}
           <motion.div 
             className="p-16 rounded-[60px] border border-dashed border-[var(--brand-primary)] bg-[var(--bg-overlay)] flex flex-col items-center text-center gap-8 relative overflow-hidden"
             whileHover={{ scale: 1.01 }}
           >
              <motion.div className="absolute top-0 right-0 p-10 opacity-[0.03] pointer-events-none">
                 <BookOpen size={400} />
              </motion.div>
              <Badge variant="teal" className="px-6 py-2 text-[10px] font-black uppercase tracking-widest shadow-xl">Full Reference</Badge>
              <motion.h3 className="text-4xl font-display font-black m-0" style={{ color: 'var(--text-primary)' }}>Need more detail?</motion.h3>
              <motion.p className="text-xl max-w-xl opacity-70">
                Explore the complete API reference and coordination patterns in our technical documentation.
              </motion.p>
              <Link to="/docs" className="no-underline">
                 <motion.button 
                   className="px-10 py-5 rounded-full bg-[var(--brand-primary)] text-[var(--bg-base)] font-black text-sm flex items-center gap-2 transition-all shadow-xl"
                   whileHover={{ scale: 1.05, y: -4 }}
                 >
                   VIEW SDK MANUAL
                   <ArrowRight size={16} />
                 </motion.button>
              </Link>
           </motion.div>
        </motion.div>
      </motion.main>

      <Footer />
    </motion.div>
  )
}
