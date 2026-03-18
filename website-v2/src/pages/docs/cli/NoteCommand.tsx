import { CommandPage } from '@/components/docs/CommandPage'

export default function NoteCommand() {
  return (
    <CommandPage
      command="pd note"
      shortFlag="n"
      description="Add a note to the current session. Notes are immutable — they are never edited or deleted. Creates an implicit session if none exists. Use notes to track progress, decisions, and milestones throughout your work."
      version="3.7.0"
      syntax="pd note <text> [flags]"
      flags={[
        { flag: '--type <type>', description: 'Note type: progress | decision | milestone | warning (default: progress)' },
      ]}
      usagePatterns={[
        'pd note "Started work on feature"',
        'pd note "API design approved" --type decision',
        'pd note "First prototype working" --type milestone',
        'pd note "Deprecated endpoint still in use" --type warning',
      ]}
      examples={[
        {
          description: 'Add a progress note',
          code: 'pd note "Auth middleware updated — JWT shape changed"',
          output: 'Note added to session abc123'
        },
        {
          description: 'Add a milestone note',
          code: 'pd note "Auth middleware updated — JWT shape changed" --type milestone',
          output: '[milestone] Note added to session abc123'
        },
        {
          description: 'Add a decision note',
          code: 'pd note "Switched from bcrypt to argon2 for password hashing" --type decision',
          output: '[decision] Note added to session abc123'
        },
        {
          description: 'Add a warning note',
          code: 'pd note "Database migration may take 30+ minutes on large datasets" --type warning',
          output: '[warning] Note added to session abc123'
        },
        {
          description: 'View notes for current session',
          code: 'pd notes',
          output: `[milestone] Auth middleware updated — JWT shape changed   1m ago
[progress]  Started JWT refactor                                  5m ago
[decision]  Using argon2 instead of bcrypt                       12m ago`
        },
        {
          description: 'Auto-creates session if none exists',
          code: 'pd note "Quick fix for bug #123"',
          output: `[pd] No active session, created implicit session xyz789
Note added to session xyz789`
        },
        {
          description: 'Typical workflow with multiple note types',
          code: `pd begin --identity myapp:api --purpose "Add rate limiting"
pd note "Started rate limiting implementation" --type progress
pd note "Decided to use sliding window algorithm" --type decision
pd note "Basic rate limiter working for single instance" --type milestone
pd note "Need to add Redis support for distributed setup" --type warning
pd done`,
          output: `[pd] Session abc123 started · Agent myapp:api registered
[progress] Note added to session abc123
[decision] Note added to session abc123
[milestone] Note added to session abc123
[warning] Note added to session abc123
[pd] Session abc123 marked completed · Agent deregistered`
        },
      ]}
      seeAlso={[
        { name: 'pd notes', href: '/docs/cli/notes' },
        { name: 'pd begin', href: '/docs/cli/begin' },
        { name: 'pd done', href: '/docs/cli/done' },
        { name: 'pd whoami', href: '/docs/cli/whoami' },
      ]}
    />
  )
}
