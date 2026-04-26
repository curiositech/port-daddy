import { motion } from 'framer-motion'
import { TutorialLayout } from '@/components/tutorials/TutorialLayout'
import { CodeBlock } from '@/components/ui/CodeBlock'
import { Surface } from '@/components/ui/Surface'
import { Flame, Droplets, MapPin, AlertTriangle, Timer, Eye, BarChart3 } from 'lucide-react'

export function Pheromone() {
  return (
    <TutorialLayout
      title="Pheromone Trails: How Agents Leave Breadcrumbs"
      description="Ants don't talk. They leave chemical trails that decay over time. Your agents can do the same. Learn how pheromone signals create ambient awareness without direct communication."
      number={20}
      total={20}
      level="Intermediate"
      readTime="8 min read"
      prev={{ title: 'Fleet Agents', href: '/tutorials/fleet' }}
      next={undefined}
    >
      <motion.div className="space-y-16">
        {/* Intro */}
        <section className="space-y-6">
          <motion.div className="flex items-center gap-4 mb-8">
            <Surface depth="inset" radius="2xl" padding="none" className="w-12 h-12 flex items-center justify-center">
              <Droplets className="text-[var(--brand-accent)]" size={24} />
            </Surface>
            <motion.h2 className="m-0">Stigmergy: Communication Without Conversation</motion.h2>
          </motion.div>
          <motion.p>
            In ant colonies, foragers don&apos;t coordinate by talking. They leave pheromone trails on the ground. Other ants follow strong trails and ignore fading ones. The trail <em>is</em> the coordination &mdash; no central planner, no message passing.
          </motion.p>
          <motion.p>
            Port Daddy&apos;s pheromone system works the same way. Any agent can <strong>spray</strong> a numeric signal (0 to 1) onto any entity &mdash; a service, an agent, a session, a lock. The signal <strong>decays over time</strong> automatically. Other agents <strong>sniff</strong> the signal and adjust their behavior based on its strength.
          </motion.p>
          <motion.p>
            No channels. No subscriptions. No polling. Just ambient signals that fade.
          </motion.p>
        </section>

        {/* Step 1: Spray */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <Surface depth="inset" radius="2xl" padding="none" className="w-12 h-12 flex items-center justify-center">
              <Flame className="text-[var(--brand-primary)]" size={24} />
            </Surface>
            <motion.h2 className="m-0">1. Spray a Signal</motion.h2>
          </motion.div>

          <motion.p>
            An agent that just spent 5 minutes working on a file can announce its intensity:
          </motion.p>

          <CodeBlock language="bash">{`# Mark a service as "hot" (being actively worked on)
pd pheromone spray --table services --id myapp:api:main --key urgency --strength 0.8

# Mark an agent's work quality
pd pheromone spray --table agents --id spider-42 --key quality --strength 0.95

# Via the API
curl -X POST http://localhost:9876/pheromone/spray \\
  -H 'Content-Type: application/json' \\
  -d '{"table": "services", "id": "myapp:api:main", "key": "urgency", "strength": 0.8}'`}</CodeBlock>

          <motion.p>
            The signal is stored as metadata on the entity. It doesn&apos;t create a new record &mdash; it annotates what already exists. <code>strength</code> must be between 0 and 1.
          </motion.p>
        </section>

        {/* Step 2: Sniff */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <Surface depth="inset" radius="2xl" padding="none" className="w-12 h-12 flex items-center justify-center">
              <Eye className="text-[var(--brand-secondary)]" size={24} />
            </Surface>
            <motion.h2 className="m-0">2. Sniff a Signal (Read-Time Decay)</motion.h2>
          </motion.div>

          <motion.p>
            Here&apos;s the key insight: <strong>pheromones decay when you read them, not when you write them.</strong> Every time an agent sniffs a signal, the value returned reflects how much time has passed since it was sprayed. Old signals are weaker. Fresh signals are strong.
          </motion.p>

          <CodeBlock language="bash">{`# Read all pheromone values for an entity
pd pheromone sniff --table services --id myapp:api:main

# Response:
# {
#   "urgency": 0.62,    <-- was 0.8 when sprayed 20 minutes ago
#   "contention": 0.1   <-- was 0.5 when sprayed 2 hours ago
# }`}</CodeBlock>

          <Surface depth="raised" radius="2xl" className="p-6 space-y-3">
            <motion.div className="flex items-center gap-2">
              <Timer size={16} className="text-[var(--brand-accent)]" />
              <motion.p className="text-sm font-bold m-0">Decay Math</motion.p>
            </motion.div>
            <motion.p className="text-xs text-[var(--text-secondary)] m-0">
              The decay is geometric: <code>value = original * decay_rate ^ minutes_elapsed</code>. Default decay rate is 0.95, so a signal of 1.0 decays to 0.54 after 12 minutes, 0.13 after an hour, and effectively 0 after a few hours. You never have to clean up &mdash; signals self-heal.
            </motion.p>
          </Surface>
        </section>

        {/* Step 3: File Heat Map */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <Surface depth="inset" radius="2xl" padding="none" className="w-12 h-12 flex items-center justify-center">
              <BarChart3 className="text-[var(--brand-accent)]" size={24} />
            </Surface>
            <motion.h2 className="m-0">3. The File Heat Map</motion.h2>
          </motion.div>

          <motion.p>
            The most practical use of pheromones: <strong>which files are your agents fighting over?</strong>
          </motion.p>

          <motion.p>
            The file heat map aggregates session file claims into per-file contention scores. Files claimed by multiple active sessions glow red. Files with a single owner glow green. Files nobody has touched are cold.
          </motion.p>

          <CodeBlock language="bash">{`# See which files are hottest right now
curl http://localhost:9876/pheromone/files

# Filter to a directory
curl http://localhost:9876/pheromone/files?path=src/lib/&depth=1

# Response:
# {
#   "files": [
#     { "path": "src/lib/sessions.ts", "heat": 0.87, "activeClaims": 2, "conflict": true },
#     { "path": "src/lib/agents.ts",   "heat": 0.45, "activeClaims": 1, "conflict": false },
#     { "path": "src/lib/trie.ts",     "heat": 0.12, "activeClaims": 0, "conflict": false }
#   ],
#   "summary": { "totalFiles": 3, "activeConflicts": 1 }
# }`}</CodeBlock>

          <Surface depth="raised" radius="2xl" className="p-6 space-y-3">
            <motion.div className="flex items-center gap-2">
              <AlertTriangle size={16} className="text-[var(--status-warning)]" />
              <motion.p className="text-sm font-bold m-0">Conflict Detection</motion.p>
            </motion.div>
            <motion.p className="text-xs text-[var(--text-secondary)] m-0">
              When <code>conflict: true</code>, two or more active sessions have claimed the same file. This is the advisory warning that someone else is working here. The dashboard shows these as red CONFLICT badges in the heat map panel.
            </motion.p>
          </Surface>
        </section>

        {/* Step 4: Use Cases */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <Surface depth="inset" radius="2xl" padding="none" className="w-12 h-12 flex items-center justify-center">
              <MapPin className="text-[var(--brand-primary)]" size={24} />
            </Surface>
            <motion.h2 className="m-0">4. What Can You Do With This?</motion.h2>
          </motion.div>

          <motion.div className="grid sm:grid-cols-2 gap-6">
            <Surface depth="raised" radius="2xl" className="p-6 space-y-3">
              <motion.h3 className="text-sm font-bold m-0">Adaptive Arbiter</motion.h3>
              <motion.p className="text-xs text-[var(--text-secondary)] m-0">
                The Arbiter checks invariants with fixed thresholds. With pheromones, agents with high <code>anomaly</code> signals get stricter checks. The rules tighten automatically for suspicious agents and relax for trusted ones.
              </motion.p>
            </Surface>
            <Surface depth="raised" radius="2xl" className="p-6 space-y-3">
              <motion.h3 className="text-sm font-bold m-0">Hot-File Routing</motion.h3>
              <motion.p className="text-xs text-[var(--text-secondary)] m-0">
                When a file is hot (many agents competing), new lock requests can be routed to the agent that already holds the most claims in that directory &mdash; the &ldquo;local expert.&rdquo;
              </motion.p>
            </Surface>
            <Surface depth="raised" radius="2xl" className="p-6 space-y-3">
              <motion.h3 className="text-sm font-bold m-0">Reputation Scoring</motion.h3>
              <motion.p className="text-xs text-[var(--text-secondary)] m-0">
                After reviewing an agent&apos;s output, spray <code>quality</code> onto its identity. Agents with high quality signals get preferred for important tasks. Low-quality agents get demoted to cheaper backends.
              </motion.p>
            </Surface>
            <Surface depth="raised" radius="2xl" className="p-6 space-y-3">
              <motion.h3 className="text-sm font-bold m-0">Daemon Health</motion.h3>
              <motion.p className="text-xs text-[var(--text-secondary)] m-0">
                A watchdog sprays <code>health</code> onto the daemon based on response latency. Agents check this before expensive operations and back off when the daemon is struggling.
              </motion.p>
            </Surface>
          </motion.div>
        </section>

        {/* Quick Reference */}
        <section className="space-y-6">
          <Surface depth="raised" radius="2xl" className="p-8 space-y-4">
            <motion.h3 className="text-lg font-display font-black m-0">Quick Reference</motion.h3>
            <motion.div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[var(--text-secondary)]">
                    <th className="pb-2 pr-4">Endpoint</th>
                    <th className="pb-2 pr-4">Method</th>
                    <th className="pb-2">Purpose</th>
                  </tr>
                </thead>
                <tbody className="text-[var(--text-secondary)]">
                  <tr><td className="py-1 pr-4"><code>/pheromone/spray</code></td><td className="pr-4">POST</td><td>Set a signal on an entity</td></tr>
                  <tr><td className="py-1 pr-4"><code>/pheromone/:table/:id</code></td><td className="pr-4">GET</td><td>Read signals (with decay)</td></tr>
                  <tr><td className="py-1 pr-4"><code>/pheromone</code></td><td className="pr-4">GET</td><td>List all non-zero signals</td></tr>
                  <tr><td className="py-1 pr-4"><code>/pheromone/files</code></td><td className="pr-4">GET</td><td>File heat map</td></tr>
                </tbody>
              </table>
            </motion.div>
            <motion.p className="text-xs text-[var(--text-secondary)] pt-2 m-0">
              CLI: <code>pd pheromone spray</code>, <code>pd pheromone sniff</code>, <code>pd pheromone list</code>
            </motion.p>
          </Surface>
        </section>
      </motion.div>
    </TutorialLayout>
  )
}
