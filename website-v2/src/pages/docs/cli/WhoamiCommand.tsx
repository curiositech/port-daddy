import { CommandPage } from '@/components/docs/CommandPage'

export default function WhoamiCommand() {
  return (
    <CommandPage
      command="whoami"
      description="Show the current agent identity and session from .portdaddy/current.json."
      version="3.7.0"
      syntax="pd whoami"
      usagePatterns={[
        'pd whoami',
      ]}
      examples={[
        {
          description: 'Show current session',
          code: 'pd whoami',
          output: `Agent:   myapp:api
Session: abc123
Purpose: Fix auth bug
Started: 23m ago`
        },
      ]}
      seeAlso={[
        { name: 'begin', href: '/docs/cli/begin' },
        { name: 'done', href: '/docs/cli/done' },
        { name: 'note', href: '/docs/cli/note' },
      ]}
    />
  )
}
