import { SdkFunctionPage } from '@/components/docs/SdkFunctionPage'

export default function Salvage() {
  return (
    <SdkFunctionPage
      function="salvage"
      description="Show agents in the resurrection queue — agents that died mid-task with active sessions."
      module="Agents"
      version="3.13.0"
      signature="salvage(options?: SalvageOptions): Promise<SalvageableAgent[]>"
      params={[
        { name: 'options.project', type: 'string', description: 'Filter by project identity prefix' },
      ]}
      returns={{
        type: 'Promise<SalvageableAgent[]>',
        description: 'Array of dead agents that can be salvaged'
      }}
      examples={[
        {
          description: 'Check salvage queue',
          code: `const queue = await pd.agents.salvage()
console.log(queue)`,
          output: `[
  {
    "agentId": "agent-001",
    "identity": "myapp:coder",
    "diedAt": "2026-03-16T11:52:00Z",
    "purpose": "Fix auth bug"
  },
  {
    "agentId": "agent-002",
    "identity": "myapp:tester",
    "diedAt": "2026-03-16T11:57:00Z",
    "purpose": "Run test suite"
  }
]`
        },
        {
          description: 'Filter by project',
          code: `const queue = await pd.agents.salvage({ project: 'myapp' })`
        },
      ]}
      seeAlso={[
        { name: 'salvageClaim()', href: '/docs/sdk/salvage-claim' },
        { name: 'listSpawned()', href: '/docs/sdk/list-spawned' },
      ]}
    />
  )
}
