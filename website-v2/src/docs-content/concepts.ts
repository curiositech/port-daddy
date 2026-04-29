import { PRODUCT_FEATURES } from '@/data/product'
import type { DocsContentSection } from './types'

const productPrimitiveItems = PRODUCT_FEATURES.map(
  (feature) => `${feature.title}: ${feature.description}`,
)

export const conceptsSection: DocsContentSection = {
  slug: 'concepts',
  title: 'Concepts',
  summary:
    'Learn the operating model behind agent identity, coordination, shared state, and harbor-based access.',
  pages: [
    {
      slug: 'daemon-and-authority',
      title: 'Daemon and Authority',
      summary:
        'Why Port Daddy is a control plane, what the daemon owns, and why authority has to be separated from execution.',
      truth: 'source-backed',
      goals: [
        'Understand why the daemon exists.',
        'Understand what belongs in the authority layer.',
        'Understand why execution and coordination are split.',
      ],
      blocks: [
        {
          type: 'paragraph',
          title: 'Why the daemon exists',
          paragraphs: [
            'Once more than one actor is touching the same repo or machine, execution alone is not enough. Someone has to own identity, coordination, shared state, and the operator-visible truth about what is happening. In Port Daddy, that owner is the daemon.',
            'This is the core concept behind the product. Agents run tasks. The daemon keeps the shared story coherent. That split is what lets notes, locks, sessions, harbors, and recovery flow through one authority instead of dissolving into local process guesswork.',
          ],
        },
        {
          type: 'checklist',
          items: [
            'Agents execute tasks.',
            'The daemon owns identity, coordination, and shared state.',
            'Operator surfaces are only useful when they report daemon truth.',
          ],
        },
        {
          type: 'paragraph',
          title: 'Why authority must be separate from execution',
          paragraphs: [
            'If execution processes are allowed to self-author the shared state, every crash, respawn, port collision, and handoff turns into a trust problem. A control plane solves that by placing shared coordination behind a runtime that is not the task process itself.',
            'That is why the daemon matters even in local-first use. It gives the machine one place where operator truth can accumulate and survive.',
          ],
        },
      ],
      sources: [
        {
          path: 'AGENTS.md',
          rationale: 'The repo rules repeatedly treat the daemon as the authority surface for runtime truth.',
        },
        {
          path: 'website-v2/src/data/publicSite.ts',
          rationale: 'The public shell already frames the daemon as the authority layer above agent execution.',
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
            'A session is the basic unit of attributable work in Port Daddy. It ties identity, purpose, notes, and lifecycle together so another operator or agent can understand what happened without reverse-engineering a terminal transcript.',
            'That makes sessions much more than a convenience wrapper. They are the continuity layer that keeps work visible before, during, and after execution.',
          ],
        },
        {
          type: 'paragraph',
          title: 'Locks and tuples solve different problems',
          paragraphs: [
            'Locks are for contested files and critical sections. They are the blunt but necessary answer when two actors could collide on the same resource. Tuples solve a different problem: they publish machine-readable coordination state that other agents, hooks, or surfaces can react to programmatically.',
            'In other words, locks serialize. Tuples communicate. Both matter if the daemon is going to feel like a real control plane instead of an event log with branding.',
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
        'How harbor admission, signed cards, and scoped entry fit into the control-plane model.',
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
            'A harbor is the scoped entry point into a protected area of work. It gives the daemon a way to admit an actor, issue identity material, and keep that admission tied to the control-plane model instead of treating every local process as equally trusted.',
            'Harbors matter because they connect the product story to the protocol story. They are where signed cards, scoped access, and operator-visible entry meet.',
          ],
        },
        {
          type: 'paragraph',
          title: 'Why scoped identity matters',
          paragraphs: [
            'Ambient local trust breaks down quickly once multiple agents, hooks, and background processes start touching the same machine. Harbor admission makes trust explicit and scoped instead of accidental.',
            'That is the practical reason the whitepaper matters. The cryptographic work is not an academic appendix. It is what allows the daemon to issue, verify, and reason about scoped identity in a way that survives more than one process.',
          ],
        },
        {
          type: 'callout',
          tone: 'info',
          title: 'Harbors connect the runtime story to the paper story',
          body:
            'If you want to understand why the protocol exists at all, start with harbors. They are where the product’s runtime authority and the whitepaper’s identity argument meet.',
        },
      ],
      sources: [
        {
          path: 'lib/harbor-tokens.ts',
          rationale: 'Harbor-token implementation establishes the current active issuance and verification behavior.',
        },
        {
          path: 'docs/reports/PORT_DADDY_ANCHOR_WHITEPAPER.md',
          rationale: 'The whitepaper explains the harbor protocol boundary and current phase truth.',
        },
      ],
    },
    {
      slug: 'eleven-product-primitives',
      title: 'Eleven Product Primitives',
      summary:
        'How the home-page primitives map to the Mac app, daemon authority, and the real operator loop.',
      truth: 'source-backed',
      goals: [
        'Name the eleven public product primitives.',
        'Understand which primitives are Mac app surfaces.',
        'Understand which primitives are daemon coordination surfaces.',
      ],
      blocks: [
        {
          type: 'paragraph',
          title: 'The primitive list is the product map',
          paragraphs: [
            'The eleven primitives on the public site are not decorative feature cards. They are the quickest map from a visitor question to a real surface: FleetBar, Fleet Control Center, Shipwright, sorties, resources, backend readiness, agent radio, enforced coordination, Coordination Guard, harbors, and salvage.',
            'That is also the shortest answer to what Port Daddy is: a local communication substrate and Mac control plane that makes shared agent work visible, attributable, recoverable, and governable.',
          ],
        },
        {
          type: 'checklist',
          items: productPrimitiveItems,
        },
        {
          type: 'paragraph',
          title: 'Mac app surfaces and daemon primitives are one system',
          paragraphs: [
            'FleetBar and Fleet Control Center are the Mac-facing surfaces. The daemon-backed primitives underneath are what make those surfaces more than a launcher: sessions, notes, channels, inboxes, claims, tuples, guard checks, harbors, backend readiness, budgets, and salvage state.',
            'Shipwright connects those layers during cold start. It surveys a repo, proposes a starter fleet, simulates risk and budget, then hands the operator back to Flow, Agents, YAML, and Resources inside the same control plane.',
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
