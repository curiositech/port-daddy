import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const docsRoots = [
  'src/pages/docs',
  'src/components/docs',
  'src/docs-content',
  'src/data/docs.ts',
  'src/data/referenceCatalog.ts',
]

const fileExtensions = new Set(['.ts', '.tsx'])
const commandPattern = /\b(?:\$ )?(?:pd|port-daddy|curl|npm|git)\s+[a-z]/m
const outputHints = [
  /output\s*=/,
  /verifyOutput\s*:/,
  /^Output:/m,
  /^Expected result:/im,
  /^SUCCESS:/m,
  /^ERROR:/m,
  /^INFO:/m,
  /^Port Daddy /m,
  /^Session /m,
  /^Agent /m,
  /^Found \d+/m,
  /^Claimed /m,
  /^Released /m,
  /^spawned[-\w]*/m,
]

function walk(target) {
  const absolute = path.join(root, target)
  if (!fs.existsSync(absolute)) return []
  const stat = fs.statSync(absolute)
  if (stat.isFile()) return fileExtensions.has(path.extname(absolute)) ? [absolute] : []
  return fs.readdirSync(absolute).flatMap((entry) => walk(path.join(target, entry)))
}

function rel(file) {
  return path.relative(root, file)
}

function countMatches(source, regex) {
  return [...source.matchAll(regex)].length
}

const files = docsRoots.flatMap(walk).sort()
const findings = []

for (const file of files) {
  const source = fs.readFileSync(file, 'utf8')
  const relative = rel(file)
  const legacyImports = [
    ["components/ui/Surface", /@\/components\/ui\/Surface/],
    ["components/ui/Badge", /@\/components\/ui\/Badge/],
    ["components/ui/CodeBlock", /@\/components\/ui\/CodeBlock/],
    ["lucide-react", /from 'lucide-react'|from "lucide-react"/],
  ].filter(([, regex]) => regex.test(source))

  if (legacyImports.length) {
    findings.push({
      file: relative,
      kind: 'legacy-import',
      detail: legacyImports.map(([name]) => name).join(', '),
    })
  }

  const visualDrift = countMatches(source, /\brounded(?:-[a-z0-9[\]()/.]+)?\b|\bshadow(?:-[a-z0-9[\]()/.]+)?\b|bg-gradient-to-/g)
  if (visualDrift) {
    findings.push({
      file: relative,
      kind: 'visual-drift',
      detail: `${visualDrift} rounded/shadow/gradient token(s)`,
    })
  }

  const docsBlocks = [...source.matchAll(/<DocsCodeBlock\b([\s\S]*?)\/>|<DocsCodeBlock\b([\s\S]*?)>[\s\S]*?<\/DocsCodeBlock>/g)]
  for (const [index, match] of docsBlocks.entries()) {
    const block = match[0]
    if (commandPattern.test(block) && !outputHints.some((hint) => hint.test(block))) {
      findings.push({
        file: relative,
        kind: 'command-without-output',
        detail: `DocsCodeBlock ${index + 1}`,
      })
    }
  }

  const uiCodeBlocks = [...source.matchAll(/<CodeBlock\b[^>]*language=["']bash["'][\s\S]*?<\/CodeBlock>/g)]
  for (const [index, match] of uiCodeBlocks.entries()) {
    const block = match[0]
    if (commandPattern.test(block) && !outputHints.some((hint) => hint.test(block))) {
      findings.push({
        file: relative,
        kind: 'legacy-command-block-without-output',
        detail: `CodeBlock ${index + 1}`,
      })
    }
  }
}

const byKind = findings.reduce((acc, finding) => {
  acc[finding.kind] = (acc[finding.kind] ?? 0) + 1
  return acc
}, {})

console.log(`Docs crawl scanned ${files.length} files.`)
console.log(`Findings: ${findings.length}`)
for (const [kind, count] of Object.entries(byKind)) {
  console.log(`- ${kind}: ${count}`)
}

if (findings.length) {
  console.log('\nTop findings:')
  for (const finding of findings.slice(0, 80)) {
    console.log(`- ${finding.file}: ${finding.kind} (${finding.detail})`)
  }
  if (findings.length > 80) {
    console.log(`... ${findings.length - 80} more`)
  }
}
