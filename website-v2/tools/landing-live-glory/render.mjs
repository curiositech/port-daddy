import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const sceneDir = path.dirname(__filename)
const websiteDir = path.resolve(sceneDir, '../..')
const repoDir = path.resolve(websiteDir, '..')
const outputDir = path.join(websiteDir, 'public/media/landing-live-glory')
const scenePath = path.join(sceneDir, 'scene.html')

const durationSeconds = 15.6
const framesPerSecond = 18
const width = 1280
const height = 720

function runPd(args) {
  try {
    return execFileSync('pd', args, {
      cwd: repoDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 7000,
    })
  } catch (error) {
    const stderr = error?.stderr?.toString?.() || error?.message || 'unknown pd failure'
    return `pd ${args.join(' ')} failed: ${stderr}`
  }
}

function parseStatus(output) {
  const getValue = (label) => {
    const line = output.split('\n').find((entry) => entry.trim().startsWith(`${label}:`))
    return line ? line.split(':').slice(1).join(':').trim() : ''
  }

  const fleet = getValue('Fleet')
  const activePorts = getValue('Active ports')
  const runtime = getValue('Runtime')
  const lastActivity = getValue('Last activity')
  const launchable = fleet.match(/(\d+\/\d+)\s+launchable/)?.[1] || ''

  return {
    activePorts: activePorts || '21',
    fleet: fleet || '1 project(s), many agent(s)',
    runtime: runtime || 'nominal',
    lastActivity: lastActivity || 'live daemon',
    launchable,
  }
}

function parseSessions(output) {
  return output
    .split('\n')
    .filter((line) => line.startsWith('session-'))
    .map((line) => {
      const withoutId = line.slice(44)
      const statusIndex = withoutId.search(/\s+active\s+/)
      const purpose = statusIndex >= 0 ? withoutId.slice(0, statusIndex) : withoutId
      return purpose.trim().replace(/\s+/g, ' ')
    })
    .filter(Boolean)
    .slice(0, 8)
}

function parseNotes(output) {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('[') && line.includes('] '))
    .map((line) => line.replace(/^\[[^\]]+\]\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 5)
}

function buildSnapshot() {
  const statusOutput = runPd(['status'])
  const sessionsOutput = runPd(['sessions', '--all-worktrees'])
  const notesOutput = runPd(['notes', '--limit', '20'])
  const sessions = parseSessions(sessionsOutput)

  return {
    generatedAt: new Date().toISOString(),
    status: parseStatus(statusOutput),
    sessions: sessions.length
      ? sessions
      : [
          'Landing live-glory video',
          'Add real recorded GIFs',
          'Move Templates under Agents',
          'Fleet agent: cartographer',
          'Agentic social proof',
          'Add example artwork',
          'MCP hero spacing',
          'Nano Banana imagery',
        ],
    notes: parseNotes(notesOutput),
  }
}

function runFfmpeg(args) {
  execFileSync('ffmpeg', args, { cwd: repoDir, stdio: 'inherit' })
}

async function renderTheme(theme, snapshot) {
  const tempDir = await mkdtemp(path.join(tmpdir(), `port-daddy-live-glory-${theme}-`))
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: 1,
  })

  const sceneUrl = `${pathToFileURL(scenePath).href}?theme=${theme}&manual=1`
  await page.goto(sceneUrl, { waitUntil: 'load' })
  await page.evaluate((data) => window.setSnapshot(data), snapshot)

  const frameCount = Math.round(durationSeconds * framesPerSecond)
  for (let frame = 0; frame <= frameCount; frame += 1) {
    const time = frame / framesPerSecond
    await page.evaluate((nextTime) => window.renderFrame(nextTime), time)
    await page.screenshot({
      path: path.join(tempDir, `frame-${String(frame).padStart(4, '0')}.png`),
      type: 'png',
      animations: 'disabled',
    })
  }

  await browser.close()

  const mp4Path = path.join(outputDir, `port-daddy-live-glory-${theme}.mp4`)
  const posterPath = path.join(outputDir, `port-daddy-live-glory-${theme}-poster.jpg`)
  const inputPattern = path.join(tempDir, 'frame-%04d.png')
  const posterFrame = path.join(tempDir, `frame-${String(Math.round(6.6 * framesPerSecond)).padStart(4, '0')}.png`)

  runFfmpeg([
    '-y',
    '-framerate',
    String(framesPerSecond),
    '-i',
    inputPattern,
    '-vf',
    'format=yuv420p',
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '24',
    '-movflags',
    '+faststart',
    mp4Path,
  ])

  runFfmpeg(['-y', '-i', posterFrame, '-frames:v', '1', '-update', '1', '-q:v', '3', posterPath])

  rmSync(tempDir, { recursive: true, force: true })
  return { mp4Path, posterPath }
}

async function main() {
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true })
  }

  const snapshot = buildSnapshot()
  writeFileSync(path.join(outputDir, 'snapshot.json'), `${JSON.stringify(snapshot, null, 2)}\n`)

  const light = await renderTheme('light', snapshot)
  const dark = await renderTheme('dark', snapshot)

  console.log('Rendered landing live-glory videos:')
  console.log(`- ${path.relative(repoDir, light.mp4Path)}`)
  console.log(`- ${path.relative(repoDir, dark.mp4Path)}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
