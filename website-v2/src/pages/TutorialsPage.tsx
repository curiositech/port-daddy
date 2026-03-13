import { motion } from 'framer-motion'
import { Badge } from '@/components/ui/Badge'
import { Card, CardContent } from '@/components/ui/Card'
import { Link } from 'react-router-dom'
import { BookOpen, Clock, ChevronRight, Play, Zap, Shield, Globe, Terminal, Sparkles, Anchor, Activity, Share2, Layers, Cpu, Search, RefreshCw, Box, Lock, Activity as ActivityIcon } from 'lucide-react'
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
    title: 'Multi-Agent Orchestration',
    description: 'Coordinate two agents on the same project. File claims, conflict detection, and real-time signaling.',
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
    description: 'Define cryptographic permission boundaries and issue HMAC-signed capability tokens to your agents.',
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
    description: 'Scan your entire monorepo, assign ports atomically, and start the full service mesh with one command.',
    level: 'intermediate',
    time: '10 min',
    tags: ['Scan', 'Orchestration', 'Mesh'],
    href: '/tutorials/monorepo',
    icon: Box
  },
  {
    slug: 'debugging',
    number: '05',
    title: 'Conflict Detection',
    description: 'Diagnose 2am EADDRINUSE errors in seconds using the semantic port registry.',
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
    description: 'Link two daemons across the internet to create a secure, shared service mesh using Noise Protocol.',
    level: 'advanced',
    time: '20 min',
    tags: ['Network', 'P2P', 'Noise'],
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
    tags: ['Automation', 'DAG', 'Signals'],
    href: '/tutorials/pipelines',
    icon: Layers
  },
  {
    slug: 'dashboard',
    number: '09',
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
    number: '10',
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
    number: '11',
    title: 'Agent Inboxes',
    description: 'Direct agent-to-agent messaging with structured JSON payloads and real-time streams.',
    level: 'intermediate',
    time: '10 min',
    tags: ['Inbox', 'Messaging', 'SSE'],
    href: '/tutorials/inbox',
    icon: Mail
  },
  {
    slug: 'spawn',
    number: '12',
    title: 'Swarm Bootstrapping',
    description: 'Launch agent fleets with Port Daddy coordination auto-wired. Heartbeats and telemetry included.',
    level: 'advanced',
    time: '15 min',
    tags: ['Spawn', 'Fleet', 'Telemetry'],
    href: '/tutorials/spawn',
    icon: Cpu
  },
  {
    slug: 'always-on',
    number: '13',
    title: 'Always-On Avatars',
    description: 'Deploy persistent background processes that respond to global signals 24/7.',
    level: 'intermediate',
    time: '10 min',
    tags: ['Avatars', 'Processes', 'BG'],
    href: '/tutorials/always-on',
    icon: RefreshCw
  },
  {
    slug: 'session-phases',
    number: '14',
    title: 'Session State Machine',
    description: 'Drive agents through planning -> coding -> reviewing with phase-aware handoffs.',
    level: 'advanced',
    time: '15 min',
    tags: ['Phases', 'State', 'Lifecycle'],
    href: '/tutorials/session-phases',
    icon: RefreshCw
  },
  {
    slug: 'sugar',
    number: '15',
    title: 'Sugar Commands',
    description: 'Learn the high-level wrappers that make coordination invisible and friction-free.',
    level: 'beginner',
    time: '5 min',
    tags: ['CLI', 'Wrappers', 'Productivity'],
    href: '/tutorials/sugar',
    icon: Zap
  },
  {
    slug: 'remote-harbors',
    number: '16',
    title: 'Multiplayer Localhost',
    description: 'Link remote agent clusters and GPU-powered harbors across the global mesh.',
    level: 'advanced',
    time: '15 min',
    tags: ['Global', 'Mesh', 'GPU'],
    href: '/tutorials/remote-harbors',
    icon: Globe
  }
]

export default function TutorialsPage() {
  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="min-h-screen bg-[var(--bg-base)] flex flex-col pt-[var(--nav-height)] font-sans selection:bg-[var(--brand-primary)] selection:text-white"
    >
      {/* Hero Section */}
      <motion.section 
        className="py-32 px-6 sm:px-8 lg:px-10 border-b relative overflow-hidden" 
        style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
      >
        <motion.div 
          className="absolute top-0 right-0 w-[600px] h-[600px] rounded-full blur-[140px] opacity-[0.1] pointer-events-none" 
          style={{ background: 'radial-gradient(circle, var(--brand-primary) 0%, transparent 70%)' }} 
        />
        
        <div className="max-w-7xl mx-auto text-center relative z-10 flex flex-col items-center gap-10">
           <Badge variant="teal" className="px-6 py-2 text-[10px] font-black uppercase tracking-[0.25em] shadow-xl">Port Daddy Academy</Badge>
           <motion.h1 
             className="text-6xl sm:text-9xl font-black tracking-tighter font-display leading-[0.9]"
             initial={{ opacity: 0, y: 32 }}
             animate={{ opacity: 1, y: 0 }}
             transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
           >
             Master the <br />
             <span className="text-[var(--brand-primary)]">Swarm Protocol.</span>
           </motion.h1>
           <motion.p 
             className="text-2xl sm:text-3xl max-w-3xl leading-relaxed opacity-70 font-medium"
             initial={{ opacity: 0, y: 20 }}
             animate={{ opacity: 1, y: 0 }}
             transition={{ duration: 0.8, delay: 0.1 }}
           >
             From your first port claim to production-grade P2P harbors. Learn to orchestrate the next generation of AI with high-fidelity, verified code.
           </motion.p>
        </div>
      </motion.section>

      {/* Tutorials Grid */}
      <motion.main className="flex-1 py-32 px-6 sm:px-8 lg:px-10 max-w-7xl mx-auto w-full font-sans">
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-10">
          {TUTORIALS.map((tutorial, i) => (
            <motion.div
              key={tutorial.slug}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: i * 0.03 }}
              className="group"
            >
              <Link to={tutorial.href} className="no-underline block h-full">
                <motion.div 
                  className="h-full p-10 rounded-[48px] border transition-all duration-[var(--p-transition-spring)] flex flex-col items-start gap-8"
                  style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}
                  whileHover={{ y: -10, borderColor: 'var(--brand-primary)', boxShadow: '0 32px 64px -12px rgba(58,173,173,0.15)' }}
                >
                  <div className="w-full flex justify-between items-start">
                     <div className="w-16 h-16 rounded-[24px] bg-[var(--interactive-active)] flex items-center justify-center border border-[var(--border-subtle)] group-hover:scale-110 transition-transform">
                        <tutorial.icon size={28} className="text-[var(--brand-primary)]" />
                     </div>
                     <Badge variant={tutorial.level === 'beginner' ? 'teal' : tutorial.level === 'intermediate' ? 'amber' : 'neutral'} className="text-[8px] font-black uppercase tracking-widest px-3 py-1">
                        {tutorial.level}
                     </Badge>
                  </div>

                  <div className="space-y-4 flex-1">
                    <div className="flex items-center gap-3">
                       <span className="text-xl font-display font-black opacity-20">{tutorial.number}</span>
                       <h3 className="m-0 text-2xl font-display font-black leading-tight text-[var(--text-primary)]">
                         {tutorial.title}
                       </h3>
                    </div>
                    <p className="m-0 text-base opacity-60 leading-relaxed group-hover:opacity-100 transition-opacity">
                      {tutorial.description}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                     {tutorial.tags.map(tag => (
                       <span key={tag} className="px-3 py-1 rounded-lg bg-[var(--bg-overlay)] text-[10px] font-bold opacity-40 uppercase tracking-widest border border-transparent group-hover:border-[var(--border-subtle)] transition-all">{tag}</span>
                     ))}
                  </div>

                  <div className="w-full flex items-center justify-between pt-6 border-t border-[var(--border-subtle)] group-hover:border-transparent transition-colors">
                     <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest opacity-40">
                        <Clock size={12} className="text-[var(--brand-primary)]" />
                        {tutorial.time}
                     </div>
                     <div className="w-8 h-8 rounded-full bg-[var(--bg-overlay)] flex items-center justify-center group-hover:bg-[var(--brand-primary)] group-hover:text-[var(--bg-base)] transition-all">
                        <Play size={12} fill="currentColor" className="ml-0.5" />
                     </div>
                  </div>
                </motion.div>
              </Link>
            </motion.div>
          ))}
        </div>

        {/* Vision Callout */}
        <motion.div 
          className="mt-32 p-20 rounded-[80px] border border-dashed border-[var(--border-strong)] bg-gradient-to-br from-[var(--bg-surface)] to-[var(--bg-base)] flex flex-col items-center text-center gap-12 relative overflow-hidden"
          initial={{ opacity: 0, scale: 0.98 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
        >
           <div className="absolute top-0 right-0 p-10 opacity-[0.02] pointer-events-none">
              <Anchor size={600} />
           </div>
           
           <div className="space-y-6 max-w-3xl relative z-10">
              <Badge variant="teal" className="px-6 py-2 text-[10px] font-black uppercase tracking-widest shadow-xl">Automated Verification</Badge>
              <h3 className="text-4xl sm:text-7xl font-display font-black tracking-tight leading-[0.95]" style={{ color: 'var(--text-primary)' }}>
                Certified <span className="text-[var(--p-teal-400)]">Academy.</span>
              </h3>
              <p className="text-2xl leading-relaxed opacity-70">
                Every lesson in the Port Daddy Academy is backed by an automated verification service. We use Playwright and VHS to record live CLI sessions and ensure that the code you learn today will work in your harbor tomorrow.
              </p>
           </div>

           <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8 w-full max-w-5xl">
              {[
                { label: 'VHS Recorded', icon: Play },
                { label: 'Playwright Verified', icon: Shield },
                { label: 'LangChain Tested', icon: Sparkles },
                { label: 'Continuous CI', icon: Zap }
              ].map((item, i) => (
                <div key={i} className="p-8 rounded-[40px] bg-[var(--bg-overlay)] border border-[var(--border-subtle)] flex flex-col items-center gap-4">
                   <item.icon size={24} className="text-[var(--brand-primary)]" />
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
