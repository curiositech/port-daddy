import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const sourceRoot = new URL('../src', import.meta.url).pathname

const suspiciousPatterns = [
  /ERROR:/,
  /Traceback/,
  /syntax error/i,
  /command not found/i,
  /No such file/i,
  /Port Daddy is not running/,
  /Recorded from real local CLI commands/,
  /recorded with asciinema \+ agg from this checkout/i,
  /here-document/i,
  /Cannot read properties/i,
  /UnhandledPromiseRejection/i,
  /\/Users\/erichowens/,
]

function read(relativePath) {
  return readFileSync(join(root, relativePath), 'utf8')
}

function fail(message) {
  failures.push(message)
}

function extractQuotedValues(text, field) {
  const values = []
  const pattern = new RegExp(`${field}:\\s*['"]([^'"]+)['"]`, 'g')
  let match
  while ((match = pattern.exec(text))) values.push(match[1])
  return values
}

function assertGif(relativePath) {
  const absolute = join(root, relativePath.replace(/^\//, 'public/'))
  if (!existsSync(absolute)) {
    fail(`missing GIF: ${relativePath}`)
    return
  }
  const header = readFileSync(absolute).subarray(0, 6).toString('ascii')
  if (header !== 'GIF89a' && header !== 'GIF87a') {
    fail(`not a GIF file: ${relativePath}`)
  }
}

function assertCast(relativePath) {
  const absolute = join(root, relativePath.replace(/^\//, 'public/'))
  if (!existsSync(absolute)) {
    fail(`missing cast: ${relativePath}`)
    return
  }
  const text = readFileSync(absolute, 'utf8')
  for (const pattern of suspiciousPatterns) {
    if (pattern.test(text)) fail(`suspicious cast output (${pattern}): ${relativePath}`)
  }
}

function assertCastTree(relativeDir) {
  const absoluteDir = join(root, relativeDir)
  if (!existsSync(absoluteDir)) return
  for (const entry of readdirSync(absoluteDir, { withFileTypes: true })) {
    const child = join(relativeDir, entry.name)
    if (entry.isDirectory()) {
      assertCastTree(child)
    } else if (entry.name.endsWith('.cast')) {
      assertCast(`/${child.replace(/^public\//, '')}`)
    }
  }
}

const failures = []
const recordingSource = read('src/data/terminalRecordings.ts')
const tutorialSource = read('src/data/tutorials.ts')
const examplesSource = read('src/data/examples.ts')

const gifs = extractQuotedValues(recordingSource, 'gifSrc')
const casts = extractQuotedValues(recordingSource, 'castSrc')
const tutorialSlugs = extractQuotedValues(tutorialSource, 'slug')
const exampleSlugs = extractQuotedValues(examplesSource, 'slug')

for (const slug of tutorialSlugs) {
  assertGif(`/gifs/tutorials/${slug}.gif`)
  assertCast(`/casts/tutorials/${slug}.cast`)
}

for (const slug of exampleSlugs) {
  assertGif(`/gifs/examples/${slug}.gif`)
  assertCast(`/casts/examples/${slug}.cast`)
}

for (const gif of gifs) assertGif(gif)
for (const cast of casts) assertCast(cast)
assertCastTree('public/casts/agents')

const pagesWithManualCode = [
  ...tutorialSlugs.map((slug) => join(sourceRoot, `pages/tutorials/${slugToFile(slug)}.tsx`)),
  join(sourceRoot, 'pages/ExampleDetailPage.tsx'),
]

for (const page of pagesWithManualCode) {
  if (!existsSync(page)) continue
  const text = readFileSync(page, 'utf8')
  const hasCode = /CodeBlock|DocsCodeBlock|<code|language=["']bash["']|language=["']cli["']/.test(text)
  if (hasCode && !/TerminalGif|TutorialLayout|findTerminalRecording/.test(text)) {
    fail(`code-bearing page has no recording hook: ${page.replace(root, '')}`)
  }
}

if (failures.length) {
  console.error('terminal recording reviewer found problems:')
  for (const item of failures) console.error(`- ${item}`)
  process.exit(1)
}

console.log(`terminal recording reviewer passed: ${gifs.length} manifest GIFs, ${casts.length} manifest casts, ${tutorialSlugs.length} tutorials, ${exampleSlugs.length} examples`)

function slugToFile(slug) {
  const special = {
    dns: 'DNSResolver',
    'pd-spawn': 'Spawn',
    'multi-agent': 'MultiAgentOrchestration',
  }
  if (special[slug]) return special[slug]
  return slug
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}
