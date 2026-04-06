import { SdkFunctionPage } from '@/components/docs/SdkFunctionPage'

export default function Down() {
  return (
    <SdkFunctionPage
      function="down"
      description="Stop all running services in the current project. Sends graceful shutdown signals."
      module="Ports"
      version="3.8.3"
      signature="down(options?: DownOptions): Promise<string[]>"
      params={[
        { name: 'options.project', type: 'string', description: 'Project name (default: auto-detect)' },
        { name: 'options.force', type: 'boolean', description: 'Force kill after timeout (default: false)' },
        { name: 'options.timeout', type: 'number', description: 'Grace period in ms (default: 5000)' },
      ]}
      returns={{
        type: 'Promise<string[]>',
        description: 'Array of stopped service identities'
      }}
      examples={[
        {
          description: 'Stop all running services',
          code: `const stopped = await pd.ports.down()
console.log(stopped)`,
          output: `['myapp:api', 'myapp:frontend']`
        },
        {
          description: 'Force stop after 1 second',
          code: `await pd.ports.down({ force: true, timeout: 1000 })`
        },
      ]}
      seeAlso={[
        { name: 'up()', href: '/docs/sdk/up' },
        { name: 'status()', href: '/docs/sdk/status' },
      ]}
    />
  )
}
