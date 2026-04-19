import type { DocsContentSection } from './types'

export const referenceArchitecturesSection: DocsContentSection = {
  slug: 'reference-architectures',
  title: 'Reference Architectures',
  summary:
    'Whole-system layouts for the local control plane, always-on fleet automation, and the delegation surfaces that sit on top of the daemon.',
  pages: [
    {
      slug: 'single-machine-control-plane',
      title: 'Single-Machine Control Plane',
      summary:
        'The canonical local layout: one daemon, many agent runtimes, and one operator-visible source of truth.',
      truth: 'source-backed',
      goals: [
        'Understand the local authority split.',
        'Know what belongs to agent runtimes and what belongs to the daemon.',
        'Use one diagram-free narrative that still matches the code and operator rules.',
      ],
      blocks: [
        {
          type: 'paragraph',
          title: 'One daemon, many executions, one authority story',
          paragraphs: [
            'The canonical local architecture is intentionally simple: agents execute tasks, but the daemon owns shared state, identity, locks, sessions, harbors, and the operator-facing truth. That split is the reason the system can stay legible once several processes begin touching the same repo and machine.',
            'This architecture fails the moment you let every surface invent its own truth. That is why the repo keeps repeating the same rule: the live daemon is the authority, and current source only becomes operator truth after rebuild and relaunch.',
          ],
        },
        {
          type: 'checklist',
          items: [
            'Keep exactly one canonical daemon on the preferred local socket and port unless an extra daemon is explicitly opt-in.',
            'Treat agent runtimes as execution workers, not as the source of shared coordination state.',
            'Use the daemon and launchd checks when socket, TCP, and shell shim stories diverge.',
          ],
        },
        {
          type: 'paragraph',
          title: 'When this architecture is the right answer',
          paragraphs: [
            'Use this layout whenever the problem is local agent operations: one engineer, one machine, one or more checkouts, and enough concurrent work that you need a daemon of record instead of terminal folklore.',
            'It is the baseline the rest of the product grows from. Fleet, harbors, and tracked sorties all build on this authority split rather than replacing it.',
          ],
        },
      ],
      sources: [
        {
          path: 'AGENTS.md',
          rationale: 'Canonical runtime rules define one-daemon authority and the operator checks that preserve it.',
        },
        {
          path: 'README.md',
          rationale: 'README explains the daemon as the local authority for sessions, notes, locks, tuples, fleet, and harbors.',
        },
        {
          path: 'website-v2/src/data/docs-routes.ts',
          rationale: 'Public docs route registry already frames the daemon as the control-plane layer above agent execution.',
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
        'Understand the role of trigger channels and status surfaces.',
        'Keep background automation tied to operator visibility.',
      ],
      blocks: [
        {
          type: 'paragraph',
          title: 'From YAML to inspectable automation',
          paragraphs: [
            'A fleet architecture starts with a declared project config and ends with running automation the daemon can explain. The point is not to hide the workflow behind magic watchers. The point is to move background agents out of shell-script folklore and into a surface with status, lifecycle events, and explicit topology.',
            'That makes the fleet legible. You can tell what is armed, what wakes on a trigger, what stays singleton, and which channels connect one agent to another. The architecture only works if those relationships are visible to the operator rather than buried in handwritten scripts.',
          ],
        },
        {
          type: 'command',
          title: 'Operator inspection path',
          command:
            'pd fleet validate\npd fleet status\ncurl http://localhost:9876/fleet\ncurl http://localhost:9876/fleet/events',
          notes: [
            'Validate the topology before trusting the running state.',
            'Use the CLI for a quick project view and the daemon routes for aggregated fleet state and lifecycle events.',
          ],
        },
        {
          type: 'paragraph',
          title: 'What keeps this architecture honest',
          paragraphs: [
            'The fleet loop stays trustworthy when the YAML, the daemon, and the operator surfaces all describe the same project automation. The moment those diverge, “background agents” becomes another source of drift instead of a control-plane feature.',
            'That is why the route surface matters as much as the config. A project fleet is only serious infrastructure if the operator can inspect it, pause it, reload it, and understand what actually fired.',
          ],
        },
      ],
      sources: [
        {
          path: 'docs/adr/0019-declarative-fleet-yaml.md',
          rationale: 'ADR defines the fleet YAML model, lifecycle, and operator expectations.',
        },
        {
          path: 'routes/fleet.ts',
          rationale: 'Fleet routes expose status, lifecycle, config, and event surfaces on the daemon.',
        },
        {
          path: 'README.md',
          rationale: 'README documents both CLI and daemon-mode fleet workflows.',
        },
      ],
    },
    {
      slug: 'delegation-surfaces',
      title: 'Delegation Surfaces',
      summary:
        'A product-surface architecture for `pd spawn`, `pd agent`, `pd sortie`, `pd fleet`, and `harbor` that keeps one-shot work, missions, and background automation distinct.',
      truth: 'source-backed',
      goals: [
        'Choose the right delegation surface.',
        'Understand how harbors fit across those surfaces.',
        'Keep product language aligned with current implementation truth.',
      ],
      blocks: [
        {
          type: 'paragraph',
          title: 'Different surfaces exist because the jobs are different',
          paragraphs: [
            '`pd spawn`, `pd agent`, `pd sortie`, and `pd fleet` should not feel interchangeable because they solve different operator problems. Spawn is the primitive, agent is bounded single-run delegation, sortie is a tracked mission surface, and fleet is always-on project automation.',
            'Harbors cut across those surfaces as the shared coordination namespace. They are where scoped messaging, tuple isolation, and capability boundaries become durable instead of implied. That is the architectural through-line, even while some delegation layers are more complete than others today.',
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
          title: 'How to read the current boundary honestly',
          paragraphs: [
            'The shipped system already gives sortie ids, status, and logs, but it is not yet the full multi-agent mission engine described in the deeper recovery plan. A good architecture page keeps that distinction explicit instead of collapsing every delegation concept into one shiny word.',
            'That honesty does more than improve copy. It helps operators choose the right surface today and understand which parts of the architecture are already dependable enough to build around.',
          ],
        },
      ],
      sources: [
        {
          path: 'docs/DELEGATION-MODES.md',
          rationale: 'Delegation modes document is the canonical explanation of how spawn, agent, sortie, fleet, and harbor differ today.',
        },
        {
          path: 'docs/recovery/PD-AGENT-SORTIE-PLAN.md',
          rationale: 'Sortie plan explains the intended product layering and the specific problem each delegation surface should solve.',
        },
        {
          path: 'routes/sorties.ts',
          rationale: 'Live sortie routes confirm the current shipped mission record surface.',
        },
      ],
    },
  ],
}
