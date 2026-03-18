import { SdkFunctionPage } from '@/components/docs/SdkFunctionPage'

export default function Tunnel() {
  return (
    <SdkFunctionPage
      function="tunnel"
      description="Create a secure tunnel to a service. Enables external access to local services."
      module="Tunnels"
      version="3.7.0"
      signature="tunnel(identity: string, options?: TunnelOptions): Promise<TunnelInfo>"
      params={[
        { name: 'identity', type: 'string', required: true, description: 'Service identity to tunnel to' },
        { name: 'options.subdomain', type: 'string', description: 'Custom subdomain (optional)' },
        { name: 'options.region', type: 'string', description: 'Tunnel region (default: auto)' },
      ]}
      returns={{
        type: 'Promise<TunnelInfo>',
        description: 'Tunnel information including public URL'
      }}
      examples={[
        {
          description: 'Create a tunnel to a service',
          code: `const tunnel = await pd.tunnels.create('myapp:api')
console.log(tunnel)`,
          output: `{
  "identity": "myapp:api",
  "localPort": 3001,
  "publicUrl": "https://abc123.tunnel.portdaddy.dev",
  "status": "active"
}`
        },
        {
          description: 'Create with custom subdomain',
          code: `await pd.tunnels.create('myapp:api', {
  subdomain: 'myapp-api'
})`
        },
      ]}
      seeAlso={[
        { name: 'tunnelStop()', href: '/docs/sdk/tunnel-stop' },
        { name: 'claimPort()', href: '/docs/sdk/ports' },
      ]}
    />
  )
}
