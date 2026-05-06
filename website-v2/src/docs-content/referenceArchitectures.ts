import type { DocsContentSection } from './types'

const singleMachineControlPlane = String.raw`flowchart LR
  subgraph Operator["Operator surfaces"]
    CLI["pd CLI"]
    FleetBar["FleetBar"]
    Control["Fleet Control Center"]
    MCP["MCP / SDK clients"]
  end

  subgraph Workers["Agent runtimes"]
    Codex["Codex"]
    Claude["Claude"]
    Gemini["Gemini"]
    Custom["custom backend"]
  end

  Daemon["local Port Daddy daemon"]

  subgraph State["Daemon-owned coordination state"]
    Sessions["sessions + notes"]
    Claims["file / region claims"]
    Locks["locks"]
    Harbors["harbors + cards"]
    Tuples["tuples + channels"]
    Salvage["salvage ledger"]
  end

  Operator -->|commands, views, approvals| Daemon
  Workers -->|begin, claim, note, spawn, done| Daemon
  Daemon --> State
  State -->|single live story| Operator
  State -->|coordination context| Workers`

export const referenceArchitecturesSection: DocsContentSection = {
  slug: 'reference-architectures',
  title: 'Reference Architectures',
  summary:
    'Concrete layouts for the daemon boundary, fleet automation, relay-backed harbors, and delegation workflows.',
  pages: [
    {
      slug: 'single-machine-control-plane',
      title: 'Single-Machine Port Daddy',
      summary:
        'The local baseline: one daemon owns coordination truth while many tools and agent runtimes come and go.',
      truth: 'source-backed',
      goals: [
        'Separate execution workers from the coordination control plane.',
        'Know which state belongs in the daemon instead of in terminal lore.',
        'Use the same model for CLI, FleetBar, dashboard, SDK, and MCP clients.',
      ],
      blocks: [
        {
          type: 'paragraph',
          title: 'The daemon is the local source of truth',
          paragraphs: [
            'The single-machine architecture is intentionally boring in the best way: the agent runtime does the work, but the daemon owns the coordination facts. A Codex process, a Claude session, a FleetBar webview, and an MCP client should all read and write the same sessions, notes, claims, locks, harbors, tuples, and salvage records.',
            'That split matters because agent processes are disposable. They crash, restart, fork into worktrees, lose stdout, or get replaced by a different backend. The daemon is the place where the operator can still ask what happened, who owns which files, what locks are live, which channels fired, and what work needs salvage.',
            'Treat the daemon as a local control plane, not just a helper server. The control plane should be narrow enough to run on a laptop, strict enough to coordinate concurrent agents, and visible enough that FleetBar and the web dashboard do not become decorative wrappers around stale assumptions.',
          ],
        },
        {
          type: 'mermaid',
          title: 'Local control-plane boundary',
          chart: singleMachineControlPlane,
          caption:
            'The important boundary is not "CLI versus UI". It is execution workers versus daemon-owned coordination state. Every surface should tell the same story because every surface resolves through the same daemon.',
        },
        {
          type: 'checklist',
          items: [
            'Keep one canonical daemon for the checkout unless an extra daemon is explicitly opted in with a separate socket, port, and prefix.',
            'Put shared coordination state in daemon primitives: sessions for lifecycle, claims for edit intent, locks for scarce resources, tuples/channels for machine-readable facts, harbors for scope, and salvage for interrupted work.',
            'Make every human-facing surface resolve through the same daemon truth before it claims that work is active, blocked, complete, or safe to publish.',
            'When CLI, browser, FleetBar, and source code disagree, verify daemon provenance before rewriting docs or trusting an old build.',
          ],
        },
        {
          type: 'command',
          title: 'Operator inspection path',
          command:
            'pd status\npd sessions --all-worktrees\npd notes --limit 20\npd guard check --staged',
          output:
            'Port Daddy is running\nActive sessions and notes describe current work across worktrees\nCoordination Guard checks staged paths against active session claims',
          notes: [
            'This is the small local loop before commit, push, deploy, or any contested edit.',
            'Use the app surfaces for richer browsing, but keep the CLI path boring and dependable.',
          ],
        },
        {
          type: 'paragraph',
          title: 'Design recommendation',
          paragraphs: [
            'Keep the first product promise local. A new user should be able to run one daemon, start one or many agents, and see the exact same coordination facts from CLI, FleetBar, dashboard, SDK, and MCP. Do not ask the user to understand relay, remote harbors, or fleet topology before the local loop is trustworthy.',
            'Use this architecture for solo development, local multi-agent work, CI-adjacent scripts running on the same machine, and any repo where the main risk is agents losing each other inside one worktree. Remote collaboration should extend this model through harbors and relay, not replace it with a second coordination system.',
          ],
        },
      ],
      sources: [
        {
          path: 'AGENTS.md',
          rationale: 'Defines the repo operating contract: Port Daddy first, one canonical daemon, live notes, claims, guard checks, and daemon provenance before publish.',
        },
        {
          path: 'server.ts',
          rationale: 'Wires the daemon-owned runtime primitives together: harbors, tokens, spawner, tuples, fleet daemon, sorties, and route registration.',
        },
        {
          path: 'routes/index.ts',
          rationale: 'Shows the route boundary where CLI, UI, SDK, and MCP clients converge on one local daemon API.',
        },
        {
          path: 'lib/harbors.ts',
          rationale: 'Implements named coordination namespaces and admission state for agents inside a harbor.',
        },
        {
          path: 'lib/tuples.ts',
          rationale: 'Implements the harbor-scoped shared tuple space used for machine-readable coordination facts.',
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
