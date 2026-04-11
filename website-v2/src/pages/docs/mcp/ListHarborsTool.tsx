import { CommandPage } from '@/components/docs/CommandPage'

export default function ListHarborsTool() {
  return (
    <CommandPage
      command="list_harbors"
      description="List all active harbors and their capabilities."
      version="3.8.3"
      syntax="list_harbors(options?)"
      flags={[
        { flag: 'active', description: 'Only show harbors with active tokens (default: true)' },
      ]}
      usagePatterns={[
        'list_harbors()',
        'list_harbors({ active: false })',
      ]}
      examples={[
        {
          description: 'List active harbors',
          code: 'list_harbors()',
          output: `[\n  {\n    "name": "myapp:security-review",\n    "capabilities": ["code:read", "notes:write"],\n    "agents": 3,\n    "expires_at": "2026-03-16T16:00:00Z"\n  }\n]`
        },
      ]}
      seeAlso={[
        { name: 'create_harbor', href: '/docs/mcp/create-harbor' },
        { name: 'leave_harbor', href: '/docs/mcp/leave-harbor' },
        { name: 'SDK: listHarbors()', href: '/docs/sdk/list-harbors' },
      ]}
    />
  )
}
