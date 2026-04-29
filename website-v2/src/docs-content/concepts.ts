import { PRODUCT_FEATURES } from '@/data/product'
import type { DocsContentSection } from './types'

const productPrimitiveItems = PRODUCT_FEATURES.map(
  (feature) => `${feature.title}: ${feature.description}`,
)

export const conceptsSection: DocsContentSection = {
  slug: 'concepts',
  title: 'Concepts',
  summary:
    'Learn the ideas behind sessions, notes, locks, file claims, harbors, fleets, and recovery.',
  pages: [
    {
      slug: 'daemon-and-authority',
      title: 'Why There Is A Daemon',
      summary:
        'Why Port Daddy runs a local service and what that service keeps track of.',
      truth: 'source-backed',
      goals: [
        'Understand why Port Daddy needs one local service.',
        'Understand which state the daemon tracks.',
        'Understand why agents should share state instead of each keeping private memory.',
      ],
      blocks: [
        {
          type: 'paragraph',
          title: 'Why the daemon exists',
          paragraphs: [
            'Once more than one agent is touching the same repo or machine, private terminal memory is not enough. Port Daddy needs one local service that can remember sessions, notes, locks, ports, files, and recovery state.',
            'Agents still do the coding work. The daemon keeps the shared state those agents need so their work does not dissolve into scattered logs and half-remembered handoffs.',
          ],
        },
        {
          type: 'checklist',
          items: [
            'Agents execute tasks.',
            'The daemon stores sessions, notes, locks, ports, claims, harbors, and recovery state.',
            'The CLI, dashboard, and MCP tools all read that same state.',
          ],
        },
        {
          type: 'paragraph',
          title: 'Why shared state is separate from execution',
          paragraphs: [
            'If every agent keeps its own private record, every crash, respawn, port collision, and handoff becomes harder to recover from.',
            'The daemon gives the machine one durable place where coordination state can survive after an individual tool exits.',
          ],
        },
      ],
      sources: [
        {
          path: 'AGENTS.md',
          rationale: 'The repo rules define the daemon-backed coordination flow.',
        },
        {
          path: 'website-v2/src/data/publicSite.ts',
          rationale: 'The public shell describes the daemon, CLI, and dashboard as the local product.',
        },
      ],
    },
    {
      slug: 'sessions-locks-and-tuples',
      title: 'Sessions, Locks, and Tuples',
      summary:
        'The coordination primitives that make work attributable, contested sections explicit, and machine-readable signals possible.',
      truth: 'source-backed',
      goals: [
        'Understand the role of sessions and notes.',
        'Understand when to use locks.',
        'Understand why tuples matter beyond prose.',
      ],
      blocks: [
        {
          type: 'paragraph',
          title: 'Sessions make work attributable',
          paragraphs: [
            'A session is the basic unit of attributable work in Port Daddy. It ties identity, purpose, notes, and lifecycle together so another person or agent can understand what happened without reverse-engineering a terminal transcript.',
            'That makes sessions more than a convenience wrapper. They are the trail that keeps work visible before, during, and after execution.',
          ],
        },
        {
          type: 'paragraph',
          title: 'Locks and tuples solve different problems',
          paragraphs: [
            'Locks are for contested files and critical sections. They are the blunt but necessary answer when two actors could collide on the same resource. Tuples solve a different problem: they publish machine-readable coordination state that other agents, hooks, or tools can react to programmatically.',
            'In other words, locks stop collisions. Tuples share structured facts. Both help agents coordinate without relying on one giant chat transcript.',
          ],
        },
        {
          type: 'checklist',
          items: [
            'Use sessions and notes to leave attributable context behind.',
            'Use locks when overlapping work or critical sections can collide.',
            'Use tuples when another agent or watcher needs structured state instead of prose.',
          ],
        },
      ],
      sources: [
        {
          path: 'AGENTS.md',
          rationale: 'The repo’s Port Daddy-first rules define sessions, notes, locks, and tuples as the coordination contract.',
        },
        {
          path: 'website-v2/src/data/docs.ts',
          rationale: 'CLI command documentation exposes the commands that back these primitives.',
        },
      ],
    },
    {
      slug: 'harbors-and-identity',
      title: 'Harbors and Identity',
      summary:
        'How protected work areas and signed entry cards fit into Port Daddy.',
      truth: 'source-backed',
      goals: [
        'Understand what a harbor is.',
        'Understand why identity is scoped instead of ambient.',
        'Understand how harbor flows relate to the whitepaper.',
      ],
      blocks: [
        {
          type: 'paragraph',
          title: 'What a harbor is',
          paragraphs: [
            'A harbor is a protected area of work. It gives Port Daddy a way to admit an agent, issue a signed card, and keep that access scoped instead of treating every local process as equally trusted.',
            'Most users can start with sessions, notes, and locks. Harbors matter when work needs clearer boundaries around who can enter and what they can do.',
          ],
        },
        {
          type: 'paragraph',
          title: 'Why scoped identity matters',
          paragraphs: [
            'Ambient local trust breaks down quickly once multiple agents, hooks, and background processes start touching the same machine. Harbor admission makes trust explicit and scoped instead of accidental.',
            'That is the practical reason the whitepaper matters. The cryptographic work supports signed entry cards that can survive more than one process and still be checked later.',
          ],
        },
        {
          type: 'callout',
          tone: 'info',
          title: 'Harbors are where the deeper security story starts',
          body:
            'If you want to understand the whitepaper, start with harbors. They are the product feature that turns signed identity into something a local agent workflow can use.',
        },
      ],
      sources: [
        {
          path: 'lib/harbor-tokens.ts',
          rationale: 'Harbor-token implementation establishes the current active issuance and verification behavior.',
        },
        {
          path: 'docs/reports/PORT_DADDY_ANCHOR_WHITEPAPER.md',
          rationale: 'The whitepaper explains the signed harbor-card model.',
        },
      ],
    },
    {
      slug: 'eleven-product-primitives',
      title: 'Eleven Product Primitives',
      summary:
        'How the home-page feature cards map to the Mac app, CLI, and dashboard.',
      truth: 'source-backed',
      goals: [
        'Name the eleven public product primitives.',
        'Understand which primitives appear in the Mac app.',
        'Understand which primitives are CLI or daemon-backed features.',
      ],
      blocks: [
        {
          type: 'paragraph',
          title: 'The primitive list is the product map',
          paragraphs: [
            'The eleven primitives on the public site are not decorative feature cards. They are the quickest map from a visitor question to a real feature: FleetBar, Fleet Control Center, Shipwright, sorties, resources, backend readiness, agent communication, file claims, Coordination Guard, harbors, and salvage.',
            'Together, they answer the basic product question: Port Daddy is a local app and service that makes shared agent work visible, attributable, and recoverable.',
          ],
        },
        {
          type: 'checklist',
          items: productPrimitiveItems,
        },
        {
          type: 'paragraph',
          title: 'The Mac app and daemon work together',
          paragraphs: [
            'FleetBar and Fleet Control Center are the Mac-facing parts. The daemon-backed features underneath are sessions, notes, channels, inboxes, claims, tuples, guard checks, harbors, backend readiness, budgets, and salvage state.',
            'Shipwright connects those layers during cold start. It surveys a repo, proposes a starter fleet, simulates risk and budget, then sends you back to Flow, Agents, YAML, and Resources.',
          ],
        },
      ],
      sources: [
        {
          path: 'website-v2/src/data/product.ts',
          rationale: 'Public product data defines the eleven primitives used by the home page and Mac preview.',
        },
        {
          path: 'website-v2/src/components/landing/MacAppShowcase.tsx',
          rationale: 'Mac app showcase maps those primitives to FleetBar and Fleet Control Center screenshots.',
        },
      ],
    },
  ],
}
