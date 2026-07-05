import { CommandPage } from '@/components/docs/CommandPage'

export default function ListSpawnedTool() {
  return (
    <CommandPage
      command="list_spawned"
      description="List all currently running spawned agents."
      version="3.13.0"
      syntax="list_spawned(options?)"
      flags={[
        { flag: 'project', description: 'Filter by project identity prefix' },
        { flag: 'status', description: "Filter by status: 'running' | 'dead' | 'all' (default: running)" },
      ]}
      usagePatterns={[
        'list_spawned()',
        'list_spawned({ project: "myapp" })',
        'list_spawned({ status: "dead" })',
      ]}
      examples={[
        {
          description: 'List running agents',
          code: 'list_spawned()',
          output: `[\n  {\n    "identity": "myapp:reviewer",\n    "backend": "claude",\n    "model": "claude-haiku-4-5",\n    "status": "running",\n    "uptime": "2m 14s"\n  }\n]`
        },
        {
          description: 'List dead agents for salvage',
          code: 'list_spawned({ status: "dead" })',
        },
      ]}
      seeAlso={[
        { name: 'spawn', href: '/docs/mcp/spawn' },
        { name: 'salvage', href: '/docs/mcp/salvage' },
        { name: 'SDK: listSpawned()', href: '/docs/sdk/list-spawned' },
      ]}
    />
  )
}
