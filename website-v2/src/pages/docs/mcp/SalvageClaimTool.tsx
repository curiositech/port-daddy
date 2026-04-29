import { CommandPage } from '@/components/docs/CommandPage'

export default function SalvageClaimTool() {
  return (
    <CommandPage
      command="salvage_claim"
      description="Claim a dead agent's work. Returns the full context: session ID, notes, file claims, and purpose."
      version="3.11.0"
      syntax="salvage_claim(agent_id)"
      flags={[
        { flag: 'agent_id', description: 'ID of the dead agent to claim' },
      ]}
      usagePatterns={[
        'salvage_claim({ agent_id: "agent-001" })',
      ]}
      examples={[
        {
          description: 'Claim dead agent work',
          code: 'salvage_claim({ agent_id: "agent-001" })',
          output: `{\n  "agent_id": "agent-001",\n  "session": "abc123",\n  "notes": 3,\n  "files": ["src/auth/login.ts"],\n  "purpose": "Fix auth bug",\n  "claimed": true\n}`
        },
      ]}
      seeAlso={[
        { name: 'salvage', href: '/docs/mcp/salvage' },
        { name: 'begin_session', href: '/docs/mcp/begin-session' },
        { name: 'SDK: salvageClaim()', href: '/docs/sdk/salvage-claim' },
      ]}
    />
  )
}
