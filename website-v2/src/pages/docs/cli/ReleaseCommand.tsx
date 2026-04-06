import { CommandPage } from '@/components/docs/CommandPage'

export default function ReleaseCommand() {
  return (
    <CommandPage
      command="release"
      description="Release a port claim. Safe to call even if the port is not claimed."
      version="3.8.3"
      syntax="pd release <identity>"
      flags={[
        { flag: 'identity', description: 'Service identity to release (project:stack:context)' },
      ]}
      usagePatterns={[
        'pd release myapp:api:main',
      ]}
      examples={[
        {
          description: 'Release a port',
          code: 'pd release myapp:api:main',
          output: `Released myapp:api:main (port 3001)`
        },
      ]}
      seeAlso={[
        { name: 'claim', href: '/docs/cli/claim' },
        { name: 'find', href: '/docs/cli/find' },
        { name: 'services', href: '/docs/cli/services' },
      ]}
    />
  )
}
