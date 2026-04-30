import { CommandPage } from '@/components/docs/CommandPage'

export default function DoneCommand() {
  return (
    <CommandPage
      command="pd done"
      description="End the current session and unregister agent. Reads session ID from the current slot-scoped local context. Marks completed by default, or records self-salvage when the telos is unfinished but still doable."
      version="3.11.0"
      syntax="pd done [flags]"
      flags={[
        { flag: '--session <id>', description: 'Explicit session ID (skips local context lookup)' },
        { flag: '--status <completed|abandoned>', description: 'Explicit closeout status' },
        { flag: '--self-salvage', description: 'Record unfinished but recoverable telos and queue salvage' },
        { flag: '--telos-verdict <fulfilled|partial|not-fulfilled>', description: 'How the agent judged its telos at closeout' },
        { flag: '--doable <yes|no|unknown>', description: 'Whether another iteration can continue the work' },
        { flag: '--why-stopped <text>', description: 'Why the telos was not fulfilled' },
        { flag: '--next-plan <text>', description: 'Concrete continuation plan for the next agent' },
        { flag: '--wisdom <text>', description: 'Lesson or constraint the next agent should know' },
        { flag: '--evidence <text>', description: 'Commands, files, artifacts, or observations supporting the handoff' },
        { flag: '--risk <text>', description: 'Known caveat for the continuation' },
      ]}
      usagePatterns={[
        'pd done',
        'pd done --session abc123',
        'pd done --self-salvage --telos-verdict partial --doable yes --why-stopped "deploy smoke blocked" --next-plan "rebuild, deploy, smoke /agents"',
      ]}
      examples={[
        {
          description: 'Basic usage - complete current session',
          code: 'pd done',
          output: '[pd] Session abc123 marked completed · Agent deregistered'
        },
        {
          description: 'Complete a specific session by ID',
          code: 'pd done --session def456',
          output: '[pd] Session def456 marked completed · Agent deregistered'
        },
        {
          description: 'Leave self-salvage for unfinished but doable telos',
          code: `pd done --self-salvage --telos-verdict partial --doable yes \\
  --why-stopped "production smoke blocked by stale daemon" \\
  --next-plan "promote stable daemon, then smoke /agents and /mcp" \\
  --wisdom "Source truth is not operator truth until promotion succeeds"`,
          output: `[pd] Session abc123 marked abandoned · Agent deregistered
Self-salvage queued: next agent can continue from the salvage queue`
        },
        {
          description: 'Typical workflow - begin work, then finish',
          code: `pd begin --identity myapp:api --purpose "Fix auth bug"
# ... do work ...
pd note "Fixed JWT validation"
pd done`,
          output: `[pd] Session abc123 started · Agent myapp:api registered
...
Note added to session abc123
[pd] Session abc123 marked completed · Agent deregistered`
        },
        {
          description: 'Error - no active session',
          code: 'pd done',
          output: `[pd] Error: No active session found
[pd] Run 'pd begin' to start a new session`
        },
      ]}
      seeAlso={[
        { name: 'pd begin', href: '/docs/cli/begin' },
        { name: 'pd whoami', href: '/docs/cli/whoami' },
        { name: 'pd note', href: '/docs/cli/note' },
        { name: 'pd notes', href: '/docs/cli/notes' },
      ]}
    />
  )
}
