import { SdkFunctionPage } from '@/components/docs/SdkFunctionPage'

export default function DnsResolve() {
  return (
    <SdkFunctionPage
      function="dnsResolve"
      description="Resolve a name to a port number. Returns null if name is not registered."
      module="DNS"
      version="3.7.0"
      signature="dnsResolve(name: string): Promise<number | null>"
      params={[
        { name: 'name', type: 'string', required: true, description: 'Name to resolve' },
      ]}
      returns={{
        type: 'Promise<number | null>',
        description: 'Port number or null if not found'
      }}
      examples={[
        {
          description: 'Resolve a service name',
          code: `const port = await pd.dns.resolve('myapp-api')
console.log(port) // 3001`
        },
        {
          description: 'Handle missing names',
          code: `const port = await pd.dns.resolve('unknown-service')
if (!port) {
  console.log('Service not found')
}`
        },
        {
          description: 'Use in connection string',
          code: `const apiPort = await pd.dns.resolve('myapp-api')
const response = await fetch(\`http://localhost:\${apiPort}/api\`)`
        },
      ]}
      seeAlso={[
        { name: 'dnsRegister()', href: '/docs/sdk/dns-register' },
        { name: 'findPort()', href: '/docs/sdk/ports' },
      ]}
    />
  )
}
