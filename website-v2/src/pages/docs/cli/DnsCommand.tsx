import { CommandPage } from '@/components/docs/CommandPage'

export default function DnsCommand() {
  return (
    <CommandPage
      command="dns"
      description="Semantic DNS for service discovery. Register human-readable names for ports."
      version="3.7.0"
      syntax="pd dns <subcommand>"
      subcommands={[
        { name: 'register <name> <port>', description: 'Register a name → port mapping', href: '/docs/cli/dns-register' },
        { name: 'resolve <name>', description: 'Resolve a name to a port', href: '/docs/cli/dns-resolve' },
      ]}
      usagePatterns={[
        'pd dns register myapp-api 3001',
        'pd dns resolve myapp-api',
      ]}
      examples={[
        {
          description: 'Register a name',
          code: 'pd dns register myapp-api 3001',
          output: `DNS registered: myapp-api → 3001`
        },
        {
          description: 'Resolve a name',
          code: 'pd dns resolve myapp-api',
          output: `3001`
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
