import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { dirname, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const websiteRoot = resolve(scriptDir, '..')
const projectRoot = resolve(websiteRoot, '..')
const outputDir = resolve(websiteRoot, 'public/img/generated')
const manifestPath = resolve(outputDir, 'manifest.json')
const apiUrlBase = 'https://generativelanguage.googleapis.com/v1beta/models'
const model = process.env.GEMINI_IMAGE_MODEL ?? 'gemini-3.1-flash-image-preview'
const jpegQuality = '82'
const webpQuality = '82'

const sharedDirection = `
Port Daddy visual identity direction:
- Subject: local-first AI agent coordination, daemon runtime, ports, locks, sessions, notes, salvage, budget gates, and recovery flows.
- Visual language: Swiss-modern editorial infrastructure diagram, precise grid, crisp thin rules, architectural drawing discipline, tactile paper grain, deep ink, technical blue, restrained lime, quiet warm off-white.
- Must not include people, sailors, boats, harbors, docks, nautical costumes, mascots, emojis, fake testimonials, readable brand logos, glossy stock-photo styling, bubbly extruded SaaS UI, pill-heavy dashboards, purple-blue gradients, or random surrealism.
- Do not render visible words, letters, numbers, labels, headings, UI copy, brand marks, or fake code. Use abstract ticks, short lines, and geometric marks only.
- Make it feel premium, serious, current, and operational.
`.trim()

const assets = [
  {
    id: 'control-plane-hero',
    filename: 'control-plane-hero.jpg',
    aspectRatio: '16:9',
    imageSize: '2K',
    prompt: `
${sharedDirection}

Create a hero image for the top of a developer-tool website.
Composition: a wide, slightly top-down control-plane map where agent sessions are represented as rectilinear modules connected by port lines, locks, tuple channels, and recovery lanes. Use depth through layered paper, ink, and precise shadows, not soft rounded extrusion.
Leave a calm negative-space band on the left third so the website headline can sit beside it without visual fighting.
No humans. No nautical objects. No big rounded cards. No mock browser chrome. No visible words or numbers.
`.trim(),
  },
  {
    id: 'control-plane-og',
    filename: 'control-plane-og.jpg',
    aspectRatio: '16:9',
    imageSize: '2K',
    prompt: `
${sharedDirection}

Create an Open Graph/social image for Port Daddy.
Composition: centered infrastructure diagram with one authoritative control-plane spine, multiple agent nodes, abstract port marks, lock/checkpoint motifs, and a recovery ledger path. It should crop safely at 1200 by 630.
No headline text, no labels, no logos, no humans, no nautical imagery, no rounded app mockups.
`.trim(),
  },
  {
    id: 'agent-runtime-map',
    filename: 'agent-runtime-map.jpg',
    aspectRatio: '16:9',
    imageSize: '1K',
    prompt: `
${sharedDirection}

Create a supporting editorial illustration of an always-on background-agent runtime.
Composition: a rigorous map of cheaper worker lanes, watchdog checks, queue pressure, budget gates, and escalation routes. Use a restrained technical palette and Swiss grid.
No people, no boats, no cartoon robots, no speech bubbles, no fake UI screenshots, no visible words, no letters, no numbers.
`.trim(),
  },
  {
    id: 'salvage-ledger',
    filename: 'salvage-ledger.jpg',
    aspectRatio: '16:9',
    imageSize: '1K',
    prompt: `
${sharedDirection}

Create a supporting editorial illustration of crash recovery and salvage.
Composition: archival ledger sheets, event traces, file-claim paths, and restored work fragments being reconciled into a clean timeline. Serious, beautiful, diagrammatic, and operational.
No nautical metaphors, no skulls, no horror mood, no fake code text, no people, no visible words, no letters, no numbers.
`.trim(),
  },
  {
    id: 'coordination-guard',
    filename: 'coordination-guard.jpg',
    aspectRatio: '16:9',
    imageSize: '1K',
    prompt: `
${sharedDirection}

Create a supporting editorial illustration of enforced agent coordination.
Composition: file-claim boundaries, lock gates, session notes, tuple cells, and pre-commit guard rails arranged as a precise compliance diagram. The image should feel like a practical operator control surface, not an abstract promise.
No people, no mascots, no handcuffs, no police/security theater, no fake UI screenshots, no visible words, no letters, no numbers.
`.trim(),
  },
  {
    id: 'fleetbar-install',
    filename: 'fleetbar-install.jpg',
    aspectRatio: '16:9',
    imageSize: '1K',
    prompt: `
${sharedDirection}

Create a supporting editorial illustration for installing a Mac menu-bar control plane.
Composition: a restrained Mac desktop silhouette, a small menu-bar control glyph, a packaged app artifact, a Homebrew-style install rail, and a local daemon spine connecting to project folders. It should look like reliable developer infrastructure.
No readable UI text, no Apple logo, no fake product logo, no people, no stock laptop glamor, no visible words, no letters, no numbers.
`.trim(),
  },
  {
    id: 'shipwright-proposal',
    filename: 'shipwright-proposal.jpg',
    aspectRatio: '16:9',
    imageSize: '1K',
    prompt: `
${sharedDirection}

Create a supporting editorial illustration for Shipwright designing a starter agent fleet for an arbitrary software repo.
Composition: a repo survey map branching into proposed roles, model tiers, budget gates, trigger lanes, simulation traces, and a final YAML-like plan represented only as abstract line blocks.
No readable text, no code, no file names, no people, no nautical imagery, no cartoon robots, no visible words, no letters, no numbers.
`.trim(),
  },
]

function loadEnvFile(path) {
  if (!existsSync(path)) return
  const raw = readFileSync(path, 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!match) continue
    const [, key, rawValue] = match
    if (process.env[key]) continue
    process.env[key] = rawValue.replace(/^['"]|['"]$/g, '')
  }
}

function parseArgs(argv) {
  const selected = new Set()
  let listOnly = false
  let optimizeExisting = false

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--list') {
      listOnly = true
    } else if (arg === '--optimize-existing') {
      optimizeExisting = true
    } else if (arg === '--asset' || arg === '--only') {
      const value = argv[i + 1]
      if (!value) throw new Error(`${arg} requires an asset id`)
      selected.add(value)
      i += 1
    } else if (arg.startsWith('--asset=')) {
      selected.add(arg.slice('--asset='.length))
    } else if (arg.startsWith('--only=')) {
      selected.add(arg.slice('--only='.length))
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return { listOnly, optimizeExisting, selected }
}

function extensionForMime(mimeType) {
  if (mimeType === 'image/jpeg') return '.jpg'
  if (mimeType === 'image/webp') return '.webp'
  return '.png'
}

function safeErrorMessage(data) {
  return data?.error?.message ?? data?.error?.status ?? 'Gemini image generation failed'
}

function commandExists(command) {
  const result = spawnSync('sh', ['-lc', `command -v ${command}`], { stdio: 'ignore' })
  return result.status === 0
}

function optimizeJpegIfAvailable(targetPath) {
  if (!commandExists('magick')) return undefined
  const result = spawnSync('magick', [targetPath, '-strip', '-quality', jpegQuality, targetPath], {
    stdio: 'ignore',
  })
  return result.status === 0 ? Number(jpegQuality) : undefined
}

function createWebpIfAvailable(targetPath, targetFilename) {
  if (!commandExists('cwebp')) return undefined
  const webpFilename = targetFilename.replace(/\.[^.]+$/, '.webp')
  const webpPath = resolve(outputDir, webpFilename)
  const result = spawnSync('cwebp', ['-quiet', '-q', webpQuality, targetPath, '-o', webpPath], {
    stdio: 'ignore',
  })
  return result.status === 0 ? `/img/generated/${webpFilename}` : undefined
}

function optimizeAssetFile(file) {
  const targetFilename = file.replace('/img/generated/', '')
  const targetPath = resolve(outputDir, targetFilename)
  if (!existsSync(targetPath)) return {}

  const optimizedJpegQuality = targetFilename.endsWith('.jpg') ? optimizeJpegIfAvailable(targetPath) : undefined
  const webpFile = /\.(jpe?g|png)$/i.test(targetFilename)
    ? createWebpIfAvailable(targetPath, targetFilename)
    : undefined

  return {
    ...(optimizedJpegQuality ? { jpegQuality: optimizedJpegQuality } : {}),
    ...(webpFile ? { webpFile, webpQuality: Number(webpQuality) } : {}),
  }
}

async function generateAsset(asset, apiKey) {
  const response = await fetch(`${apiUrlBase}/${model}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [{ text: asset.prompt }],
        },
      ],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
        imageConfig: {
          aspectRatio: asset.aspectRatio,
          imageSize: asset.imageSize,
        },
      },
    }),
  })

  const data = await response.json()
  if (!response.ok) {
    throw new Error(`${asset.id}: ${safeErrorMessage(data)}`)
  }

  const parts = data?.candidates?.[0]?.content?.parts ?? []
  const imagePart = parts.find((part) => part.inlineData || part.inline_data)
  const inlineData = imagePart?.inlineData ?? imagePart?.inline_data
  if (!inlineData?.data) {
    const text = parts.map((part) => part.text).filter(Boolean).join('\n').trim()
    throw new Error(`${asset.id}: response did not contain image data${text ? ` (${text})` : ''}`)
  }

  const mimeType = inlineData.mimeType ?? inlineData.mime_type ?? 'image/png'
  const ext = extensionForMime(mimeType)
  const targetFilename = extname(asset.filename) === ext ? asset.filename : asset.filename.replace(/\.[^.]+$/, ext)
  const targetPath = resolve(outputDir, targetFilename)
  await writeFile(targetPath, Buffer.from(inlineData.data, 'base64'))
  const optimization = optimizeAssetFile(`/img/generated/${targetFilename}`)

  return {
    id: asset.id,
    file: `/img/generated/${targetFilename}`,
    mimeType,
    aspectRatio: asset.aspectRatio,
    imageSize: asset.imageSize,
    model,
    prompt: asset.prompt,
    ...optimization,
  }
}

async function optimizeExistingManifestAssets() {
  if (!existsSync(manifestPath)) {
    throw new Error('No generated asset manifest exists yet. Run generate:visuals first.')
  }

  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const generatedAssets = (manifest.generatedAssets ?? []).map((entry) => ({
    ...entry,
    ...optimizeAssetFile(entry.file),
  }))

  const nextManifest = {
    ...manifest,
    optimizedAt: new Date().toISOString(),
    generatedAssets,
  }

  await writeFile(manifestPath, `${JSON.stringify(nextManifest, null, 2)}\n`)
  console.log(`Optimized ${generatedAssets.length} generated asset(s).`)
}

async function main() {
  loadEnvFile(resolve(projectRoot, '.env.local'))
  loadEnvFile(resolve(projectRoot, '.env'))
  loadEnvFile(resolve(websiteRoot, '.env.local'))
  loadEnvFile(resolve(websiteRoot, '.env'))

  const { listOnly, optimizeExisting, selected } = parseArgs(process.argv.slice(2))
  const targetAssets = selected.size ? assets.filter((asset) => selected.has(asset.id)) : assets

  if (listOnly) {
    console.log(assets.map((asset) => asset.id).join('\n'))
    return
  }

  await mkdir(outputDir, { recursive: true })

  if (optimizeExisting) {
    await optimizeExistingManifestAssets()
    return
  }

  if (selected.size && targetAssets.length !== selected.size) {
    const known = new Set(assets.map((asset) => asset.id))
    const unknown = [...selected].filter((id) => !known.has(id))
    throw new Error(`Unknown asset id(s): ${unknown.join(', ')}`)
  }

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is required. Put it in .env.local, website-v2/.env.local, or the shell environment.')
  }

  const existingManifest = existsSync(manifestPath)
    ? JSON.parse(await readFile(manifestPath, 'utf8'))
    : { generatedAssets: [] }
  const previous = new Map((existingManifest.generatedAssets ?? []).map((entry) => [entry.id, entry]))
  const generated = []

  for (const asset of targetAssets) {
    console.log(`Generating ${asset.id} with ${model}...`)
    const entry = await generateAsset(asset, apiKey)
    previous.set(asset.id, entry)
    generated.push(entry.file)
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    generator: 'website-v2/scripts/generate-gemini-assets.mjs',
    source: 'Google Gemini API Nano Banana image generation',
    docs: 'https://ai.google.dev/gemini-api/docs/image-generation',
    note: 'Prompts intentionally exclude nautical, human, fake quote, and bubbly extruded SaaS imagery.',
    generatedAssets: [...previous.values()].sort((a, b) => a.id.localeCompare(b.id)),
  }

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`Generated ${generated.length} asset(s): ${generated.join(', ')}`)
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
