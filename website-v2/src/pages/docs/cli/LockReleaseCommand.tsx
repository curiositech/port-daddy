import { CommandPage } from '@/components/docs/CommandPage'

export default function LockReleaseCommand() {
  return (
    <CommandPage
      command="lock release"
      description="Release a distributed lock."
      version="3.13.0"
      syntax="pd lock release <name>"
      flags={[
        { flag: 'name', description: 'Lock name to release' },
      ]}
      usagePatterns={[
        'pd lock release db-migration',
      ]}
      examples={[
        {
          description: 'Release a lock',
          code: 'pd lock release db-migration',
          output: `Lock released: db-migration`
        },
      ]}
      seeAlso={[
        { name: 'lock acquire', href: '/docs/cli/lock-acquire' },
        { name: 'with-lock', href: '/docs/cli/with-lock' },
      ]}
    />
  )
}
