import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { createTestDb } from '../setup-unit.js';
import { createClaimForest } from '../../lib/claim-forest.js';
import { createSessions } from '../../lib/sessions.js';

describe('claim forest store', () => {
  let db;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    if (db) db.close();
  });

  function insertSession(id = 'session-forest-1') {
    db.prepare(`
      INSERT INTO sessions (
        id, purpose, status, phase, agent_id, worktree_id, identity_project,
        created_at, updated_at, completed_at, metadata
      )
      VALUES (?, ?, 'active', 'in_progress', ?, ?, ?, ?, ?, NULL, NULL)
    `).run(id, 'map the multiverse', 'agent-a', 'wt-a', 'port-daddy', 1000, 1000);
    return id;
  }

  it('stores claim nodes as a repo/worktree hierarchy and reads active claims from it', () => {
    const sessionId = insertSession();
    const forest = createClaimForest(db);

    const result = forest.claim({
      repoId: 'port-daddy',
      world: { kind: 'worktree', id: 'wt-a' },
      selector: {
        kind: 'symbol',
        path: 'lib/sessions.ts',
        symbol: 'claimFiles',
        symbolPath: 'createSessions.claimFiles',
        startLine: 100,
        endLine: 180,
      },
    }, {
      sessionId,
      agentId: 'agent-a',
      claimedAt: 1200,
      observedBy: 'test',
    });

    expect(result.changes).toBe(1);

    const claims = forest.listActiveClaims();
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({
      sessionId,
      repoId: 'port-daddy',
      worldKind: 'worktree',
      worldId: 'wt-a',
      filePath: 'lib/sessions.ts',
      symbol: 'claimFiles',
      symbolPath: 'createSessions.claimFiles',
      startLine: 100,
      endLine: 180,
      observedBy: 'test',
    });

    const nodeKinds = db.prepare(`
      SELECT selector_kind AS selectorKind, path, symbol_path AS symbolPath
      FROM claim_forest_nodes
      ORDER BY selector_kind, path
    `).all();

    expect(nodeKinds.map(node => node.selectorKind)).toEqual(expect.arrayContaining([
      'repo',
      'directory',
      'file',
      'symbol',
    ]));
    expect(nodeKinds.some(node => node.path === 'lib/sessions.ts')).toBe(true);
  });

  it('normalizes path spellings so duplicate daemons converge on the same file node', () => {
    const sessionId = insertSession();
    const forest = createClaimForest(db);

    forest.claim({
      repoId: 'port-daddy',
      world: { kind: 'worktree', id: 'wt-a' },
      selector: { kind: 'file', path: './lib//sessions.ts/' },
    }, { sessionId, claimedAt: 1200, observedBy: 'daemon-a' });

    forest.claim({
      repoId: 'port-daddy',
      world: { kind: 'worktree', id: 'wt-a' },
      selector: { kind: 'file', path: 'lib/sessions.ts' },
    }, { sessionId, claimedAt: 1300, observedBy: 'daemon-b' });

    const active = forest.getActiveClaimsForFile('lib/sessions.ts');
    const history = forest.listClaimsForSession(sessionId, { includeReleased: true });

    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ filePath: 'lib/sessions.ts', observedBy: 'daemon-b' });
    expect(history).toHaveLength(2);
    expect(history.filter(claim => claim.releasedAt === 1300)).toHaveLength(1);
  });

  it('keeps same-path claims distinct across worktrees while still supporting global path lookup', () => {
    const forest = createClaimForest(db);
    const s1 = insertSession('session-worktree-a');
    const s2 = insertSession('session-worktree-b');
    db.prepare("UPDATE sessions SET worktree_id = 'wt-b', agent_id = 'agent-b' WHERE id = ?").run(s2);

    forest.claim({
      repoId: 'port-daddy',
      world: { kind: 'worktree', id: 'wt-a' },
      selector: { kind: 'file', path: 'lib/shared.ts' },
    }, { sessionId: s1, claimedAt: 1200 });
    forest.claim({
      repoId: 'port-daddy',
      world: { kind: 'worktree', id: 'wt-b' },
      selector: { kind: 'file', path: 'lib/shared.ts' },
    }, { sessionId: s2, claimedAt: 1210 });

    expect(forest.getActiveClaimsForFile('lib/shared.ts')).toHaveLength(2);
    expect(forest.getActiveClaimsForFile('lib/shared.ts', {
      repoId: 'port-daddy',
      worldKind: 'worktree',
      worldId: 'wt-a',
    })).toHaveLength(1);
    expect(forest.getActiveClaimsForFileExcludingSession('lib/shared.ts', s2, {
      repoId: 'port-daddy',
      worldKind: 'worktree',
      worldId: 'wt-b',
    })).toHaveLength(0);
  });

  it('keeps same-path claims distinct across logical repos and harbor worlds', () => {
    const forest = createClaimForest(db);
    const localSession = insertSession('session-local');
    const remoteSession = insertSession('session-harbor');
    db.prepare("UPDATE sessions SET identity_project = 'remote-port-daddy', agent_id = 'agent-remote' WHERE id = ?").run(remoteSession);

    forest.claim({
      repoId: 'port-daddy',
      world: { kind: 'worktree', id: 'wt-a' },
      selector: { kind: 'file', path: 'routes/sessions.ts' },
    }, { sessionId: localSession, claimedAt: 1200 });
    forest.claim({
      repoId: 'remote-port-daddy',
      world: { kind: 'harbor', id: 'harbor://peer/laptop' },
      selector: { kind: 'file', path: 'routes/sessions.ts' },
    }, { sessionId: remoteSession, claimedAt: 1210, observedBy: 'relay.pull' });

    const all = forest.getActiveClaimsForFile('routes/sessions.ts');
    expect(all.map(claim => claim.repoId)).toEqual(expect.arrayContaining(['port-daddy', 'remote-port-daddy']));
    expect(all.map(claim => claim.worldKind)).toEqual(expect.arrayContaining(['worktree', 'harbor']));
    expect(forest.listActiveClaims({ repoId: 'remote-port-daddy', worldKind: 'harbor' })).toHaveLength(1);
  });

  it('tracks ref and commit worlds without confusing branch truth with immutable commit truth', () => {
    const forest = createClaimForest(db);
    const refSession = insertSession('session-ref');
    const commitSession = insertSession('session-commit');

    forest.claim({
      repoId: 'port-daddy',
      world: { kind: 'ref', id: 'refs/heads/feat/claim-forest', gitOid: 'abc123' },
      selector: { kind: 'file', path: 'lib/claim-forest.ts' },
    }, { sessionId: refSession, claimedAt: 1200 });
    forest.claim({
      repoId: 'port-daddy',
      world: { kind: 'commit', id: 'def456', gitOid: 'def456' },
      selector: { kind: 'file', path: 'lib/claim-forest.ts' },
    }, { sessionId: commitSession, claimedAt: 1210 });

    const claims = forest.getActiveClaimsForFile('lib/claim-forest.ts');
    expect(claims).toHaveLength(2);
    expect(claims.find(claim => claim.worldKind === 'ref')).toMatchObject({ worldId: 'refs/heads/feat/claim-forest', gitOid: 'abc123' });
    expect(claims.find(claim => claim.worldKind === 'commit')).toMatchObject({ worldId: 'def456', gitOid: 'def456' });
  });

  it('updates a symbol node when line numbers drift instead of splitting the symbol into two active truths', () => {
    const sessionId = insertSession();
    const forest = createClaimForest(db);

    forest.claim({
      repoId: 'port-daddy',
      world: { kind: 'worktree', id: 'wt-a' },
      selector: {
        kind: 'symbol',
        path: 'lib/sessions.ts',
        symbol: 'claimFiles',
        symbolPath: 'createSessions.claimFiles',
        startLine: 100,
        endLine: 180,
      },
    }, { sessionId, claimedAt: 1200 });

    forest.claim({
      repoId: 'port-daddy',
      world: { kind: 'worktree', id: 'wt-a' },
      selector: {
        kind: 'symbol',
        path: 'lib/sessions.ts',
        symbol: 'claimFiles',
        symbolPath: 'createSessions.claimFiles',
        startLine: 240,
        endLine: 330,
      },
    }, { sessionId, claimedAt: 1300 });

    const active = forest.listActiveClaims({ symbolPath: 'createSessions.claimFiles' });
    const history = forest.listClaimsForSession(sessionId, { includeReleased: true });

    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ startLine: 240, endLine: 330 });
    expect(history).toHaveLength(2);
    expect(history.filter(claim => claim.releasedAt === 1300)).toHaveLength(1);
  });

  it('releases one symbolPath without releasing sibling symbols in the same file', () => {
    const sessionId = insertSession();
    const forest = createClaimForest(db);

    forest.claim({
      repoId: 'port-daddy',
      world: { kind: 'worktree', id: 'wt-a' },
      selector: { kind: 'symbol', path: 'lib/sessions.ts', symbolPath: 'createSessions.claimFiles', symbol: 'claimFiles' },
    }, { sessionId, claimedAt: 1200 });
    forest.claim({
      repoId: 'port-daddy',
      world: { kind: 'worktree', id: 'wt-a' },
      selector: { kind: 'symbol', path: 'lib/sessions.ts', symbolPath: 'createSessions.releaseFiles', symbol: 'releaseFiles' },
    }, { sessionId, claimedAt: 1210 });

    expect(forest.releaseBySymbolPath(sessionId, 'lib/sessions.ts', 'createSessions.claimFiles', 1300)).toBe(1);

    const active = forest.getActiveClaimsForFile('lib/sessions.ts');
    expect(active).toHaveLength(1);
    expect(active[0].symbolPath).toBe('createSessions.releaseFiles');
  });

  it('releases exact ranges without accidentally releasing adjacent ranges', () => {
    const sessionId = insertSession();
    const forest = createClaimForest(db);

    forest.claim({
      repoId: 'port-daddy',
      world: { kind: 'worktree', id: 'wt-a' },
      selector: { kind: 'range', path: 'lib/sessions.ts', startLine: 10, endLine: 20 },
    }, { sessionId, claimedAt: 1200 });
    forest.claim({
      repoId: 'port-daddy',
      world: { kind: 'worktree', id: 'wt-a' },
      selector: { kind: 'range', path: 'lib/sessions.ts', startLine: 21, endLine: 30 },
    }, { sessionId, claimedAt: 1210 });

    expect(forest.releaseByRange(sessionId, 'lib/sessions.ts', 10, 20, 1300)).toBe(1);

    const active = forest.getActiveClaimsForFile('lib/sessions.ts');
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ startLine: 21, endLine: 30 });
  });

  it('can represent a directory claim as a parent in the forest', () => {
    const forest = createClaimForest(db);
    const node = forest.ensureNode({
      repoId: 'port-daddy',
      world: { kind: 'worktree', id: 'wt-a' },
      selector: { kind: 'directory', path: 'apps/fleet-ui/src' },
    });

    expect(node).toMatchObject({ repoId: 'port-daddy', worldKind: 'worktree', worldId: 'wt-a' });

    const directory = db.prepare(`
      SELECT selector_kind AS selectorKind, path
      FROM claim_forest_nodes
      WHERE id = ?
    `).get(node.id);
    expect(directory).toMatchObject({ selectorKind: 'directory', path: 'apps/fleet-ui/src' });
  });

  it('releases active claims without consulting legacy session_files rows', () => {
    const sessionId = insertSession();
    const forest = createClaimForest(db);

    forest.claim({
      repoId: 'port-daddy',
      world: { kind: 'worktree', id: 'wt-a' },
      selector: { kind: 'file', path: 'lib/claim-forest.ts' },
    }, {
      sessionId,
      claimedAt: 1200,
      observedBy: 'test',
    });

    expect(forest.getActiveClaimsForFile('lib/claim-forest.ts')).toHaveLength(1);
    expect(forest.releaseByFilePath(sessionId, 'lib/claim-forest.ts', 1300)).toBe(1);
    expect(forest.getActiveClaimsForFile('lib/claim-forest.ts')).toHaveLength(0);
  });

  it('backfills existing session_files rows into the forest exactly once', () => {
    const sessions = createSessions(db);
    const started = sessions.start('legacy claim', { agentId: 'agent-a', project: 'port-daddy', worktreeId: 'wt-a' });
    expect(started.success).toBe(true);

    db.prepare(`
      INSERT INTO session_files (
        session_id, file_path, start_line, end_line, symbol, symbol_path, claimed_at, released_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
    `).run(started.id, 'lib/legacy.ts', 10, 20, 'legacyFn', 'legacy.legacyFn', 1400);

    const forest = createClaimForest(db);
    expect(forest.backfillFromSessionFiles()).toBe(1);
    expect(forest.backfillFromSessionFiles()).toBe(0);

    const claims = forest.getActiveClaimsForFile('lib/legacy.ts');
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({
      sessionId: started.id,
      repoId: 'port-daddy',
      worldId: 'wt-a',
      symbolPath: 'legacy.legacyFn',
      observedBy: 'session_files.backfill',
    });
  });

  it('backfills released legacy rows as released, not as active resurrected claims', () => {
    const sessions = createSessions(db);
    const started = sessions.start('released legacy claim', { agentId: 'agent-a', project: 'port-daddy', worktreeId: 'wt-a' });
    expect(started.success).toBe(true);

    db.prepare(`
      INSERT INTO session_files (
        session_id, file_path, start_line, end_line, symbol, symbol_path, claimed_at, released_at
      )
      VALUES (?, ?, NULL, NULL, NULL, NULL, ?, ?)
    `).run(started.id, 'lib/released.ts', 1400, 1500);

    const forest = createClaimForest(db);
    expect(forest.backfillFromSessionFiles()).toBe(1);

    expect(forest.getActiveClaimsForFile('lib/released.ts')).toHaveLength(0);
    expect(forest.listClaimsForSession(started.id, { includeReleased: true })[0]).toMatchObject({
      filePath: 'lib/released.ts',
      releasedAt: 1500,
    });
  });

  it('uses local/unscoped defaults when old rows lack repo and worktree identity', () => {
    const sessions = createSessions(db);
    const started = sessions.start('identity-free legacy claim', { agentId: 'agent-a' });
    expect(started.success).toBe(true);
    db.prepare('UPDATE sessions SET identity_project = NULL, worktree_id = NULL WHERE id = ?').run(started.id);
    db.prepare(`
      INSERT INTO session_files (
        session_id, file_path, start_line, end_line, symbol, symbol_path, claimed_at, released_at
      )
      VALUES (?, ?, NULL, NULL, NULL, NULL, ?, NULL)
    `).run(started.id, 'lib/unscoped.ts', 1400);

    const forest = createClaimForest(db);
    expect(forest.backfillFromSessionFiles()).toBe(1);

    expect(forest.getActiveClaimsForFile('lib/unscoped.ts')[0]).toMatchObject({
      repoId: 'local',
      worldKind: 'worktree',
      worldId: 'unscoped',
    });
  });
});
