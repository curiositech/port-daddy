#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  encoding: 'utf8',
}).trim()
const headFull = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: repoRoot,
  encoding: 'utf8',
}).trim()
const headShort = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
  cwd: repoRoot,
  encoding: 'utf8',
}).trim()

function fail(message) {
  console.error(`proof-artifact-check: ${message}`)
  process.exit(1)
}

function readArtifactFile(dir, name) {
  const path = join(dir, name)
  if (!existsSync(path)) fail(`${dir} missing ${name}`)
  return readFileSync(path, 'utf8')
}

function readArtifactBytes(dir, name) {
  const path = join(dir, name)
  if (!existsSync(path)) fail(`${dir} missing ${name}`)
  const stats = statSync(path)
  if (!stats.isFile()) fail(`${dir}/${name} is not a file`)
  if (stats.size === 0) fail(`${dir}/${name} is empty`)
  return readFileSync(path)
}

function metadataFrom(markdown, fileLabel) {
  const match = markdown.match(/<!--\s*pd-console-proof-metadata\s*([\s\S]*?)\s*-->/)
  if (!match) fail(`${fileLabel} missing pd-console-proof-metadata JSON block`)
  try {
    return JSON.parse(match[1])
  } catch (error) {
    fail(`${fileLabel} has invalid pd-console-proof-metadata JSON: ${error.message}`)
  }
}

function visibleCommitFrom(markdown, fileLabel) {
  const match = markdown.match(/(?:^|\n)-?\s*Commit:\s*`([^`]+)`/)
  if (!match) fail(`${fileLabel} missing visible Commit field`)
  return match[1]
}

function markdownSection(markdown, heading) {
  const lines = markdown.split(/\r?\n/)
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`)
  if (start === -1) return ''
  const body = []
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('## ')) break
    body.push(line)
  }
  return body.join('\n')
}

function backtickItems(section, prefixPattern) {
  const items = []
  const itemPattern = /- `([^`]+)`/g
  let match
  while ((match = itemPattern.exec(section)) !== null) {
    if (!prefixPattern || prefixPattern.test(match[1])) items.push(match[1])
  }
  return items
}

function commandBlocks(markdown) {
  const blocks = []
  const blockPattern = /```(?:sh|bash)?\n([\s\S]*?)```/g
  let match
  while ((match = blockPattern.exec(markdown)) !== null) {
    blocks.push(match[1])
  }
  return blocks
}

function gitCommitExists(commit) {
  try {
    execFileSync('git', ['cat-file', '-e', `${commit}^{commit}`], { cwd: repoRoot })
    return true
  } catch {
    return false
  }
}

function gitIsAncestor(commit) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', commit, 'HEAD'], { cwd: repoRoot })
    return true
  } catch {
    return false
  }
}

function validateMetadataPair(dir) {
  const receipt = readArtifactFile(dir, 'RECEIPT.md')
  const manifest = readArtifactFile(dir, 'MANIFEST.md')
  const receiptMeta = metadataFrom(receipt, `${dir}/RECEIPT.md`)
  const manifestMeta = metadataFrom(manifest, `${dir}/MANIFEST.md`)

  for (const [label, meta, kind] of [
    ['RECEIPT.md', receiptMeta, 'receipt'],
    ['MANIFEST.md', manifestMeta, 'manifest'],
  ]) {
    if (meta.schema !== 'pd-console.visual-proof.v1') fail(`${dir}/${label} has unexpected schema`)
    if (meta.artifactKind !== kind) fail(`${dir}/${label} artifactKind is ${meta.artifactKind}, expected ${kind}`)
    if (meta.proofScope !== 'exact-window-harness-only') fail(`${dir}/${label} proofScope must be exact-window-harness-only`)
    if (meta.providerTranscriptE2E !== false) fail(`${dir}/${label} must not claim provider/transcript E2E proof`)
    if (!meta.captureCommit || !meta.captureCommitShort) fail(`${dir}/${label} missing captureCommit/captureCommitShort`)
    const visible = visibleCommitFrom(label === 'RECEIPT.md' ? receipt : manifest, `${dir}/${label}`)
    if (visible !== meta.captureCommitShort) {
      fail(`${dir}/${label} visible Commit ${visible} disagrees with metadata captureCommitShort ${meta.captureCommitShort}`)
    }
  }

  if (receiptMeta.captureCommit !== manifestMeta.captureCommit) fail(`${dir} receipt/manifest captureCommit mismatch`)
  if (receiptMeta.captureCommitShort !== manifestMeta.captureCommitShort) {
    fail(`${dir} receipt/manifest captureCommitShort mismatch`)
  }

  const capture = receiptMeta.captureCommit
  const captureShort = receiptMeta.captureCommitShort
  if (captureShort === headShort || capture === headFull) {
    return { mode: 'current-head', dryRun: Boolean(receiptMeta.dryRun) }
  }

  if (receiptMeta.captureCommitPolicy !== 'documented-capture-commit') {
    fail(`${dir} capture commit ${captureShort} is not HEAD ${headShort} and is not explicitly documented`)
  }
  if (!gitCommitExists(capture)) fail(`${dir} documented captureCommit ${capture} is not present in this repository`)
  if (!gitIsAncestor(capture)) fail(`${dir} documented captureCommit ${captureShort} is not an ancestor of HEAD ${headShort}`)
  return { mode: 'documented-capture-commit', dryRun: Boolean(receiptMeta.dryRun) }
}

function validateExactWindowReceipt(dir, receipt, dryRun) {
  const windowSection = markdownSection(receipt, 'Window IDs')
  if (/none recorded/i.test(windowSection)) fail(`${dir}/RECEIPT.md says no Window IDs were recorded`)

  if (!receipt.includes('screencapture -x -o -l"<windowid>"')) {
    fail(`${dir}/RECEIPT.md missing exact-window screencapture command`)
  }
  if (!receipt.includes('Window discovery is filtered by the launched process PID before capture.')) {
    fail(`${dir}/RECEIPT.md missing launched-PID window discovery claim`)
  }

  for (const block of commandBlocks(receipt)) {
    for (const line of block.split('\n').map((entry) => entry.trim()).filter(Boolean)) {
      if (line.startsWith('screencapture ') && !/\s-l("?<windowid>"?|\$?\{?[A-Za-z0-9_]+\}?|[0-9]+)/.test(line)) {
        fail(`${dir}/RECEIPT.md includes non-window screencapture command: ${line}`)
      }
      if (line.includes('--display-id')) fail(`${dir}/RECEIPT.md includes display-wide capture command: ${line}`)
    }
  }

  if (dryRun) {
    if (!receipt.includes('Dry-run receipt only')) fail(`${dir}/RECEIPT.md dry-run receipt must say no media was captured`)
    return
  }

  if (!/pane=[^`\s]+ pid=[0-9]+ window=[0-9]+/.test(windowSection)) {
    fail(`${dir}/RECEIPT.md missing concrete pane=<pane> pid=<pid> window=<windowid> evidence`)
  }
  if (!/Accepted video method: (sck-window|screencapture-window-frames)/.test(receipt)) {
    fail(`${dir}/RECEIPT.md missing accepted exact-window video method`)
  }
}

function pngDimensions(buffer, label) {
  if (buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') fail(`${label} is not a PNG file`)
  if (buffer.length < 24) fail(`${label} is too short to contain PNG dimensions`)
  const width = buffer.readUInt32BE(16)
  const height = buffer.readUInt32BE(20)
  if (width <= 0 || height <= 0) fail(`${label} has invalid PNG dimensions ${width}x${height}`)
  return { width, height }
}

function gifDimensions(buffer, label) {
  const header = buffer.subarray(0, 6).toString('ascii')
  if (header !== 'GIF87a' && header !== 'GIF89a') fail(`${label} is not a GIF file`)
  if (buffer.length < 10) fail(`${label} is too short to contain GIF dimensions`)
  const width = buffer.readUInt16LE(6)
  const height = buffer.readUInt16LE(8)
  if (width <= 0 || height <= 0) fail(`${label} has invalid GIF dimensions ${width}x${height}`)
  return { width, height }
}

function walkMp4Boxes(buffer, start, end, visitor, depth = 0) {
  let offset = start
  while (offset + 8 <= end) {
    const boxStart = offset
    let size = buffer.readUInt32BE(offset)
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii')
    offset += 8
    if (size === 1) {
      if (offset + 8 > end) return
      size = Number(buffer.readBigUInt64BE(offset))
      offset += 8
    } else if (size === 0) {
      size = end - boxStart
    }

    const boxEnd = boxStart + size
    if (size < offset - boxStart || boxEnd > end) return
    visitor({ type, dataStart: offset, end: boxEnd })

    if (depth < 8 && ['moov', 'trak', 'mdia', 'minf', 'stbl'].includes(type)) {
      walkMp4Boxes(buffer, offset, boxEnd, visitor, depth + 1)
    } else if (depth < 8 && type === 'stsd' && offset + 8 <= boxEnd) {
      walkMp4Boxes(buffer, offset + 8, boxEnd, visitor, depth + 1)
    }
    offset = boxEnd
  }
}

function mp4Dimensions(buffer, label) {
  if (buffer.length < 16) fail(`${label} is too short to be an MP4 file`)
  let hasFtyp = false
  let hasMoov = false
  const dimensions = []

  walkMp4Boxes(buffer, 0, buffer.length, (box) => {
    if (box.type === 'ftyp') hasFtyp = true
    if (box.type === 'moov') hasMoov = true
    if (box.type === 'tkhd') {
      const version = buffer[box.dataStart]
      const widthOffset = box.dataStart + (version === 1 ? 92 : 76)
      if (widthOffset + 8 <= box.end) {
        dimensions.push({
          width: buffer.readUInt32BE(widthOffset) / 65536,
          height: buffer.readUInt32BE(widthOffset + 4) / 65536,
        })
      }
    }
    if (['avc1', 'hvc1', 'hev1', 'mp4v'].includes(box.type) && box.dataStart + 32 <= box.end) {
      dimensions.push({
        width: buffer.readUInt16BE(box.dataStart + 24),
        height: buffer.readUInt16BE(box.dataStart + 26),
      })
    }
  })

  if (!hasFtyp) fail(`${label} missing MP4 ftyp box`)
  if (!hasMoov) fail(`${label} missing MP4 moov box`)
  const usable = dimensions.find((dim) => dim.width > 0 && dim.height > 0)
  if (!usable) fail(`${label} has no decodable MP4 dimensions`)
  return usable
}

function validateMediaDimensions(buffer, name, label) {
  if (name.endsWith('.png')) return pngDimensions(buffer, label)
  if (name.endsWith('.gif')) return gifDimensions(buffer, label)
  if (name.endsWith('.mp4') || name.endsWith('.mov')) return mp4Dimensions(buffer, label)
  fail(`${label} has unsupported proof media extension`)
}

function validateIntervention(dir) {
  const intervention = readArtifactFile(dir, 'OPERATOR-INTERVENTION.md')
  if (!intervention.includes('Capture stopped before broad capture.')) {
    fail(`${dir}/OPERATOR-INTERVENTION.md must say capture stopped before broad capture`)
  }
  if (!intervention.includes('No full-screen capture was attempted.')) {
    fail(`${dir}/OPERATOR-INTERVENTION.md must say no full-screen capture was attempted`)
  }
  if (!intervention.includes('proof-owned') || !intervention.includes('launched PID') || !intervention.includes('exact window ID')) {
    fail(`${dir}/OPERATOR-INTERVENTION.md missing exact-window safety evidence`)
  }
}

function validateRealArtifacts(dir, dryRun, receipt) {
  if (dryRun) return

  const artifactSection = markdownSection(receipt, 'Artifacts')
  const screenshotClaims = backtickItems(artifactSection, /^pane-.+\.png$/)
  const videoClaims = backtickItems(artifactSection, /^(proof|proof-window-fallback)\.(mov|mp4|gif)$/)
  if (screenshotClaims.length === 0) fail(`${dir}/RECEIPT.md claims no pane PNG artifacts`)
  if (!videoClaims.some((entry) => entry.endsWith('.mp4') || entry.endsWith('.mov'))) {
    fail(`${dir}/RECEIPT.md claims no MP4/MOV artifact`)
  }
  if (videoClaims.includes('proof-window-fallback.mp4') && !videoClaims.includes('proof-window-fallback.gif')) {
    fail(`${dir}/RECEIPT.md claims fallback MP4 without fallback GIF`)
  }

  const validated = new Map()
  for (const name of [...screenshotClaims, ...videoClaims]) {
    if (validated.has(name)) continue
    const buffer = readArtifactBytes(dir, name)
    const dimensions = validateMediaDimensions(buffer, name, `${dir}/${name}`)
    validated.set(name, dimensions)
  }

  const entries = new Set(readdirSync(dir))
  if (![...entries].some((entry) => /^pane-.+\.png$/.test(entry))) fail(`${dir} has no pane PNG artifact`)
  if (!entries.has('proof.mp4') && !entries.has('proof.mov') && !entries.has('proof-window-fallback.mp4')) {
    fail(`${dir} has no MP4/MOV artifact`)
  }
  if (entries.has('proof-window-fallback.mp4') && !entries.has('proof-window-fallback.gif')) {
    fail(`${dir} has fallback MP4 but no fallback GIF artifact`)
  }
}

const dirs = process.argv.slice(2)
if (dirs.length === 0) fail('usage: verify-artifacts.mjs <artifact-dir> [artifact-dir...]')

for (const dir of dirs) {
  if (existsSync(join(dir, 'OPERATOR-INTERVENTION.md')) && !existsSync(join(dir, 'RECEIPT.md'))) {
    validateIntervention(dir)
    console.log(`proof-artifact-check: ok ${dir} (operator-intervention)`)
    continue
  }
  const result = validateMetadataPair(dir)
  const receipt = readArtifactFile(dir, 'RECEIPT.md')
  validateExactWindowReceipt(dir, receipt, result.dryRun)
  validateRealArtifacts(dir, result.dryRun, receipt)
  console.log(`proof-artifact-check: ok ${dir} (${result.mode}${result.dryRun ? ', dry-run' : ''})`)
}
