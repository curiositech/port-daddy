// tests/unit/purser/utils/staleness-nudge.test.ts

/**
 * Unit tests for the `shouldNudgeStaleness` utility.
 *
 * The contract for the PR #9974 requires that the `learn` and `tutorial`
 * commands (as well as any future read‑only orientation commands) are
 * excluded from staleness nudging.  Additionally, nudging must be disabled
 * when the CLI is run in quiet mode.  This test suite verifies those
 * expectations and guards against regressions.
 *
 * The implementation lives in `cli/utils/staleness-nudge.ts` and is
 * exported as a pure function:
 *
 *   export function shouldNudgeStaleness(
 *     command: string | undefined,
 *     isQuiet: boolean,
 *   ): boolean
 *
 * The function is expected to be case‑insensitive, trim whitespace,
 * and return `false` for:
 *   - quiet mode (`isQuiet === true`);
 *   - commands that are part of the internal “skip” set (currently
 *     `learn` and `tutorial`);
 *   - undefined, empty, or whitespace‑only command strings.
 *
 * It should return `true` for any non‑skip command when not in quiet mode.
 */

import { shouldNudgeStaleness } from '../../../../cli/utils/staleness-nudge.ts';

describe('shouldNudgeStaleness', () => {
  test('does not nudge when CLI is in quiet mode, regardless of command', () => {
    expect(shouldNudgeStaleness('learn', true)).toBe(false);
    expect(shouldNudgeStaleness('tutorial', true)).toBe(false);
    expect(shouldNudgeStaleness('status', true)).toBe(false);
    expect(shouldNudgeStaleness(undefined, true)).toBe(false);
    expect(shouldNudgeStaleness('', true)).toBe(false);
  });

  test('skips nudging for read‑only orientation commands', () => {
    // Exact command strings
    expect(shouldNudgeStaleness('learn', false)).toBe(false);
    expect(shouldNudgeStaleness('tutorial', false)).toBe(false);

    // Case‑insensitivity and surrounding whitespace
    expect(shouldNudgeStaleness('  Learn  ', false)).toBe(false);
    expect(shouldNudgeStaleness('TuToRiAl', false)).toBe(false);
  });

  test('does not nudge for undefined, empty, or whitespace‑only commands', () => {
    expect(shouldNudgeStaleness(undefined, false)).toBe(false);
    expect(shouldNudgeStaleness('', false)).toBe(false);
    expect(shouldNudgeStaleness('   ', false)).toBe(false);
  });

  test('nudge is enabled for non‑skip commands when not quiet', () => {
    const positiveCommands = [
      'status',
      'list',
      'run',
      'help',
      'fooBar',
    ];

    for (const cmd of positiveCommands) {
      expect(shouldNudgeStaleness(cmd, false)).toBe(true);
    }
  });

  test('behaviour is stable under repeated calls (no hidden state)', () => {
    const cmd = 'status';
    for (let i = 0; i < 5; i++) {
      expect(shouldNudgeStaleness(cmd, false)).toBe(true);
    }
  });
});