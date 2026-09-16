/** Shared local census. No Git, hooks, HTML evaluation, network or model calls. */
import { createHash } from 'node:crypto'
import { constants, closeSync, fstatSync, lstatSync, openSync, opendirSync, readSync, realpathSync } from 'node:fs'
import { basename, extname, isAbsolute, relative, resolve, sep } from 'node:path'

export const DEFAULT_LIMITS = Object.freeze({ entries: 100000, files: 20000, fileBytes: 4 * 1024 * 1024, totalBytes: 256 * 1024 * 1024, depth: 80 })
export const TEXT_EXTENSIONS = Object.freeze(['.md', '.markdown', '.mdx', '.html', '.htm', '.json', '.yaml', '.yml', '.tex'])
export const EXCLUDED_DIRECTORIES = Object.freeze(['.git', '.cache', 'node_modules', 'target', 'dist', 'build', 'vendor', '.venv', 'venv', '__pycache__', '.port-daddy', '.portdaddy'])
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
const excluded = new Set(EXCLUDED_DIRECTORIES)
const privateName = (name) => /^\.env(?:\.|$)/iu.test(name) || /^(?:credentials|secrets|private-key)(?:\.|$)/iu.test(name)

export function inside(root, path) {
  const rel = relative(root, path)
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))
}

function checkedRoot(value) {
  const root = resolve(value)
  if (realpathSync(root) !== root || !lstatSync(root).isDirectory()) throw new Error('repository root must be a real directory without symlink components')
  return root
}

/** Reject links in every component, including an explicitly selected nested root. */
function checkedPath(root, path) {
  if (!inside(root, path)) throw new Error('outside-root')
  let current = root
  for (const part of relative(root, path).split(sep).filter(Boolean)) {
    current = resolve(current, part)
    if (lstatSync(current).isSymbolicLink()) throw new Error('symlink-not-followed')
  }
  if (realpathSync(path) !== path) throw new Error('symlink-not-followed')
}

/** A bounded descriptor read, with identity/change checks; not an atomic repo snapshot. */
export function readSource(rootValue, relativePath, maxBytes = DEFAULT_LIMITS.fileBytes, onReadBytes = () => {}) {
  const root = checkedRoot(rootValue)
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('invalid byte limit')
  if (typeof relativePath !== 'string' || isAbsolute(relativePath) || relativePath.split(/[\\/]/u).includes('..')) throw new Error('invalid relative source path')
  const path = resolve(root, relativePath)
  checkedPath(root, path)
  const before = lstatSync(path)
  if (!before.isFile()) throw new Error('not-regular-file')
  if (before.size > maxBytes) throw new Error('file-byte-limit')
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0))
  try {
    const opened = fstatSync(fd)
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) throw new Error('changed-during-read')
    const bytes = Buffer.alloc(Math.min(before.size + 1, maxBytes))
    let length = 0
    while (length < bytes.length) {
      const count = readSync(fd, bytes, length, bytes.length - length, null)
      if (count === 0) break
      length += count
      onReadBytes(count)
    }
    const after = fstatSync(fd)
    checkedPath(root, path)
    const named = lstatSync(path)
    if (length !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || named.dev !== after.dev || named.ino !== after.ino) throw new Error('changed-during-read')
    return bytes.subarray(0, length)
  } finally { closeSync(fd) }
}

export function scanArtifacts(repoRoot, corpus = [{ path: '.', kind: 'repository' }], options = {}) {
  const root = checkedRoot(repoRoot)
  const limits = { ...DEFAULT_LIMITS, ...options.limits }
  for (const [key, value] of Object.entries(limits)) {
    if (!Object.hasOwn(DEFAULT_LIMITS, key) || !Number.isSafeInteger(value) || value < 1 || value > DEFAULT_LIMITS[key]) throw new Error(`invalid limit: ${key}`)
  }
  if (!Array.isArray(corpus) || corpus.length === 0 || corpus.length > 1000) throw new Error('one to 1000 corpus roots required')
  for (const entry of corpus) {
    if (!entry || typeof entry.path !== 'string' || !entry.path || typeof entry.kind !== 'string' || !entry.kind || isAbsolute(entry.path) || entry.path.split(/[\\/]/u).includes('..')) throw new Error('invalid corpus root')
    if (entry.extensions && (!Array.isArray(entry.extensions) || entry.extensions.some((ext) => !TEXT_EXTENSIONS.includes(ext)))) throw new Error('unsupported extension declaration')
  }
  const ordered = [...corpus].sort((a, b) => compare(a.path, b.path) || compare(a.kind, b.kind))
  const artifacts = new Map()
  const skipped = []
  const visited = new Set()
  let entries = 0
  let bytesRead = 0
  let halted = false
  let truncated = false
  let incomplete = false
  let unsupportedFiles = 0
  const note = (path, reason) => {
    skipped.push({ path, reason })
    if (reason.includes('limit')) truncated = true
    else if (!['policy-excluded-directory', 'private-filename-excluded', 'symlink-not-followed'].includes(reason)) incomplete = true
  }
  const walk = (path, entry, depth) => {
    const name = relative(root, path).split(sep).join('/') || '.'
    if (halted) return
    if (++entries > limits.entries) { note(name, 'entry-limit-remaining-tree-unvisited'); halted = true; return }
    if (depth > limits.depth) { note(name, 'depth-limit'); return }
    try {
      if (relative(root, path).split(sep).some((part) => excluded.has(part))) { note(name, 'policy-excluded-directory'); return }
      checkedPath(root, path)
      const stat = lstatSync(path)
      if (stat.isDirectory()) {
        if (visited.has(name)) return
        visited.add(name)
        const dir = opendirSync(path)
        const children = []
        try {
          let child
          while ((child = dir.readSync()) !== null) {
            children.push(child.name)
            if (children.length > limits.entries - entries) { note(name, 'entry-limit-directory-not-scanned'); halted = true; return }
          }
        } finally { dir.closeSync() }
        for (const child of children.sort(compare)) walk(resolve(path, child), entry, depth + 1)
      } else if (stat.isFile()) {
        if (artifacts.has(name)) return
        if (privateName(basename(path))) { note(name, 'private-filename-excluded'); return }
        const extension = extname(path).toLowerCase()
        // The first traversal applies every matching root's filter, so overlapping
        // roots cannot silently hide a second root's files or provenance.
        const sources = ordered.filter((source) => inside(resolve(root, source.path), path) && (source.extensions ?? TEXT_EXTENSIONS).includes(extension))
        if (!sources.length) { unsupportedFiles += 1; return }
        if (artifacts.size >= limits.files) { note(name, 'file-limit-remaining-tree-unvisited'); halted = true; return }
        if (stat.size > limits.fileBytes) { note(name, 'file-byte-limit'); return }
        if (bytesRead + stat.size > limits.totalBytes) { note(name, 'total-byte-limit-remaining-tree-unvisited'); halted = true; return }
        const bytes = readSource(root, name, Math.min(limits.fileBytes, limits.totalBytes - bytesRead), (count) => { bytesRead += count })
        let text = null
        try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); if (text.includes('\0')) text = null } catch { /* preserved as a digest, not decoded text */ }
        const artifact = { path: name, kind: sources[0].kind, sources, format: basename(path).toLowerCase() === 'skill.md' ? 'skill' : ['.html', '.htm'].includes(extension) ? 'html' : ['.md', '.mdx', '.markdown'].includes(extension) ? 'markdown' : 'structured-text', bytes: bytes.length, sha256: digest(bytes), textReadable: text !== null }
        artifacts.set(name, { ...artifact, structuredStatusClaims: text !== null && options.extractClaims ? options.extractClaims(artifact, text) : [] })
        if (text === null) note(name, 'text-not-utf8-or-contains-nul')
      } else note(name, 'not-regular-file')
    } catch (error) {
      note(name, ['symlink-not-followed', 'outside-root', 'file-byte-limit', 'changed-during-read', 'not-regular-file'].includes(error.message) ? error.message : 'unreadable-or-missing')
    }
  }
  for (let index = 0; index < ordered.length; index += 1) {
    if (halted) { note(ordered[index].path, 'unvisited-root-after-limit'); continue }
    walk(resolve(root, ordered[index].path), ordered[index], 0)
  }
  const items = [...artifacts.values()].sort((a, b) => compare(a.path, b.path))
  const countsByKind = Object.create(null)
  const copies = new Map()
  for (const item of items) {
    countsByKind[item.kind] = (countsByKind[item.kind] ?? 0) + 1
    if (!copies.has(item.sha256)) copies.set(item.sha256, [])
    copies.get(item.sha256).push(item.path)
  }
  return {
    total: items.length, countsByKind, artifacts: items,
    exactCopies: [...copies.entries()].filter(([, paths]) => paths.length > 1).map(([sha256, paths]) => ({ sha256, paths, disposition: 'not-decided' })),
    skipped: skipped.sort((a, b) => compare(a.path, b.path) || compare(a.reason, b.reason)),
    coverage: { semanticReview: 'not-performed', traversal: truncated ? 'truncated' : incomplete ? 'incomplete' : 'completed-with-declared-exclusions', roots: ordered, limits, entries, bytesRead, unsupportedFiles, excludedDirectories: EXCLUDED_DIRECTORIES, gitignore: 'not-evaluated', atomicSnapshot: false },
  }
}

/** Preserve supplied native registry fields; no winner selection or authority promotion. */
export function readRegistryExport(repoRoot, path, adapter, maxBytes = DEFAULT_LIMITS.fileBytes, onReadBytes) {
  const bytes = readSource(repoRoot, path, maxBytes, onReadBytes)
  const rawExport = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
  const value = JSON.parse(rawExport.replace(/^\uFEFF/u, ''), (_key, field) => {
    if (typeof field === 'number' && (!Number.isFinite(field) || (Number.isInteger(field) && !Number.isSafeInteger(field)))) throw new Error('unsafe registry number; use string identities and revisions')
    return field
  })
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('registry export must be an object')
  let records
  let namespace
  if (adapter === 'harbor-snapshot') {
    if (typeof value.harbor !== 'string' || !value.harbor || !Array.isArray(value.items)) throw new Error('Harbor snapshot requires harbor and items')
    namespace = value.harbor
    records = value.items
    if (records.some((record) => !record || typeof record.slug !== 'string' || !record.slug)) throw new Error('Harbor snapshot item requires slug')
  } else if (adapter === 'registry-v1') {
    if (value.schemaVersion !== 1 || typeof value.namespace !== 'string' || !value.namespace || !Array.isArray(value.records)) throw new Error('registry-v1 requires schemaVersion, namespace and records')
    namespace = value.namespace
    records = value.records
    if (records.some((record) => !record || typeof record.id !== 'string' || !record.id)) throw new Error('registry-v1 record requires id')
  } else throw new Error('unknown registry adapter')
  if (records.length > 20000) throw new Error('registry-record-limit')
  return { adapter, path, bytes: bytes.length, sha256: digest(bytes), namespace, authority: 'unverified-export', recordCount: records.length, rawExport, nativeExport: value }
}
