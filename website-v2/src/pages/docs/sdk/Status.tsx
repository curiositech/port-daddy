import { SdkFunctionPage } from '@/components/docs/SdkFunctionPage'

export default function Status() {
  return (
    <SdkFunctionPage
      function="status"
      description="Get daemon status including uptime, port count, SQLite path, and code hash."
      module="Ports"
      version="3.8.3"
      signature="status(): Promise<DaemonStatus>"
      returns={{
        type: 'Promise<DaemonStatus>',
        description: 'Current daemon status and health information'
      }}
      examples={[
        {
          description: 'Get daemon status',
          code: `const status = await pd.status()
console.log(status)`,
          output: `{
  "version": "3.8.3",
  "uptime": "4h 12m",
  "services": 3,
  "dbPath": "/Users/me/.portdaddy/registry.db",
  "codeHash": "a1b2c3d4"
}`
        },
      ]}
      seeAlso={[
        { name: 'up()', href: '/docs/sdk/up' },
        { name: 'down()', href: '/docs/sdk/down' },
      ]}
    />
  )
}
