import { CommandPage } from '@/components/docs/CommandPage'

export default function SalvageCommand() {
  return (
    <CommandPage
      command="pd salvage"
      description="Show agents in the resurrection queue — agents that died mid-task with active sessions. Allows a new agent to claim their work and continue. Dead agents happen. This is how work survives them."
      version="3.13.0"
      syntax="pd salvage [flags]"
      flags={[
        { flag: '--project <name>', description: 'Filter by project identity prefix' },
        { flag: '--json, -j', description: 'JSON output' },
      ]}
      usagePatterns={[
        'pd salvage',
        'pd salvage --project myapp',
        'pd salvage --json',
        'pd salvage claim <agentId>',
      ]}
      subcommands={[
        { name: 'pd salvage claim <agentId>', description: 'Claim a dead agent\'s work and continue their session', href: '/docs/cli/salvage-claim' },
      ]}
      examples={[
        {
          description: 'Show the salvage queue',
          code: 'pd salvage',
          output: `SALVAGE QUEUE (2 agents)
  agent-001  myapp:coder   died 8m ago   "Fix auth bug"
  agent-002  myapp:tester  died 3m ago   "Run test suite"`
        },
        {
          description: 'Filter by project',
          code: 'pd salvage --project myapp',
          output: `SALVAGE QUEUE for myapp:* (2 agents)
  agent-001  myapp:coder   died 8m ago   "Fix auth bug"
  agent-002  myapp:tester  died 3m ago   "Run test suite"`
        },
        {
          description: 'JSON output',
          code: 'pd salvage --json',
          output: `[
  {
    "agent_id": "agent-001",
    "identity": "myapp:coder",
    "died_at": "2026-03-16T11:52:00Z",
    "purpose": "Fix auth bug",
    "session_id": "abc123",
    "notes_count": 5,
    "files_claimed": ["src/auth/login.ts"]
  },
  {
    "agent_id": "agent-002",
    "identity": "myapp:tester",
    "died_at": "2026-03-16T11:57:00Z",
    "purpose": "Run test suite",
    "session_id": "def456",
    "notes_count": 2,
    "files_claimed": []
  }
]`
        },
        {
          description: 'Empty queue - all agents healthy',
          code: 'pd salvage',
          output: `SALVAGE QUEUE (0 agents)
  All agents are healthy. No work to salvage.`
        },
        {
          description: 'Claim work from a dead agent',
          code: 'pd salvage claim agent-001',
          output: `Claimed agent-001
  Session: abc123
  Notes: 3 notes
  Files: src/auth/login.ts (claimed)
  Purpose: Fix auth bug

[pd] You're now continuing their work.
[pd] Run 'pd notes --session abc123' to see previous notes.`
        },
      ]}
      seeAlso={[
        { name: 'pd salvage claim', href: '/docs/cli/salvage-claim' },
        { name: 'pd begin', href: '/docs/cli/begin' },
        { name: 'pd spawn', href: '/docs/cli/spawn' },
        { name: 'pd notes', href: '/docs/cli/notes' },
      ]}
    />
  )
}
