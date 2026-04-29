import { CommandPage } from '@/components/docs/CommandPage'

export default function TunnelTool() {
  return (
    <CommandPage
      command="tunnel"
      description="Create a secure tunnel to a service. Enables external access to local services."
      version="3.11.0"
      syntax="tunnel(identity, options?)"
      flags={[
        { flag: 'identity', description: 'Service identity to tunnel to' },
        { flag: 'subdomain', description: 'Custom subdomain (optional)' },
        { flag: 'region', description: 'Tunnel region (default: auto)' },
      ]}
      usagePatterns={[
        'tunnel({ identity: "myapp:api" })',
        'tunnel({ identity: "myapp:api", subdomain: "myapp-api" })',
      ]}
      examples={[
        {
          description: 'Create a tunnel',
          code: 'tunnel({ identity: "myapp:api" })',
          output: `{\n  "identity": "myapp:api",\n  "local_port": 3001,\n  "public_url": "https://abc123.tunnel.portdaddy.dev",\n  "status": "active"\n}`
        },
        {
          description: 'Create with custom subdomain',
          code: 'tunnel({ identity: "myapp:api", subdomain: "myapp-api" })',
          output: `{\n  "public_url": "https://myapp-api.tunnel.portdaddy.dev"\n}`
        },
      ]}
      seeAlso={[
        { name: 'tunnel_stop', href: '/docs/mcp/tunnel-stop' },
        { name: 'claim_port', href: '/docs/mcp/claim-port' },
        { name: 'SDK: tunnel()', href: '/docs/sdk/tunnel' },
      ]}
    />
  )
}
