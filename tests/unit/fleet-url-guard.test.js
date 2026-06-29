// tests/unit/fleet-url-guard.test.js
//
// SSRF guard (lib/fleet/url-guard.ts) for outbound webhook sinks (ADR-0093).
// Each block is a red-team SSRF bypass vector that the merged webhook.ts had
// NO defense against. These are the regression tests for that CRITICAL.

const guard = await import('../../lib/fleet/url-guard.js');
const { assertSafeOutboundUrl, isBlockedHost, parseIpv4Maybe, SsrfBlockedError } = guard;

describe('parseIpv4Maybe — obfuscated IP literal forms', () => {
  test('dotted quad', () => {
    expect(parseIpv4Maybe('169.254.169.254')).toBe(((169 << 24) | (254 << 16) | (169 << 8) | 254) >>> 0);
  });
  test('decimal form (169.254.169.254 == 2852039166)', () => {
    expect(parseIpv4Maybe('2852039166')).toBe(2852039166);
  });
  test('octal form', () => {
    expect(parseIpv4Maybe('0177.0.0.1')).toBe(parseIpv4Maybe('127.0.0.1'));
  });
  test('hex form', () => {
    expect(parseIpv4Maybe('0x7f000001')).toBe(parseIpv4Maybe('127.0.0.1'));
  });
  test('non-IP hostnames → null', () => {
    expect(parseIpv4Maybe('example.com')).toBeNull();
    expect(parseIpv4Maybe('')).toBeNull();
  });
});

describe('isBlockedHost — SSRF-class targets', () => {
  const blocked = [
    'localhost', 'foo.localhost',
    '127.0.0.1', '127.1', '0.0.0.0', '0',
    '10.0.0.5', '192.168.1.1', '172.16.0.1', '172.31.255.255',
    '169.254.169.254',           // AWS/GCP/Azure metadata
    '2852039166',                // decimal 169.254.169.254
    '0177.0.0.1', '0x7f000001',  // octal / hex loopback
    '100.64.0.1',                // CGNAT
    '[::1]', '[::ffff:127.0.0.1]', '[fe80::1]', '[fc00::1]',
    'metadata', 'svc.internal',
  ];
  for (const h of blocked) {
    test(`blocks ${h}`, () => expect(isBlockedHost(h)).toBe(true));
  }

  const allowed = ['example.com', 'api.github.com', 'hooks.slack.com', '8.8.8.8', '1.1.1.1'];
  for (const h of allowed) {
    test(`permits public ${h}`, () => expect(isBlockedHost(h)).toBe(false));
  }
});

describe('assertSafeOutboundUrl — the guard webhook.ts calls', () => {
  // ATTACK: cloud-metadata exfiltration
  test('defeats metadata-exfil: blocks 169.254.169.254', () => {
    expect(() => assertSafeOutboundUrl('http://169.254.169.254/latest/meta-data/iam/security-credentials')).toThrow(SsrfBlockedError);
  });
  test('defeats decimal-IP bypass', () => {
    expect(() => assertSafeOutboundUrl('http://2852039166/')).toThrow(SsrfBlockedError);
  });
  test('defeats loopback service access', () => {
    expect(() => assertSafeOutboundUrl('http://127.0.0.1:6379/')).toThrow(SsrfBlockedError);
    expect(() => assertSafeOutboundUrl('http://[::1]:8080/internal')).toThrow(SsrfBlockedError);
  });
  test('blocks private ranges', () => {
    expect(() => assertSafeOutboundUrl('http://10.1.2.3/')).toThrow(SsrfBlockedError);
    expect(() => assertSafeOutboundUrl('http://192.168.0.1/')).toThrow(SsrfBlockedError);
  });
  test('blocks non-http(s) schemes and embedded credentials', () => {
    expect(() => assertSafeOutboundUrl('file:///etc/passwd')).toThrow(SsrfBlockedError);
    expect(() => assertSafeOutboundUrl('gopher://example.com/')).toThrow(SsrfBlockedError);
    expect(() => assertSafeOutboundUrl('http://user:pass@example.com/')).toThrow(SsrfBlockedError);
  });
  test('permits a normal public https webhook', () => {
    const u = assertSafeOutboundUrl('https://hooks.slack.com/services/T/B/x');
    expect(u.hostname).toBe('hooks.slack.com');
  });
  test('allowlist mode: only listed hosts pass', () => {
    expect(() => assertSafeOutboundUrl('https://evil.com/', { allowlist: ['hooks.slack.com'] })).toThrow(SsrfBlockedError);
    expect(assertSafeOutboundUrl('https://hooks.slack.com/x', { allowlist: ['hooks.slack.com'] }).hostname).toBe('hooks.slack.com');
  });
  test('allowlist cannot re-permit a private IP literal', () => {
    expect(() => assertSafeOutboundUrl('http://127.0.0.1/', { allowlist: ['127.0.0.1'] })).toThrow(SsrfBlockedError);
  });
});
