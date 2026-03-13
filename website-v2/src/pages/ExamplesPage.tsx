import * as React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Badge } from '@/components/ui/Badge'
import { Link } from 'react-router-dom'
import { Code, Search, Network, Shield, Cpu, Zap, Share2, Terminal, ArrowRight, Sparkles, Box, Globe, MessageSquare, RefreshCw, Layers, FileText, DollarSign, Activity, Users, Database, Lock, Key } from 'lucide-react'
import { Footer } from '@/components/layout/Footer'

interface Example {
  id: string
  title: string
  category: string
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced'
  description: string
  what: string[]
  code: string[]
  icon: any
  color: string
}

const EXAMPLES: Example[] = [
  {
    id: 'langchain-discovery',
    title: 'LangChain Tool Discovery',
    category: 'Integrations',
    difficulty: 'Beginner',
    description: 'Wrap your agents in a Port Daddy lighthouse so they can find each other via semantic DNS instead of fragile, hardcoded ports.',
    what: [
      'Agent A claims identity swarm:analyst',
      'LangChain Tool resolves address via pd dns',
      'Zero reconfiguration if service moves ports',
      'Works across local and remote harbors'
    ],
    code: [
      '# Agent A: Claim identity',
      'pd claim swarm:analyst',
      '',
      '# Agent B: Discover via DNS',
      'curl http://$(pd dns resolve swarm:analyst)/health',
      '',
      '# Response:',
      '{"status": "online", "port": 3102}'
    ],
    icon: Sparkles,
    color: 'var(--p-teal-400)'
  },
  {
    id: 'crewai-harbors',
    title: 'Secure CrewAI Harbors',
    category: 'Security',
    difficulty: 'Intermediate',
    description: 'Enforce cryptographic boundaries for your CrewAI members. Each agent gets a scoped token that strictly limits their system access.',
    what: [
      'Create a harbor with specific capabilities',
      'Issue HMAC-signed JWTs to crew members',
      'Daemon rejects unauthorized file/port claims',
      'Auto-expiry prevents permission rot'
    ],
    code: [
      '# Create harbor for coding crew',
      'pd harbor create my-crew:coding \\',
      '  --cap "code:write,file:claim" \\',
      '  --ttl 1h',
      '',
      '# Members enter harbor to get tokens',
      'pd harbor enter my-crew:coding',
      '# → [pd] Identity Verified. Token Issued.'
    ],
    icon: Shield,
    color: 'var(--p-amber-400)'
  },
  {
    id: 'self-healing-infra',
    title: 'Self-Healing Infra Swarm',
    category: 'Resilience',
    difficulty: 'Advanced',
    description: 'Orchestrate background agents that monitor infrastructure and automatically salvage work from crashed processes.',
    what: [
      'Persistent "Avatar" agents live in harbors',
      'Crashes trigger automatic work escrow',
      'Resurrection queue preserves session state',
      'Swarm Radio signals replacement spawns'
    ],
    code: [
      '# Spawn always-on avatar',
      'pd spawn --avatar --identity infra:monitor',
      '',
      '# Watch for crash events',
      'pd watch swarm:events \\',
      '  --filter "type == agent_crash" \\',
      '  --exec "./scripts/respawn.sh"',
    ],
    icon: RefreshCw,
    color: 'var(--p-blue-400)'
  },
  {
    id: 'manifest-payment',
    title: 'Harbor Manifest (Escrow)',
    category: 'Economics',
    difficulty: 'Advanced',
    description: 'Use the Manifest/Float protocol to ensure agents commit work before getting paid or unlocking down-stream resources.',
    what: [
      'Agent commits a "Work Manifest" to harbor',
      'Harbor card locks until work is verified',
      'Tokens released upon successful PR merge',
      'Escrowed state prevents double-spending'
    ],
    code: [
      '# Submit work manifest',
      'pd session commit --manifest ./work.json \\',
      '  --escrow-id "pay_8f2a"',
      '',
      '# Harbor verifies and releases',
      'pd harbor release pay_8f2a --verified',
      '# → [pd] Escrow released. Session Closed.'
    ],
    icon: DollarSign,
    color: 'var(--p-green-400)'
  },
  {
    id: 'distributed-memory',
    title: 'Shared Embedding Memory',
    category: 'Data',
    difficulty: 'Intermediate',
    description: 'Provide a global K/V store for your swarm, optimized for vector embeddings and shared context across agent families.',
    what: [
      'Agents store context via pd memory',
      'Shared vector embeddings for RAG',
      'Locks prevent concurrent memory writes',
      'Timeline audit of all state changes'
    ],
    code: [
      '# Store shared context',
      'pd memory store swarm:context \\',
      '  --value "current_goal: refactor_auth"',
      '',
      '# Retrieve from another agent',
      'pd memory get swarm:context',
      '# → "current_goal: refactor_auth"'
    ],
    icon: Database,
    color: 'var(--p-purple-400)'
  }
]

export function ExamplesPage() {
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
           <Badge variant="teal" className="px-6 py-2 text-[10px] font-black uppercase tracking-[0.25em] shadow-xl">The Coordination Library</Badge>
           <motion.h1 
             className="text-6xl sm:text-9xl font-black tracking-tighter font-display leading-[0.9]"
             initial={{ opacity: 0, y: 32 }}
             animate={{ opacity: 1, y: 0 }}
             transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
           >
             Proven <br />
             <span className="text-[var(--brand-primary)]">Patterns.</span>
           </motion.h1>
           <motion.p 
             className="text-2xl sm:text-3xl max-w-3xl leading-relaxed opacity-70 font-medium"
             initial={{ opacity: 0, y: 20 }}
             animate={{ opacity: 1, y: 0 }}
             transition={{ duration: 0.8, delay: 0.1 }}
           >
             Stop reinventing discovery. Use these production-grade coordination blueprints for LangChain, CrewAI, and beyond.
           </motion.p>
        </div>
      </motion.section>

      {/* Examples Grid */}
      <motion.main className="flex-1 py-32 px-6 sm:px-8 lg:px-10 max-w-7xl mx-auto w-full font-sans">
        <div className="grid gap-20">
          {EXAMPLES.map((ex, i) => (
            <motion.div
              key={ex.id}
              initial={{ opacity: 0, y: 32 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.7, delay: i * 0.05, ease: [0.16, 1, 0.3, 1] }}
              className="group"
            >
              <motion.div 
                className="p-12 rounded-[64px] border transition-all duration-500 flex flex-col lg:flex-row gap-16 items-center"
                style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}
                whileHover={{ borderColor: ex.color, boxShadow: `0 40px 80px -20px ${ex.color}10` }}
              >
                <div className="flex-1 space-y-10">
                   <div className="flex items-center gap-6">
                      <div 
                        className="w-20 h-20 rounded-[32px] flex items-center justify-center border transition-transform group-hover:scale-110 duration-500"
                        style={{ background: `${ex.color}10`, borderColor: `${ex.color}20` }}
                      >
                        <ex.icon size={40} style={{ color: ex.color }} />
                      </div>
                      <div className="space-y-2">
                         <div className="flex items-center gap-3">
                            <Badge variant="neutral" className="text-[8px] font-black uppercase tracking-widest">{ex.category}</Badge>
                            <div className="h-1 w-1 rounded-full bg-[var(--border-strong)]" />
                            <span className="text-[10px] font-black uppercase tracking-widest opacity-40">{ex.difficulty}</span>
                         </div>
                         <h2 className="m-0 text-4xl font-display font-black leading-tight text-[var(--text-primary)]">{ex.title}</h2>
                      </div>
                   </div>

                   <p className="text-xl leading-relaxed opacity-70 m-0">{ex.description}</p>

                   <div className="grid sm:grid-cols-2 gap-6">
                      {ex.what.map((point, j) => (
                        <div key={j} className="flex items-start gap-3">
                           <div className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0" style={{ background: ex.color }} />
                           <p className="text-sm opacity-60 m-0 leading-relaxed font-medium">{point}</p>
                        </div>
                      ))}
                   </div>
                </div>

                <div className="flex-1 w-full relative">
                   <div className="absolute inset-0 blur-3xl opacity-[0.03] pointer-events-none" style={{ background: ex.color }} />
                   <div className="relative p-10 rounded-[48px] bg-[var(--bg-overlay)] border border-[var(--border-subtle)] group-hover:border-[var(--border-strong)] transition-colors shadow-2xl font-mono text-sm leading-relaxed overflow-hidden">
                      <div className="absolute top-0 right-0 p-6 opacity-10">
                         <Terminal size={20} />
                      </div>
                      {ex.code.map((line, j) => (
                        <div key={j} className={line.startsWith('#') ? 'text-[var(--code-comment)] mb-2' : line.startsWith('pd') || line.startsWith('curl') ? 'text-[var(--text-primary)] font-bold mb-1' : 'opacity-40'}>
                          {line.startsWith('pd') || line.startsWith('curl') ? (
                            <span><span style={{ color: 'var(--brand-primary)' }}>$</span> {line}</span>
                          ) : line}
                        </div>
                      ))}
                   </div>
                </div>
              </motion.div>
            </motion.div>
          ))}
        </div>

        {/* Impressively long additional info */}
        <motion.div 
          className="mt-48 p-20 rounded-[80px] border border-dashed border-[var(--border-strong)] bg-gradient-to-br from-[var(--bg-surface)] to-[var(--bg-base)] flex flex-col items-center text-center gap-12 relative overflow-hidden"
          initial={{ opacity: 0, scale: 0.98 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
        >
           <div className="absolute top-0 right-0 p-10 opacity-[0.02] pointer-events-none">
              <Layers size={600} />
           </div>
           
           <div className="space-y-6 max-w-3xl relative z-10">
              <Badge variant="amber" className="px-6 py-2 text-[10px] font-black uppercase tracking-widest shadow-xl">Architectural Integrity</Badge>
              <h3 className="text-4xl sm:text-7xl font-display font-black tracking-tight leading-[0.95]" style={{ color: 'var(--text-primary)' }}>
                One Mesh. <span className="text-[var(--p-amber-400)]">Infinite Logic.</span>
              </h3>
              <p className="text-2xl leading-relaxed opacity-70">
                Port Daddy doesn't care about the intelligence of your agent. It cares about the **reliability of the mesh**. These patterns provide the hard infrastructure that allows soft logic to flourish.
              </p>
           </div>

           <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8 w-full max-w-6xl">
              {[
                { title: 'Atomic Identity', icon: Anchor },
                { title: 'Swarm Radio', icon: Zap },
                { title: 'Harbor Scopes', icon: Shield },
                { title: 'P2P Tunneling', icon: Globe }
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
