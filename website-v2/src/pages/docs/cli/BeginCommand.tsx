import { CommandPage } from '@/components/docs/CommandPage'

export default function BeginCommand() {
  return (
    <CommandPage
      command="pd begin"
      description="Start a session and register as an agent in one command. Writes agent ID and session ID to .portdaddy/current.json for use by other pd commands. The recommended way to start any coordinated work."
      version="3.7.0"
      syntax="pd begin [flags]"
      flags={[
        { flag: '--identity <id>', description: 'Semantic identity for this agent (project:stack:context)' },
        { flag: '--purpose <text>', description: 'What this agent is working on' },
      ]}
      usagePatterns={[
        'pd begin',
        'pd begin --identity myapp:api',
        'pd begin --identity myapp:frontend --purpose "Build login page"',
        'pd begin --identity myapp:coder --purpose "Refactor auth module"',
      ]}
      examples={[
        {
          description: 'Basic usage - start a session with identity and purpose',
          code: 'pd begin --identity myapp:api --purpose "Fix auth bug"',
          output: `[pd] Session abc123 started · Agent myapp:api registered
[pd] 2 dead agents in myapp:* — run: pd salvage --project myapp`
        },
        {
          description: 'Start session with minimal identity',
          code: 'pd begin --identity myapp:frontend',
          output: `[pd] Session def456 started · Agent myapp:frontend registered
[pd] Writing to .portdaddy/current.json`
        },
        {
          description: 'The .portdaddy/current.json file created',
          code: 'cat .portdaddy/current.json',
          output: `{
  "agent_id": "agent-001",
  "session_id": "abc123",
  "identity": "myapp:api",
  "purpose": "Fix auth bug",
  "started_at": "2026-03-16T12:00:00Z"
}`
        },
        {
          description: 'Warns about dead agents that can be salvaged',
          code: 'pd begin --identity myapp:coder --purpose "Continue work"',
          output: `[pd] Session xyz789 started · Agent myapp:coder registered
[pd] ⚠ 1 dead agent in myapp:* — run: pd salvage --project myapp`
        },
      ]}
      seeAlso={[
        { name: 'pd done', href: '/docs/cli/done' },
        { name: 'pd whoami', href: '/docs/cli/whoami' },
        { name: 'pd note', href: '/docs/cli/note' },
        { name: 'pd salvage', href: '/docs/cli/salvage' },
        { name: 'pd spawn', href: '/docs/cli/spawn' },
      ]}
    />
  )
}
