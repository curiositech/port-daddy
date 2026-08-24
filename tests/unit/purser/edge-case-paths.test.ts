// tests/unit/purser/edge-case-paths.test.ts
import { describe, it, expect } from '@jest/globals';
import {
  makeParleyDb,
  makeParleyEnv,
  seedDock,
  worker,
  req,
  ALICE_SESSION,
} from '../../helpers';

/**
 * Wrapper that fetches a parley path with a test session.
 */
async function fetchParley(env: any, path: string) {
  return worker.fetch(req(path, { session: ALICE_SESSION }), env, {} as any);
}

/**
 * Asserts that two responses are identical in status, body, and the subset of
 * headers that define the 404 surface guarantees.
 */
async function assert404Consistent(
  actual: Response,
  reference: Response,
  referenceBody: string
) {
  expect(actual.status).toBe(404);
  const actualBody = await actual.text();
  expect(actualBody).toBe(referenceBody);

  // Header keys that must match exactly
  const keys = [
    'Cache-Control',
    'X-Robots-Tag',
    'Content-Security-Policy',
    'Content-Type',
  ];

  for (const key of keys) {
    expect(actual.headers.get(key)).toBe(reference.headers.get(key));
  }
}

describe('parley path 404 consistency', () => {
  const fx = makeParleyDb();
  const env = makeParleyEnv(fx.db);

  beforeAll(async () => {
    await seedDock(env);
  });

  // Reference 404: a well‑formed but non‑existent parley.
  let reference: Response;
  let referenceBody: string;
  beforeAll(async () => {
    reference = await fetchParley(env, '/account/parleys/alice/ghost');
    referenceBody = await reference.text();
    expect(reference.status).toBe(404);
  });

  it('malformed percent-escape yields a 404, not a 500', async () => {
    const resp = await fetchParley(env, '/account/parleys/%ZZ/dock');
    await assert404Consistent(resp, reference, referenceBody);
    // Ensure the body does not contain the internal error marker
    expect(await resp.text()).not.toMatch(/INTERNAL_ERROR/);
  });

  it('missing ID segment yields a 404', async () => {
    const resp = await fetchParley(env, '/account/parleys/alice');
    await assert404Consistent(resp, reference, referenceBody);
  });

  it('too many segments yields a 404', async () => {
    const resp = await fetchParley(env, '/account/parleys/alice/ghost/extra');
    await assert404Consistent(resp, reference, referenceBody);
  });

  it('empty namespace segment yields a 404', async () => {
    const resp = await fetchParley(env, '/account/parleys//ghost');
    await assert404Consistent(resp, reference, referenceBody);
  });

  it('trailing slash on a missing parley yields a 404', async () => {
    const resp = await fetchParley(env, '/account/parleys/alice/ghost/');
    // The trailing slash is stripped by the router, so this should still be a 404
    await assert404Consistent(resp, reference, referenceBody);
  });
});