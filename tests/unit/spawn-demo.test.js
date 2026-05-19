/**
 * Spawn ancestry + gather DEMO test.
 *
 * Not coverage; this renders two concrete sample artifacts the operator
 * asked for, via the same modules production uses:
 *   - a contrived 3-deep spawn chain with `pd spawn tree` output
 *   - a "--parallel 3 --gather first" winner+killed envelope
 *
 * The test logs them via console.log so `jest --verbose` shows them in the
 * harness output. Asserts the structure so the demo can't silently rot.
 */

import Database from 'better-sqlite3';
import { createAncestry } from '../../lib/spawn-ancestry.js';
import { gatherFirst } from '../../lib/spawn-gather.js';

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      purpose TEXT,
      status TEXT,
      phase TEXT,
      agent_id TEXT,
      worktree_id TEXT,
      identity_project TEXT,
      created_at INTEGER,
      updated_at INTEGER,
      completed_at INTEGER,
      metadata TEXT
    );
  `);
  return db;
}

function makeChild({ id, delayMs, status, output, error }) {
  let killTimer = null;
  let resolved = false;
  let resolveFn;
  const runPromise = new Promise((resolve) => {
    resolveFn = resolve;
    killTimer = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      resolve({ agentId: id, status, output: output ?? null, error: error ?? null });
    }, delayMs);
  });
  return {
    agentId: id,
    run: () => runPromise,
    kill: () => {
      if (resolved) return;
      resolved = true;
      if (killTimer) clearTimeout(killTimer);
      resolveFn({ agentId: id, status: 'killed', output: null, error: 'Killed by spawner' });
    },
  };
}

describe('DEMO: pd spawn tree on a contrived 3-deep chain', () => {
  test('renders an ascii ancestry tree', () => {
    const db = freshDb();
    const ancestry = createAncestry(db);

    // Build: root -> child-a -> grandchild-a1
    //                       \-> grandchild-a2
    //         root -> child-b
    ancestry.record({ childSessionId: 'sess-root', parentSessionId: null, depth: 0, chain: [] });
    ancestry.record({ childSessionId: 'sess-child-a', parentSessionId: 'sess-root', depth: 1, chain: ['sess-root'] });
    ancestry.record({ childSessionId: 'sess-child-b', parentSessionId: 'sess-root', depth: 1, chain: ['sess-root'] });
    ancestry.record({ childSessionId: 'sess-grand-a1', parentSessionId: 'sess-child-a', depth: 2, chain: ['sess-root', 'sess-child-a'] });
    ancestry.record({ childSessionId: 'sess-grand-a2', parentSessionId: 'sess-child-a', depth: 2, chain: ['sess-root', 'sess-child-a'] });

    const ascii = ancestry.tree('sess-root');
    console.log('\n=== pd spawn tree sess-root ===');
    console.log(ascii);
    console.log('==============================\n');

    expect(ascii).toContain('sess-root');
    expect(ascii).toContain('sess-child-a');
    expect(ascii).toContain('sess-child-b');
    expect(ascii).toContain('sess-grand-a1');
    expect(ascii).toContain('sess-grand-a2');
  });
});

describe('DEMO: pd spawn --parallel 3 --gather first', () => {
  test('renders winner + killed envelope', async () => {
    const children = [
      makeChild({ id: 'spawned-aaa', delayMs: 5,  status: 'completed', output: 'hello\n' }),
      makeChild({ id: 'spawned-bbb', delayMs: 50, status: 'completed', output: 'hello (slow)\n' }),
      makeChild({ id: 'spawned-ccc', delayMs: 80, status: 'completed', output: 'hello (slower)\n' }),
    ];
    const result = await gatherFirst(children);

    console.log('\n=== pd spawn --parallel 3 --gather first ===');
    console.log(JSON.stringify({
      mode: 'parallel',
      parallel: 3,
      gather: result.policy,
      winner: result.winner,
      killed: result.killed,
      all: result.all,
    }, null, 2));
    console.log('==============================================\n');

    expect(result.winner.agentId).toBe('spawned-aaa');
    expect(result.winner.status).toBe('completed');
    expect(result.killed.length).toBeGreaterThanOrEqual(1);
  });
});
