import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { CodeBlock } from '@/components/ui/CodeBlock'
import {
  Shield, Map, Zap, Network, Eye, Clock,
  ArrowRight, GitCommit, Heart, BookOpen, Search,
} from 'lucide-react'
import { Footer } from '@/components/layout/Footer'
import {
  PageContainer,
  PanelBody,
  PanelEyebrow,
  PanelTitle,
  SurfacePanel,
} from '@/components/site/primitives'

const META_TEXT_CLASS =
  'font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)]'
const META_MONO_CLASS =
  'font-mono text-[length:var(--type-meta-size)] tracking-[var(--tracking-meta)]'

const AGENTS = [
  {
    name: 'QA',
    icon: <Shield className="h-5 w-5" />,
    job: 'Reads each new commit and writes tests that try to break it. Reports the bugs and edge cases it found.',
    runs: 'On every commit',
    pack: 'Starter',
  },
  {
    name: 'Documentarian',
    icon: <BookOpen className="h-5 w-5" />,
    job: 'Compares the README, CHANGELOG, and API docs against the code. Rewrites whatever no longer matches.',
    runs: 'On every commit',
    pack: 'Starter',
  },
  {
    name: 'Cartographer',
    icon: <Map className="h-5 w-5" />,
    job: 'Tracks what was planned against what shipped. Updates the roadmap and flags items that have gone stale.',
    runs: 'On every commit',
    pack: 'Starter',
  },
  {
    name: 'Spark',
    icon: <Zap className="h-5 w-5" />,
    job: 'Proposes one concrete, buildable improvement every half hour, drawn from the connections Spider finds.',
    runs: 'Every 30 minutes',
    pack: 'Starter',
  },
  {
    name: 'Spider',
    icon: <Network className="h-5 w-5" />,
    job: 'Looks for features that combine into something new. Writes it as: we have X and Y, so we could build Z.',
    runs: 'After Spark, every 2 hours',
    pack: 'Starter',
  },
  {
    name: 'Health Monitor',
    icon: <Heart className="h-5 w-5" />,
    job: 'Checks that services are responding. When the machine is under load, it tells the other agents to ease off.',
    runs: 'Every 5 minutes',
    pack: 'Always-on',
  },
  {
    name: 'Session Reaper',
    icon: <Clock className="h-5 w-5" />,
    job: 'Finds sessions that have sat idle for hours and marks them as likely abandoned so you can clean them up.',
    runs: 'Hourly',
    pack: 'Always-on',
  },
  {
    name: 'Dep Watcher',
    icon: <Search className="h-5 w-5" />,
    job: 'Runs npm outdated and npm audit. Reports security advisories, major version jumps, and deprecations.',
    runs: 'Daily',
    pack: 'Always-on',
  },
]

export function TemplatesPage() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex min-h-screen flex-col bg-[var(--surface-base)] font-sans"
    >
      <section className="border-b-2 border-[var(--border-strong)] py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]">
        <PageContainer width="wide">
          <div className="space-y-[var(--space-6)]">
            <PanelEyebrow>Fleet templates</PanelEyebrow>
            <PanelTitle as="h1" size="hero" className="max-w-[16ch]">
              Ready-made agents you copy into a project.
            </PanelTitle>
            <PanelBody size="default" className="max-w-[44rem] text-[length:var(--text-lg)]">
              A fleet is a set of background agents that watch your repo and do small jobs: review
              commits, keep docs current, propose ideas. Each pack is a <code>pd-fleet.yml</code> file
              you drop in your project root. Run <code>pd fleet up</code> and the agents start
              working. You decide which ones to keep.
            </PanelBody>
          </div>
        </PageContainer>
      </section>

      <main className="flex-1 py-[var(--section-space-y)]">
        <PageContainer width="wide">
          <figure className="mb-[var(--space-8)] overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]">
            <picture>
              <source srcSet="/img/generated/virtual-actor-fleet.webp" type="image/webp" />
              <img
                src="/img/generated/virtual-actor-fleet.jpg"
                alt="Diagram of named agents, their triggers, and the shared memory they read and write"
                className="block aspect-[16/7] w-full object-cover"
              />
            </picture>
          </figure>

          {/* Quick start */}
          <section className="mb-[var(--space-8)]">
            <SurfacePanel className="space-y-[var(--space-4)]">
              <PanelEyebrow>Three commands to start</PanelEyebrow>
              <PanelTitle as="h2" size="section" className="max-w-[20ch]">
                One command writes the config. The next two run it.
              </PanelTitle>
              <CodeBlock language="bash">{`cd ~/my-project
pd fleet init          # writes pd-fleet.yml, a git hook, and output folders
pd fleet up            # starts the agents
git commit -m "test"   # QA, docs, and cartographer run on the commit`}</CodeBlock>
              <PanelBody size="compact" className="max-w-[44rem]">
                You need Port Daddy running (<code>pd start</code>) and an{' '}
                <code>ANTHROPIC_API_KEY</code> in <code>.env.local</code>.
              </PanelBody>
            </SurfacePanel>
          </section>

          {/* Packs */}
          <section className="mb-[var(--space-8)]">
            <div className="mb-[var(--space-6)] space-y-[var(--space-3)]">
              <PanelEyebrow>Two packs</PanelEyebrow>
              <PanelTitle as="h2" size="section" className="max-w-[24ch]">
                Pick a starting point. Add or drop agents later.
              </PanelTitle>
            </div>

            <div className="grid gap-[var(--space-4)] sm:grid-cols-2">
              <SurfacePanel className="space-y-[var(--space-4)]">
                <div className="flex items-center gap-[var(--space-3)]">
                  <span className="flex h-11 w-11 items-center justify-center border-2 border-[var(--border-strong)] bg-[var(--surface-base)] text-[var(--brand-primary)]">
                    <GitCommit size={20} />
                  </span>
                  <div className="space-y-[var(--space-1)]">
                    <PanelTitle as="h3" size="nav">
                      Starter pack
                    </PanelTitle>
                    <span className={`${META_TEXT_CLASS} text-[var(--text-muted)]`}>
                      Five agents, run on each commit
                    </span>
                  </div>
                </div>
                <PanelBody size="compact" className="max-w-none">
                  QA, Documentarian, and Cartographer run when you commit. Spark and Spider look for
                  new ideas on a timer. Includes the git post-commit hook.
                </PanelBody>
                <CodeBlock language="bash">{`pd fleet init
# or copy it by hand:
cp templates/pd-fleet-starter.yml pd-fleet.yml`}</CodeBlock>
              </SurfacePanel>

              <SurfacePanel className="space-y-[var(--space-4)]">
                <div className="flex items-center gap-[var(--space-3)]">
                  <span className="flex h-11 w-11 items-center justify-center border-2 border-[var(--border-strong)] bg-[var(--surface-base)] text-[var(--brand-accent-foreground)]">
                    <Eye size={20} />
                  </span>
                  <div className="space-y-[var(--space-1)]">
                    <PanelTitle as="h3" size="nav">
                      Always-on pack
                    </PanelTitle>
                    <span className={`${META_TEXT_CLASS} text-[var(--text-muted)]`}>
                      Five agents, run on a timer
                    </span>
                  </div>
                </div>
                <PanelBody size="compact" className="max-w-none">
                  Health monitor, session reaper, and dependency watcher keep an eye on the running
                  system between commits, so you see problems as they appear.
                </PanelBody>
                <CodeBlock language="bash">{`# add it to your existing pd-fleet.yml:
cat templates/pd-fleet-always-on.yml >> pd-fleet.yml`}</CodeBlock>
              </SurfacePanel>
            </div>
          </section>

          {/* Agent list */}
          <section className="mb-[var(--space-8)]">
            <div className="mb-[var(--space-6)] space-y-[var(--space-3)]">
              <PanelEyebrow>The agents</PanelEyebrow>
              <PanelTitle as="h2" size="section" className="max-w-[24ch]">
                Each agent has one job and one trigger.
              </PanelTitle>
              <PanelBody size="compact" className="max-w-[44rem]">
                Mix and match them. An agent does its job, writes what it found to shared memory, and
                the next agent can read it.
              </PanelBody>
            </div>

            <div className="grid gap-[var(--space-4)] sm:grid-cols-2">
              {AGENTS.map((agent, i) => (
                <motion.article
                  key={agent.name}
                  initial={{ opacity: 0, y: 12 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                  viewport={{ once: true }}
                  className="h-full border-2 border-[var(--border-strong)] bg-[var(--surface-base)] p-[var(--space-5)]"
                >
                  <div className="flex h-full flex-col gap-[var(--space-3)]">
                    <div className="flex items-center justify-between border-b-2 border-[var(--border-strong)] pb-[var(--space-3)]">
                      <div className="flex items-center gap-[var(--space-3)]">
                        <span className="flex h-9 w-9 items-center justify-center border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] text-[var(--brand-primary)]">
                          {agent.icon}
                        </span>
                        <PanelTitle as="h3" size="nav">
                          {agent.name}
                        </PanelTitle>
                      </div>
                      <span className={`${META_TEXT_CLASS} text-[var(--text-muted)]`}>
                        {agent.pack}
                      </span>
                    </div>
                    <PanelBody size="compact" className="max-w-none flex-1">
                      {agent.job}
                    </PanelBody>
                    <div className="flex items-center gap-[var(--space-2)] border-t-2 border-[var(--border-strong)] pt-[var(--space-3)] text-[var(--text-muted)]">
                      <Clock size={14} />
                      <span className={META_MONO_CLASS}>{agent.runs}</span>
                    </div>
                  </div>
                </motion.article>
              ))}
            </div>
          </section>

          {/* Make it yours */}
          <section className="border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-6)] lg:p-[var(--space-7)]">
            <div className="grid gap-[var(--space-5)] lg:grid-cols-[minmax(0,0.7fr)_minmax(16rem,0.3fr)] lg:items-end">
              <div className="space-y-[var(--space-4)]">
                <PanelEyebrow>Make it yours</PanelEyebrow>
                <PanelTitle as="h2" size="section" className="max-w-[18ch]">
                  These are starting points, not fixed kits.
                </PanelTitle>
                <PanelBody size="default" className="max-w-[44rem]">
                  Edit an agent's prompt, change when it runs, add your own, or wire one agent's
                  output into another. The fleet is just a YAML file in your repo.
                </PanelBody>
              </div>

              <div className="flex flex-col gap-[var(--space-3)]">
                <Button asChild>
                  <Link to="/tutorials/fleet">
                    Fleet tutorial <ArrowRight size={14} />
                  </Link>
                </Button>
                <Button asChild variant="secondary">
                  <Link to="/tutorials/primitives">
                    Coordination basics <ArrowRight size={14} />
                  </Link>
                </Button>
              </div>
            </div>
          </section>
        </PageContainer>
      </main>

      <Footer />
    </motion.div>
  )
}
