/**
 * Unit Tests for the 🧭 Salvage-Match Briefing Renderer (cli/commands/sugar.ts)
 *
 * renderSalvageMatches is the exported pure formatter behind the
 * "pd begin transcript names the dead capsule" W2 verification artifact
 * (repo pattern: triageSalvageAgents is exported pure). These tests defend:
 *   - integer-percent similarity rendering
 *   - capsule verdict/doable + why-stopped lines for claimable matches
 *   - the `pd salvage show <id>` command line
 *   - the dormant (no-queue-row) fallback pointing at pd session show
 *   - empty input → empty output (caller skips the section entirely)
 * Plus the encrypted-note redaction used by the `pd salvage show` renderer
 * (formatSalvageNote), asserted here because show's terminal output is
 * composed from it.
 */

import { describe, it, expect } from '@jest/globals';
import { renderSalvageMatches } from '../../cli/commands/sugar.js';
import { formatSalvageNote } from '../../cli/commands/resurrection.js';

const DAY = 24 * 60 * 60 * 1000;

function claimableMatch(overrides = {}) {
  return {
    sessionId: 'dead-1',
    purpose: 'build the wreck-recovery welcome screen',
    similarity: 0.824,
    isDead: true,
    status: 'dead',
    updatedAt: Date.now() - 12 * DAY,
    completedAt: null,
    salvageAgentId: 'agent-dead-1',
    queueStatus: 'pending',
    detectedAt: Date.now() - 12 * DAY,
    hasCapsule: true,
    capsulePreview: {
      telosVerdict: 'partial',
      doable: 'yes',
      whyStopped: 'ran out of context window mid-refactor',
      nextPlanHead: 'finish the render function',
    },
    command: 'pd salvage show agent-dead-1',
    ...overrides,
  };
}

describe('renderSalvageMatches', () => {
  it('renders integer percent, capsule verdict, and the pd salvage show command', () => {
    const lines = renderSalvageMatches([claimableMatch()]);
    const text = lines.join('\n');

    expect(lines[0]).toContain('Salvageable Prior Work');
    expect(text).toContain('[82%]');
    expect(text).toContain('"build the wreck-recovery welcome screen"');
    expect(text).toContain('capsule: partial/yes');
    expect(text).toContain('why stopped: ran out of context window mid-refactor');
    expect(text).toContain('Next: pd salvage show agent-dead-1');
  });

  it('renders dormant matches (no queue row) with a pd session show pointer', () => {
    const lines = renderSalvageMatches([claimableMatch({
      similarity: 0.61,
      status: 'completed',
      salvageAgentId: null,
      queueStatus: null,
      detectedAt: null,
      hasCapsule: false,
      capsulePreview: null,
      command: null,
      completedAt: Date.now() - 30 * DAY,
    })]);
    const text = lines.join('\n');

    expect(text).toContain('[61%]');
    expect(text).toContain('completed 30d ago, no capsule');
    expect(text).toContain('context: pd session show dead-1');
    expect(text).not.toContain('pd salvage show');
  });

  it('truncates long purposes to the briefing cap', () => {
    const longPurpose = 'x'.repeat(400);
    const lines = renderSalvageMatches([claimableMatch({ purpose: longPurpose })]);
    const entry = lines.find((l) => l.includes('[82%]'));
    expect(entry).toContain('…');
    // 120-char purpose cap + fixed framing; well under an untruncated 400-char line.
    expect(entry.length).toBeLessThan(240);
  });

  it('returns [] for an empty or missing match list (section is skipped)', () => {
    expect(renderSalvageMatches([])).toEqual([]);
    expect(renderSalvageMatches(undefined)).toEqual([]);
  });
});

describe('encrypted-note redaction in the show render path', () => {
  it('redacts encrypted note payloads', () => {
    const encrypted = JSON.stringify({ iv: 'abc', ct: 'zzz', tag: 'ttt' });
    expect(formatSalvageNote(encrypted)).toContain('encrypted note redacted');
  });

  it('passes plain notes through verbatim', () => {
    expect(formatSalvageNote('plain progress note')).toBe('plain progress note');
  });
});
