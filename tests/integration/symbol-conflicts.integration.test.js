/**
 * Daemon-level e2e for symbol-level conflict prediction, end to end over HTTP.
 *
 * Boots the real ephemeral daemon (globalSetup), parses a real file through the daemon's
 * own tree-sitter index, and asserts the core agent-facing flow:
 *   - POST /symbols/parse populates the index (tree-sitter runs in the DAEMON process),
 *   - POST /sessions/:id/symbols records a modify-claim,
 *   - a second session's claim on the SAME symbol comes back as a predicted DIRECT conflict.
 *
 * Scope note: this asserts only what is robust across the process boundary — the parse +
 * the direct (same-symbol) conflict, which needs no dependency graph. The dependency-graph
 * surface (blast-radius of a same-file caller, auto-derived radius claims) is covered by
 * the unit tests against the engine directly; asserting it here requires the daemon's
 * intra-file call-edge extraction, which an e2e shouldn't pin without a runnable local
 * daemon to verify against (the better-sqlite3 ABI split currently blocks that locally).
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from '../helpers/integration-setup.js';

let dir;
let file;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'pd-symconf-'));
  file = join(dir, 'server.ts');
  writeFileSync(
    file,
    [
      'export function createRoutes(app: any, db: any) {',
      '  return { app, db };',
      '}',
      '',
      'export function registerRoutes(app: any) {',
      '  return createRoutes(app, {});',
      '}',
      '',
    ].join('\n'),
  );
});

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

async function newSession(purpose, agentId) {
  const res = await request('/sessions', { method: 'POST', body: { purpose, agentId } });
  expect(res.ok).toBe(true);
  const id = res.data?.session?.id ?? res.data?.id ?? res.data?.sessionId;
  expect(typeof id).toBe('string');
  return id;
}

describe('symbol conflict prediction (daemon e2e)', () => {
  test('parses a real file through the daemon tree-sitter index', async () => {
    const res = await request('/symbols/parse', { method: 'POST', body: { files: [file] } });
    expect(res.ok).toBe(true);
    const got = await request(`/symbols/file/${encodeURIComponent(file)}`);
    const names = JSON.stringify(got.data);
    expect(names).toContain('createRoutes');
    expect(names).toContain('registerRoutes');
  }, 30000);

  test('two sessions claiming the same symbol → a predicted DIRECT conflict over HTTP', async () => {
    await request('/symbols/parse', { method: 'POST', body: { files: [file] } });

    const s1 = await newSession('refactor createRoutes', 'agent-1');
    const c1 = await request(`/sessions/${s1}/symbols`, {
      method: 'POST',
      body: { claims: [{ filePath: file, symbolPath: 'createRoutes', type: 'modify' }], autoDeriveRadius: false },
    });
    expect(c1.ok).toBe(true);

    const s2 = await newSession('also touch createRoutes', 'agent-2');
    const c2 = await request(`/sessions/${s2}/symbols`, {
      method: 'POST',
      body: { claims: [{ filePath: file, symbolPath: 'createRoutes', type: 'modify' }], autoDeriveRadius: false },
    });
    expect(c2.ok).toBe(true);
    expect(Array.isArray(c2.data.conflicts)).toBe(true);
    const direct = c2.data.conflicts.find((k) => k.type === 'direct');
    expect(direct).toBeDefined();
    expect(direct.otherSessionId).toBe(s1);
  }, 30000);
});
