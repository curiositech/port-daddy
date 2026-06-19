import { SdkFunctionPage } from '@/components/docs/SdkFunctionPage'

export default function ListSpawned() {
  return (
    <SdkFunctionPage
      function="listSpawned"
      description="List all currently running spawned agents."
      module="Agents"
      version="3.13.0"
      signature="listSpawned(options?: ListSpawnedOptions): Promise<AgentInfo[]>"
      params={[
        { name: 'options.project', type: 'string', description: 'Filter by project identity prefix' },
        { name: 'options.status', type: "'running' | 'dead' | 'all'", description: 'Filter by status (default: running)' },
      ]}
      returns={{
        type: 'Promise<AgentInfo[]>',
        description: 'Array of agent information'
      }}
      examples={[
        {
          description: 'List all running agents',
          code: `const agents = await pd.agents.list()
console.log(agents)`,
          output: `[
  {
    "identity": "myapp:reviewer",
    "backend": "claude",
    "model": "claude-haiku-4-5",
    "status": "running",
    "uptime": "2m 14s"
  }
]`
        },
        {
          description: 'List dead agents for salvage',
          code: `const dead = await pd.agents.list({ status: 'dead' })
console.log(\`\${dead.length} agents to salvage\`)`
        },
      ]}
      seeAlso={[
        { name: 'spawn()', href: '/docs/sdk/spawn' },
        { name: 'salvage()', href: '/docs/sdk/salvage' },
      ]}
    />
  )
}
