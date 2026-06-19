import { CommandPage } from '@/components/docs/CommandPage'

export default function SpawnTool() {
  return (
    <CommandPage
      command="spawn_agent"
      description="Launch a one-shot Port Daddy-managed agent from MCP. The tool requires an explicit semantic identity and a positive budget ceiling, then routes the request through daemon preflight before execution."
      version="3.13.0"
      syntax="spawn_agent({ task, identity, budget_usd, ...optionalFields })"
      flags={[
        { flag: 'task', description: 'Required task or prompt text.' },
        { flag: 'identity', description: 'Required semantic identity in project:stack:context form.' },
        { flag: 'budget_usd', description: 'Required positive spend ceiling for the launch.' },
        { flag: 'backend', description: 'Optional backend override: ollama | claude | claude-cli | gemini | codex | aider | custom.' },
        { flag: 'model', description: 'Optional explicit model override.' },
        { flag: 'model_tier', description: 'Optional tier hint: low | mid | high.' },
        { flag: 'purpose', description: 'Optional short label for the run.' },
        { flag: 'files', description: 'Optional file list, primarily for aider-backed runs.' },
        { flag: 'workdir', description: 'Optional working directory override.' },
        { flag: 'timeout', description: 'Optional timeout in milliseconds.' },
        { flag: 'allowed_tools', description: 'Tool permission string for claude-cli.' },
        { flag: 'max_tokens', description: 'Optional token ceiling for claude or claude-cli launches.' },
      ]}
      usagePatterns={[
        'spawn_agent({ task: "Review the last commit", identity: "myapp:qa:review", budget_usd: 0.5 })',
        'spawn_agent({ backend: "codex", model_tier: "low", identity: "myapp:docs:sync", budget_usd: 0.75, task: "Rewrite the docs" })',
      ]}
      examples={[
        {
          description: 'Launch a budgeted Codex task',
          code: `spawn_agent({
  backend: "codex",
  model_tier: "low",
  identity: "port-daddy:docs:spawn-sync",
  budget_usd: 0.75,
  purpose: "Website spawn doc sync",
  task: "Rewrite the website spawn docs so they match the daemon contract"
})`,
          output: `{
  "success": true,
  "agentId": "spawned-8a2f0c1c2f9b",
  "backend": "codex",
  "model": "gpt-5.4-mini",
  "status": "completed",
  "output": "Updated website spawn docs to require identity + budget and reflect current backends.",
  "error": null
}`
        },
        {
          description: 'Ask aider to work against a focused file set',
          code: `spawn_agent({
  backend: "aider",
  identity: "port-daddy:ui:fleetbar",
  budget_usd: 1.25,
  files: [
    "apps/FleetBar/FleetBar/CostStore.swift",
    "apps/FleetBar/FleetBar/CostDashboard.swift"
  ],
  task: "Use real fleet ceilings instead of a fake visual budget reference"
})`,
        },
      ]}
      seeAlso={[
        { name: 'list_spawned', href: '/docs/mcp/list-spawned' },
        { name: 'SDK: spawn()', href: '/docs/sdk/spawn' },
        { name: 'CLI: pd spawn', href: '/docs/cli/spawn' },
        { name: 'Fleet agents', href: '/docs/features/fleet' },
      ]}
    />
  )
}
