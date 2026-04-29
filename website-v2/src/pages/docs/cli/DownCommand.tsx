import { CommandPage } from '@/components/docs/CommandPage'

export default function DownCommand() {
  return (
    <CommandPage
      command="down"
      shortFlag="d"
      description="Stop all running services in the current project."
      version="3.11.0"
      syntax="pd down"
      usagePatterns={[
        'pd down',
        'pd d',
      ]}
      examples={[
        {
          description: 'Stop all services',
          code: 'pd down',
          output: `Stopped 4 services`
        },
      ]}
      seeAlso={[
        { name: 'up', href: '/docs/cli/up' },
        { name: 'services', href: '/docs/cli/services' },
      ]}
    />
  )
}
