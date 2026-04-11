import { CommandPage } from '@/components/docs/CommandPage'

export default function FleetCommand() {
  return (
    <CommandPage
      command="pd fleet"
      description="Manage a declarative background agent fleet defined in pd-fleet.yml. Reads agents, watchers, and channel definitions from the project root, resolves template variables, and starts all processes with Port Daddy coordination automatically wired."
      version="3.8.3"
      syntax="pd fleet <subcommand> [agent-name]"
      flags={[
        { flag: 'up', description: 'Start all agents and watchers from pd-fleet.yml' },
        { flag: 'down', description: 'Stop the running fleet (sends SIGTERM to the fleet process)' },
        { flag: 'validate', description: 'Parse pd-fleet.yml, resolve templates, and dry-run topology checks without spawning agents' },
        { flag: 'status', description: 'Show fleet health: running state, registered agents, recent channel events' },
        { flag: 'run <name>', description: 'Run a single named agent from the fleet config once' },
        { flag: '<agent-name>', description: 'Shorthand for run — pd fleet qa is the same as pd fleet run qa' },
        { flag: 'help', description: 'Show usage and list agents defined in the current pd-fleet.yml' },
      ]}
      usagePatterns={[
        'pd fleet up',
        'pd fleet validate',
        'pd fleet status',
        'pd fleet run qa',
        'pd fleet down',
      ]}
      examples={[
        {
          description: 'Start the fleet',
          code: 'pd fleet up',
          output: `Starting fleet "myapp-dev" from pd-fleet.yml
  Agents: 3
  Watchers: 1
  Channels: 2

  gardener    (custom)     schedule: */10 * * * *
  qa          (ollama)     trigger: git:committed
  test-hunter (codex)      trigger: git:committed
  spark       (ollama)     schedule: */30 * * * *
  notify-qa   (watcher)    trigger: qa:findings

Fleet running. Press Ctrl+C to stop, or: pd fleet down`,
        },
        {
          description: 'Check fleet health',
          code: 'pd fleet status',
          output: `Port Daddy Fleet

Fleet "myapp-dev": running (PID 91234)

Registered fleet agents:
  [+] fleet-gardener — Fleet agent: gardener
  [+] fleet-qa — Fleet agent: qa

Recent fleet events:
  git:committed: 09:14 AM — a930413 feat: add pheromone decay on read
  qa:clean: 09:15 AM — qa completed`,
        },
        {
          description: 'Validate the fleet config without launching anything',
          code: 'pd fleet validate',
          output: `Validating /Users/you/coding/myapp/pd-fleet.yml

Fleet "myapp-dev" parsed successfully
  agents:   4
  watchers: 1
  channels: 3
  budget:   5

No topology warnings

Dry-run checklist:
  - YAML syntax parsed
  - templates resolved
  - trigger graph checked for cycles
  - no agents were spawned`,
        },
        {
          description: 'Run a specific agent once (without starting the full fleet)',
          code: 'pd fleet run documentarian',
          output: `Running documentarian (ollama)...
documentarian completed`,
        },
        {
          description: 'List available agents when no pd-fleet.yml is found',
          code: 'pd fleet help',
          output: `Port Daddy Fleet — Declarative Agent Management

Usage: pd fleet <command>

Lifecycle:
  init            Create pd-fleet.yml + git hook in current project
  up              Start all agents from pd-fleet.yml
  down            Stop all agents
  status          Show fleet health
  validate        Parse pd-fleet.yml, resolve templates, and check topology

Agents in pd-fleet.yml (4):
  gardener         custom       schedule: */10 * * * *
  qa               ollama       trigger: git:committed
  test-hunter      codex        trigger: git:committed
  spark            ollama       schedule: */30 * * * *

Run an agent once:
  pd fleet run <name>     Run a specific agent from pd-fleet.yml`,
        },
      ]}
      seeAlso={[
        { name: 'Fleet Agents feature', href: '/docs/features/fleet' },
        { name: 'pd spawn', href: '/docs/cli/spawn' },
        { name: 'pd watch', href: '/docs/cli/watch' },
        { name: 'pd pub', href: '/docs/cli/pub' },
        { name: 'pd salvage', href: '/docs/cli/salvage' },
      ]}
    />
  )
}
