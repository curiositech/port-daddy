/**
 * Shared test helper: mint ADR-0040 daemon-minted actor credentials.
 *
 * #8877 / ADR-0122 made every attributed write boundary (sessions, notes,
 * file claims, locks, salvage, commitments, sugar done/relink) REQUIRE a
 * daemon-minted credential — a bare self-asserted agentId is rejected 401.
 * Tests that exercise those boundaries therefore need real credentials,
 * minted through the SAME souls store the daemon uses (lib/actor-souls.ts),
 * never through a parallel fixture mechanism. This is the one shared way to
 * get them; do not copy-paste mint logic into individual suites.
 */

import { createActorSouls } from '../../lib/actor-souls.js';

/**
 * Create a souls store bound to a test database (unit tests).
 *
 * @param {import('better-sqlite3').Database} db - The test SQLite handle
 *        (usually from tests/setup-unit.js createTestDb()).
 * @param {object} [config] - Optional ActorSoulsConfig overrides.
 * @returns The ADR-0040 souls store, suitable for route-plugin `actorSouls`
 *          deps and for minting test credentials.
 */
export function createTestActorSouls(db, config = {}) {
  return createActorSouls(db, config);
}

/**
 * Mint a credentialed test actor directly in a souls store (unit tests).
 *
 * @param {ReturnType<typeof createActorSouls>} souls - The souls store the
 *        route under test verifies against.
 * @param {string} [alias] - Display alias to bind (the agentId the test will
 *        assert on requests); omit for an anonymous principal.
 * @returns {{ actorId: string, credential: string, headers: Record<string, string> }}
 *          The minted principal, its plaintext credential, and ready-to-use
 *          request headers ({ 'x-actor-credential': credential }).
 */
export function mintTestActor(souls, alias) {
  const minted = souls.mint(alias ? { alias } : {});
  if (!minted || typeof minted.credential !== 'string' || !minted.credential) {
    throw new Error(`mintTestActor: souls.mint returned no credential${alias ? ` (alias "${alias}")` : ''}`);
  }
  return {
    actorId: minted.actorId,
    credential: minted.credential,
    headers: { 'x-actor-credential': minted.credential },
  };
}

/**
 * Register a credentialed actor over HTTP against a live daemon
 * (integration tests). Uses POST /actors/register — the public mint door —
 * so integration fixtures obtain credentials exactly the way real clients do.
 *
 * @param {string} baseUrl - The ephemeral daemon's base URL (no trailing slash).
 * @param {object} [options]
 * @param {string} [options.alias] - Display alias to bind to the minted soul.
 * @returns {Promise<{ actorId: string, credential: string, headers: Record<string, string> }>}
 */
/**
 * Register a credentialed actor through an integration suite's `request()`
 * helper (tests/helpers/integration-setup.js), which speaks over the
 * ephemeral daemon's Unix socket. Same mint door as {@link registerTestActor}.
 *
 * @param {(path: string, options?: object) => Promise<{ ok: boolean, status: number, data: any }>} request
 *        The suite's request helper.
 * @param {object} [options]
 * @param {string} [options.alias] - Display alias to bind to the minted soul.
 * @returns {Promise<{ actorId: string, credential: string, headers: Record<string, string> }>}
 */
export async function registerTestActorVia(request, options = {}) {
  const res = await request('/actors/register', {
    method: 'POST',
    body: { alias: options.alias },
  });
  if (!res.ok || !res.data?.credential) {
    throw new Error(`registerTestActorVia failed (${res.status}): ${JSON.stringify(res.data)}`);
  }
  return {
    actorId: res.data.actorId,
    credential: res.data.credential,
    headers: { 'x-actor-credential': res.data.credential },
  };
}

export async function registerTestActor(baseUrl, options = {}) {
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/actors/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      alias: options.alias,
    }),
  });
  const body = await res.json();
  if (!body.success || !body.credential) {
    throw new Error(`registerTestActor failed (${res.status}): ${JSON.stringify(body)}`);
  }
  return {
    actorId: body.actorId,
    credential: body.credential,
    headers: { 'x-actor-credential': body.credential },
  };
}
