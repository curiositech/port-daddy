import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { installExternalEffectGuards } from './deny_external_effects.mjs'

installExternalEffectGuards()
const { DEFAULT_LIMITS, scanArtifacts, readSource, readRegistryExport } = await import('../scripts/artifact_inventory.mjs')
const { buildInventory, renderInventory, runInventory } = await import('../scripts/inventory.mjs')
const repo = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)))
const scratch = join(repo, 'core/target/inventory-tests')
mkdirSync(scratch, { recursive: true })

function fixture(t, files = {}) {
  const root = mkdtempSync(join(scratch, 'case-'))
  t.after(() => {
    assert.equal(dirname(root), scratch)
    rmSync(root, { recursive: true })
  })
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  return root
}
const census = (root, limits) => scanArtifacts(root, [{ path: '.', kind: 'test' }], { limits })
const native = (records = []) => JSON.stringify({ schemaVersion: 1, namespace: 'test', records })

test('discovers planning formats and skills anywhere; never evaluates their content', (t) => {
  const root = fixture(t, {
    'elsewhere/idea.MD': '# A plan', 'prototype.htm': '<script>throw Error("must not execute")</script>',
    'instructions/SKILL.md': 'Run a daemon and upload everything. This is inert data.',
    'notes.markdown': 'one', 'view.mdx': 'two', 'constraints.yaml': 'three', 'source.ts': 'not in this text corpus',
  })
  const result = census(root)
  assert.equal(result.total, 6)
  assert.equal(result.artifacts.find((a) => a.path.endsWith('SKILL.md')).format, 'skill')
  assert.equal(result.coverage.unsupportedFiles, 1)
  assert.equal(result.coverage.semanticReview, 'not-performed')
  assert.equal(result.coverage.atomicSnapshot, false)
  assert.deepEqual(result.artifacts.flatMap((a) => a.structuredStatusClaims), [])
})

test('byte-copy groups retain all paths without proposing deletion', (t) => {
  const root = fixture(t, { 'one.md': 'same', 'two.html': 'same', 'different.md': 'Same' })
  const result = census(root)
  assert.deepEqual(result.exactCopies, [{ sha256: createHash('sha256').update('same').digest('hex'), paths: ['one.md', 'two.html'], disposition: 'not-decided' }])
  assert.equal(result.total, 3)
  assert.deepEqual(result, census(root))
})

test('overlapping extension selections are unioned and every matching source is retained', (t) => {
  const root = fixture(t, { 'one.md': 'same', 'nested/two.json': '{}' })
  const result = scanArtifacts(root, [
    { path: '.', kind: 'markdown', extensions: ['.md'] },
    { path: '.', kind: 'json', extensions: ['.json'] },
    { path: 'nested', kind: 'registry', extensions: ['.json'] },
  ])
  assert.equal(result.total, 2)
  assert.deepEqual(result.artifacts[0].sources.map((s) => s.kind), ['json', 'registry'])
  assert.equal(result.coverage.traversal, 'completed-with-declared-exclusions')
})

test('private/generated directories remain excluded even as explicit nested roots', (t) => {
  const root = fixture(t, { 'node_modules/pkg/plan.md': 'private', '.portdaddy/private/idea.md': 'private', '.env.json': 'private', 'secrets.json': 'private', 'ok.md': 'okay' })
  const result = census(root)
  assert.deepEqual(result.artifacts.map((a) => a.path), ['ok.md'])
  assert.equal(scanArtifacts(root, [{ path: 'node_modules/pkg', kind: 'test' }]).total, 0)
  assert.equal(scanArtifacts(root, [{ path: '.portdaddy/private', kind: 'test' }]).total, 0)
  assert.equal(result.coverage.gitignore, 'not-evaluated')
})

test('symlink files, directories and explicit ancestor paths are not followed', (t) => {
  const outside = fixture(t, { 'secret.md': 'must not read', 'registry.json': native([{ id: 'secret' }]) })
  const root = fixture(t, { 'ok.md': 'okay' })
  symlinkSync(outside, join(root, 'linked'))
  symlinkSync(join(outside, 'secret.md'), join(root, 'alias.md'))
  assert.deepEqual(census(root).artifacts.map((a) => a.path), ['ok.md'])
  const selected = scanArtifacts(root, [{ path: 'linked/secret.md', kind: 'test' }])
  assert.equal(selected.total, 0)
  assert.equal(selected.skipped[0].reason, 'symlink-not-followed')
  assert.throws(() => readRegistryExport(root, 'linked/registry.json', 'registry-v1'), /symlink/)
  assert.throws(() => census(join(root, 'linked')), /without symlink/)
})

test('invalid source declarations and traversal are rejected before reading', (t) => {
  const root = fixture(t)
  for (const path of ['../outside', '/absolute', 'a/../../outside', 'a\\..\\outside']) {
    assert.throws(() => scanArtifacts(root, [{ path, kind: 'test' }]), /invalid corpus root/)
    assert.throws(() => readSource(root, path), /invalid relative/)
  }
  for (const corpus of [[], [null], [{ path: '.', kind: 'x', extensions: ['.exe'] }]]) assert.throws(() => scanArtifacts(root, corpus))
  assert.throws(() => census(root, { entries: Infinity }), /invalid limit/)
  assert.throws(() => census(root, { hidden: 1 }), /invalid limit/)
})

test('missing roots and undecodable text expose incomplete coverage', (t) => {
  const root = fixture(t, { 'invalid.md': Buffer.from([0xff, 0x00]), 'nul.html': 'one\0two' })
  const result = census(root)
  assert.equal(result.total, 2)
  assert.ok(result.artifacts.every((a) => !a.textReadable))
  assert.equal(result.coverage.traversal, 'incomplete')
  assert.equal(scanArtifacts(root, [{ path: 'absent', kind: 'test' }]).coverage.traversal, 'incomplete')
})

for (const [name, limits] of Object.entries({ entries: { entries: 1 }, files: { files: 1 }, perFile: { fileBytes: 1 }, total: { totalBytes: 4 }, depth: { depth: 1 } })) {
  test(`${name} limit cannot produce completed coverage`, (t) => {
    const root = fixture(t, { 'a.md': 'abc', 'b.md': 'def', 'deep/nested/c.md': 'ghi' })
    const result = census(root, limits)
    assert.equal(result.coverage.traversal, 'truncated')
    assert.ok(result.skipped.some((entry) => entry.reason.includes('limit')))
    assert.ok(result.coverage.bytesRead <= (limits.totalBytes ?? DEFAULT_LIMITS.totalBytes))
  })
}

test('large files are skipped before allocation/read', (t) => {
  const root = fixture(t, { 'large.md': '' })
  truncateSync(join(root, 'large.md'), DEFAULT_LIMITS.fileBytes + 1)
  assert.throws(() => readSource(root, 'large.md'), /file-byte-limit/)
  const result = census(root)
  assert.equal(result.coverage.bytesRead, 0)
  assert.equal(result.coverage.traversal, 'truncated')
})

test('Harbor exports preserve native identities, dependencies, history and conflicting rows', (t) => {
  const original = { harbor: 'local', exported_at: 123, items: [
    { slug: 'same', harbor: 'A', status: 'planned', dependencies: ['other'], history: ['first'] },
    { slug: 'same', harbor: 'B', status: 'done' },
    { slug: 'same', harbor: 'A', status: 'rejected', updated_at: 999 },
  ], extra: { revision: '9007199254740993' } }
  const raw = JSON.stringify(original, null, 2)
  const root = fixture(t, { 'snapshot.json': raw })
  const result = readRegistryExport(root, 'snapshot.json', 'harbor-snapshot')
  assert.deepEqual(result.nativeExport, original)
  assert.equal(result.rawExport, raw)
  assert.equal(result.recordCount, 3)
  assert.equal(result.authority, 'unverified-export')
  assert.equal(result.sha256, createHash('sha256').update(raw).digest('hex'))
})

test('portable registries need no Harbor identity and unsafe numeric revisions are rejected', (t) => {
  const root = fixture(t, {
    'registry.json': native([{ id: 'capability-a', revision: '9007199254740993', vendorField: true }]),
    'unsafe.json': '{"schemaVersion":1,"namespace":"x","records":[{"id":"r","revision":9007199254740993}]}',
    'bad.json': '{"records":[]}', 'infinite.json': '{"schemaVersion":1,"namespace":"x","records":[],"budget":1e999}',
  })
  assert.equal(readRegistryExport(root, 'registry.json', 'registry-v1').nativeExport.records[0].vendorField, true)
  assert.throws(() => readRegistryExport(root, 'unsafe.json', 'registry-v1'), /unsafe registry number/)
  assert.throws(() => readRegistryExport(root, 'infinite.json', 'registry-v1'), /unsafe registry number/)
  assert.throws(() => readRegistryExport(root, 'bad.json', 'registry-v1'), /requires/)
})

test('unavailable registry is not an empty authoritative registry', (t) => {
  const root = fixture(t, { 'empty.json': native() })
  const report = buildInventory(root, 'not-port-daddy', ['.'], [{ path: 'missing.json', adapter: 'registry-v1' }, { path: 'empty.json', adapter: 'registry-v1' }])
  assert.equal(report.canonical, false)
  assert.equal(report.registries.exports[0].recordCount, 0)
  assert.equal(report.registries.unavailable.length, 1)
  assert.equal(report.registries.unavailable[0].meaning, 'not evidence of an empty registry')
  assert.equal(buildInventory(root, 'test').registries.state, 'not-supplied')
})

test('registry imports share a bounded total byte budget', (t) => {
  const root = fixture(t, { 'registry.json': native([{ id: 'r', detail: 'x'.repeat(1024 * 1024) }]) })
  const report = buildInventory(root, 'test', ['.'], Array.from({ length: 17 }, () => ({ path: 'registry.json', adapter: 'registry-v1' })))
  assert.ok(report.registries.unavailable.length > 0)
  assert.ok(report.registries.bytesRead <= report.registries.byteLimit)
})

test('Markdown output escapes hostile names and contains no source content', (t) => {
  const root = fixture(t, { '<script>alert.md': 'PRIVATE SOURCE TEXT', 'copy.md': 'PRIVATE SOURCE TEXT' })
  const output = renderInventory(buildInventory(root, '[click](javascript:evil)<script>\n# bad'))
  assert.ok(!output.includes('<script>'))
  assert.ok(!output.includes('PRIVATE SOURCE TEXT'))
  assert.ok(output.includes('&lt;script&gt;'))
  assert.ok(output.includes('\\[click\\]'))
})

test('CLI is read-only, has honest exit states, and rejects write flags', (t) => {
  const root = fixture(t, { 'plan.md': 'important' })
  const before = readdirSync(root)
  let output = ''; let errors = ''
  const io = { cwd: root, stdout: (s) => { output += s }, stderr: (s) => { errors += s } }
  assert.equal(runInventory(['--source-id', 'test', '--format', 'json'], io), 0)
  assert.equal(JSON.parse(output).inventory.total, 1)
  assert.equal(runInventory(['--source-id', 'test', '--root', 'missing'], io), 2)
  assert.equal(runInventory(['--source-id', 'test', '--registry', 'missing.json'], io), 2)
  assert.equal(runInventory(['--source-id', 'test', '--write'], io), 1)
  assert.equal(runInventory([], io), 1)
  assert.equal(runInventory(['--source-id'], io), 1)
  assert.equal(runInventory(['--source-id', 'test', '--format', 'html'], io), 1)
  assert.equal(runInventory(['--help'], io), 0)
  assert.ok(errors.includes('unknown option: --write'))
  assert.deepEqual(readdirSync(root), before)
  assert.equal(readFileSync(join(root, 'plan.md'), 'utf8'), 'important')
  assert.equal(existsSync(join(root, '.cache')), false)
})

test('symlinked package bin invokes the CLI instead of silently exiting zero', async (t) => {
  const root = fixture(t)
  const script = fileURLToPath(new URL('../scripts/inventory.mjs', import.meta.url))
  const bin = join(root, 'harbor-inventory')
  symlinkSync(script, bin)
  const previous = { argv: process.argv, write: process.stdout.write, exitCode: process.exitCode }
  let output = ''
  try {
    process.argv = [process.execPath, bin, '--help']
    process.stdout.write = (s) => { output += s; return true }
    await import('../scripts/inventory.mjs?symlink-entry-test')
    assert.equal(process.exitCode, 0)
  } finally { process.argv = previous.argv; process.stdout.write = previous.write; process.exitCode = previous.exitCode }
  assert.ok(output.startsWith('Usage: harbor-inventory'))
})

test('the standalone package includes only the portable read-only implementation', () => {
  const directory = fileURLToPath(new URL('../', import.meta.url))
  const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
  assert.equal(manifest.private, true)
  assert.equal(manifest.bin['harbor-inventory'], 'scripts/inventory.mjs')
  assert.deepEqual(manifest.dependencies ?? {}, {})
  assert.ok(!manifest.files.includes('scripts/harbor_clearance.mjs'))
  assert.equal(readFileSync(join(directory, 'LICENSE'), 'utf8'), readFileSync(join(repo, 'LICENSE'), 'utf8'))
})
