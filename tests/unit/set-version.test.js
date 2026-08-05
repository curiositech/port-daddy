import { afterEach, beforeEach, describe, expect, test } from '@jest/globals'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { setPackageVersion } from '../../scripts/set-version.mjs'

const DURABLE_SCRATCH = join(homedir(), 'coding', 'tmp')
mkdirSync(DURABLE_SCRATCH, { recursive: true })

describe('set-version', () => {
  let root
  beforeEach(() => {
    root = mkdtempSync(join(DURABLE_SCRATCH, 'pd-set-version-'))
    writeFileSync(join(root, 'package.json'), '{"name":"port-daddy","version":"1.0.0"}\n')
    writeFileSync(join(root, 'package-lock.json'), '{"name":"port-daddy","version":"1.0.0","packages":{"":{"version":"1.0.0"}}}\n')
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  test('updates only the package and root lockfile version authorities', () => {
    expect(setPackageVersion(root, 'v3.28.0')).toBe('3.28.0')
    expect(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version).toBe('3.28.0')
    const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'))
    expect(lock.version).toBe('3.28.0')
    expect(lock.packages[''].version).toBe('3.28.0')
  })

  test('rejects ambiguous non-semver inputs', () => {
    expect(() => setPackageVersion(root, 'minor')).toThrow(/invalid semantic version/)
    expect(() => setPackageVersion(root, '3.28')).toThrow(/invalid semantic version/)
    expect(() => setPackageVersion(root, '03.28.0')).toThrow(/invalid semantic version/)
    expect(() => setPackageVersion(root, '3.28.0..rc')).toThrow(/invalid semantic version/)
  })
})
