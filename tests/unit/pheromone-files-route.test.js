/**
 * Unit Tests for GET /pheromone/files route (routes/pheromone.ts)
 *
 * Exercises the file heat map endpoint with a real in-memory SQLite db.
 * Each test wires up a minimal Express app and makes real HTTP requests.
 *
 * Bugs exposed:
 *  1. depth=0 silently becomes depth=5 (parseInt("0") || 5)
 *  2. LIKE wildcard injection — underscore in pathPrefix matches wrong files
 *  3. Conflict detection misses null-agent sessions
 */

import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import express from 'express';
import { createPheromoneRoutes } from '../../routes/pheromone.js';
import { createTestDb } from '../setup-unit.js';

// ─── helpers ─────────────────────────────────────────────────────────────────

let db;

beforeEach(() => {
  db = createTestDb();
});

afterEach(() => {
  db.close();
});

/** Minimal pheromone manager stub — /pheromone/files only uses db directly */
function stubPheromones() {
  return {
    spray: () => ({ success: false }),
    sniff: () => ({ success: false }),
    list: () => [],
    start: () => {},
    stop: () => {},
    evaporateNow: () => {},
  };
}

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(createPheromoneRoutes({ pheromones: stubPheromones(), sessions: null, db }));
  return app;
}

/** Make a GET request; returns { status, body } */
async function get(app, path) {
  return new Promise((resolve) => {
    const server = app.listen(0, async () => {
      const port = server.address().port;
      try {
        const res = await fetch(`http://localhost:${port}${path}`);
        const body = await res.json();
        resolve({ status: res.status, body });
      } finally {
        server.close();
      }
    });
  });
}

// ─── test data helpers ────────────────────────────────────────────────────────

const NOW = Date.now();

function insertSession(id, agentId = 'agent-1', status = 'active') {
  db.prepare(`
    INSERT INTO sessions (id, purpose, status, created_at, updated_at)
    VALUES (?, 'test purpose', ?, ?, ?)
  `).run(id, status, NOW, NOW);
  if (agentId !== null) {
    db.prepare(`UPDATE sessions SET agent_id = ? WHERE id = ?`).run(agentId, id);
  }
}

function insertFileClaim(sessionId, filePath, releasedAt = null) {
  db.prepare(`
    INSERT INTO session_files (session_id, file_path, claimed_at, released_at)
    VALUES (?, ?, ?, ?)
  `).run(sessionId, filePath, NOW, releasedAt);
}

// ─── basic functionality ──────────────────────────────────────────────────────

describe('GET /pheromone/files — basic', () => {
  test('returns success with empty arrays when no claims exist', async () => {
    const { status, body } = await get(createApp(), '/pheromone/files');
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.files).toEqual([]);
    expect(body.directories).toEqual([]);
    expect(body.summary.totalFiles).toBe(0);
    expect(body.summary.activeConflicts).toBe(0);
    expect(body.summary.hottestFile).toBeNull();
    expect(body.summary.hottestDir).toBeNull();
  });

  test('returns a file entry when a claim exists', async () => {
    insertSession('sess-1');
    insertFileClaim('sess-1', 'lib/foo.ts');

    const { status, body } = await get(createApp(), '/pheromone/files');
    expect(status).toBe(200);
    expect(body.files).toHaveLength(1);
    expect(body.files[0].path).toBe('lib/foo.ts');
    expect(body.files[0].heat).toBeGreaterThan(0);
  });

  test('active claim adds extra heat vs released claim', async () => {
    // Active session
    insertSession('sess-active');
    insertFileClaim('sess-active', 'src/hot.ts');

    // Completed session with released claim
    insertSession('sess-done', 'agent-2', 'completed');
    insertFileClaim('sess-done', 'src/cold.ts', NOW - 1);  // released

    const { body } = await get(createApp(), '/pheromone/files');
    const hot = body.files.find(f => f.path === 'src/hot.ts');
    const cold = body.files.find(f => f.path === 'src/cold.ts');

    expect(hot).toBeDefined();
    expect(cold).toBeDefined();
    expect(hot.activeClaims).toBe(1);
    expect(cold.activeClaims).toBe(0);
    // Active file should be hotter
    expect(hot.heat).toBeGreaterThan(cold.heat);
  });

  test('returns directory rollup for nested file paths', async () => {
    insertSession('sess-1');
    insertFileClaim('sess-1', 'src/lib/utils.ts');

    const { body } = await get(createApp(), '/pheromone/files');
    const dirPaths = body.directories.map(d => d.path);
    expect(dirPaths).toContain('src/');
    expect(dirPaths).toContain('src/lib/');
  });
});

// ─── Bug 1: depth=0 silently becomes depth=5 ─────────────────────────────────

describe('Bug: depth=0 silently becomes depth=5', () => {
  /**
   * parseInt("0") evaluates to 0, which is falsy.
   * `parseInt("0") || 5` therefore returns 5, not 0.
   * Passing depth=0 should suppress directory rollup (return empty dirs),
   * but instead returns directories as if depth=5 was passed.
   */
  test('depth=0 should suppress directory rollup but does not', async () => {
    insertSession('sess-1');
    insertFileClaim('sess-1', 'src/lib/utils.ts');

    const { body } = await get(createApp(), '/pheromone/files?depth=0');

    // With correct behavior, depth=0 should mean no directory rollup → empty directories
    // This test will FAIL until the bug is fixed:
    expect(body.directories).toEqual([]);
  });

  test('depth=1 returns only top-level directories', async () => {
    insertSession('sess-1');
    insertFileClaim('sess-1', 'src/lib/deep/utils.ts');

    const { body } = await get(createApp(), '/pheromone/files?depth=1');
    const dirPaths = body.directories.map(d => d.path);

    // Only 'src/' should appear; 'src/lib/' and deeper should not
    expect(dirPaths).toContain('src/');
    expect(dirPaths).not.toContain('src/lib/');
    expect(dirPaths).not.toContain('src/lib/deep/');
  });
});

// ─── Bug 2: LIKE wildcard injection ──────────────────────────────────────────

describe('Bug: LIKE wildcard injection in path= filter', () => {
  /**
   * The route builds LIKE ? with `${pathPrefix}%`.
   * SQL LIKE treats '_' as a wildcard matching any single character.
   * So `path=lib_` matches 'lib/foo.ts', 'libX/bar.ts', etc.
   * instead of treating 'lib_' as a literal prefix.
   */
  test('path filter with underscore should not match slash-separated paths', async () => {
    insertSession('sess-1');
    // 'lib/foo.ts' has 'lib/' prefix — underscore ('_') in 'lib_' is a LIKE wildcard
    // that matches '/', making 'lib/foo.ts' pass the filter `lib_%`
    insertFileClaim('sess-1', 'lib/foo.ts');

    // Requesting path=libX should NOT match lib/foo.ts
    const { body: withX } = await get(createApp(), '/pheromone/files?path=libX');
    const libXPaths = withX.files.map(f => f.path);
    expect(libXPaths).not.toContain('lib/foo.ts');

    // Requesting path=lib_ (underscore) should NOT match lib/foo.ts either
    // because 'lib_' is not a prefix of 'lib/foo.ts' in a literal sense.
    // This test will FAIL until the bug is fixed (underscore is treated as LIKE wildcard):
    const { body: withUnderscore } = await get(createApp(), '/pheromone/files?path=lib_');
    const underscorePaths = withUnderscore.files.map(f => f.path);
    expect(underscorePaths).not.toContain('lib/foo.ts');
  });

  test('path filter with percent should not expand to a wildcard', async () => {
    insertSession('sess-1');
    insertFileClaim('sess-1', 'src/foo.ts');
    insertFileClaim('sess-1', 'lib/bar.ts');

    // path=s% would become LIKE 's%%' which matches everything starting with 's',
    // but should only match literal paths starting with 's%'.
    // The filter should NOT return lib/bar.ts.
    // This test exercises that % in path isn't treated as a LIKE wildcard.
    const { body } = await get(createApp(), '/pheromone/files?path=s%25');  // URL-encoded %
    const paths = body.files.map(f => f.path);

    // 'lib/bar.ts' does not start with 's%', so should not appear
    expect(paths).not.toContain('lib/bar.ts');
  });
});

// ─── Bug 3: Conflict misses null-agent sessions ───────────────────────────────

describe('Bug: conflict detection misses null-agent sessions', () => {
  /**
   * The route only adds agent_id to entry.agents when agent_id is truthy.
   * If two active sessions have agent_id = NULL and both claim the same file,
   * entry.agents stays empty (length 0) and conflict is never set to true.
   *
   * Real multi-agent conflicts can involve sessions without a registered agent
   * (e.g., CLI sessions, expired agents, sessions created without agent registration).
   */
  test('two active null-agent sessions on the same file should be a conflict', async () => {
    // Insert two sessions with no agent_id
    db.prepare(`
      INSERT INTO sessions (id, purpose, status, created_at, updated_at)
      VALUES ('sess-a', 'worker A', 'active', ?, ?)
    `).run(NOW, NOW);
    db.prepare(`
      INSERT INTO sessions (id, purpose, status, created_at, updated_at)
      VALUES ('sess-b', 'worker B', 'active', ?, ?)
    `).run(NOW, NOW);

    // Both claim the same file with no released_at
    insertFileClaim('sess-a', 'src/shared.ts');
    insertFileClaim('sess-b', 'src/shared.ts');

    const { body } = await get(createApp(), '/pheromone/files');
    const sharedFile = body.files.find(f => f.path === 'src/shared.ts');

    expect(sharedFile).toBeDefined();
    expect(sharedFile.activeClaims).toBe(2);

    // This will FAIL until the bug is fixed:
    expect(sharedFile.conflict).toBe(true);
    expect(body.summary.activeConflicts).toBe(1);
  });

  test('one named-agent and one null-agent on the same file should also be a conflict', async () => {
    insertSession('sess-named', 'agent-alpha');

    db.prepare(`
      INSERT INTO sessions (id, purpose, status, created_at, updated_at)
      VALUES ('sess-anon', 'anon worker', 'active', ?, ?)
    `).run(NOW, NOW);

    insertFileClaim('sess-named', 'src/shared.ts');
    insertFileClaim('sess-anon', 'src/shared.ts');

    const { body } = await get(createApp(), '/pheromone/files');
    const sharedFile = body.files.find(f => f.path === 'src/shared.ts');

    expect(sharedFile).toBeDefined();
    expect(sharedFile.activeClaims).toBe(2);

    // Also broken: the null-agent claim is not counted toward conflict detection.
    // 'sess-named' contributes agent-alpha; 'sess-anon' contributes nothing.
    // So agents.length = 1, and conflict stays false.
    expect(sharedFile.conflict).toBe(true);
  });

  test('two sessions with different named agents are correctly detected as conflict', async () => {
    // This works today — sanity check that named-agent conflicts still work
    insertSession('sess-1', 'agent-alpha');
    insertSession('sess-2', 'agent-beta');

    insertFileClaim('sess-1', 'src/shared.ts');
    insertFileClaim('sess-2', 'src/shared.ts');

    const { body } = await get(createApp(), '/pheromone/files');
    const sharedFile = body.files.find(f => f.path === 'src/shared.ts');

    expect(sharedFile.conflict).toBe(true);
    expect(body.summary.activeConflicts).toBe(1);
  });
});
