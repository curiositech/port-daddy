import { CommandPage } from '@/components/docs/CommandPage'

export default function NotesCommand() {
  return (
    <CommandPage
      command="notes"
      description="Show recent notes. Without flags shows the last 10 notes across all sessions."
      version="3.11.0"
      syntax="pd notes"
      flags={[
        { flag: '--session <id>', description: 'Notes for a specific session' },
        { flag: '--limit <n>', description: 'Number of notes to show (default 10)' },
      ]}
      usagePatterns={[
        'pd notes',
        'pd notes --limit 5',
        'pd notes --session abc123',
      ]}
      examples={[
        {
          description: 'Show recent notes',
          code: 'pd notes --limit 5',
          output: `[milestone] Auth middleware updated — JWT shape changed   1m ago
[progress]  Started JWT refactor                                  5m ago`
        },
      ]}
      seeAlso={[
        { name: 'note', href: '/docs/cli/note' },
        { name: 'begin', href: '/docs/cli/begin' },
        { name: 'whoami', href: '/docs/cli/whoami' },
      ]}
    />
  )
}
