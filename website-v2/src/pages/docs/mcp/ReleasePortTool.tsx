import { CommandPage } from '@/components/docs/CommandPage'

export default function ReleasePortTool() {
  return (
    <CommandPage
      command="release_port"
      description="Release a previously claimed port. Safe to call even if the port is not claimed or was already released. Returns success status."
      version="3.11.0"
      syntax="release_port(identity)"
      flags={[
        { flag: 'identity', description: 'The identity whose port should be released (required)' },
      ]}
      usagePatterns={[
        'release_port({ identity: "myapp:api:main" })',
        'release_port({ identity: "myapp:frontend:dev" })',
      ]}
      examples={[
        {
          description: 'Release a port when service shuts down',
          code: 'release_port({ identity: "myapp:api:main" })',
          output: `{
  "success": true,
  "identity": "myapp:api:main",
  "released_at": "2026-03-16T12:30:00Z"
}`
        },
        {
          description: 'Safe to call on non-existent claim',
          code: 'release_port({ identity: "myapp:nonexistent" })',
          output: `{
  "success": false,
  "message": "Port not found for identity"
}`
        },
        {
          description: 'Release multiple ports',
          code: `release_port({ identity: "myapp:api:main" })
release_port({ identity: "myapp:frontend:main" })
release_port({ identity: "myapp:worker:main" })`,
          output: 'All ports released successfully'
        },
      ]}
      seeAlso={[
        { name: 'claim_port', href: '/docs/mcp/claim-port' },
        { name: 'find_port', href: '/docs/mcp/find-port' },
        { name: 'list_services', href: '/docs/mcp/list-services' },
        { name: 'SDK: releasePort()', href: '/docs/sdk/ports' },
      ]}
    />
  )
}
