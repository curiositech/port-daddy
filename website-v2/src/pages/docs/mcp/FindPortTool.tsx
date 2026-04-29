import { CommandPage } from '@/components/docs/CommandPage'

export default function FindPortTool() {
  return (
    <CommandPage
      command="find_port"
      description="Find the port assigned to an identity without claiming a new one. Returns null if the identity has not claimed a port. Useful for discovering where services are running."
      version="3.11.0"
      syntax="find_port(identity)"
      flags={[
        { flag: 'identity', description: 'The identity to look up (required)' },
      ]}
      usagePatterns={[
        'find_port({ identity: "myapp:api:main" })',
        'find_port({ identity: "myapp:frontend:dev" })',
      ]}
      examples={[
        {
          description: 'Find port for an existing service',
          code: 'find_port({ identity: "myapp:api:main" })',
          output: `{
  "identity": "myapp:api:main",
  "port": 3001,
  "claimed_at": "2026-03-16T12:00:00Z",
  "status": "active"
}`
        },
        {
          description: 'Returns null if not found',
          code: 'find_port({ identity: "myapp:nonexistent" })',
          output: `null`
        },
        {
          description: 'Use in conditional logic',
          code: `const portInfo = find_port({ identity: "myapp:api:main" })
if (portInfo) {
  console.log(\`Service running on port \${portInfo.port}\`)
} else {
  // Need to claim a new port
  const newPort = claim_port({ identity: "myapp:api:main" })
}`,
          output: 'Port 3001 (or newly claimed port)'
        },
      ]}
      seeAlso={[
        { name: 'claim_port', href: '/docs/mcp/claim-port' },
        { name: 'release_port', href: '/docs/mcp/release-port' },
        { name: 'list_services', href: '/docs/mcp/list-services' },
        { name: 'SDK: findPort()', href: '/docs/sdk/ports' },
      ]}
    />
  )
}
