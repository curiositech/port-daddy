import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'

function read(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

describe('static endpoint discovery', () => {
  test('operator-facing content teaches endpoint discovery instead of hardcoded daemon URLs', () => {
    const staticContentFiles = [
      './data/hero-copy.ts',
      './docs-content/getStarted.ts',
      './data/integrations.ts',
      './data/product.ts',
    ]

    for (const file of staticContentFiles) {
      const source = read(file)

      // Static content should not teach users to hardcode localhost:9876 or 127.0.0.1:9876
      // Build the pattern dynamically to avoid having a literal URL in this test
      const localhostPort = 'localhost' + ':' + '9876'
      const loopbackPort = '127.0.0.1' + ':' + '9876'
      const httpLocalhostUrl = 'http://' + localhostPort
      const httpLoopbackUrl = 'http://' + loopbackPort

      expect(
        source,
        `${file} should not contain hardcoded daemon URL claims like "usually on localhost:9876"`,
      ).not.toMatch(/usually\s+(?:on\s+)?(?:localhost|127\.0\.0\.1):[0-9]{4}/)
      expect(source, `${file} should not contain bare ${httpLocalhostUrl} URLs`).not.toContain(httpLocalhostUrl)
      expect(source, `${file} should not contain bare ${httpLoopbackUrl} URLs`).not.toContain(httpLoopbackUrl)

      // Static content SHOULD teach discovery patterns
      // Note: Not all files will have all patterns, but at least they shouldn't have hardcoded URLs
    }

    // Verify the corrected patterns are present
    const heroCopy = read('./data/hero-copy.ts')
    expect(heroCopy, 'hero-copy.ts should mention endpoint publishing').toContain('publishes its endpoint')

    const getStarted = read('./docs-content/getStarted.ts')
    expect(getStarted, 'getStarted.ts should teach endpoint discovery').toContain('Discover the daemon endpoint')
    expect(getStarted, 'getStarted.ts should mention port file path').toContain('~/.port-daddy/daemon.port')
  })
})
