import { describe, expect, test, beforeEach, afterEach } from '@jest/globals';
import { join } from 'node:path';
import Fastify from 'fastify';
import { createTestDb } from '../setup-unit.js';
import { createSessions } from '../../lib/sessions.js';
import { createSymbolIndex } from '../../lib/symbol-index.js';
import { createAdvisor } from '../../lib/advisor.js';
import { advisorPlugin } from '../../routes/advisor.js';

describe('coordination advisor', () => {
  let db;
  let sessions;
  let projectRoot;
  let filePath;

  beforeEach(() => {
    db = createTestDb();
    sessions = createSessions(db);
    createSymbolIndex(db);
    projectRoot = '/tmp/port-daddy-advisor-test';
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
    const started = sessions.start('advisor target work', { agentId: 'agent-a' });
    const sessionId = started.session?.id || started.id;
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
    const owner = sessions.start('owner work', { agentId: 'agent-owner' });
    const ownerSessionId = owner.session?.id || owner.id;
    sessions.claimFiles(ownerSessionId, [filePath]);

    const caller = sessions.start('caller work', { agentId: 'agent-caller' });
    const callerSessionId = caller.session?.id || caller.id;
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
    const started = sessions.start('whole file work', { agentId: 'agent-a' });
    const sessionId = started.session?.id || started.id;
    sessions.claimFiles(sessionId, [filePath]);
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
});
