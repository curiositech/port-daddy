/**
 * Tests for lib/adr-matrix.ts (ADR-0043) — the pure ADR→roadmap linkage.
 *
 * These lock the contract that makes ADRs "matter": an ADR's Implementation
 * Matrix parses into high-priority (`status: 'now'`) roadmap upserts, tagged
 * `adr:NNNN`, with dependencies wired phase-to-phase. We also parse the real
 * shipped ADR-0043 and ADR-0044 files so the docs can't silently drift from a
 * parseable shape.
 */
import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  parseAdrIdentity,
  parseImplementationMatrix,
  adrPhasesToRoadmapInputs,
  adrTextToRoadmapInputs,
} from '../../lib/adr-matrix.js';

const here = dirname(fileURLToPath(import.meta.url));
const adrDir = join(here, '..', '..', 'docs', 'adr');

const SAMPLE = `# 0099. A Test Decision

## Status

Accepted

## Decision

Do the thing.

## Implementation Matrix

| Phase | Roadmap slug | Status | Depends on | Description |
|-------|--------------|--------|------------|-------------|
| 0 | adr-0099-phase-0-spec | now | — | Write the spec |
| 1 | adr-0099-phase-1-build | building | adr-0099-phase-0-spec | Build it |
| 2 | adr-0099-phase-2-done | done | adr-0099-phase-1-build | Already shipped |

## Consequences

Good ones.
`;

describe('parseAdrIdentity', () => {
  it('extracts zero-padded number and title', () => {
    expect(parseAdrIdentity(SAMPLE)).toEqual({ number: '0099', title: 'A Test Decision' });
  });
  it('zero-pads short numbers', () => {
    expect(parseAdrIdentity('# 7. Short')).toEqual({ number: '0007', title: 'Short' });
  });
  it('returns null for non-ADR text', () => {
    expect(parseAdrIdentity('# Just A Heading')).toBeNull();
    expect(parseAdrIdentity('no heading at all')).toBeNull();
  });
});

describe('parseImplementationMatrix', () => {
  it('parses every phase row with slug/status/deps/description', () => {
    const phases = parseImplementationMatrix(SAMPLE);
    expect(phases).toHaveLength(3);
    expect(phases[0]).toEqual({
      phase: '0',
      slug: 'adr-0099-phase-0-spec',
      status: 'now',
      dependsOn: [],
      description: 'Write the spec',
    });
    expect(phases[1].dependsOn).toEqual(['adr-0099-phase-0-spec']);
    // 'building' is not a canonical RoadmapStatus → coerced to 'now'.
    expect(phases[1].status).toBe('now');
    // 'done' is canonical → preserved.
    expect(phases[2].status).toBe('done');
  });

  it('returns [] when there is no matrix section', () => {
    expect(parseImplementationMatrix('# 1. X\n\n## Decision\n\nNothing.')).toEqual([]);
  });

  it('skips the separator row and dedupes repeated slugs', () => {
    const md = `# 1. X\n## Implementation Matrix\n| Phase | Roadmap slug | Status |\n|---|---|---|\n| 0 | dup | now |\n| 1 | dup | now |\n`;
    const phases = parseImplementationMatrix(md);
    expect(phases).toHaveLength(1);
    expect(phases[0].slug).toBe('dup');
  });
});

describe('adrPhasesToRoadmapInputs', () => {
  const adr = { number: '0099', title: 'A Test Decision' };
  const phases = parseImplementationMatrix(SAMPLE);

  it('forces non-done phases to high priority (now) and tags adr:NNNN', () => {
    const inputs = adrPhasesToRoadmapInputs(adr, phases, { now: () => 123 });
    expect(inputs[0].status).toBe('now');
    expect(inputs[1].status).toBe('now'); // was 'building'
    expect(inputs[2].status).toBe('done'); // done is never re-prioritized
    expect(inputs[0].notes).toEqual([{ at: 123, by: 'adr:0099', text: 'ADR-0099 phase 0' }]);
    expect(inputs[1].dependencies).toEqual(['adr-0099-phase-0-spec']);
    expect(inputs[0].slug).toBe('adr-0099-phase-0-spec');
  });

  it('honors highPriority:false (keep written status)', () => {
    const inputs = adrPhasesToRoadmapInputs(adr, phases, { highPriority: false });
    // phase 1 was 'building' → coerced to 'now' at parse time, stays 'now'
    expect(inputs[1].status).toBe('now');
    expect(inputs[2].status).toBe('done');
  });

  it('passes harbor through when provided', () => {
    const inputs = adrPhasesToRoadmapInputs(adr, phases, { harbor: 'port-daddy' });
    expect(inputs[0].harbor).toBe('port-daddy');
  });
});

describe('adrTextToRoadmapInputs (end to end)', () => {
  it('returns null adr for non-ADR text', () => {
    expect(adrTextToRoadmapInputs('not an adr')).toEqual({ adr: null, inputs: [] });
  });
  it('produces one upsert per phase from the sample', () => {
    const { adr, inputs } = adrTextToRoadmapInputs(SAMPLE, { now: () => 1 });
    expect(adr.number).toBe('0099');
    expect(inputs).toHaveLength(3);
  });
});

describe('the real shipped ADRs parse and are roadmap-syncable', () => {
  for (const [file, n, minPhases] of [
    ['0043-adr-implementation-matrix.md', '0043', 5],
    ['0044-shadow-db-path-consolidation.md', '0044', 4],
  ]) {
    it(`ADR-${n} parses into >= ${minPhases} high-priority phases`, () => {
      const md = readFileSync(join(adrDir, file), 'utf8');
      const { adr, inputs } = adrTextToRoadmapInputs(md, { harbor: 'port-daddy', now: () => 0 });
      expect(adr.number).toBe(n);
      expect(inputs.length).toBeGreaterThanOrEqual(minPhases);
      // Every synced phase is high priority and carries the ADR provenance note.
      for (const i of inputs) {
        expect(i.status).toBe('now');
        expect(i.slug.startsWith(`adr-${n}-phase-`)).toBe(true);
        expect(i.notes[0].by).toBe(`adr:${n}`);
      }
    });
  }
});
