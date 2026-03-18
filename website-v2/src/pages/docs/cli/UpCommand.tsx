import { CommandPage } from '@/components/docs/CommandPage'

export default function UpCommand() {
  return (
    <CommandPage
      command="up"
      description="Start all registered services in the current project. Uses the detected start commands."
      version="3.7.0"
      syntax="pd up"
      usagePatterns={[
        'pd up',
      ]}
      examples={[
        {
          description: 'Start all services',
          code: 'pd up',
          output: `Starting 4 services...
  ✓ myapp:api      (port 3001)
  ✓ myapp:frontend (port 3000)`
        },
      ]}
      seeAlso={[
        { name: 'down', href: '/docs/cli/down' },
        { name: 'scan', href: '/docs/cli/scan' },
        { name: 'services', href: '/docs/cli/services' },
      ]}
    />
  )
}
