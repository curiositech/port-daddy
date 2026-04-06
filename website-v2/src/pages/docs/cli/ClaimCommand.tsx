import { CommandPage } from '@/components/docs/CommandPage'

export default function ClaimCommand() {
  return (
    <CommandPage
      command="pd claim"
      description="Claim a port for a service. Identity uses project:stack:context format. Returns the same port on repeat calls (idempotent)."
      version="3.8.3"
      syntax="pd claim <identity> [flags]"
      flags={[
        { flag: '--quiet, -q', description: 'Output port number only' },
        { flag: '--json, -j', description: 'Output full JSON with metadata' },
        { flag: '--ttl <duration>', description: 'Time-to-live for the claim (e.g., 1h, 30m)' },
      ]}
      usagePatterns={[
        'pd claim myapp:api:main',
        'pd claim myapp:frontend:dev --ttl 2h',
        'pd claim myapp:worker:staging --json',
      ]}
      examples={[
        {
          description: 'Basic usage - claim a port for an API service',
          code: 'pd claim myapp:api:main',
          output: 'Port 3001 assigned to myapp:api:main'
        },
        {
          description: 'Quiet mode - get just the port number',
          code: 'pd claim myapp:api:main --quiet',
          output: '3001'
        },
        {
          description: 'JSON output - get full metadata',
          code: 'pd claim myapp:api:main --json',
          output: `{
  "identity": "myapp:api:main",
  "port": 3001,
  "claimed_at": "2026-03-16T12:00:00Z",
  "ttl": null,
  "status": "active"
}`
        },
        {
          description: 'Idempotent - calling twice returns same port',
          code: `pd claim myapp:api:main
pd claim myapp:api:main`,
          output: `Port 3001 assigned to myapp:api:main
Port 3001 assigned to myapp:api:main`
        },
      ]}
      seeAlso={[
        { name: 'pd release', href: '/docs/cli/release' },
        { name: 'pd find', href: '/docs/cli/find' },
        { name: 'pd services', href: '/docs/cli/services' },
        { name: 'TypeScript SDK: claim()', href: '/docs/sdk/ports' },
      ]}
    />
  )
}
