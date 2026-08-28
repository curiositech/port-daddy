import Fastify from 'fastify';
import { createTestDb } from '../setup-unit.js';
import { createSuggestions } from '../../lib/suggestions.js';

const { suggestionsPlugin } = await import('../../routes/suggestions.js');

// Build the route WITH a symbolIndex so the scan also runs the live surface pass.
// The session's worktreeId resolves to no real worktree, so resolveSurfaceSessions
// drops it → 0 sessions → no real `git diff` is ever spawned (hermetic).
function buildApp() {
  const app = Fastify();
  const db = createTestDb();
  const suggestions = createSuggestions(db);
  const sessions = {
    listAllActiveClaims: () => ({ success: true, claims: [], count: 0 }),
    list: () => ({ sessions: [{ id: 's1', agentId: 'a1', purpose: 'x', worktreeId: 'does-not-exist' }] }),
  };
  const symbolIndex = { async parseFile() {}, getSymbols: () => [], predictConflicts: () => [] };
  app.addHook('onClose', () => db.close());
  app.register(suggestionsPlugin, { deps: { suggestions, sessions, agentInbox: { send: () => ({ success: true }) }, symbolIndex } });
  return app;
}

describe('POST /suggestions/scan with symbolIndex (live surface scan wired)', () => {
  test('runs both passes and returns a semantic result', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'POST', url: '/suggestions/scan' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    // The canonical claim-tree result is spread at top level; `pairs` remains
    // inspectable while the retired overlap-only field is intentionally absent.
    expect(body).toHaveProperty('pairs');
    expect(body).not.toHaveProperty('overlaps');
    // semantic pass ran; the unresolved-worktree session was dropped → 0 sessions, no git
    expect(body.semantic).toMatchObject({ sessions: 0, conflicts: 0 });
    await app.close();
  });

  test('without symbolIndex the semantic pass is skipped (semantic: null)', async () => {
    const app = Fastify();
    const db = createTestDb();
    const suggestions = createSuggestions(db);
    app.addHook('onClose', () => db.close());
    app.register(suggestionsPlugin, {
      deps: {
        suggestions,
        sessions: { listAllActiveClaims: () => ({ success: true, claims: [], count: 0 }) },
        agentInbox: { send: () => ({ success: true }) },
      },
    });
    const res = await app.inject({ method: 'POST', url: '/suggestions/scan' });
    expect(res.json().semantic).toBeNull();
    await app.close();
  });
});
