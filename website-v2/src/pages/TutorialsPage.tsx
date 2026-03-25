import { motion } from 'framer-motion'
import { Badge } from '@/components/ui/Badge'
import { Link } from 'react-router-dom'
import { Clock, Play, Zap, Shield, Globe, Sparkles, Anchor, Share2, Cpu, Search, RefreshCw, Box, Activity as ActivityIcon, History, Network, Mail } from 'lucide-react'
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
    slug: 'dashboard',
    number: '08',
    title: 'Visual Control Plane',
    description: 'Visualize your swarm. Live network graphs, lock contention, and real-time telemetry.',
    level: 'beginner',
    time: '5 min',
    tags: ['HUD', 'Live', 'Graphs'],
    href: '/tutorials/dashboard',
    icon: ActivityIcon
  },
  {
    slug: 'dns',
    number: '09',
    title: 'Identity Discovery',
    description: 'Resolve services by semantic hostname instead of port numbers with zero configuration.',
    level: 'intermediate',
    time: '8 min',
    tags: ['DNS', 'Local', 'Hosts'],
    href: '/tutorials/dns',
    icon: Network
  },
  {
    slug: 'inbox',
    number: '10',
    title: 'Agent Inboxes',
    description: 'Direct agent-to-agent messaging with structured payloads and real-time streams.',
    level: 'intermediate',
    time: '10 min',
    tags: ['Inbox', 'Messaging', 'SSE'],
    href: '/tutorials/inbox',
    icon: Mail
  },
  {
    slug: 'spawn',
    number: '11',
    title: 'Swarm Bootstrapping',
    description: 'Launch agent fleets with Port Daddy coordination auto-wired. Heartbeats included.',
    level: 'advanced',
    time: '15 min',
    tags: ['Spawn', 'Fleet', 'Telemetry'],
    href: '/tutorials/spawn',
    icon: Cpu
  },
  {
    slug: 'always-on',
    number: '12',
    title: 'Always-On Avatars',
    description: 'Deploy persistent background processes that respond to global signals 24/7.',
    level: 'intermediate',
    time: '10 min',
    tags: ['Avatars', 'BG', 'Persistence'],
    href: '/tutorials/always-on',
    icon: RefreshCw
  },
  {
    slug: 'session-phases',
    number: '13',
    title: 'The State Machine',
    description: 'Drive agents through planning -> coding -> reviewing with phase-aware handoffs.',
    level: 'advanced',
    time: '15 min',
    tags: ['Phases', 'State', 'Lifecycle'],
    href: '/tutorials/session-phases',
    icon: RefreshCw
  },
  {
    slug: 'sugar',
    number: '14',
    title: 'Sugar Commands',
    description: 'Learn the high-level wrappers that make coordination invisible and friction-free.',
    level: 'beginner',
    time: '5 min',
    tags: ['CLI', 'Productivity', 'UX'],
    href: '/tutorials/sugar',
    icon: Zap
  }
]

export function TutorialsPage() {
  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="min-h-screen bg-[var(--bg-base)] flex flex-col pt-[var(--nav-height)] font-sans selection:bg-[var(--brand-primary)] selection:text-white"
    >
      {/* Hero Section */}
      <motion.section 
        className="py-20 px-6 sm:px-8 lg:px-10 border-b relative overflow-hidden flex flex-col items-center justify-center text-center" 
        style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
      >
        <motion.div 
          className="absolute top-0 right-0 w-[800px] h-[800px] rounded-full blur-[160px] opacity-[0.1] pointer-events-none" 
          style={{ background: 'radial-gradient(circle, var(--brand-primary) 0%, transparent 70%)' }} 
        />
        
        <motion.div className="max-w-5xl mx-auto relative z-10 flex flex-col items-center gap-8">
           <Badge variant="teal" className="px-8 py-3 text-[10px] font-black uppercase tracking-[0.25em] shadow-xl">Academy of Coordination</Badge>
           <motion.h1 
             className="text-4xl sm:text-6xl font-black tracking-tighter font-display leading-[0.85] m-0 text-[var(--text-primary)]"
             initial={{ opacity: 0, y: 32 }}
             animate={{ opacity: 1, y: 0 }}
             transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
           >
             Master the <br />
             <span className="text-[var(--brand-primary)]">Swarm Logic.</span>
           </motion.h1>
           <motion.p 
             className="text-xl sm:text-2xl max-w-4xl leading-relaxed font-medium text-[var(--text-secondary)]"
             initial={{ opacity: 0, y: 20 }}
             animate={{ opacity: 1, y: 0 }}
             transition={{ duration: 0.8, delay: 0.1 }}
           >
             From your first port claim to production-grade P2P harbors. Learn to orchestrate the next generation of AI with high-fidelity, verified code.
           </motion.p>
        </motion.div>
      </motion.section>

      {/* Tutorials Grid */}
      <motion.main className="flex-1 py-20 px-6 sm:px-8 lg:px-10 max-w-7xl mx-auto w-full font-sans flex flex-col items-center">
        <motion.div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8 w-full">
          {TUTORIALS.map((tutorial, i) => (
            <motion.div
              key={tutorial.slug}
              initial={{ opacity: 0, y: 32 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: i * 0.03 }}
              className="group"
            >
              <Link to={tutorial.href} className="no-underline block h-full">
                <motion.div 
                  className="h-full p-12 rounded-[56px] border transition-all duration-[var(--p-transition-spring)] flex flex-col items-center text-center gap-8"
                  style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}
                  whileHover={{ y: -12, borderColor: 'var(--brand-primary)', boxShadow: '0 40px 80px -20px rgba(58,173,173,0.15)' }}
                >
                  <div className="w-full flex flex-col items-center gap-6">
                     <motion.div className="w-20 h-20 rounded-[32px] bg-[var(--interactive-active)] flex items-center justify-center border border-[var(--border-subtle)] group-hover:scale-110 transition-transform shadow-lg">
                        <tutorial.icon size={32} className="text-[var(--brand-primary)]" />
                     </motion.div>
                     <Badge variant={tutorial.level === 'beginner' ? 'teal' : tutorial.level === 'intermediate' ? 'amber' : 'neutral'} className="text-[8px] font-black uppercase tracking-widest px-4 py-1.5 shadow-md">
                        {tutorial.level}
                     </Badge>
                  </div>

                  <div className="space-y-6 flex-1 flex flex-col items-center">
                    <div className="flex flex-col items-center gap-2">
                       <motion.span className="text-[10px] font-black uppercase tracking-[0.3em] text-[var(--text-muted)] font-mono">Lesson {tutorial.number}</motion.span>
                       <motion.h3 className="m-0 text-3xl font-display font-black leading-tight text-[var(--text-primary)]">
                         {tutorial.title}
                       </motion.h3>
                    </div>
                    <motion.p className="m-0 text-lg text-[var(--text-secondary)] leading-relaxed group-hover:text-[var(--text-primary)] transition-colors">
                      {tutorial.description}
                    </motion.p>
                  </div>

                  <motion.div className="flex flex-wrap justify-center gap-3">
                     {tutorial.tags.map(tag => (
                       <motion.span key={tag} className="px-4 py-1.5 rounded-xl bg-[var(--bg-overlay)] text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest border border-transparent group-hover:border-[var(--border-subtle)] transition-all">{tag}</motion.span>
                     ))}
                  </motion.div>

                  <motion.div className="w-full flex items-center justify-between pt-10 border-t border-[var(--border-subtle)] group-hover:border-transparent transition-colors">
                     <motion.div className="flex items-center gap-3 text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)] group-hover:text-[var(--text-secondary)] transition-colors">
                        <Clock size={14} className="text-[var(--brand-primary)]" />
                        {tutorial.time}
                     </motion.div>
                     <motion.div className="w-10 h-10 rounded-full bg-[var(--bg-overlay)] border border-[var(--border-subtle)] flex items-center justify-center group-hover:bg-[var(--brand-primary)] group-hover:text-[var(--bg-base)] group-hover:border-transparent transition-all shadow-md">
                        <Play size={14} fill="currentColor" className="ml-0.5" />
                     </motion.div>
                  </motion.div>
                </motion.div>
              </Link>
            </motion.div>
          ))}
        </motion.div>

        {/* Vision Callout */}
        <motion.div 
          className="mt-20 p-24 rounded-[100px] border border-dashed border-[var(--border-strong)] bg-gradient-to-br from-[var(--bg-surface)] to-[var(--bg-base)] flex flex-col items-center text-center gap-8 relative overflow-hidden w-full shadow-2xl mx-auto"
          initial={{ opacity: 0, scale: 0.98 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
        >
           <div className="absolute top-0 right-0 p-10 opacity-[0.02] pointer-events-none">
              <Anchor size={800} />
           </div>
           
           <div className="space-y-8 max-w-4xl relative z-10 flex flex-col items-center">
              <Badge variant="teal" className="px-8 py-3 text-[10px] font-black uppercase tracking-widest shadow-2xl">Automated Verification</Badge>
              <motion.h3 className="text-4xl sm:text-6xl font-display font-black tracking-tight leading-[0.95] m-0 text-[var(--text-primary)]">
                Certified <span className="text-[var(--brand-primary)]">Academy.</span>
              </motion.h3>
              <motion.p className="text-xl sm:text-2xl leading-relaxed text-[var(--text-secondary)]">
                Every lesson in the Port Daddy Academy is backed by an automated verification service. We use Playwright and VHS to record live CLI sessions and ensure that the code you learn today will work in your harbor tomorrow.
              </motion.p>
           </div>

           <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8 w-full max-w-6xl relative z-10">
              {[
                { label: 'VHS Recorded', icon: Play },
                { label: 'Playwright Verified', icon: Shield },
                { label: 'LangChain Tested', icon: Sparkles },
                { label: 'Continuous CI', icon: Zap }
              ].map((item, i) => (
                <motion.div key={i} className="p-10 rounded-[48px] bg-[var(--bg-overlay)] border border-[var(--border-subtle)] flex flex-col items-center gap-6 group hover:border-[var(--brand-primary)] transition-all shadow-xl">
                   <motion.div className="w-14 h-14 rounded-2xl bg-[var(--bg-surface)] flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
                      <item.icon size={28} className="text-[var(--brand-primary)]" />
                   </motion.div>
                   <motion.span className="text-[10px] font-black uppercase tracking-[0.25em] text-[var(--text-muted)] group-hover:text-[var(--text-primary)] transition-colors">{item.label}</motion.span>
                </motion.div>
              ))}
           </div>
        </motion.div>
      </motion.main>

      <Footer />
    </motion.div>
  )
}
