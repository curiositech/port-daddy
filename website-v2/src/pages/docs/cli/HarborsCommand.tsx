import { CommandPage } from '@/components/docs/CommandPage'

export default function HarborsCommand() {
  return (
    <CommandPage
      command="harbors"
      description="List all active harbors and their capabilities."
      version="3.8.3"
      syntax="pd harbors"
      flags={[
        { flag: '-j, --json', description: 'JSON output' },
      ]}
      usagePatterns={[
        'pd harbors',
        'pd harbors --json',
      ]}
      examples={[
        {
          description: 'List harbors',
          code: 'pd harbors',
          output: `myapp:security-review   code:read,notes:write   3 agents   exp 1h 44m`
        },
      ]}
      seeAlso={[
        { name: 'harbor create', href: '/docs/cli/harbor-create' },
        { name: 'harbor enter', href: '/docs/cli/harbor-enter' },
        { name: 'harbor leave', href: '/docs/cli/harbor-leave' },
      ]}
    />
  )
}
