import type { DocsContentSection } from './types'

export const referenceArchitecturesSection: DocsContentSection = {
  slug: 'reference-architectures',
  title: 'Reference Architectures',
  summary:
    'Example layouts for the local daemon, dashboard, fleets, harbors, and delegation workflows.',
  pages: [
    {
      slug: 'single-machine-control-plane',
      title: 'Single-Machine Port Daddy',
      summary:
        'The basic local layout: one daemon, many agent tools, and one shared place to inspect work.',
      truth: 'source-backed',
      goals: [
        'Understand what runs locally.',
        'Know what agents do and what the daemon tracks.',
        'Use one plain narrative that still matches the code and repo rules.',
      ],
      blocks: [
        {
          type: 'paragraph',
          title: 'One daemon, many agents, one shared view',
          paragraphs: [
            'The local architecture is intentionally simple: agents execute tasks, and the daemon tracks the shared state those tasks need. That includes sessions, notes, locks, file claims, ports, harbors, and salvage state.',
            'The CLI, FleetBar, dashboard, SDK, and MCP tools should all point back to that same daemon so the user does not have to reconcile competing stories about the same work.',
          ],
        },
        {
          type: 'checklist',
          items: [
            'Keep exactly one main daemon on the preferred local socket and port unless an extra daemon is explicitly opt-in.',
            'Treat agent runtimes as execution workers, not as the place that owns shared coordination state.',
            'Use daemon and launchd checks when CLI, browser, or shell command behavior diverges.',
          ],
        },
        {
          type: 'paragraph',
          title: 'When this architecture is the right answer',
          paragraphs: [
            'Use this layout whenever the problem is local agent work: one engineer, one machine, one or more checkouts, and enough concurrent work that you need shared state instead of terminal folklore.',
            'It is the baseline the rest of the product grows from. Fleet, harbors, and tracked sorties all build on top of this local daemon instead of replacing it.',
          ],
        },
      ],
      sources: [
        {
          path: 'AGENTS.md',
          rationale: 'Runtime rules define one-daemon checks and user expectations.',
        },
        {
          path: 'README.md',
          rationale: 'README explains the daemon-backed workflow for sessions, notes, locks, tuples, fleet, and harbors.',
        },
        {
          path: 'website-v2/src/data/docs-routes.ts',
          rationale: 'Public docs route registry describes the daemon, CLI, dashboard, and agent workflows.',
        },
      ],
    },
    {
      slug: 'fleet-automation-loop',
      title: 'Fleet Automation Loop',
      summary:
        'A project-level automation architecture in which `pd-fleet.yml`, trigger channels, and the daemon combine into an inspectable always-on workflow.',
      truth: 'source-backed',
      goals: [
        'See how declarative fleet config becomes runtime behavior.',
        'Understand the role of trigger channels and status views.',
        'Keep background automation easy to inspect.',
      ],
      blocks: [
        {
          type: 'paragraph',
          title: 'From YAML to inspectable automation',
          paragraphs: [
            'A fleet architecture starts with a declared project config and ends with running automation Port Daddy can show you. The point is not to hide the workflow behind magic watchers. The point is to make background agents visible: status, lifecycle events, triggers, and topology.',
            'A good fleet view tells you what is armed, what wakes on a trigger, what stays singleton, and which channels connect one agent to another. Those relationships should be visible in the app instead of buried in handwritten scripts.',
          ],
        },
        {
          type: 'command',
          title: 'Inspection path',
          command:
            'pd fleet validate\npd fleet status\ncurl http://localhost:9876/fleet\ncurl http://localhost:9876/fleet/events',
          output: 'SUCCESS: Fleet "myapp-dev" parsed successfully\nFleet: 1 project(s), 5 agent(s), 3/5 launchable\n{"running":true,"projects":[{"name":"myapp-dev"}]}\nevent: fleet.status',
          notes: [
            'Validate the topology before trusting the running state.',
            'Use the CLI for a quick project view and daemon routes for aggregated fleet state and lifecycle events.',
          ],
        },
        {
          type: 'paragraph',
          title: 'What keeps this architecture useful',
          paragraphs: [
            'The fleet loop works when the YAML, daemon, and UI all describe the same project automation.',
            'A project fleet is useful when the user can inspect it, pause it, reload it, and understand what actually fired.',
          ],
        },
      ],
      sources: [
        {
          path: 'docs/adr/0019-declarative-fleet-yaml.md',
          rationale: 'ADR defines the fleet YAML model, lifecycle, and user expectations.',
        },
        {
          path: 'routes/fleet.ts',
          rationale: 'Fleet routes expose status, lifecycle, config, and events on the daemon.',
        },
        {
          path: 'README.md',
          rationale: 'README documents both CLI and daemon-mode fleet workflows.',
        },
      ],
    },
    {
      slug: 'delegation-surfaces',
      title: 'Delegation Workflows',
      summary:
        'How `pd spawn`, `pd agent`, `pd sortie`, `pd fleet`, and harbors differ in daily use.',
      truth: 'source-backed',
      goals: [
        'Choose the right delegation command.',
        'Understand how harbors fit across those commands.',
        'Know which parts are shipped today and which parts are still growing.',
      ],
      blocks: [
        {
          type: 'paragraph',
          title: 'Different commands exist because the jobs are different',
          paragraphs: [
            '`pd spawn`, `pd agent`, `pd sortie`, and `pd fleet` should not feel interchangeable because they solve different problems. Spawn is low-level launch control, agent is a bounded one-shot task, sortie is a tracked mission, and fleet is always-on project automation.',
            'Harbors cut across those workflows when the work needs scoped messaging, tuple isolation, or capability boundaries.',
          ],
        },
        {
          type: 'checklist',
          items: [
            'Use `pd spawn` when you need explicit low-level control over one launch.',
            'Use `pd agent` when you want the daemon to wrap a bounded one-shot task correctly.',
            'Use `pd sortie` when you need a durable mission record with status and logs.',
            'Use `pd fleet` when the work should stay armed for the project over time.',
          ],
        },
        {
          type: 'paragraph',
          title: 'What is shipped today',
          paragraphs: [
            'The shipped system already gives sortie ids, status, and logs, but it is not yet the full multi-agent mission engine described in the deeper recovery plan. A good architecture page keeps that distinction explicit instead of collapsing every delegation concept into one shiny word.',
            'That distinction helps users choose the right command today and understand which parts are already dependable enough to build around.',
          ],
        },
      ],
      sources: [
        {
          path: 'docs/DELEGATION-MODES.md',
          rationale: 'Delegation modes document explains how spawn, agent, sortie, fleet, and harbor differ today.',
        },
        {
          path: 'docs/recovery/PD-AGENT-SORTIE-PLAN.md',
          rationale: 'Sortie plan explains the intended product layering and the specific problem each delegation workflow should solve.',
        },
        {
          path: 'routes/sorties.ts',
          rationale: 'Live sortie routes confirm the current shipped mission record behavior.',
        },
      ],
    },
  ],
}
