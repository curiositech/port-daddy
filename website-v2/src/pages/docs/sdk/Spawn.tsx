import { SdkFunctionPage } from '@/components/docs/SdkFunctionPage'

export default function Spawn() {
  return (
    <SdkFunctionPage
      function="spawn"
      description="Run a one-shot agent through the Port Daddy daemon. Launches are budget-gated, tied to a semantic identity, and wrapped in the same coordination runtime used by fleet agents."
      module="Agents"
      version="3.13.0"
      signature={`spawn(spec: {
  backend: 'ollama' | 'cloudflare' | 'claude' | 'claude-cli' | 'gemini' | 'codex' | 'aider' | 'custom'
  identity: string
  budgetUsd: number
  task: string
  model?: string
  modelTier?: 'low' | 'mid' | 'high'
  purpose?: string
  files?: string[]
  workdir?: string
  timeout?: number
  allowedTools?: string
  maxTokens?: number
}): Promise<SpawnResult>`}
      params={[
        { name: 'spec.backend', type: 'string', required: true, description: 'Execution backend. The SDK accepts the daemon backend catalog, but launch preflight only allows setup-ready backends with exact telemetry.' },
        { name: 'spec.identity', type: 'string', required: true, description: 'Semantic identity in project:stack:context form. Spend attribution and salvage depend on this.' },
        { name: 'spec.budgetUsd', type: 'number', required: true, description: 'Required spend ceiling for the launch. Unbudgeted spawns are rejected.' },
        { name: 'spec.task', type: 'string', required: true, description: 'The actual task or prompt to execute.' },
        { name: 'spec.model', type: 'string', description: 'Optional explicit model override.' },
        { name: 'spec.modelTier', type: "'low' | 'mid' | 'high'", description: 'Optional tier hint. Port Daddy resolves the backend ladder when you want cheap/default/high-end behavior without naming a specific model.' },
        { name: 'spec.purpose', type: 'string', description: 'Short human-readable label for the run.' },
        { name: 'spec.files', type: 'string[]', description: 'Optional file list, primarily useful for aider-backed runs.' },
        { name: 'spec.workdir', type: 'string', description: 'Working directory override for the spawned process.' },
        { name: 'spec.timeout', type: 'number', description: 'Execution timeout in milliseconds.' },
        { name: 'spec.allowedTools', type: 'string', description: 'Tool permission string for claude-cli launches.' },
        { name: 'spec.maxTokens', type: 'number', description: 'Optional token ceiling for claude or claude-cli launches.' },
      ]}
      returns={{
        type: 'Promise<SpawnResult>',
        description: 'Final spawn result including backend, resolved model, status, output, error, and timestamps.'
      }}
      examples={[
        {
          description: 'Launch a budgeted Codex run',
          code: `const result = await pd.spawn({
  backend: 'codex',
  modelTier: 'low',
  identity: 'port-daddy:docs:spawn-sync',
  budgetUsd: 0.75,
  purpose: 'Website spawn doc sync',
  task: 'Rewrite the website spawn docs so they match the daemon contract'
})

console.log(result.status)
console.log(result.output)`,
          output: `completed
Updated website spawn docs to require identity + budget and reflect current backends.`
        },
        {
          description: 'Run aider against a focused file set',
          code: `await pd.spawn({
  backend: 'aider',
  identity: 'port-daddy:ui:fleetbar',
  budgetUsd: 1.25,
  purpose: 'Tighten FleetBar budget signals',
  files: ['apps/FleetBar/FleetBar/CostStore.swift', 'apps/FleetBar/FleetBar/CostDashboard.swift'],
  task: 'Use real fleet ceilings instead of a fake visual budget reference'
})`
        },
      ]}
      seeAlso={[
        { name: 'listSpawned()', href: '/docs/sdk/list-spawned' },
        { name: 'cancelSpawned()', href: '/docs/sdk/list-spawned' },
        { name: 'CLI: pd spawn', href: '/docs/cli/spawn' },
        { name: 'MCP: spawn', href: '/docs/mcp/spawn' },
      ]}
    />
  )
}
