import { CommandPage } from '@/components/docs/CommandPage'

export default function AcquireLockTool() {
  return (
    <CommandPage
      command="acquire_lock"
      description="Acquire a distributed lock to prevent conflicts in multi-agent environments. Use locks when multiple agents might modify the same files or resources. Lock is automatically released when TTL expires."
      version="3.13.0"
      syntax="acquire_lock(name, options?)"
      flags={[
        { flag: 'name', description: 'Unique name for this lock (required)' },
        { flag: 'ttl', description: 'Time-to-live in seconds (default: 60)' },
        { flag: 'wait', description: 'Wait for lock instead of failing immediately (default: false)' },
        { flag: 'timeout', description: 'Max wait time in milliseconds when wait=true' },
      ]}
      usagePatterns={[
        'acquire_lock({ name: "database-migration" })',
        'acquire_lock({ name: "config-file", ttl: 300 })',
        'acquire_lock({ name: "build-artifacts", wait: true, timeout: 10000 })',
      ]}
      examples={[
        {
          description: 'Acquire lock for database migration',
          code: 'acquire_lock({ name: "database-migration", ttl: 300 })',
          output: `{
  "success": true,
  "lock": {
    "name": "database-migration",
    "holder": "agent-001",
    "acquired_at": "2026-03-16T12:00:00Z",
    "expires_at": "2026-03-16T12:05:00Z",
    "ttl": 300
  }
}`
        },
        {
          description: 'Lock already held — immediate failure',
          code: 'acquire_lock({ name: "database-migration" })',
          output: `{
  "success": false,
  "error": "Lock already held",
  "holder": "agent-002",
  "expires_at": "2026-03-16T12:03:00Z"
}`
        },
        {
          description: 'Wait for lock with timeout',
          code: 'acquire_lock({ name: "shared-resource", wait: true, timeout: 5000 })',
          output: `{
  "success": true,
  "lock": {
    "name": "shared-resource",
    "holder": "agent-001",
    "acquired_at": "2026-03-16T12:00:05Z",
    "waited_ms": 4500
  }
}`
        },
        {
          description: 'Timeout waiting for lock',
          code: 'acquire_lock({ name: "busy-resource", wait: true, timeout: 1000 })',
          output: `{
  "success": false,
  "error": "Timeout waiting for lock",
  "holder": "agent-003"
}`
        },
      ]}
      seeAlso={[
        { name: 'begin_session', href: '/docs/mcp/begin-session' },
        { name: 'publish_message', href: '/docs/mcp/publish-message' },
        { name: 'create_harbor', href: '/docs/mcp/create-harbor' },
        { name: 'SDK: Locks Module', href: '/docs/sdk/locks' },
      ]}
    />
  )
}
