import { SdkFunctionPage } from '@/components/docs/SdkFunctionPage'

export default function SalvageClaim() {
  return (
    <SdkFunctionPage
      function="salvageClaim"
      description="Claim a dead agent's work. Returns the full context: session ID, notes, file claims, and purpose."
      module="Agents"
      version="3.7.0"
      signature="salvageClaim(agentId: string): Promise<SalvageContext>"
      params={[
        { name: 'agentId', type: 'string', required: true, description: 'ID of the dead agent to claim' },
      ]}
      returns={{
        type: 'Promise<SalvageContext>',
        description: 'Full context of the salvaged agent'
      }}
      examples={[
        {
          description: 'Claim a dead agent work',
          code: `const ctx = await pd.agents.salvageClaim('agent-001')
console.log(ctx)`,
          output: `{
  "agentId": "agent-001",
  "session": "abc123",
  "notes": 3,
  "files": ["src/auth/login.ts"],
  "purpose": "Fix auth bug"
}`
        },
        {
          description: 'Continue the work',
          code: `const ctx = await pd.agents.salvageClaim('agent-001')
await pd.sessions.begin({
  identity: ctx.identity,
  purpose: ctx.purpose,
  continueFrom: ctx.session
})`
        },
      ]}
      seeAlso={[
        { name: 'salvage()', href: '/docs/sdk/salvage' },
        { name: 'beginSession()', href: '/docs/sdk/sessions' },
      ]}
    />
  )
}
