import { useState } from 'react'
import { motion } from 'framer-motion'
import { Play, Square } from 'lucide-react'
import { TerminalGif } from '@/components/site/TerminalGif'
import { PageContainer, PanelBody, PanelTitle, SectionIntro } from '@/components/site/primitives'

const DEMOS = [
  {
    id: 'quickstart',
    title: 'Quick Start',
    description: 'The begin/note/done ceremony',
    gif: '/gifs/quickstart.gif',
    caption: 'A real recording of a Port Daddy quickstart: commands appear with daemon output, not as a naked checklist.',
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
    gif: '/gifs/agents/coordination.gif',
    caption: 'A real coordination recording with visible terminal responses for claims, notes, and guard state.',
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
    id: 'tube',
    title: 'PD Tube',
    description: 'Conversational handoffs',
    code: `# Terminal 1: listen to the design-review pipe
$ pd tube port-daddy:design-review --json --once
  {"id":41,"sender":"lookout","body":"Need PKI copy on the public site."}

# Terminal 2: send a top-level note
$ printf 'Adding Tube tutorial, CLI ref, and PKI feature page.' \\
    | pd tube port-daddy:design-review --send --sender codex
  tube: posted id=42 to port-daddy:design-review

# Thread the reply to the original message
$ printf 'PKI page now links ADR-0025 and local WoT warnings.' \\
    | pd tube port-daddy:design-review --reply=41 --sender codex
  tube: posted id=43 to port-daddy:design-review

# Resume exactly after the previous cursor
$ pd tube port-daddy:design-review --since=41 --json --once
  {"id":42,"sender":"codex","body":"Adding Tube tutorial, CLI ref, and PKI feature page."}
  {"id":43,"sender":"codex","inReplyTo":41,"body":"PKI page now links ADR-0025 and local WoT warnings."}`,
  },
  {
    id: 'spawn',
    title: 'AI Spawn',
    description: 'Launch agents through PD',
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
    id: 'salvage',
    title: 'Salvage',
    description: 'Recover dead agent work',
    gif: '/gifs/salvage.gif',
    caption: 'A real salvage recording with command output visible for the recovery path.',
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
  {
    id: 'relay-pki',
    title: 'Relay PKI',
    description: 'OIDC-first identity',
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
          eyebrow="Agent CLI proof"
          title="Real commands. Real output."
          description="The CLI is for agents, scripts, and developers validating the substrate. Humans should start in FleetBar or Fleet Control Center; this section shows the daemon evidence underneath those app surfaces."
          titleAs="h2"
          className="mb-[var(--space-7)] max-w-[46rem]"
          titleClassName="max-w-[12ch]"
          bodyClassName="max-w-[36rem]"
        />

        <div className="grid w-full min-w-0 max-w-full gap-4 overflow-hidden sm:gap-6 lg:grid-cols-[240px_minmax(0,1fr)] lg:overflow-visible">
          {/* Tabs */}
          <div className="flex w-full max-w-full min-w-0 gap-2 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible lg:pb-0">
            {DEMOS.map((demo) => (
              <button
                key={demo.id}
                onClick={() => setActiveDemo(demo)}
                className="min-w-[10rem] shrink-0 cursor-pointer rounded-[var(--radius-lg)] px-4 py-3 text-left transition-all duration-200 lg:min-w-0 lg:shrink"
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
