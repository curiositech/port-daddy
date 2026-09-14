#!/usr/bin/env node
/** Standalone source discovery. Inventory is not semantic reconciliation. */
import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { DEFAULT_LIMITS, scanArtifacts, readRegistryExport } from './artifact_inventory.mjs'

export const REGISTRY_BYTE_LIMIT = 16 * 1024 * 1024

export function buildInventory(repo, sourceId, roots = ['.'], registries = []) {
  if (typeof sourceId !== 'string' || !sourceId.trim() || sourceId.length > 300) throw new Error('a local source-id of 1–300 characters is required')
  if (!Array.isArray(registries) || registries.length > 100) throw new Error('at most 100 registry exports allowed')
  const exports = []
  const unavailable = []
  let registryBytes = 0
  for (const entry of registries) {
    try {
      const result = readRegistryExport(repo, entry.path, entry.adapter, Math.min(DEFAULT_LIMITS.fileBytes, REGISTRY_BYTE_LIMIT - registryBytes), (count) => { registryBytes += count })
      exports.push(result)
    }
    catch { unavailable.push({ ...entry, state: 'unavailable-or-invalid', meaning: 'not evidence of an empty registry' }) }
  }
  const inventory = scanArtifacts(repo, roots.map((path) => ({ path, kind: 'repository-source' })))
  const report = {
    schemaVersion: 1, kind: 'source-inventory', canonical: false, sourceId,
    safety: { network: false, subprocesses: false, models: false, htmlExecution: false, canonicalWrites: false },
    inventory, registries: { exports, unavailable, bytesRead: registryBytes, byteLimit: REGISTRY_BYTE_LIMIT, state: registries.length ? 'supplied-exports-only' : 'not-supplied' },
    limitations: [
      'Working-tree files only. Unselected branches, PRs, database shards, remote state and private conversations are not covered.',
      'Each digest binds bytes actually read; the collection is not an atomic Git snapshot or a verified registry read.',
      'Run against a quiescent trusted local tree. Path checks are not a sandbox against concurrent malicious filesystem changes.',
      'Exact copies retain every path. Equal bytes do not authorize deletion or prove interchangeable roles.',
      'No valuable-idea detection, semantic deduplication, contradiction judgment, authority verification or rewrite is performed.',
      'Source text is inert. HTML scripts, skill instructions, repository hooks and configuration are never executed.',
      'Reports contain private source names, digests and supplied registry records. Do not publish them without disclosure review.',
    ],
  }
  return { ...report, reportId: createHash('sha256').update(JSON.stringify(report)).digest('hex') }
}

const escape = (value) => String(value).replace(/[&<>"']/gu, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])).replace(/[\r\n\u0000-\u001f\u007f]/gu, ' ').replace(/[\\`*_[\]{}|!#]/gu, (c) => `\\${c}`)

export function renderInventory(report) {
  const formats = {}
  for (const artifact of report.inventory.artifacts) formats[artifact.format] = (formats[artifact.format] ?? 0) + 1
  return [
    '# Repository source inventory', '',
    'Generated local evidence, not a reconciled plan or permission to remove work.', '',
    `Source: ${escape(report.sourceId)}`, `Report: ${report.reportId}`, '',
    '## Coverage', '',
    `- ${report.inventory.total} artifacts: ${Object.entries(formats).map(([kind, count]) => `${count} ${kind}`).join(', ') || 'none'}.`,
    `- ${report.inventory.exactCopies.length} byte-identical groups; every source path is retained.`,
    `- Traversal: ${report.inventory.coverage.traversal}; semantic review: not performed.`,
    `- ${report.inventory.skipped.length} excluded/unavailable entries; ${report.inventory.coverage.unsupportedFiles} unsupported files.`,
    `- Registry: ${report.registries.exports.length} supplied exports, ${report.registries.unavailable.length} unavailable; ${report.registries.state}.`,
    '', '## Registry evidence', '',
    ...report.registries.exports.map((entry) => `- ${escape(entry.path)}: ${entry.recordCount} records in ${escape(entry.namespace)}; ${entry.authority}; ${entry.sha256}.`),
    ...report.registries.unavailable.map((entry) => `- ${escape(entry.path)}: unavailable or invalid, not an empty registry.`),
    '', '## Exact-copy groups — no removal decision', '',
    ...report.inventory.exactCopies.map((group) => `- ${group.sha256}: ${group.paths.map(escape).join('; ')}`),
    '', '## Exclusions and unreadable sources', '',
    ...report.inventory.skipped.map((entry) => `- ${escape(entry.path)}: ${escape(entry.reason)}`),
    '', '## What happens next', '',
    'Review sources for valuable capabilities; bind proposed claims to their digests; join registry identities without promoting exports to authority; preserve unique requirements before consolidation. Source discovery is only the first gate.',
    '', '## Limits', '', ...report.limitations.map((line) => `- ${line}`), '',
  ].join('\n')
}

export function runInventory(args, io = {}) {
  const stdout = io.stdout ?? ((text) => process.stdout.write(text))
  const stderr = io.stderr ?? ((text) => process.stderr.write(text))
  try {
    const options = { repo: io.cwd ?? process.cwd(), sourceId: null, roots: [], registries: [], format: 'markdown' }
    for (let index = 0; index < args.length; index += 1) {
      const arg = args[index]
      if (arg === '--help') { stdout('Usage: harbor-inventory --source-id <local-label> [--repo <directory>] [--root <relative-path>] [--harbor-snapshot <relative.json>] [--registry <relative.json>] [--format markdown|json]\nDefault: whole working-tree census to stdout. No files written, source text executed, or inference run. Registry exports are unverified evidence, not canonical state.\n'); return 0 }
      if (!['--repo', '--source-id', '--root', '--harbor-snapshot', '--registry', '--format'].includes(arg)) throw new Error(`unknown option: ${arg}`)
      const value = args[++index]
      if (!value || value.startsWith('--')) throw new Error(`missing value: ${arg}`)
      if (arg === '--root') options.roots.push(value)
      else if (arg === '--registry' || arg === '--harbor-snapshot') options.registries.push({ path: value, adapter: arg === '--registry' ? 'registry-v1' : 'harbor-snapshot' })
      else options[arg === '--source-id' ? 'sourceId' : arg.slice(2)] = value
    }
    if (!['markdown', 'json'].includes(options.format)) throw new Error('format must be markdown or json')
    const report = buildInventory(options.repo, options.sourceId, options.roots.length ? options.roots : ['.'], options.registries)
    stdout(options.format === 'json' ? `${JSON.stringify(report, null, 2)}\n` : renderInventory(report))
    return report.inventory.coverage.traversal !== 'completed-with-declared-exclusions' || report.registries.unavailable.length ? 2 : 0
  } catch (error) { stderr(`harbor-inventory: ${error.message}\n`); return 1 }
}

let direct = false
try { direct = Boolean(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url) } catch { /* importing module has no CLI path */ }
if (direct) process.exitCode = runInventory(process.argv.slice(2))
