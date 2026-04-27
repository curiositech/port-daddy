import * as React from 'react'
import { motion, useScroll, useSpring } from 'framer-motion'
import { Badge } from '@/components/ui/Badge'
import { Surface } from '@/components/ui/Surface'
import {
  Shield, Zap, Anchor, MessageSquare, Box, Copy, Check,
  ShieldCheck, RefreshCw, Cpu, History
} from 'lucide-react'
import { Footer } from '@/components/layout/Footer'


/* ─── Documentation Data ─────────────────────────────────────────────────── */

interface DocSection {
  id: string
  title: string
  description: string
  icon: React.ElementType
  color: string
  commands: Array<{
    cmd: string
    desc: string
    example: string
  }>
}

const SECTIONS: DocSection[] = [
  {
    id: 'identity',
    title: 'Atomic Identity',
    description: 'The foundation of Port Daddy. Map semantic project:stack:context strings to deterministic ports.',
    icon: Anchor,
    color: 'var(--brand-secondary)',
    commands: [
      { cmd: 'pd claim <identity>', desc: 'Claim a stable port for an agent identity.', example: 'pd claim my-swarm:api:main' },
      { cmd: 'pd release <identity>', desc: 'Release a claim and free the port.', example: 'pd release my-swarm:api:main' },
      { cmd: 'pd find <identity>', desc: 'Locate an existing claim without re-assigning.', example: 'pd find my-swarm:api:main' }
    ]
  },
  {
    id: 'sessions',
    title: 'Sessions & Notes',
    description: 'Structured multi-agent coordination with immutable audit trails. Begin work, log progress, recover context.',
    icon: History,
    color: 'var(--brand-primary)',
    commands: [
      { cmd: 'pd begin <purpose>', desc: 'Start a new session with agent registration and port assignment.', example: 'pd begin "Refactor auth module" --identity myapp:api' },
      { cmd: 'pd note <message>', desc: 'Log an immutable progress note to the current session.', example: 'pd note "JWT middleware extracted, tests green"' },
      { cmd: 'pd done <summary>', desc: 'Complete the session, release resources, and archive notes.', example: 'pd done "Auth refactor complete with 100% test coverage"' }
    ]
  },
  {
    id: 'coordination',
    title: 'Swarm Radio',
    description: 'Low-latency pub/sub signaling for real-time inter-agent state synchronization.',
    icon: MessageSquare,
    color: 'var(--brand-accent)',
    commands: [
      { cmd: 'pd pub <channel> <msg>', desc: 'Broadcast a message to a named channel.', example: 'pd pub swarm:events "deploy-ready"' },
      { cmd: 'pd sub <channel>', desc: 'Subscribe to a real-time stream of events.', example: 'pd sub swarm:events' },
      { cmd: 'pd watch <channel>', desc: 'Execute a script whenever a message arrives.', example: 'pd watch build:done --exec ./test.sh' }
    ]
  },
  {
    id: 'locks',
    title: 'Distributed Locks',
    description: 'Mutual exclusion for shared resources. Prevent concurrent writes, coordinate database migrations.',
    icon: Zap,
    color: 'var(--brand-secondary)',
    commands: [
      { cmd: 'pd lock acquire <name>', desc: 'Acquire a named lock with optional TTL.', example: 'pd lock acquire db-migrations --ttl 300' },
      { cmd: 'pd lock release <name>', desc: 'Release a held lock.', example: 'pd lock release db-migrations' },
      { cmd: 'pd with-lock <name> <cmd>', desc: 'Run a command while holding a lock, auto-release on exit.', example: 'pd with-lock db-migrations npm run migrate' }
    ]
  },
  {
    id: 'salvage',
    title: 'Agent Salvage',
    description: 'When an agent crashes, its work is preserved. New agents can claim and continue dead agents\' sessions.',
    icon: RefreshCw,
    color: 'var(--brand-primary)',
    commands: [
      { cmd: 'pd salvage', desc: 'List all dead agents pending salvage with their preserved context.', example: 'pd salvage --project myapp' },
      { cmd: 'pd salvage claim <id>', desc: 'Claim a dead agent\'s work — inherit its session, notes, and file claims.', example: 'pd salvage claim agent-x7y9' },
      { cmd: 'pd agent register', desc: 'Register an agent with identity and purpose for crash recovery.', example: 'pd agent register --identity myapp:api --purpose "Auth refactor"' }
    ]
  },
  {
    id: 'security',
    title: 'Cryptographic Harbors',
    description: 'Enforce permission boundaries using HMAC-signed capability tokens (Harbor Cards).',
    icon: Shield,
    color: 'var(--brand-secondary)',
    commands: [
      { cmd: 'pd harbor create <name>', desc: 'Create a new namespace with scoped permissions.', example: 'pd harbor create security-team --cap "code:read"' },
      { cmd: 'pd harbor enter <name>', desc: 'Enter a harbor and receive an identity token.', example: 'pd harbor enter security-team' },
      { cmd: 'pd harbor list', desc: 'List all active cryptographic harbors.', example: 'pd harbor list' }
    ]
  },
  {
    id: 'agents',
    title: 'Agent Spawning',
    description: 'Launch AI agents through Port Daddy with automatic identity, session management, and crash recovery.',
    icon: Cpu,
    color: 'var(--brand-accent)',
    commands: [
      { cmd: 'pd spawn --backend <name>', desc: 'Spawn an AI agent with a specific backend (codex, ollama, claude-cli, etc) plus an explicit budget ceiling.', example: 'pd spawn --backend codex --tier low --identity myapp:fixer --budget 0.50 -- "Fix the login bug"' },
      { cmd: 'pd spawned', desc: 'List all spawned agents with status and duration.', example: 'pd spawned' },
      { cmd: 'pd spawn kill <id>', desc: 'Terminate a running spawned agent.', example: 'pd spawn kill spawned-8a2f' }
    ]
  },
]

function CommandCard({ cmd, desc, example, color }: { cmd: string; desc: string; example: string; color: string }) {
  const [copied, setCopied] = React.useState(false)
  const handleCopy = () => {
    navigator.clipboard.writeText(example)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Surface depth="raised" radius="3xl" padding="lg" interactive className="space-y-4 group flex flex-col items-center text-center p-5">
       <div className="space-y-3 w-full">
          <code className="text-xl font-bold font-mono block" style={{ color }}>{cmd}</code>
          <p className="text-sm leading-relaxed m-0 font-medium" style={{ color: 'var(--text-muted)' }}>{desc}</p>
       </div>

       {/* Inset code example with copy */}
       <div
         className="relative w-full rounded-[var(--radius-lg)] p-4 font-mono text-xs overflow-hidden"
         style={{
           background: 'var(--code-bg)',
           boxShadow: 'var(--shadow-inset)',
         }}
       >
          <div className="flex items-center justify-between gap-4">
             <div className="truncate">
               <span style={{ color: 'var(--code-prompt)' }}>$ </span>
               <span style={{ color: 'var(--code-text)' }}>{example}</span>
             </div>
             <button
               onClick={handleCopy}
               className="shrink-0 cursor-pointer opacity-40 group-hover:opacity-100 transition-opacity"
               style={{ color: 'var(--code-dot-green)' }}
             >
                {copied ? <Check size={14} /> : <Copy size={14} />}
             </button>
          </div>
       </div>
    </Surface>
  )
}

export default function DocsPage() {
  const { scrollYProgress } = useScroll()
  const scaleX = useSpring(scrollYProgress, {
    stiffness: 100,
    damping: 30,
    restDelta: 0.001
  })

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="min-h-screen flex flex-col font-sans selection:bg-[var(--brand-primary)] selection:text-white"
      style={{ background: 'var(--surface-base)' }}
    >
      <motion.div
        className="fixed top-16 left-0 right-0 h-1 bg-[var(--brand-primary)] z-[100] origin-left"
        style={{ scaleX }}
      />

      {/* Hero Section */}
      <motion.section
        className="py-12 lg:py-16 px-6 lg:px-8 border-b relative overflow-hidden"
        style={{ background: 'var(--surface-raised)', borderColor: 'var(--border-subtle)' }}
      >
        <motion.div
          className="absolute top-0 right-0 w-[600px] h-[600px] rounded-full blur-[140px] opacity-[0.1] pointer-events-none"
          style={{ background: 'radial-gradient(circle, var(--brand-primary) 0%, transparent 70%)' }}
        />

        <motion.div className="max-w-7xl mx-auto text-center relative z-10 flex flex-col items-center gap-6">
           <Badge variant="teal" className="px-6 py-2 text-[10px] font-black uppercase tracking-[0.25em]">Protocol Reference</Badge>
           <motion.h1
             className="text-6xl sm:text-9xl font-black tracking-tighter font-display leading-[0.9]"
             initial={{ opacity: 0, y: 32 }}
             animate={{ opacity: 1, y: 0 }}
             transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
           >
             The <motion.span className="text-[var(--brand-primary)]">SDK Manual.</motion.span>
           </motion.h1>
           <motion.p
             className="text-2xl sm:text-3xl max-w-3xl leading-relaxed text-[var(--text-secondary)] font-medium"
             initial={{ opacity: 0, y: 20 }}
             animate={{ opacity: 1, y: 0 }}
             transition={{ duration: 0.8, delay: 0.1 }}
           >
             Seven primitives that give your agent swarm atomic identity, coordination, resilience, and security. Every one is a single CLI command.
           </motion.p>
        </motion.div>
      </motion.section>

      {/* Main Content */}
      <motion.main id="main-content" className="flex-1 py-10 lg:py-14 px-6 lg:px-8 max-w-7xl mx-auto w-full font-sans">
        <motion.div className="space-y-20 flex flex-col items-center">
          {SECTIONS.map((section) => (
            <motion.section
              key={section.id}
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
              id={section.id}
              className="space-y-10 flex flex-col items-center w-full"
            >
               <div className="flex flex-col items-center text-center gap-6 border-b border-[var(--border-subtle)] pb-10 w-full">
                  <div className="max-w-2xl flex flex-col items-center gap-5">
                     <div className="flex flex-col items-center gap-4">
                        <Surface depth="inset" radius="2xl" padding="none" className="w-16 h-16 flex items-center justify-center">
                           <section.icon size={32} style={{ color: section.color }} />
                        </Surface>
                        <h2 className="text-2xl sm:text-4xl font-display font-black tracking-tight m-0" style={{ color: 'var(--text-primary)' }}>{section.title}</h2>
                     </div>
                     <p className="text-xl sm:text-2xl leading-relaxed m-0 font-medium" style={{ color: 'var(--text-secondary)' }}>
                        {section.description}
                     </p>
                  </div>
                  <Badge variant="default" className="px-6 py-2 text-[10px] font-black uppercase tracking-widest">Core Primitive</Badge>
               </div>

               <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 w-full">
                  {section.commands.map((cmd, j) => (
                    <CommandCard key={j} {...cmd} color={section.color} />
                  ))}
               </div>
            </motion.section>
          ))}
        </motion.div>

        {/* Bottom panel */}
        <Surface depth="raised" radius="4xl" padding="xl" className="mt-16 flex flex-col items-center text-center gap-5 relative overflow-hidden p-6">

           <div className="space-y-4 max-w-3xl relative z-10 flex flex-col items-center">
              <Badge variant="gold" className="px-6 py-2 text-[10px] font-black uppercase tracking-widest">Architectural Integrity</Badge>
              <h3 className="text-2xl sm:text-4xl font-display font-black tracking-tight leading-[0.95]" style={{ color: 'var(--text-primary)' }}>
                System <span className="text-[var(--brand-accent)]">Soundness.</span>
              </h3>
              <p className="text-lg leading-relaxed text-[var(--text-secondary)]">
                Port Daddy is built on a foundation of formal verification. We ensure that every command follows strictly defined state transitions, preventing "zombie" processes and unauthorized port claims across your entire swarm.
              </p>
           </div>

           <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 w-full">
              {[
                { label: 'Unix Socket Native', icon: Zap },
                { label: 'HMAC Handshake', icon: Shield },
                { label: 'SQLite Persistent', icon: Box },
                { label: 'Formal Verified', icon: ShieldCheck }
              ].map((item, i) => (
                <Surface key={i} depth="inset" radius="3xl" padding="lg" className="flex flex-col items-center gap-4 p-5">
                   <item.icon size={24} className="text-[var(--brand-primary)]" />
                   <span className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)]">{item.label}</span>
                </Surface>
              ))}
           </div>
        </Surface>
      </motion.main>

      <Footer />
    </motion.div>
  )
}
