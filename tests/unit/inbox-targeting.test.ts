import { describe, expect, test } from '@jest/globals';
import {
  describeInboxAgentAvailability,
  resolveInboxAgentTargets,
} from '../../fleet-config-ui/src/lib/inbox-targeting.ts';

describe('inbox targeting helpers', () => {
  const actor = (patch: Partial<Parameters<typeof resolveInboxAgentTargets>[0][number]>) => ({
    id: patch.id ?? patch.inboxTarget ?? 'agent',
    label: patch.label ?? patch.inboxTarget ?? patch.id ?? 'agent',
    purpose: null,
    identity: null,
    fleetAgentName: patch.fleetAgentName ?? null,
    inboxTarget: patch.inboxTarget ?? patch.id ?? 'agent',
    isConfiguredFleetAgent: patch.isConfiguredFleetAgent ?? true,
    actorKind: patch.actorKind ?? 'triggered',
    actorState: patch.actorState ?? 'idle',
    actorStateReason: patch.actorStateReason ?? 'Known actor with no current body.',
    runtimeStatus: null,
    liveness: null,
    lastActivityAt: patch.lastActivityAt ?? null,
    lastSummary: null,
    recentFiles: [],
    registry: null,
    spawned: null,
    salvage: null,
    sessions: [],
  });

  test('dedupes actor inbox targets and prioritizes live bodies first', () => {
    expect(resolveInboxAgentTargets([
      actor({ inboxTarget: 'spark', actorState: 'idle', lastActivityAt: 10 }),
      actor({ inboxTarget: 'spider', actorState: 'running', lastActivityAt: 5 }),
      actor({ inboxTarget: 'spark', actorState: 'running', lastActivityAt: 20 }),
    ])).toMatchObject([
      { target: 'spark', actorState: 'running' },
      { target: 'spider', actorState: 'running' },
    ]);
  });

  test('explains when configured agents exist but the fleet is not running', () => {
    expect(describeInboxAgentAvailability({
      actorCount: 0,
      configuredAgentCount: 8,
      projectRunning: false,
    })).toContain('Start the fleet');
  });

  test('explains when the runtime is awake but no live inbox targets are deployed', () => {
    expect(describeInboxAgentAvailability({
      actorCount: 0,
      configuredAgentCount: 3,
      projectRunning: true,
    })).toContain('has not surfaced any actor state');
  });

  test('returns null when at least one actor inbox target exists', () => {
    expect(describeInboxAgentAvailability({
      actorCount: 1,
      configuredAgentCount: 3,
      projectRunning: true,
    })).toBeNull();
  });
});
