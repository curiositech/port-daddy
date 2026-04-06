import { CommandPage } from '@/components/docs/CommandPage'

export default function SpawnCommand() {
  return (
    <CommandPage
      command="pd spawn"
      description="Launch a one-shot agent directly through the daemon. This is the low-level spawn surface: explicit backend, explicit budget ceiling, explicit identity, and no silent premium-default inheritance."
      version="3.8.3"
      syntax="pd spawn [flags] -- <task>"
      flags={[
        { flag: '--backend <type>', description: 'Backend to use: ollama | claude | claude-cli | gemini | aider | custom.' },
        { flag: '--model <name>', description: 'Optional model override.' },
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
        'pd spawn --backend claude-cli --identity myapp:docs:sync --budget 0.75 -- "Rewrite the API docs"',
        'pd spawn --backend aider --identity myapp:web:refactor --budget 1.25 --files src/App.tsx -- "Refactor the dashboard shell"',
        'pd spawn --backend gemini --model gemini-2.5-flash --identity myapp:qa:review --budget 0.50 -- "Review the last commit for regressions"',
      ]}
      examples={[
        {
          description: 'Launch a Claude CLI run with explicit identity and budget',
          code: `pd spawn --backend claude-cli \\
  --identity port-daddy:docs:spawn-sync \\
  --budget 0.75 \\
  -- "Rewrite the website spawn docs so they match the daemon contract"`,
          output: `[pd] Spawning claude-cli agent...
[pd] Agent spawned-8a2f0c1c2f9b: completed
  Backend: claude-cli
  Model: sonnet

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
          code: `pd spawn --backend claude-cli --budget 0.50 -- "Summarize the last failing test"`,
          output: `[pd] Auto-detected identity: port-daddy
[pd] Spawning claude-cli agent...`
        },
      ]}
      seeAlso={[
        { name: 'pd spawned', href: '/docs/cli/spawned' },
        { name: 'SDK: spawn()', href: '/docs/sdk/spawn' },
        { name: 'MCP: spawn_agent', href: '/docs/mcp/spawn' },
        { name: 'Fleet agents', href: '/docs/features/fleet' },
      ]}
    />
  )
}
