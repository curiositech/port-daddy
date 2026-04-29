import { CommandPage } from '@/components/docs/CommandPage'

export default function DnsResolveTool() {
  return (
    <CommandPage
      command="dns_resolve"
      description="Resolve a name to a port number. Returns null if name is not registered."
      version="3.11.0"
      syntax="dns_resolve(name)"
      flags={[
        { flag: 'name', description: 'Name to resolve' },
        { flag: 'quiet', description: 'Output port number only (optional)' },
      ]}
      usagePatterns={[
        'dns_resolve({ name: "myapp-api" })',
        'dns_resolve({ name: "myapp-api", quiet: true })',
      ]}
      examples={[
        {
          description: 'Resolve a service name',
          code: 'dns_resolve({ name: "myapp-api" })',
          output: `{\n  "name": "myapp-api",\n  "port": 3001\n}`
        },
        {
          description: 'Quiet mode — port only',
          code: 'dns_resolve({ name: "myapp-api", quiet: true })',
          output: `3001`
        },
        {
          description: 'Not found',
          code: 'dns_resolve({ name: "unknown-service" })',
          output: `null`
        },
      ]}
      seeAlso={[
        { name: 'dns_register', href: '/docs/mcp/dns-register' },
        { name: 'find_port', href: '/docs/mcp/find-port' },
        { name: 'SDK: dnsResolve()', href: '/docs/sdk/dns-resolve' },
      ]}
    />
  )
}
