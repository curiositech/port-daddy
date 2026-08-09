import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { createBudgetPause } from '../../lib/budget-pause.js';

describe('budget pause terminal races', () => {
  let killAgent;
  let broadcast;
  let pause;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
    killAgent = jest.fn();
    broadcast = jest.fn();
    pause = createBudgetPause({ killAgent, broadcast, graceMs: 60_000 });
  });

  afterEach(() => {
    pause.shutdown();
    jest.useRealTimers();
  });

  test('terminal completion disarms the pending timer idempotently', () => {
    expect(pause.arm({
      agentId: 'agent-completed',
      project: 'port-daddy',
      reason: 'budget-exceeded',
      spentTodayUsd: 1,
      budgetUsdPerDay: 1,
    })).toBe(true);

    expect(pause.cancel('agent-completed', 'spawn-completed')).toBe(true);
    expect(pause.cancel('agent-completed', 'spawn-completed')).toBe(false);
    jest.advanceTimersByTime(120_000);

    expect(killAgent).not.toHaveBeenCalled();
    expect(pause.get('agent-completed')).toBeNull();
    expect(broadcast).toHaveBeenCalledWith('budget:resolved', expect.objectContaining({
      action: 'cancelled',
      agentId: 'agent-completed',
      reason: 'spawn-completed',
    }));
  });

  test('a genuinely live over-budget run is killed once when grace expires', () => {
    pause.arm({
      agentId: 'agent-live',
      project: 'port-daddy',
      reason: 'budget-exceeded',
      spentTodayUsd: 2,
      budgetUsdPerDay: 1,
    });

    jest.advanceTimersByTime(60_000);
    jest.advanceTimersByTime(60_000);

    expect(killAgent).toHaveBeenCalledTimes(1);
    expect(killAgent).toHaveBeenCalledWith('agent-live');
    expect(pause.get('agent-live')).toBeNull();
  });

  test('completion wins a same-deadline cancellation race', () => {
    pause.arm({
      agentId: 'agent-race',
      project: 'port-daddy',
      reason: 'budget-exceeded',
      spentTodayUsd: 3,
      budgetUsdPerDay: 1,
    });

    // Move the clock to the deadline without dispatching the queued callback;
    // a terminal event delivered in this turn must still be able to disarm it.
    jest.setSystemTime(60_000);
    expect(pause.cancel('agent-race', 'spawn-over_budget')).toBe(true);
    jest.runOnlyPendingTimers();

    expect(killAgent).not.toHaveBeenCalled();
    expect(pause.list()).toEqual([]);
  });
});
