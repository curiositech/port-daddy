/** All model calls in an admitted run must recheck current Cloud Fleet controls. */
import { assertFleetMayRun, FleetStoppedError, type FleetControlDatabase } from '../../../shared/fleet-controls.js';
import type { ExecutorEnv } from './env.js';

/** Purpose: a refused invocation never resumes after a transient read recovers.
 * @param db Primary control database.
 * @param installationId Trusted logical run's installation.
 * @returns A fresh-read guard that retains any observed stop for this invocation.
 */
export function fleetInvocationGuard(db: FleetControlDatabase | undefined, installationId: number | null): () => Promise<void> {
  let stopped = false;
  return async () => {
    if (stopped) throw new FleetStoppedError();
    try {
      await assertFleetMayRun(db, installationId);
      // A concurrent boundary may have observed a refusal while this read ran.
      if (stopped) throw new FleetStoppedError();
    } catch (error) {
      stopped = true;
      throw error;
    }
  };
}

/**
 * Purpose: a stop between retries/MAP chunks cannot reuse a run-start allow.
 * @param env Existing bindings; neither the caller nor the AI binding is mutated.
 * @param installationId Trusted logical run's installation.
 * @param beforeAction Shared invocation guard across models and publications.
 * @returns Bindings whose AI.run rechecks the primary before each invocation.
 */
export function withFleetControls(env: ExecutorEnv, installationId: number | null,
  beforeAction = fleetInvocationGuard(env.DB, installationId)): ExecutorEnv {
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
          await beforeAction();
          return Reflect.apply(value, target, args);
        };
      }
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return { ...env, AI: ai };
}
