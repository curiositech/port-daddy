import { CommandPage } from '@/components/docs/CommandPage'

export default function DnsRegisterTool() {
  return (
    <CommandPage
      command="dns_register"
      description="Register a human-readable name → port mapping. Other agents can resolve names instead of hardcoding ports."
      version="3.13.0"
      syntax="dns_register(name, port, options?)"
      flags={[
        { flag: 'name', description: 'Human-readable name' },
        { flag: 'port', description: 'Port number to map' },
        { flag: 'ttl', description: 'Time-to-live in seconds (optional)' },
      ]}
      usagePatterns={[
        'dns_register({ name: "myapp-api", port: 3001 })',
        'dns_register({ name: "temp-service", port: 8080, ttl: 3600 })',
      ]}
      examples={[
        {
          description: 'Register a service name',
          code: 'dns_register({ name: "myapp-api", port: 3001 })',
          output: `{\n  "name": "myapp-api",\n  "port": 3001,\n  "registered": true\n}`
        },
        {
          description: 'Register with TTL',
          code: 'dns_register({ name: "temp-service", port: 8080, ttl: 3600 })',
          output: `{\n  "name": "temp-service",\n  "port": 8080,\n  "ttl": 3600,\n  "expires_at": "2026-03-16T16:00:00Z"\n}`
        },
      ]}
      seeAlso={[
        { name: 'dns_resolve', href: '/docs/mcp/dns-resolve' },
        { name: 'claim_port', href: '/docs/mcp/claim-port' },
        { name: 'SDK: dnsRegister()', href: '/docs/sdk/dns-register' },
      ]}
    />
  )
}
