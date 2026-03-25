import { useState } from 'react'
import { motion } from 'framer-motion'
import { Play, Square } from 'lucide-react'
import { NeumorphicTerminal } from '@/components/ui/NeumorphicTerminal'

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
    code: `# Spawn a Claude agent with file editing tools
$ pd spawn --backend claude-cli \\
    --allowedTools 'Read,Write,Edit,Glob,Grep' \\
    --identity myapp:fixer \\
    -- "Fix the login bug in src/auth.ts"
  Agent spawned-8a2f: completed
  Backend: claude-cli
  Duration: 45s

# Quiet mode — capture output in scripts
$ result=$(pd spawn --backend claude-cli -q -- "Write a commit message")
$ echo $result
  fix: validate JWT expiry before token refresh

# List spawned agents
$ pd spawned
  AGENT ID          BACKEND    STATUS      AGE
  spawned-8a2f      claude-cli completed   2m
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
    <section id="demos" className="relative py-24 lg:py-32">
      <div className="max-w-[1200px] mx-auto px-6 lg:px-8">
        {/* Header */}
        <div className="max-w-2xl mb-12">
          <p className="text-sm font-mono text-[var(--brand-secondary)] tracking-wide mb-4 uppercase">
            See It In Action
          </p>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-[var(--text-primary)] mb-4 leading-[1.15]">
            Real commands. Real output.
          </h2>
          <p className="text-base text-[var(--text-secondary)] leading-relaxed">
            Every command runs against a live Port Daddy daemon. What you see is what you get.
          </p>
        </div>

        <div className="grid lg:grid-cols-[240px,1fr] gap-6">
          {/* Tabs */}
          <div className="flex lg:flex-col gap-2">
            {DEMOS.map((demo) => (
              <button
                key={demo.id}
                onClick={() => setActiveDemo(demo)}
                className="text-left px-4 py-3 rounded-xl transition-all duration-200 cursor-pointer"
                style={{
                  background: activeDemo.id === demo.id ? 'var(--bg-overlay)' : 'transparent',
                  boxShadow: activeDemo.id === demo.id ? 'var(--shadow-neu-inset)' : 'none',
                }}
              >
                <div className="flex items-center gap-2">
                  {activeDemo.id === demo.id ? (
                    <Play size={14} className="text-[var(--brand-primary)]" fill="var(--brand-primary)" />
                  ) : (
                    <Square size={14} className="text-[var(--text-muted)]" />
                  )}
                  <span className={`text-sm font-semibold ${
                    activeDemo.id === demo.id ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'
                  }`}>
                    {demo.title}
                  </span>
                </div>
                <p className="text-xs text-[var(--text-muted)] mt-1 ml-[22px]">
                  {demo.description}
                </p>
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
      </div>
    </section>
  )
}
