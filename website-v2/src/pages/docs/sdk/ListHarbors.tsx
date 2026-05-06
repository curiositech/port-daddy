import { SdkFunctionPage } from '@/components/docs/SdkFunctionPage'

export default function ListHarbors() {
  return (
    <SdkFunctionPage
      function="listHarbors"
      description="List all active harbors and their capabilities."
      module="Harbors"
      version="3.13.0"
      signature="listHarbors(options?: ListHarborsOptions): Promise<Harbor[]>"
      params={[
        { name: 'options.active', type: 'boolean', description: 'Only show harbors with active tokens (default: true)' },
      ]}
      returns={{
        type: 'Promise<Harbor[]>',
        description: 'Array of harbor information'
      }}
      examples={[
        {
          description: 'List all active harbors',
          code: `const harbors = await pd.harbors.list()
console.log(harbors)`,
          output: `[
  {
    "name": "myapp:security-review",
    "capabilities": ["code:read", "notes:write"],
    "agents": 3,
    "expiresAt": "2026-03-16T16:00:00Z"
  }
]`
        },
      ]}
      seeAlso={[
        { name: 'createHarbor()', href: '/docs/sdk/harbors' },
        { name: 'enterHarbor()', href: '/docs/sdk/harbors' },
        { name: 'leaveHarbor()', href: '/docs/sdk/leave-harbor' },
      ]}
    />
  )
}
