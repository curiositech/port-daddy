import { isSuspiciousHarbor, isSuspiciousHarborSegment, guardHarborInput } from '../../lib/harbor-guard.js';

describe('isSuspiciousHarborSegment', () => {
  test('flags bare integers (PR / workflow-run numbers)', () => {
    expect(isSuspiciousHarborSegment('17604542')).toBe(true);
    expect(isSuspiciousHarborSegment('42')).toBe(true);
  });

  test('flags UUIDs', () => {
    expect(isSuspiciousHarborSegment('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
  });

  test('flags known per-run prefixes', () => {
    expect(isSuspiciousHarborSegment('session-roadmap-dedup-cleanup')).toBe(true);
    expect(isSuspiciousHarborSegment('agent-adefa17c78c9a2439')).toBe(true);
    expect(isSuspiciousHarborSegment('sortie-abc123')).toBe(true);
    expect(isSuspiciousHarborSegment('run-99')).toBe(true);
    expect(isSuspiciousHarborSegment('pr-3143')).toBe(true);
  });

  test('flags a trailing hex hash suffix (real-world agent id shape)', () => {
    expect(isSuspiciousHarborSegment('agent-roadmap-dedup-cleanup-script-bdf77f43')).toBe(true);
  });

  test('flags the wf_<hex>-<n>-<n> workflow-run id shape (found live in the durable-home DB)', () => {
    expect(isSuspiciousHarborSegment('wf_64e4ce54-791-2')).toBe(true);
    expect(isSuspiciousHarborSegment('wf_ab78d24b-9a1-13')).toBe(true);
  });

  test('does NOT flag real project names', () => {
    expect(isSuspiciousHarborSegment('port-daddy')).toBe(false);
    expect(isSuspiciousHarborSegment('fleet')).toBe(false);
    expect(isSuspiciousHarborSegment('workgroup-ai')).toBe(false);
    expect(isSuspiciousHarborSegment('expungement-guide')).toBe(false);
  });

  test('empty segment is suspicious', () => {
    expect(isSuspiciousHarborSegment('')).toBe(true);
    expect(isSuspiciousHarborSegment('   ')).toBe(true);
  });
});

describe('isSuspiciousHarbor', () => {
  test('checks every colon-delimited segment', () => {
    expect(isSuspiciousHarbor('port-daddy:fleet')).toBe(false);
    expect(isSuspiciousHarbor('port-daddy:12345')).toBe(true);
    expect(isSuspiciousHarbor('session-abc:fleet')).toBe(true);
  });

  test('null/undefined/empty are not suspicious (nothing to reject)', () => {
    expect(isSuspiciousHarbor(undefined)).toBe(false);
    expect(isSuspiciousHarbor(null)).toBe(false);
    expect(isSuspiciousHarbor('')).toBe(false);
  });

  test('the real 2026-07-23 session id from this very repo is caught', () => {
    expect(isSuspiciousHarbor('session-roadmap-dedup-cleanup-script-prevent-recurrence-b9f79b15dff0')).toBe(true);
  });
});

describe('guardHarborInput', () => {
  const harborForProject = (project) => (project ? `${project}:fleet` : null);

  test('passes through a clean explicit harbor unchanged', () => {
    const resolved = guardHarborInput({ harbor: 'port-daddy', fallback: 'fleet', harborForProject });
    expect(resolved).toBe('port-daddy');
  });

  test('rejects a suspicious explicit harbor and falls back to the project harbor', () => {
    const rejected = [];
    const resolved = guardHarborInput({
      harbor: '17604542',
      project: 'port-daddy',
      fallback: 'fleet',
      harborForProject,
      onReject: (r) => rejected.push(r),
    });
    expect(resolved).toBe('port-daddy:fleet');
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({ field: 'harbor', value: '17604542', usedInstead: 'port-daddy:fleet' });
  });

  test('rejects a suspicious explicit harbor with no project, falls back to default', () => {
    const resolved = guardHarborInput({ harbor: 'session-abc-11112222', fallback: 'fleet', harborForProject });
    expect(resolved).toBe('fleet');
  });

  test('rejects a suspicious project value too', () => {
    const rejected = [];
    const resolved = guardHarborInput({
      project: 'run-42',
      fallback: 'fleet',
      harborForProject,
      onReject: (r) => rejected.push(r),
    });
    expect(resolved).toBe('fleet');
    expect(rejected[0]).toMatchObject({ field: 'project' });
  });

  test('derives from project when no harbor given', () => {
    const resolved = guardHarborInput({ project: 'port-daddy', fallback: 'fleet', harborForProject });
    expect(resolved).toBe('port-daddy:fleet');
  });
});
