import { motion } from 'framer-motion'
import {
  Anchor,
  BadgeCheck,
  FileCode2,
  GitBranch,
  Inbox,
  Layers,
  LockKeyhole,
  Network,
  Radio,
  ServerCog,
  Shield,
  TerminalSquare,
  type LucideIcon,
} from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { CommandTerminal } from '@/components/ui/CommandTerminal'
import { Surface } from '@/components/ui/Surface'
import { Footer } from '@/components/layout/Footer'

interface Example {
  id: string
  title: string
  category: string
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced'
  path: string
  description: string
  run: string[]
  inspect: string[]
  proof: string[]
  files: string[]
  icon: LucideIcon
  color: string
}

const EXAMPLES: Example[] = [
  {
    id: 'war-room',
    title: 'War Room Incident Simulation',
    category: 'Swarm',
    difficulty: 'Advanced',
    path: 'examples/war-room/run.sh',
    description: 'A complete three-agent incident response run: agents register, publish discoveries, write notes, converge on a root cause, and sign off cleanly.',
    run: [
      '# Full scripted incident response',
      './examples/war-room/run.sh',
    ],
    inspect: [
      'pd notes --limit 20',
      'pd agents',
    ],
    proof: [
      'Three semantic agent identities come online',
      'Findings move through shared channel traffic and durable notes',
      'The cleanup path proves sessions do not leak live agents',
    ],
    files: ['examples/war-room/run.sh', 'examples/war-room/README.md'],
    icon: Radio,
    color: 'var(--brand-primary)',
  },
  {
    id: 'file-edit-guard',
    title: 'File Edit Guard',
    category: 'Coordination',
    difficulty: 'Intermediate',
    path: 'examples/coordination/file-edit-guard.ts',
    description: 'A reusable TypeScript guard agents can run before editing a contested file. It combines locks, file-scoped radio messages, status checks, release, and notes.',
    run: [
      '# Agent A claims a file before editing',
      'AGENT_ID=agent-a npx tsx examples/coordination/file-edit-guard.ts claim src/auth.ts "Add auth check"',
      '',
      '# Agent B sees the live ownership truth',
      'AGENT_ID=agent-b npx tsx examples/coordination/file-edit-guard.ts status src/auth.ts',
      '',
      '# Agent A releases and records the edit',
      'AGENT_ID=agent-a npx tsx examples/coordination/file-edit-guard.ts release src/auth.ts',
    ],
    inspect: [
      'pd locks',
      'pd notes --limit 5',
    ],
    proof: [
      'A scarce file resource gets an actual lock',
      'Other agents can inspect ownership instead of guessing',
      'Release writes both a radio event and durable note',
    ],
    files: ['examples/coordination/file-edit-guard.ts', 'examples/coordination/agent-protocol.ts', 'examples/coordination/README.md'],
    icon: Shield,
    color: 'var(--brand-secondary)',
  },
  {
    id: 'service-stack',
    title: 'Claimed Service Stack',
    category: 'Services',
    difficulty: 'Beginner',
    path: 'examples/services/',
    description: 'A real API, frontend, and worker trio. Run them directly to see health checks, graceful shutdown, and service dependency behavior before wrapping them with Port Daddy orchestration.',
    run: [
      '# Terminal 1: API',
      'PORT=43101 npx tsx examples/services/api-server.ts',
      '',
      '# Terminal 2: frontend pointed at the API',
      'PORT=43102 API_URL=http://127.0.0.1:43101 npx tsx examples/services/frontend.ts',
      '',
      '# Terminal 3: worker polling the API',
      'API_URL=http://127.0.0.1:43101 POLL_INTERVAL=2000 npx tsx examples/services/worker.ts',
    ],
    inspect: [
      'curl http://127.0.0.1:43101/health',
      'curl http://127.0.0.1:43101/items',
    ],
    proof: [
      'The API exposes live health and CRUD endpoints',
      'The frontend renders against the discovered API URL',
      'The worker observes API state changes and handles unreachable dependencies',
    ],
    files: ['examples/services/api-server.ts', 'examples/services/frontend.ts', 'examples/services/worker.ts', 'examples/services/README.md'],
    icon: ServerCog,
    color: 'var(--status-success)',
  },
  {
    id: 'migration-guard',
    title: 'Migration Lock Guard',
    category: 'Locks',
    difficulty: 'Intermediate',
    path: 'examples/locks/migration-guard.ts',
    description: 'Two simulated agents race for the same migration lock. One runs the critical section; the other exits with a useful operator message.',
    run: [
      '# Demonstrates contention around one scarce resource',
      'npx tsx examples/locks/migration-guard.ts',
    ],
    inspect: [
      'pd locks',
    ],
    proof: [
      'Only one migration actor enters the protected section',
      'The skipped actor reports why it did not proceed',
      'The lock is released in a finally block',
    ],
    files: ['examples/locks/migration-guard.ts', 'examples/locks/README.md'],
    icon: LockKeyhole,
    color: 'var(--brand-accent)',
  },
  {
    id: 'inbox-lifecycle',
    title: 'Durable Inbox Lifecycle',
    category: 'Inbox',
    difficulty: 'Beginner',
    path: 'examples/inbox/agent-dm.sh',
    description: 'A shell-level lifecycle for targeted agent mail: register Alice and Bob, send a handoff, read stats, mark read, clear, and unregister.',
    run: [
      '# Requires curl and python3',
      'bash examples/inbox/agent-dm.sh',
    ],
    inspect: [
      'pd agents',
    ],
    proof: [
      'Targeted messages survive outside one terminal stream',
      'Inbox stats change as messages are read and cleared',
      'The cleanup path unregisters both demo agents',
    ],
    files: ['examples/inbox/agent-dm.sh', 'examples/inbox/inbox-monitor.ts', 'examples/inbox/README.md'],
    icon: Inbox,
    color: 'var(--brand-secondary)',
  },
  {
    id: 'session-phases',
    title: 'Session Phase Lifecycle',
    category: 'Sessions',
    difficulty: 'Beginner',
    path: 'examples/phases/session-lifecycle.sh',
    description: 'A full session lifecycle through setup, planning, implementing, testing, reviewing, cleanup, and completion with file claims and phase notes.',
    run: [
      '# Requires curl and jq',
      'bash examples/phases/session-lifecycle.sh',
    ],
    inspect: [
      'pd notes --limit 10',
      'pd sessions --all --limit 5',
    ],
    proof: [
      'Session phase transitions are visible state, not chat memory',
      'File claims attach to the active session',
      'Each phase leaves a durable, typed note',
    ],
    files: ['examples/phases/session-lifecycle.sh', 'examples/phases/README.md'],
    icon: GitBranch,
    color: 'var(--brand-primary)',
  },
  {
    id: 'dns-discovery',
    title: 'DNS Service Discovery',
    category: 'Discovery',
    difficulty: 'Intermediate',
    path: 'examples/dns/service-discovery.ts',
    description: 'A TypeScript service discovery pass that registers multiple DNS records, lists the shop namespace, performs a lookup, and tears everything down.',
    run: [
      '# Register, list, lookup, cleanup',
      'npx tsx examples/dns/service-discovery.ts',
    ],
    inspect: [
      'pd dns list',
    ],
    proof: [
      'Semantic service identities become hostnames',
      'Lookup works without hardcoded port folklore',
      'The example removes its own records afterward',
    ],
    files: ['examples/dns/service-discovery.ts', 'examples/dns/setup-resolver.sh', 'examples/dns/README.md'],
    icon: Network,
    color: 'var(--status-success)',
  },
  {
    id: 'integration-signals',
    title: 'Ready / Needs Integration Signals',
    category: 'Signals',
    difficulty: 'Intermediate',
    path: 'examples/integration/ready-needs.sh',
    description: 'Two agents coordinate through sessions and notes: one is blocked waiting for an API, the other declares the API ready, and the recent notes become the handoff trail.',
    run: [
      '# Requires curl and jq',
      'bash examples/integration/ready-needs.sh',
    ],
    inspect: [
      'pd notes --limit 5',
    ],
    proof: [
      'Readiness and blockers are durable session facts',
      'The status trail is inspectable after the script exits',
      'Demo agents and sessions are cleaned up explicitly',
    ],
    files: ['examples/integration/ready-needs.sh', 'examples/integration/README.md'],
    icon: BadgeCheck,
    color: 'var(--brand-accent)',
  },
]

function formatCommand(lines: string[]): string {
  return lines.map((line) => {
    if (!line) return ''
    if (line.startsWith('#')) return line
    return `$ ${line}`
  }).join('\n')
}

export function ExamplesPage() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="min-h-screen flex flex-col font-sans selection:bg-[var(--brand-primary)] selection:text-[var(--brand-primary-foreground)]"
      style={{ background: 'var(--surface-base)' }}
    >
      <Surface depth="raised" radius="none" padding="none" className="py-14 px-6 sm:px-8 lg:px-10 relative overflow-hidden flex flex-col items-center justify-center text-center">
        <div className="max-w-5xl mx-auto relative z-10 flex flex-col items-center gap-5">
          <Badge variant="teal" className="px-6 py-2 text-[10px] font-black uppercase tracking-[0.25em]">Executable Corpus</Badge>
          <motion.h1
            className="text-4xl sm:text-6xl font-black font-display leading-[0.9] m-0 text-[var(--text-primary)]"
            initial={{ opacity: 0, y: 32 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          >
            Run The <br />
            <span className="text-[var(--brand-primary)]">North Stars.</span>
          </motion.h1>
          <motion.p
            className="text-xl sm:text-2xl max-w-4xl leading-relaxed text-[var(--text-secondary)] font-medium"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.1 }}
          >
            These are not ornamental snippets. Each card names the executable file, the command to run, and the Port Daddy state you should inspect afterward.
          </motion.p>
        </div>
      </Surface>

      <motion.main id="main-content" className="flex-1 py-12 px-6 sm:px-8 lg:px-10 max-w-7xl mx-auto w-full font-sans flex flex-col items-center">
        <div className="grid gap-5 w-full">
          {EXAMPLES.map((example, index) => (
            <motion.div
              key={example.id}
              initial={{ opacity: 0, y: 48 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.7, delay: index * 0.04, ease: [0.16, 1, 0.3, 1] }}
              className="group"
            >
              <Surface depth="raised" radius="2xl" padding="none" className="p-6 transition-all duration-500 flex flex-col xl:flex-row gap-6 items-stretch">
                <div className="flex-1 space-y-5 flex flex-col">
                  <div className="flex flex-col sm:flex-row items-start gap-5">
                    <motion.div
                      className="w-20 h-20 rounded-2xl flex items-center justify-center transition-transform group-hover:scale-105 duration-500 shrink-0"
                      style={{ background: `${example.color}12`, boxShadow: 'var(--shadow-inset)' }}
                    >
                      <example.icon size={42} style={{ color: example.color }} />
                    </motion.div>

                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center gap-3">
                        <Badge variant="default" className="text-[10px] font-black uppercase tracking-widest px-4 py-1.5">
                          <span className="text-[var(--text-primary)]">{example.category}</span>
                        </Badge>
                        <span className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)]">{example.difficulty}</span>
                      </div>
                      <motion.h2 className="m-0 text-2xl sm:text-4xl font-display font-black leading-tight text-[var(--text-primary)]">{example.title}</motion.h2>
                      <div className="flex items-center gap-2 text-sm font-mono text-[var(--text-muted)] break-all">
                        <FileCode2 size={16} />
                        <span>{example.path}</span>
                      </div>
                    </div>
                  </div>

                  <motion.p className="text-lg sm:text-xl leading-relaxed text-[var(--text-secondary)] m-0 max-w-3xl">{example.description}</motion.p>

                  <div className="grid sm:grid-cols-3 gap-4">
                    {example.proof.map((point) => (
                      <div key={point} className="flex items-start gap-3">
                        <div className="mt-2 w-2 h-2 rounded-full shrink-0" style={{ background: example.color }} />
                        <p className="text-sm text-[var(--text-secondary)] m-0 leading-relaxed font-bold">{point}</p>
                      </div>
                    ))}
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-[var(--text-muted)]">
                      <Layers size={14} />
                      Files In The Example
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {example.files.map((file) => (
                        <code key={file} className="px-3 py-1.5 border border-[var(--border-primary)] text-xs text-[var(--text-secondary)] bg-[var(--surface-base)]">
                          {file}
                        </code>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="w-full xl:w-[520px] flex flex-col gap-4">
                  <CommandTerminal
                    code={formatCommand(example.run)}
                    title={`Run: ${example.path}`}
                    typewriterSpeed={0}
                    animate={false}
                  />

                  <div className="border border-[var(--border-primary)] p-4 bg-[var(--surface-base)]">
                    <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-[var(--text-muted)] mb-3">
                      <TerminalSquare size={14} />
                      Inspect After Running
                    </div>
                    <pre className="m-0 text-sm leading-relaxed overflow-x-auto text-[var(--text-primary)] font-mono">
                      {example.inspect.map((command) => `$ ${command}`).join('\n')}
                    </pre>
                  </div>
                </div>
              </Surface>
            </motion.div>
          ))}
        </div>

        <Surface depth="raised" radius="2xl" padding="none" className="mt-14 overflow-hidden w-full mx-auto">
          <motion.div
            className="p-6 flex flex-col items-center text-center gap-5 relative"
            initial={{ opacity: 0, scale: 0.98 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
          >
            <div className="max-w-4xl relative z-10 space-y-6 flex flex-col items-center">
              <Badge variant="gold" className="px-6 py-2 text-[11px] font-black uppercase tracking-widest">Pristine Means Runnable</Badge>
              <motion.h3 className="text-2xl sm:text-4xl font-display font-black leading-[0.95] m-0 text-[var(--text-primary)]">
                The code is the example. <br />
                <span className="text-[var(--brand-accent)]">The card is only the launcher.</span>
              </motion.h3>
              <motion.p className="text-xl sm:text-2xl leading-relaxed text-[var(--text-secondary)] max-w-3xl">
                If an example cannot be executed, inspected, and adapted into a real repo workflow, it does not belong on this page.
              </motion.p>
            </div>

            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 w-full max-w-6xl relative z-10">
              {[
                { title: 'Executable Files', icon: FileCode2 },
                { title: 'Observable State', icon: TerminalSquare },
                { title: 'Coordination Truth', icon: Anchor },
                { title: 'Clean Teardown', icon: BadgeCheck },
              ].map((item) => (
                <div
                  key={item.title}
                  className="p-6 rounded-2xl flex flex-col items-center gap-4 group transition-all"
                  style={{ background: 'var(--surface-raised)', boxShadow: 'var(--shadow-sm)' }}
                >
                  <Surface depth="inset" radius="2xl" padding="none" className="w-14 h-14 flex items-center justify-center group-hover:scale-110 transition-transform">
                    <item.icon size={28} className="text-[var(--brand-primary)]" />
                  </Surface>
                  <span className="text-[10px] font-black uppercase tracking-[0.25em] text-[var(--text-muted)] group-hover:text-[var(--text-primary)] transition-colors text-center">{item.title}</span>
                </div>
              ))}
            </div>
          </motion.div>
        </Surface>
      </motion.main>

      <Footer />
    </motion.div>
  )
}
