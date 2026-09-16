/**
 * Fresh, fail-closed Fleet automation admission shared by queue boundaries.
 *
 * The Durable Object is the canonical global authority. The temporary KV
 * projection is a required mixed-version veto witness: it can only add a
 * denial, never authorize work without the Durable Object. Repository controls
 * are read from D1 on every boundary. Missing, malformed, or unreadable state
 * at any layer denies automated work.
 */

import type { ExecutorEnv, FleetRunJob } from './env.js';
import { parseFleetControl } from '../../relay/src/fleet-pause-control.js';
import { readRepoShipControls, repoShipEnabled } from '../../shared/repo-ship-controls.js';
import { runIdForDelivery } from './delivery-failure.js';

export type FleetPauseGate = {
  status: 'paused' | 'unpaused' | 'unknown';
  blocked: boolean;
  reason: string;
  revision?: number;
};

type LegacyPauseProjection =
  | { status: 'paused' | 'unpaused'; paused: boolean }
  | { status: 'unknown'; reason: string };

async function readLegacyPauseProjection(env: ExecutorEnv): Promise<LegacyPauseProjection> {
  if (!env.CONTROL_KV) return { status: 'unknown', reason: 'binding-missing' };
  try {
    const raw = await env.CONTROL_KV.get('fleet:paused');
    if (raw == null) return { status: 'unknown', reason: 'value-missing' };
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      return { status: 'unknown', reason: 'value-malformed' };
    }
    const paused = typeof value === 'boolean'
      ? value
      : typeof value === 'object' && value != null
        ? (value as { paused?: unknown }).paused
        : undefined;
    if (typeof paused !== 'boolean') return { status: 'unknown', reason: 'value-malformed' };
    return { status: paused ? 'paused' : 'unpaused', paused };
  } catch {
    return { status: 'unknown', reason: 'read-failed' };
  }
}

/** Read the global cloud control and its deny-only rollout witness. */
export async function readFleetPauseGate(
  env: ExecutorEnv,
  expectedRevision?: number,
  runId?: string,
): Promise<FleetPauseGate> {
  if (!env.FLEET_CONTROL) {
    return { status: 'unknown', blocked: true, reason: 'binding-missing' };
  }
  try {
    const [raw, legacy] = await Promise.all([
      env.FLEET_CONTROL.admit(expectedRevision, runId),
      readLegacyPauseProjection(env),
    ]);
    const parsed = raw?.status === 'unknown' ? raw : parseFleetControl(raw);
    if (parsed.status === 'unknown') {
      return { status: 'unknown', blocked: true, reason: parsed.reason };
    }
    if (legacy.status === 'unknown') {
      return { status: 'unknown', blocked: true, reason: legacy.reason, revision: parsed.revision };
    }
    if (legacy.paused) {
      return {
        status: 'paused',
        blocked: true,
        reason: 'legacy-pause-projection',
        revision: parsed.revision,
      };
    }
    if (expectedRevision !== undefined && parsed.revision !== expectedRevision) {
      return { status: 'unknown', blocked: true, reason: 'revision-changed' };
    }
    return {
      status: parsed.status,
      blocked: parsed.paused,
      reason: `operator-${parsed.status}`,
      revision: parsed.revision,
    };
  } catch {
    return { status: 'unknown', blocked: true, reason: 'read-failed' };
  }
}

/** Recheck every authority that can stop one automated Fleet boundary. */
export async function fleetAutomationControlBlockReason(
  env: ExecutorEnv,
  job: FleetRunJob,
): Promise<string | null> {
  const runId = `${job.repoFullName}/${runIdForDelivery(job.deliveryId)}`;
  const global = await readFleetPauseGate(env, undefined, runId);
  if (global.blocked) {
    return global.status === 'paused' && global.reason === 'operator-paused'
      ? 'global-control-paused'
      : global.reason === 'legacy-pause-projection'
        ? global.reason
        : `global-control-${global.reason}`;
  }
  const repo = await readRepoShipControls(env.DB, job.repoFullName ?? '');
  return repoShipEnabled(repo, '*')
    ? null
    : repo.available
      ? 'repository-off'
      : 'repository-control-unavailable';
}

export class FleetAutomationControlError extends Error {
  constructor(readonly reason: string, readonly boundary: string) {
    super(`Fleet suspended at ${boundary}: ${reason}`);
    this.name = 'FleetAutomationControlError';
  }
}

/** Throw a typed hold signal immediately before an automated external effect. */
export async function assertFleetAutomationControl(
  env: ExecutorEnv,
  job: FleetRunJob,
  boundary: string,
): Promise<void> {
  const reason = await fleetAutomationControlBlockReason(env, job);
  if (reason) throw new FleetAutomationControlError(reason, boundary);
}
