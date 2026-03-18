import { CommandPage } from '@/components/docs/CommandPage'

export default function FindCommand() {
  return (
    <CommandPage
      command="find"
      description="Look up the port assigned to an identity without claiming a new one."
      version="3.7.0"
      syntax="pd find <identity>"
      shortFlag="-q"
      flags={[
        { flag: 'identity', description: 'Service identity to look up' },
        { flag: '-q, --quiet', description: 'Output port number only' },
      ]}
      usagePatterns={[
        'pd find myapp:api:main',
        'pd find myapp:api:main -q',
      ]}
      examples={[
        {
          description: 'Find assigned port',
          code: 'pd find myapp:api:main',
          output: `3001`
        },
        {
          description: 'Quiet mode for scripts',
          code: 'pd find myapp:api:main --quiet',
          output: `3001`
        },
      ]}
      seeAlso={[
        { name: 'claim', href: '/docs/cli/claim' },
        { name: 'release', href: '/docs/cli/release' },
        { name: 'services', href: '/docs/cli/services' },
      ]}
    />
  )
}
