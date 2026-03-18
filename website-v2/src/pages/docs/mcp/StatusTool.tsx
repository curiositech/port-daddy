import { CommandPage } from '@/components/docs/CommandPage'

export default function StatusTool() {
  return (
    <CommandPage
      command="status"
      description="Get daemon status including uptime, port count, SQLite path, and code hash."
      version="3.7.0"
      syntax="status()"
      usagePatterns={[
        'status()',
      ]}
      examples={[
        {
          description: 'Get daemon status',
          code: 'status()',
          output: `{\n  "version": "3.7.0",\n  "uptime": "4h 12m",\n  "services": 3,\n  "db_path": "/Users/me/.portdaddy/registry.db",\n  "code_hash": "a1b2c3d4"\n}`
        },
      ]}
      seeAlso={[
        { name: 'up', href: '/docs/mcp/up' },
        { name: 'down', href: '/docs/mcp/down' },
        { name: 'SDK: status()', href: '/docs/sdk/status' },
      ]}
    />
  )
}
