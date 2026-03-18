import { CommandPage } from '@/components/docs/CommandPage'

export default function SalvageClaimCommand() {
  return (
    <CommandPage
      command="salvage claim"
      description="Claim a dead agent's work. Returns the full context: session ID, notes, file claims, and purpose."
      version="3.7.0"
      syntax="pd salvage claim <agentId>"
      flags={[
        { flag: 'agentId', description: 'ID of the dead agent to claim' },
      ]}
      usagePatterns={[
        'pd salvage claim agent-001',
      ]}
      examples={[
        {
          description: 'Claim dead agent work',
          code: 'pd salvage claim agent-001',
          output: `Claimed agent-001
  Session: abc123
  Notes: 3 notes
  Files: src/auth/login.ts (claimed)
  Purpose: Fix auth bug`
        },
      ]}
      seeAlso={[
        { name: 'salvage', href: '/docs/cli/salvage' },
        { name: 'spawn', href: '/docs/cli/spawn' },
        { name: 'begin', href: '/docs/cli/begin' },
      ]}
    />
  )
}
