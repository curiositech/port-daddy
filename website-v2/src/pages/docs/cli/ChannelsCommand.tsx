import { CommandPage } from '@/components/docs/CommandPage'

export default function ChannelsCommand() {
  return (
    <CommandPage
      command="pd channels"
      description="Inspect and resolve Port Daddy pub/sub channels. Declared logical channels resolve against the current repo or worktree so humans can use stable names while the daemon uses scoped physical channels."
      version="3.8.3"
      syntax={`pd channels\npd channels discover [query]\npd channels describe <name>\npd channels ensure <name> [--scope branch|worktree|repo|global]`}
      subcommands={[
        { name: 'discover [query]', description: 'List declared channels for the current worktree, optionally filtered by query.', href: '/docs/cli/channels#discover' },
        { name: 'describe <name>', description: 'Resolve a logical channel to the physical channel the daemon uses.', href: '/docs/cli/channels#describe' },
        { name: 'ensure <name>', description: 'Declare or update a canonical channel.', href: '/docs/cli/channels#ensure' },
      ]}
      usagePatterns={[
        'pd channels',
        'pd channels discover git',
        'pd channels describe git:committed',
        'pd channels ensure docs:changed --scope worktree --description "Documentation update events"',
      ]}
      examples={[
        {
          description: 'List active channels',
          code: 'pd channels',
          output: `CHANNEL                                 MESSAGES    LAST ACTIVITY
fleet:events                            8227        1m
project:port-daddy:fe53192e:git:committed31          1d`,
        },
        {
          description: 'Resolve a declared logical channel',
          code: 'pd channels describe git:committed',
          output: `logical:  git:committed
physical: project:port-daddy:fe53192e21fe:git:committed
scope:    worktree`,
        },
      ]}
      seeAlso={[
        { name: 'pd pub / pd sub', href: '/docs/cli/pub' },
        { name: 'pd watch', href: '/docs/cli/watch' },
      ]}
    />
  )
}
