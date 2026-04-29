import { useState } from 'react'
import { motion } from 'framer-motion'
import { Play, Square } from 'lucide-react'
import {
  PageContainer,
  PanelBody,
  PanelEyebrow,
  PanelTitle,
  SectionIntro,
  SurfacePanel,
  TerminalSurface,
} from '@/components/site/primitives'
import { cn } from '@/lib/utils'

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
    <section className="border-b-2 border-[var(--border-strong)] py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]">
      <PageContainer width="wide">
        <SectionIntro
          eyebrow="See it in action"
          title="Real commands. Real output."
          description="The terminal stays evidence, not decoration. Pick a workflow and read the operating sequence directly."
          titleAs="h2"
          className="mb-[var(--space-7)] max-w-[44rem]"
          titleClassName="max-w-[12ch]"
          bodyClassName="max-w-[34rem]"
        />

        <div className="grid gap-[var(--space-4)] xl:grid-cols-[280px_minmax(0,1fr)]">
          <SurfacePanel elevation="quiet" padding="compact" className="flex flex-col gap-0">
            {DEMOS.map((demo, index) => {
              const active = activeDemo.id === demo.id

              return (
                <button
                  key={demo.id}
                  type="button"
                  onClick={() => setActiveDemo(demo)}
                  className={cn(
                    'flex cursor-pointer flex-col items-start gap-[var(--space-2)] border-t border-[var(--border-default)] px-[var(--space-3)] py-[var(--space-4)] text-left first:border-t-0',
                    active ? 'bg-[var(--brand-primary)] text-[var(--brand-primary-foreground)]' : 'bg-transparent hover:bg-[var(--interactive-hover)]',
                  )}
                >
                  <div className="flex items-center gap-[var(--space-2)]">
                    {active ? (
                      <Play size={14} className="text-[var(--brand-primary-foreground)]" fill="currentColor" />
                    ) : (
                      <Square size={14} className="text-[var(--text-muted)]" />
                    )}
                    <PanelEyebrow tone={active ? 'primary' : 'default'}>
                      {String(index + 1).padStart(2, '0')}
                    </PanelEyebrow>
                  </div>
                  <PanelTitle as="span" size="nav" tone={active ? 'primary' : 'default'} className="max-w-none">
                    {demo.title}
                  </PanelTitle>
                  <PanelBody size="compact" tone={active ? 'primary' : 'default'} className="max-w-none">
                    {demo.description}
                  </PanelBody>
                </button>
              )
            })}
          </SurfacePanel>

          <motion.div
            key={activeDemo.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, ease: 'easeOut' as const }}
          >
            <TerminalSurface code={activeDemo.code} title={activeDemo.title} />
          </motion.div>
        </div>
      </PageContainer>
    </section>
  )
}
