import { BLUEPRINTS } from './blueprints'
import { blogPostMetas as blogPosts, deprecatedBlogPosts } from './blogMetaData'
import { docsFamilyRoutes, docsOverviewRoute, type DocsFamilyRoute } from './docs-routes'
import { INTEGRATIONS } from './integrations'
import { CLI_REFERENCE_ITEMS, cliCommandHref } from './referenceCatalog'
import { TUTORIALS } from './tutorials'
import { WHITE_PAPERS } from './whitePapers'

export const SITE_NAME = 'Port Daddy'
export const SITE_ORIGIN = 'https://portdaddy.dev'
export const DEFAULT_SITE_DESCRIPTION =
  'Port Daddy is a local control plane and shared-state substrate for AI coding agents: sessions, claims, notes, channels, readiness, budgets, and recoverable handoffs on your machine.'

export function ogImagePathForRoutePath(pathname: string) {
  const slug = pathname
    .split(/[?#]/)[0]
    .replace(/^\/+|\/+$/g, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()

  return `/img/og/${slug || 'home'}.jpg`
}

export const DEFAULT_SITE_IMAGE = ogImagePathForRoutePath('/')

export const OG_SOURCE_IMAGES = {
  controlPlane: '/img/generated/control-plane-og.jpg',
  agentRuntime: '/img/generated/agent-runtime-map.jpg',
  virtualActors: '/img/generated/virtual-actor-fleet.jpg',
  coordinationGuard: '/img/generated/coordination-guard.jpg',
  fleetbarInstall: '/img/generated/fleetbar-install.jpg',
  scout: '/img/generated/scout-extension-popup.png',
  salvageLedger: '/img/generated/salvage-ledger.jpg',
  shipwrightProposal: '/img/generated/shipwright-proposal.jpg',
  exampleArchetypes: '/img/generated/example-agent-archetypes.jpg',
  home: '/img/generated/home-og.jpg',
  manifesto: '/img/generated/manifesto-og.jpg',
  pdTube: '/img/generated/pd-tube-og.jpg',
  blog: '/img/generated/blog-og.jpg',
  library: '/img/generated/library-og.jpg',
  landscape: '/img/generated/landscape-og.jpg',
} as const

export type SiteMetadataSection =
  | 'home'
  | 'product'
  | 'docs'
  | 'tutorials'
  | 'integrations'
  | 'templates'
  | 'blog'
  | 'whitepaper'
  | 'legacy'

export interface SiteMetadata {
  path: string
  canonicalPath?: string
  title: string
  description: string
  image: string
  ogSourceImage: string
  ogSectionLabel?: string
  section: SiteMetadataSection
  index?: boolean
  publishedAt?: string
  author?: string
  tags?: string[]
}

export const blogHeroImages: Record<string, string> = Object.fromEntries(
  blogPosts.map((post) => [post.slug, post.heroImage]),
)

const exampleRouteMetadata = [
  {
    slug: 'pd-tube-button-to-agent',
    title: 'Build a button-to-agent loop with PD Tube',
    description: 'Turn a plain HTML button into a local phone line to the agent session already running in your project.',
    sourceImage: '/img/generated/example-pd-tube-button-to-agent.jpg',
    tags: ['tube', 'browser', 'agent loop', 'messages'],
  },
  {
    slug: 'test-failure-to-agent',
    title: 'Turn a failing test into an agent request',
    description: 'Wrap a failing test command, publish the failure to the local agent, and print the diagnosis back in the terminal.',
    sourceImage: '/img/generated/example-test-failure-to-agent.jpg',
    tags: ['tube', 'tests', 'reporter', 'terminal'],
  },
  {
    slug: 'editor-lightbulb-to-agent',
    title: 'Send an editor selection to your local agent',
    description: 'Select code in a local page, publish the file and range to the agent, and render the explanation inline.',
    sourceImage: '/img/generated/example-editor-lightbulb-to-agent.jpg',
    tags: ['tube', 'editor', 'selection', 'dev tools'],
  },
  {
    slug: 'webhook-to-local-agent',
    title: 'Route webhooks to an agent on your machine',
    description: 'Accept Slack, Discord, Linear, or generic webhook JSON and route it to the local agent through PD Tube.',
    sourceImage: '/img/generated/example-webhook-to-local-agent.jpg',
    tags: ['tube', 'webhooks', 'bots', 'http'],
  },
  {
    slug: 'leader-election',
    title: 'Elect one leader from a local agent swarm',
    description: 'Use Port Daddy locks and inboxes so one local agent becomes the coordinator while the rest remain safe followers.',
    sourceImage: '/img/generated/example-leader-election.jpg',
    tags: ['locks', 'coordination', 'agents', 'inboxes'],
  },
  {
    slug: 'p2p-webrtc',
    title: 'Carry WebRTC signaling over agent inboxes',
    description: 'Use durable Port Daddy inbox messages for offer-answer rendezvous before peers switch to a direct local link.',
    sourceImage: '/img/generated/example-p2p-webrtc.jpg',
    tags: ['inboxes', 'webrtc', 'signaling', 'messages'],
  },
  {
    slug: 'ephemeral-ci-db',
    title: 'Claim a throwaway database port for CI',
    description: 'Give short-lived test databases clean local ports so CI helpers and agents do not collide on the same machine.',
    sourceImage: '/img/generated/example-ephemeral-ci-db.jpg',
    tags: ['ports', 'ci', 'database', 'tests'],
  },
  {
    slug: 'agent-topologies',
    title: 'Trace how your agents actually talk',
    description: 'Run star, ring, and arbiter message patterns over Port Daddy and capture an inspectable trace of who said what to whom.',
    sourceImage: '/img/generated/example-agent-archetypes.jpg',
    tags: ['agents', 'fleet', 'topology', 'templates'],
  },
] as const

const sectionLabels: Record<SiteMetadataSection, string> = {
  home: 'Local Control Plane',
  product: 'Product',
  docs: 'Docs',
  tutorials: 'Tutorial',
  integrations: 'Integration',
  templates: 'Agent Templates',
  blog: 'Field Note',
  whitepaper: 'Whitepaper',
  legacy: 'Archive',
}

function sourceImageForRoute(path: string, section: SiteMetadataSection) {
  // Bespoke route-level OG art for the top-level pages that previously shared
  // the generic control-plane fallback. Exact matches so individual sub-routes
  // (e.g. a /blog/<slug> that mentions "guard") keep their topical image below.
  if (path === '/') return OG_SOURCE_IMAGES.home
  if (path === '/manifesto') return OG_SOURCE_IMAGES.manifesto
  if (path === '/pd-tube') return OG_SOURCE_IMAGES.pdTube
  if (path === '/blog') return OG_SOURCE_IMAGES.blog
  if (path === '/library') return OG_SOURCE_IMAGES.library
  if (path === '/landscape') return OG_SOURCE_IMAGES.landscape
  if (path === '/mac-preview') return OG_SOURCE_IMAGES.fleetbarInstall
  if (path === '/scout') return OG_SOURCE_IMAGES.scout
  if (path === '/mcp' || path.startsWith('/docs/mcp')) return OG_SOURCE_IMAGES.agentRuntime
  if (path.startsWith('/agents') || path.includes('fleet') || path.includes('spawn')) return OG_SOURCE_IMAGES.virtualActors
  if (path.startsWith('/templates')) return OG_SOURCE_IMAGES.shipwrightProposal
  if (path.includes('salvage') || path.includes('time-travel') || path.includes('timeline')) return OG_SOURCE_IMAGES.salvageLedger
  if (path.includes('claim') || path.includes('lock') || path.includes('guard') || path.includes('arbiter')) {
    return OG_SOURCE_IMAGES.coordinationGuard
  }
  if (path.includes('quickstart') || path.includes('get-started') || path.includes('install')) return OG_SOURCE_IMAGES.fleetbarInstall
  if (path.startsWith('/integrations') || path.startsWith('/docs/sdk') || path.startsWith('/docs/api')) return OG_SOURCE_IMAGES.agentRuntime
  if (path === '/examples') return OG_SOURCE_IMAGES.exampleArchetypes
  if (section === 'tutorials') return tutorialSourceImage(path.split('/').at(-1) ?? '')
  if (section === 'whitepaper') return OG_SOURCE_IMAGES.controlPlane
  return OG_SOURCE_IMAGES.controlPlane
}

function tutorialSourceImage(slug: string) {
  switch (slug) {
    case 'getting-started':
    case 'primitives':
      return OG_SOURCE_IMAGES.fleetbarInstall
    case 'multi-agent':
    case 'inbox':
    case 'always-on':
    case 'pd-spawn':
    case 'fleet':
      return OG_SOURCE_IMAGES.virtualActors
    case 'debugging':
    case 'session-phases':
    case 'time-travel':
    case 'pheromone':
      return OG_SOURCE_IMAGES.salvageLedger
    case 'pipelines':
    case 'watch':
    case 'pd-tube':
      return OG_SOURCE_IMAGES.agentRuntime
    default:
      return OG_SOURCE_IMAGES.controlPlane
  }
}

function pageTitle(title: string) {
  if (title === SITE_NAME) return 'Port Daddy - Local Control Plane for AI Coding Agents'
  if (title.endsWith(SITE_NAME)) return title
  return `${title} - ${SITE_NAME}`
}

function metadata(
  path: string,
  title: string,
  description: string,
  options: Partial<Omit<SiteMetadata, 'path' | 'title' | 'description'>> = {},
): SiteMetadata {
  const section = options.section ?? 'product'

  return {
    path,
    title: pageTitle(title),
    description,
    image: options.image ?? ogImagePathForRoutePath(path),
    ogSourceImage: options.ogSourceImage ?? sourceImageForRoute(path, section),
    ogSectionLabel: options.ogSectionLabel ?? sectionLabels[section],
    section,
    ...options,
  }
}

function docsMetadata(route: DocsFamilyRoute): SiteMetadata {
  return metadata(route.path, route.title, route.summary, {
    section: 'docs',
  })
}

const productRoutes: SiteMetadata[] = [
  metadata('/', SITE_NAME, DEFAULT_SITE_DESCRIPTION, { section: 'home' }),
  metadata(
    '/examples',
    'Executable Examples',
    'Run complete Port Daddy example programs showing how browser buttons, test reporters, editor commands, and webhook adapters can hand work to local agents.',
    { ogSourceImage: OG_SOURCE_IMAGES.exampleArchetypes, ogSectionLabel: 'Examples' },
  ),
  ...exampleRouteMetadata.map((example) =>
    metadata(`/examples/${example.slug}`, example.title, example.description, {
      ogSourceImage: example.sourceImage,
      ogSectionLabel: 'Executable Example',
      tags: [...example.tags],
    }),
  ),
  metadata(
    '/mcp',
    'Skill + MCP for AI Agents',
    'Use the Port Daddy agent skill and MCP server together: an instruction manual plus callable tools for sessions, claims, scoped channels, inboxes, readiness, salvage, fleets, and handoffs.',
    { ogSourceImage: OG_SOURCE_IMAGES.agentRuntime, ogSectionLabel: 'Skill + MCP' },
  ),
  metadata(
    '/mac-preview',
    'Mac Preview',
    'See what the FleetBar Mac preview downloads, how to verify it, how to open it, and how it exposes Fleet Control Center, Shipwright, resources, spawned runs, backend readiness, and agent communication.',
    { ogSourceImage: OG_SOURCE_IMAGES.fleetbarInstall, ogSectionLabel: 'FleetBar' },
  ),
  metadata(
    '/accountability',
    'See What Your Agents Actually Did',
    'Turn every coding-agent run into a witnessed transcript, an exact cost, a daemon-proven compliance level, and a receipt — with destructive git denied at the pre-tool gate before it fires.',
    { ogSourceImage: OG_SOURCE_IMAGES.coordinationGuard, ogSectionLabel: 'Accountability' },
  ),
  metadata(
    '/scout',
    'Port Daddy Scout',
    'Capture any ordinary Chrome page as a Port Daddy visual task: screenshot, selected region, DOM clues for project apps, local issue creation, and optional spawn-backed follow-up work.',
    { ogSourceImage: OG_SOURCE_IMAGES.scout, ogSectionLabel: 'Scout' },
  ),
  metadata(
    '/pd-tube',
    'PD Tube',
    'pd tube turns any local UI, hook, test runner, or webhook into an event your running agent answers in one shell call — and as of v3.16.2 a single channel fans out to many listeners, so distinct --as identities each receive every message.',
    { ogSourceImage: OG_SOURCE_IMAGES.agentRuntime, ogSectionLabel: 'pd tube' },
  ),
  metadata(
    '/templates',
    'Agent Fleet Templates (deprecated)',
    'The top-level template library has moved under Agents. Use /agents/templates for current Port Daddy fleet templates and reusable agent patterns.',
    {
      section: 'templates',
      canonicalPath: '/agents/templates',
      image: ogImagePathForRoutePath('/agents/templates'),
      ogSourceImage: OG_SOURCE_IMAGES.shipwrightProposal,
      index: false,
    },
  ),
  metadata(
    '/agents',
    'Agent Roster',
    'Meet the Port Daddy agent roles that monitor health, salvage crashed work, document drift, coordinate projects, and inspect dependencies.',
    { ogSourceImage: OG_SOURCE_IMAGES.virtualActors, ogSectionLabel: 'Agent Roster' },
  ),
  metadata(
    '/agents/templates',
    'Agent Templates',
    'Use the current Port Daddy agent templates: starter fleet YAML, always-on agents, CI repair loops, event-driven ops, remote harbors, research swarms, and secure messaging primitives.',
    { section: 'templates', ogSourceImage: OG_SOURCE_IMAGES.shipwrightProposal },
  ),
  metadata(
    '/agents/agent-skill',
    'Agent Skill (moved)',
    'The Port Daddy agent skill now lives with the MCP server on the top-level Skill + MCP page.',
    {
      canonicalPath: '/mcp',
      image: ogImagePathForRoutePath('/mcp'),
      ogSourceImage: OG_SOURCE_IMAGES.agentRuntime,
      index: false,
    },
  ),
  metadata(
    '/tutorials',
    'Tutorials',
    'Follow hands-on Port Daddy tutorials from first install through shared state, sessions, claims, messaging, fleet YAML, launch gates, and recovery.',
    { section: 'tutorials' },
  ),
  metadata(
    '/integrations',
    'Integrations',
    'Wire Port Daddy into Claude, Codex, Cursor, Windsurf, LangChain, CrewAI, Aider, Continue.dev, and other agent-facing developer tooling.',
    { section: 'integrations' },
  ),
  metadata(
    '/blog',
    'Harbor Blog',
    'Short, honest write-ups from running a fleet of agents: what broke, what we fixed, and what the daemon has to keep true. Shared state, file ownership, launch checks, PD Tube, recovery trails, and daemon provenance.',
    { section: 'blog' },
  ),
  metadata(
    '/manifesto',
    'Manifesto',
    'Software learned to hire its own help. Why a fleet of agents needs a harbor-master before anything else, how legibility becomes the product, and the seven papers that work it out.',
    { section: 'whitepaper' },
  ),
  metadata(
    '/security',
    'Cryptography',
    'What stops an agent you never authorized from touching your code — and the proofs behind it. Capability attenuation, signed envelopes, collateralized work, and Ostrom-style commons governance, with the Anchor Protocol verified in ProVerif.',
    { section: 'whitepaper' },
  ),
  metadata(
    '/harness',
    'The Harness',
    'What an AI coding agent gains when it runs inside the Port Daddy Harness: it hears the fleet, is subscribed by default, sees the swarm before it edits, gets CI verdicts back, is invited to parley, pays rent, is steered to fresh worktrees, and has destructive commands vetoed with the safe alternative named. Claude is fully wired; Gemini and Codex hook surfaces are mapped.',
    { section: 'product' },
  ),
  metadata(
    '/squid-codex',
    'Squid Codex Bridge',
    'Run Claude Code with Codex and your ChatGPT Pro subscription through the Giant Squid local bridge, with Port Daddy hooks, agent skill, MCP tools, budgets, claims, and recovery wrapped around the run.',
    { section: 'product', ogSourceImage: OG_SOURCE_IMAGES.agentRuntime, ogSectionLabel: 'Giant Squid' },
  ),
  metadata(
    '/library',
    'The Harbor Library',
    'The seven-paper Harbor Library, read as one volume: four chapters explain local-first agent coordination, identity, and the harbor economy; three prove it with machine-checked formal verification.',
    { section: 'whitepaper' },
  ),
  metadata(
    '/whitepaper',
    'Whitepaper',
    'Read the technical whitepaper behind Port Daddy: local-first agent coordination, signed identity, capability boundaries, sessions, and recoverable work.',
    { section: 'whitepaper' },
  ),
  ...WHITE_PAPERS.map((paper) =>
    metadata(paper.readerHref, paper.title, paper.summary, {
      section: 'whitepaper',
    }),
  ),
]

const docsGuideRoutes = [
  ['/docs/quickstart', 'Quickstart', 'Install Port Daddy, check the local service, claim a port, and start the first coordinated agent task.'],
  ['/docs/guides/prompting-agents', 'Prompting Agents', 'Prompt agents to use Port Daddy sessions, notes, file claims, and shared status.'],
  ['/docs/guides/templates', 'Template Guide', 'Adapt Port Daddy fleet templates for recurring project work, background agents, hooks, and review.'],
  ['/docs/guides/protocol', 'Protocol Guide', 'Understand how Port Daddy handles ports, sessions, locks, messages, harbors, and salvage.'],
] as const

const cliRouteEntries: Array<readonly [string, string]> = [
  ['cli', 'CLI Overview'],
  ...CLI_REFERENCE_ITEMS.flatMap((item) => [
    [cliCommandHref(item).replace(/^\/docs\//, ''), item.name] as const,
    ...item.aliasRoutes.map((alias) => [alias.href.replace(/^\/docs\//, ''), alias.name] as const),
  ]),
]

const cliRoutes = Array.from(new Map<string, string>(cliRouteEntries).entries())

const docsFeatureRoutes = [
  ['features/ports', 'Port Claims'],
  ['features/radio', 'Radio Messaging'],
  ['features/harbors', 'Harbors'],
  ['features/avatars', 'Agent Avatars'],
  ['features/salvage', 'Salvage'],
  ['features/timeline', 'Timeline'],
  ['features/dns', 'DNS Resolver'],
  ['features/remote', 'Remote Coordination'],
  ['features/sessions', 'Sessions'],
  ['features/tunnels', 'Tunnels'],
  ['features/pheromone', 'Pheromone Trails'],
  ['features/fleet', 'Fleet & GitHub App'],
  ['features/tuples', 'Tuples'],
  ['features/arbiter', 'Arbiter'],
  ['features/relay-pki', 'Relay PKI'],
  ['features/doctrine', 'Evidence-led Doctrine'],
] as const

const sdkRoutes = [
  ['sdk', 'SDK Overview'],
  ['sdk/ports', 'SDK Ports'],
  ['sdk/sessions', 'SDK Sessions'],
  ['sdk/locks', 'SDK Locks'],
  ['sdk/harbors', 'SDK Harbors'],
  ['sdk/scan-services', 'SDK Scan Services'],
  ['sdk/up', 'SDK Up'],
  ['sdk/down', 'SDK Down'],
  ['sdk/status', 'SDK Status'],
  ['sdk/whoami', 'SDK Whoami'],
  ['sdk/add-note', 'SDK Add Note'],
  ['sdk/list-notes', 'SDK List Notes'],
  ['sdk/done-session', 'SDK Done Session'],
  ['sdk/release-lock', 'SDK Release Lock'],
  ['sdk/with-lock', 'SDK With Lock'],
  ['sdk/subscribe', 'SDK Subscribe'],
  ['sdk/watch', 'SDK Watch'],
  ['sdk/leave-harbor', 'SDK Leave Harbor'],
  ['sdk/list-harbors', 'SDK List Harbors'],
  ['sdk/dns-register', 'SDK DNS Register'],
  ['sdk/dns-resolve', 'SDK DNS Resolve'],
  ['sdk/spawn', 'SDK Spawn'],
  ['sdk/list-spawned', 'SDK List Spawned'],
  ['sdk/register-agent', 'SDK Register Agent'],
  ['sdk/salvage', 'SDK Salvage'],
  ['sdk/salvage-claim', 'SDK Salvage Claim'],
  ['sdk/tunnel', 'SDK Tunnel'],
  ['sdk/tunnel-stop', 'SDK Tunnel Stop'],
] as const

const mcpRoutes = [
  ['mcp', 'MCP Overview'],
  ['mcp/claude', 'Claude MCP Setup'],
  ['mcp/cursor', 'Cursor MCP Setup'],
  ['mcp/windsurf', 'Windsurf MCP Setup'],
  ['mcp/custom', 'Custom MCP Clients'],
  ['mcp/claim-port', 'MCP Claim Port Tool'],
  ['mcp/release-port', 'MCP Release Port Tool'],
  ['mcp/find-port', 'MCP Find Port Tool'],
  ['mcp/list-services', 'MCP List Services Tool'],
  ['mcp/begin-session', 'MCP Begin Session Tool'],
  ['mcp/done-session', 'MCP Done Session Tool'],
  ['mcp/publish-message', 'MCP Publish Message Tool'],
  ['mcp/acquire-lock', 'MCP Acquire Lock Tool'],
  ['mcp/create-harbor', 'MCP Create Harbor Tool'],
  ['mcp/dns-register', 'MCP DNS Register Tool'],
  ['mcp/dns-resolve', 'MCP DNS Resolve Tool'],
  ['mcp/subscribe', 'MCP Subscribe Tool'],
  ['mcp/leave-harbor', 'MCP Leave Harbor Tool'],
  ['mcp/list-harbors', 'MCP List Harbors Tool'],
  ['mcp/add-note', 'MCP Add Note Tool'],
  ['mcp/list-notes', 'MCP List Notes Tool'],
  ['mcp/spawn-agent', 'MCP Spawn Agent Tool'],
  ['mcp/list-spawned', 'MCP List Spawned Tool'],
  ['mcp/salvage', 'MCP Salvage Tool'],
  ['mcp/salvage-claim', 'MCP Salvage Claim Tool'],
  ['mcp/scan-services', 'MCP Scan Services Tool'],
  ['mcp/up', 'MCP Up Tool'],
  ['mcp/down', 'MCP Down Tool'],
  ['mcp/status', 'MCP Status Tool'],
  ['mcp/tunnel', 'MCP Tunnel Tool'],
  ['mcp/tunnel-stop', 'MCP Tunnel Stop Tool'],
  ['mcp/watch', 'MCP Watch Tool'],
] as const

const docsCommandMetadata = cliRoutes.map(([path, title]) =>
  metadata(`/docs/${path}`, title, `Reference for ${title}, including Port Daddy syntax, what the command does, and when to use it.`, {
    section: 'docs',
  }),
)

const docsFeatureMetadata = docsFeatureRoutes.map(([path, title]) =>
  metadata(`/docs/${path}`, title, `Learn the Port Daddy ${title.toLowerCase()} feature, what problem it solves, and how to use it with agent work.`, {
    section: 'docs',
  }),
)

const sdkMetadata = sdkRoutes.map(([path, title]) =>
  metadata(`/docs/${path}`, title, `Use ${title} from TypeScript code with Port Daddy sessions, locks, ports, and agent coordination features.`, {
    section: 'docs',
  }),
)

const mcpMetadata = mcpRoutes.map(([path, title]) =>
  metadata(`/docs/${path}`, title, `Use ${title} with MCP clients so agents can work through Port Daddy safely.`, {
    section: 'docs',
  }),
)

const contentMetadata: SiteMetadata[] = [
  ...TUTORIALS.map((tutorial) =>
    metadata(tutorial.href, tutorial.title, tutorial.description, {
      section: 'tutorials',
      ogSourceImage: tutorialSourceImage(tutorial.slug),
      ogSectionLabel: `Tutorial ${tutorial.number}`,
    }),
  ),
  ...INTEGRATIONS.map((integration) =>
    metadata(`/integrations/${integration.id}`, integration.name, integration.description, {
      section: 'integrations',
      ogSourceImage: OG_SOURCE_IMAGES.agentRuntime,
    }),
  ),
  ...BLUEPRINTS.map((blueprint) =>
    metadata(`/templates/${blueprint.id}`, blueprint.title, blueprint.description, {
      section: 'templates',
      canonicalPath: '/agents/templates',
      image: ogImagePathForRoutePath('/agents/templates'),
      ogSourceImage: OG_SOURCE_IMAGES.shipwrightProposal,
      index: false,
    }),
  ),
  ...blogPosts.map((post) =>
    metadata(`/blog/${post.slug}`, post.title, post.excerpt, {
      section: 'blog',
      ogSourceImage: post.heroImage,
      publishedAt: post.date,
      author: post.author,
      tags: post.tags,
    }),
  ),
  ...deprecatedBlogPosts.map((post) => {
    const replacement = blogPosts.find((candidate) => candidate.slug === post.replacementSlug)
    return metadata(`/blog/${post.slug}`, `${post.retiredLabel} (retired)`, post.reason, {
      section: 'blog',
      canonicalPath: replacement ? `/blog/${replacement.slug}` : '/blog',
      image: replacement ? ogImagePathForRoutePath(`/blog/${replacement.slug}`) : DEFAULT_SITE_IMAGE,
      ogSourceImage: replacement?.heroImage ?? OG_SOURCE_IMAGES.controlPlane,
      index: false,
    })
  }),
]

const docsRouteMetadata: SiteMetadata[] = [
  docsMetadata(docsOverviewRoute),
  ...docsFamilyRoutes.map(docsMetadata),
  ...docsGuideRoutes.map(([path, title, description]) =>
    metadata(path, title, description, {
      section: 'docs',
    }),
  ),
  ...docsCommandMetadata,
  ...docsFeatureMetadata,
  ...sdkMetadata,
  ...mcpMetadata,
  metadata(
    '/docs/api',
    'API Reference',
    'Inspect Port Daddy API routes, request shapes, response contracts, and the workflows they support.',
    { section: 'docs' },
  ),
  metadata(
    '/docs/api/endpoints',
    'API Endpoints',
    'Browse the Port Daddy endpoint reference for ports, sessions, locks, messages, harbors, fleet, and runtime status.',
    {
      section: 'docs',
      canonicalPath: '/docs/api',
      image: ogImagePathForRoutePath('/docs/api'),
      ogSourceImage: OG_SOURCE_IMAGES.agentRuntime,
      index: false,
    },
  ),
]

export const siteMetadataRoutes: SiteMetadata[] = [
  ...productRoutes,
  ...contentMetadata,
  ...docsRouteMetadata,
]

const metadataByPath = new Map(siteMetadataRoutes.map((route) => [route.path, route]))
const docsAliasByPath = new Map<string, SiteMetadata>()

for (const route of docsFamilyRoutes) {
  const canonical = metadataByPath.get(route.path)
  if (!canonical) continue
  for (const alias of route.aliases ?? []) {
    docsAliasByPath.set(`/docs/${alias}`, {
      ...canonical,
      path: `/docs/${alias}`,
      canonicalPath: route.path,
    })
  }
}

export function normalizeMetadataPath(pathname: string) {
  let path = pathname

  try {
    path = new URL(pathname, SITE_ORIGIN).pathname
  } catch {
    path = pathname.split(/[?#]/)[0] ?? '/'
  }

  if (!path.startsWith('/')) path = `/${path}`
  path = path.replace(/\/{2,}/g, '/')
  if (path.length > 1) path = path.replace(/\/$/, '')

  return path
}

export function absoluteUrl(path: string) {
  const normalizedPath = normalizeMetadataPath(path)
  return `${SITE_ORIGIN}${normalizedPath === '/' ? '/' : normalizedPath}`
}

export function absoluteImageUrl(image: string) {
  if (/^https?:\/\//.test(image)) return image
  return absoluteUrl(image)
}

export function isIndexableRoute(route: SiteMetadata) {
  return route.index !== false
}

export function getRouteMetadata(pathname: string): SiteMetadata {
  const path = normalizeMetadataPath(pathname)
  const exact = metadataByPath.get(path)
  if (exact) return exact

  const docsAlias = docsAliasByPath.get(path)
  if (docsAlias) return docsAlias

  if (path.startsWith('/docs/')) {
    return metadata(path, 'Docs', DEFAULT_SITE_DESCRIPTION, {
      section: 'docs',
      canonicalPath: '/docs',
      image: ogImagePathForRoutePath('/docs'),
      ogSourceImage: OG_SOURCE_IMAGES.controlPlane,
      index: false,
    })
  }

  return metadata(path, 'Port Daddy', DEFAULT_SITE_DESCRIPTION, {
    canonicalPath: '/',
    image: DEFAULT_SITE_IMAGE,
    ogSourceImage: OG_SOURCE_IMAGES.controlPlane,
    index: false,
  })
}

export function canonicalUrlForRoute(route: SiteMetadata) {
  return absoluteUrl(route.canonicalPath ?? route.path)
}

export function structuredDataForRoute(route: SiteMetadata) {
  const url = canonicalUrlForRoute(route)
  const image = absoluteImageUrl(route.image)
  const base = {
    '@context': 'https://schema.org',
    '@type': route.section === 'blog' && route.publishedAt ? 'Article' : 'WebPage',
    name: route.title,
    headline: route.title,
    description: route.description,
    url,
    image,
    isPartOf: {
      '@type': 'WebSite',
      name: SITE_NAME,
      url: absoluteUrl('/'),
    },
  }

  if (route.section !== 'blog' || !route.publishedAt) return base

  // Article rich-result completeness: Google wants datePublished + dateModified,
  // a publisher Organization with a logo, mainEntityOfPage, and an author. We
  // have no separate modified date, so dateModified mirrors datePublished (which
  // Google accepts) rather than inventing freshness.
  return {
    ...base,
    datePublished: route.publishedAt,
    dateModified: route.publishedAt,
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    author: {
      '@type': 'Person',
      name: route.author ?? 'Erich Owens',
    },
    publisher: {
      '@type': 'Organization',
      name: SITE_NAME,
      logo: {
        '@type': 'ImageObject',
        url: absoluteUrl('/apple-touch-icon.png'),
      },
    },
    keywords: route.tags?.join(', '),
  }
}
