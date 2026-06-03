/**
 * Scheduled (cron) trigger source.
 *
 * Same primitive as the existing `schedule:` yml field — restated here
 * as a TriggerSource so the new architecture treats time the same way it
 * treats every other event source. The fleet engine still owns the
 * actual setInterval/cron evaluation; this source is a thin façade that
 * lets a ship spec say `trigger: schedule:0 8 * * *` instead of falling
 * back to a separate `schedule:` field.
 *
 * Both shapes remain valid. The yml parser routes:
 *   schedule: "0 8 * * *"      → uses the legacy cron path
 *   trigger: schedule:0 8 * * * → uses this source
 */

import type {
  FleetTriggerEvent,
  TriggerAvailability,
  TriggerHandle,
  TriggerSource,
  TriggerSpec,
} from '../types.js';

export interface CronTriggerSourceDeps {
  /**
   * The fleet engine has its own cron evaluator; we ask it to run our
   * callback on every tick that matches the expression. Pass-through so
   * we don't duplicate the implementation.
   */
  scheduleCron: (expression: string, fn: () => void) => () => void;
}

export class CronTriggerSource implements TriggerSource {
  readonly kind = 'schedule' as const;

  constructor(private readonly deps: CronTriggerSourceDeps) {}

  async available(): Promise<TriggerAvailability> {
    return { ready: true };
  }

  async start(spec: TriggerSpec, emit: (event: FleetTriggerEvent) => void): Promise<TriggerHandle> {
    // The cron expression rides either as `spec.arg` (parens form) or as
    // `spec.type` when the user writes `trigger: schedule:0 8 * * *`.
    // We accept both.
    const expression = (spec.arg ?? spec.type ?? '').trim();
    if (!expression) {
      throw new Error('schedule trigger requires a cron expression');
    }

    const cancel = this.deps.scheduleCron(expression, () => {
      const event: FleetTriggerEvent<{ expression: string }> = {
        source: 'schedule',
        type: 'tick',
        timestamp: Date.now(),
        payload: { expression },
        metadata: {
          correlation_id: `cron:${expression}:${Date.now()}`,
          consent_verified: true,
        },
      };
      emit(event);
    });

    return {
      async stop() {
        cancel();
      },
    };
  }
}
