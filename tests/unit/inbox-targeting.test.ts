import { describe, expect, test } from '@jest/globals';
import {
  describeInboxAgentAvailability,
  resolveInboxAgentTargets,
} from '../../fleet-config-ui/src/lib/inbox-targeting.ts';

describe('inbox targeting helpers', () => {
  test('dedupes and trims live inbox agent targets', () => {
    expect(resolveInboxAgentTargets(['spark', ' spark ', 'spider', ''])).toEqual([
      'spark',
      'spider',
    ]);
  });

  test('explains when configured agents exist but the fleet is not running', () => {
    expect(describeInboxAgentAvailability({
      liveAgentCount: 0,
      configuredAgentCount: 8,
      projectRunning: false,
    })).toContain('Start the fleet');
  });

  test('explains when the runtime is awake but no live inbox targets are deployed', () => {
    expect(describeInboxAgentAvailability({
      liveAgentCount: 0,
      configuredAgentCount: 3,
      projectRunning: true,
    })).toContain('currently deployed');
  });

  test('returns null when at least one live inbox target exists', () => {
    expect(describeInboxAgentAvailability({
      liveAgentCount: 1,
      configuredAgentCount: 3,
      projectRunning: true,
    })).toBeNull();
  });
});
