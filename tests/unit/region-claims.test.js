/**
 * Unit Tests for Region-Level File Claims
 *
 * Tests region-level granularity for file claims, allowing multiple agents
 * to claim different line ranges of the same file without conflict.
 *
 * Schema change: session_files gets start_line, end_line, symbol columns
 * with NULL = whole-file claim (backward compatible).
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { createTestDb } from '../setup-unit.js';
import { createSessions } from '../../lib/sessions.js';

describe('Region-Level File Claims', () => {
  let db;
  let sessions;

  beforeEach(() => {
    db = createTestDb();
    sessions = createSessions(db);
  });

  afterEach(() => {
    if (db) db.close();
  });

  // Helper: create a session and return its ID
  function makeSession(purpose = 'test session', agentId = null) {
    const result = sessions.start(purpose, { agentId });
    expect(result.success).toBe(true);
    return result.id;
  }

  function makeIndexedFunction(filePath, symbolPath, startLine, endLine, symbolName = symbolPath.split('.').pop()) {
    return {
      id: startLine,
      filePath,
      symbolName,
      symbolType: 'function',
      symbolPath,
      startLine,
      endLine,
      parentSymbol: null,
      signature: `${symbolName}()`,
      bodyHash: null,
      exported: true,
      parsedAt: Date.now(),
    };
  }

  function useSymbolIndex(symbolsByPath) {
    sessions = createSessions(db, undefined, {
      symbolIndex: {
        getSymbols(filePath) {
          return symbolsByPath[filePath] || [];
        },
      },
    });
  }

  // ===========================================================================
  // Schema Migration — old data survives
  // ===========================================================================

  describe('Schema Migration', () => {
    it('should have start_line, end_line, symbol, symbol_path columns on session_files', () => {
      const columns = db.prepare("PRAGMA table_info(session_files)").all();
      const names = columns.map(c => c.name);
      expect(names).toContain('start_line');
      expect(names).toContain('end_line');
      expect(names).toContain('symbol');
      expect(names).toContain('symbol_path');
    });

    it('should have id (autoincrement) as primary key', () => {
      const columns = db.prepare("PRAGMA table_info(session_files)").all();
      const idCol = columns.find(c => c.name === 'id');
      expect(idCol).toBeDefined();
      expect(idCol.pk).toBe(1);
    });

    it('should have region index', () => {
      const indexes = db.prepare("PRAGMA index_list(session_files)").all();
      const indexNames = indexes.map(i => i.name);
      expect(indexNames).toContain('idx_session_files_region');
      expect(indexNames).toContain('idx_session_files_symbol_path');
    });

    it('should create claim forest tables and indexes', () => {
      const tables = db.prepare(`
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND name LIKE 'claim_forest_%'
      `).all().map(row => row.name);
      expect(tables).toEqual(expect.arrayContaining([
        'claim_forest_nodes',
        'claim_forest_edges',
        'claim_forest_claims',
      ]));

      const indexes = db.prepare("PRAGMA index_list(claim_forest_claims)").all().map(row => row.name);
      expect(indexes).toContain('idx_claim_forest_claims_node_active');
      expect(indexes).toContain('idx_claim_forest_claims_session');
    });
  });

  // ===========================================================================
  // Whole-File Backward Compatibility
  // ===========================================================================

  describe('Whole-File Backward Compat', () => {
    it('should claim files with filePaths (no regions) — same as before', () => {
      const sid = makeSession();
      const result = sessions.claimFiles(sid, ['src/a.ts', 'src/b.ts']);
      expect(result.success).toBe(true);
      expect(result.claimed).toEqual(['src/a.ts', 'src/b.ts']);
    });

    it('should detect whole-file conflicts as before', () => {
      const s1 = makeSession('session 1');
      const s2 = makeSession('session 2');

      sessions.claimFiles(s1, ['src/shared.ts']);
      const result = sessions.claimFiles(s2, ['src/shared.ts']);

      expect(result.success).toBe(true);
      expect(result.conflicts.length).toBe(1);
      expect(result.conflicts[0].filePath).toBe('src/shared.ts');
      expect(result.conflicts[0].sessionId).toBe(s1);
    });

    it('should release whole-file claims as before', () => {
      const sid = makeSession();
      sessions.claimFiles(sid, ['src/a.ts']);
      const result = sessions.releaseFiles(sid, ['src/a.ts']);
      expect(result.success).toBe(true);
      expect(result.released).toContain('src/a.ts');
    });

    it('should list whole-file claims with null region fields', () => {
      const sid = makeSession();
      sessions.claimFiles(sid, ['src/a.ts']);

      const result = sessions.listAllActiveClaims();
      expect(result.success).toBe(true);
      expect(result.claims.length).toBe(1);
      expect(result.claims[0].startLine).toBeNull();
      expect(result.claims[0].endLine).toBeNull();
      expect(result.claims[0].symbol).toBeNull();
    });

    it('should return null region fields in getClaimOwner', () => {
      const sid = makeSession();
      sessions.claimFiles(sid, ['src/a.ts']);

      const result = sessions.getClaimOwner('src/a.ts');
      expect(result.success).toBe(true);
      expect(result.owners.length).toBe(1);
      expect(result.owners[0].startLine).toBeNull();
      expect(result.owners[0].endLine).toBeNull();
      expect(result.owners[0].symbol).toBeNull();
    });

    it('should return region fields in session get()', () => {
      const sid = makeSession();
      sessions.claimFiles(sid, ['src/a.ts']);

      const result = sessions.get(sid);
      expect(result.success).toBe(true);
      expect(result.files.length).toBe(1);
      expect(result.files[0].startLine).toBeNull();
      expect(result.files[0].endLine).toBeNull();
      expect(result.files[0].symbol).toBeNull();
    });
  });

  // ===========================================================================
  // Claim Forest Integration
  // ===========================================================================

  describe('Claim Forest Integration', () => {
    it('should dual-write session claims into the claim forest', () => {
      const sid = makeSession('forest session', 'agent-a');
      const result = sessions.claimFiles(sid, [], {
        regions: [{
          path: './src/routes.ts',
          startLine: 10,
          endLine: 50,
          symbol: 'handleAuth',
          symbolPath: 'routes.handleAuth',
        }],
      });

      expect(result.success).toBe(true);

      const legacy = db.prepare('SELECT id FROM session_files WHERE session_id = ?').get(sid);
      const forestClaim = db.prepare(`
        SELECT c.legacy_session_file_id AS legacySessionFileId,
               c.session_id AS sessionId,
               n.path,
               n.symbol,
               n.symbol_path AS symbolPath,
               n.start_line AS startLine,
               n.end_line AS endLine
        FROM claim_forest_claims c
        JOIN claim_forest_nodes n ON n.id = c.node_id
        WHERE c.session_id = ?
      `).get(sid);

      expect(forestClaim).toMatchObject({
        legacySessionFileId: legacy.id,
        sessionId: sid,
        path: 'src/routes.ts',
        symbol: 'handleAuth',
        symbolPath: 'routes.handleAuth',
        startLine: 10,
        endLine: 50,
      });

      const claims = sessions.listAllActiveClaims();
      expect(claims.claims[0]).toMatchObject({
        sessionId: sid,
        filePath: 'src/routes.ts',
        repoId: 'local',
        worldKind: 'worktree',
        nodeId: expect.any(String),
      });
    });

    it('should read active claims from the forest after legacy session_files rows are gone', () => {
      const sid = makeSession('forest reader', 'agent-a');
      sessions.claimFiles(sid, ['src/forest.ts']);

      db.prepare('DELETE FROM session_files WHERE session_id = ?').run(sid);

      const claims = sessions.listAllActiveClaims();
      expect(claims.claims).toHaveLength(1);
      expect(claims.claims[0]).toMatchObject({
        sessionId: sid,
        filePath: 'src/forest.ts',
        nodeId: expect.any(String),
      });

      const owner = sessions.getClaimOwner('src/forest.ts');
      expect(owner.claimed).toBe(true);
      expect(owner.owners[0].sessionId).toBe(sid);

      const session = sessions.get(sid);
      expect(session.success).toBe(true);
      expect(session.files[0]).toMatchObject({
        sessionId: sid,
        filePath: 'src/forest.ts',
        nodeId: expect.any(String),
      });
    });

    it('should detect conflicts from the forest after legacy rows are gone', () => {
      const s1 = makeSession('forest owner', 'agent-a');
      const s2 = makeSession('forest challenger', 'agent-b');
      sessions.claimFiles(s1, ['src/shared.ts']);

      db.prepare('DELETE FROM session_files WHERE session_id = ?').run(s1);

      const result = sessions.claimFiles(s2, ['src/shared.ts']);
      expect(result.success).toBe(true);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].sessionId).toBe(s1);
    });

    it('should release forest-backed claims even if legacy rows are gone', () => {
      const sid = makeSession('forest release', 'agent-a');
      sessions.claimFiles(sid, ['src/release-me.ts']);

      db.prepare('DELETE FROM session_files WHERE session_id = ?').run(sid);

      const result = sessions.releaseFiles(sid, ['src/release-me.ts']);
      expect(result.success).toBe(true);
      expect(result.released).toContain('src/release-me.ts');
      expect(sessions.listAllActiveClaims().claims).toHaveLength(0);
    });

    it('should keep same-path claims in different worktrees visible but non-conflicting', () => {
      const s1Result = sessions.start('worktree a owner', {
        agentId: 'agent-a',
        project: 'port-daddy',
        worktreeId: 'wt-a',
      });
      const s2Result = sessions.start('worktree b owner', {
        agentId: 'agent-b',
        project: 'port-daddy',
        worktreeId: 'wt-b',
      });
      expect(s1Result.success).toBe(true);
      expect(s2Result.success).toBe(true);

      sessions.claimFiles(s1Result.id, ['src/shared.ts']);
      const result = sessions.claimFiles(s2Result.id, ['src/shared.ts']);

      expect(result.success).toBe(true);
      expect(result.conflicts).toHaveLength(0);

      const all = sessions.listAllActiveClaims({ path: 'src/shared.ts' });
      expect(all.claims).toHaveLength(2);
      expect(all.claims.map(claim => claim.worldId)).toEqual(expect.arrayContaining(['wt-a', 'wt-b']));

      const scoped = sessions.listAllActiveClaims({
        path: 'src/shared.ts',
        repoId: 'port-daddy',
        worldKind: 'worktree',
        worldId: 'wt-a',
      });
      expect(scoped.claims).toHaveLength(1);
      expect(scoped.claims[0].sessionId).toBe(s1Result.id);
    });

    it('should still conflict for the same path inside the same repo/worktree world', () => {
      const s1Result = sessions.start('same worktree owner', {
        agentId: 'agent-a',
        project: 'port-daddy',
        worktreeId: 'wt-a',
      });
      const s2Result = sessions.start('same worktree challenger', {
        agentId: 'agent-b',
        project: 'port-daddy',
        worktreeId: 'wt-a',
      });
      expect(s1Result.success).toBe(true);
      expect(s2Result.success).toBe(true);

      sessions.claimFiles(s1Result.id, ['src/shared.ts']);
      const result = sessions.claimFiles(s2Result.id, ['src/shared.ts']);

      expect(result.success).toBe(true);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].sessionId).toBe(s1Result.id);
    });

    it('should let two daemon module instances see each other through the forest without duplicating backfill', () => {
      const daemonA = createSessions(db);
      const s1 = daemonA.start('daemon a claim', {
        agentId: 'agent-a',
        project: 'port-daddy',
        worktreeId: 'wt-a',
      });
      expect(s1.success).toBe(true);
      expect(daemonA.claimFiles(s1.id, ['src/multi-daemon.ts']).success).toBe(true);

      const legacyRowsBefore = db.prepare('SELECT COUNT(*) AS count FROM session_files WHERE session_id = ?').get(s1.id).count;
      const forestRowsBefore = db.prepare('SELECT COUNT(*) AS count FROM claim_forest_claims WHERE session_id = ?').get(s1.id).count;

      const daemonB = createSessions(db);
      const s2 = daemonB.start('daemon b claim', {
        agentId: 'agent-b',
        project: 'port-daddy',
        worktreeId: 'wt-a',
      });
      expect(s2.success).toBe(true);

      const forestRowsAfterInit = db.prepare('SELECT COUNT(*) AS count FROM claim_forest_claims WHERE session_id = ?').get(s1.id).count;
      expect(legacyRowsBefore).toBe(1);
      expect(forestRowsAfterInit).toBe(forestRowsBefore);

      const result = daemonB.claimFiles(s2.id, ['src/multi-daemon.ts']);
      expect(result.success).toBe(true);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].sessionId).toBe(s1.id);
    });

    it('should recover old-daemon session_files rows when a newer daemon initializes the forest', () => {
      const oldSession = sessions.start('old daemon legacy row', {
        agentId: 'agent-old',
        project: 'port-daddy',
        worktreeId: 'wt-a',
      });
      expect(oldSession.success).toBe(true);
      db.prepare(`
        INSERT INTO session_files (
          session_id, file_path, start_line, end_line, symbol, symbol_path, claimed_at, released_at
        )
        VALUES (?, ?, NULL, NULL, NULL, NULL, ?, NULL)
      `).run(oldSession.id, 'src/old-daemon.ts', 1700);

      const newerDaemon = createSessions(db);
      const claims = newerDaemon.listAllActiveClaims({ path: 'src/old-daemon.ts' });

      expect(claims.claims).toHaveLength(1);
      expect(claims.claims[0]).toMatchObject({
        sessionId: oldSession.id,
        filePath: 'src/old-daemon.ts',
        repoId: 'port-daddy',
        worldId: 'wt-a',
      });
    });

    it('should keep forest rows in released history after session end', () => {
      const sid = makeSession('terminal forest release', 'agent-a');
      sessions.claimFiles(sid, ['src/end.ts']);

      const ended = sessions.end(sid);
      expect(ended.success).toBe(true);

      const active = sessions.listAllActiveClaims({ path: 'src/end.ts' });
      expect(active.claims).toHaveLength(0);

      const session = sessions.get(sid);
      expect(session.files).toHaveLength(1);
      expect(session.files[0]).toMatchObject({
        filePath: 'src/end.ts',
        releasedAt: expect.any(Number),
        nodeId: expect.any(String),
      });
    });

    it('should release forest claims when an orphaned active session is abandoned', () => {
      const stale = Date.now() - 60 * 60 * 1000;
      const sid = 'session-orphan-forest';
      db.prepare(`
        INSERT INTO sessions (
          id, purpose, status, phase, agent_id, worktree_id, identity_project,
          created_at, updated_at, completed_at, metadata, is_durable
        )
        VALUES (?, 'orphan forest claim', 'active', 'in_progress', 'missing-agent', 'wt-a', 'port-daddy', ?, ?, NULL, NULL, 0)
      `).run(sid, stale, stale);

      sessions.claimFiles(sid, ['src/orphan.ts']);
      db.prepare('DELETE FROM session_files WHERE session_id = ?').run(sid);

      const result = sessions.abandonOrphanedActive({ olderThan: 1 });
      expect(result.success).toBe(true);
      expect(result.abandoned).toContain(sid);
      expect(result.releasedClaims).toBeGreaterThanOrEqual(1);
      expect(sessions.listAllActiveClaims({ path: 'src/orphan.ts' }).claims).toHaveLength(0);
    });

    it('should preserve distinct forest nodes for adjacent multi-feature branch ranges', () => {
      const s1 = sessions.start('feature branch a', {
        agentId: 'agent-a',
        project: 'port-daddy',
        worktreeId: 'feature-a',
      });
      const s2 = sessions.start('feature branch b', {
        agentId: 'agent-b',
        project: 'port-daddy',
        worktreeId: 'feature-a',
      });
      expect(s1.success).toBe(true);
      expect(s2.success).toBe(true);

      sessions.claimFiles(s1.id, [], {
        regions: [{ path: 'src/branch.ts', startLine: 1, endLine: 50, symbol: 'alpha' }],
      });
      const result = sessions.claimFiles(s2.id, [], {
        regions: [{ path: 'src/branch.ts', startLine: 51, endLine: 100, symbol: 'beta' }],
      });

      expect(result.success).toBe(true);
      expect(result.conflicts).toHaveLength(0);

      const claims = sessions.listAllActiveClaims({ path: 'src/branch.ts', worldId: 'feature-a' });
      expect(claims.claims).toHaveLength(2);
      expect(new Set(claims.claims.map(claim => claim.nodeId)).size).toBe(2);
    });

    it('should preserve symbol-only claims as forest symbol nodes for wildcard reads', () => {
      const sid = makeSession('symbol-only forest', 'agent-a');
      sessions.claimFiles(sid, [], {
        regions: [
          { path: 'src/symbols.ts', symbol: 'getUsers' },
          { path: 'src/symbols.ts', symbol: 'updateUser' },
        ],
      });

      const result = sessions.listAllActiveClaims({ symbol: 'get*' });
      expect(result.claims).toHaveLength(1);
      expect(result.claims[0]).toMatchObject({
        filePath: 'src/symbols.ts',
        symbol: 'getUsers',
        nodeId: expect.any(String),
      });
    });
  });

  // ===========================================================================
  // Region Claims
  // ===========================================================================

  describe('Region Claims', () => {
    it('should claim a specific line range', () => {
      const sid = makeSession();
      const result = sessions.claimFiles(sid, [], {
        regions: [{ path: 'src/routes.ts', startLine: 10, endLine: 50, symbol: 'handleAuth' }]
      });

      expect(result.success).toBe(true);
      expect(result.claimed).toContain('src/routes.ts');
    });

    it('should store region details', () => {
      const sid = makeSession();
      sessions.claimFiles(sid, [], {
        regions: [{ path: 'src/routes.ts', startLine: 10, endLine: 50, symbol: 'handleAuth' }]
      });

      const claims = sessions.listAllActiveClaims();
      const claim = claims.claims.find(c => c.filePath === 'src/routes.ts');
      expect(claim).toBeDefined();
      expect(claim.startLine).toBe(10);
      expect(claim.endLine).toBe(50);
      expect(claim.symbol).toBe('handleAuth');
    });

    it('should resolve and store canonical symbolPath when provided', () => {
      useSymbolIndex({
        'src/routes.ts': [
          makeIndexedFunction('src/routes.ts', 'routes.handleAuth', 10, 50, 'handleAuth'),
        ],
      });

      const sid = makeSession();
      const result = sessions.claimFiles(sid, [], {
        regions: [{ path: 'src/routes.ts', startLine: 999, endLine: 1000, symbolPath: 'routes.handleAuth' }]
      });

      expect(result.success).toBe(true);

      const claims = sessions.listAllActiveClaims();
      const claim = claims.claims.find(c => c.filePath === 'src/routes.ts');
      expect(claim.symbolPath).toBe('routes.handleAuth');
      expect(claim.symbol).toBe('handleAuth');
      expect(claim.startLine).toBe(10);
      expect(claim.endLine).toBe(50);
    });

    it('should reject invalid symbolPath for indexed files', () => {
      useSymbolIndex({
        'src/routes.ts': [
          makeIndexedFunction('src/routes.ts', 'routes.handleAuth', 10, 50, 'handleAuth'),
        ],
      });

      const sid = makeSession();
      const result = sessions.claimFiles(sid, [], {
        regions: [{ path: 'src/routes.ts', symbolPath: 'routes.missingSymbol' }]
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/symbolPath/i);
    });

    it('should preserve symbolPath when indexed data is missing but line fallback is explicit', () => {
      const sid = makeSession();
      const result = sessions.claimFiles(sid, [], {
        regions: [{ path: 'src/routes.ts', startLine: 10, endLine: 50, symbolPath: 'routes.handleAuth' }]
      });

      expect(result.success).toBe(true);

      const claims = sessions.listAllActiveClaims();
      const claim = claims.claims.find(c => c.filePath === 'src/routes.ts');
      expect(claim.symbolPath).toBe('routes.handleAuth');
      expect(claim.startLine).toBe(10);
      expect(claim.endLine).toBe(50);
    });

    it('should claim region without symbol', () => {
      const sid = makeSession();
      sessions.claimFiles(sid, [], {
        regions: [{ path: 'src/routes.ts', startLine: 100, endLine: 120 }]
      });

      const claims = sessions.listAllActiveClaims();
      const claim = claims.claims.find(c => c.filePath === 'src/routes.ts');
      expect(claim.startLine).toBe(100);
      expect(claim.endLine).toBe(120);
      expect(claim.symbol).toBeNull();
    });

    it('should claim both whole files and regions in a single call', () => {
      const sid = makeSession();
      const result = sessions.claimFiles(sid, ['src/config.ts'], {
        regions: [{ path: 'src/routes.ts', startLine: 10, endLine: 50 }]
      });

      expect(result.success).toBe(true);
      expect(result.claimed).toContain('src/config.ts');
      expect(result.claimed).toContain('src/routes.ts');
    });

    it('should validate startLine > 0', () => {
      const sid = makeSession();
      const result = sessions.claimFiles(sid, [], {
        regions: [{ path: 'src/routes.ts', startLine: 0, endLine: 50 }]
      });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/startLine/i);
    });

    it('should validate endLine >= startLine', () => {
      const sid = makeSession();
      const result = sessions.claimFiles(sid, [], {
        regions: [{ path: 'src/routes.ts', startLine: 50, endLine: 10 }]
      });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/endLine/i);
    });

    it('should validate region path is non-empty', () => {
      const sid = makeSession();
      const result = sessions.claimFiles(sid, [], {
        regions: [{ path: '', startLine: 1, endLine: 10 }]
      });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/path/i);
    });
  });

  // ===========================================================================
  // Overlap Detection
  // ===========================================================================

  describe('Overlap Detection', () => {
    it('should detect conflict: whole-file vs region', () => {
      const s1 = makeSession('session 1');
      const s2 = makeSession('session 2');

      sessions.claimFiles(s1, ['src/routes.ts']);
      const result = sessions.claimFiles(s2, [], {
        regions: [{ path: 'src/routes.ts', startLine: 10, endLine: 50 }]
      });

      expect(result.conflicts.length).toBe(1);
      expect(result.conflicts[0].sessionId).toBe(s1);
    });

    it('should detect conflict: region vs whole-file', () => {
      const s1 = makeSession('session 1');
      const s2 = makeSession('session 2');

      sessions.claimFiles(s1, [], {
        regions: [{ path: 'src/routes.ts', startLine: 10, endLine: 50 }]
      });
      const result = sessions.claimFiles(s2, ['src/routes.ts']);

      expect(result.conflicts.length).toBe(1);
      expect(result.conflicts[0].sessionId).toBe(s1);
    });

    it('should detect conflict: overlapping regions', () => {
      const s1 = makeSession('session 1');
      const s2 = makeSession('session 2');

      sessions.claimFiles(s1, [], {
        regions: [{ path: 'src/routes.ts', startLine: 10, endLine: 50 }]
      });
      const result = sessions.claimFiles(s2, [], {
        regions: [{ path: 'src/routes.ts', startLine: 40, endLine: 80 }]
      });

      expect(result.conflicts.length).toBe(1);
      expect(result.conflicts[0].sessionId).toBe(s1);
      expect(result.conflicts[0].startLine).toBe(10);
      expect(result.conflicts[0].endLine).toBe(50);
    });

    it('should NOT conflict: non-overlapping regions in same file', () => {
      const s1 = makeSession('session 1');
      const s2 = makeSession('session 2');

      sessions.claimFiles(s1, [], {
        regions: [{ path: 'src/routes.ts', startLine: 10, endLine: 50 }]
      });
      const result = sessions.claimFiles(s2, [], {
        regions: [{ path: 'src/routes.ts', startLine: 51, endLine: 100 }]
      });

      expect(result.conflicts.length).toBe(0);
    });

    it('should NOT conflict: adjacent regions (10-50 and 51-100)', () => {
      const s1 = makeSession('session 1');
      const s2 = makeSession('session 2');

      sessions.claimFiles(s1, [], {
        regions: [{ path: 'src/routes.ts', startLine: 10, endLine: 50 }]
      });
      const result = sessions.claimFiles(s2, [], {
        regions: [{ path: 'src/routes.ts', startLine: 51, endLine: 100 }]
      });

      expect(result.conflicts.length).toBe(0);
    });

    it('should NOT conflict: same file different regions from same session', () => {
      const s1 = makeSession('session 1');

      sessions.claimFiles(s1, [], {
        regions: [{ path: 'src/routes.ts', startLine: 10, endLine: 50 }]
      });
      const result = sessions.claimFiles(s1, [], {
        regions: [{ path: 'src/routes.ts', startLine: 10, endLine: 50 }]
      });

      // Same session re-claiming same region — no conflict
      expect(result.conflicts.length).toBe(0);
    });

    it('should NOT conflict: different files', () => {
      const s1 = makeSession('session 1');
      const s2 = makeSession('session 2');

      sessions.claimFiles(s1, [], {
        regions: [{ path: 'src/a.ts', startLine: 10, endLine: 50 }]
      });
      const result = sessions.claimFiles(s2, [], {
        regions: [{ path: 'src/b.ts', startLine: 10, endLine: 50 }]
      });

      expect(result.conflicts.length).toBe(0);
    });

    it('should detect conflict with exact same range from different session', () => {
      const s1 = makeSession('session 1');
      const s2 = makeSession('session 2');

      sessions.claimFiles(s1, [], {
        regions: [{ path: 'src/routes.ts', startLine: 10, endLine: 50 }]
      });
      const result = sessions.claimFiles(s2, [], {
        regions: [{ path: 'src/routes.ts', startLine: 10, endLine: 50 }]
      });

      expect(result.conflicts.length).toBe(1);
    });

    it('should detect conflict for the same symbolPath even if callers provide stale line ranges', () => {
      useSymbolIndex({
        'src/routes.ts': [
          makeIndexedFunction('src/routes.ts', 'routes.handleAuth', 10, 50, 'handleAuth'),
        ],
      });

      const s1 = makeSession('session 1');
      const s2 = makeSession('session 2');

      sessions.claimFiles(s1, [], {
        regions: [{ path: 'src/routes.ts', startLine: 1, endLine: 2, symbolPath: 'routes.handleAuth' }]
      });
      const result = sessions.claimFiles(s2, [], {
        regions: [{ path: 'src/routes.ts', startLine: 200, endLine: 300, symbolPath: 'routes.handleAuth' }]
      });

      expect(result.conflicts.length).toBe(1);
      expect(result.conflicts[0].symbolPath).toBe('routes.handleAuth');
      expect(result.conflicts[0].startLine).toBe(10);
      expect(result.conflicts[0].endLine).toBe(50);
    });

    it('should detect conflict: region fully contained in another', () => {
      const s1 = makeSession('session 1');
      const s2 = makeSession('session 2');

      sessions.claimFiles(s1, [], {
        regions: [{ path: 'src/routes.ts', startLine: 10, endLine: 100 }]
      });
      const result = sessions.claimFiles(s2, [], {
        regions: [{ path: 'src/routes.ts', startLine: 30, endLine: 60 }]
      });

      expect(result.conflicts.length).toBe(1);
    });

    it('should not conflict with released region claims', () => {
      const s1 = makeSession('session 1');
      const s2 = makeSession('session 2');

      sessions.claimFiles(s1, [], {
        regions: [{ path: 'src/routes.ts', startLine: 10, endLine: 50 }]
      });
      sessions.releaseFiles(s1, [], {
        regions: [{ path: 'src/routes.ts', startLine: 10, endLine: 50 }]
      });

      const result = sessions.claimFiles(s2, [], {
        regions: [{ path: 'src/routes.ts', startLine: 10, endLine: 50 }]
      });

      expect(result.conflicts.length).toBe(0);
    });

    it('should not conflict with claims from completed sessions', () => {
      const s1 = makeSession('session 1');
      const s2 = makeSession('session 2');

      sessions.claimFiles(s1, [], {
        regions: [{ path: 'src/routes.ts', startLine: 10, endLine: 50 }]
      });
      sessions.end(s1); // Ends + releases all

      const result = sessions.claimFiles(s2, [], {
        regions: [{ path: 'src/routes.ts', startLine: 10, endLine: 50 }]
      });

      expect(result.conflicts.length).toBe(0);
    });
  });

  // ===========================================================================
  // Release Regions
  // ===========================================================================

  describe('Release Regions', () => {
    it('should release a specific region', () => {
      const sid = makeSession();
      sessions.claimFiles(sid, [], {
        regions: [
          { path: 'src/routes.ts', startLine: 10, endLine: 50 },
          { path: 'src/routes.ts', startLine: 100, endLine: 120 }
        ]
      });

      const result = sessions.releaseFiles(sid, [], {
        regions: [{ path: 'src/routes.ts', startLine: 10, endLine: 50 }]
      });

      expect(result.success).toBe(true);
      expect(result.released).toContain('src/routes.ts:10-50');

      // Second region should still be active
      const claims = sessions.listAllActiveClaims();
      expect(claims.claims.length).toBe(1);
      expect(claims.claims[0].startLine).toBe(100);
    });

    it('should release all claims for a file path (whole-file release)', () => {
      const sid = makeSession();
      sessions.claimFiles(sid, [], {
        regions: [
          { path: 'src/routes.ts', startLine: 10, endLine: 50 },
          { path: 'src/routes.ts', startLine: 100, endLine: 120 }
        ]
      });

      const result = sessions.releaseFiles(sid, ['src/routes.ts']);
      expect(result.success).toBe(true);

      const claims = sessions.listAllActiveClaims();
      expect(claims.claims.length).toBe(0);
    });

    it('should release both whole-file and region claims simultaneously', () => {
      const sid = makeSession();
      sessions.claimFiles(sid, ['src/config.ts']);
      sessions.claimFiles(sid, [], {
        regions: [{ path: 'src/routes.ts', startLine: 10, endLine: 50 }]
      });

      const result = sessions.releaseFiles(sid, ['src/config.ts'], {
        regions: [{ path: 'src/routes.ts', startLine: 10, endLine: 50 }]
      });

      expect(result.success).toBe(true);
      const claims = sessions.listAllActiveClaims();
      expect(claims.claims.length).toBe(0);
    });
  });

  // ===========================================================================
  // Multi-Region Per File
  // ===========================================================================

  describe('Multi-Region Per File', () => {
    it('should allow same session to claim multiple ranges of one file', () => {
      const sid = makeSession();
      const result = sessions.claimFiles(sid, [], {
        regions: [
          { path: 'src/routes.ts', startLine: 10, endLine: 50, symbol: 'handleAuth' },
          { path: 'src/routes.ts', startLine: 100, endLine: 120, symbol: 'handleLogout' }
        ]
      });

      expect(result.success).toBe(true);

      const claims = sessions.listAllActiveClaims();
      const routeClaims = claims.claims.filter(c => c.filePath === 'src/routes.ts');
      expect(routeClaims.length).toBe(2);
    });

    it('should allow two sessions to claim non-overlapping ranges of same file', () => {
      const s1 = makeSession('session 1');
      const s2 = makeSession('session 2');

      sessions.claimFiles(s1, [], {
        regions: [{ path: 'src/routes.ts', startLine: 1, endLine: 50 }]
      });
      const result = sessions.claimFiles(s2, [], {
        regions: [{ path: 'src/routes.ts', startLine: 51, endLine: 100 }]
      });

      expect(result.conflicts.length).toBe(0);

      const claims = sessions.listAllActiveClaims();
      expect(claims.claims.length).toBe(2);
    });
  });

  // ===========================================================================
  // who-owns with Range
  // ===========================================================================

  describe('getClaimOwner with Range', () => {
    it('should return overlapping claims for a queried range', () => {
      const s1 = makeSession('session 1');
      const s2 = makeSession('session 2');

      sessions.claimFiles(s1, [], {
        regions: [{ path: 'src/routes.ts', startLine: 10, endLine: 50 }]
      });
      sessions.claimFiles(s2, [], {
        regions: [{ path: 'src/routes.ts', startLine: 80, endLine: 120 }]
      });

      // Query range 30-40 — should only overlap with s1
      const result = sessions.getClaimOwner('src/routes.ts', { startLine: 30, endLine: 40 });
      expect(result.success).toBe(true);
      expect(result.owners.length).toBe(1);
      expect(result.owners[0].sessionId).toBe(s1);
    });

    it('should resolve who-owns by symbolPath and include overlapping legacy range claims', () => {
      useSymbolIndex({
        'src/routes.ts': [
          makeIndexedFunction('src/routes.ts', 'routes.handleAuth', 10, 50, 'handleAuth'),
        ],
      });

      const s1 = makeSession('symbol owner');
      const s2 = makeSession('legacy owner');

      sessions.claimFiles(s1, [], {
        regions: [{ path: 'src/routes.ts', symbolPath: 'routes.handleAuth' }]
      });
      sessions.claimFiles(s2, [], {
        regions: [{ path: 'src/routes.ts', startLine: 30, endLine: 40 }]
      });

      const result = sessions.getClaimOwner('src/routes.ts', { symbolPath: 'routes.handleAuth' });
      expect(result.success).toBe(true);
      expect(result.owners.map(owner => owner.sessionId)).toEqual(expect.arrayContaining([s1, s2]));
    });

    it('should return whole-file claim for any queried range', () => {
      const sid = makeSession();
      sessions.claimFiles(sid, ['src/routes.ts']); // whole file

      const result = sessions.getClaimOwner('src/routes.ts', { startLine: 500, endLine: 600 });
      expect(result.success).toBe(true);
      expect(result.owners.length).toBe(1);
    });

    it('should return all overlapping claims', () => {
      const s1 = makeSession('session 1');
      const s2 = makeSession('session 2');

      sessions.claimFiles(s1, [], {
        regions: [{ path: 'src/routes.ts', startLine: 10, endLine: 50 }]
      });
      sessions.claimFiles(s2, [], {
        regions: [{ path: 'src/routes.ts', startLine: 40, endLine: 80 }]
      });

      // Query range 45-55 overlaps both
      const result = sessions.getClaimOwner('src/routes.ts', { startLine: 45, endLine: 55 });
      expect(result.owners.length).toBe(2);
    });

    it('should return empty for non-overlapping range query', () => {
      const sid = makeSession();
      sessions.claimFiles(sid, [], {
        regions: [{ path: 'src/routes.ts', startLine: 10, endLine: 50 }]
      });

      const result = sessions.getClaimOwner('src/routes.ts', { startLine: 200, endLine: 300 });
      expect(result.owners.length).toBe(0);
      expect(result.claimed).toBe(false);
    });

    it('should still work without range (backward compat — returns all claims)', () => {
      const sid = makeSession();
      sessions.claimFiles(sid, [], {
        regions: [{ path: 'src/routes.ts', startLine: 10, endLine: 50 }]
      });

      const result = sessions.getClaimOwner('src/routes.ts');
      expect(result.owners.length).toBe(1);
    });
  });

  // ===========================================================================
  // Edge Cases
  // ===========================================================================

  describe('Edge Cases', () => {
    it('should handle single-line claim (startLine === endLine)', () => {
      const sid = makeSession();
      const result = sessions.claimFiles(sid, [], {
        regions: [{ path: 'src/routes.ts', startLine: 42, endLine: 42 }]
      });

      expect(result.success).toBe(true);

      const claims = sessions.listAllActiveClaims();
      expect(claims.claims[0].startLine).toBe(42);
      expect(claims.claims[0].endLine).toBe(42);
    });

    it('should detect conflict with single-line claim overlapping a range', () => {
      const s1 = makeSession('session 1');
      const s2 = makeSession('session 2');

      sessions.claimFiles(s1, [], {
        regions: [{ path: 'src/routes.ts', startLine: 10, endLine: 50 }]
      });
      const result = sessions.claimFiles(s2, [], {
        regions: [{ path: 'src/routes.ts', startLine: 25, endLine: 25 }]
      });

      expect(result.conflicts.length).toBe(1);
    });

    it('should reject empty filePaths with empty regions', () => {
      const sid = makeSession();
      const result = sessions.claimFiles(sid, [], { regions: [] });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/filePaths/);
    });

    it('should handle mixed whole-file and region claim in getFileConflicts', () => {
      const s1 = makeSession('session 1');
      sessions.claimFiles(s1, [], {
        regions: [{ path: 'src/routes.ts', startLine: 10, endLine: 50 }]
      });

      const result = sessions.getFileConflicts(['src/routes.ts']);
      expect(result.conflicts.length).toBe(1);
      expect(result.conflicts[0].startLine).toBe(10);
      expect(result.conflicts[0].endLine).toBe(50);
    });

    it('session end() should release all region claims', () => {
      const sid = makeSession();
      sessions.claimFiles(sid, [], {
        regions: [
          { path: 'src/routes.ts', startLine: 10, endLine: 50 },
          { path: 'src/routes.ts', startLine: 100, endLine: 120 }
        ]
      });
      sessions.claimFiles(sid, ['src/config.ts']);

      sessions.end(sid);

      const claims = sessions.listAllActiveClaims();
      expect(claims.claims.length).toBe(0);
    });

    it('session delete should cascade to region claims', () => {
      const sid = makeSession();
      sessions.claimFiles(sid, [], {
        regions: [{ path: 'src/routes.ts', startLine: 10, endLine: 50 }]
      });

      sessions.remove(sid);

      const claims = sessions.listAllActiveClaims();
      expect(claims.claims.length).toBe(0);
    });

    it('should start session with region file claims', () => {
      // The start() method supports files[] but should also work alongside
      // region claims added after creation
      const result = sessions.start('test', { files: ['src/a.ts'] });
      expect(result.success).toBe(true);

      const regionResult = sessions.claimFiles(result.id, [], {
        regions: [{ path: 'src/b.ts', startLine: 1, endLine: 10 }]
      });
      expect(regionResult.success).toBe(true);

      const claims = sessions.listAllActiveClaims();
      expect(claims.claims.length).toBe(2);
    });
  });
});
