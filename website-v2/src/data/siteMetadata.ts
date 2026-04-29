import { BLUEPRINTS } from './blueprints'
import { blogPosts, deprecatedBlogPosts } from './blogData'
import { COOKBOOK_RECIPES } from './cookbook'
import { docsFamilyRoutes, docsOverviewRoute, type DocsFamilyRoute } from './docs-routes'
import { INTEGRATIONS } from './integrations'
import { TUTORIALS } from './tutorials'
import { WHITE_PAPERS } from './whitePapers'

export const SITE_NAME = 'Port Daddy'
export const SITE_ORIGIN = 'https://portdaddy.dev'
export const DEFAULT_SITE_IMAGE = '/img/generated/control-plane-og.jpg'
export const DEFAULT_SITE_DESCRIPTION =
  'Port Daddy is a local app and background service that helps AI coding agents share notes, claim work, avoid collisions, recover interrupted runs, and show what is happening on your machine.'

export type SiteMetadataSection =
  | 'home'
  | 'product'
  | 'docs'
  | 'tutorials'
  | 'cookbook'
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
  if (title === SITE_NAME) return 'Port Daddy - Local Coordination for AI Coding Agents'
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
    'Run complete Port Daddy example programs for browser buttons, test reporters, editor commands, and webhook adapters that talk to local agents.',
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
    '/mcp',
    'Skill + MCP for AI Agents',
    'Use the Port Daddy agent skill and MCP server together: an instruction manual plus callable tools for sessions, claims, scoped channels, inboxes, readiness, salvage, fleets, and handoffs.',
  ),
  metadata(
    '/mac-preview',
    'Mac Preview',
    'Download the FleetBar developer preview and see how the Mac app exposes Fleet Control Center, Shipwright, resources, sorties, backend readiness, and agent communication.',
  ),
  metadata(
    '/templates',
    'Agent Fleet Templates (deprecated)',
    'The top-level template library has moved under Agents. Use /agents/templates for current Port Daddy fleet templates and reusable agent patterns.',
    { section: 'templates', canonicalPath: '/agents/templates', index: false },
  ),
  metadata(
    '/agents',
    'Agent Roster',
    'Meet the Port Daddy agent roles that monitor health, salvage crashed work, document drift, coordinate projects, and inspect dependencies.',
  ),
  metadata(
    '/agents/templates',
    'Agent Templates',
    'Use the current Port Daddy agent templates: starter fleet YAML, always-on agents, CI repair loops, event-driven ops, remote harbors, research swarms, and secure messaging primitives.',
    { section: 'templates' },
  ),
  metadata(
    '/agents/agent-skill',
    'Agent Skill (moved)',
    'The Port Daddy agent skill now lives with the MCP server on the top-level Skill + MCP page.',
    { canonicalPath: '/mcp', index: false },
  ),
  metadata(
    '/tutorials',
    'Tutorials',
    'Follow hands-on Port Daddy tutorials from first install through sessions, DNS, tunnels, fleet YAML, messaging, and background agents.',
    { section: 'tutorials' },
  ),
  metadata(
    '/cookbook',
    'Cookbook',
    'Use tested Port Daddy recipes for distributed locks, WebRTC signaling, ephemeral CI databases, and multi-agent topologies.',
    { section: 'cookbook' },
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
    'Read the technical whitepaper behind Port Daddy: local-first agent coordination, signed identity, locks, sessions, and recoverable work.',
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
    }),
  ),
  ...COOKBOOK_RECIPES.map((recipe) =>
    metadata(`/cookbook/${recipe.id}`, recipe.title, recipe.description, {
      section: 'cookbook',
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
      canonicalPath: '/agents/templates',
      index: false,
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
    'Inspect Port Daddy API routes, request shapes, response contracts, and the workflows they support.',
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
