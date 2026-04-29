import { BLUEPRINTS } from './blueprints'
import { blogPosts, deprecatedBlogPosts } from './blogData'
import { docsFamilyRoutes, docsOverviewRoute, type DocsFamilyRoute } from './docs-routes'
import { INTEGRATIONS } from './integrations'
import { TUTORIALS } from './tutorials'
import { WHITE_PAPERS } from './whitePapers'

export const SITE_NAME = 'Port Daddy'
export const SITE_ORIGIN = 'https://portdaddy.dev'
export const DEFAULT_SITE_IMAGE = '/img/generated/control-plane-og.jpg'
export const DEFAULT_SITE_DESCRIPTION =
  'Port Daddy is a local communication substrate and Mac control plane for coding agents: shared notes, claims, channels, actor inboxes, readiness, budgets, and recoverable handoffs.'

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
  section: SiteMetadataSection
  index?: boolean
  publishedAt?: string
  author?: string
  tags?: string[]
}

export const blogHeroImages: Record<string, string> = Object.fromEntries(
  blogPosts.map((post) => [post.slug, post.heroImage]),
)

function pageTitle(title: string) {
  if (title === SITE_NAME) return 'Port Daddy - Local Communication Substrate for Coding Agents'
  if (title.endsWith(SITE_NAME)) return title
  return `${title} - ${SITE_NAME}`
}

function metadata(
  path: string,
  title: string,
  description: string,
  options: Partial<Omit<SiteMetadata, 'path' | 'title' | 'description'>> = {},
): SiteMetadata {
  return {
    path,
    title: pageTitle(title),
    description,
    image: DEFAULT_SITE_IMAGE,
    section: 'product',
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
    'Run complete Port Daddy example programs for local agent tools, swarms, inbox signaling, CI services, and topology traces.',
  ),
  metadata(
    '/examples/pd-tube-button-to-agent',
    'Build a button-to-agent loop with PD Tube',
    'Turn a plain HTML button into a local phone line to the agent session already running in your project.',
    { tags: ['tube', 'browser', 'agent loop', 'messages'] },
  ),
  metadata(
    '/examples/test-failure-to-agent',
    'Build a test reporter that asks the agent for help',
    'Wrap a failing test command, publish the failure to the local agent, and print the diagnosis back in the terminal.',
    { tags: ['tube', 'tests', 'reporter', 'terminal'] },
  ),
  metadata(
    '/examples/editor-lightbulb-to-agent',
    'Build an editor lightbulb that asks the local agent',
    'Select code in a local page, publish the file and range to the agent, and render the explanation inline.',
    { tags: ['tube', 'editor', 'selection', 'dev tools'] },
  ),
  metadata(
    '/examples/webhook-to-local-agent',
    'Build a webhook adapter backed by your workstation',
    'Accept Slack, Discord, Linear, or generic webhook JSON and route it to the local agent through PD Tube.',
    { tags: ['tube', 'webhooks', 'bots', 'http'] },
  ),
  metadata(
    '/examples/leader-election',
    'Elect one leader from a local agent swarm',
    'Run identical workers that race for one Port Daddy lock so exactly one becomes the coordinator.',
    { tags: ['locks', 'swarm', 'coordination', 'resilience'] },
  ),
  metadata(
    '/examples/p2p-webrtc',
    'Build WebRTC signaling over agent inboxes',
    'Use durable Port Daddy inboxes to exchange offer and answer messages before two agents open a direct peer channel.',
    { tags: ['inbox', 'webrtc', 'signaling', 'p2p'] },
  ),
  metadata(
    '/examples/ephemeral-ci-db',
    'Claim a collision-free port for an ephemeral CI database',
    'Wrap a Postgres test database so parallel CI jobs get stable semantic ports instead of fighting over 5432.',
    { tags: ['ports', 'ci', 'postgres', 'testing'] },
  ),
  metadata(
    '/examples/agent-archetypes',
    'Publish an agent topology trace',
    'Turn star, ring, and arbiter coordination patterns into concrete Port Daddy channel events.',
    { tags: ['swarm', 'pubsub', 'arbiter', 'topology'] },
  ),
  metadata(
    '/mcp',
    'MCP Server for AI Agents',
    'Connect Claude, Cursor, Windsurf, and other MCP clients to Port Daddy tools for sessions, claims, scoped channels, inboxes, readiness, and salvage.',
  ),
  metadata(
    '/mac-preview',
    'Mac Preview',
    'Download the FleetBar developer preview and see how the Mac app exposes Fleet Control Center, Shipwright, resources, sorties, backend readiness, and agent communication.',
  ),
  metadata(
    '/templates',
    'Agent Fleet Templates',
    'Start from production-ready Port Daddy templates for CI repair loops, research swarms, monorepos, webhooks, and agent teams.',
    { section: 'templates' },
  ),
  metadata(
    '/agents',
    'Agent Roster',
    'Meet the Port Daddy agent roles that monitor health, salvage crashed work, document drift, coordinate projects, and inspect dependencies.',
  ),
  metadata(
    '/tutorials',
    'Tutorials',
    'Follow hands-on Port Daddy tutorials from first install through sessions, DNS, tunnels, fleet YAML, messaging, and background agents.',
    { section: 'tutorials' },
  ),
  metadata(
    '/integrations',
    'Integrations',
    'Wire Port Daddy into Claude, Cursor, Windsurf, LangChain, CrewAI, Aider, Continue.dev, and other developer tooling.',
    { section: 'integrations' },
  ),
  metadata(
    '/blog',
    'Blog',
    'Read current Port Daddy field notes about FleetBar, Fleet Control Center, launch readiness, recovery maps, PD Tube, daemon provenance, and coordination policy.',
    { section: 'blog' },
  ),
  metadata(
    '/whitepaper',
    'Whitepaper',
    'Read the Port Daddy protocol argument for local-first agent coordination, identity, authority, locks, sessions, and recoverable work.',
    { section: 'whitepaper' },
  ),
  ...WHITE_PAPERS.map((paper) =>
    metadata(paper.readerHref, paper.title, paper.summary, {
      section: 'whitepaper',
    }),
  ),
]

const docsGuideRoutes = [
  ['/docs/quickstart', 'Quickstart', 'Install Port Daddy, verify the daemon, claim a port, and start the first coordinated operator workflow.'],
  ['/docs/guides/prompting-agents', 'Prompting Agents', 'Prompt agents to coordinate with Port Daddy sessions, notes, file claims, and shared runtime truth.'],
  ['/docs/guides/templates', 'Template Guide', 'Adapt Port Daddy fleet templates for recurring project work, background agents, hooks, and operator review.'],
  ['/docs/guides/protocol', 'Protocol Guide', 'Understand the Port Daddy protocol boundaries for ports, sessions, locks, messages, harbors, and salvage.'],
] as const

const cliRoutes = [
  ['cli', 'CLI Overview'],
  ['cli/claim', 'pd claim'],
  ['cli/release', 'pd release'],
  ['cli/find', 'pd find'],
  ['cli/services', 'pd services'],
  ['cli/scan', 'pd scan'],
  ['cli/up', 'pd up'],
  ['cli/down', 'pd down'],
  ['cli/status', 'pd status'],
  ['cli/begin', 'pd begin'],
  ['cli/done', 'pd done'],
  ['cli/whoami', 'pd whoami'],
  ['cli/note', 'pd note'],
  ['cli/notes', 'pd notes'],
  ['cli/lock-acquire', 'pd lock acquire'],
  ['cli/lock-release', 'pd lock release'],
  ['cli/with-lock', 'pd with-lock'],
  ['cli/msg', 'pd msg'],
  ['cli/pub', 'pd pub'],
  ['cli/watch', 'pd watch'],
  ['cli/spawn', 'pd spawn'],
  ['cli/spawned', 'pd spawned'],
  ['cli/agent-register', 'pd agent register'],
  ['cli/salvage', 'pd salvage'],
  ['cli/salvage-claim', 'pd salvage claim'],
  ['cli/dns', 'pd dns'],
  ['cli/harbor-create', 'pd harbor create'],
  ['cli/harbor-enter', 'pd harbor enter'],
  ['cli/harbor-leave', 'pd harbor leave'],
  ['cli/harbors', 'pd harbors'],
  ['cli/tunnel', 'pd tunnel'],
  ['cli/tunnel-stop', 'pd tunnel stop'],
  ['cli/fleet', 'pd fleet'],
  ['cli/init', 'pd init'],
  ['cli/mcp-install', 'pd mcp install'],
] as const

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
  ['features/fleet', 'Fleet YAML'],
  ['features/tuples', 'Tuples'],
  ['features/arbiter', 'Arbiter'],
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
  metadata(`/docs/${path}`, title, `Reference for ${title}, including Port Daddy syntax, operator intent, and coordinated local-agent workflow usage.`, {
    section: 'docs',
  }),
)

const docsFeatureMetadata = docsFeatureRoutes.map(([path, title]) =>
  metadata(`/docs/${path}`, title, `Learn the Port Daddy ${title.toLowerCase()} feature, what operator problem it solves, and how it fits the coordination model.`, {
    section: 'docs',
  }),
)

const sdkMetadata = sdkRoutes.map(([path, title]) =>
  metadata(`/docs/${path}`, title, `Use the Port Daddy ${title} surface from typed client code with sessions, locks, ports, and agent coordination primitives.`, {
    section: 'docs',
  }),
)

const mcpMetadata = mcpRoutes.map(([path, title]) =>
  metadata(`/docs/${path}`, title, `Use the Port Daddy ${title} route for MCP clients, agent-safe tool calls, and model-facing coordination workflows.`, {
    section: 'docs',
  }),
)

const contentMetadata: SiteMetadata[] = [
  ...TUTORIALS.map((tutorial) =>
    metadata(tutorial.href, tutorial.title, tutorial.description, {
      section: 'tutorials',
    }),
  ),
  ...INTEGRATIONS.map((integration) =>
    metadata(`/integrations/${integration.id}`, integration.name, integration.description, {
      section: 'integrations',
    }),
  ),
  ...BLUEPRINTS.map((blueprint) =>
    metadata(`/templates/${blueprint.id}`, blueprint.title, blueprint.description, {
      section: 'templates',
    }),
  ),
  ...blogPosts.map((post) =>
    metadata(`/blog/${post.slug}`, post.title, post.excerpt, {
      section: 'blog',
      image: post.heroImage,
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
      image: replacement?.heroImage ?? DEFAULT_SITE_IMAGE,
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
    'Inspect Port Daddy daemon API routes, request shapes, response contracts, and the operator workflows they support.',
    { section: 'docs' },
  ),
  metadata(
    '/docs/api/endpoints',
    'API Endpoints',
    'Browse the Port Daddy endpoint reference for ports, sessions, locks, messages, harbors, fleet, and runtime status.',
    { section: 'docs', canonicalPath: '/docs/api', index: false },
  ),
]

export const siteMetadataRoutes: SiteMetadata[] = [
  ...productRoutes,
  ...contentMetadata,
  ...docsRouteMetadata,
  metadata('/docs-old', 'Legacy Docs', 'Legacy Port Daddy documentation kept available for compatibility while the current docs system is normalized.', {
    section: 'legacy',
    canonicalPath: '/docs',
    index: false,
  }),
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
      index: false,
    })
  }

  return metadata(path, 'Port Daddy', DEFAULT_SITE_DESCRIPTION, {
    canonicalPath: '/',
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

  return {
    ...base,
    datePublished: route.publishedAt,
    author: {
      '@type': 'Organization',
      name: route.author ?? 'Port Daddy Engineering',
    },
    keywords: route.tags?.join(', '),
  }
}
