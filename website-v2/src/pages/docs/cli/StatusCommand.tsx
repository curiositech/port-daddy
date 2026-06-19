import { CommandPage } from '@/components/docs/CommandPage'

export default function StatusCommand() {
  return (
    <CommandPage
      command="status"
      description="Daemon status: uptime, port count, SQLite path, and code hash."
      version="3.13.0"
      syntax="pd status"
      usagePatterns={[
        'pd status',
      ]}
      examples={[
        {
          description: 'Get daemon status',
          code: 'pd status',
          output: `[pd] Port Daddy v3.13.0 — 3 services, uptime 4h 12m`
        },
      ]}
      seeAlso={[
        { name: 'services', href: '/docs/cli/services' },
        { name: 'up', href: '/docs/cli/up' },
        { name: 'down', href: '/docs/cli/down' },
      ]}
    />
  )
}
