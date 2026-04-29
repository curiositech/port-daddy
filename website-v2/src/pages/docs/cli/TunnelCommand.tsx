import { CommandPage } from '@/components/docs/CommandPage'

export default function TunnelCommand() {
  return (
    <CommandPage
      command="tunnel"
      description="Create a secure tunnel to a service. Enables external access to local services."
      version="3.11.0"
      syntax="pd tunnel <identity>"
      flags={[
        { flag: 'identity', description: 'Service identity to tunnel' },
      ]}
      usagePatterns={[
        'pd tunnel myapp:api',
      ]}
      examples={[
        {
          description: 'Create a tunnel',
          code: 'pd tunnel myapp:api',
          output: `Tunnel created: myapp:api
Public URL: https://abc123.tunnel.portdaddy.dev
Local: localhost:3001`
        },
      ]}
      seeAlso={[
        { name: 'tunnel stop', href: '/docs/cli/tunnel-stop' },
        { name: 'claim', href: '/docs/cli/claim' },
        { name: 'services', href: '/docs/cli/services' },
      ]}
    />
  )
}
