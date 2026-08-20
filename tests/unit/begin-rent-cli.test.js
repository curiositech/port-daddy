/**
 * S3 rent-at-claim — CLI-level gate for `pd begin`.
 *
 * `resolveBeginRent` is the pure resolver behind the gate:
 *   - --roadmap / --sidequest / --roadmap-new are mutually exclusive
 *   - none given: PD_RENT_EXEMPT=hotfix|chore is a sanctioned opt-out;
 *     TTY → prompt; non-TTY → 3-option rent message (never names a bypass)
 */

import {
  resolveBeginRent,
  resolveRelinkRent,
  shouldRunBeginWizard,
  formatRentReceipt,
  RENT_GATE_MESSAGE,
  RELINK_GATE_MESSAGE,
} from '../../cli/commands/sugar.js';

const noEnv = {};

describe('shouldRunBeginWizard — scripted begin never prompts', () => {
  test('a bare interactive begin enters the wizard', () => {
    expect(shouldRunBeginWizard(undefined, {}, true)).toBe(true);
  });

  test.each([
    ['identity', { identity: 'project:stack:context' }],
    ['agent', { agent: 'agent-1' }],
    ['files', { files: ['src/a.ts'] }],
    ['lifecycle', { lifecycle: 'durable' }],
    ['name', { name: 'named-session' }],
  ])('%s scoping disables the wizard even in a TTY', (_label, options) => {
    expect(shouldRunBeginWizard(undefined, options, true)).toBe(false);
  });

  test('a supplied purpose or non-interactive shell never enters the wizard', () => {
    expect(shouldRunBeginWizard('planned work', {}, true)).toBe(false);
    expect(shouldRunBeginWizard(undefined, {}, false)).toBe(false);
  });
});

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

// =============================================================================
// Anti-Goodhart valve: pd session relink — a wrong link is never sticky.
// =============================================================================

describe('resolveRelinkRent — flag matrix', () => {
  test('--roadmap <slug> resolves to a roadmap link', () => {
    const res = resolveRelinkRent({ roadmap: 'adr-0090-database-distribution' });
    expect(res.ok).toBe(true);
    expect(res.roadmapLink).toBe('adr-0090-database-distribution');
  });

  test('--sidequest "<reason>" resolves to an opt-out reason', () => {
    const res = resolveRelinkRent({ sidequest: 'scope shrank to an off-roadmap spike' });
    expect(res.ok).toBe(true);
    expect(res.sidequestReason).toBe('scope shrank to an off-roadmap spike');
  });

  test('--sidequest under 12 chars is rejected', () => {
    const res = resolveRelinkRent({ sidequest: 'too short' });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/12/);
  });

  test('a valueless --roadmap flag is a usage error', () => {
    const res = resolveRelinkRent({ roadmap: true });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/--roadmap/);
  });

  test('both flags at once are mutually exclusive', () => {
    const res = resolveRelinkRent({ roadmap: 'x-slug', sidequest: 'also a sidequest somehow' });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/mutually exclusive/i);
  });

  test('neither flag fails with the 2-option relink message', () => {
    const res = resolveRelinkRent({});
    expect(res.ok).toBe(false);
    expect(res.error).toBe(RELINK_GATE_MESSAGE);
  });

  test('relink message names exactly the two correct actions and no bypass', () => {
    expect(RELINK_GATE_MESSAGE).toContain('--roadmap <slug>');
    expect(RELINK_GATE_MESSAGE).toContain('--sidequest');
    expect(RELINK_GATE_MESSAGE).not.toContain('--roadmap-new');
    expect(RELINK_GATE_MESSAGE).not.toContain('PD_RENT_EXEMPT');
    expect(RELINK_GATE_MESSAGE).not.toMatch(/--force|skip|bypass/i);
  });
});

describe('formatRentReceipt — the anti-Goodhart receipt line', () => {
  test('roadmap link receipt (exact snapshot)', () => {
    expect(formatRentReceipt({ roadmapLink: 'adr-0090-database-distribution' })).toBe(
      'rent paid -> adr-0090-database-distribution (change anytime: pd session relink)',
    );
  });

  test('sidequest receipt (exact snapshot)', () => {
    expect(formatRentReceipt({ sidequestReason: 'operator asked for a quick spike' })).toBe(
      'rent paid -> sidequest: operator asked for a quick spike (change anytime: pd session relink)',
    );
  });

  test('no rent paid means no receipt', () => {
    expect(formatRentReceipt({})).toBeNull();
  });
});
