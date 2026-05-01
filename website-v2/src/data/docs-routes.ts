import { PRODUCT_FEATURES } from './product'

export type DocsTruthState = 'Live' | 'Roadmap'

export type DocsAccentTone = 'paper' | 'blue' | 'accent'

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

const productPrimitiveBullets = PRODUCT_FEATURES.map(
  (feature) => `${feature.title}: ${feature.description}`,
)

export const docsOverviewRoute: DocsFamilyRoute = {
  slug: 'overview',
  title: 'Docs Overview',
  summary: 'Start here, learn what Port Daddy does, install it, then jump to runnable examples or reference.',
  tone: 'paper',
  path: '/docs',
  aliases: ['docs', 'overview'],
  intro: [
    'New to Port Daddy? These docs explain the local app, the daemon behind it, and the workflows it gives AI coding agents.',
  ],
  modules: [
    {
      truth: 'Live',
      title: 'How to use these docs',
      bullets: [
        'Use Get Started to install Port Daddy and open the dashboard.',
        'Use the top-level Examples page and Tutorials when you want runnable workflows.',
        'Use Concepts, Best Practices, Architectures, and Reference when you need deeper detail.',
      ],
    },
  ],
}

export const docsFamilyRoutes: DocsFamilyRoute[] = [
  {
    slug: 'get-started',
    title: 'Get Started',
    summary: 'Install Port Daddy, check that it is running, and try your first coordinated agent task.',
    tone: 'blue',
    path: '/docs/get-started',
    aliases: ['getting-started', 'get-started'],
    intro: [
      'Bring up the local Port Daddy service, open the dashboard, and make your first agent run visible to the system.',
    ],
    modules: [
      {
        truth: 'Live',
        title: 'Install and bootstrap',
        body: ['Use the Homebrew tap to install the local service, then run `pd setup` to configure the machine.'],
        code: 'brew install curiositech/tap/port-daddy && pd setup',
      },
      {
        truth: 'Live',
        title: 'Verify the live daemon',
        bullets: [
          'Run `pd status` to confirm Port Daddy is up.',
          'Run `pd briefing` before digging through a busy repo.',
          'Use `pd salvage` if abandoned or crashed work might still matter.',
        ],
        code: 'pd status\npd briefing\npd salvage',
      },
      {
        truth: 'Live',
        title: 'Start coordinated work',
        bullets: [
          'Begin sessions with `pd begin` so Port Daddy can show who is doing the work.',
          'Leave notes before broad edits if other agents might intersect the same repo.',
          'Use the CLI, MCP tools, or dashboard to inspect the same shared state.',
        ],
      },
    ],
  },
  {
    slug: 'concepts',
    title: 'Concepts',
    summary: 'Learn the ideas behind sessions, notes, file claims, locks, ports, fleets, and recovery.',
    tone: 'paper',
    path: '/docs/concepts',
    aliases: ['concepts'],
    intro: [
      'Port Daddy exists to keep multi-agent work visible and controllable once more than one agent is touching the same repo or machine.',
    ],
    modules: [
      {
        truth: 'Live',
        title: 'Product primitives',
        bullets: productPrimitiveBullets,
      },
      {
        truth: 'Live',
        title: 'What Port Daddy owns',
        body: [
          'Agents do the coding work. Port Daddy keeps the shared notes, locks, sessions, ports, and handoffs that make that work visible.',
        ],
      },
      {
        truth: 'Roadmap',
        title: 'Where the model can extend',
        bullets: [
          'Cross-machine delegation chains',
          'Team policies for background agent work',
          'Stronger shared views for autonomous workflows',
        ],
      },
    ],
  },
  {
    slug: 'best-practices',
    title: 'Best Practices',
    summary: 'Keep agent work visible, avoid collisions, recover interrupted runs, and promote changes safely.',
    tone: 'accent',
    path: '/docs/best-practices',
    aliases: ['best-practices', 'operations'],
    intro: [
      'This section is about day-to-day habits: check what is running, leave useful notes, claim risky work, and verify what users will actually open.',
    ],
    modules: [
      {
        truth: 'Live',
        title: 'Daily work loop',
        bullets: [
          'Start with `pd status`, `pd briefing`, and `pd salvage`.',
          'Leave notes before broad edits so other agents can see your slice.',
          'Use locks and file claims when the work can collide.',
        ],
      },
      {
        truth: 'Live',
        title: 'Runtime checks',
        bullets: [
          'Do not assume the live daemon is serving the current checkout.',
          'Check the daemon, CLI, and UI separately when something looks stale.',
          'Rebuild and relaunch after runtime-serving changes before trusting the result.',
        ],
      },
      {
        truth: 'Live',
        title: 'Promotion and testing discipline',
        bullets: [
          'Use the promotion script instead of hand-rolled launchctl routines.',
          'Run the full suite before claiming broad health.',
          'After a fix, ask what user-visible failure mode is still untested.',
        ],
      },
    ],
  },
  {
    slug: 'tutorials',
    title: 'Tutorials',
    summary: 'Step-by-step walkthroughs that take you from install to useful agent workflows.',
    tone: 'accent',
    path: '/docs/tutorials',
    aliases: ['tutorials', 'guides'],
    intro: [
      'Tutorials are hands-on. They help you install Port Daddy, coordinate real work, and recover when an agent run stops.',
    ],
    modules: [
      {
        truth: 'Live',
        title: 'First-day tutorials',
        bullets: [
          'Install and verify the daemon.',
          'Start a session, leave notes, and coordinate a real repo slice.',
          'Use fleet or harbor flows after the basic local loop makes sense.',
        ],
      },
      {
        truth: 'Live',
        title: 'What tutorials should teach',
        bullets: [
          'How to keep the running app aligned with the code you changed',
          'How to recover when agents die mid-task',
          'How to avoid collisions before they turn into broken work',
        ],
      },
      {
        truth: 'Live',
        title: 'Primitive coverage',
        body: [
          'The tutorials now include a dedicated walkthrough for the primitives on the home page and Mac app page.',
        ],
        bullets: productPrimitiveBullets,
      },
      {
        truth: 'Roadmap',
        title: 'Tutorial depth to add',
        bullets: [
          'Cross-machine handoffs',
          'Remote delegation with clear activity and status',
          'More walkthroughs for deeper runtime features',
        ],
      },
    ],
  },
  {
    slug: 'reference-architectures',
    title: 'Reference Architectures',
    summary: 'Example layouts for the daemon, dashboard, fleets, harbors, and team workflows.',
    tone: 'paper',
    path: '/docs/reference-architectures',
    aliases: ['reference-architectures', 'architecture'],
    intro: [
      'These pages show how the moving pieces fit together when a team wants more than a single local install.',
    ],
    modules: [
      {
        truth: 'Live',
        title: 'Layer split',
        bullets: [
          'Agent runtimes execute tasks.',
          'The daemon tracks sessions, locks, harbors, and coordination state.',
          'The dashboard and FleetBar show the same live state.',
        ],
      },
      {
        truth: 'Live',
        title: 'Serving discipline',
        bullets: [
          'A source change does not reach users until the serving daemon is rebuilt and relaunched.',
          'The main local daemon should own the expected socket and preferred port.',
        ],
      },
      {
        truth: 'Roadmap',
        title: 'Architectural depth still ahead',
        bullets: [
          'Cross-machine orchestration',
          'Stronger process and network enforcement',
          'Team policy layers for shared agent work',
        ],
      },
    ],
  },
  {
    slug: 'reference',
    title: 'Reference',
    summary: 'CLI, API, SDK, MCP, configuration, and dashboard reference for the live daemon.',
    tone: 'paper',
    path: '/docs/reference',
    aliases: ['reference'],
    intro: [
      'Reference pages should get you to the exact command, endpoint, tool, or configuration field quickly.',
    ],
    modules: [
      {
        truth: 'Live',
        title: 'CLI',
        bullets: [
          'Ports, sessions, locks, messaging, harbors, tunnels, fleet, and setup all live in the CLI.',
          'The most useful starting commands are `pd status`, `pd briefing`, `pd salvage`, and `pd begin`.',
        ],
      },
      {
        truth: 'Live',
        title: 'SDK and MCP',
        bullets: [
          'SDK and MCP pages let editors and agents use the same Port Daddy state as the CLI.',
          'Reference pages should stay close to what the current app actually does.',
        ],
      },
      {
        truth: 'Roadmap',
        title: 'Generated reference',
        body: [
          'The long-term reference should be generated from the real daemon routes and CLI commands rather than hand-maintained one page at a time.',
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
