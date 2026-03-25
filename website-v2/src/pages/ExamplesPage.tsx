import { motion } from 'framer-motion'
import { Badge } from '@/components/ui/Badge'
import { Sparkles, Shield, Terminal, Layers, Anchor, Zap, Globe, Radio, Users, Search } from 'lucide-react'
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
    id: 'multi-agent-coordination',
    title: 'Multi-Agent Coordination',
    category: 'Sessions',
    difficulty: 'Beginner',
    description: 'Register agents, claim files, and use sessions to coordinate work across multiple AI agents on the same project.',
    what: [
      'Register agents with semantic identities',
      'Claim files to prevent edit conflicts',
      'Session notes create an immutable audit trail',
      'Salvage picks up where crashed agents left off'
    ],
    code: [
      '# Start a coordinated session',
      'pd begin --identity myapp:api --purpose "Build auth"',
      '',
      '# Claim files you are working on',
      'pd session files claim src/auth.ts src/routes.ts',
      '',
      '# Leave notes for other agents',
      'pd note "Added JWT validation middleware"',
      '',
      '# End session when done',
      'pd done'
    ],
    icon: Users,
    color: 'var(--p-teal-400)'
  },
  {
    id: 'pub-sub-signaling',
    title: 'Pub/Sub Swarm Radio',
    category: 'Messaging',
    difficulty: 'Intermediate',
    description: 'Use named radio channels for real-time inter-agent signaling. Publish events and subscribe to triggers across your swarm.',
    what: [
      'Publish structured messages to named channels',
      'Subscribe via SSE for real-time delivery',
      'pd watch triggers scripts on new messages',
      'Channels are ephemeral and low-overhead'
    ],
    code: [
      '# Publish a build result',
      'pd pub build-results "tests passed, 42/42"',
      '',
      '# Watch channel and trigger script',
      'pd watch build-results --exec "./deploy.sh"',
      '',
      '# Subscribe via SSE (programmatic)',
      'curl -N http://localhost:9876/subscribe/build-results'
    ],
    icon: Radio,
    color: 'var(--p-amber-400)'
  },
  {
    id: 'spawn-agent-fleet',
    title: 'Spawn Agent Fleets',
    category: 'Orchestration',
    difficulty: 'Advanced',
    description: 'Launch AI agent fleets with Port Daddy coordination auto-wired. Sessions, heartbeats, notes, and salvage are all automatic.',
    what: [
      'Spawn Ollama, Claude, Gemini, or Aider agents',
      'Coordination (sessions, heartbeats) auto-wired',
      'List and kill spawned agents from the CLI',
      'Dead agents enter the salvage queue automatically'
    ],
    code: [
      '# Spawn an Ollama agent with coordination',
      'pd spawn --backend ollama --model llama3.2:8b \\',
      '  --identity myapp:coder -- "Fix the login bug"',
      '',
      '# List running agents',
      'pd spawned',
      '',
      '# Check for dead agents to salvage',
      'pd salvage --project myapp'
    ],
    icon: Sparkles,
    color: 'var(--p-blue-400)'
  },
  {
    id: 'semantic-discovery',
    title: 'Semantic DNS Discovery',
    category: 'Discovery',
    difficulty: 'Beginner',
    description: 'Claim semantic identities and resolve services by name instead of port number. No more hardcoding localhost:3000.',
    what: [
      'Deterministic port hashing from identity strings',
      'DNS resolution by semantic name',
      'Zero reconfiguration when ports change',
      'Works with pd claim or pd begin'
    ],
    code: [
      '# Claim a semantic identity',
      'pd claim myapp:api',
      '# → Port 3847 assigned to myapp:api',
      '',
      '# Resolve from another agent',
      'pd find myapp:api',
      '# → {"port": 3847, "identity": "myapp:api"}',
      '',
      '# DNS lookup',
      'pd dns resolve myapp:api'
    ],
    icon: Search,
    color: 'var(--p-green-400)'
  },
  {
    id: 'distributed-locks',
    title: 'Distributed Locks',
    category: 'Coordination',
    difficulty: 'Intermediate',
    description: 'Use advisory locks to prevent concurrent access to shared resources. TTL-based auto-expiry prevents deadlocks from crashed agents.',
    what: [
      'Acquire named locks with configurable TTL',
      'Locks auto-expire to prevent deadlocks',
      'Extend TTL while holding the lock',
      'pd with-lock wraps any command safely'
    ],
    code: [
      '# Acquire a lock with 60s TTL',
      'pd lock db-migration --ttl 60000',
      '',
      '# Run a command under lock (sugar)',
      'pd with-lock db-migration -- npm run migrate',
      '',
      '# List active locks',
      'pd locks',
      '',
      '# Release when done',
      'pd unlock db-migration'
    ],
    icon: Shield,
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
        className="py-20 px-6 sm:px-8 lg:px-10 border-b relative overflow-hidden flex flex-col items-center justify-center text-center" 
        style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
      >
        <motion.div 
          className="absolute top-0 right-0 w-[800px] h-[800px] rounded-full blur-[160px] opacity-[0.1] pointer-events-none" 
          style={{ background: 'radial-gradient(circle, var(--brand-primary) 0%, transparent 70%)' }} 
        />
        
        <div className="max-w-5xl mx-auto relative z-10 flex flex-col items-center gap-8">
           <Badge variant="teal" className="px-8 py-3 text-[10px] font-black uppercase tracking-[0.25em] shadow-xl">The Coordination Library</Badge>
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
             Stop reinventing coordination. Use these production-grade patterns for multi-agent orchestration, discovery, and resilience.
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
                className="p-16 rounded-[80px] border transition-all duration-500 flex flex-col lg:flex-row gap-8 items-center"
                style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}
                whileHover={{ borderColor: ex.color, boxShadow: `0 40px 80px -20px ${ex.color}15` }}
              >
                <div className="flex-1 space-y-8 flex flex-col items-center lg:items-start text-center lg:text-left">
                   <div className="flex flex-col lg:flex-row items-center gap-8">
                      <motion.div 
                        className="w-24 h-24 rounded-[40px] flex items-center justify-center border transition-transform group-hover:scale-110 duration-500 shadow-xl"
                        style={{ background: `${ex.color}10`, borderColor: `${ex.color}20` }}
                      >
                        <ex.icon size={48} style={{ color: ex.color }} />
                      </motion.div>
                      <div className="space-y-3 flex flex-col items-center lg:items-start">
                         <div className="flex items-center gap-4">
                            <Badge variant="neutral" className="text-[10px] font-black uppercase tracking-widest px-4 py-1.5 shadow-sm">
                               <span className="text-[var(--text-primary)]">{ex.category}</span>
                            </Badge>
                            <div className="h-1 w-1 rounded-full bg-[var(--border-strong)]" />
                            <motion.span className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)]">{ex.difficulty}</motion.span>
                         </div>
                         <motion.h2 className="m-0 text-4xl sm:text-6xl font-display font-black tracking-tight leading-tight text-[var(--text-primary)]">{ex.title}</motion.h2>
                      </div>
                   </div>

                   <motion.p className="text-xl sm:text-2xl leading-relaxed text-[var(--text-secondary)] m-0 max-w-xl">{ex.description}</motion.p>

                   <div className="grid sm:grid-cols-2 gap-8 w-full">
                      {ex.what.map((point, j) => (
                        <motion.div key={j} className="flex items-start gap-4 group/item">
                           <div className="mt-2 w-2 h-2 rounded-full shrink-0 group-hover/item:scale-150 transition-transform shadow-xl" style={{ background: ex.color }} />
                           <motion.p className="text-base text-[var(--text-secondary)] m-0 leading-relaxed font-bold group-hover/item:text-[var(--text-primary)] transition-colors">{point}</motion.p>
                        </motion.div>
                      ))}
                   </div>
                </div>

                <div className="flex-1 w-full relative max-w-2xl">
                   <motion.div className="absolute inset-0 blur-3xl opacity-[0.05] pointer-events-none" style={{ background: ex.color }} />
                   <motion.div className="relative p-12 rounded-[64px] bg-[var(--bg-overlay)] border border-[var(--border-strong)] group-hover:border-[var(--brand-primary)]/40 transition-colors shadow-2xl font-mono text-base leading-relaxed overflow-hidden">
                      <div className="absolute top-0 right-0 p-8 opacity-10">
                         <Terminal size={24} className="text-[var(--text-primary)]" />
                      </div>
                      {ex.code.map((line, j) => (
                        <div key={j} className={line.startsWith('#') ? 'text-[var(--text-muted)] mb-3 opacity-40' : line.startsWith('pd') || line.startsWith('curl') ? 'text-[var(--text-primary)] font-bold mb-2' : 'text-[var(--text-secondary)] opacity-60'}>
                          {line.startsWith('pd') || line.startsWith('curl') ? (
                            <span><span style={{ color: 'var(--brand-primary)' }}>$</span> {line}</span>
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
          className="mt-20 p-24 rounded-[100px] border border-dashed border-[var(--border-strong)] bg-gradient-to-br from-[var(--bg-surface)] to-[var(--bg-base)] flex flex-col items-center text-center gap-8 relative overflow-hidden w-full shadow-2xl mx-auto"
          initial={{ opacity: 0, scale: 0.98 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
        >
           <div className="absolute top-0 right-0 p-10 opacity-[0.02] pointer-events-none">
              <Layers size={800} />
           </div>
           
           <div className="max-w-4xl relative z-10 space-y-10 flex flex-col items-center">
              <Badge variant="amber" className="px-8 py-3 text-[10px] font-black uppercase tracking-widest shadow-xl">Architectural Integrity</Badge>
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
                <motion.div key={i} className="p-10 rounded-[48px] bg-[var(--bg-overlay)] border border-[var(--border-subtle)] flex flex-col items-center gap-6 group hover:border-[var(--brand-primary)] transition-all shadow-xl">
                   <motion.div className="w-14 h-14 rounded-2xl bg-[var(--bg-surface)] flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
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
