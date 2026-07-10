/**
 * S3 rent-at-claim — CLI-level gate for `pd begin`.
 *
 * `resolveBeginRent` is the pure resolver behind the gate:
 *   - --roadmap / --sidequest / --roadmap-new are mutually exclusive
 *   - none given: PD_RENT_EXEMPT=hotfix|chore is a sanctioned opt-out;
 *     TTY → prompt; non-TTY → 3-option rent message (never names a bypass)
 */

import { resolveBeginRent, RENT_GATE_MESSAGE } from '../../cli/commands/sugar.js';

const noEnv = {};

describe('resolveBeginRent — flag matrix', () => {
  test('--roadmap <slug> resolves to a roadmap link', () => {
    const res = resolveBeginRent({ roadmap: 'adr-0090-database-distribution' }, noEnv, false);
    expect(res.ok).toBe(true);
    expect(res.roadmapLink).toBe('adr-0090-database-distribution');
  });

  test('--sidequest "<reason>" resolves to an opt-out reason', () => {
    const res = resolveBeginRent({ sidequest: 'operator asked for a quick spike' }, noEnv, false);
    expect(res.ok).toBe(true);
    expect(res.sidequestReason).toBe('operator asked for a quick spike');
  });

  test('--sidequest under 12 chars is rejected', () => {
    const res = resolveBeginRent({ sidequest: 'too short' }, noEnv, false);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/12/);
  });

  test('--roadmap-new "<title>" resolves to a draft title', () => {
    const res = resolveBeginRent({ 'roadmap-new': 'Rent at Claim Gate' }, noEnv, false);
    expect(res.ok).toBe(true);
    expect(res.roadmapNewTitle).toBe('Rent at Claim Gate');
  });

  test('a valueless --roadmap flag is a usage error', () => {
    const res = resolveBeginRent({ roadmap: true }, noEnv, false);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/--roadmap/);
  });

  test('two flags at once are mutually exclusive', () => {
    const res = resolveBeginRent(
      { roadmap: 'x-slug', sidequest: 'also a sidequest somehow' },
      noEnv,
      false,
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/mutually exclusive/i);
  });

  test('all three flags at once are mutually exclusive', () => {
    const res = resolveBeginRent(
      { roadmap: 'x-slug', sidequest: 'also a sidequest somehow', 'roadmap-new': 'New title' },
      noEnv,
      false,
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/mutually exclusive/i);
  });
});

describe('resolveBeginRent — none given', () => {
  test('non-TTY: fails with the 3-option rent message', () => {
    const res = resolveBeginRent({}, noEnv, false);
    expect(res.ok).toBe(false);
    expect(res.error).toBe(RENT_GATE_MESSAGE);
  });

  test('rent message names exactly the three correct actions and no bypass', () => {
    // Snapshot of the rent message contract: the three options, nothing else.
    expect(RENT_GATE_MESSAGE).toContain('--roadmap <slug>');
    expect(RENT_GATE_MESSAGE).toContain('--roadmap-new');
    expect(RENT_GATE_MESSAGE).toContain('--sidequest');
    // Never advertise the env escape hatch or any force/skip bypass.
    expect(RENT_GATE_MESSAGE).not.toContain('PD_RENT_EXEMPT');
    expect(RENT_GATE_MESSAGE).not.toMatch(/--force|skip|bypass/i);
  });

  test('TTY: asks for an interactive prompt instead of failing', () => {
    const res = resolveBeginRent({}, noEnv, true);
    expect(res.ok).toBe(false);
    expect(res.needsPrompt).toBe(true);
    expect(res.error).toBeUndefined();
  });
});

describe('resolveBeginRent — PD_RENT_EXEMPT', () => {
  test('hotfix is accepted as an opt-out with that reason', () => {
    const res = resolveBeginRent({}, { PD_RENT_EXEMPT: 'hotfix' }, false);
    expect(res.ok).toBe(true);
    expect(res.sidequestReason).toContain('hotfix');
    expect(res.sidequestReason).toContain('PD_RENT_EXEMPT');
  });

  test('chore is accepted as an opt-out with that reason', () => {
    const res = resolveBeginRent({}, { PD_RENT_EXEMPT: 'chore' }, false);
    expect(res.ok).toBe(true);
    expect(res.sidequestReason).toContain('chore');
  });

  test('values outside the bounded list are rejected', () => {
    const res = resolveBeginRent({}, { PD_RENT_EXEMPT: 'yolo' }, false);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/hotfix/);
    expect(res.error).toMatch(/chore/);
  });

  test('an explicit flag wins over the env exemption', () => {
    const res = resolveBeginRent(
      { roadmap: 'x-slug' },
      { PD_RENT_EXEMPT: 'hotfix' },
      false,
    );
    expect(res.ok).toBe(true);
    expect(res.roadmapLink).toBe('x-slug');
    expect(res.sidequestReason).toBeUndefined();
  });
});
