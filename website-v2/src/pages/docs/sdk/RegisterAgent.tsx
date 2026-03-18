import { SdkFunctionPage } from '@/components/docs/SdkFunctionPage'

export default function RegisterAgent() {
  return (
    <SdkFunctionPage
      function="registerAgent"
      description="Register this process as an agent. Used by spawned agents internally, but also callable directly."
      module="Agents"
      version="3.7.0"
      signature="registerAgent(options: RegisterOptions): Promise<AgentRegistration>"
      params={[
        { name: 'options.agent', type: 'string', required: true, description: 'Agent ID (UUID recommended)' },
        { name: 'options.identity', type: 'string', required: true, description: 'Semantic identity' },
        { name: 'options.purpose', type: 'string', description: 'What this agent is doing' },
      ]}
      returns={{
        type: 'Promise<AgentRegistration>',
        description: 'Registration confirmation with warnings if any'
      }}
      examples={[
        {
          description: 'Register as an agent',
          code: `const reg = await pd.agents.register({
  agent: 'agent-001',
  identity: 'myapp:coder',
  purpose: 'Implement new feature'
})
console.log(reg)`,
          output: `{
  "agent": "agent-001",
  "registered": true,
  "warnings": ["1 dead agent in myapp:* — run: pd salvage"]
}`
        },
      ]}
      seeAlso={[
        { name: 'spawn()', href: '/docs/sdk/spawn' },
        { name: 'salvage()', href: '/docs/sdk/salvage' },
      ]}
    />
  )
}
