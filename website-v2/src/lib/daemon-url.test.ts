import { describe, expect, it } from 'vitest'
import { buildDaemonUrl, resolveDaemonBaseUrl } from '@/lib/daemon-url'

describe('daemon url resolution', () => {
  it('prefers an explicit url when provided', () => {
    expect(resolveDaemonBaseUrl({ explicitUrl: 'http://127.0.0.1:9999/' })).toBe('http://127.0.0.1:9999')
  })

  it('prefers the daemon query param over env and fallback', () => {
    const location = {
      origin: 'http://localhost:3144',
      pathname: '/',
      search: '?daemon=http://127.0.0.1:9988',
    }

    expect(resolveDaemonBaseUrl({
      envUrl: 'http://127.0.0.1:7777',
      fallbackUrl: 'http://127.0.0.1:6666',
      location,
    })).toBe('http://127.0.0.1:9988')
  })

  it('uses same-origin when running inside the daemon-hosted fleet ui', () => {
    const location = {
      origin: 'http://127.0.0.1:4321',
      pathname: '/fleet-ui/',
      search: '',
    }

    expect(resolveDaemonBaseUrl({ location })).toBe('http://127.0.0.1:4321')
  })

  it('falls back to the canonical daemon base url for standalone browser shells', () => {
    const location = {
      origin: 'http://localhost:3144',
      pathname: '/',
      search: '',
    }

    expect(resolveDaemonBaseUrl({ location })).toBe('http://127.0.0.1:9876')
  })

  it('builds request urls against the resolved daemon base url', () => {
    const location = {
      origin: 'http://localhost:3144',
      pathname: '/',
      search: '?daemon=http://127.0.0.1:9988',
    }

    expect(buildDaemonUrl('/activity/subscribe', { location })).toBe('http://127.0.0.1:9988/activity/subscribe')
  })
})
