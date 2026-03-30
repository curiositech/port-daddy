import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/Badge'
import { Surface } from '@/components/ui/Surface'
import { ArrowRight, Terminal } from 'lucide-react'

const AGENTS = [
  {
    name: 'QA',
    slug: 'qa',
    tagline: 'The adversarial reviewer',
    description: 'Reviews every commit for bugs, edge cases, and inputs that would break the change. Writes failing tests that expose the problem before it reaches production.',
    how: 'Reads the diff, identifies risk surfaces, generates test cases. Publishes to qa:clean or qa:findings so downstream agents react.',
    trigger: 'git:committed',
    color: '#e74c3c',
    badge: 'starter',
  },
  {
    name: 'Documentarian',
    slug: 'documentarian',
    tagline: 'Docs that match the code',
    description: 'Checks README, CHANGELOG, API docs, and website content against actual source code. Updates anything that has drifted. Code is truth; docs follow.',
    how: 'Diffs the code against the docs. Finds stale references, missing features, outdated examples. Edits in place.',
    trigger: 'git:committed',
    color: '#3498db',
    badge: 'starter',
  },
  {
    name: 'Cartographer',
    slug: 'cartographer',
    tagline: 'The roadmap keeper',
    description: 'Tracks what was planned versus what was built. Updates roadmaps, flags stale items, measures velocity, and reports where energy is actually going versus where you said it would.',
    how: 'Reads git log and the roadmap file. Moves items from "planned" to "complete." Flags items with no commits in 2+ weeks. Saves a status report.',
    trigger: 'git:committed',
    color: '#2ecc71',
    badge: 'starter',
  },
  {
    name: 'Spark',
    slug: 'spark',
    tagline: 'The idea engine',
    description: 'Proposes one concrete improvement every 30 minutes. Reads Spider\'s connection findings and turns abstract possibilities into buildable proposals with implementation sketches.',
    how: 'Scans the codebase, roadmap, and recent commits. Reads .spider/connections/ for compound ideas. Saves proposals to .spark/ideas/.',
    trigger: 'Every 30 minutes',
    color: '#f0a500',
    badge: 'starter',
  },
  {
    name: 'Spider',
    slug: 'spider',
    tagline: 'The connection finder',
    description: 'Discovers combinations of existing features that create new capabilities nobody has noticed. Outputs formal syllogisms: "We have X AND Y, THEREFORE Z is now possible."',
    how: 'Reads the feature manifest, module headers, and git log. Produces 5-10 syllogisms per run with confidence scores and implementation sketches. Saves to .spider/connections/.',
    trigger: 'spark:idea + every 2 hours',
    color: '#9b59b6',
    badge: 'starter',
  },
  {
    name: 'Health Monitor',
    slug: 'health-monitor',
    tagline: 'The watchdog',
    description: 'Checks service health every 5 minutes. Sprays pheromone health signals so other agents automatically back off when the system is under stress. No alerts to configure — the swarm self-regulates.',
    how: 'Calls the health endpoint. Maps response latency to a 0-1 pheromone signal. Other agents sniff this before expensive operations.',
    trigger: 'Every 5 minutes',
    color: '#e74c3c',
    badge: 'always-on',
  },
  {
    name: 'Session Reaper',
    slug: 'session-reaper',
    tagline: 'The zombie hunter',
    description: 'Finds sessions that have been active for hours without producing notes. Flags them as potentially abandoned so humans or other agents can reclaim the work.',
    how: 'Queries active sessions. Compares creation time to note count. Reports sessions with high age and zero activity.',
    trigger: 'Every hour',
    color: '#7f8c8d',
    badge: 'always-on',
  },
  {
    name: 'Dep Watcher',
    slug: 'dep-watcher',
    tagline: 'The security auditor',
    description: 'Runs dependency audits daily. Reports known vulnerabilities, major version bumps, and deprecation notices before they become emergencies.',
    how: 'Runs npm outdated and npm audit. Saves a timestamped report. Flags critical CVEs.',
    trigger: 'Daily at 9am',
    color: '#e67e22',
    badge: 'always-on',
  },
]

export function AgentsPage() {
  return (
    <div className="min-h-screen pt-32 pb-24" style={{ background: 'var(--surface-base)' }}>
      <div className="max-w-6xl mx-auto px-6 lg:px-8">
        {/* Header */}
        <header className="mb-20 text-center">
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
            pd fleet init
          </motion.div>
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-4xl sm:text-6xl font-display font-black tracking-tighter mb-6"
            style={{ color: 'var(--text-primary)' }}
          >
            Meet the <span style={{ color: 'var(--brand-primary)' }}>Fleet.</span>
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-lg max-w-2xl mx-auto leading-relaxed"
            style={{ color: 'var(--text-secondary)' }}
          >
            Eight agent archetypes that run in the background. Drop them into any project with one command. Each has a role, a trigger, and a communication channel.
          </motion.p>
        </header>

        {/* Agent Cards */}
        <div className="space-y-24">
          {AGENTS.map((agent, i) => (
            <motion.div
              key={agent.slug}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              viewport={{ once: true, margin: '-50px' }}
            >
              <div className={`grid lg:grid-cols-2 gap-10 items-center ${i % 2 === 1 ? 'lg:direction-rtl' : ''}`}
                style={i % 2 === 1 ? { direction: 'rtl' } : undefined}
              >
                {/* Image */}
                <div style={i % 2 === 1 ? { direction: 'ltr' } : undefined}>
                  <Surface depth="raised" radius="2xl" padding="none" className="overflow-hidden">
                    <img
                      src={`/img/agents/${agent.slug}.png`}
                      alt={`${agent.name} agent icon`}
                      className="w-full h-auto block"
                      loading="lazy"
                    />
                  </Surface>
                </div>

                {/* Copy */}
                <div className="space-y-5" style={i % 2 === 1 ? { direction: 'ltr' } : undefined}>
                  <div className="flex items-center gap-3">
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{ background: agent.color }}
                    />
                    <Badge variant={agent.badge === 'starter' ? 'teal' : 'gold'} size="sm">{agent.badge}</Badge>
                  </div>

                  <h2 className="text-3xl font-display font-black m-0" style={{ color: 'var(--text-primary)' }}>
                    {agent.name}
                  </h2>
                  <p className="text-sm font-semibold m-0" style={{ color: agent.color }}>
                    {agent.tagline}
                  </p>

                  <p className="text-base leading-relaxed m-0" style={{ color: 'var(--text-secondary)' }}>
                    {agent.description}
                  </p>

                  <Surface depth="inset" radius="xl" padding="md" className="space-y-2">
                    <p className="text-xs font-bold m-0" style={{ color: 'var(--text-primary)' }}>How it works</p>
                    <p className="text-xs leading-relaxed m-0" style={{ color: 'var(--text-secondary)' }}>
                      {agent.how}
                    </p>
                  </Surface>

                  <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                    <span className="font-mono">trigger:</span>
                    <code style={{ color: 'var(--brand-primary)' }}>{agent.trigger}</code>
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>

        {/* CTA */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mt-32 text-center"
        >
          <Surface depth="raised" radius="2xl" padding="xl" className="max-w-2xl mx-auto space-y-6">
            <h2 className="text-2xl font-display font-black m-0" style={{ color: 'var(--text-primary)' }}>
              Add them to your project
            </h2>
            <p className="text-sm m-0" style={{ color: 'var(--text-secondary)' }}>
              One command creates the fleet YAML, installs the git hook, and sets up output directories. Edit the prompts to fit your project. The fleet is yours.
            </p>
            <Surface depth="inset" radius="lg" padding="md">
              <code className="text-sm font-mono" style={{ color: 'var(--brand-primary)' }}>
                cd ~/my-project && pd fleet init && pd fleet up
              </code>
            </Surface>
            <div className="flex justify-center gap-3 pt-2">
              <Link to="/tutorials/fleet">
                <motion.span
                  whileHover={{ scale: 1.02 }}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold cursor-pointer"
                  style={{ background: 'var(--brand-primary)', color: 'white' }}
                >
                  Fleet Tutorial <ArrowRight size={14} />
                </motion.span>
              </Link>
              <Link to="/templates">
                <motion.span
                  whileHover={{ scale: 1.02 }}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold cursor-pointer"
                  style={{
                    background: 'color-mix(in srgb, var(--brand-primary) 12%, transparent)',
                    color: 'var(--brand-primary)',
                    border: '1px solid color-mix(in srgb, var(--brand-primary) 25%, transparent)',
                  }}
                >
                  View Templates <ArrowRight size={14} />
                </motion.span>
              </Link>
            </div>
          </Surface>
        </motion.div>
      </div>
    </div>
  )
}
