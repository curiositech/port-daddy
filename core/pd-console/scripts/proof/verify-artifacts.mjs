#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
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

function validateRealArtifacts(dir, dryRun) {
  if (dryRun) return
  const entries = new Set(readdirSync(dir))
  const hasPane = [...entries].some((entry) => /^pane-.+\.png$/.test(entry))
  const hasMp4 = entries.has('proof.mp4') || entries.has('proof-window-fallback.mp4')
  const hasGif = entries.has('proof.gif') || entries.has('proof-window-fallback.gif')
  if (!hasPane) fail(`${dir} has no pane PNG artifact`)
  if (!hasMp4) fail(`${dir} has no MP4 artifact`)
  if (!hasGif) fail(`${dir} has no GIF artifact`)
}

const dirs = process.argv.slice(2)
if (dirs.length === 0) fail('usage: verify-artifacts.mjs <artifact-dir> [artifact-dir...]')

for (const dir of dirs) {
  const result = validateMetadataPair(dir)
  validateRealArtifacts(dir, result.dryRun)
  console.log(`proof-artifact-check: ok ${dir} (${result.mode}${result.dryRun ? ', dry-run' : ''})`)
}
