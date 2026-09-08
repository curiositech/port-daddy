/**
 * Observability — the unified logging / metric-retention / self-monitoring surface for Port Daddy.
 *
 * This is the ONE module a subsystem imports instead of reaching for `console.*`, a bespoke
 * `appendFileSync`, or a hand-rolled retry loop. It composes the primitives:
 *
 *   - LogGovernor        — dedup / rate-limit / sampling so loop-logging can't storm (log-governor.ts)
 *   - RetentionRegistry  — one place every table's TTL/cap policy lives, plus vacuum (retention-registry.ts)
 *   - SelfMonitor        — alarms on the daemon's OWN db/wal/row footprint (self-monitor.ts)
 *   - GatedLoader        — load-once deps fail safe with a breaker instead of forever (gated-loader.ts)
 *   - Correlation        — requestId/actorId/tenantId threaded through every line (correlation.ts)
 *
 * Migration: `getGovernor()` returns a process-wide governed logger wrapping the existing winston
 * instance (set once at daemon boot via `installGovernor`). Call sites move from
 * `logger.error('semantic_resolution_failed', meta)` (spams) to
 * `obs.governed({ key:'semantic_resolution_failed', level:'error', message:..., meta })` (bounded).
 */

import { LogGovernor, type LeveledSink } from './log-governor.js';
import { withCorrelation } from './correlation.js';

export { LogGovernor, type LeveledSink, type GovernedLog, type LogLevel } from './log-governor.js';
export {
  RetentionRegistry,
  ttlPolicy,
  maxAgePolicy,
  capPolicy,
  type RetentionPolicy,
  type SweepResult,
} from './retention-registry.js';
export {
  SelfMonitor,
  createSqliteSources,
  type MetricSources,
  type SelfMonitorConfig,
  type Alarm,
  type Sample,
} from './self-monitor.js';
export { createGatedLoader, type GatedLoader, type GatedLoaderConfig } from './gated-loader.js';
export {
  runWithContext,
  currentContext,
  withCorrelation,
  newRequestId,
  type CorrelationContext,
} from './correlation.js';

/**
 * Wrap any leveled sink so every line auto-merges the active correlation context
 * ({request_id, actor_id, tenant_id}) into its meta — no call-site changes required.
 */
export function withCorrelationSink(sink: LeveledSink): LeveledSink {
  const wrap = (level: keyof LeveledSink) =>
    (message: string, meta?: Record<string, unknown>) => sink[level](message, withCorrelation(meta));
  return { debug: wrap('debug'), info: wrap('info'), warn: wrap('warn'), error: wrap('error') };
}

let processGovernor: LogGovernor | null = null;

/**
 * Install the process-wide governed logger, wrapping the daemon's winston instance (or any
 * LeveledSink). Called once at boot in server.ts. Correlation is layered on automatically.
 */
export function installGovernor(sink: LeveledSink, cfg?: ConstructorParameters<typeof LogGovernor>[1]): LogGovernor {
  processGovernor = new LogGovernor(withCorrelationSink(sink), cfg);
  return processGovernor;
}

/**
 * The process-wide governed logger. Throws if used before `installGovernor` — that is deliberate:
 * a missing install is a wiring bug we want to see at boot, not a silent no-op that drops logs.
 */
export function getGovernor(): LogGovernor {
  if (!processGovernor) {
    throw new Error('observability: getGovernor() called before installGovernor() — wire it in server boot');
  }
  return processGovernor;
}

/** Test/hardening escape hatch: is a governor installed? */
export function hasGovernor(): boolean {
  return processGovernor !== null;
}
