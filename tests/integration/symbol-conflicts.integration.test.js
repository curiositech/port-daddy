/**
 * Daemon-level e2e for symbol-level conflict prediction, end to end over HTTP.
 *
 * Boots the real ephemeral daemon (globalSetup), parses a real file through the daemon's
 * own tree-sitter index, declares typed symbol claims for two sessions, and asserts the
 * full feature works through the API a real agent uses:
 *   - POST /symbols/parse populates the index (tree-sitter runs in the DAEMON process).
 *   - POST /sessions/:id/symbols with `modify` auto-reserves the blast radius.
 *   - a second session's conflicting claim comes back as a predicted conflict.
 *   - GET /symbols/blast-radius returns the reverse-dep closure.
 *
 * This is the kind of coverage only a daemon e2e gives — the unit tests injected fakes
 * for tree-sitter + the store; this exercises the real wiring across process boundaries.
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
  // registerRoutes CALLS createRoutes → a real dependency edge in the graph
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
  let s1;
  let s2;

  test('parses a real file through the daemon tree-sitter index', async () => {
    const res = await request('/symbols/parse', { method: 'POST', body: { files: [file] } });
    expect(res.ok).toBe(true);
    // the file's symbols are now queryable
    const got = await request(`/symbols/file/${encodeURIComponent(file)}`);
    const names = JSON.stringify(got.data);
    expect(names).toContain('createRoutes');
    expect(names).toContain('registerRoutes');
  }, 30000);

  test('blast-radius returns the reverse-dep closure (registerRoutes calls createRoutes)', async () => {
    const res = await request(`/symbols/blast-radius?file=${encodeURIComponent(file)}&symbol=createRoutes&depth=3`);
    expect(res.ok).toBe(true);
    const radius = JSON.stringify(res.data.radius ?? res.data);
    expect(radius).toContain('registerRoutes');
  });

  test('modify-claim auto-reserves the blast radius, and a conflicting claim is predicted', async () => {
    s1 = await newSession('refactor createRoutes', 'agent-1');
    const c1 = await request(`/sessions/${s1}/symbols`, {
      method: 'POST',
      body: { claims: [{ filePath: file, symbolPath: 'createRoutes', type: 'modify' }] },
    });
    expect(c1.ok).toBe(true);
    // auto-reserved read on registerRoutes (its caller)
    const auto = JSON.stringify(c1.data.autoDerived ?? []);
    expect(auto).toContain('registerRoutes');

    // second agent claims the same symbol → a direct conflict against s1
    s2 = await newSession('also touch createRoutes', 'agent-2');
    const c2 = await request(`/sessions/${s2}/symbols`, {
      method: 'POST',
      body: { claims: [{ filePath: file, symbolPath: 'createRoutes', type: 'modify' }] },
    });
    expect(c2.ok).toBe(true);
    expect(Array.isArray(c2.data.conflicts)).toBe(true);
    const direct = c2.data.conflicts.find((k) => k.type === 'direct');
    expect(direct).toBeDefined();
    expect(direct.otherSessionId).toBe(s1);
  }, 30000);
});
