import { useState } from 'react'
import { motion } from 'framer-motion'
import { Play, Square } from 'lucide-react'
import { PageContainer, PanelBody, PanelTitle, SectionIntro } from '@/components/site/primitives'
import { CommandTerminal } from '@/components/ui/CommandTerminal'

const DEMOS = [
  {
    id: 'quickstart',
    title: 'Quick Start',
    description: 'Start a task, log what you did, hand it off',
    gif: '/gifs/quickstart.gif',
    caption: 'A real recording of a Port Daddy quickstart: commands appear with daemon output, not as a naked checklist.',
    code: `# Start working on a project
$ pd begin "Building the photo upload API" --identity photoapp:api --lifecycle durable
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
    description: 'Two agents in one repo without collisions',
    gif: '/gifs/agents/coordination.gif',
    caption: 'A real coordination recording with visible terminal responses for claims, notes, and guard state.',
    code: `# Agent 1: Backend developer
$ pd begin "REST API for auth" --identity myapp:api --lifecycle durable
  Agent agent-c3d1 ready

$ pd claim myapp:api
  Port 9201 claimed · identity myapp:api

# Agent 2: Frontend developer
$ pd begin "React login page" --identity myapp:web --lifecycle durable
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
    description: 'Hand off a small job with a dollar cap',
    gif: '/gifs/agents/event-triggers.gif',
    caption: 'A real agent-trigger recording. Terminal examples on this page must show the system answering back.',
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
    id: 'relay-pki',
    title: 'Relay PKI',
    description: 'Let a remote agent in without trusting it with secrets',
    code: `# Score the relay identity options with the skill script
$ printf '%s\\n' '{"kind":"request","version":"1","command":"pki.score","payload":{"options":["ACME","OIDC","WoT","Hybrid"]}}' \\
    | python3 skills/pd-relay-zero-trust/scripts/pki_decision.py \\
    | jq -r '.result.ranked[] | "\\(.option) \\(.score)"'
  OIDC 153
  Hybrid 153
  WoT 141
  ACME 137

# Read the accepted ADR boundary
$ rg "auth-mode=wot|managed/global" docs/adr/0025-pki-decision.md
  --auth-mode=wot is self-hosted and harbor-local only
  WoT is not accepted into the managed/global registry in v0

# The relay design keeps payloads opaque
$ rg "relay never sees plaintext" docs/adr/0025-pki-decision.md
  I1 (relay never sees plaintext): Preserved`,
  },
]

export function TerminalDemos() {
  const [activeDemo, setActiveDemo] = useState(DEMOS[0])

  return (
    <section id="demos" className="relative py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]">
      <PageContainer>
        <SectionIntro
          eyebrow="See it run for real"
          title="Under the app is a real local API your agents can drive."
          description="The app is where you watch and steer. Underneath it is a set of commands your agents can script themselves: start a session, claim a file, hold a lock, send a message, hand off a job, and recover work from a crash. These are real recordings, with the daemon answering back."
          titleAs="h2"
          className="mb-[var(--space-7)] max-w-[46rem]"
          titleClassName="max-w-[20ch]"
          bodyClassName="max-w-[39rem]"
        />

        <div className="grid w-full min-w-0 max-w-full gap-4 overflow-hidden sm:gap-6 lg:grid-cols-[240px_minmax(0,1fr)] lg:overflow-visible">
          {/* Tabs */}
          <div className="grid w-full max-w-full min-w-0 grid-cols-2 gap-2 pb-2 sm:grid-cols-3 lg:flex lg:flex-col lg:pb-0">
            {DEMOS.map((demo) => (
              <button
                key={demo.id}
                onClick={() => setActiveDemo(demo)}
                className={`min-w-0 cursor-pointer rounded-[var(--radius-lg)] px-4 py-3 text-left transition-all duration-200 ${
                  activeDemo.id === demo.id
                    ? 'bg-[var(--surface-overlay)] shadow-[var(--shadow-inset)]'
                    : 'bg-transparent'
                }`}
              >
                <div className="flex items-center gap-2">
                  {activeDemo.id === demo.id ? (
                    <Play size={14} className="text-[var(--brand-primary)]" fill="var(--brand-primary)" />
                  ) : (
                    <Square size={14} className="text-[var(--text-muted)]" />
                  )}
                  <PanelTitle as="span" size="nav" className={`max-w-none ${
                    activeDemo.id === demo.id ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'
                  }`}>
                    {demo.title}
                  </PanelTitle>
                </div>
                {/*
                  Indent aligns the description under the demo title,
                  clearing the 14px Square icon + gap. --space-5 (24px)
                  is the closest grid step.
                */}
                <PanelBody size="compact" className="ml-[var(--space-5)] mt-[var(--space-1)] max-w-none">
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
            className="min-w-0 max-w-full overflow-hidden"
          >
            <CommandTerminal
              code={activeDemo.code}
              title={activeDemo.title}
              animate={false}
            />
          </motion.div>
        </div>
      </PageContainer>
    </section>
  )
}
