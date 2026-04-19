export type DocsTruthState = 'Live' | 'Roadmap'

export type DocsAccentTone = 'paper' | 'blue' | 'lime'

export interface DocsRouteModule {
  truth: DocsTruthState
  title: string
  body?: string[]
  bullets?: string[]
  code?: string
}

export type DocsFamilySlug =
  | 'overview'
  | 'get-started'
  | 'concepts'
  | 'best-practices'
  | 'examples'
  | 'tutorials'
  | 'reference-architectures'
  | 'reference'

export interface DocsFamilyRoute {
  slug: DocsFamilySlug
  title: string
  summary: string
  intro: string[]
  modules: DocsRouteModule[]
  tone: DocsAccentTone
  path: string
  aliases?: string[]
}

export const docsOverviewRoute: DocsFamilyRoute = {
  slug: 'overview',
  title: 'Docs Overview',
  summary: 'Start with the papers, install the daemon, then move into the model, operating practice, and reference.',
  tone: 'paper',
  path: '/docs',
  aliases: ['docs', 'overview'],
  intro: [
    'These docs exist for engineers deciding whether Port Daddy is trustworthy enough to install and practical enough to run.',
  ],
  modules: [
    {
      truth: 'Live',
      title: 'How to read the docs',
      bullets: [
        'Start with Whitepaper for the protocol boundary and governance argument.',
        'Use Get Started to install the daemon and verify the live runtime.',
        'Use Concepts, Best Practices, Examples, Tutorials, Architectures, and Reference as your questions get more specific.',
      ],
    },
  ],
}

export const docsFamilyRoutes: DocsFamilyRoute[] = [
  {
    slug: 'get-started',
    title: 'Get Started',
    summary: 'Install the daemon, verify the live control plane, and run the first operator loop that reflects reality.',
    tone: 'blue',
    path: '/docs/get-started',
    aliases: ['getting-started', 'get-started'],
    intro: [
      'Bring up the daemon, verify the live runtime, and complete the first real operator loop on your machine.',
    ],
    modules: [
      {
        truth: 'Live',
        title: 'Install and bootstrap',
        body: ['Use the Homebrew tap to install the operator runtime, then run `pd setup` to configure the machine.'],
        code: 'brew install curiositech/tap/port-daddy && pd setup',
      },
      {
        truth: 'Live',
        title: 'Verify the live daemon',
        bullets: [
          'Run `pd status` to confirm the control plane is up.',
          'Run `pd briefing` before digging through a busy repo.',
          'Use `pd salvage` if abandoned or crashed work might still matter.',
        ],
        code: 'pd status\npd briefing\npd salvage',
      },
      {
        truth: 'Live',
        title: 'Start coordinated work',
        bullets: [
          'Begin sessions with `pd begin` so identity, attribution, and salvage state exist before edits start.',
          'Leave notes before broad edits if other agents might intersect the same repo.',
          'Treat the daemon as the authority layer; SDK, MCP, and UI surfaces follow it.',
        ],
      },
    ],
  },
  {
    slug: 'concepts',
    title: 'Concepts',
    summary: 'Understand the model behind agent identity, coordination, shared state, and operator authority.',
    tone: 'paper',
    path: '/docs/concepts',
    aliases: ['concepts'],
    intro: [
      'Port Daddy exists to keep multi-agent work legible and controllable once more than one actor is touching the same repo or machine.',
    ],
    modules: [
      {
        truth: 'Live',
        title: 'Core primitives',
        bullets: [
          'Sessions and notes for attribution and handoff',
          'Locks for contested files or critical sections',
          'Tuples and messaging for machine-readable coordination',
          'Harbors for scoped ingress and identity-bound access',
        ],
      },
      {
        truth: 'Live',
        title: 'Authority versus execution',
        body: [
          'Agents execute tasks. The daemon owns shared state, harbor identity, and the operator-facing truth about what is happening.',
        ],
      },
      {
        truth: 'Roadmap',
        title: 'Where the model can extend',
        bullets: [
          'Cross-machine delegation chains',
          'Richer policy and economics on top of the same control plane',
          'A stronger team-wide operating surface for autonomous workflows',
        ],
      },
    ],
  },
  {
    slug: 'best-practices',
    title: 'Best Practices',
    summary: 'Operate Port Daddy honestly: verify runtime truth, coordinate explicitly, and promote with discipline.',
    tone: 'lime',
    path: '/docs/best-practices',
    aliases: ['best-practices', 'operations'],
    intro: [
      'This section is about keeping the daemon honest under active repo pressure: checking runtime truth, coordinating slices explicitly, and treating promotion and testing as operator work.',
    ],
    modules: [
      {
        truth: 'Live',
        title: 'Operator loop',
        bullets: [
          'Start with `pd status`, `pd briefing`, and `pd salvage`.',
          'Leave notes before broad edits so other agents can route around your slice.',
          'Use locks and shared coordination primitives when the work can collide.',
        ],
      },
      {
        truth: 'Live',
        title: 'Canonical runtime checks',
        bullets: [
          'Do not assume the live daemon is serving the current checkout.',
          'Verify the daemon, the socket, and the operator UI independently when something smells stale.',
          'Rebuild and relaunch after runtime-serving changes before trusting the result.',
        ],
      },
      {
        truth: 'Live',
        title: 'Promotion and testing discipline',
        bullets: [
          'Use the promotion script instead of hand-rolled launchctl routines.',
          'Run the full suite before claiming broad health.',
          'After a fix, ask what operator-visible failure mode is still untested.',
        ],
      },
    ],
  },
  {
    slug: 'examples',
    title: 'Examples',
    summary: 'Concrete repo-scale patterns for sessions, fleet hooks, salvage flows, and operator-visible coordination.',
    tone: 'blue',
    path: '/docs/examples',
    aliases: ['examples'],
    intro: [
      'Examples should show the daemon doing real work: multi-agent repo execution, fleet-triggered automation, and recoverable coordination under actual operator pressure.',
    ],
    modules: [
      {
        truth: 'Live',
        title: 'Repo coordination examples',
        bullets: [
          'Use `pd begin`, `pd note`, and file-scoped coordination before editing shared paths.',
          'Publish explicit machine-readable state when another agent or watcher needs to react.',
          'Show salvage and handoff behavior as part of the workflow, not as an afterthought.',
        ],
      },
      {
        truth: 'Live',
        title: 'Examples worth preserving',
        bullets: [
          'A docs-sync agent that compares live source to docs',
          'A QA loop that triggers on `git:committed` and leaves review notes',
          'A harbor-based remote or staged workflow that preserves attribution',
        ],
      },
      {
        truth: 'Roadmap',
        title: 'Example generation',
        body: [
          'Longer-term, examples should be generated or validated against real command and route surfaces so they drift less than hand-written prose.',
        ],
      },
    ],
  },
  {
    slug: 'tutorials',
    title: 'Tutorials',
    summary: 'Guided builds that take you from install to a working operator workflow.',
    tone: 'lime',
    path: '/docs/tutorials',
    aliases: ['tutorials', 'guides'],
    intro: [
      'Tutorials are workflow-first. They are here to move an operator from clean bootstrap to real usage without hand-waving through the hard parts.',
    ],
    modules: [
      {
        truth: 'Live',
        title: 'First-day tutorials',
        bullets: [
          'Install and verify the daemon.',
          'Start a session, leave notes, and coordinate a real repo slice.',
          'Use fleet or harbor flows only after the local operator loop is stable.',
        ],
      },
      {
        truth: 'Live',
        title: 'What tutorials should teach',
        bullets: [
          'How to keep runtime truth aligned with code truth',
          'How to recover when agents die mid-task',
          'How to route around collisions instead of discovering them after the fact',
        ],
      },
      {
        truth: 'Roadmap',
        title: 'Tutorial depth to add',
        bullets: [
          'Cross-machine handoffs',
          'Remote delegation with real operator visibility',
          'More generated walkthroughs for deeper runtime surfaces',
        ],
      },
    ],
  },
  {
    slug: 'reference-architectures',
    title: 'Reference Architectures',
    summary: 'Canonical system layouts for the daemon, harbors, fleet surfaces, and the trust boundary.',
    tone: 'paper',
    path: '/docs/reference-architectures',
    aliases: ['reference-architectures', 'architecture'],
    intro: [
      'These pages show how the daemon, operator surfaces, and cryptographic core fit together so teams can reason about authority instead of copying commands blindly.',
    ],
    modules: [
      {
        truth: 'Live',
        title: 'Layer split',
        bullets: [
          'Agent runtimes execute tasks.',
          'The daemon owns identity, sessions, locks, harbors, and coordination state.',
          'Operator surfaces are only useful when they report daemon truth.',
        ],
      },
      {
        truth: 'Live',
        title: 'Runtime-serving discipline',
        bullets: [
          'Source truth is not operator truth until the serving daemon has been rebuilt and relaunched.',
          'The canonical daemon should own the canonical socket and preferred port.',
        ],
      },
      {
        truth: 'Roadmap',
        title: 'Architectural depth still ahead',
        bullets: [
          'Cross-machine orchestration',
          'Stronger process and network enforcement',
          'Economic and policy layers built on the same control-plane boundary',
        ],
      },
    ],
  },
  {
    slug: 'reference',
    title: 'Reference',
    summary: 'CLI, API, config, and operator surface reference for the parts that matter.',
    tone: 'paper',
    path: '/docs/reference',
    aliases: ['reference'],
    intro: [
      'Reference should get you to the right surface quickly: CLI, API, config, SDK, MCP, and the operator entry points that matter.',
    ],
    modules: [
      {
        truth: 'Live',
        title: 'CLI',
        bullets: [
          'Ports, sessions, locks, messaging, harbors, tunnels, fleet, and setup all live in the CLI.',
          'The high-value operator entry points are `pd status`, `pd briefing`, `pd salvage`, and `pd begin`.',
        ],
      },
      {
        truth: 'Live',
        title: 'SDK and MCP',
        bullets: [
          'The daemon is the authority. SDK and MCP surfaces exist to expose it cleanly.',
          'Reference should follow the runtime, not fork into a parallel product story.',
        ],
      },
      {
        truth: 'Roadmap',
        title: 'Generated reference',
        body: [
          'The long-term reference surface should be generated from the real daemon and CLI surfaces rather than hand-maintained one page at a time.',
        ],
      },
    ],
  },
]

export const docsFamilyOrder = docsFamilyRoutes.map((route) => route.slug)

const docsRoutesByKey = new Map<string, DocsFamilyRoute>()

for (const route of [docsOverviewRoute, ...docsFamilyRoutes]) {
  docsRoutesByKey.set(route.slug, route)
  for (const alias of route.aliases ?? []) {
    docsRoutesByKey.set(alias, route)
  }
}

export function normalizeDocsPath(path: string) {
  const withoutQuery = path.split(/[?#]/)[0] ?? ''
  const trimmed = withoutQuery.trim()

  if (!trimmed) {
    return '/docs'
  }

  const prefixed = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  const normalized = prefixed.replace(/\/+$/, '')

  return normalized || '/docs'
}

export function findDocsRouteBySlug(slug: string) {
  return docsRoutesByKey.get(slug.trim().toLowerCase())
}

export function findDocsRouteByPath(path: string) {
  const normalized = normalizeDocsPath(path)

  if (normalized === '/docs') {
    return docsOverviewRoute
  }

  for (const route of docsFamilyRoutes) {
    if (normalized === route.path || normalized.startsWith(`${route.path}/`)) {
      return route
    }
  }

  return undefined
}
