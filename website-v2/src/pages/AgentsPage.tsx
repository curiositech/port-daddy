import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/Badge'
import { Surface } from '@/components/ui/Surface'
import { CodeBlock } from '@/components/ui/CodeBlock'
import { ArrowRight, Terminal, Clock, Zap } from 'lucide-react'

const AGENTS = [
  {
    name: 'QA',
    slug: 'qa',
    tagline: 'Adversarial reviewer',
    pitch: 'Reviews every commit for bugs and edge cases. Writes failing tests that expose problems before they reach production.',
    how: 'Reads the diff, identifies risk surfaces, generates test cases.',
    trigger: 'git:committed',
    triggerType: 'event' as const,
    color: '#e74c3c',
    badge: 'starter' as const,
  },
  {
    name: 'Documentarian',
    slug: 'documentarian',
    tagline: 'Docs that match the code',
    pitch: 'Checks README, CHANGELOG, and API docs against actual source code. Updates anything stale. Code is truth; docs follow.',
    how: 'Diffs code against docs. Finds stale references and missing features. Edits in place.',
    trigger: 'git:committed',
    triggerType: 'event' as const,
    color: '#3498db',
    badge: 'starter' as const,
  },
  {
    name: 'Cartographer',
    slug: 'cartographer',
    tagline: 'Roadmap keeper',
    pitch: 'Tracks planned vs built. Flags stale items, measures velocity, reports where energy actually goes vs where you said it would.',
    how: 'Reads git log and roadmap. Moves items to "complete." Flags 2+ week gaps.',
    trigger: 'git:committed',
    triggerType: 'event' as const,
    color: '#2ecc71',
    badge: 'starter' as const,
  },
  {
    name: 'Spark',
    slug: 'spark',
    tagline: 'Idea engine',
    pitch: 'Proposes one concrete improvement every 30 minutes. Reads Spider\'s connections and turns them into buildable proposals.',
    how: 'Scans codebase and roadmap. Reads .spider/connections/. Saves proposals to .spark/ideas/.',
    trigger: '*/30 * * * *',
    triggerType: 'cron' as const,
    color: '#f0a500',
    badge: 'starter' as const,
  },
  {
    name: 'Spider',
    slug: 'spider',
    tagline: 'Connection finder',
    pitch: 'Discovers combinations of existing features that create new capabilities. "We have X AND Y, THEREFORE Z is now possible."',
    how: 'Reads feature manifest, module headers, git log. Outputs formal syllogisms.',
    trigger: 'spark:idea',
    triggerType: 'event' as const,
    color: '#9b59b6',
    badge: 'starter' as const,
  },
  {
    name: 'Health Monitor',
    slug: 'health-monitor',
    tagline: 'Watchdog',
    pitch: 'Checks service health every 5 minutes. Sprays pheromone signals so other agents back off when the system is stressed.',
    how: 'Calls health endpoint. Maps latency to a 0-1 signal. Other agents sniff before expensive ops.',
    trigger: '*/5 * * * *',
    triggerType: 'cron' as const,
    color: '#e74c3c',
    badge: 'always-on' as const,
  },
  {
    name: 'Session Reaper',
    slug: 'session-reaper',
    tagline: 'Zombie hunter',
    pitch: 'Finds sessions active for hours without notes. Flags them as abandoned so humans or other agents can reclaim the work.',
    how: 'Queries active sessions. Compares creation time to note count.',
    trigger: '0 * * * *',
    triggerType: 'cron' as const,
    color: '#7f8c8d',
    badge: 'always-on' as const,
  },
  {
    name: 'Dep Watcher',
    slug: 'dep-watcher',
    tagline: 'Security auditor',
    pitch: 'Runs dependency audits daily. Reports vulnerabilities, major version bumps, and deprecation notices.',
    how: 'Runs npm outdated and npm audit. Saves timestamped reports.',
    trigger: '0 9 * * *',
    triggerType: 'cron' as const,
    color: '#e67e22',
    badge: 'always-on' as const,
  },
]

export function AgentsPage() {
  return (
    <div className="min-h-screen pt-28 pb-24" style={{ background: 'var(--surface-base)' }}>
      <div className="max-w-5xl mx-auto px-6 lg:px-8">

        {/* Header */}
        <header className="mb-12 text-center">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
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
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-4xl sm:text-5xl font-display font-black tracking-tighter mb-4"
            style={{ color: 'var(--text-primary)' }}
          >
            You commit. They work.
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-base max-w-xl mx-auto leading-relaxed"
            style={{ color: 'var(--text-secondary)' }}
          >
            Imagine pushing code and walking away. By the time you make coffee, a QA agent has reviewed your commit, a documentarian has updated your README, and a cartographer has checked off a roadmap item. All in the background, all declared in one YAML file.
          </motion.p>
        </header>

        {/* How It Works */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mb-16"
        >
          <Surface depth="raised" radius="2xl" padding="lg" className="space-y-6">
            <h2 className="text-xl font-display font-black m-0" style={{ color: 'var(--text-primary)' }}>
              How it works
            </h2>
            <p className="text-sm leading-relaxed m-0" style={{ color: 'var(--text-secondary)' }}>
              A fleet is a YAML file at your project root. Each agent has a <strong>trigger</strong> (a pub/sub channel or cron schedule), a <strong>backend</strong> (Claude, Ollama, or any shell command), and a <strong>prompt</strong>. You define the agents. Port Daddy runs them.
            </p>

            <div className="grid sm:grid-cols-3 gap-4">
              <Surface depth="inset" radius="lg" padding="md" className="space-y-2">
                <div className="flex items-center gap-2">
                  <Zap size={14} style={{ color: 'var(--brand-primary)' }} />
                  <p className="text-xs font-bold m-0" style={{ color: 'var(--text-primary)' }}>Event-triggered</p>
                </div>
                <p className="text-xs m-0" style={{ color: 'var(--text-secondary)' }}>
                  Fires when a message hits a pub/sub channel. Wire a git post-commit hook to <code>git:committed</code> and agents react to every push.
                </p>
              </Surface>
              <Surface depth="inset" radius="lg" padding="md" className="space-y-2">
                <div className="flex items-center gap-2">
                  <Clock size={14} style={{ color: 'var(--brand-primary)' }} />
                  <p className="text-xs font-bold m-0" style={{ color: 'var(--text-primary)' }}>Cron-scheduled</p>
                </div>
                <p className="text-xs m-0" style={{ color: 'var(--text-secondary)' }}>
                  Runs on a timer. Every 10 minutes, every hour, once a day. Good for health checks, cleanup, and creative ideation.
                </p>
              </Surface>
              <Surface depth="inset" radius="lg" padding="md" className="space-y-2">
                <div className="flex items-center gap-2">
                  <ArrowRight size={14} style={{ color: 'var(--brand-primary)' }} />
                  <p className="text-xs font-bold m-0" style={{ color: 'var(--text-primary)' }}>Chained</p>
                </div>
                <p className="text-xs m-0" style={{ color: 'var(--text-secondary)' }}>
                  One agent&apos;s output triggers another. QA publishes to <code>qa:findings</code>; a notifier agent reacts. Ideas compound.
                </p>
              </Surface>
            </div>

            <p className="text-sm leading-relaxed m-0" style={{ color: 'var(--text-secondary)' }}>
              The agents below are <strong>examples that ship with Port Daddy</strong>. You can use them as-is, modify their prompts, or define entirely new agents. Any trigger, custom shell commands, and the current built-in runtimes: Claude, Claude CLI, Gemini, Ollama, and Aider.
            </p>

            <CodeBlock language="bash">{`# Example: your own custom agent
# pd-fleet.yml
fleet:
  agents:
    my-linter:
      trigger: git:committed
      backend: custom                   # Any shell command
      prompt: "npx eslint --fix ."
      on_success: publish lint:clean

    my-reviewer:
      schedule: "0 */4 * * *"           # Every 4 hours
      backend: claude-cli               # Full Claude Code
      allowedTools: "Read,Grep,Glob"
      prompt: |
        Find code smells in src/. Suggest fixes.`}</CodeBlock>
          </Surface>
        </motion.div>

        {/* Agent grid */}
        <div className="flex flex-wrap justify-center gap-4 mb-16">
          {AGENTS.map((agent) => (
            <a
              key={agent.slug}
              href={`#${agent.slug}`}
              className="flex flex-col items-center gap-2 group no-underline"
            >
              <Surface depth="raised" radius="xl" padding="none" className="w-16 h-16 overflow-hidden transition-all group-hover:shadow-[var(--shadow-sm)]">
                <img
                  src={`/img/agents/${agent.slug}.png`}
                  alt={agent.name}
                  className="w-full h-full object-cover"
                />
              </Surface>
              <span className="text-[11px] font-bold" style={{ color: agent.color }}>{agent.name}</span>
            </a>
          ))}
        </div>

        {/* Agent Cards — compact horizontal layout */}
        <div className="space-y-4">
          {AGENTS.map((agent, i) => (
            <motion.div
              key={agent.slug}
              id={agent.slug}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
              viewport={{ once: true }}
            >
              <Surface depth="raised" radius="xl" padding="none" className="overflow-hidden">
                <div className="flex items-stretch">
                  {/* Small image accent */}
                  <div className="w-28 sm:w-36 flex-shrink-0 relative overflow-hidden hidden sm:block">
                    <img
                      src={`/img/agents/${agent.slug}.png`}
                      alt={agent.name}
                      className="absolute inset-0 w-full h-full object-cover"
                      loading="lazy"
                    />
                  </div>

                  {/* Content */}
                  <div className="flex-1 p-5 sm:p-6 space-y-3">
                    <div className="flex items-center gap-3 flex-wrap">
                      {/* Mobile-only small image */}
                      <div className="w-10 h-10 rounded-lg overflow-hidden sm:hidden flex-shrink-0">
                        <img src={`/img/agents/${agent.slug}.png`} alt="" className="w-full h-full object-cover" />
                      </div>
                      <h2 className="text-lg font-display font-black m-0" style={{ color: 'var(--text-primary)' }}>
                        {agent.name}
                      </h2>
                      <span className="text-xs font-semibold" style={{ color: agent.color }}>
                        {agent.tagline}
                      </span>
                      <Badge variant={agent.badge === 'starter' ? 'teal' : 'gold'} size="sm">{agent.badge}</Badge>
                      <div className="ml-auto flex items-center gap-1.5 text-[10px] font-mono px-2 py-0.5 rounded-full"
                        style={{
                          background: 'color-mix(in srgb, var(--text-muted) 10%, transparent)',
                          color: 'var(--text-muted)',
                        }}
                      >
                        {agent.triggerType === 'event' ? <Zap size={10} /> : <Clock size={10} />}
                        <code>{agent.trigger}</code>
                      </div>
                    </div>

                    <p className="text-sm leading-relaxed m-0" style={{ color: 'var(--text-secondary)' }}>
                      {agent.pitch}
                    </p>

                    <p className="text-xs m-0" style={{ color: 'var(--text-muted)' }}>
                      <strong style={{ color: 'var(--text-secondary)' }}>How:</strong> {agent.how}
                    </p>
                  </div>
                </div>
              </Surface>
            </motion.div>
          ))}
        </div>

        {/* Quick Start */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mt-16"
        >
          <Surface depth="raised" radius="2xl" padding="lg" className="space-y-5">
            <h2 className="text-xl font-display font-black m-0" style={{ color: 'var(--text-primary)' }}>
              Add them to any project in 10 seconds
            </h2>
            <CodeBlock language="bash">{`cd ~/my-project
pd fleet init          # Creates pd-fleet.yml + git hook
pd fleet up            # Starts the fleet
git commit -m "test"   # All triggered agents fire`}</CodeBlock>
            <p className="text-xs m-0" style={{ color: 'var(--text-muted)' }}>
              The git hook publishes to <code>git:committed</code> on every commit. Fleet agents with that trigger fire automatically. Scheduled agents run on their cron. All output goes to <code>.spark/</code>, <code>.spider/</code>, <code>.cartographer/</code>.
            </p>
            <div className="flex gap-3 pt-1">
              <Link to="/tutorials/fleet">
                <motion.span
                  whileHover={{ scale: 1.02 }}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold cursor-pointer"
                  style={{ background: 'var(--brand-primary)', color: 'var(--text-inverse)' }}
                >
                  Fleet Tutorial <ArrowRight size={14} />
                </motion.span>
              </Link>
              <Link to="/templates">
                <motion.span
                  whileHover={{ scale: 1.02 }}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold cursor-pointer"
                  style={{
                    background: 'color-mix(in srgb, var(--brand-primary) 12%, transparent)',
                    color: 'var(--brand-primary)',
                    border: '1px solid color-mix(in srgb, var(--brand-primary) 25%, transparent)',
                  }}
                >
                  YAML Templates <ArrowRight size={14} />
                </motion.span>
              </Link>
            </div>
          </Surface>
        </motion.div>
      </div>
    </div>
  )
}
