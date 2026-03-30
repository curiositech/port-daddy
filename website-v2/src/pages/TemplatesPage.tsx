import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/Badge'
import { Surface } from '@/components/ui/Surface'
import { CodeBlock } from '@/components/ui/CodeBlock'
import {
  Bot, Shield, FileText, Map, Zap, Network, Eye, Clock,
  ArrowRight, GitCommit, Wrench, Heart, BookOpen, Search,
  Terminal, Copy,
} from 'lucide-react'

const AGENTS = [
  {
    name: 'QA',
    icon: <Shield className="w-5 h-5" />,
    color: '#e74c3c',
    tagline: 'Adversarial reviewer',
    description: 'Reviews every commit for bugs, edge cases, and inputs that would break the change. Writes tests that expose problems.',
    trigger: 'git:committed',
    template: 'starter',
  },
  {
    name: 'Documentarian',
    icon: <BookOpen className="w-5 h-5" />,
    color: '#3498db',
    tagline: 'Docs that match the code',
    description: 'Checks README, CHANGELOG, API docs, and website content against actual code. Updates anything stale.',
    trigger: 'git:committed',
    template: 'starter',
  },
  {
    name: 'Cartographer',
    icon: <Map className="w-5 h-5" />,
    color: '#2ecc71',
    tagline: 'Roadmap keeper',
    description: 'Tracks what was planned vs what was built. Updates roadmaps, flags stale items, reports velocity and drift.',
    trigger: 'git:committed',
    template: 'starter',
  },
  {
    name: 'Spark',
    icon: <Zap className="w-5 h-5" />,
    color: '#f0a500',
    tagline: 'Idea engine',
    description: 'Proposes one concrete improvement every 30 minutes. Reads Spider\'s connections and turns them into buildable proposals.',
    trigger: 'schedule: */30m',
    template: 'starter',
  },
  {
    name: 'Spider',
    icon: <Network className="w-5 h-5" />,
    color: '#9b59b6',
    tagline: 'Connection finder',
    description: 'Finds combinations of existing features that create new capabilities. Outputs syllogisms: "We have X AND Y, THEREFORE Z."',
    trigger: 'spark:idea + schedule: 2h',
    template: 'starter',
  },
  {
    name: 'Health Monitor',
    icon: <Heart className="w-5 h-5" />,
    color: '#e74c3c',
    tagline: 'Watchdog',
    description: 'Checks service health every 5 minutes. Sprays pheromone signals so other agents back off when the system is stressed.',
    trigger: 'schedule: */5m',
    template: 'always-on',
  },
  {
    name: 'Session Reaper',
    icon: <Clock className="w-5 h-5" />,
    color: '#7f8c8d',
    tagline: 'Zombie hunter',
    description: 'Finds sessions that have been active for hours without activity. Flags them as potentially abandoned.',
    trigger: 'schedule: hourly',
    template: 'always-on',
  },
  {
    name: 'Dep Watcher',
    icon: <Search className="w-5 h-5" />,
    color: '#e67e22',
    tagline: 'Security auditor',
    description: 'Runs npm outdated and npm audit daily. Reports vulnerabilities, major version bumps, and deprecation notices.',
    trigger: 'schedule: daily',
    template: 'always-on',
  },
]

export function TemplatesPage() {
  return (
    <div className="min-h-screen pt-32 pb-24" style={{ background: 'var(--surface-base)' }}>
      <div className="max-w-5xl mx-auto px-6 lg:px-8">
        {/* Header */}
        <header className="mb-16">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold mb-4"
            style={{
              background: 'color-mix(in srgb, var(--brand-primary) 12%, transparent)',
              border: '1px solid color-mix(in srgb, var(--brand-primary) 25%, transparent)',
              color: 'var(--brand-primary)',
            }}
          >
            <Terminal size={12} />
            <span>pd fleet init</span>
          </motion.div>
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-4xl sm:text-6xl font-display font-black tracking-tighter mb-6"
            style={{ color: 'var(--text-primary)' }}
          >
            Fleet <span style={{ color: 'var(--brand-primary)' }}>Templates.</span>
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-lg max-w-2xl leading-relaxed"
            style={{ color: 'var(--text-secondary)' }}
          >
            Drop-in YAML configs and agent archetypes. Copy to your project root, run <code>pd fleet up</code>, commit something.
          </motion.p>
        </header>

        {/* Quick Start */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mb-16"
        >
          <Surface depth="raised" radius="2xl" padding="lg" className="space-y-4">
            <h2 className="text-xl font-display font-black m-0" style={{ color: 'var(--text-primary)' }}>
              One command. Five agents. Every commit.
            </h2>
            <CodeBlock language="bash">{`cd ~/my-project
pd fleet init          # Creates pd-fleet.yml + git hook + output dirs
pd fleet up            # Starts the fleet
git commit -m "test"   # QA, docs, cartographer fire automatically`}</CodeBlock>
            <p className="text-sm m-0" style={{ color: 'var(--text-secondary)' }}>
              Requires Port Daddy running (<code>pd start</code>) and <code>ANTHROPIC_API_KEY</code> in <code>.env.local</code>.
            </p>
          </Surface>
        </motion.div>

        {/* Template Packs */}
        <section className="mb-16">
          <h2 className="text-2xl font-display font-black mb-8" style={{ color: 'var(--text-primary)' }}>
            Template Packs
          </h2>
          <div className="grid sm:grid-cols-2 gap-6">
            <Surface depth="raised" radius="2xl" padding="lg" className="space-y-4">
              <div className="flex items-center gap-3">
                <Surface depth="inset" radius="xl" padding="none" className="w-10 h-10 flex items-center justify-center">
                  <GitCommit size={20} style={{ color: 'var(--brand-primary)' }} />
                </Surface>
                <div>
                  <h3 className="text-lg font-display font-black m-0" style={{ color: 'var(--text-primary)' }}>Starter Fleet</h3>
                  <p className="text-xs m-0" style={{ color: 'var(--text-secondary)' }}>5 agents, commit-triggered</p>
                </div>
              </div>
              <p className="text-sm m-0" style={{ color: 'var(--text-secondary)' }}>
                QA, Documentarian, Cartographer on every commit. Spark + Spider for creative ideation. Includes git post-commit hook.
              </p>
              <CodeBlock language="bash">{`pd fleet init
# or manually:
cp templates/pd-fleet-starter.yml pd-fleet.yml`}</CodeBlock>
            </Surface>

            <Surface depth="raised" radius="2xl" padding="lg" className="space-y-4">
              <div className="flex items-center gap-3">
                <Surface depth="inset" radius="xl" padding="none" className="w-10 h-10 flex items-center justify-center">
                  <Eye size={20} style={{ color: 'var(--brand-secondary)' }} />
                </Surface>
                <div>
                  <h3 className="text-lg font-display font-black m-0" style={{ color: 'var(--text-primary)' }}>Always-On Fleet</h3>
                  <p className="text-xs m-0" style={{ color: 'var(--text-secondary)' }}>5 agents, timer-driven</p>
                </div>
              </div>
              <p className="text-sm m-0" style={{ color: 'var(--text-secondary)' }}>
                Health monitor, lock janitor, session reaper, dependency watcher, changelog writer. Continuous ambient awareness.
              </p>
              <CodeBlock language="bash">{`# Merge into your existing pd-fleet.yml:
cat templates/pd-fleet-always-on.yml >> pd-fleet.yml`}</CodeBlock>
            </Surface>
          </div>
        </section>

        {/* Agent Archetypes */}
        <section>
          <h2 className="text-2xl font-display font-black mb-3" style={{ color: 'var(--text-primary)' }}>
            Agent Archetypes
          </h2>
          <p className="text-sm mb-8" style={{ color: 'var(--text-secondary)' }}>
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
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center"
                      style={{ background: `color-mix(in srgb, ${agent.color} 15%, transparent)`, color: agent.color }}
                    >
                      {agent.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-bold m-0" style={{ color: 'var(--text-primary)' }}>{agent.name}</h3>
                        <Badge variant={agent.template === 'starter' ? 'teal' : 'gold'} size="sm">{agent.template}</Badge>
                      </div>
                      <p className="text-[10px] m-0" style={{ color: agent.color }}>{agent.tagline}</p>
                    </div>
                  </div>
                  <p className="text-xs m-0 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                    {agent.description}
                  </p>
                  <div className="flex items-center gap-1 text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
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
            <h2 className="text-xl font-display font-black m-0" style={{ color: 'var(--text-primary)' }}>
              Build your own agents
            </h2>
            <p className="text-sm m-0 max-w-md mx-auto" style={{ color: 'var(--text-secondary)' }}>
              These templates are starting points. Edit the prompts, add new agents, chain them through channels. The fleet is yours.
            </p>
            <div className="flex justify-center gap-3">
              <Link to="/tutorials/fleet">
                <motion.span
                  whileHover={{ scale: 1.02 }}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold cursor-pointer"
                  style={{
                    background: 'var(--brand-primary)',
                    color: 'white',
                  }}
                >
                  Fleet Tutorial <ArrowRight size={14} />
                </motion.span>
              </Link>
              <Link to="/tutorials/pheromone">
                <motion.span
                  whileHover={{ scale: 1.02 }}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold cursor-pointer"
                  style={{
                    background: 'color-mix(in srgb, var(--brand-primary) 12%, transparent)',
                    color: 'var(--brand-primary)',
                    border: '1px solid color-mix(in srgb, var(--brand-primary) 25%, transparent)',
                  }}
                >
                  Pheromone Trails <ArrowRight size={14} />
                </motion.span>
              </Link>
            </div>
          </Surface>
        </motion.div>
      </div>
    </div>
  )
}
