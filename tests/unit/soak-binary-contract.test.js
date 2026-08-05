import { describe, expect, test } from '@jest/globals'
import { readFileSync } from 'node:fs'

describe('packaged daemon soak endpoint discovery', () => {
  test('discovers the daemon-published port instead of reserving a fixed one', () => {
    const script = readFileSync('scripts/soak-binary.sh', 'utf8')
    expect(script).toContain('PORT_FILE="$SOAK_PREFIX/daemon.port"')
    expect(script).toContain('SOAK_PORT="$candidate"')
    expect(script).toContain('daemon published an invalid port')
    expect(script).not.toContain('PORT_DADDY_PORT=')
    expect(script).not.toMatch(/SOAK_PORT="\$\{SOAK_PORT:-\d+\}"/)
  })
})
