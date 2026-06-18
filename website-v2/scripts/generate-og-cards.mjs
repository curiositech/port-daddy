import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DEFAULT_SITE_IMAGE,
  isIndexableRoute,
  SITE_NAME,
  siteMetadataRoutes,
} from '../src/data/siteMetadata.ts'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const websiteRoot = resolve(scriptDir, '..')
const publicDir = resolve(websiteRoot, 'public')
const outputDir = resolve(publicDir, 'img/og')
const tempDir = resolve(websiteRoot, '.tmp-og')
const rendererPath = resolve(scriptDir, 'render-og-cards.py')
// Warm Swiss redesign: the rasterized Port Daddy brand mark (from public/pd_logo.svg),
// cached under scripts/og-fonts/. The flat cream design no longer uses a dark background.
const logoPath = resolve(scriptDir, 'og-fonts/pd_logo_mark.png')

function preferredRouteForImages() {
  const routes = new Map()

  for (const route of siteMetadataRoutes) {
    if (!route.image.startsWith('/img/og/')) continue
    const existing = routes.get(route.image)
    if (!existing || (existing.index === false && isIndexableRoute(route))) {
      routes.set(route.image, route)
    }
  }

  return [...routes.values()].sort((a, b) => a.image.localeCompare(b.image))
}

function findPython() {
  const candidates = [
    process.env.PYTHON_BIN,
    '/opt/anaconda3/bin/python3',
    'python3',
    'python',
  ].filter(Boolean)

  for (const candidate of candidates) {
    const result = spawnSync(candidate, ['-c', 'import PIL'], { encoding: 'utf8' })
    if (result.status === 0) return candidate
  }

  throw new Error('Could not find a Python interpreter with Pillow installed. Set PYTHON_BIN to one before running generate:og.')
}

for (const requiredPath of [rendererPath, logoPath]) {
  if (!existsSync(requiredPath)) throw new Error(`Missing OG generation input: ${requiredPath}`)
}

await mkdir(outputDir, { recursive: true })
await mkdir(tempDir, { recursive: true })

const routes = preferredRouteForImages()
const manifest = routes.map((route) => ({
  image: route.image,
  route: route.path,
  title: route.title,
  description: route.description,
  section: route.section,
  sectionLabel: route.ogSectionLabel ?? route.section,
  sourceImage: route.ogSourceImage,
}))
const inputPath = resolve(tempDir, 'og-routes.json')

await writeFile(
  inputPath,
  `${JSON.stringify({
    publicDir,
    outputDir,
    logoPath,
    routes: manifest,
  }, null, 2)}\n`,
)

const python = findPython()
const render = spawnSync(python, [rendererPath, inputPath], { encoding: 'utf8' })

if (render.status !== 0) {
  throw new Error(`Failed to render OG cards with ${python}\n${render.stderr || render.stdout}`)
}

await writeFile(
  resolve(outputDir, 'manifest.json'),
  `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    generator: 'website-v2/scripts/generate-og-cards.mjs',
    renderer: 'website-v2/scripts/render-og-cards.py',
    siteName: SITE_NAME,
    defaultImage: DEFAULT_SITE_IMAGE,
    cardSize: { width: 1200, height: 630 },
    routes: manifest,
  }, null, 2)}\n`,
)

console.log(render.stdout.trim())
console.log(`Generated ${routes.length} branded OG card(s).`)
