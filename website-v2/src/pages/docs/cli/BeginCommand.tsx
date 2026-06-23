import { CommandPage } from '@/components/docs/CommandPage'

export default function BeginCommand() {
  return (
    <CommandPage
      command="pd begin"
      description="Start a session and register as an agent in one command. Writes slot-scoped local context under .portdaddy/contexts/ and updates .portdaddy/current.json as a compatibility pointer. The recommended way to start any coordinated work."
      version="3.13.0"
      syntax="pd begin <purpose> --lifecycle durable|ephemeral [flags]"
      flags={[
        { flag: '--lifecycle <durable|ephemeral>', description: 'Required session lifecycle. Use durable for ordinary agent work; ephemeral for heartbeat-bound process sessions.' },
        { flag: '--identity <id>', description: 'Semantic identity for this agent (project:stack:context)' },
        { flag: '--purpose <text>', description: 'What this agent is working on' },
      ]}
      usagePatterns={[
        'pd begin',
        'pd begin --identity myapp:api --purpose "Fix auth bug" --lifecycle durable',
        'pd begin --identity myapp:frontend --purpose "Build login page" --lifecycle durable',
        'pd begin --identity myapp:coder --purpose "Refactor auth module" --lifecycle durable',
      ]}
      examples={[
        {
          description: 'Basic usage - start a session with identity and purpose',
          code: 'pd begin --identity myapp:api --purpose "Fix auth bug" --lifecycle durable',
          output: `[pd] Session abc123 started · Agent myapp:api registered
[pd] 2 dead agents in myapp:* — run: pd salvage --project myapp`
        },
        {
          description: 'Start session with minimal identity',
          code: 'pd begin "Build frontend shell" --identity myapp:frontend --lifecycle durable',
          output: `[pd] Session def456 started · Agent myapp:frontend registered
[pd] Writing local context under .portdaddy/contexts/`
        },
        {
          description: 'A slot-scoped local context file',
          code: 'cat .portdaddy/contexts/<slot>.json',
          output: `{
  "agentId": "agent-001",
  "sessionId": "abc123",
  "purpose": "Fix auth bug",
  "identity": "myapp:api",
  "startedAt": 1775893219373,
  "contextSlot": "tty-ttys001"
}`
        },
        {
          description: 'Warns about dead agents that can be salvaged',
          code: 'pd begin --identity myapp:coder --purpose "Continue work" --lifecycle durable',
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
