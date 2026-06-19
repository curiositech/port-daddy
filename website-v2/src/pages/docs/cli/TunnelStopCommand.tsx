import { CommandPage } from '@/components/docs/CommandPage'

export default function TunnelStopCommand() {
  return (
    <CommandPage
      command="tunnel stop"
      description="Stop an active tunnel."
      version="3.13.0"
      syntax="pd tunnel stop <identity>"
      flags={[
        { flag: 'identity', description: 'Service identity whose tunnel to stop' },
      ]}
      usagePatterns={[
        'pd tunnel stop myapp:api',
      ]}
      examples={[
        {
          description: 'Stop a tunnel',
          code: 'pd tunnel stop myapp:api',
          output: `Stopped tunnel for myapp:api`
        },
      ]}
      seeAlso={[
        { name: 'tunnel', href: '/docs/cli/tunnel' },
        { name: 'services', href: '/docs/cli/services' },
      ]}
    />
  )
}
