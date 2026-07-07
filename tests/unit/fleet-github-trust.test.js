// tests/unit/fleet-github-trust.test.js
//
// Relay-laundering defense for the GitHub trigger (fleet-event-spawn-trust
// anti-pattern #1 / ADR-0093 invariant #1): consent_verified must reflect
// CONTENT-AUTHOR verification of THIS event (GitHub's origin HMAC re-proven),
// never the mere fact that a github webhook arrived. A forwarded event with a
// spoofed sender.login must NOT be able to reach AUTHENTICATED_EXTERNAL.

import { describe, expect, test } from '@jest/globals';

const { GitHubTriggerSource } = await import('../../lib/fleet/triggers/github.js');
const { classifyTrust } = await import('../../lib/fleet/trust.js');

/** Drive one webhook payload through the trigger and capture the emitted event. */
async function emitFor(payload) {
  let captured = null;
  let cb = null;
  const src = new GitHubTriggerSource({
    subscribe: (_channel, callback) => { cb = callback; return () => {}; },
  });
  await src.start({ kind: 'github', type: 'pull_request', filters: {} }, (e) => { captured = e; });
  cb(payload);
  return captured;
}

describe('GitHub trigger consent_verified — relay-laundering defense', () => {
  test('an ordinary forwarded event (no origin proof) is NOT consent_verified', async () => {
    const ev = await emitFor({ sender: { login: 'maintainer' }, repository: { full_name: 'o/r' } });
    expect(ev.metadata.consent_verified).toBe(false);
  });

  test('even an allowlisted sender stays ANONYMOUS_EXTERNAL without origin proof (no laundering)', async () => {
    const ev = await emitFor({ sender: { login: 'maintainer' }, repository: { full_name: 'o/r' } });
    const tier = classifyTrust(
      { source: 'github', metadata: ev.metadata },
      { allowlistedAuthors: ['maintainer'] },
    );
    // Allowlist alone must not upgrade — consent_verified is false.
    expect(tier).toBe('ANONYMOUS_EXTERNAL');
  });

  test('only a receiver-proven origin (__originVerified) may raise consent, and only WITH an allowlist', async () => {
    const ev = await emitFor({ sender: { login: 'maintainer' }, repository: { full_name: 'o/r' }, __originVerified: true });
    expect(ev.metadata.consent_verified).toBe(true);
    // With BOTH the origin proof AND the operator allowlist -> authenticated.
    expect(classifyTrust({ source: 'github', metadata: ev.metadata }, { allowlistedAuthors: ['maintainer'] }))
      .toBe('AUTHENTICATED_EXTERNAL');
    // Origin-proven but NOT allowlisted -> still anonymous (both required).
    expect(classifyTrust({ source: 'github', metadata: ev.metadata }, { allowlistedAuthors: [] }))
      .toBe('ANONYMOUS_EXTERNAL');
  });
});
