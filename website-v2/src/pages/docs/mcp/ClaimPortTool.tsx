import { CommandPage } from '@/components/docs/CommandPage'

export default function ClaimPortTool() {
  return (
    <CommandPage
      command="claim_port"
      description="Claim a stable port for a service identity. Uses deterministic hashing to ensure the same identity always receives the same port. Idempotent — calling multiple times returns the same port."
      version="3.8.3"
      syntax="claim_port(identity, options?)"
      flags={[
        { flag: 'identity', description: 'Semantic identity (project:stack:context format)' },
        { flag: 'project', description: 'Project name (inferred from identity if not provided)' },
        { flag: 'stack', description: 'Stack/layer name (inferred from identity if not provided)' },
        { flag: 'ttl', description: 'Time-to-live in seconds (optional)' },
      ]}
      usagePatterns={[
        'claim_port({ identity: "myapp:api:main" })',
        'claim_port({ identity: "myapp:frontend:dev", ttl: 3600 })',
        'claim_port({ identity: "myapp:worker", project: "myapp" })',
      ]}
      examples={[
        {
          description: 'Basic usage — claim a port for an API service',
          code: 'claim_port({ identity: "myapp:api:main" })',
          output: `{
  "identity": "myapp:api:main",
  "port": 3001,
  "claimed_at": "2026-03-16T12:00:00Z",
  "status": "active"
}`
        },
        {
          description: 'With TTL — port auto-releases after 1 hour',
          code: 'claim_port({ identity: "myapp:worker:temp", ttl: 3600 })',
          output: `{
  "identity": "myapp:worker:temp",
  "port": 3005,
  "claimed_at": "2026-03-16T12:00:00Z",
  "expires_at": "2026-03-16T13:00:00Z",
  "ttl": 3600,
  "status": "active"
}`
        },
        {
          description: 'Idempotent — same port returned on repeat calls',
          code: `claim_port({ identity: "myapp:api:main" })
claim_port({ identity: "myapp:api:main" })`,
          output: `Port 3001 (same port returned both times)`
        },
      ]}
      seeAlso={[
        { name: 'release_port', href: '/docs/mcp/release-port' },
        { name: 'find_port', href: '/docs/mcp/find-port' },
        { name: 'list_services', href: '/docs/mcp/list-services' },
        { name: 'SDK: claimPort()', href: '/docs/sdk/ports' },
      ]}
    />
  )
}
