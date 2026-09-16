import { describe, expect, test, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import { join } from 'node:path';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import Fastify from 'fastify';
import { createTestDb } from '../setup-unit.js';
import { createSessions } from '../../lib/sessions.js';
import { createSymbolIndex } from '../../lib/symbol-index.js';
import { createAdvisor } from '../../lib/advisor.js';
import { advisorPlugin } from '../../routes/advisor.js';
import { getWorktreeInfo } from '../../lib/worktree.js';

describe('coordination advisor', () => {
  let db;
  let sessions;
  let projectRoot;
  let filePath;
  let fixtureRoot;
  let world;
  let siblingWorld;
  let foreignWorld;

  beforeAll(() => {
    fixtureRoot = mkdtempSync(join(tmpdir(), 'pd-advisor-scope-'));
    const git = (cwd, ...args) => execFileSync('git', [
      '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false',
      '-c', 'user.name=Advisor Fixture', '-c', 'user.email=advisor@example.test', ...args,
    ], { cwd, stdio: 'ignore' });
    for (const name of ['repo', 'foreign']) {
      const root = join(fixtureRoot, name);
      mkdirSync(root);
      git(root, 'init');
      git(root, 'commit', '--allow-empty', '-m', 'fixture');
    }
    git(join(fixtureRoot, 'repo'), 'worktree', 'add', '--detach', join(fixtureRoot, 'stage'));
    git(join(fixtureRoot, 'repo'), 'worktree', 'add', '--detach', join(fixtureRoot, 'sibling'));
    world = getWorktreeInfo(join(fixtureRoot, 'stage'));
    siblingWorld = getWorktreeInfo(join(fixtureRoot, 'sibling'));
    foreignWorld = getWorktreeInfo(join(fixtureRoot, 'foreign'));
    expect(world?.isMain).toBe(false);
    expect(siblingWorld?.isMain).toBe(false);
  });

  afterAll(() => {
    rmSync(fixtureRoot, { recursive: true, force: true });
  });

  function startSession(agentId = 'agent-a', options = {}) {
    const anchor = options.world ?? world;
    const result = sessions.start(`${agentId} work`, {
      agentId, worktreeId: anchor.id, project: 'repo', metadata: { worktree: anchor }, ...options,
    });
    expect(result.success).toBe(true);
    return result.id ?? result.session.id;
  }

  function evaluate(sessionId, files = ['src/target.ts'], extra = {}) {
    return createAdvisor(db).evaluate({ projectRoot, sessionId, files, ...extra });
  }

  function expectClaimed(result) {
    expect(result.advice.some(item => item.category === 'context')).toBe(false);
    expect(result.advice.map(item => item.id)).not.toContain('claims.unclaimed-requested-files');
  }

  beforeEach(() => {
    db = createTestDb();
    sessions = createSessions(db);
    createSymbolIndex(db);
    projectRoot = world.root;
    filePath = join(projectRoot, 'src', 'target.ts');
  });

  afterEach(() => {
    db.close();
  });

  test('flags a supplied session id that is missing from daemon state', () => {
    const advisor = createAdvisor(db);
    const result = advisor.evaluate({
      projectRoot,
      sessionId: 'session-does-not-exist',
      task: 'edit target',
    });

    expect(result.success).toBe(true);
    expect(result.advice.map(item => item.id)).toContain('context.session-missing');
    const item = result.advice.find(entry => entry.id === 'context.session-missing');
    expect(item.severity).toBe('critical');
  });

  test('warns when files are requested but symbol index data is missing', () => {
    const sessionId = startSession();
    const advisor = createAdvisor(db);

    const result = advisor.evaluate({
      projectRoot,
      sessionId,
      agentId: 'agent-a',
      files: [filePath],
    });

    expect(result.advice.map(item => item.id)).toContain('symbols.refresh-needed');
    expect(result.advice.map(item => item.id)).toContain('claims.unclaimed-requested-files');
  });

  test('reports active file-claim contention from another session', () => {
    const ownerSessionId = startSession('agent-owner');
    sessions.claimFiles(ownerSessionId, [filePath]);

    const callerSessionId = startSession('agent-caller');
    const advisor = createAdvisor(db);

    const result = advisor.evaluate({
      projectRoot,
      sessionId: callerSessionId,
      agentId: 'agent-caller',
      files: [filePath],
    });

    const conflict = result.advice.find(item => item.id === 'claims.conflicting-active-claims');
    expect(conflict).toBeDefined();
    expect(conflict.severity).toBe('warning');
    expect(conflict.evidence[0].value).toBe(filePath);
  });

  test('suggests refining whole-file claims when symbols are indexed', () => {
    const sessionId = startSession();
    sessions.claimFiles(sessionId, ['src/target.ts']);
    db.prepare(`
      INSERT INTO symbols
        (file_path, symbol_name, symbol_type, symbol_path, start_line, end_line, parsed_at)
      VALUES (?, 'target', 'function', 'target', 1, 5, ?)
    `).run(filePath, Date.now());

    const advisor = createAdvisor(db);
    const result = advisor.evaluate({
      projectRoot,
      sessionId,
      agentId: 'agent-a',
      files: [filePath],
    });

    const refinement = result.advice.find(item => item.id === 'claims.refine-whole-file');
    expect(refinement).toBeDefined();
    expect(refinement.actions[0].command).toContain('--symbol-path target');
    expect(refinement.evidence[0].path).toBe(filePath);
  });

  test('suggests locks, channels, tuples, and salvage when evidence calls for them', () => {
    const advisor = createAdvisor(db, {
      resurrection: {
        pending: () => ({ agents: [{ id: 'agent-dead' }] }),
      },
      messaging: {
        discoverChannels: () => ({ channels: [] }),
      },
    });

    const result = advisor.evaluate({
      projectRoot,
      task: 'handoff blocker and publish a channel update',
      files: [join(projectRoot, 'features.manifest.json')],
      includeTupleHints: true,
    });

    const ids = result.advice.map(item => item.id);
    expect(ids).toContain('locks.non-mergeable-resource');
    expect(ids).toContain('channels.none-declared');
    expect(ids).toContain('tuples.record-durable-fact');
    expect(ids).toContain('salvage.pending');
  });

  test('POST /advisor exposes the same preflight surface through Fastify', async () => {
    const app = Fastify({ logger: false });
    await app.register(advisorPlugin, { deps: { db } });
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/advisor',
      payload: {
        projectRoot,
        sessionId: 'missing-route-session',
        files: [filePath],
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.advice.map((item) => item.id)).toContain('context.session-missing');
    await app.close();
  });

  test.each(['src/target.ts', './src/target.ts', 'absolute'])(
    'normalizes %s requests against a relative same-world claim', request => {
      const sessionId = startSession();
      sessions.claimFiles(sessionId, ['src/target.ts']);
      const result = evaluate(sessionId, [request === 'absolute' ? filePath : request]);
      expectClaimed(result);
      expect(result.input.files).toEqual([filePath]);
    },
  );

  test.each(['./src/target.ts', 'absolute'])(
    'normalizes %s stored claims and deduplicates equivalent requests', stored => {
      const sessionId = startSession();
      sessions.claimFiles(sessionId, [stored === 'absolute' ? filePath : stored]);
      const result = evaluate(sessionId, [filePath, './src/target.ts', 'src/target.ts']);
      expectClaimed(result);
      expect(result.input.files).toEqual([filePath]);
    },
  );

  test('does not borrow or conflict with same-named files in another repo, world, or root', () => {
    const caller = startSession();
    const peers = [
      startSession('other-repo', { project: 'foreign' }),
      startSession('other-worktree', { world: siblingWorld }),
      startSession('same-display-project', { world: foreignWorld }),
      startSession('colliding-world-id', { metadata: { worktree: { ...foreignWorld, id: world.id } } }),
    ];
    for (const id of peers) sessions.claimFiles(id, ['AGENTS.md']);
    const result = evaluate(caller, ['AGENTS.md']);
    expect(result.advice.map(item => item.id)).toContain('claims.unclaimed-requested-files');
    expect(result.advice.map(item => item.id)).not.toContain('claims.conflicting-active-claims');
    expect(result.advice.map(item => item.id)).not.toContain('claims.refine-whole-file');
    expect(JSON.stringify(result)).not.toContain('other-worktree');
  });

  test('another session in the exact world still produces a real relative/absolute conflict', () => {
    const owner = startSession('owner');
    sessions.claimFiles(owner, ['./AGENTS.md']);
    const caller = startSession('caller');
    const result = evaluate(caller, [join(projectRoot, 'AGENTS.md')]);
    const conflict = result.advice.find(item => item.id === 'claims.conflicting-active-claims');
    expect(conflict.evidence).toContainEqual({ label: 'claimSessionId', value: owner });
    expect(conflict.evidence[0].path).toBe(join(projectRoot, 'AGENTS.md'));
  });

  test.each(['outside', '../stage/src/target.ts', 'src/../src/target.ts'])(
    'rejects %s requests without fabricating claim coverage', request => {
      const sessionId = startSession();
      sessions.claimFiles(sessionId, ['src/target.ts']);
      const result = evaluate(sessionId, [request === 'outside' ? join(foreignWorld.root, 'src/target.ts') : request]);
      expect(result.input.files).toEqual([]);
      expect(result.advice.map(item => item.id)).toContain('context.files-outside-root');
      expect(result.advice.filter(item => item.category === 'claim')).toEqual([]);
    },
  );

  test('rejects stored outside-root and traversal claims instead of treating them as local coverage', () => {
    const sessionId = startSession();
    sessions.claimFiles(sessionId, [join(foreignWorld.root, 'src/target.ts'), 'src/../src/target.ts']);
    const result = evaluate(sessionId);
    expect(result.advice.map(item => item.id)).toContain('claims.unclaimed-requested-files');
    expect(result.advice.map(item => item.id)).not.toContain('claims.refine-whole-file');
  });

  test('rejects a symlink escape even when its requested leaf does not exist', () => {
    const link = join(projectRoot, 'escape');
    symlinkSync(foreignWorld.root, link, 'dir');
    try {
      const sessionId = startSession();
      sessions.claimFiles(sessionId, ['escape/new-file.ts']);
      const result = evaluate(sessionId, ['escape/new-file.ts']);
      expect(result.advice.map(item => item.id)).toContain('context.files-outside-root');
      expect(result.advice.filter(item => item.category === 'claim')).toEqual([]);
    } finally {
      rmSync(link);
    }
  });

  test.each(['row-world', 'anchor-id', 'root', 'repository', 'missing-anchor', 'forest-world'])(
    'reports %s inconsistency with original recorded claim evidence and no unclaimed/refinement advice', mismatch => {
      const sessionId = startSession();
      sessions.claimFiles(sessionId, ['AGENTS.md']);
      const metadata = { worktree: { ...world } };
      if (mismatch === 'row-world') db.prepare('UPDATE sessions SET worktree_id = ? WHERE id = ?').run('old-world', sessionId);
      if (mismatch === 'anchor-id') metadata.worktree.id = 'old-world';
      if (mismatch === 'root') metadata.worktree.root = foreignWorld.root;
      if (mismatch === 'missing-anchor') delete metadata.worktree;
      if (mismatch === 'forest-world') db.prepare('UPDATE claim_forest_nodes SET world_id = ?').run('old-world');
      db.prepare('UPDATE sessions SET metadata = ? WHERE id = ?').run(JSON.stringify(metadata), sessionId);
      const before = db.serialize();
      const result = evaluate(sessionId, ['AGENTS.md'], mismatch === 'repository' ? { project: 'foreign' } : {});
      const diagnostic = result.advice.find(item => item.id === 'context.claim-scope-inconsistent');
      expect(diagnostic?.severity).toBe('critical');
      expect(diagnostic.evidence).toContainEqual({ label: 'recordedClaimCount', value: 1 });
      expect(diagnostic.evidence).toContainEqual({ label: 'recordedClaim', value: 'AGENTS.md', path: 'AGENTS.md' });
      expect(result.advice.filter(item => item.category === 'claim')).toEqual([]);
      expect(db.serialize()).toEqual(before);
    },
  );

  test('preserves symbol and line-range selectors while projecting their paths', () => {
    const owner = startSession('owner');
    expect(sessions.claimFiles(owner, [], { regions: [
      { path: 'src/target.ts', symbolPath: 'Target.method', startLine: 5, endLine: 9 },
      { path: './src/target.ts', startLine: 20, endLine: 25 },
    ] }).success).toBe(true);
    const own = evaluate(owner);
    expectClaimed(own);
    expect(own.advice.map(item => item.id)).not.toContain('claims.refine-whole-file');
    const caller = startSession('caller');
    const conflict = evaluate(caller).advice.find(item => item.id === 'claims.conflicting-active-claims');
    expect(conflict.evidence).toContainEqual({ label: 'claimedSymbol', value: 'Target.method', path: filePath });
    expect(conflict.evidence).toContainEqual({ label: 'startLine', value: 5, path: filePath });
    expect(conflict.evidence).toContainEqual({ label: 'endLine', value: 25, path: filePath });
  });

  test('does not infer a global scope without a Git root or refine other sessions with no current session', () => {
    const sessionId = startSession();
    sessions.claimFiles(sessionId, ['src/target.ts']);
    const unknown = evaluate(sessionId, ['src/target.ts'], { projectRoot: join(fixtureRoot, 'missing-root') });
    expect(unknown.advice.map(item => item.id)).toContain('context.claim-scope-unavailable');
    expect(unknown.advice.filter(item => item.category === 'claim')).toEqual([]);
    const unbound = evaluate(null, [], { project: 'foreign' });
    expect(unbound.advice.map(item => item.id)).not.toContain('context.no-current-session');
    expect(unbound.advice.map(item => item.id)).not.toContain('claims.refine-whole-file');
  });

  test('supplied agent against an anonymous session produces an explicit mismatch, not silent readiness', () => {
    const sessionId = startSession(null);
    const result = evaluate(sessionId, ['README.md'], { agentId: 'not-the-owner' });
    const mismatch = result.advice.find(item => item.id === 'context.agent-mismatch');
    expect(mismatch?.severity).toBe('critical');
    expect(mismatch.evidence).toContainEqual({ label: 'sessionAgentId', value: null });
    expect(result.advice.filter(item => item.category === 'claim')).toEqual([]);
  });

  test('repeated region claims warn about stale history while the active replacement remains claimed', () => {
    const sessionId = startSession();
    const regions = [{ path: 'src/target.ts', startLine: 3, endLine: 7 }];
    expect(sessions.claimFiles(sessionId, [], { regions }).success).toBe(true);
    expect(sessions.claimFiles(sessionId, [], { regions }).success).toBe(true);
    expect(db.prepare('SELECT COUNT(*) AS count FROM session_files WHERE released_at IS NULL').get().count).toBe(2);
    expect(db.prepare('SELECT COUNT(*) AS count FROM claim_forest_claims WHERE released_at IS NULL').get().count).toBe(1);
    const before = db.serialize();
    const result = evaluate(sessionId);
    expectClaimed(result);
    const warning = result.advice.find(item => item.id === 'claims.stale-legacy-projection');
    expect(warning?.severity).toBe('warning');
    expect(warning.evidence).toContainEqual({ label: 'staleClaimCount', value: 1 });
    expect(result.advice.map(item => item.id)).not.toContain('claims.refine-whole-file');
    expect(db.serialize()).toEqual(before);
  });

  test('normalized-spelling release cannot resurrect stale coverage, contention, or refinement', () => {
    const owner = startSession('owner');
    sessions.claimFiles(owner, ['./src/target.ts']);
    expect(sessions.releaseFiles(owner, ['src/target.ts']).success).toBe(true);
    expect(db.prepare('SELECT COUNT(*) AS count FROM session_files WHERE released_at IS NULL').get().count).toBe(1);
    expect(db.prepare('SELECT COUNT(*) AS count FROM claim_forest_claims WHERE released_at IS NULL').get().count).toBe(0);
    db.prepare(`INSERT INTO symbols
      (file_path, symbol_name, symbol_type, symbol_path, start_line, end_line, parsed_at)
      VALUES (?, 'target', 'function', 'target', 1, 5, ?)`).run(filePath, Date.now());
    const caller = startSession('caller');
    const before = db.serialize();
    for (const id of [owner, caller]) {
      const result = evaluate(id);
      expect(result.advice.map(item => item.id)).toContain('claims.stale-legacy-projection');
      expect(result.advice.map(item => item.id)).toContain('claims.unclaimed-requested-files');
      expect(result.advice.map(item => item.id)).not.toContain('claims.conflicting-active-claims');
      expect(result.advice.map(item => item.id)).not.toContain('claims.refine-whole-file');
      expect(result.advice.some(item => item.severity === 'critical')).toBe(false);
    }
    expect(db.serialize()).toEqual(before);
  });

  test('keeps verified legacy session rows readable without creating a forest table on reads', () => {
    const sessionId = startSession();
    sessions.claimFiles(sessionId, ['src/target.ts']);
    db.exec('DROP TABLE claim_forest_claims; DROP TABLE claim_forest_edges; DROP TABLE claim_forest_nodes;');
    const before = db.serialize();
    expectClaimed(evaluate(sessionId));
    expect(db.serialize()).toEqual(before);
  });

  test.each(['healthy', 'inconsistent', 'outside'])(
    'GET and POST preserve identical %s scope diagnostics and changedFiles projection', async mode => {
      const sessionId = startSession();
      sessions.claimFiles(sessionId, ['src/target.ts']);
      if (mode === 'inconsistent') db.prepare('UPDATE sessions SET worktree_id = ? WHERE id = ?').run('old-world', sessionId);
      const input = { projectRoot, project: 'repo', sessionId, changedFiles: [mode === 'outside' ? '../escape.ts' : './src/target.ts'] };
      const app = Fastify({ logger: false });
      await app.register(advisorPlugin, { deps: { db } });
      try {
        const post = await app.inject({ method: 'POST', url: '/advisor', payload: input });
        const query = new URLSearchParams({ ...input, changedFiles: input.changedFiles.join(',') });
        const get = await app.inject({ method: 'GET', url: `/advisor?${query}` });
        expect(post.statusCode).toBe(200);
        expect(get.statusCode).toBe(200);
        const { generatedAt: _postTime, ...postBody } = post.json();
        const { generatedAt: _getTime, ...getBody } = get.json();
        expect(getBody).toEqual(postBody);
      } finally {
        await app.close();
      }
    },
  );
});
