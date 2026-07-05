import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { dirname, extname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const websiteRoot = resolve(scriptDir, '..')
const projectRoot = resolve(websiteRoot, '..')
const srcRoot = resolve(websiteRoot, 'src')
const publicRoot = resolve(websiteRoot, 'public')
const apiUrlBase = 'https://generativelanguage.googleapis.com/v1beta/models'
const model = process.env.GEMINI_IMAGE_MODEL ?? 'gemini-3-pro-image'

const imageExtensions = new Set(['.avif', '.gif', '.jpeg', '.jpg', '.png', '.webp'])
const validAspects = new Map([
  ['1:1', 1],
  ['2:3', 2 / 3],
  ['3:2', 3 / 2],
  ['3:4', 3 / 4],
  ['4:3', 4 / 3],
  ['4:5', 4 / 5],
  ['5:4', 5 / 4],
  ['9:16', 9 / 16],
  ['16:9', 16 / 9],
  ['21:9', 21 / 9],
])

const storyPalette = [
  'deep ink #101216',
  'kernel cobalt #7db4ff',
  'legibility teal #8fd0a7',
  'health sage #5fce97',
  'federation indigo #9d92e8',
  'identity violet #b69bec',
  'reputation rust #e09464',
  'economy amber #f2be51',
].join(', ')

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return
  const raw = readFileSync(filePath, 'utf8')

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
  let force = false
  let listOnly = false
  let limit = Number.POSITIVE_INFINITY
  let styleReference

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]

    if (arg === '--force') {
      force = true
    } else if (arg === '--list') {
      listOnly = true
    } else if (arg === '--asset') {
      const value = argv[i + 1]
      if (!value) throw new Error('--asset requires a source asset path')
      selected.add(value)
      i += 1
    } else if (arg.startsWith('--asset=')) {
      selected.add(arg.slice('--asset='.length))
    } else if (arg === '--limit') {
      const value = Number(argv[i + 1])
      if (!Number.isFinite(value) || value < 1) throw new Error('--limit requires a positive number')
      limit = value
      i += 1
    } else if (arg.startsWith('--limit=')) {
      const value = Number(arg.slice('--limit='.length))
      if (!Number.isFinite(value) || value < 1) throw new Error('--limit requires a positive number')
      limit = value
    } else if (arg === '--style') {
      const value = argv[i + 1]
      if (!value) throw new Error('--style requires a public asset path')
      styleReference = value
      i += 1
    } else if (arg.startsWith('--style=')) {
      styleReference = arg.slice('--style='.length)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return { force, limit, listOnly, selected, styleReference }
}

function listFiles(root, predicate) {
  return readdirSync(root).flatMap((entry) => {
    const filePath = join(root, entry)
    const stats = statSync(filePath)

    if (stats.isDirectory()) return listFiles(filePath, predicate)
    return predicate(filePath) ? [filePath] : []
  })
}

function toDarkSrc(src) {
  const [assetPath, ...suffixParts] = src.split(/(?=[?#])/)
  const suffix = suffixParts.join('')
  const dot = assetPath.lastIndexOf('.')

  if (dot <= assetPath.lastIndexOf('/')) return src

  const stem = assetPath.slice(0, dot)
  if (stem.endsWith('-light')) {
    return `${stem.slice(0, -'-light'.length)}-dark${assetPath.slice(dot)}${suffix}`
  }

  return `${assetPath.slice(0, dot)}-dark${assetPath.slice(dot)}${suffix}`
}

function shouldHaveDarkPair(assetPath) {
  const ext = extname(assetPath).toLowerCase()

  if (!assetPath.startsWith('/')) return false
  if (!imageExtensions.has(ext)) return false
  if (assetPath.includes('/img/og/')) return false
  if (assetPath.includes('/logos/')) return false
  if (/-dark(?=\.[a-z0-9]+$)/i.test(assetPath)) return false

  return true
}

function collectImageAssets() {
  const literals = new Set()

  for (const file of listFiles(srcRoot, (filePath) => /\.(md|ts|tsx)$/.test(filePath) && !/\.test\.(ts|tsx)$/.test(filePath))) {
    const raw = readFileSync(file, 'utf8')

    for (const match of raw.matchAll(/['"(]((?:\/(?:img|gifs|media)[^'"\s)]+)|\/apple-touch-icon\.png)/g)) {
      literals.add(match[1].split(/[?#]/)[0])
    }
  }

  return [...literals]
    .filter(shouldHaveDarkPair)
    .map((source) => ({ source, output: toDarkSrc(source).split(/[?#]/)[0] }))
    .filter(({ source }) => existsSync(publicPath(source)))
    .sort((a, b) => a.output.localeCompare(b.output))
}

function publicPath(assetPath) {
  return resolve(publicRoot, assetPath.slice(1))
}

function commandExists(command) {
  return spawnSync('sh', ['-lc', `command -v ${command}`], { stdio: 'ignore' }).status === 0
}

function imageSize(filePath) {
  if (!commandExists('magick')) return undefined

  const result = spawnSync('magick', ['identify', '-format', '%w %h', filePath], { encoding: 'utf8' })
  if (result.status !== 0) return undefined

  const [width, height] = result.stdout.trim().split(/\s+/).map(Number)
  if (!Number.isFinite(width) || !Number.isFinite(height) || height === 0) return undefined

  return { width, height }
}

function closestAspect(filePath) {
  const size = imageSize(filePath)
  if (!size) return '16:9'

  const ratio = size.width / size.height
  let best = '16:9'
  let bestDistance = Number.POSITIVE_INFINITY

  for (const [aspect, aspectRatio] of validAspects) {
    const distance = Math.abs(Math.log(ratio / aspectRatio))
    if (distance < bestDistance) {
      best = aspect
      bestDistance = distance
    }
  }

  return best
}

function mimeType(filePath) {
  const ext = extname(filePath).toLowerCase()
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.gif') return 'image/gif'
  if (ext === '.avif') return 'image/avif'
  return 'image/png'
}

function encodeImage(assetPath) {
  const filePath = publicPath(assetPath)
  return {
    inlineData: {
      mimeType: mimeType(filePath),
      data: readFileSync(filePath).toString('base64'),
    },
  }
}

function buildPrompt({ source, hasStyleReference }) {
  const referenceInstruction = hasStyleReference
    ? 'Reference image 1 is the LIGHT MODE CONTENT. Reference image 2 is mood and rendering discipline only; do not copy its scene, objects, frame, layout, people, text, or props.'
    : 'Reference image 1 is the ONLY visual reference. Preserve its subject, spatial composition, important objects, and the role of every visual element. Do not invent or import a second scene, room, monitor, sign, person, background, window, prop, card, or frame.'

  return [
    referenceInstruction,
    `Generate the dark-mode sibling for ${source}: same scene and meaning, but rebuilt as a true dark-mode asset for a near-black website surface using this expanded story palette: ${storyPalette}.`,
    'The overall canvas must read dark at a glance: deep ink or charcoal background, luminous cobalt/teal/violet linework, soft amber/rust accents, and bright subject edges. Do not keep the light cream paper background from the source image.',
    'Use the richer story colors as accents only: cobalt for kernel/truth, teal for legibility, sage for ready coordination, indigo for federation, violet for identity, rust for reputation, amber for value.',
    'Keep it serious, operational, high-contrast, and brand-specific. Any screens, signs, cards, labels, or panels show abstract glowing UI shapes, soft-blurred bars, and non-language marks only: no readable typography, captions, labels, watermarks, brand marks, handwritten words, numbers, or pseudo text.',
  ].join('\n\n')
}

async function callGemini({ apiKey, source, styleReference, aspectRatio }) {
  const requestParts = [
    encodeImage(source),
    ...(styleReference ? [encodeImage(styleReference)] : []),
    { text: buildPrompt({ source, hasStyleReference: Boolean(styleReference) }) },
  ]

  const response = await fetch(`${apiUrlBase}/${model}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      contents: [
        {
          parts: requestParts,
        },
      ],
      generationConfig: {
        responseModalities: ['IMAGE'],
        imageConfig: { aspectRatio },
      },
    }),
  })

  const data = await response.json()
  if (!response.ok) {
    throw new Error(`${source}: ${data?.error?.message ?? data?.error?.status ?? 'Gemini image generation failed'}`)
  }

  const responseParts = data?.candidates?.[0]?.content?.parts ?? []
  const imagePart = responseParts.find((part) => part.inlineData || part.inline_data)
  const inlineData = imagePart?.inlineData ?? imagePart?.inline_data
  if (!inlineData?.data) {
    const text = responseParts.map((part) => part.text).filter(Boolean).join('\n').trim()
    throw new Error(`${source}: response did not contain image data${text ? ` (${text})` : ''}`)
  }

  return {
    bytes: Buffer.from(inlineData.data, 'base64'),
    mimeType: inlineData.mimeType ?? inlineData.mime_type ?? 'image/png',
  }
}

async function writeGeneratedImage({ bytes, output }) {
  const outputPath = publicPath(output)
  await mkdir(dirname(outputPath), { recursive: true })

  const tmpRoot = await mkdtemp(join(tmpdir(), 'pd-dark-variant-'))
  const tmpPath = join(tmpRoot, 'generated.png')
  await writeFile(tmpPath, bytes)

  try {
    if (extname(output).toLowerCase() === '.png') {
      await writeFile(outputPath, bytes)
      return
    }

    if (!commandExists('magick')) {
      throw new Error(`ImageMagick is required to convert Gemini PNG output to ${output}`)
    }

    const result = spawnSync('magick', [tmpPath, outputPath], { stdio: 'pipe' })
    if (result.status !== 0) {
      throw new Error(result.stderr.toString() || `ImageMagick failed converting ${output}`)
    }
  } finally {
    await rm(tmpRoot, { force: true, recursive: true })
  }
}

async function main() {
  loadEnvFile(resolve(projectRoot, '.env.local'))
  loadEnvFile(resolve(projectRoot, '.env'))
  loadEnvFile(resolve(websiteRoot, '.env.local'))
  loadEnvFile(resolve(websiteRoot, '.env'))

  const { force, limit, listOnly, selected, styleReference } = parseArgs(process.argv.slice(2))
  if (styleReference && !existsSync(publicPath(styleReference))) throw new Error(`Style reference not found: ${styleReference}`)

  let assets = collectImageAssets()
  if (selected.size) {
    assets = assets.filter(({ source }) => selected.has(source))
    const found = new Set(assets.map(({ source }) => source))
    const missing = [...selected].filter((asset) => !found.has(asset))
    if (missing.length) throw new Error(`Selected asset(s) not found in site literals: ${missing.join(', ')}`)
  }

  if (!force) assets = assets.filter(({ output }) => !existsSync(publicPath(output)))
  assets = assets.slice(0, limit)

  if (listOnly) {
    for (const asset of assets) console.log(`${asset.source} -> ${asset.output}`)
    return
  }

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is required. Put it in .env.local, website-v2/.env.local, or the shell environment.')
  }

  for (const asset of assets) {
    const aspectRatio = closestAspect(publicPath(asset.source))
    console.log(`Generating ${asset.output} from ${asset.source} (${aspectRatio}) with ${model}`)
    const image = await callGemini({ apiKey, source: asset.source, styleReference, aspectRatio })
    await writeGeneratedImage({ bytes: image.bytes, output: asset.output })
  }

  console.log(`Generated ${assets.length} dark variant(s).`)
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
