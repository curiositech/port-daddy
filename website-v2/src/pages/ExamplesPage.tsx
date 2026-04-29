import { motion } from 'framer-motion'
import { Badge } from '@/components/ui/Badge'
import { Surface } from '@/components/ui/Surface'
import { CommandTerminal } from '@/components/ui/CommandTerminal'
import { Shield, Layers, Anchor, Zap, Globe, Search, Network, Wrench, type LucideIcon } from 'lucide-react'
import { Footer } from '@/components/layout/Footer'

interface Example {
  id: string
  title: string
  category: string
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced'
  description: string
  spotlight?: string
  what: string[]
  code: string[]
  icon: LucideIcon
  color: string
}

const EXAMPLES: Example[] = [
  {
    id: 'swarm-coordination-board',
    title: 'Swarm coordination board',
    category: 'Swarm',
    difficulty: 'Advanced',
    description: 'Run a tuple-backed board where workers claim tasks, reviewers attach observations, and the operator reads the shared harbor state.',
    what: [
      'Writes typed work items into tuple space',
      'Claims tasks without reverse-engineering prose',
      'Adds review facts other agents can query',
      'Keeps the whole board scoped to one harbor'
    ],
    code: [
      '# Run the tuple-backed swarm board',
      'PD_EXAMPLE_HARBOR=myapp:fleet \\',
      '  npx tsx examples/swarm/coordination-board.ts',
      '',
      '# Inspect the shared state directly',
      'pd tuple scan --harbor myapp:fleet',
      '',
      '# Read only high-priority work items',
      'pd tuple rd \'["task","*","*","high"]\' --harbor myapp:fleet'
    ],
    icon: Network,
    color: 'var(--brand-secondary)'
  },
  {
    id: 'pd-tube-preview-share',
    title: 'PD Tube: localhost the fleet can find',
    category: 'PD Tube',
    difficulty: 'Intermediate',
    spotlight: 'Your laptop preview stops being a private port number and becomes a named, revocable artifact humans can open and agents can discover.',
    description: 'Start with a local dev server. PD Tube claims the service identity, picks an installed tunnel path, records the public URL on the daemon, writes a tuple for the swarm, and gives you one command to shut the door again.',
    what: [
      'Turns localhost into a real review URL without port folklore',
      'Names the preview so agents can discover it later',
      'Writes `preview-url` swarm state instead of hiding the link in chat',
      'Revokes the route by stopping the tunnel and releasing the identity'
    ],
    code: [
      '# Turn a dev server into a named fleet preview',
      'npx tsx examples/tunnel/share-preview.ts start \\',
      '  --identity demo:web --port 5174',
      '',
      '# Humans can open it; agents can discover it',
      'pd find demo:web',
      'pd tuple rd \'["preview-url","demo:web","*","*"]\' \\',
      '  --harbor examples',
      '',
      '# Revoke the preview when the review is over',
      'npx tsx examples/tunnel/share-preview.ts stop --identity demo:web'
    ],
    icon: Globe,
    color: 'var(--brand-accent)'
  },
  {
    id: 'agent-workbench',
    title: 'Agent workbench',
    category: 'Dev tools',
    difficulty: 'Intermediate',
    description: 'Build a small operator tool on top of the SDK that reads sessions, locks, harbors, services, and active agents in one sweep.',
    what: [
      'Shows what a daemon-backed tool can query',
      'Supports human-readable and JSON output',
      'Turns shared state into an operator dashboard seed',
      'Keeps implementation compact enough to copy'
    ],
    code: [
      '# Print a compact terminal workbench',
      'npx tsx examples/devtools/agent-workbench.ts',
      '',
      '# Feed the same state into another UI',
      'npx tsx examples/devtools/agent-workbench.ts --json',
      '',
      '# Pair it with the guided docs at /docs/examples'
    ],
    icon: Wrench,
    color: 'var(--brand-secondary)'
  },
  {
    id: 'service-discovery-stack',
    title: 'Service discovery stack',
    category: 'Discovery',
    difficulty: 'Beginner',
    description: 'Run an API, frontend, and worker that claim service identities and find each other through Port Daddy instead of fixed ports.',
    what: [
      'API claims and releases its semantic service',
      'Frontend resolves the API before proxying calls',
      'Worker waits for the API instead of racing boot',
      'All three scripts are dependency-free Node examples'
    ],
    code: [
      '# Terminal 1: start the API',
      'PORT=43101 npx tsx examples/services/api-server.ts',
      '',
      '# Terminal 2: start the frontend',
      'PORT=43102 npx tsx examples/services/frontend.ts',
      '',
      '# Terminal 3: let the worker discover the API',
      'npx tsx examples/services/worker.ts'
    ],
    icon: Search,
    color: 'var(--status-success)'
  },
  {
    id: 'migration-lock-guard',
    title: 'Migration lock guard',
    category: 'Coordination',
    difficulty: 'Intermediate',
    description: 'Show two actors contending for the same migration lock so one proceeds and the other exits with a useful operator message.',
    what: [
      'Uses the current SDK withLock helper',
      'Creates real sessions for competing actors',
      'Leaves notes that explain what happened',
      'Protects the scarce resource instead of relying on etiquette'
    ],
    code: [
      '# Run the contention demo',
      'npx tsx examples/locks/migration-guard.ts',
      '',
      '# Use the same primitive in real work',
      'pd with-lock db-migration -- npm run migrate',
      '',
      '# Inspect the session notes afterward',
      'pd notes --limit 10'
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
      className="min-h-screen flex flex-col font-sans selection:bg-[var(--brand-primary)] selection:text-[var(--brand-primary-foreground)]"
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
             Run the code, then read the guide. /examples is the runnable corpus; /docs/examples explains when each pattern belongs in real repo work.
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

                   {ex.spotlight ? (
                     <motion.p className="m-0 max-w-xl font-display text-2xl sm:text-3xl font-black leading-tight text-[var(--text-primary)]">
                       {ex.spotlight}
                     </motion.p>
                   ) : null}

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
                       (line.startsWith('pd') || line.startsWith('npx') || line.startsWith('PORT=') || line.startsWith('PD_')) ? `$ ${line}` :
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
                Port Daddy handles ports, locks, messages, tuples, tunnels, sessions, and recovery so your agents can focus on the task. These patterns show the daemon as a tool-building substrate, not just another CLI.
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
