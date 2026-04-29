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

function sitemapXml() {
  const urls = indexableRoutes
    .map((route) => `  <url>\n    <loc>${escapeXml(canonicalUrlForRoute(route))}</loc>\n  </url>`)
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
    '/cookbook',
    '/blog',
    '/whitepaper',
    '/whitepaper/anchor-protocol',
    '/whitepaper/bonded-commons',
  ]
    .map((path) => indexableRoutes.find((route) => route.path === path))
    .filter(Boolean)
    .map((route) => `- [${route.title}](${canonicalUrlForRoute(route)}): ${route.description}`)

  const sections = [
    ['## Primary Entry Points', priorityRoutes],
    ['## Docs', routeList('docs')],
    ['## Tutorials', routeList('tutorials')],
    ['## Cookbook', routeList('cookbook')],
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
