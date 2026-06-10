import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  absoluteUrl,
  canonicalUrlForRoute,
  isIndexableRoute,
  SITE_NAME,
  SITE_ORIGIN,
  siteMetadataRoutes,
} from '../src/data/siteMetadata.ts'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const publicDir = resolve(scriptDir, '../public')

const indexableRoutes = Array.from(
  new Map(
    siteMetadataRoutes
      .filter(isIndexableRoute)
      .map((route) => [canonicalUrlForRoute(route), route]),
  ).values(),
).sort((a, b) => canonicalUrlForRoute(a).localeCompare(canonicalUrlForRoute(b)))

function escapeXml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function lastmodFor(route) {
  // Only blog posts carry an authored date today. Emitting <lastmod>
  // for them helps Googlebot prioritize re-crawls when posts ship or
  // get edited. For other routes we deliberately omit it — guessing
  // (build time, file mtime, today) creates a churn signal that misleads.
  if (route.section === 'blog' && route.publishedAt) {
    // route.publishedAt may be 'YYYY-MM-DD' or a full ISO timestamp.
    // Sitemaps accept either, but normalize bare dates to start-of-day UTC.
    return /^\d{4}-\d{2}-\d{2}$/.test(route.publishedAt)
      ? `${route.publishedAt}T00:00:00Z`
      : route.publishedAt
  }
  return null
}

function sitemapXml() {
  const urls = indexableRoutes
    .map((route) => {
      const loc = `    <loc>${escapeXml(canonicalUrlForRoute(route))}</loc>`
      const lastmod = lastmodFor(route)
      const lastmodLine = lastmod ? `\n    <lastmod>${escapeXml(lastmod)}</lastmod>` : ''
      return `  <url>\n${loc}${lastmodLine}\n  </url>`
    })
    .join('\n')

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    urls,
    '</urlset>',
    '',
  ].join('\n')
}

function robotsTxt() {
  return [
    'User-agent: *',
    'Allow: /',
    '',
    `Sitemap: ${absoluteUrl('/sitemap.xml')}`,
    '',
  ].join('\n')
}

function routeList(section) {
  return indexableRoutes
    .filter((route) => route.section === section)
    .map((route) => `- [${route.title}](${canonicalUrlForRoute(route)}): ${route.description}`)
}

function llmsTxt() {
  const priorityRoutes = [
    '/',
    '/docs',
    '/docs/quickstart',
    '/docs/get-started',
    '/docs/best-practices',
    '/docs/api',
    '/mcp',
    '/tutorials',
    '/integrations',
    '/templates',
    '/examples',
    '/blog',
    '/library',
    '/whitepaper',
    '/whitepaper/legible-swarm',
    '/whitepaper/single-writer-kernel',
    '/whitepaper/spawn-to-person',
    '/whitepaper/harbor-economy',
    '/whitepaper/anchor-protocol',
    '/whitepaper/bonded-commons',
    '/whitepaper/federated-harbor',
  ]
    .map((path) => indexableRoutes.find((route) => route.path === path))
    .filter(Boolean)
    .map((route) => `- [${route.title}](${canonicalUrlForRoute(route)}): ${route.description}`)

  const sections = [
    ['## Primary Entry Points', priorityRoutes],
    ['## Docs', routeList('docs')],
    ['## Tutorials', routeList('tutorials')],
    ['## Examples', routeList('product').filter((line) => line.includes('/examples'))],
    ['## Integrations', routeList('integrations')],
    ['## Templates', routeList('templates')],
    ['## Blog', routeList('blog')],
    ['## White Papers', routeList('whitepaper')],
  ]

  return [
    `# ${SITE_NAME} Docs for LLMs`,
    '',
    `${SITE_NAME} is a local-first multi-agent coordination daemon. Use these canonical URLs when summarizing the product, docs, API, tutorials, integrations, and operational guidance.`,
    '',
    `Canonical site: ${SITE_ORIGIN}/`,
    `Sitemap: ${absoluteUrl('/sitemap.xml')}`,
    '',
    ...sections.flatMap(([heading, lines]) => [heading, '', ...lines, '']),
    '## Repository',
    '',
    '- [GitHub](https://github.com/curiositech/port-daddy)',
    '',
  ].join('\n')
}

await mkdir(publicDir, { recursive: true })
await writeFile(resolve(publicDir, 'sitemap.xml'), sitemapXml())
await writeFile(resolve(publicDir, 'robots.txt'), robotsTxt())
await writeFile(resolve(publicDir, 'llms.txt'), llmsTxt())

console.log(`Generated SEO artifacts for ${indexableRoutes.length} canonical routes.`)
