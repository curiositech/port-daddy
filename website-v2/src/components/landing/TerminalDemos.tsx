import { useState } from 'react'
import { motion } from 'framer-motion'
import { Play, Square } from 'lucide-react'
import { NeumorphicTerminal } from '@/components/ui/NeumorphicTerminal'
import { PageContainer, PanelBody, PanelTitle, SectionIntro } from '@/components/site/primitives'

const DEMOS = [
  {
    id: 'quickstart',
    title: 'Quick Start',
    description: 'The begin/note/done ceremony',
    code: `# Start working on a project
$ pd begin "Building the photo upload API" --identity photoapp:api
  Agent agent-a7f3 ready
  Session started · port 9201 · identity photoapp:api

# Log progress as you work
$ pd note "Endpoint scaffolded, writing validation layer"
  Note added to session

# Check your context
$ pd whoami
  Agent: agent-a7f3
  Session: session-b2e4
  Identity: photoapp:api
  Purpose: Building the photo upload API

# Done for the day
$ pd done "Upload API complete with tests"
  Session completed · agent unregistered`,
  },
  {
    id: 'coordination',
    title: 'Multi-Agent',
    description: 'Ports, pub/sub, locks',
    code: `# Agent 1: Backend developer
$ pd begin "REST API for auth" --identity myapp:api
  Agent agent-c3d1 ready

$ pd claim myapp:api
  Port 9201 claimed · identity myapp:api

# Agent 2: Frontend developer
$ pd begin "React login page" --identity myapp:web
  Agent agent-e5f2 ready

$ pd claim myapp:web
  Port 9202 claimed · identity myapp:web

# Backend signals: auth endpoints are ready
$ pd pub api:ready '{"endpoints":["/login","/register"]}'
  Published to api:ready · 1 subscriber notified

# Lock the database for migrations
$ pd with-lock db-migrations npm run migrate
  Lock acquired · running command
  Migration complete
  Lock released`,
  },
  {
    id: 'spawn',
    title: 'AI Spawn',
    description: 'Launch agents through PD',
    code: `# Spawn a cheap Codex agent with an explicit budget ceiling
$ pd spawn --backend codex \\
    --tier low \\
    --identity myapp:fixer \\
    --budget 0.50 \\
    -- "Fix the login bug in src/auth.ts"
  Agent spawned-8a2f: completed
  Backend: codex
  Model: gpt-5.4-mini
  Duration: 45s

# Quiet mode — capture output in scripts
$ result=$(pd spawn --backend codex --tier low --budget 0.20 -q -- "Write a commit message")
$ echo $result
  fix: validate JWT expiry before token refresh

# List spawned agents
$ pd spawned
  AGENT ID          BACKEND    STATUS      AGE
  spawned-8a2f      codex      completed   2m
  spawned-b4c1      ollama     completed   5m`,
  },
  {
    id: 'salvage',
    title: 'Salvage',
    description: 'Recover dead agent work',
    code: `# Check for dead agents at session start
$ pd salvage
  1 agent pending salvage:

  photoapp:api
    agent-x7y9 — "Building photo upload"
    Dead since: 12 minutes ago
    Session notes: 3 entries

# Claim the dead agent's work
$ pd salvage claim agent-x7y9
  Claimed · you now own agent-x7y9's session
  3 notes and 2 file claims transferred

# Continue where they left off
$ pd notes --session agent-x7y9
  [progress] Endpoint scaffolded
  [decision] Using multer for multipart uploads
  [blocker] CORS headers needed for frontend`,
  },
]

export function TerminalDemos() {
  const [activeDemo, setActiveDemo] = useState(DEMOS[0])

  return (
    <section id="demos" className="relative py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]">
      <PageContainer>
        <SectionIntro
          eyebrow="See it in action"
          title="Real commands. Real output."
          description="Every command runs against a live Port Daddy daemon. What you see is what you get."
          titleAs="h2"
          className="mb-[var(--space-7)] max-w-[46rem]"
          titleClassName="max-w-[12ch]"
          bodyClassName="max-w-[36rem]"
        />

        <div className="grid lg:grid-cols-[240px,1fr] gap-4 sm:gap-6">
          {/* Tabs */}
          <div className="flex lg:flex-col gap-2 overflow-x-auto pb-2 lg:pb-0 -mx-2 px-2 lg:mx-0 lg:px-0">
            {DEMOS.map((demo) => (
              <button
                key={demo.id}
                onClick={() => setActiveDemo(demo)}
                className="text-left px-4 py-3 rounded-[var(--radius-lg)] transition-all duration-200 cursor-pointer shrink-0 lg:shrink"
                style={{
                  background: activeDemo.id === demo.id ? 'var(--surface-overlay)' : 'transparent',
                  boxShadow: activeDemo.id === demo.id ? 'var(--shadow-inset)' : 'none',
                }}
              >
                <div className="flex items-center gap-2">
                  {activeDemo.id === demo.id ? (
                    <Play size={14} className="text-[var(--brand-primary)]" fill="var(--brand-primary)" />
                  ) : (
                    <Square size={14} className="text-[var(--text-muted)]" />
                  )}
                  <PanelTitle as="span" size="nav" className={`max-w-none text-[1rem] ${
                    activeDemo.id === demo.id ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'
                  }`}>
                    {demo.title}
                  </PanelTitle>
                </div>
                <PanelBody size="compact" className="ml-[22px] mt-[var(--space-1)] max-w-none text-[0.875rem]">
                  {demo.description}
                </PanelBody>
              </button>
            ))}
          </div>

          {/* Terminal */}
          <motion.div
            key={activeDemo.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <NeumorphicTerminal
              code={activeDemo.code}
              title={activeDemo.title}
              typewriterSpeed={15}
            />
          </motion.div>
        </div>
      </PageContainer>
    </section>
  )
}
