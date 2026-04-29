import { CommandPage } from '@/components/docs/CommandPage'

export default function AgentRegisterCommand() {
  return (
    <CommandPage
      command="agent register"
      description="Register this process as an agent. Used by spawned agents internally, but also callable directly."
      version="3.11.0"
      syntax="pd agent register"
      flags={[
        { flag: '--agent <id>', description: 'Agent ID (UUID recommended)' },
        { flag: '--identity <id>', description: 'Semantic identity' },
        { flag: '--purpose <text>', description: 'What this agent is doing' },
      ]}
      usagePatterns={[
        'pd agent register --agent agent-001 --identity myapp:coder',
      ]}
      examples={[
        {
          description: 'Register as agent',
          code: 'pd agent register --agent agent-001 --identity myapp:coder',
          output: `[pd] Agent agent-001 registered
[pd] ⚠ 1 dead agent in myapp:* — run: pd salvage`
        },
      ]}
      seeAlso={[
        { name: 'spawn', href: '/docs/cli/spawn' },
        { name: 'spawned', href: '/docs/cli/spawned' },
        { name: 'salvage', href: '/docs/cli/salvage' },
      ]}
    />
  )
}
