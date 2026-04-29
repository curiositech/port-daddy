import { CommandPage } from '@/components/docs/CommandPage'

export default function ListServicesTool() {
  return (
    <CommandPage
      command="list_services"
      description="List all active service claims with identity, port, and metadata. Optionally filter by project. Useful for discovering what services are running and where."
      version="3.11.0"
      syntax="list_services(options?)"
      flags={[
        { flag: 'project', description: 'Filter by project name (optional)' },
        { flag: 'status', description: "Filter by status: 'active', 'expired', or 'all' (default: 'active')" },
        { flag: 'limit', description: 'Maximum number of results to return (optional)' },
      ]}
      usagePatterns={[
        'list_services()',
        'list_services({ project: "myapp" })',
        'list_services({ project: "myapp", status: "active" })',
      ]}
      examples={[
        {
          description: 'List all active services',
          code: 'list_services()',
          output: `[
  {
    "identity": "myapp:api:main",
    "port": 3001,
    "claimed_at": "2026-03-16T12:00:00Z",
    "status": "active"
  },
  {
    "identity": "myapp:frontend:main",
    "port": 3000,
    "claimed_at": "2026-03-16T11:58:00Z",
    "status": "active"
  },
  {
    "identity": "otherapp:worker:dev",
    "port": 3002,
    "claimed_at": "2026-03-16T11:45:00Z",
    "status": "active"
  }
]`
        },
        {
          description: 'Filter by project',
          code: 'list_services({ project: "myapp" })',
          output: `[
  {
    "identity": "myapp:api:main",
    "port": 3001,
    "claimed_at": "2026-03-16T12:00:00Z",
    "status": "active"
  },
  {
    "identity": "myapp:frontend:main",
    "port": 3000,
    "claimed_at": "2026-03-16T11:58:00Z",
    "status": "active"
  }
]`
        },
        {
          description: 'Include expired claims',
          code: 'list_services({ status: "all" })',
          output: `[
  { "identity": "myapp:api:main", "port": 3001, "status": "active" },
  { "identity": "myapp:temp:old", "port": 3005, "status": "expired" }
]`
        },
      ]}
      seeAlso={[
        { name: 'claim_port', href: '/docs/mcp/claim-port' },
        { name: 'find_port', href: '/docs/mcp/find-port' },
        { name: 'begin_session', href: '/docs/mcp/begin-session' },
        { name: 'SDK: listServices()', href: '/docs/sdk/ports' },
      ]}
    />
  )
}
