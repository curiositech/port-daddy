import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  absoluteImageUrl,
  canonicalUrlForRoute,
  isIndexableRoute,
  siteMetadataRoutes,
  structuredDataForRoute,
} from '../src/data/siteMetadata.ts'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const websiteRoot = resolve(scriptDir, '..')
const distDir = resolve(websiteRoot, 'dist')
const indexPath = resolve(distDir, 'index.html')

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function escapeScriptJson(value) {
  return JSON.stringify(value).replaceAll('</', '<\\/')
}

function metaBlock(route) {
  const canonical = canonicalUrlForRoute(route)
  const image = absoluteImageUrl(route.image)
  const robots = isIndexableRoute(route) ? 'index,follow' : 'noindex,follow'

  return [
    `    <title>${escapeHtml(route.title)}</title>`,
    `    <meta name="description" content="${escapeHtml(route.description)}" />`,
    `    <meta property="og:site_name" content="Port Daddy" />`,
    `    <meta property="og:type" content="${route.section === 'blog' && route.publishedAt ? 'article' : 'website'}" />`,
    `    <meta property="og:url" content="${escapeHtml(canonical)}" />`,
    `    <meta property="og:title" content="${escapeHtml(route.title)}" />`,
    `    <meta property="og:description" content="${escapeHtml(route.description)}" />`,
    `    <meta property="og:image" content="${escapeHtml(image)}" />`,
    '    <meta property="og:image:width" content="1200" />',
    '    <meta property="og:image:height" content="630" />',
    '    <meta name="twitter:card" content="summary_large_image" />',
    `    <meta name="twitter:url" content="${escapeHtml(canonical)}" />`,
    `    <meta name="twitter:title" content="${escapeHtml(route.title)}" />`,
    `    <meta name="twitter:description" content="${escapeHtml(route.description)}" />`,
    `    <meta name="twitter:image" content="${escapeHtml(image)}" />`,
    `    <link rel="canonical" href="${escapeHtml(canonical)}" />`,
    `    <meta name="robots" content="${robots}" />`,
    `    <script type="application/ld+json" data-site-metadata="json-ld">${escapeScriptJson(structuredDataForRoute(route))}</script>`,
  ].join('\n')
}

function stripExistingMetadata(html) {
  return html
    .replace(/    <title>[\s\S]*?<\/title>\n?/g, '')
    .replace(/    <meta name="description"[\s\S]*?>\n?/g, '')
    .replace(/    <meta property="og:[\s\S]*?>\n?/g, '')
    .replace(/    <meta name="twitter:[\s\S]*?>\n?/g, '')
    .replace(/    <meta property="twitter:[\s\S]*?>\n?/g, '')
    .replace(/    <meta name="robots"[\s\S]*?>\n?/g, '')
    .replace(/    <link rel="canonical"[\s\S]*?>\n?/g, '')
    .replace(/    <script type="application\/ld\+json" data-site-metadata="json-ld">[\s\S]*?<\/script>\n?/g, '')
}

function injectMetadata(html, route) {
  const stripped = stripExistingMetadata(html)
  return stripped.replace('</head>', `${metaBlock(route)}\n  </head>`)
}

function routeOutputPath(routePath) {
  if (routePath === '/') return indexPath
  return resolve(distDir, routePath.replace(/^\/+/, ''), 'index.html')
}

function routeCleanHtmlPath(routePath) {
  if (routePath === '/') return undefined
  return resolve(distDir, `${routePath.replace(/^\/+/, '')}.html`)
}

const indexHtml = await readFile(indexPath, 'utf8')
const routes = Array.from(new Map(siteMetadataRoutes.map((route) => [route.path, route])).values())

for (const route of routes) {
  const html = injectMetadata(indexHtml, route)
  const outputPath = routeOutputPath(route.path)
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, html)

  const cleanHtmlPath = routeCleanHtmlPath(route.path)
  if (cleanHtmlPath) {
    await mkdir(dirname(cleanHtmlPath), { recursive: true })
    await writeFile(cleanHtmlPath, html)
  }
}

const rewrites = [
  ...routes
    .filter((route) => route.path !== '/')
    .flatMap((route) => [
      `${route.path}  ${route.path}/index.html  200`,
      `${route.path}/  ${route.path}/index.html  200`,
    ]),
  '/*  /index.html  200',
  '',
].join('\n')

await writeFile(resolve(distDir, '_redirects'), rewrites)

console.log(`Injected route-specific HTML metadata for ${routes.length} route(s).`)
