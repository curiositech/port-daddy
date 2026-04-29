import { CommandPage } from '@/components/docs/CommandPage'

export default function TunnelStopTool() {
  return (
    <CommandPage
      command="tunnel_stop"
      description="Stop an active tunnel."
      version="3.11.0"
      syntax="tunnel_stop(identity)"
      flags={[
        { flag: 'identity', description: 'Service identity whose tunnel to stop' },
      ]}
      usagePatterns={[
        'tunnel_stop({ identity: "myapp:api" })',
      ]}
      examples={[
        {
          description: 'Stop a tunnel',
          code: 'tunnel_stop({ identity: "myapp:api" })',
          output: `{\n  "identity": "myapp:api",\n  "stopped": true\n}`
        },
      ]}
      seeAlso={[
        { name: 'tunnel', href: '/docs/mcp/tunnel' },
        { name: 'SDK: tunnelStop()', href: '/docs/sdk/tunnel-stop' },
      ]}
    />
  )
}
