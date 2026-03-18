import { CommandPage } from '@/components/docs/CommandPage'

export default function CreateHarborTool() {
  return (
    <CommandPage
      command="create_harbor"
      description="Create a cryptographic capability namespace (Harbor) for secure agent operations. Harbors restrict what agents can do and create secure enclaves with fine-grained permissions. Agents must present a valid Harbor Card to enter."
      version="3.7.0"
      syntax="create_harbor(name, options?)"
      flags={[
        { flag: 'name', description: 'Unique name for this harbor (required)' },
        { flag: 'capabilities', description: 'Allowed capabilities array (e.g., ["read", "write"])' },
        { flag: 'allowed_identities', description: 'Identity patterns allowed to enter (e.g., ["myapp:*"])' },
        { flag: 'ttl', description: 'Harbor lifetime in seconds (default: 3600)' },
      ]}
      usagePatterns={[
        'create_harbor({ name: "production-db" })',
        'create_harbor({ name: "staging-api", capabilities: ["read", "write"] })',
        'create_harbor({ name: "analytics", capabilities: ["read"], allowed_identities: ["myapp:analytics:*"] })',
      ]}
      examples={[
        {
          description: 'Create read-write harbor for production database',
          code: 'create_harbor({ name: "production-db", capabilities: ["read", "write"], allowed_identities: ["myapp:api:*", "myapp:admin:*"] })',
          output: `{
  "success": true,
  "harbor": {
    "name": "production-db",
    "capabilities": ["read", "write"],
    "allowed_identities": ["myapp:api:*", "myapp:admin:*"],
    "created_at": "2026-03-16T12:00:00Z",
    "expires_at": "2026-03-16T13:00:00Z",
    "token": "harbor-token-abc123"
  }
}`
        },
        {
          description: 'Create read-only harbor for analytics',
          code: 'create_harbor({ name: "analytics-readonly", capabilities: ["read"], allowed_identities: ["myapp:analytics:*"], ttl: 7200 })',
          output: `{
  "success": true,
  "harbor": {
    "name": "analytics-readonly",
    "capabilities": ["read"],
    "allowed_identities": ["myapp:analytics:*"],
    "created_at": "2026-03-16T12:00:00Z",
    "expires_at": "2026-03-16T14:00:00Z",
    "token": "harbor-token-xyz789"
  }
}`
        },
        {
          description: 'Harbor with wildcard identities',
          code: 'create_harbor({ name: "shared-cache", capabilities: ["read", "write", "delete"], allowed_identities: ["*"] })',
          output: `{
  "success": true,
  "harbor": {
    "name": "shared-cache",
    "capabilities": ["read", "write", "delete"],
    "allowed_identities": ["*"],
    "created_at": "2026-03-16T12:00:00Z",
    "token": "harbor-token-shared001"
  }
}`
        },
        {
          description: 'Harbor already exists',
          code: 'create_harbor({ name: "production-db" })',
          output: `{
  "success": false,
  "error": "Harbor already exists",
  "existing_harbor": "production-db"
}`
        },
      ]}
      seeAlso={[
        { name: 'begin_session', href: '/docs/mcp/begin-session' },
        { name: 'acquire_lock', href: '/docs/mcp/acquire-lock' },
        { name: 'publish_message', href: '/docs/mcp/publish-message' },
        { name: 'SDK: Harbors Module', href: '/docs/sdk/harbors' },
        { name: 'CLI: pd harbor create', href: '/docs/cli/harbor-create' },
      ]}
    />
  )
}
