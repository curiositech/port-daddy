import { SdkFunctionPage } from '@/components/docs/SdkFunctionPage'

export default function Up() {
  return (
    <SdkFunctionPage
      function="up"
      description="Start all registered services in the current project. Uses the detected start commands."
      module="Ports"
      version="3.7.0"
      signature="up(options?: UpOptions): Promise<Process[]>"
      params={[
        { name: 'options.project', type: 'string', description: 'Project name (default: auto-detect)' },
        { name: 'options.services', type: 'string[]', description: 'Specific services to start (default: all)' },
        { name: 'options.detached', type: 'boolean', description: 'Run in background (default: false)' },
      ]}
      returns={{
        type: 'Promise<Process[]>',
        description: 'Array of started process handles'
      }}
      examples={[
        {
          description: 'Start all services in the project',
          code: `const processes = await pd.ports.up()
console.log(processes)`,
          output: `[
  { identity: 'myapp:api', port: 3001, pid: 12345 },
  { identity: 'myapp:frontend', port: 3000, pid: 12346 }
]`
        },
        {
          description: 'Start specific services only',
          code: `await pd.ports.up({
  services: ['myapp:api', 'myapp:worker']
})`
        },
      ]}
      seeAlso={[
        { name: 'down()', href: '/docs/sdk/down' },
        { name: 'scanServices()', href: '/docs/sdk/scan-services' },
      ]}
    />
  )
}
