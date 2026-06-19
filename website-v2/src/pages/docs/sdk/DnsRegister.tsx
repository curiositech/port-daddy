import { SdkFunctionPage } from '@/components/docs/SdkFunctionPage'

export default function DnsRegister() {
  return (
    <SdkFunctionPage
      function="dnsRegister"
      description="Register a human-readable name → port mapping. Other agents can resolve names instead of hardcoding ports."
      module="DNS"
      version="3.13.0"
      signature="dnsRegister(name: string, port: number, options?: DnsOptions): Promise<DnsRecord>"
      params={[
        { name: 'name', type: 'string', required: true, description: 'Human-readable name' },
        { name: 'port', type: 'number', required: true, description: 'Port number to map' },
        { name: 'options.ttl', type: 'number', description: 'Time-to-live in seconds (optional)' },
      ]}
      returns={{
        type: 'Promise<DnsRecord>',
        description: 'The created DNS record'
      }}
      examples={[
        {
          description: 'Register a service name',
          code: `await pd.dns.register('myapp-api', 3001)`
        },
        {
          description: 'Register with TTL',
          code: `await pd.dns.register('temp-service', 8080, {
  ttl: 3600 // Expires in 1 hour
})`
        },
      ]}
      seeAlso={[
        { name: 'dnsResolve()', href: '/docs/sdk/dns-resolve' },
        { name: 'claimPort()', href: '/docs/sdk/ports' },
      ]}
    />
  )
}
