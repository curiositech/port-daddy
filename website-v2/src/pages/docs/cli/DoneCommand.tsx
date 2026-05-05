import { CommandPage } from '@/components/docs/CommandPage'

export default function DoneCommand() {
  return (
    <CommandPage
      command="pd done"
      description="End the current session and unregister agent. Reads session ID from the current slot-scoped local context. Marks session as completed and cleans up agent registration."
      version="3.11.0"
      syntax="pd done [flags]"
      flags={[
        { flag: '--session <id>', description: 'Explicit session ID (skips local context lookup)' },
      ]}
      usagePatterns={[
        'pd done',
        'pd done --session abc123',
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
