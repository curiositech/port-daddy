import { CommandPage } from '@/components/docs/CommandPage'

export default function WithLockCommand() {
  return (
    <CommandPage
      command="with-lock"
      description="Run a command inside a lock. Acquires lock, runs command, releases lock — even if the command fails."
      version="3.8.3"
      syntax="pd with-lock <name> -- <command>"
      flags={[
        { flag: 'name', description: 'Lock name' },
        { flag: 'command', description: 'Command to run inside the lock' },
      ]}
      usagePatterns={[
        'pd with-lock db-migration -- npm run migrate',
      ]}
      examples={[
        {
          description: 'Run migration with lock',
          code: 'pd with-lock db-migration -- npm run migrate',
          output: `Acquired db-migration
> npm run migrate
  Migrating... done (3 migrations)
Released db-migration`
        },
      ]}
      seeAlso={[
        { name: 'lock acquire', href: '/docs/cli/lock-acquire' },
        { name: 'lock release', href: '/docs/cli/lock-release' },
      ]}
    />
  )
}
