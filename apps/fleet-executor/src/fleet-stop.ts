/** All model calls in an admitted run must recheck current Cloud Fleet controls. */
import { assertFleetMayRun } from '../../../shared/fleet-controls.js';
import type { ExecutorEnv } from './env.js';

/**
 * Purpose: a stop between retries/MAP chunks cannot reuse a run-start allow.
 * @param env Existing bindings; neither the caller nor the AI binding is mutated.
 * @param installationId Trusted logical run's installation.
 * @returns Bindings whose AI.run rechecks the primary before each invocation.
 */
export function withFleetControls(env: ExecutorEnv, installationId: number | null): ExecutorEnv {
  const ai = new Proxy(env.AI, {
    /** Purpose: guard run while preserving native binding method receivers.
     * @param target Original Cloudflare AI binding.
     * @param key Requested binding property.
     * @returns Guarded run, bound method or unchanged property.
     */
    get(target, key) {
      const value = Reflect.get(target, key, target);
      if (key === 'run' && typeof value === 'function') {
        return async (...args: unknown[]) => {
          await assertFleetMayRun(env.DB, installationId);
          return Reflect.apply(value, target, args);
        };
      }
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return { ...env, AI: ai };
}
