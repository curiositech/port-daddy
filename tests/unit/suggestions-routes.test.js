import Fastify from 'fastify';
import { createTestDb } from '../setup-unit.js';
import { createSuggestions } from '../../lib/suggestions.js';

const { suggestionsPlugin } = await import('../../routes/suggestions.js');

function claim(sessionId, filePath, agentOrOpts) {
  const opts = typeof agentOrOpts === 'string' ? { agentId: agentOrOpts } : (agentOrOpts ?? {});
  return {
    filePath,
    sessionId,
    purpose: opts.purpose ?? `purpose-${sessionId}`,
    agentId: opts.agentId ?? null,
    phase: 'in_progress',
    claimedAt: 1,
    startLine: opts.startLine ?? null,
    endLine: opts.endLine ?? null,
    symbol: null,
    symbolPath: opts.symbolPath ?? null,
    repoId: opts.repoId ?? 'port-daddy',
    worldKind: opts.worldKind ?? 'worktree',
    worldId: opts.worldId ?? 'wt-a',
  };
}

function buildApp(input = []) {
  const { claims = [], symbolIndex: customSymbolIndex } = Array.isArray(input) ? { claims: input } : input;
  const app = Fastify();
  const db = createTestDb();
  const suggestions = createSuggestions(db);
  const sent = [];
  const symbolIndex = customSymbolIndex ?? {
    async parseFile() {},
    getSymbols: () => [],
    predictConflicts: () => [],
    getDependents: () => [],
  };
  const deps = {
    suggestions,
    sessions: {
      listAllActiveClaims: () => ({ success: true, claims, count: claims.length }),
      list: () => ({ sessions: [{ id: 's1', agentId: 'a1', purpose: 'x', worktreeId: 'does-not-exist' }] }),
    },
    agentInbox: {
      send: (agentId, content, options) => {
        sent.push({ agentId, content, options });
        return { success: true, messageId: sent.length };
      },
    },
    symbolIndex,
  };
  app.register(suggestionsPlugin, { deps });
  app.addHook('onClose', () => db.close());
  return { app, suggestions, sent, db };
}

describe('suggestions routes', () => {
  test('POST /suggestions/scan projects a claim-tree collision, surfaces + delivers, then lists per agent', async () => {
    const { app, sent } = buildApp([
      claim('s1', 'lib/x.ts', 'agent-1'),
      claim('s2', 'lib/x.ts', 'agent-2'),
    ]);

    const scan = await app.inject({ method: 'POST', url: '/suggestions/scan' });
    expect(scan.statusCode).toBe(200);
    expect(scan.json()).toMatchObject({ success: true, pairs: 1, surfaced: 2, delivered: 2 });
    expect(sent.map((m) => m.agentId).sort()).toEqual(['agent-1', 'agent-2']);

    const list = await app.inject({ method: 'GET', url: '/suggestions?agentId=agent-1&status=pending' });
    expect(list.statusCode).toBe(200);
    const body = list.json();
    expect(body.count).toBe(1);
    expect(body.suggestions[0].payload.other.agentId).toBe('agent-2');
    expect(body.suggestions[0].payload.state).toBe('COORDINATE');

    await app.close();
  });

  test('POST /suggestions/scan surfaces WATCH when the dependency graph proves reachability', async () => {
    const { app } = buildApp({
      claims: [
        claim('s1', 'lib/x.ts', { agentId: 'agent-1', symbolPath: 'Alpha.one' }),
        claim('s2', 'lib/x.ts', { agentId: 'agent-2', symbolPath: 'Beta.two' }),
      ],
      symbolIndex: {
        async parseFile() {},
        getSymbols: () => [],
        predictConflicts: () => [],
        getDependents(filePath, symbolPath) {
          if (filePath === 'lib/x.ts' && symbolPath === 'Alpha.one') {
            return [{ sourceFile: 'lib/x.ts', sourceSymbol: 'Beta.two', dependencyType: 'calls' }];
          }
          return [];
        },
      },
    });

    const scan = await app.inject({ method: 'POST', url: '/suggestions/scan' });
    expect(scan.statusCode).toBe(200);
    const body = scan.json();
    expect(body).toMatchObject({ success: true, pairs: 1 });
    expect(body).not.toHaveProperty('overlaps');
    expect(body.claimTree).toMatchObject({ pairs: 1, surfaced: 2, suppressed: 0, delivered: 2 });
    expect(body.semantic).toMatchObject({ sessions: 0, conflicts: 0 });

    await app.close();
  });

  test('accept transitions a suggestion; double-accept → 409; missing → 404', async () => {
    const { app } = buildApp([
      claim('s1', 'lib/x.ts', 'agent-1'),
      claim('s2', 'lib/x.ts', 'agent-2'),
    ]);
    await app.inject({ method: 'POST', url: '/suggestions/scan' });
    const list = await app.inject({ method: 'GET', url: '/suggestions?agentId=agent-1' });
    const id = list.json().suggestions[0].id;

    const ok = await app.inject({ method: 'POST', url: `/suggestions/${id}/accept` });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().suggestion.status).toBe('accepted');

    const again = await app.inject({ method: 'POST', url: `/suggestions/${id}/accept` });
    expect(again.statusCode).toBe(409);

    const missing = await app.inject({ method: 'POST', url: '/suggestions/99999/accept' });
    expect(missing.statusCode).toBe(404);

    await app.close();
  });

  test('mute requires agentId+kind, then suppresses a subsequent scan for that agent', async () => {
    const { app, sent } = buildApp([
      claim('s1', 'lib/x.ts', 'agent-1'),
      claim('s2', 'lib/x.ts', 'agent-2'),
    ]);

    const bad = await app.inject({ method: 'POST', url: '/suggestions/mute', payload: { agentId: 'agent-1' } });
    expect(bad.statusCode).toBe(400);

    const mute = await app.inject({
      method: 'POST',
      url: '/suggestions/mute',
      payload: { agentId: 'agent-1', kind: 'claim-tree-trouble', durationMs: 3600_000 },
    });
    expect(mute.statusCode).toBe(200);

    await app.inject({ method: 'POST', url: '/suggestions/scan' });
    // agent-1 muted → only agent-2 receives a delivery
    expect(sent.map((m) => m.agentId)).toEqual(['agent-2']);

    await app.close();
  });
});
