import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Surface } from '@/components/ui/Surface'
import { CodeBlock } from '@/components/ui/CodeBlock'
import {
  Shield, Map, Zap, Network, Eye, Clock,
  ArrowRight, GitCommit, Heart, BookOpen, Search,
  Terminal,
} from 'lucide-react'

const AGENTS = [
  {
    name: 'QA',
    icon: <Shield className="w-5 h-5" />,
    tagline: 'Adversarial reviewer',
    description: 'Reviews every commit for bugs, edge cases, and inputs that would break the change. Writes tests that expose problems.',
    trigger: 'git:committed',
    template: 'starter',
  },
  {
    name: 'Documentarian',
    icon: <BookOpen className="w-5 h-5" />,
    tagline: 'Docs that match the code',
    description: 'Checks README, CHANGELOG, API docs, and website content against actual code. Updates anything stale.',
    trigger: 'git:committed',
    template: 'starter',
  },
  {
    name: 'Cartographer',
    icon: <Map className="w-5 h-5" />,
    tagline: 'Roadmap keeper',
    description: 'Tracks what was planned vs what was built. Updates roadmaps, flags stale items, reports velocity and drift.',
    trigger: 'git:committed',
    template: 'starter',
  },
  {
    name: 'Spark',
    icon: <Zap className="w-5 h-5" />,
    tagline: 'Idea engine',
    description: 'Proposes one concrete improvement every 30 minutes. Reads Spider\'s connections and turns them into buildable proposals.',
    trigger: 'schedule: */30m',
    template: 'starter',
  },
  {
    name: 'Spider',
    icon: <Network className="w-5 h-5" />,
    tagline: 'Connection finder',
    description: 'Finds combinations of existing features that create new capabilities. Outputs syllogisms: "We have X AND Y, THEREFORE Z."',
    trigger: 'spark:idea + schedule: 2h',
    template: 'starter',
  },
  {
    name: 'Health Monitor',
    icon: <Heart className="w-5 h-5" />,
    tagline: 'Watchdog',
    description: 'Checks service health every 5 minutes. Emits stress signals so other agents back off when the system is under pressure.',
    trigger: 'schedule: */5m',
    template: 'always-on',
  },
  {
    name: 'Session Reaper',
    icon: <Clock className="w-5 h-5" />,
    tagline: 'Lease auditor',
    description: 'Finds sessions that have been active for hours without activity. Flags them as potentially abandoned.',
    trigger: 'schedule: hourly',
    template: 'always-on',
  },
  {
    name: 'Dep Watcher',
    icon: <Search className="w-5 h-5" />,
    tagline: 'Security auditor',
    description: 'Runs npm outdated and npm audit daily. Reports vulnerabilities, major version bumps, and deprecation notices.',
    trigger: 'schedule: daily',
    template: 'always-on',
  },
]

export function TemplatesPage() {
  return (
    <div className="min-h-screen bg-[var(--surface-base)] pt-32 pb-24">
      <div className="max-w-5xl mx-auto px-6 lg:px-8">
        {/* Header */}
        <header className="mb-16">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-4 inline-flex items-center gap-2 border border-[var(--border-default)] bg-[var(--surface-raised)] px-3 py-1 text-xs font-semibold text-[var(--brand-primary)]"
          >
            <Terminal size={12} />
            <span>pd fleet init</span>
          </motion.div>
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-4xl sm:text-6xl font-display font-black tracking-tighter mb-6 text-[var(--text-primary)]"
          >
            Fleet <span className="text-[var(--brand-primary)]">Templates.</span>
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-lg max-w-2xl leading-relaxed text-[var(--text-secondary)]"
          >
            Drop-in YAML configs and agent archetypes. Copy to your project root, run <code>pd fleet up</code>, commit something.
          </motion.p>
        </header>

        <motion.figure
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="mb-16 overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]"
        >
          <picture>
            <source srcSet="/img/generated/virtual-actor-fleet.webp" type="image/webp" />
            <img
              src="/img/generated/virtual-actor-fleet.jpg"
              alt="Generated Swiss-modern diagram of durable agent identities, temporary runtime leases, trigger lanes, and budget gates"
              className="block aspect-[16/7] w-full object-cover"
            />
          </picture>
        </motion.figure>

        {/* Quick Start */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mb-16"
        >
          <Surface depth="raised" radius="2xl" padding="lg" className="space-y-4">
            <h2 className="text-xl font-display font-black m-0 text-[var(--text-primary)]">
              Five agents, one command, fired on every commit.
            </h2>
            <CodeBlock language="bash">{`cd ~/my-project
pd fleet init          # Creates pd-fleet.yml + git hook + output dirs
pd fleet up            # Starts the fleet
git commit -m "test"   # QA, docs, cartographer fire automatically`}</CodeBlock>
            <p className="text-sm m-0 text-[var(--text-secondary)]">
              Requires Port Daddy running (<code>pd start</code>) and <code>ANTHROPIC_API_KEY</code> in <code>.env.local</code>.
            </p>
          </Surface>
        </motion.div>

        {/* Template Packs */}
        <section className="mb-16">
          <h2 className="text-2xl font-display font-black mb-8 text-[var(--text-primary)]">
            Template Packs
          </h2>
          <div className="grid sm:grid-cols-2 gap-6">
            <Surface depth="raised" radius="2xl" padding="lg" className="space-y-4">
              <div className="flex items-center gap-3">
                <Surface depth="inset" radius="xl" padding="none" className="w-10 h-10 flex items-center justify-center">
                  <GitCommit size={20} className="text-[var(--brand-primary)]" />
                </Surface>
                <div>
                  <h3 className="text-lg font-display font-black m-0 text-[var(--text-primary)]">Starter Fleet</h3>
                  <p className="text-xs m-0 text-[var(--text-secondary)]">5 agents, commit-triggered</p>
                </div>
              </div>
              <p className="text-sm m-0 text-[var(--text-secondary)]">
                QA, Documentarian, Cartographer on every commit. Spark + Spider for creative ideation. Includes git post-commit hook.
              </p>
              <CodeBlock language="bash">{`pd fleet init
# or manually:
cp templates/pd-fleet-starter.yml pd-fleet.yml`}</CodeBlock>
            </Surface>

            <Surface depth="raised" radius="2xl" padding="lg" className="space-y-4">
              <div className="flex items-center gap-3">
                <Surface depth="inset" radius="xl" padding="none" className="w-10 h-10 flex items-center justify-center">
                  <Eye size={20} className="text-[var(--brand-secondary)]" />
                </Surface>
                <div>
                  <h3 className="text-lg font-display font-black m-0 text-[var(--text-primary)]">Always-On Fleet</h3>
                  <p className="text-xs m-0 text-[var(--text-secondary)]">5 agents, timer-driven</p>
                </div>
              </div>
              <p className="text-sm m-0 text-[var(--text-secondary)]">
                Health monitor, lock janitor, session reaper, dependency watcher, changelog writer. Continuous ambient awareness.
              </p>
              <CodeBlock language="bash">{`# Merge into your existing pd-fleet.yml:
cat templates/pd-fleet-always-on.yml >> pd-fleet.yml`}</CodeBlock>
            </Surface>
          </div>
        </section>

        {/* Agent Archetypes */}
        <section>
          <h2 className="text-2xl font-display font-black mb-3 text-[var(--text-primary)]">
            Agent Archetypes
          </h2>
          <p className="text-sm mb-8 text-[var(--text-secondary)]">
            Each agent is a role with a job, a trigger, and a communication channel. Mix and match.
          </p>

          <div className="grid sm:grid-cols-2 gap-4">
            {AGENTS.map((agent, i) => (
              <motion.div
                key={agent.name}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                viewport={{ once: true }}
              >
                <Surface depth="raised" radius="xl" padding="md" className="h-full space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 flex items-center justify-center border border-[var(--border-default)] bg-[var(--surface-overlay)] text-[var(--brand-primary)]">
                      {agent.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-bold m-0 text-[var(--text-primary)]">{agent.name}</h3>
                        <Badge variant={agent.template === 'starter' ? 'teal' : 'gold'} size="sm">{agent.template}</Badge>
                      </div>
                      <p className="text-[10px] m-0 text-[var(--text-muted)]">{agent.tagline}</p>
                    </div>
                  </div>
                  <p className="text-xs m-0 leading-relaxed text-[var(--text-secondary)]">
                    {agent.description}
                  </p>
                  <div className="flex items-center gap-1 text-[10px] font-mono text-[var(--text-muted)]">
                    <Clock size={10} />
                    <span>{agent.trigger}</span>
                  </div>
                </Surface>
              </motion.div>
            ))}
          </div>
        </section>

        {/* CTA */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mt-16 text-center"
        >
          <Surface depth="raised" radius="2xl" padding="lg" className="space-y-4">
            <h2 className="text-xl font-display font-black m-0 text-[var(--text-primary)]">
              Build your own agents
            </h2>
            <p className="text-sm m-0 max-w-md mx-auto text-[var(--text-secondary)]">
              These templates are starting points. Edit the prompts, wire up more agents, chain them through channels — it's all YAML. The fleet is yours.
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <Button asChild>
                <Link to="/tutorials/fleet">
                  Fleet Tutorial <ArrowRight size={14} />
                </Link>
              </Button>
              <Button asChild variant="secondary">
                <Link to="/tutorials/primitives">
                  Coordination Primitives <ArrowRight size={14} />
                </Link>
              </Button>
            </div>
          </Surface>
        </motion.div>
      </div>
    </div>
  )
}
