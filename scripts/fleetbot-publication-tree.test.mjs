import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'
import { validatePublicationBaseTree, verifyPublicationSourceTree } from './fleetbot-workload.mjs'

// Git itself supplies the expected object identities, independently of the
// workload's tree encoder. These commands neither write objects nor run hooks.
function object(type, bytes) {
  return execFileSync('/usr/bin/git', ['-c', 'core.hooksPath=/dev/null', 'hash-object', '-t', type, '--stdin'], {
    input: bytes, encoding: 'utf8', env: { PATH: '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
  }).trim()
}
const blob = text => object('blob', Buffer.from(text))
const tree = rows => object('tree', Buffer.concat(rows.map(([mode, name, sha]) => Buffer.concat([Buffer.from(`${mode} ${name}\0`), Buffer.from(sha, 'hex')]))))
const change = (path, content, mode = '100644') => ({ path, mode, contentBase64: Buffer.from(content).toString('base64') })
function publication(changes, sourceTreeSha) {
  return {
    schema: 'port-daddy.fleetbot-publication.v1', repository: 'curiositech/port-daddy', sourceBranch: 'codex/tree-proof',
    payload: { baseBranch: 'main', baseSha: '1'.repeat(40), sourceHeadSha: '2'.repeat(40), sourceTreeSha,
      sourceCommittedAt: 1_700_000_000, commitMessage: 'tree proof', title: 'Tree proof', body: 'Roadmap-Item: fixture', draft: false, changes },
  }
}
function baseFixture() {
  const a = blob('original\n'); const stable = blob('preserved\n'); const gone = blob('remove\n')
  const folder = tree([['100644', 'a.txt', a]])
  const sha = tree([['40000', 'folder', folder], ['100644', 'gone.txt', gone], ['100644', 'stable:colon.txt', stable]])
  return { sha, a, stable, data: { sha, truncated: false, tree: [
    { path: 'folder', mode: '040000', type: 'tree', sha: folder },
    { path: 'folder/a.txt', mode: '100644', type: 'blob', sha: a },
    { path: 'gone.txt', mode: '100644', type: 'blob', sha: gone },
    { path: 'stable:colon.txt', mode: '100644', type: 'blob', sha: stable },
  ] } }
}

test('complete base and expanded source agree with Git for modes, symlinks, deletions and unchanged unusual paths', () => {
  const base = baseFixture()
  const entries = validatePublicationBaseTree(base.data, base.sha)
  const folder = tree([['100755', 'a.txt', blob('changed\n')]])
  const source = tree([['40000', 'folder', folder], ['120000', 'link', blob('folder/a.txt')], ['100644', 'stable:colon.txt', base.stable]])
  const value = publication([{ path: 'gone.txt', delete: true }, change('folder/a.txt', 'changed\n', '100755'), change('link', 'folder/a.txt', '120000')], source)
  assert.doesNotThrow(() => verifyPublicationSourceTree(value, entries))
  assert.equal(entries.get('folder/a.txt').sha, base.a, 'verification must not mutate its admitted base')
  assert.throws(() => verifyPublicationSourceTree({ ...value, payload: { ...value.payload, sourceTreeSha: 'f'.repeat(40) } }, entries), /approved source tree/)
})

test('truncated, forged, duplicate and parentless base trees fail before reconstruction', () => {
  const base = baseFixture()
  assert.throws(() => validatePublicationBaseTree({ ...base.data, truncated: true }, base.sha), /complete exact/)
  assert.throws(() => validatePublicationBaseTree({ ...base.data, tree: [...base.data.tree, base.data.tree[0]] }, base.sha), /duplicate/)
  assert.throws(() => validatePublicationBaseTree({ ...base.data, tree: base.data.tree.slice(1) }, base.sha), /parent/)
  const forged = structuredClone(base.data); forged.tree[1].sha = 'f'.repeat(40)
  assert.throws(() => validatePublicationBaseTree(forged, base.sha), /object hash/)
})

test('file-directory conversions reconstruct in deletion-first order and path collisions fail', () => {
  const base = baseFixture(); const entries = validatePublicationBaseTree(base.data, base.sha)
  const source = tree([['100644', 'folder', blob('now a file\n')], ['100644', 'gone.txt', blob('remove\n')], ['100644', 'stable:colon.txt', base.stable]])
  assert.doesNotThrow(() => verifyPublicationSourceTree(publication([change('folder', 'now a file\n'), { path: 'folder/a.txt', delete: true }], source), entries))
  assert.throws(() => verifyPublicationSourceTree(publication([change('folder', 'conflict')], source), entries), /directory or submodule/)
  assert.throws(() => verifyPublicationSourceTree(publication([{ path: 'absent', delete: true }], source), entries), /existing base blob/)
})
