// tests/unit/purser/utils/freshness.test.ts
import { shouldCheckDaemonFreshness } from '../../../../cli/utils/freshness.ts';
import { shouldNudgeStaleness } from '../../../../cli/utils/staleness-nudge.ts';

describe('freshness skip logic for pd learn/tutorial', () => {
  // The two orientation commands that must be read‑only
  const ORIENTATION_ALIASES = ['learn', 'tutorial'] as const;

  test.each(ORIENTATION_ALIASES)(
    'should never trigger freshness or staleness checks for the "%s" command',
    (alias) => {
      // shouldCheckDaemonFreshness must be disabled for all typical invocation patterns
      expect(shouldCheckDaemonFreshness(alias)).toBe(false);
      expect(shouldCheckDaemonFreshness(` ${alias} `)).toBe(false);
      expect(shouldCheckDaemonFreshness(alias, [alias])).toBe(false);
      expect(shouldCheckDaemonFreshness(alias, [alias, '--direct'])).toBe(false);

      // shouldNudgeStaleness must also be disabled regardless of staleness flag
      expect(shouldNudgeStaleness(alias, false)).toBe(false);
      expect(shouldNudgeStaleness(alias, true)).toBe(false);
    },
  );
});