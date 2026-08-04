/**
 * Unit Tests for the Welcome-Briefing Salvage Stitch (lib/sugar.ts W2.2)
 *
 * getWelcomeBriefing gained an optional `purpose` and an optional intentIndex
 * dep. The contract these tests defend:
 *   - purpose + intentIndex → salvageMatches populated from searchSalvage
 *   - no purpose (or no dep) → salvageMatches is ALWAYS [] (never undefined,
 *     so CLI renderers never branch on undefined)
 *   - a throwing intentIndex (embedder down / circuit open) degrades to [] —
 *     the briefing must never fail because the embedder is down.
 */

import { describe, it, expect } from '@jest/globals';
import { createSugar } from '../../lib/sugar.js';

function makeDeps(intentIndex) {
  return {
    agents: {
      register: () => ({ success: true }),
      unregister: () => ({ success: true }),
      get: () => ({ success: false }),
    },
    sessions: {
      start: () => ({ success: true, id: 'sess-1' }),
      end: () => ({ success: true }),
      list: () => ({ success: true, sessions: [] }),
      get: () => ({ success: false }),
      getNotes: () => ({ success: true, notes: [] }),
      claimFiles: () => ({ success: true }),
    },
    activityLog: { log: () => {} },
    intentIndex,
  };
}

const MATCH = {
  sessionId: 'dead-1',
  purpose: 'build the wreck-recovery welcome screen',
  similarity: 0.82,
  isDead: true,
  status: 'abandoned',
  updatedAt: Date.now(),
  completedAt: null,
  salvageAgentId: 'agent-dead-1',
  queueStatus: 'pending',
  detectedAt: Date.now(),
  hasCapsule: true,
  capsulePreview: { telosVerdict: 'partial', doable: 'yes', whyStopped: 'context exhausted' },
  command: 'pd salvage show agent-dead-1',
};

describe('getWelcomeBriefing salvage stitch', () => {
  it('populates salvageMatches when a purpose is given and the intent index is wired', async () => {
    const calls = [];
    const sugar = createSugar(makeDeps({
      searchSalvage: async (purpose, opts) => {
        calls.push({ purpose, opts });
        return [MATCH];
      },
    }));

    const briefing = await sugar.getWelcomeBriefing('fleet', 'implement salvage briefing UX');
    expect(briefing.success).toBe(true);
    expect(briefing.salvageMatches).toEqual([MATCH]);
    expect(calls).toEqual([{ purpose: 'implement salvage briefing UX', opts: { limit: 3 } }]);
  });

  it('returns an empty salvageMatches array when no purpose is given', async () => {
    const sugar = createSugar(makeDeps({
      searchSalvage: async () => { throw new Error('must not be called'); },
    }));
    const briefing = await sugar.getWelcomeBriefing('fleet');
    expect(briefing.success).toBe(true);
    expect(briefing.salvageMatches).toEqual([]);
  });

  it('returns an empty salvageMatches array when the intent index is absent', async () => {
    const sugar = createSugar(makeDeps(undefined));
    const briefing = await sugar.getWelcomeBriefing('fleet', 'some purpose');
    expect(briefing.success).toBe(true);
    expect(briefing.salvageMatches).toEqual([]);
  });

  it('degrades to empty when the intent index throws (embedder down)', async () => {
    const sugar = createSugar(makeDeps({
      searchSalvage: async () => { throw new Error('circuit OPEN for embedder'); },
    }));
    const briefing = await sugar.getWelcomeBriefing('fleet', 'some purpose');
    expect(briefing.success).toBe(true);
    expect(briefing.salvageMatches).toEqual([]);
  });
});
