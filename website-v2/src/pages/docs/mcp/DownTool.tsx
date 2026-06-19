import { CommandPage } from '@/components/docs/CommandPage'

export default function DownTool() {
  return (
    <CommandPage
      command="down"
      description="Stop all running services in the current project. Sends graceful shutdown signals."
      version="3.13.0"
      syntax="down(options?)"
      flags={[
        { flag: 'project', description: 'Project name (default: auto-detect)' },
        { flag: 'force', description: 'Force kill after timeout (default: false)' },
        { flag: 'timeout', description: 'Grace period in ms (default: 5000)' },
      ]}
      usagePatterns={[
        'down()',
        'down({ force: true, timeout: 1000 })',
      ]}
      examples={[
        {
          description: 'Stop all services',
          code: 'down()',
          output: `{\n  "stopped": ["myapp:api", "myapp:frontend"]\n}`
        },
        {
          description: 'Force stop quickly',
          code: 'down({ force: true, timeout: 1000 })',
        },
      ]}
      seeAlso={[
        { name: 'up', href: '/docs/mcp/up' },
        { name: 'status', href: '/docs/mcp/status' },
        { name: 'SDK: down()', href: '/docs/sdk/down' },
      ]}
    />
  )
}
