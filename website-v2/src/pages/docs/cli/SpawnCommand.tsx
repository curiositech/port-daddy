import { CommandPage } from '@/components/docs/CommandPage'

export default function SpawnCommand() {
  return (
    <CommandPage
      command="pd spawn"
      description="Launch a one-shot agent directly through the daemon. This is the low-level spawn surface: explicit backend, explicit budget ceiling, explicit identity, and no silent premium-default inheritance."
      version="3.13.0"
      syntax="pd spawn [flags] -- <task>"
      flags={[
        { flag: '--backend <type>', description: 'Backend to use: ollama | claude | claude-cli | gemini | codex | aider | custom.' },
        { flag: '--model <name>', description: 'Optional model override.' },
        { flag: '--tier <level>', description: 'Optional model tier hint: low | mid | high.' },
        { flag: '--identity <id>', description: 'Semantic identity in project:stack:context form. If omitted, pd tries to derive it from package.json.' },
        { flag: '--budget <usd>', description: 'Required spend ceiling for this launch. Must be positive.' },
        { flag: '--purpose <text>', description: 'Short human-readable label for the run.' },
        { flag: '--files <path>', description: 'File list for aider-backed runs. Repeat as needed.' },
        { flag: '--workdir <dir>', description: 'Working directory override.' },
        { flag: '--timeout <ms>', description: 'Execution timeout in milliseconds.' },
        { flag: '--allowedTools <str>', description: 'Tool permission string for claude-cli.' },
        { flag: '--maxTokens <n>', description: 'Optional token ceiling for claude or claude-cli launches.' },
        { flag: '-j, --json', description: 'Emit JSON instead of terminal UI.' },
        { flag: '-q, --quiet', description: 'Minimal output.' },
      ]}
      usagePatterns={[
        'pd spawn --backend codex --tier low --identity myapp:docs:sync --budget 0.75 -- "Rewrite the API docs"',
        'pd spawn --backend aider --identity myapp:web:refactor --budget 1.25 --files src/App.tsx -- "Refactor the dashboard shell"',
        'pd spawn --backend gemini --model gemini-3.7-flash --identity myapp:qa:review --budget 0.50 -- "Review the last commit for regressions"',
      ]}
      examples={[
        {
          description: 'Launch a Codex run with explicit identity, tier, and budget',
          code: `pd spawn --backend codex \\
  --tier low \\
  --identity port-daddy:docs:spawn-sync \\
  --budget 0.75 \\
  -- "Rewrite the website spawn docs so they match the daemon contract"`,
          output: `[pd] Spawning codex agent...
[pd] Agent spawned-8a2f0c1c2f9b: completed
  Backend: codex
  Model: gpt-5.4-mini

--- Output ---
Updated website spawn docs to require identity + budget and reflect current backends.`
        },
        {
          description: 'Use aider on specific files',
          code: `pd spawn --backend aider \\
  --identity port-daddy:ui:fleetbar \\
  --budget 1.25 \\
  --files apps/FleetBar/FleetBar/CostStore.swift \\
  --files apps/FleetBar/FleetBar/CostDashboard.swift \\
  -- "Use real fleet ceilings instead of a fake visual budget reference"`,
        },
        {
          description: 'Auto-detect identity from package.json',
          code: `pd spawn --backend codex --tier low --budget 0.50 -- "Summarize the last failing test"`,
          output: `[pd] Auto-detected identity: port-daddy
[pd] Spawning codex agent...`
        },
      ]}
      seeAlso={[
        { name: 'pd spawned', href: '/docs/cli/spawned' },
        { name: 'SDK: spawn()', href: '/docs/sdk/spawn' },
        { name: 'MCP: spawn', href: '/docs/mcp/spawn' },
        { name: 'Fleet agents', href: '/docs/features/fleet' },
      ]}
    />
  )
}
