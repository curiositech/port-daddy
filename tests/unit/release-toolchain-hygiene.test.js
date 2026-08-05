import { describe, expect, test } from '@jest/globals'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('Homebrew-only release toolchain', () => {
  test('package metadata has no implicit version or registry-publish hooks', () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'))

    expect(pkg.scripts.preversion).toBeUndefined()
    expect(pkg.scripts.postversion).toBeUndefined()
    expect(pkg.scripts.prepublishOnly).toBeUndefined()
    expect(Object.values(pkg.scripts).filter((value) => /\bnpm (?:run|test|version|publish)\b/.test(String(value))))
      .toEqual([])
  })

  test('version repair guidance uses the explicit Bun synchronizer', () => {
    const sync = readFileSync(join(process.cwd(), 'scripts', 'sync-version.ts'), 'utf8')
    const drift = readFileSync(join(process.cwd(), 'scripts', 'check-version-drift.mjs'), 'utf8')

    expect(sync).toContain('Usage: bun scripts/sync-version.ts')
    expect(sync).not.toMatch(/npm version|npx tsx/)
    expect(drift).toContain('bun scripts/sync-version.ts')
    expect(drift).not.toContain('npx tsx scripts/sync-version.ts')
  })
})
