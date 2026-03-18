import { motion } from 'framer-motion'
import { Badge } from '@/components/ui/Badge'
import { Link } from 'react-router-dom'
import { Clock, Play, Zap, Shield, Globe, Sparkles, Anchor, Share2, Layers, Search, Box, History } from 'lucide-react'
import { Footer } from '@/components/layout/Footer'

interface Tutorial {
  slug: string
  number: string
  title: string
  description: string
  level: 'beginner' | 'intermediate' | 'advanced'
  time: string
  tags: string[]
  href: string
  icon: any
}

const TUTORIALS: Tutorial[] = [
  {
    slug: 'getting-started',
    number: '01',
    title: 'The First Handshake',
    description: 'Install Port Daddy, claim your first semantic identity, and learn why ports are a relic of the past.',
    level: 'beginner',
    time: '5 min',
    tags: ['CLI', 'Identity', 'Basics'],
    href: '/tutorials/getting-started',
    icon: Sparkles
  },
  {
    slug: 'multi-agent',
    number: '02',
    title: 'Multi-Agent Flow',
    description: 'Coordinate multiple agents on the same project. Advisory locks, file claims, and signaling.',
    level: 'intermediate',
    time: '12 min',
    tags: ['Sessions', 'Radio', 'Files'],
    href: '/tutorials/multi-agent',
    icon: Share2
  },
  {
    slug: 'harbors',
    number: '03',
    title: 'Secure Harbors',
    description: 'Define cryptographic permission boundaries and issue HMAC-signed tokens to your swarms.',
    level: 'advanced',
    time: '15 min',
    tags: ['Security', 'JWT', 'Harbors'],
    href: '/tutorials/harbors',
    icon: Shield
  },
  {
    slug: 'monorepo',
    number: '04',
    title: 'Fleet Management',
    description: 'Scan your monorepo, assign ports atomically, and orchestrate a full mesh with one command.',
    level: 'intermediate',
    time: '10 min',
    tags: ['Monorepo', 'Mesh', 'Scan'],
    href: '/tutorials/monorepo',
    icon: Box
  },
  {
    slug: 'debugging',
    number: '05',
    title: 'Conflict Detection',
    description: 'Turn 2am EADDRINUSE errors into 5-second diagnoses using the semantic registry.',
    level: 'intermediate',
    time: '14 min',
    tags: ['Health', 'Audit', 'Registry'],
    href: '/tutorials/debugging',
    icon: Search
  },
  {
    slug: 'tunnel',
    number: '06',
    title: 'P2P Tunnels',
    description: 'Link two daemons across the internet to create a shared service mesh using Noise Protocol.',
    level: 'advanced',
    time: '20 min',
    tags: ['P2P', 'Noise', 'Global'],
    href: '/tutorials/tunnel',
    icon: Globe
  },
  {
    slug: 'time-travel',
    number: '07',
    title: 'Time-Travel Debugging',
    description: 'Scrub through the history of your swarm. Correlate infrastructure events with agent notes.',
    level: 'intermediate',
    time: '8 min',
    tags: ['Timeline', 'Audit', 'Radio'],
    href: '/tutorials/time-travel',
    icon: History
  },
  {
    slug: 'pipelines',
    number: '08',
    title: 'Reactive Pipelines',
    description: 'Turn your harbor into an event-driven DAG. Auto-spawn agents based on swarm signals.',
    level: 'advanced',
    time: '12 min',
    tags: ['DAG', 'Automation', 'Signals'],
    href: '/tutorials/pipelines',
    icon: Layers
  }
]

export function TutorialsPage() {
  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="min-h-screen bg-bg-base flex flex-col font-sans selection:bg-brand-primary selection:text-brand-on-primary"
    >
      {/* Hero Section */}
      <motion.section 
        className="pt-32 pb-20 px-6 sm:px-8 lg:px-12 border-b border-border-subtle relative overflow-hidden flex flex-col items-center justify-center text-center bg-bg-surface"
      >
        <motion.div 
          className="absolute top-0 right-0 w-[800px] h-[800px] rounded-full blur-[160px] opacity-[0.05] pointer-events-none" 
          style={{ background: 'radial-gradient(circle, var(--brand-primary) 0%, transparent 70%)' }} 
        />
        
        <div className="max-w-5xl mx-auto relative z-10 flex flex-col items-center gap-10">
           <Badge variant="teal" className="px-8 py-3 text-[10px] font-black uppercase tracking-[0.25em] shadow-xl bg-bg-overlay border border-brand-primary text-brand-primary">Academy of Coordination</Badge>
           <motion.h1 
             className="text-5xl sm:text-8xl font-black tracking-tighter font-display leading-[0.85] m-0 text-text-primary"
             initial={{ opacity: 0, y: 32 }}
             animate={{ opacity: 1, y: 0 }}
             transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
           >
             Master the <br />
             <span className="text-brand-primary">Swarm Logic.</span>
           </motion.h1>
           <motion.p 
             className="text-xl sm:text-3xl max-w-4xl leading-relaxed text-text-secondary font-bold"
             initial={{ opacity: 0, y: 20 }}
             animate={{ opacity: 1, y: 0 }}
             transition={{ duration: 0.8, delay: 0.1 }}
           >
             From your first port claim to production-grade P2P harbors. Learn to orchestrate the next generation of AI with high-fidelity, verified code.
           </motion.p>
        </div>
      </motion.section>

      {/* Tutorials Grid */}
      <motion.main id="main-content" className="flex-1 py-24 px-6 sm:px-8 lg:px-12 max-w-7xl mx-auto w-full font-sans flex flex-col items-center">
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-12 w-full">
          {TUTORIALS.map((tutorial, i) => (
            <motion.div
              key={tutorial.slug}
              initial={{ opacity: 0, y: 32 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: i * 0.03 }}
              className="group h-full"
            >
              <Link to={tutorial.href} className="no-underline block h-full">
                <motion.div 
                  className="h-full p-10 rounded-[48px] bg-bg-surface border border-border-subtle transition-all duration-500 flex flex-col items-center text-center gap-10 group-hover:border-brand-primary shadow-lg"
                  whileHover={{ y: -12, boxShadow: '0 40px 80px -20px rgba(58,173,173,0.15)' }}
                >
                  <div className="w-full flex flex-col items-center gap-6">
                     <motion.div className="w-16 h-16 rounded-2xl bg-bg-overlay flex items-center justify-center border border-border-subtle group-hover:scale-110 transition-transform">
                        <tutorial.icon size={32} className="text-brand-primary" />
                     </motion.div>
                     <Badge variant={tutorial.level === 'beginner' ? 'teal' : tutorial.level === 'intermediate' ? 'amber' : 'neutral'} className="text-[8px] font-black uppercase tracking-widest px-4 py-1.5 shadow-md">
                        {tutorial.level}
                     </Badge>
                  </div>

                  <div className="space-y-6 flex-1 flex flex-col items-center">
                    <div className="flex flex-col items-center gap-2">
                       <span className="text-[10px] font-black uppercase tracking-[0.3em] text-text-muted font-mono">Lesson {tutorial.number}</span>
                       <h3 className="m-0 text-3xl font-display font-black leading-tight text-text-primary">
                         {tutorial.title}
                       </h3>
                    </div>
                    <p className="m-0 text-lg text-text-secondary leading-relaxed font-bold group-hover:text-text-primary transition-colors">
                      {tutorial.description}
                    </p>
                  </div>

                  <div className="flex flex-wrap justify-center gap-3">
                     {tutorial.tags.map(tag => (
                       <span key={tag} className="px-4 py-1.5 rounded-xl bg-bg-overlay text-[10px] font-black text-text-muted uppercase tracking-widest border border-border-subtle group-hover:border-brand-primary/20 transition-all">{tag}</span>
                     ))}
                  </div>

                  <div className="w-full flex items-center justify-between pt-10 border-t border-border-subtle group-hover:border-brand-primary/20 transition-colors">
                     <div className="flex items-center gap-3 text-[10px] font-black uppercase tracking-widest text-text-muted group-hover:text-text-primary transition-colors">
                        <Clock size={14} className="text-brand-primary" />
                        {tutorial.time}
                     </div>
                     <div className="w-10 h-10 rounded-full bg-bg-overlay border border-border-subtle flex items-center justify-center group-hover:bg-brand-primary group-hover:text-brand-on-primary group-hover:border-transparent transition-all shadow-md">
                        <Play size={14} fill="currentColor" className="ml-0.5" />
                     </div>
                  </div>
                </motion.div>
              </Link>
            </motion.div>
          ))}
        </div>

        {/* Vision Callout */}
        <motion.div 
          className="mt-32 p-20 rounded-[80px] border border-dashed border-border-strong bg-gradient-to-br from-bg-surface to-bg-base flex flex-col items-center text-center gap-12 relative overflow-hidden w-full shadow-2xl mx-auto"
          initial={{ opacity: 0, scale: 0.98 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
        >
           <div className="absolute top-0 right-0 p-10 opacity-[0.02] pointer-events-none text-text-primary">
              <Anchor size={800} />
           </div>
           
           <div className="space-y-8 max-w-4xl relative z-10 flex flex-col items-center">
              <Badge variant="teal" className="px-8 py-3 text-[10px] font-black uppercase tracking-widest shadow-2xl bg-bg-overlay border border-brand-primary text-brand-primary">Automated Verification</Badge>
              <h3 className="text-4xl sm:text-7xl font-display font-black tracking-tight leading-[0.95] m-0 text-text-primary">
                Certified <span className="text-brand-primary">Academy.</span>
              </h3>
              <p className="text-xl sm:text-2xl leading-relaxed text-text-secondary font-bold">
                Every lesson in the Port Daddy Academy is backed by an automated verification service. We use Playwright and VHS to record live CLI sessions and ensure that the code you learn today will work in your harbor tomorrow.
              </p>
           </div>

           <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8 w-full max-w-6xl relative z-10">
              {[
                { label: 'VHS Recorded', icon: Play },
                { label: 'Playwright Verified', icon: Shield },
                { label: 'LangChain Tested', icon: Sparkles },
                { label: 'Continuous CI', icon: Zap }
              ].map((item, i) => (
                <motion.div key={i} className="p-10 rounded-[40px] bg-bg-overlay border border-border-subtle flex flex-col items-center gap-6 group hover:border-brand-primary transition-all shadow-xl">
                   <motion.div className="w-14 h-14 rounded-2xl bg-bg-base flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform border border-border-subtle">
                      <item.icon size={28} className="text-brand-primary" />
                   </motion.div>
                   <span className="text-[10px] font-black uppercase tracking-[0.25em] text-text-muted group-hover:text-text-primary transition-colors">{item.label}</span>
                </motion.div>
              ))}
           </div>
        </motion.div>
      </motion.main>

      <Footer />
    </motion.div>
  )
}
