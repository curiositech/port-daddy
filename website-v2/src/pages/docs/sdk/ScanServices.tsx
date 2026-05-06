import { SdkFunctionPage } from '@/components/docs/SdkFunctionPage'

export default function ScanServices() {
  return (
    <SdkFunctionPage
      function="scanServices"
      description="Deep-scan a directory for services. Detects 60+ frameworks and assigns ports automatically."
      module="Ports"
      version="3.13.0"
      signature="scanServices(dir: string, options?: ScanOptions): Promise<Service[]>"
      params={[
        { name: 'dir', type: 'string', required: true, description: 'Directory to scan for services' },
        { name: 'options.frameworks', type: 'string[]', description: 'Frameworks to detect (default: auto-detect all)' },
        { name: 'options.claimPorts', type: 'boolean', description: 'Auto-claim ports for detected services (default: true)' },
      ]}
      returns={{
        type: 'Promise<Service[]>',
        description: 'Array of detected services with assigned ports'
      }}
      examples={[
        {
          description: 'Scan current directory for services',
          code: `const services = await pd.ports.scan('.')
console.log(services)`,
          output: `[
  {
    "identity": "myapp:api",
    "port": 3001,
    "framework": "express",
    "command": "npm run dev"
  },
  {
    "identity": "myapp:frontend",
    "port": 3000,
    "framework": "vite",
    "command": "npm run dev"
  }
]`
        },
        {
          description: 'Scan without auto-claiming ports',
          code: `const services = await pd.ports.scan('./services', {
  claimPorts: false
})`
        },
      ]}
      seeAlso={[
        { name: 'claimPort()', href: '/docs/sdk/ports' },
        { name: 'up()', href: '/docs/sdk/up' },
      ]}
    />
  )
}
