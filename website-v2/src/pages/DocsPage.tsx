import * as React from 'react'
import { motion, useScroll, useSpring } from 'framer-motion'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
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
  tone: 'primary' | 'secondary' | 'accent'
  commands: Array<{
    cmd: string
    desc: string
    example: string
  }>
}

const toneTextClass: Record<DocSection['tone'], string> = {
  primary: 'text-[var(--brand-primary)]',
  secondary: 'text-[var(--brand-secondary)]',
  accent: 'text-[var(--brand-accent)]',
}

const SECTIONS: DocSection[] = [
  {
    id: 'identity',
    title: 'Atomic Identity',
    description: 'The foundation. A semantic project:stack:context string is the agent — call the same identity twice, get the same port. Idempotent on purpose: a restart should not rename the world.',
    icon: Anchor,
    tone: 'secondary',
    commands: [
      { cmd: 'pd claim <identity>', desc: 'Claim a stable port for an agent identity.', example: 'pd claim myapp:api:main' },
      { cmd: 'pd release <identity>', desc: 'Release a claim and free the port.', example: 'pd release myapp:api:main' },
      { cmd: 'pd find <identity>', desc: 'Locate an existing claim without re-assigning.', example: 'pd find myapp:api:main' }
    ]
  },
  {
    id: 'sessions',
    title: 'Sessions & Notes',
    description: 'How agents leave a paper trail. Begin a session, log notes as work goes, hand off or wrap up at the end. The notes are immutable on purpose — you cannot retroactively edit yesterday into something more flattering.',
    icon: History,
    tone: 'primary',
    commands: [
      { cmd: 'pd begin <purpose>', desc: 'Start a new durable work session with agent registration and port assignment.', example: 'pd begin "Refactor auth module" --identity myapp:api --lifecycle durable' },
      { cmd: 'pd note <message>', desc: 'Log an immutable progress note to the current session.', example: 'pd note "JWT middleware extracted, tests green"' },
      { cmd: 'pd done <summary>', desc: 'Complete the session, release resources, and archive notes.', example: 'pd done "Auth refactor complete with 100% test coverage"' }
    ]
  },
  {
    id: 'coordination',
    title: 'Project Channels',
    description: 'Pub/sub the way mailroom intercoms used to work — a named channel anyone in the project can shout into and anyone can listen on. Lower-overhead than a queue, harder to lose than chat.',
    icon: MessageSquare,
    tone: 'accent',
    commands: [
      { cmd: 'pd pub <channel> <msg>', desc: 'Broadcast a message to a named channel.', example: 'pd pub git:committed "deploy-ready"' },
      { cmd: 'pd sub <channel>', desc: 'Subscribe to a real-time stream of events.', example: 'pd sub git:committed' },
      { cmd: 'pd watch <channel>', desc: 'Execute a script whenever a message arrives.', example: 'pd watch git:committed --exec ./test.sh' }
    ]
  },
  {
    id: 'locks',
    title: 'Distributed Locks',
    description: 'Plain old mutual exclusion. Two agents both try to migrate the database; one of them waits. Locks here are TTL-bound — a dead agent cannot hold the keys forever.',
    icon: Zap,
    tone: 'secondary',
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
    tone: 'primary',
    commands: [
      { cmd: 'pd salvage', desc: 'List all dead agents pending salvage with their preserved context.', example: 'pd salvage --project myapp' },
      { cmd: 'pd salvage claim <id>', desc: 'Claim a dead agent\'s work — inherit its session, notes, and file claims.', example: 'pd salvage claim agent-x7y9' },
      { cmd: 'pd agent register', desc: 'Register an agent with identity and purpose for crash recovery.', example: 'pd agent register --identity myapp:api --purpose "Auth refactor"' }
    ]
  },
  {
    id: 'security',
    title: 'Cryptographic Harbors',
    description: 'Capability fences. A harbor names a small permission boundary; an agent enters with a token; the token says exactly what they may do and for how long. Inspired by Capsicum and CHERI more than ACLs.',
    icon: Shield,
    tone: 'secondary',
    commands: [
      { cmd: 'pd harbor create <name>', desc: 'Create a new namespace with scoped permissions.', example: 'pd harbor create security-team --cap "code:read"' },
      { cmd: 'pd harbor enter <name>', desc: 'Enter a harbor and receive an identity token.', example: 'pd harbor enter security-team' },
      { cmd: 'pd harbor list', desc: 'List all active cryptographic harbors.', example: 'pd harbor list' }
    ]
  },
  {
    id: 'agents',
    title: 'Agent Spawning',
    description: 'Hand a prompt to Port Daddy and Port Daddy hands an agent back to you. Identity, session, budget cap, salvage hook — all wired in. The agent inherits a guest pass, not the master key.',
    icon: Cpu,
    tone: 'accent',
    commands: [
      { cmd: 'pd spawn --backend <name>', desc: 'Spawn an AI agent with a specific backend (codex, ollama, claude-cli, etc) plus an explicit budget ceiling.', example: 'pd spawn --backend codex --tier low --identity myapp:fixer --budget 0.50 -- "Fix the login bug"' },
      { cmd: 'pd spawned', desc: 'List all spawned agents with status and duration.', example: 'pd spawned' },
      { cmd: 'pd spawn cancel <id>', desc: 'Cancel a running spawn and retain its evidence.', example: 'pd spawn cancel spawned-8a2f' }
    ]
  },
]

function CommandCard({ cmd, desc, example, tone }: { cmd: string; desc: string; example: string; tone: DocSection['tone'] }) {
  const [copied, setCopied] = React.useState(false)
  const handleCopy = () => {
    navigator.clipboard.writeText(example)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Surface depth="raised" radius="md" padding="md" interactive className="group flex h-full w-full min-w-0 flex-col items-center gap-[var(--space-4)] text-center">
       <div className="w-full min-w-0 space-y-[var(--space-3)]">
          <code className={`block min-w-0 break-words font-mono text-[length:var(--type-panel-title-nav-size)] font-bold [overflow-wrap:anywhere] ${toneTextClass[tone]}`}>{cmd}</code>
          <p className="m-0 text-[length:var(--type-panel-body-compact-size)] font-medium leading-[var(--leading-body-compact)] text-[var(--text-muted)]">{desc}</p>
       </div>

       {/* Inset code example with copy */}
       <div className="relative w-full min-w-0 overflow-hidden border border-[var(--border-default)] bg-[var(--code-bg)] p-[var(--space-3)] font-mono text-[length:var(--type-code-size)]">
          <div className="flex min-w-0 items-center justify-between gap-[var(--space-3)]">
             <div className="min-w-0 break-words [overflow-wrap:anywhere]">
               <span className="text-[var(--code-prompt)]">$ </span>
               <span className="text-[var(--code-text)]">{example}</span>
             </div>
             <Button
               onClick={handleCopy}
               variant="code"
               size="icon"
               className="h-8 w-8 shrink-0 opacity-70 group-hover:opacity-100"
               aria-label={copied ? 'Copied command' : 'Copy command'}
             >
                {copied ? <Check size={14} /> : <Copy size={14} />}
             </Button>
          </div>
          <span className="sr-only" aria-live="polite">{copied ? 'Command copied to clipboard' : ''}</span>
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
      className="flex min-h-screen flex-col bg-[var(--surface-base)] font-sans selection:bg-[var(--brand-primary)] selection:text-[var(--brand-primary-foreground)]"
    >
      <motion.div
        className="fixed left-0 right-0 top-16 z-[100] h-1 origin-left bg-[var(--brand-primary)]"
        style={{ scaleX }}
      />

      {/* Hero Section */}
      <motion.section
        className="relative overflow-hidden border-b border-[var(--border-subtle)] bg-[var(--surface-raised)] px-[var(--space-6)] py-[var(--space-12)] lg:px-[var(--space-8)] lg:py-[var(--space-16)]"
      >
        <motion.div className="relative z-10 mx-auto flex max-w-7xl flex-col items-center gap-[var(--space-6)] text-center">
           <Badge variant="teal" className="px-[var(--space-4)] py-[var(--space-2)] text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)]">SDK Manual</Badge>
           <motion.h1
             className="font-display text-[length:var(--type-hero-size)] font-black leading-[var(--leading-display-tight)] tracking-[var(--tracking-display-tight)] text-[var(--text-primary)]"
             initial={{ opacity: 0, y: 32 }}
             animate={{ opacity: 1, y: 0 }}
             transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
           >
             The <motion.span className="text-[var(--brand-primary)]">SDK manual.</motion.span>
           </motion.h1>
           <motion.p
             className="max-w-3xl text-[length:var(--type-panel-body-size)] font-medium leading-[var(--leading-body)] text-[var(--text-secondary)]"
             initial={{ opacity: 0, y: 20 }}
             animate={{ opacity: 1, y: 0 }}
             transition={{ duration: 0.8, delay: 0.1 }}
           >
             Seven primitives — identity, sessions, channels, locks, salvage, harbors, spawning — wired so a fleet of agents can run on the same machine without stepping on each other. Each one is a single CLI verb. The longer story for each is below; the shape of the whole thing is here.
           </motion.p>
        </motion.div>
      </motion.section>

      {/* Main Content */}
      <motion.main id="main-content" className="mx-auto w-full max-w-7xl flex-1 px-[var(--space-6)] py-[var(--space-10)] font-sans lg:px-[var(--space-8)] lg:py-[var(--space-14)]">
        <motion.div className="flex flex-col items-center space-y-[var(--space-20)]">
          {SECTIONS.map((section) => (
            <motion.section
              key={section.id}
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
              id={section.id}
              className="flex w-full flex-col items-center space-y-[var(--space-10)]"
            >
               <div className="flex w-full flex-col items-center gap-[var(--space-6)] border-b border-[var(--border-subtle)] pb-[var(--space-10)] text-center">
                  <div className="flex max-w-2xl flex-col items-center gap-[var(--space-5)]">
                     <div className="flex flex-col items-center gap-[var(--space-4)]">
                        <Surface depth="inset" radius="md" padding="none" className="flex h-16 w-16 items-center justify-center">
                           <section.icon size={32} className={toneTextClass[section.tone]} />
                        </Surface>
                        <h2 className="m-0 font-display text-[length:var(--type-panel-title-display-size)] font-black leading-[var(--leading-display)] tracking-[var(--tracking-display-tight)] text-[var(--text-primary)]">{section.title}</h2>
                     </div>
                     <p className="m-0 text-[length:var(--type-panel-body-size)] font-medium leading-[var(--leading-body)] text-[var(--text-secondary)]">
                        {section.description}
                     </p>
                  </div>
                  <Badge variant="default" className="px-[var(--space-4)] py-[var(--space-2)] text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)]">Core Primitive</Badge>
               </div>

               <div className="grid w-full min-w-0 grid-cols-1 gap-[var(--space-4)] sm:grid-cols-2 lg:grid-cols-3">
                  {section.commands.map((cmd, j) => (
                    <CommandCard key={j} {...cmd} tone={section.tone} />
                  ))}
               </div>
            </motion.section>
          ))}
        </motion.div>

        {/* Bottom panel */}
        <Surface depth="raised" radius="md" padding="lg" className="relative mt-[var(--space-16)] flex flex-col items-center gap-[var(--space-5)] overflow-hidden text-center">

           <div className="relative z-10 flex max-w-3xl flex-col items-center space-y-[var(--space-4)]">
              <Badge variant="gold" className="px-[var(--space-4)] py-[var(--space-2)] text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)]">Why we built it this way</Badge>
              <h3 className="font-display text-[length:var(--type-panel-title-display-size)] font-black leading-[var(--leading-display)] tracking-[var(--tracking-display-tight)] text-[var(--text-primary)]">
                Why the seams hold up.
              </h3>
              <p className="text-[length:var(--type-panel-body-size)] leading-[var(--leading-body)] text-[var(--text-secondary)]">
                Port Daddy is built around the parts that get formally verified — state transitions on sessions, locks, harbors, and message channels. The boring outcome of all that boring rigor is an agent fleet that does not lose its homework when one of its members crashes.
              </p>
           </div>

           <div className="grid w-full gap-[var(--space-4)] sm:grid-cols-2 lg:grid-cols-4">
              {[
                { label: 'Unix Socket Native', icon: Zap },
                { label: 'HMAC Handshake', icon: Shield },
                { label: 'SQLite Persistent', icon: Box },
                { label: 'Formal Verified', icon: ShieldCheck }
              ].map((item, i) => (
                <Surface key={i} depth="inset" radius="md" padding="md" className="flex flex-col items-center gap-[var(--space-4)]">
                   <item.icon size={24} className="text-[var(--brand-primary)]" />
                   <span className="text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">{item.label}</span>
                </Surface>
              ))}
           </div>
        </Surface>
      </motion.main>

      <Footer />
    </motion.div>
  )
}
