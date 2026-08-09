/**
 * Daemon-level e2e for symbol-level conflict prediction, end to end over HTTP.
 *
 * Boots the real ephemeral daemon (globalSetup), parses a real file through the daemon's
 * own tree-sitter index, and asserts the core agent-facing flow:
 *   - POST /symbols/parse populates the index (tree-sitter runs in the DAEMON process),
 *   - POST /sessions/:id/symbols records a modify-claim,
 *   - a second session's claim on the SAME symbol comes back as a predicted DIRECT conflict.
 *
 * Scope note: asserts the parse, the direct (same-symbol) conflict, AND the
 * dependency-graph surface — blast-radius over a same-file caller. The
 * blast-radius assertion was previously dropped because intra-file `calls` edges
 * weren't being extracted at all (parseFile produced imports/heritage only), so
 * the daemon returned an empty radius (issue #468). Now that `extractCallEdges`
 * populates `calls` edges, the radius is deterministic across the process
 * boundary (parse is awaited before the query), so it's safe to pin here. The
 * engine-level cases stay covered in tests/unit/symbol-index.test.ts +
 * blast-radius.test.ts.
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
    // ast-a2-1: Claim validator now rejects blocking conflicts (409 instead of advisory).
    // Two sessions both modifying the same symbol = direct blocking conflict.
    expect(c2.ok).toBe(false);
    expect(c2.status).toBe(409);
    expect(c2.data.code).toBe('BLOCKING_CONFLICT');
    expect(Array.isArray(c2.data.conflicts)).toBe(true);
    const direct = c2.data.conflicts.find((k) => k.type === 'direct');
    expect(direct).toBeDefined();
    expect(direct.otherSessionId).toBe(s1);
  }, 30000);

  test('blast-radius returns the same-file caller over HTTP (issue #468)', async () => {
    // registerRoutes calls createRoutes (see the fixture), so changing
    // createRoutes can break registerRoutes — its reverse-dependency closure.
    await request('/symbols/parse', { method: 'POST', body: { files: [file] } });

    const res = await request(
      `/symbols/blast-radius?file=${encodeURIComponent(file)}&symbol=createRoutes&depth=3`,
    );
    expect(res.ok).toBe(true);
    const radius = res.data?.radius ?? [];
    const callers = radius.map((n) => n.symbolPath);
    expect(callers).toContain('registerRoutes');
    // The radius is symbol-granular reverse-deps, not the target itself.
    expect(callers).not.toContain('createRoutes');
  }, 30000);
});
