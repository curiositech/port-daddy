import { motion } from 'framer-motion'
import { Badge } from '@/components/ui/Badge'
import { Surface } from '@/components/ui/Surface'
import { CommandTerminal } from '@/components/ui/CommandTerminal'
import { Sparkles, Shield, Layers, Anchor, Zap, Globe, Radio, Users, Search, type LucideIcon } from 'lucide-react'
import { Footer } from '@/components/layout/Footer'

interface Example {
  id: string
  title: string
  category: string
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced'
  description: string
  what: string[]
  code: string[]
  icon: LucideIcon
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
    color: 'var(--brand-secondary)'
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
      'curl -N http://localhost:9876/msg/build-results/subscribe'
    ],
    icon: Radio,
    color: 'var(--brand-accent)'
  },
  {
    id: 'spawn-agent-fleet',
    title: 'Spawn Agent Fleets',
    category: 'Orchestration',
    difficulty: 'Advanced',
    description: 'Launch AI agent fleets with Port Daddy coordination auto-wired. Sessions, heartbeats, notes, and salvage are all automatic.',
    what: [
      'Spawn Ollama, Codex, Claude, Gemini, or Aider agents',
      'Coordination (sessions, heartbeats) auto-wired',
      'List and kill spawned agents from the CLI',
      'Dead agents enter the salvage queue automatically'
    ],
    code: [
      '# Spawn an Ollama agent with coordination',
      'pd spawn --backend ollama --model qwen2.5-coder:7b \\',
      '  --identity myapp:coder --budget 0.50 -- "Fix the login bug"',
      '',
      '# List running agents',
      'pd spawned',
      '',
      '# Check for dead agents to salvage',
      'pd salvage --project myapp'
    ],
    icon: Sparkles,
    color: 'var(--brand-secondary)'
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
      'pd dns lookup myapp:api'
    ],
    icon: Search,
    color: 'var(--status-success)'
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
    color: 'var(--brand-accent)'
  }
]

export function ExamplesPage() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="min-h-screen flex flex-col font-sans selection:bg-[var(--brand-primary)] selection:text-white"
      style={{ background: 'var(--surface-base)' }}
    >
      {/* Hero Section */}
      <Surface depth="raised" radius="none" padding="none" className="py-14 px-6 sm:px-8 lg:px-10 relative overflow-hidden flex flex-col items-center justify-center text-center">

        <motion.div
          className="absolute top-0 right-0 w-[800px] h-[800px] rounded-full blur-[160px] opacity-[0.1] pointer-events-none"
          style={{ background: 'radial-gradient(circle, var(--brand-primary) 0%, transparent 70%)' }}
        />

        <div className="max-w-5xl mx-auto relative z-10 flex flex-col items-center gap-5">
           <Badge variant="teal" className="px-6 py-2 text-[10px] font-black uppercase tracking-[0.25em]">The Coordination Library</Badge>
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
      </Surface>

      {/* Examples Grid */}
      <motion.main id="main-content" className="flex-1 py-12 px-6 sm:px-8 lg:px-10 max-w-7xl mx-auto w-full font-sans flex flex-col items-center">
        <div className="grid gap-5 w-full">
          {EXAMPLES.map((ex, i) => (
            <motion.div
              key={ex.id}
              initial={{ opacity: 0, y: 48 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.7, delay: i * 0.05, ease: [0.16, 1, 0.3, 1] }}
              className="group"
            >
              <Surface depth="raised" radius="2xl" padding="none" className="p-6 transition-all duration-500 flex flex-col lg:flex-row gap-5 items-center">

                <div className="flex-1 space-y-5 flex flex-col items-center lg:items-start text-center lg:text-left">
                   <div className="flex flex-col lg:flex-row items-center gap-5">
                      <motion.div
                        className="w-24 h-24 rounded-2xl flex items-center justify-center transition-transform group-hover:scale-110 duration-500"
                        style={{ background: `${ex.color}10`, boxShadow: 'var(--shadow-inset)' }}
                      >
                        <ex.icon size={48} style={{ color: ex.color }} />
                      </motion.div>
                      <div className="space-y-3 flex flex-col items-center lg:items-start">
                         <div className="flex items-center gap-4">
                            <Badge variant="default" className="text-[10px] font-black uppercase tracking-widest px-4 py-1.5">
                               <span className="text-[var(--text-primary)]">{ex.category}</span>
                            </Badge>
                            <div className="h-1 w-1 rounded-full" style={{ background: 'var(--text-muted)' }} />
                            <motion.span className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)]">{ex.difficulty}</motion.span>
                         </div>
                         <motion.h2 className="m-0 text-2xl sm:text-4xl font-display font-black tracking-tight leading-tight text-[var(--text-primary)]">{ex.title}</motion.h2>
                      </div>
                   </div>

                   <motion.p className="text-xl sm:text-2xl leading-relaxed text-[var(--text-secondary)] m-0 max-w-xl">{ex.description}</motion.p>

                   <div className="grid sm:grid-cols-2 gap-4 w-full">
                      {ex.what.map((point, j) => (
                        <motion.div key={j} className="flex items-start gap-4 group/item">
                           <div className="mt-2 w-2 h-2 rounded-full shrink-0 group-hover/item:scale-150 transition-transform" style={{ background: ex.color }} />
                           <motion.p className="text-base text-[var(--text-secondary)] m-0 leading-relaxed font-bold group-hover/item:text-[var(--text-primary)] transition-colors">{point}</motion.p>
                        </motion.div>
                      ))}
                   </div>
                </div>

                <div className="flex-1 w-full relative max-w-2xl">
                   <CommandTerminal
                     code={ex.code.map(line =>
                       (line.startsWith('pd') || line.startsWith('curl')) ? `$ ${line}` :
                       line.startsWith('#') ? line :
                       `  ${line}`
                     ).join('\n')}
                     title={ex.title}
                     typewriterSpeed={0}
                   />
                </div>
              </Surface>
            </motion.div>
          ))}
        </div>

        {/* Vision Callout */}
        <Surface depth="raised" radius="2xl" padding="none" className="mt-14 overflow-hidden w-full mx-auto">
          <motion.div
            className="p-6 flex flex-col items-center text-center gap-5 relative"
            initial={{ opacity: 0, scale: 0.98 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
          >
           <div className="absolute top-0 right-0 p-10 opacity-[0.02] pointer-events-none">
              <Layers size={800} />
           </div>

           <div className="max-w-4xl relative z-10 space-y-6 flex flex-col items-center">
              <Badge variant="gold" className="px-6 py-2 text-[11px] font-black uppercase tracking-widest">Infrastructure, Not Orchestration</Badge>
              <motion.h3 className="text-2xl sm:text-4xl font-display font-black tracking-tight leading-[0.95] m-0 text-[var(--text-primary)]">
                You write the agents. <br />
                <span className="text-[var(--brand-accent)]">We keep them from colliding.</span>
              </motion.h3>
              <motion.p className="text-xl sm:text-2xl leading-relaxed text-[var(--text-secondary)] max-w-3xl">
                Port Daddy handles ports, locks, messaging, and crash recovery so your agents can focus on the task. These patterns show how real teams coordinate without stepping on each other.
              </motion.p>
           </div>

           <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 w-full max-w-6xl relative z-10">
              {[
                { title: 'Atomic Identity', icon: Anchor },
                { title: 'Swarm Radio', icon: Zap },
                { title: 'Harbor Scopes', icon: Shield },
                { title: 'P2P Tunneling', icon: Globe }
              ].map((item, i) => (
                <motion.div
                  key={i}
                  className="p-6 rounded-2xl flex flex-col items-center gap-4 group transition-all"
                  style={{ background: 'var(--surface-raised)', boxShadow: 'var(--shadow-sm)' }}
                >
                   <Surface depth="inset" radius="2xl" padding="none" className="w-14 h-14 flex items-center justify-center group-hover:scale-110 transition-transform">
                      <item.icon size={28} className="text-[var(--brand-primary)]" />
                   </Surface>
                   <motion.span className="text-[10px] font-black uppercase tracking-[0.25em] text-[var(--text-muted)] group-hover:text-[var(--text-primary)] transition-colors text-center">{item.title}</motion.span>
                </motion.div>
              ))}
           </div>
          </motion.div>
        </Surface>
      </motion.main>

      <Footer />
    </motion.div>
  )
}
