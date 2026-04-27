import { describe, expect, test } from '@jest/globals';
import {
  formatSalvageNote,
  summarizeSalvageAgents,
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
        status: 'stale',
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
      statuses: { stale: 1, dead: 2 },
      ageBuckets: { recent: 1, sameDay: 1, stale: 1 },
      projects: [
        { project: 'port-daddy', count: 2 },
        { project: 'other', count: 1 },
      ],
      encryptedNotes: 1,
    });
  });
});
