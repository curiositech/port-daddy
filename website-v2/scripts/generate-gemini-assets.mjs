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
const model = process.env.GEMINI_IMAGE_MODEL ?? 'gemini-2.5-flash-image'
const jpegQuality = '82'
const webpQuality = '82'

const sharedDirection = `
Port Daddy visual identity direction:
- Subject: local-first AI agent coordination, daemon runtime, ports, locks, sessions, notes, salvage, budget gates, and recovery flows.
- Visual language: Swiss-modern editorial infrastructure diagram, precise grid, crisp thin rules, architectural drawing discipline, tactile paper grain, deep ink, technical blue, restrained lime, quiet warm off-white.
- Must not include people, sailors, boats, harbors, docks, nautical costumes, mascots, emojis, fake testimonials, readable brand logos, glossy stock-photo styling, bubbly extruded SaaS UI, pill-heavy dashboards, purple-blue gradients, or random surrealism.
- Do not render visible words, letters, numbers, labels, headings, UI copy, brand marks, or fake code. Use abstract ticks, short lines, and geometric marks only.
- If a module would normally need a label, leave it blank or represent it with non-letter geometric marks only. No Latin alphabet, pseudo text, interface labels, captions, chart labels, axis labels, or legible symbols anywhere.
- Make it feel premium, serious, current, and operational.
`.trim()

const sharedExampleDirection = `
Port Daddy example artwork direction:
- Subject: runnable local-first developer tools built on Port Daddy: browser buttons, terminal agents, test failures, editor selections, webhooks, locks, inboxes, CI services, and swarm topology traces.
- Visual language: colorful Nano Banana editorial image, slightly photo-real and collage-like, tactile objects on a precise Swiss-modern grid, photographed paper cutouts, real desk materials, crisp shadows, cinematic product lighting, technical blue, signal green, coral, amber, and deep ink.
- Make every image obviously about the specific example idea. Use recognizable objects and scenes, not generic abstract diagrams.
- Do not include people, faces, hands, mascots, nautical objects, fake logos, product brand logos, readable words, readable code, captions, labels, numbers, or UI copy. If screens appear, make the marks abstract and illegible.
- Avoid purple-blue gradient mush, bubbly SaaS clay, random surrealism, and icon-only illustrations. These should feel like photographed engineering artifacts and high-end editorial collages.
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
    id: 'virtual-actor-fleet',
    filename: 'virtual-actor-fleet.jpg',
    aspectRatio: '16:9',
    imageSize: '2K',
    prompt: `
${sharedDirection}

Create a hero image for a website page explaining Port Daddy agents.
Composition: an abstract Swiss-modern system map with three clear horizontal bands. Top band: stable geometric cores with mailbox-like glyphs for durable virtual actor identities. Middle band: smaller active modules attached to those cores for temporary live body leases. Bottom band: trigger lanes, budget gates, and short mission paths for repo fleets and one-off sorties.
Include many distinct role nodes as unlabeled glyphs only: map, claim, docs, budget, validation, failure, repair, idea, connection, and fleet-architecture motifs. Use icons, blocks, ticks, lines, gates, and small abstract symbols instead of any typography.
Leave a calm negative-space band on the left third for page copy. Use hard ink rules, restrained technical blue, quiet warm paper, one lime accent, precise alignment, and high legibility.
Absolutely no visible language: no words, no labels, no headings, no captions, no letters, no numbers, no fake code, no typographic marks. No portraits, no people, no cartoon robots, no nautical objects, no fake UI screenshots, no mascot art.
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
  {
    id: 'example-pd-tube-button-to-agent',
    filename: 'example-pd-tube-button-to-agent.jpg',
    aspectRatio: '16:9',
    imageSize: '1K',
    prompt: `
${sharedExampleDirection}

Create artwork for an executable example called "Build a button-to-agent loop with PD Tube".
Scene: a tactile localhost control button on a workbench is connected by a glowing translucent message tube to an open terminal window on a developer workstation. Small reply cards travel back through the same tube. The button should feel physical and clickable; the terminal should be recognizable but contain only abstract unreadable marks.
Composition: dynamic diagonal from button to terminal, rich color accents, paper collage layers, shallow depth of field, crisp shadows, premium editorial product photography.
No visible words, letters, numbers, brand logos, people, hands, faces, nautical objects, or readable UI.
`.trim(),
  },
  {
    id: 'example-test-failure-to-agent',
    filename: 'example-test-failure-to-agent.jpg',
    aspectRatio: '16:9',
    imageSize: '1K',
    prompt: `
${sharedExampleDirection}

Create artwork for an executable example called "Build a test reporter that asks the agent for help".
Scene: a red failed-test signal lamp, a crumpled terminal printout with unreadable red and white marks, and a small diagnostic relay cable leading into an agent terminal module. Make it clear that a failed test has become a structured work request.
Composition: close-up collage on a dark desk, red failure light balanced with blue-green repair signals, realistic paper texture, small glass magnifier, tight engineering mood.
No readable text, words, code, numbers, people, hands, logos, or cartoon robots.
`.trim(),
  },
  {
    id: 'example-editor-lightbulb-to-agent',
    filename: 'example-editor-lightbulb-to-agent.jpg',
    aspectRatio: '16:9',
    imageSize: '1K',
    prompt: `
${sharedExampleDirection}

Create artwork for an executable example called "Build an editor lightbulb that asks the local agent".
Scene: a code editor window represented by abstract unreadable line blocks, a bright yellow lightbulb command hovering beside a highlighted selection, and a cable or beam carrying the selection into a local terminal-agent module.
Composition: colorful but precise editorial collage, paper cutout editor panels, warm light from the bulb, blue selection glow, clean grid, tactile desk surface.
No readable words, letters, numbers, actual code, product logos, people, hands, or faces.
`.trim(),
  },
  {
    id: 'example-webhook-to-local-agent',
    filename: 'example-webhook-to-local-agent.jpg',
    aspectRatio: '16:9',
    imageSize: '1K',
    prompt: `
${sharedExampleDirection}

Create artwork for an executable example called "Build a webhook adapter backed by your workstation".
Scene: a local workstation acting like a compact switchboard. Generic colored incoming webhook cards from chat, issue tracker, and bot systems plug into a localhost adapter box, then route into a terminal-agent module.
Composition: collage of cables, colored cards, tiny server box, desk switchboard, strong depth and shadows, obviously local and developer-tool oriented.
No readable words, letters, numbers, brand logos such as Slack, Discord, Linear, GitHub, people, faces, hands, or fake UI text.
`.trim(),
  },
  {
    id: 'example-leader-election',
    filename: 'example-leader-election.jpg',
    aspectRatio: '16:9',
    imageSize: '1K',
    prompt: `
${sharedExampleDirection}

Create artwork for an executable example called "Elect one leader from a local agent swarm".
Scene: several identical small agent modules on a tabletop race toward a single brass lock and coordinator token. Exactly one module is lit signal green and holds the lock; the others are paused as followers.
Composition: photoreal miniature engineering diorama, colorful wires, strict grid shadows, dramatic but clear single-winner focus, no anthropomorphic characters.
No readable text, numbers, letters, people, hands, faces, logos, crowns with writing, nautical objects, or cartoon robots.
`.trim(),
  },
  {
    id: 'example-p2p-webrtc',
    filename: 'example-p2p-webrtc.jpg',
    aspectRatio: '16:9',
    imageSize: '1K',
    prompt: `
${sharedExampleDirection}

Create artwork for an executable example called "Build WebRTC signaling over agent inboxes".
Scene: two local agent terminals exchange small envelope-like signaling packets through durable inbox trays, then a brighter direct peer-to-peer beam connects them above the inbox path. Make offer-answer-rendezvous legible through objects, not text.
Composition: split-screen desk collage, two machines, two inbox trays, colored packet cards, one direct luminous connection, technical and precise.
No readable words, code, letters, numbers, brand logos, people, hands, faces, or cartoon robots.
`.trim(),
  },
  {
    id: 'example-ephemeral-ci-db',
    filename: 'example-ephemeral-ci-db.jpg',
    aspectRatio: '16:9',
    imageSize: '1K',
    prompt: `
${sharedExampleDirection}

Create artwork for an executable example called "Claim a collision-free port for an ephemeral CI database".
Scene: a temporary database container on a CI workbench plugs into one clean colored port socket while other nearby port sockets stay unoccupied. The database should feel like a portable test service with a stable cable label shape but no readable label.
Composition: photoreal technical collage, miniature container, database cylinder, clean cable routing, amber and green status lights, local testing bench.
No Docker logo, Postgres logo, readable text, letters, numbers, code, people, hands, faces, or fake UI.
`.trim(),
  },
  {
    id: 'example-agent-archetypes',
    filename: 'example-agent-archetypes.jpg',
    aspectRatio: '16:9',
    imageSize: '1K',
    prompt: `
${sharedExampleDirection}

Create artwork for an executable example called "Publish an agent topology trace".
Scene: a tabletop pinboard or wallboard showing three physical topology models: a star network, a ring handoff loop, and an arbiter gate. Colored thread and small event cards show messages moving between agent nodes.
Composition: high-end editorial collage, bright colored pins, paper layers, precise geometric topology, obvious event traces, crisp shadows.
No readable words, labels, letters, numbers, people, hands, faces, logos, nautical objects, or cartoon robots.
`.trim(),
  },
  {
    id: 'blog-control-plane-product',
    filename: 'blog-control-plane-product.jpg',
    aspectRatio: '16:9',
    imageSize: '1K',
    prompt: `
${sharedDirection}

Create a textless blog hero image about a local developer control plane as the product.
Composition: a strict Swiss editorial diagram of a local control plane. Show project lanes, activity blocks, readiness gates, budget checks, and an operator viewport as rectilinear modules on a precise grid.
Leave the left edge calm enough for cropping. Use hard ink rules, technical blue, restrained lime, and warm paper texture.
No visible words, numbers, letters, labels, logos, humans, mascots, rounded app cards, or nautical imagery.
`.trim(),
  },
  {
    id: 'blog-fleet-designer-cold-start',
    filename: 'blog-fleet-designer-cold-start.jpg',
    aspectRatio: '16:9',
    imageSize: '1K',
    prompt: `
${sharedDirection}

Create a textless blog hero image about cold-start fleet design.
Composition: a repo survey matrix turning into a proposed fleet plan through dependency checks, model tiers, budget gates, dry-run simulation lanes, and a human approval checkpoint. Keep everything abstract and geometric, with no readable UI.
No visible words, numbers, letters, labels, logos, humans, mascots, rounded cards, or nautical imagery.
`.trim(),
  },
  {
    id: 'blog-pd-tube-event-reply',
    filename: 'blog-pd-tube-event-reply.jpg',
    aspectRatio: '16:9',
    imageSize: '1K',
    prompt: `
${sharedDirection}

Create a textless blog hero image about a local event-reply loop.
Composition: a browser action block, a test result block, an editor-selection block, and a webhook block feeding a single local event channel. Show an agent terminal module returning threaded replies back to each origin. Use abstract linework only.
No visible words, numbers, letters, labels, logos, humans, mascots, speech bubbles, rounded cards, or nautical imagery.
`.trim(),
  },
  {
    id: 'blog-telemetry-launch-gate',
    filename: 'blog-telemetry-launch-gate.jpg',
    aspectRatio: '16:9',
    imageSize: '1K',
    prompt: `
${sharedDirection}

Create a textless blog hero image about fail-closed agent launches.
Composition: several backend lanes pass through three square checkpoints representing exact tokens, model rate, and persisted cost before reaching a launch boundary. Blocked lanes should be visually clear without using text.
No visible words, numbers, letters, labels, logos, humans, mascots, security theater, rounded cards, or nautical imagery.
`.trim(),
  },
  {
    id: 'blog-map-truth',
    filename: 'blog-map-truth.jpg',
    aspectRatio: '16:9',
    imageSize: '1K',
    prompt: `
${sharedDirection}

Create a textless blog hero image about keeping roadmap and recovery state honest.
Composition: commit fragments, recovery notes, session traces, current status lanes, and evidence markers converge into a single operator-readable map. Make the composition sober, editorial, and evidence-driven.
No visible words, numbers, letters, labels, logos, humans, mascots, rounded cards, or nautical imagery.
`.trim(),
  },
  {
    id: 'blog-daemon-provenance',
    filename: 'blog-daemon-provenance.jpg',
    aspectRatio: '16:9',
    imageSize: '1K',
    prompt: `
${sharedDirection}

Create a textless blog hero image about daemon provenance.
Composition: compare source checkout, installed runtime, socket client, TCP route, supervisor state, and browser bundle freshness as aligned technical strata. Show agreement and disagreement through crisp geometric marks, not text.
No visible words, numbers, letters, labels, logos, humans, mascots, rounded cards, or nautical imagery.
`.trim(),
  },
  {
    id: 'blog-backend-readiness',
    filename: 'blog-backend-readiness.jpg',
    aspectRatio: '16:9',
    imageSize: '1K',
    prompt: `
${sharedDirection}

Create a textless blog hero image about backend readiness.
Composition: a matrix of model backends, credentials, SDK packages, CLI login checks, model tiers, and telemetry policy. Some cells pass, some are blocked, all represented with abstract squares, ticks, and ruled lines.
No visible words, numbers, letters, labels, logos, humans, mascots, rounded cards, or nautical imagery.
`.trim(),
  },
  {
    id: 'blog-coordination-guard-policy',
    filename: 'blog-coordination-guard-policy.jpg',
    aspectRatio: '16:9',
    imageSize: '1K',
    prompt: `
${sharedDirection}

Create a textless blog hero image about turning coordination claims into commit policy.
Composition: staged file blocks, session identity, file-claim boundaries, lock gates, and a pre-commit decision boundary arranged as a Swiss compliance diagram. The image should feel precise and enforceable.
No visible words, numbers, letters, labels, logos, humans, mascots, rounded cards, or nautical imagery.
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
