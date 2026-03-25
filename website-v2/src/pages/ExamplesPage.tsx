import { motion } from 'framer-motion'
import { Badge } from '@/components/ui/Badge'
import { Sparkles, Shield, RefreshCw, DollarSign, Database, Terminal, Layers, Anchor, Zap, Globe } from 'lucide-react'
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
      className="min-h-screen flex flex-col pt-[var(--nav-height)] font-sans selection:bg-[var(--brand-primary)] selection:text-white"
      style={{ background: 'var(--surface-base)' }}
    >
      {/* Hero Section */}
      <motion.section
        className="py-20 px-6 sm:px-8 lg:px-10 relative overflow-hidden flex flex-col items-center justify-center text-center"
        style={{ background: 'var(--surface-raised)', boxShadow: 'var(--shadow-raised)' }}
      >
        <motion.div
          className="absolute top-0 right-0 w-[800px] h-[800px] rounded-full blur-[160px] opacity-[0.1] pointer-events-none"
          style={{ background: 'radial-gradient(circle, var(--brand-primary) 0%, transparent 70%)' }}
        />

        <div className="max-w-5xl mx-auto relative z-10 flex flex-col items-center gap-8">
           <Badge variant="teal" className="px-8 py-3 text-[10px] font-black uppercase tracking-[0.25em]">The Coordination Library</Badge>
           <motion.h1
             className="text-4xl sm:text-6xl font-black tracking-tighter font-display leading-[0.85] m-0 text-[var(--text-primary)]"
             initial={{ opacity: 0, y: 32 }}
             animate={{ opacity: 1, y: 0 }}
             transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
           >
             Proven <br />
             <span className="text-[var(--brand-primary)]">Patterns.</span>
           </motion.h1>
           <motion.p
             className="text-xl sm:text-2xl max-w-4xl leading-relaxed text-[var(--text-secondary)] font-medium"
             initial={{ opacity: 0, y: 20 }}
             animate={{ opacity: 1, y: 0 }}
             transition={{ duration: 0.8, delay: 0.1 }}
           >
             Stop reinventing discovery. Use these production-grade coordination blueprints for LangChain, CrewAI, and beyond.
           </motion.p>
        </div>
      </motion.section>

      {/* Examples Grid */}
      <motion.main className="flex-1 py-20 px-6 sm:px-8 lg:px-10 max-w-7xl mx-auto w-full font-sans flex flex-col items-center">
        <div className="grid gap-8 w-full">
          {EXAMPLES.map((ex, i) => (
            <motion.div
              key={ex.id}
              initial={{ opacity: 0, y: 48 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.7, delay: i * 0.05, ease: [0.16, 1, 0.3, 1] }}
              className="group"
            >
              <motion.div
                className="p-16 rounded-2xl transition-all duration-500 flex flex-col lg:flex-row gap-8 items-center"
                style={{ background: 'var(--surface-raised)', boxShadow: 'var(--shadow-raised)' }}
                whileHover={{ boxShadow: `var(--shadow-raised), 0 40px 80px -20px ${ex.color}15` }}
              >
                <div className="flex-1 space-y-8 flex flex-col items-center lg:items-start text-center lg:text-left">
                   <div className="flex flex-col lg:flex-row items-center gap-8">
                      <motion.div
                        className="w-24 h-24 rounded-2xl flex items-center justify-center transition-transform group-hover:scale-110 duration-500"
                        style={{ background: `${ex.color}10`, boxShadow: 'var(--shadow-inset)' }}
                      >
                        <ex.icon size={48} style={{ color: ex.color }} />
                      </motion.div>
                      <div className="space-y-3 flex flex-col items-center lg:items-start">
                         <div className="flex items-center gap-4">
                            <Badge variant="neutral" className="text-[10px] font-black uppercase tracking-widest px-4 py-1.5">
                               <span className="text-[var(--text-primary)]">{ex.category}</span>
                            </Badge>
                            <div className="h-1 w-1 rounded-full" style={{ background: 'var(--text-muted)' }} />
                            <motion.span className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)]">{ex.difficulty}</motion.span>
                         </div>
                         <motion.h2 className="m-0 text-4xl sm:text-6xl font-display font-black tracking-tight leading-tight text-[var(--text-primary)]">{ex.title}</motion.h2>
                      </div>
                   </div>

                   <motion.p className="text-xl sm:text-2xl leading-relaxed text-[var(--text-secondary)] m-0 max-w-xl">{ex.description}</motion.p>

                   <div className="grid sm:grid-cols-2 gap-8 w-full">
                      {ex.what.map((point, j) => (
                        <motion.div key={j} className="flex items-start gap-4 group/item">
                           <div className="mt-2 w-2 h-2 rounded-full shrink-0 group-hover/item:scale-150 transition-transform" style={{ background: ex.color }} />
                           <motion.p className="text-base text-[var(--text-secondary)] m-0 leading-relaxed font-bold group-hover/item:text-[var(--text-primary)] transition-colors">{point}</motion.p>
                        </motion.div>
                      ))}
                   </div>
                </div>

                <div className="flex-1 w-full relative max-w-2xl">
                   <motion.div className="absolute inset-0 blur-3xl opacity-[0.05] pointer-events-none" style={{ background: ex.color }} />
                   <motion.div
                     className="relative p-12 rounded-2xl font-mono text-base leading-relaxed overflow-hidden"
                     style={{ background: 'var(--code-bg)', boxShadow: 'var(--shadow-inset)', borderRadius: 'var(--radius-lg)' }}
                   >
                      <div className="absolute top-0 right-0 p-8 opacity-10">
                         <Terminal size={24} className="text-[var(--text-primary)]" />
                      </div>
                      {ex.code.map((line, j) => (
                        <div key={j} className={line.startsWith('#') ? 'text-[var(--text-muted)] mb-3 opacity-40' : line.startsWith('pd') || line.startsWith('curl') ? 'text-[var(--code-text)] font-bold mb-2' : 'text-[var(--text-secondary)] opacity-60'}>
                          {line.startsWith('pd') || line.startsWith('curl') ? (
                            <span><span style={{ color: 'var(--code-prompt)' }}>$</span> {line}</span>
                          ) : line}
                        </div>
                      ))}
                   </motion.div>
                </div>
              </motion.div>
            </motion.div>
          ))}
        </div>

        {/* Vision Callout */}
        <motion.div
          className="mt-20 p-24 rounded-2xl flex flex-col items-center text-center gap-8 relative overflow-hidden w-full mx-auto"
          style={{ background: 'var(--surface-raised)', boxShadow: 'var(--shadow-raised)' }}
          initial={{ opacity: 0, scale: 0.98 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
        >
           <div className="absolute top-0 right-0 p-10 opacity-[0.02] pointer-events-none">
              <Layers size={800} />
           </div>

           <div className="max-w-4xl relative z-10 space-y-10 flex flex-col items-center">
              <Badge variant="amber" className="px-8 py-3 text-[10px] font-black uppercase tracking-widest">Architectural Integrity</Badge>
              <motion.h3 className="text-4xl sm:text-6xl font-display font-black tracking-tight leading-[0.95] m-0 text-[var(--text-primary)]">
                One Mesh. <br />
                <span className="text-[var(--p-amber-400)]">Infinite Logic.</span>
              </motion.h3>
              <motion.p className="text-xl sm:text-2xl leading-relaxed text-[var(--text-secondary)] max-w-3xl">
                Port Daddy doesn't care about the intelligence of your agent. It cares about the **reliability of the mesh**. These patterns provide the hard infrastructure that allows soft logic to flourish.
              </motion.p>
           </div>

           <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8 w-full max-w-6xl relative z-10">
              {[
                { title: 'Atomic Identity', icon: Anchor },
                { title: 'Swarm Radio', icon: Zap },
                { title: 'Harbor Scopes', icon: Shield },
                { title: 'P2P Tunneling', icon: Globe }
              ].map((item, i) => (
                <motion.div
                  key={i}
                  className="p-10 rounded-2xl flex flex-col items-center gap-6 group transition-all"
                  style={{ background: 'var(--surface-raised)', boxShadow: 'var(--shadow-sm)' }}
                >
                   <motion.div
                     className="w-14 h-14 rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform"
                     style={{ background: 'var(--surface-sunken)', boxShadow: 'var(--shadow-inset)' }}
                   >
                      <item.icon size={28} className="text-[var(--brand-primary)]" />
                   </motion.div>
                   <motion.span className="text-[10px] font-black uppercase tracking-[0.25em] text-[var(--text-muted)] group-hover:text-[var(--text-primary)] transition-colors text-center">{item.title}</motion.span>
                </motion.div>
              ))}
           </div>
        </motion.div>
      </motion.main>

      <Footer />
    </motion.div>
  )
}
