import { CommandPage } from '@/components/docs/CommandPage'

export default function LockAcquireCommand() {
  return (
    <CommandPage
      command="pd lock acquire"
      description="Acquire a distributed lock. Only one holder at a time. Returns immediately if lock is already held (non-blocking by default). Essential for preventing race conditions in multi-agent workflows."
      version="3.7.0"
      syntax="pd lock acquire <name> [flags]"
      flags={[
        { flag: '--ttl <ms>', description: 'Lock timeout in ms (default 300000 = 5min)' },
        { flag: '--wait', description: 'Block until lock becomes available' },
      ]}
      usagePatterns={[
        'pd lock acquire db-migration',
        'pd lock acquire db-migration --ttl 60000',
        'pd lock acquire deployment --wait',
      ]}
      examples={[
        {
          description: 'Acquire a lock with default TTL (5 minutes)',
          code: 'pd lock acquire db-migration',
          output: 'Lock acquired: db-migration (expires in 300s)'
        },
        {
          description: 'Acquire with custom TTL',
          code: 'pd lock acquire db-migration --ttl 60000',
          output: 'Lock acquired: db-migration (expires in 60s)'
        },
        {
          description: 'Wait for lock to become available',
          code: 'pd lock acquire deployment --wait',
          output: `Waiting for lock: deployment...
  → Lock held by agent-002, waiting...
  → Lock acquired: deployment (expires in 300s)`
        },
        {
          description: 'Lock already held - non-blocking failure',
          code: 'pd lock acquire db-migration',
          output: `[pd] Error: Lock 'db-migration' already held by agent-001
[pd] Use --wait to block until available`
        },
        {
          description: 'Use with pd with-lock for automatic cleanup',
          code: 'pd with-lock db-migration -- npm run migrate',
          output: `Acquired db-migration
> npm run migrate
  Migrating... done (3 migrations)
Released db-migration`
        },
        {
          description: 'List active locks',
          code: 'pd locks',
          output: `LOCKS (2 active)
  db-migration   agent-001   expires in 4m 23s
  deployment     agent-002   expires in 2m 15s`
        },
      ]}
      seeAlso={[
        { name: 'pd lock release', href: '/docs/cli/lock-release' },
        { name: 'pd with-lock', href: '/docs/cli/with-lock' },
        { name: 'pd locks', href: '/docs/cli/locks' },
      ]}
    />
  )
}
