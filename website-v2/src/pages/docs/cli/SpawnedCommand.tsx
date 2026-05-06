import { CommandPage } from '@/components/docs/CommandPage'

export default function SpawnedCommand() {
  return (
    <CommandPage
      command="spawned"
      description="List all currently running spawned agents."
      version="3.13.0"
      syntax="pd spawned"
      flags={[
        { flag: '-j, --json', description: 'JSON output' },
      ]}
      usagePatterns={[
        'pd spawned',
        'pd spawned --json',
      ]}
      examples={[
        {
          description: 'List spawned agents',
          code: 'pd spawned',
          output: `myapp:reviewer   claude/claude-haiku-4-5   running   2m 14s`
        },
      ]}
      seeAlso={[
        { name: 'spawn', href: '/docs/cli/spawn' },
        { name: 'salvage', href: '/docs/cli/salvage' },
        { name: 'agent register', href: '/docs/cli/agent-register' },
      ]}
    />
  )
}
