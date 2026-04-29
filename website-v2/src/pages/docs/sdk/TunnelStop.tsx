import { SdkFunctionPage } from '@/components/docs/SdkFunctionPage'

export default function TunnelStop() {
  return (
    <SdkFunctionPage
      function="tunnelStop"
      description="Stop an active tunnel."
      module="Tunnels"
      version="3.11.0"
      signature="tunnelStop(identity: string): Promise<boolean>"
      params={[
        { name: 'identity', type: 'string', required: true, description: 'Service identity whose tunnel to stop' },
      ]}
      returns={{
        type: 'Promise<boolean>',
        description: 'True if tunnel was stopped'
      }}
      examples={[
        {
          description: 'Stop a tunnel',
          code: `await pd.tunnels.stop('myapp:api')
// Tunnel is now closed`
        },
      ]}
      seeAlso={[
        { name: 'tunnel()', href: '/docs/sdk/tunnel' },
      ]}
    />
  )
}
