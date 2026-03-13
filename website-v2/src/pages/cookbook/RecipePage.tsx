import { motion, useScroll, useSpring } from 'framer-motion'
import { useParams, Link, Navigate } from 'react-router-dom'
import { Badge } from '@/components/ui/Badge'
import { CodeBlock } from '@/components/ui/CodeBlock'
import { COOKBOOK_RECIPES } from '@/data/cookbook'
import { ChevronLeft, Shield, Activity, Zap, MessageSquare, UserMinus, Network, Share2, Anchor, Cpu, Search, RefreshCw, Layers, CheckCircle2, Info, Rocket, BookOpen, ArrowRight } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { Footer } from '@/components/layout/Footer'

const ICON_MAP: Record<string, any> = {
  Shield,
  Activity,
  Zap,
  MessageSquare,
  UserMinus,
  Network,
  Share2,
  Anchor,
  Cpu,
  Search,
  RefreshCw,
  Layers
}

export function RecipePage() {
  const { id } = useParams<{ id: string }>();
  const recipe = COOKBOOK_RECIPES.find(r => r.id === id);
  const { scrollYProgress } = useScroll()
  
  const scaleX = useSpring(scrollYProgress, {
    stiffness: 100,
    damping: 30,
    restDelta: 0.001
  })

  if (!recipe) return <Navigate to="/cookbook" replace />;

  const Icon = ICON_MAP[recipe.icon] || Zap;

  return (
    <motion.div 
      className="min-h-screen bg-[var(--bg-base)] flex flex-col pt-[var(--nav-height)] font-sans selection:bg-[var(--brand-primary)] selection:text-white"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      <motion.div
        className="fixed top-0 left-0 right-0 h-1 bg-[var(--p-amber-400)] z-[100] origin-left shadow-[0_0_12px_rgba(251,191,36,0.5)]"
        style={{ scaleX, top: 'var(--nav-height)' }}
      />

      {/* Hero Section */}
      <motion.header 
        className="py-32 px-6 sm:px-8 lg:px-10 border-b relative overflow-hidden" 
        style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
      >
        <motion.div 
          className="absolute top-0 right-0 w-[600px] h-[600px] rounded-full blur-[140px] opacity-[0.08] pointer-events-none" 
          style={{ background: 'radial-gradient(circle, var(--p-amber-500) 0%, transparent 70%)' }} 
        />
        
        <div className="max-w-4xl mx-auto relative z-10 flex flex-col items-center text-center gap-10">
           <Link to="/cookbook" className="no-underline group">
              <motion.div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.25em] opacity-40 group-hover:opacity-100 group-hover:text-[var(--p-amber-400)] transition-all">
                 <ChevronLeft size={14} className="group-hover:-translate-x-1 transition-transform" />
                 Back to Cookbook
              </motion.div>
           </Link>

           <div className="flex items-center gap-6">
              <div className="w-24 h-24 rounded-[32px] bg-[var(--bg-overlay)] flex items-center justify-center border border-[var(--p-amber-400)] shadow-2xl shadow-[var(--p-amber-400)]/10">
                 <Icon size={48} className="text-[var(--p-amber-400)]" />
              </div>
           </div>

           <div className="space-y-4">
              <Badge variant={recipe.difficulty === 'advanced' ? 'neutral' : 'teal'} className="px-4 py-1.5 text-[8px] font-black uppercase tracking-widest">{recipe.difficulty} Pattern</Badge>
              <motion.h1 
                className="text-5xl sm:text-7xl font-black tracking-tighter font-display leading-[1.05]"
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
              >
                {recipe.title}
              </motion.h1>
           </div>

           <motion.p 
             className="text-2xl leading-relaxed opacity-70 font-medium max-w-2xl"
             initial={{ opacity: 0, y: 20 }}
             animate={{ opacity: 1, y: 0 }}
             transition={{ duration: 0.8, delay: 0.1 }}
           >
             {recipe.description}
           </motion.p>
        </div>
      </motion.header>

      {/* Main Content */}
      <motion.main className="flex-1 py-24 px-6 sm:px-8 lg:px-10 max-w-4xl mx-auto w-full font-sans">
        <div className="space-y-24">
           
           {/* Detailed Pattern */}
           <section className="space-y-12">
              <div className="flex items-center gap-4 border-b border-[var(--border-subtle)] pb-8">
                 <div className="w-10 h-10 rounded-xl bg-[var(--p-amber-500)]/10 flex items-center justify-center border border-[var(--p-amber-500)]/20">
                    <BookOpen size={20} className="text-[var(--p-amber-400)]" />
                 </div>
                 <h2 className="text-3xl font-display font-black m-0">The Coordination Recipe</h2>
              </div>
              
              <motion.article 
                className="prose prose-invert prose-lg max-w-none 
                  prose-headings:font-display prose-headings:font-black prose-headings:tracking-tight
                  prose-p:text-xl prose-p:leading-relaxed prose-p:opacity-70
                  prose-strong:text-[var(--text-primary)] prose-strong:font-black
                  prose-code:text-[var(--p-amber-400)] prose-code:bg-[var(--bg-overlay)] prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-md prose-code:font-bold prose-code:before:content-none prose-code:after:content-none"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.7, delay: 0.2 }}
              >
                <ReactMarkdown>{recipe.content}</ReactMarkdown>
              </motion.article>
           </section>

           {/* Implementation Note */}
           <motion.div 
             className="p-16 rounded-[60px] border border-dashed border-[var(--p-amber-400)] bg-[var(--bg-overlay)] flex flex-col items-center text-center gap-8 relative overflow-hidden"
             whileHover={{ scale: 1.01 }}
           >
              <div className="absolute top-0 right-0 p-10 opacity-[0.03] pointer-events-none">
                 <Shield size={400} />
              </div>
              <Badge variant="teal" className="px-6 py-2 text-[10px] font-black uppercase tracking-widest shadow-xl">State Verification</Badge>
              <h3 className="text-4xl font-display font-black m-0" style={{ color: 'var(--text-primary)' }}>Pattern Soundness.</h3>
              <p className="text-xl max-w-xl opacity-70">
                This recipe has been verified against the Port Daddy v3.7 state machine. We ensure that following these handoff steps results in a deterministic and resilient harbor state.
              </p>
              <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-[var(--p-amber-400)]">
                 <Activity size={14} className="animate-pulse" />
                 Swarm Radio Protocol v4 Active
              </div>
           </motion.div>
        </div>
      </motion.main>

      <Footer />
    </motion.div>
  )
}
