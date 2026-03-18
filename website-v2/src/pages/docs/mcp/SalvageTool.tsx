import { CommandPage } from '@/components/docs/CommandPage'

export default function SalvageTool() {
  return (
    <CommandPage
      command="salvage"
      description="Show agents in the resurrection queue — agents that died mid-task with active sessions."
      version="3.7.0"
      syntax="salvage(options?)"
      flags={[
        { flag: 'project', description: 'Filter by project identity prefix' },
      ]}
      usagePatterns={[
        'salvage()',
        'salvage({ project: "myapp" })',
      ]}
      examples={[
        {
          description: 'Check salvage queue',
          code: 'salvage()',
          output: `{\n  "queue": [\n    {\n      "agent_id": "agent-001",\n      "identity": "myapp:coder",\n      "died_at": "2026-03-16T11:52:00Z",\n      "purpose": "Fix auth bug"\n    }\n  ],\n  "count": 1\n}`
        },
      ]}
      seeAlso={[
        { name: 'salvage_claim', href: '/docs/mcp/salvage-claim' },
        { name: 'list_spawned', href: '/docs/mcp/list-spawned' },
        { name: 'SDK: salvage()', href: '/docs/sdk/salvage' },
      ]}
    />
  )
}
