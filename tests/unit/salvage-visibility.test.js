import { describe, expect, test } from '@jest/globals';
import {
  formatSalvageNote,
  selectNextSalvageWork,
  summarizeSalvageAgents,
  triageSalvageAgents,
} from '../../cli/commands/resurrection.js';

describe('salvage CLI visibility helpers', () => {
  test('redacts encrypted note payloads instead of printing ciphertext blobs', () => {
    const encrypted = JSON.stringify({
      iv: 'abc',
      ct: 'very-long-ciphertext-that-should-not-fill-the-salvage-report',
      tag: 'def',
      v: 1,
    });

    expect(formatSalvageNote(encrypted)).toContain('encrypted note redacted');
    expect(formatSalvageNote(encrypted)).not.toContain('very-long-ciphertext');
    expect(formatSalvageNote('plain handoff')).toBe('plain handoff');
  });

  test('summarizes stale queue status, age, projects, and encrypted-note noise', () => {
    const now = 1_000_000_000;
    const agents = [
      {
        id: 'a',
        name: 'a',
        purpose: null,
        sessionId: null,
        lastHeartbeat: now - 60_000,
        staleSince: now - 60_000,
        status: 'pending',
        notes: [],
        identityProject: 'port-daddy',
        identityStack: null,
        identityContext: null,
      },
      {
        id: 'b',
        name: 'b',
        purpose: null,
        sessionId: null,
        lastHeartbeat: now - 3 * 60 * 60 * 1000,
        staleSince: now - 3 * 60 * 60 * 1000,
        status: 'dead',
        notes: [JSON.stringify({ iv: 'i', ct: 'c', tag: 't' })],
        identityProject: 'port-daddy',
        identityStack: null,
        identityContext: null,
      },
      {
        id: 'c',
        name: 'c',
        purpose: null,
        sessionId: null,
        lastHeartbeat: now - 2 * 24 * 60 * 60 * 1000,
        staleSince: now - 2 * 24 * 60 * 60 * 1000,
        status: 'dead',
        notes: [],
        identityProject: 'other',
        identityStack: null,
        identityContext: null,
      },
    ];

    expect(summarizeSalvageAgents(agents, now)).toEqual({
      total: 3,
      statuses: { pending: 1, dead: 2 },
      ageBuckets: { recent: 1, sameDay: 1, stale: 1 },
      projects: [
        { project: 'port-daddy', count: 2 },
        { project: 'other', count: 1 },
      ],
      encryptedNotes: 1,
    });
  });

  test('triages salvage agents into operator action buckets', () => {
    const now = 1_000_000_000;
    const agents = [
      {
        id: 'recent',
        name: 'recent',
        purpose: 'Continue docs cleanup',
        sessionId: 'session-recent',
        lastHeartbeat: now - 30_000,
        staleSince: now - 30_000,
        status: 'dead',
        notes: [],
        identityProject: 'port-daddy',
        identityStack: 'docs',
        identityContext: null,
      },
      {
        id: 'landed',
        name: 'landed',
        purpose: null,
        sessionId: 'session-landed',
        lastHeartbeat: now - 48 * 60 * 60 * 1000,
        staleSince: now - 48 * 60 * 60 * 1000,
        status: 'dead',
        notes: ['Committed and pushed abc123. Validation passed.'],
        identityProject: 'port-daddy',
        identityStack: 'runtime',
        identityContext: null,
      },
      {
        id: 'stale-test',
        name: 'stale-test',
        purpose: null,
        sessionId: 'session-test',
        lastHeartbeat: now - 48 * 60 * 60 * 1000,
        staleSince: now - 48 * 60 * 60 * 1000,
        status: 'dead',
        notes: ['Recovered from stale context'],
        identityProject: 'port-daddy',
        identityStack: 'test',
        identityContext: 'stale-note',
      },
      {
        id: 'empty',
        name: 'empty',
        purpose: null,
        sessionId: null,
        lastHeartbeat: now - 48 * 60 * 60 * 1000,
        staleSince: now - 48 * 60 * 60 * 1000,
        status: 'dead',
        notes: [],
        identityProject: null,
        identityStack: null,
        identityContext: null,
      },
      {
        id: 'ambiguous',
        name: 'ambiguous',
        purpose: 'Inspect old roadmap note',
        sessionId: 'session-ambiguous',
        lastHeartbeat: now - 48 * 60 * 60 * 1000,
        staleSince: now - 48 * 60 * 60 * 1000,
        status: 'dead',
        notes: ['Looked at recovery queue.'],
        identityProject: 'port-daddy',
        identityStack: 'roadmap',
        identityContext: null,
      },
    ];

    const plan = triageSalvageAgents(agents, now);
    const bucketIds = Object.fromEntries(
      plan.buckets.map(bucket => [bucket.id, bucket.agents.map(agent => agent.id)])
    );

    expect(bucketIds['resume-now']).toEqual(['recent']);
    expect(bucketIds['verify-dismiss']).toEqual(['landed']);
    expect(bucketIds['test-noise']).toEqual(['stale-test']);
    expect(bucketIds['no-evidence']).toEqual(['empty']);
    expect(bucketIds['archive-later']).toEqual(['ambiguous']);
    expect(plan.buckets.find(bucket => bucket.id === 'resume-now').agents[0].command).toBe('pd salvage claim recent');
    expect(plan.buckets.find(bucket => bucket.id === 'verify-dismiss').agents[0].command).toBe('pd salvage dismiss landed');
    expect(plan.buckets.find(bucket => bucket.id === 'test-noise').agents[0].command).toBe('pd salvage dismiss stale-test');
    expect(plan.nextActions.join(' ')).toContain('--json');
  });

  test('selects one bounded item for idle-agent queue pulls', () => {
    const now = 1_000_000_000;
    const baseAgent = {
      name: 'agent',
      purpose: null,
      sessionId: null,
      lastHeartbeat: now - 48 * 60 * 60 * 1000,
      staleSince: now - 48 * 60 * 60 * 1000,
      status: 'dead',
      notes: [],
      identityProject: 'port-daddy',
      identityStack: null,
      identityContext: null,
    };
    const plan = triageSalvageAgents([
      {
        ...baseAgent,
        id: 'landed',
        notes: ['Committed and pushed abc123. Validation passed.'],
      },
      {
        ...baseAgent,
        id: 'ambiguous',
        purpose: 'Inspect old roadmap note',
        notes: ['Looked at recovery queue.'],
      },
      {
        ...baseAgent,
        id: 'recent',
        lastHeartbeat: now - 30_000,
        staleSince: now - 30_000,
      },
    ], now);

    expect(selectNextSalvageWork(plan).item.id).toBe('recent');
    expect(selectNextSalvageWork(plan, 'archive-later').item.id).toBe('ambiguous');
    expect(selectNextSalvageWork(plan, 'verify-dismiss').item.command).toBe('pd salvage dismiss landed');
  });

  test('does not spend default idle-agent pulls on cleanup-only buckets', () => {
    const now = 1_000_000_000;
    const plan = triageSalvageAgents([
      {
        id: 'landed',
        name: 'landed',
        purpose: null,
        sessionId: 'session-landed',
        lastHeartbeat: now - 48 * 60 * 60 * 1000,
        staleSince: now - 48 * 60 * 60 * 1000,
        status: 'dead',
        notes: ['Committed and pushed abc123. Validation passed.'],
        identityProject: 'port-daddy',
        identityStack: 'runtime',
        identityContext: null,
      },
    ], now);

    expect(selectNextSalvageWork(plan)).toBeNull();
    expect(selectNextSalvageWork(plan, 'verify-dismiss').item.id).toBe('landed');
  });
});
