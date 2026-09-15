/** Shared admission contract. KV projections never authorize work. */
export type FleetControlState =
  | { status: 'paused' | 'unpaused'; paused: boolean; revision: number; pausedAt: number }
  | { status: 'unknown'; paused: null; revision: null; reason: string };

export interface FleetControlServiceContract {
  admit(expectedRevision?: number, runId?: string): Promise<FleetControlState>;
}

interface FleetControlBindings {
  KV?: KVNamespace;
}

export interface FleetResumeRequest {
  expectedRevision: number;
  requestId: string;
}

interface FleetResumeReceipt {
  expectedRevision: number;
  targetRevision: number;
  effectiveAt: number;
}

const LEGACY_FLEET_PAUSE_KEY = 'fleet:paused';

export function unknownFleetControl(reason: string): FleetControlState {
  return { status: 'unknown', paused: null, revision: null, reason };
}

export function parseFleetControl(value: unknown): FleetControlState {
  if (value == null) return unknownFleetControl('value-missing');
  if (typeof value !== 'object' || Array.isArray(value)) return unknownFleetControl('value-malformed');
  const row = value as Record<string, unknown>;
  if (typeof row.paused !== 'boolean' || !Number.isSafeInteger(row.revision)
      || Number(row.revision) < 1 || !Number.isSafeInteger(row.pausedAt) || Number(row.pausedAt) < 0) {
    return unknownFleetControl('value-malformed');
  }
  return { status: row.paused ? 'paused' : 'unpaused', paused: row.paused,
    revision: Number(row.revision), pausedAt: Number(row.pausedAt) };
}

/** A single object serializes operator writes and every new ship admission. */
export class FleetControl implements DurableObject {
  private requestTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: FleetControlBindings = {},
  ) {}

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.requestTail.then(operation, operation);
    this.requestTail = result.then(() => undefined, () => undefined);
    return result;
  }

  private async mutate(body: {
    paused?: unknown;
    expectedRevision?: unknown;
    requestId?: unknown;
  }): Promise<Response> {
    if (typeof body.paused !== 'boolean') {
      return new Response('Invalid pause state', { status: 400 });
    }
    if (!this.env.KV) return Response.json(unknownFleetControl('projection-binding-missing'));

    const current = parseFleetControl(await this.state.storage.get('control'));
    const revision = await this.state.storage.get<number>('revision');
    if (current.status !== 'unknown' && revision !== current.revision) {
      return Response.json(unknownFleetControl('revision-corrupt'));
    }
    if (revision !== undefined
        && (!Number.isSafeInteger(revision) || revision < 1 || revision >= Number.MAX_SAFE_INTEGER)) {
      return Response.json(unknownFleetControl('revision-corrupt'));
    }

    if (body.paused) {
      const next = {
        paused: true,
        revision: (revision ?? 0) + 1,
        pausedAt: Math.floor(Date.now() / 1000),
      };
      // The denial projection lands first. A crash before the canonical write
      // can stop work early, but can never leave a newly paused authority
      // looking ON to a mixed-version executor.
      try {
        await this.env.KV.put(LEGACY_FLEET_PAUSE_KEY, JSON.stringify(next));
      } catch {
        return Response.json(unknownFleetControl('projection-write-failed'));
      }
      await this.state.storage.put({ control: next, revision: next.revision });
      return Response.json(parseFleetControl(next));
    }

    const expectedRevision = Number(body.expectedRevision);
    const requestId = typeof body.requestId === 'string' ? body.requestId : '';
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1
        || !/^[A-Za-z0-9._:-]{1,128}$/.test(requestId)) {
      return Response.json(unknownFleetControl('resume-precondition-required'));
    }
    const targetRevision = expectedRevision + 1;
    if (!Number.isSafeInteger(targetRevision)) {
      return Response.json(unknownFleetControl('revision-exhausted'));
    }
    const key = `resume:${requestId}`;
    const previous = await this.state.storage.get<FleetResumeReceipt>(key);
    if (previous && (previous.expectedRevision !== expectedRevision
        || previous.targetRevision !== targetRevision)) {
      return Response.json(unknownFleetControl('resume-superseded'));
    }

    // A second distinct request for the exact same paused epoch is the same
    // desired state transition. Repair its projection and acknowledge the
    // already-committed revision while still holding this object's write lock.
    if (current.status === 'unpaused' && current.revision === targetRevision
        && revision === targetRevision) {
      try {
        await this.env.KV.put(LEGACY_FLEET_PAUSE_KEY, JSON.stringify({
          paused: false,
          revision: current.revision,
          pausedAt: current.pausedAt,
        }));
      } catch {
        return Response.json(unknownFleetControl('projection-write-failed'));
      }
      await this.state.storage.put({
        [key]: {
          ...(previous ?? {
            expectedRevision,
            targetRevision,
            effectiveAt: current.pausedAt,
          }),
        } satisfies FleetResumeReceipt,
      });
      return Response.json(current);
    }
    if (current.status !== 'paused' || current.revision !== expectedRevision
        || revision !== expectedRevision) {
      return Response.json(unknownFleetControl('revision-changed'));
    }

    const effectiveAt = previous?.effectiveAt ?? Math.floor(Date.now() / 1000);
    const next = { paused: false, revision: targetRevision, pausedAt: effectiveAt };
    // Commit canonical ON first, while the existing KV denial still blocks
    // current mixed-version executors and every old executor. The single
    // Durable Object serializes the subsequent projection write, so no stale
    // caller can overwrite a newer acknowledged revision. If KV then fails,
    // this request remains unacknowledged and all current executors stay
    // blocked by the still-paused projection; retrying the same request repairs
    // that projection through the idempotent target-revision branch above.
    await this.state.storage.put({
      control: next,
      revision: next.revision,
      [key]: {
        expectedRevision,
        targetRevision,
        effectiveAt,
      } satisfies FleetResumeReceipt,
    });
    try {
      await this.env.KV.put(LEGACY_FLEET_PAUSE_KEY, JSON.stringify(next));
    } catch {
      return Response.json(unknownFleetControl('projection-write-failed'));
    }
    return Response.json(parseFleetControl(next));
  }

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (request.method !== 'POST'
        || !['/read', '/admit', '/mutate'].includes(path)) {
      return new Response('Not found', { status: 404 });
    }
    const body = await request.json() as {
      paused?: unknown;
      expectedRevision?: unknown;
      requestId?: unknown;
      runId?: unknown;
    };
    return this.serialize(async () => {
      if (path === '/mutate') return this.mutate(body);
      return this.state.storage.transaction(async (storage) => {
        const current = parseFleetControl(await storage.get('control'));
        const revision = await storage.get<number>('revision');
        if (current.status !== 'unknown' && revision !== current.revision) {
          return Response.json(unknownFleetControl('revision-corrupt'));
        }
        if (path === '/admit' && body.expectedRevision !== undefined
            && body.expectedRevision !== current.revision) {
          return Response.json(unknownFleetControl('revision-changed'));
        }
        if (path === '/admit' && body.runId !== undefined) {
          if (typeof body.runId !== 'string' || !/^[A-Za-z0-9._:/-]{1,512}$/.test(body.runId)) {
            return Response.json(unknownFleetControl('run-id-malformed'));
          }
          const runKey = `run:${body.runId}`;
          const boundRevision = await storage.get<number>(runKey);
          if (boundRevision !== undefined && boundRevision !== current.revision) {
            return Response.json(unknownFleetControl('run-revision-changed'));
          }
          // Bind the delivery to the first valid control epoch it observes,
          // including a paused epoch. Otherwise a delivery first seen while
          // paused could be rebound to the later resume revision and run even
          // though the pause/resume cycle requires a fresh delivery.
          if (boundRevision === undefined && current.status !== 'unknown') {
            await storage.put({ [runKey]: current.revision });
          }
        }
        return Response.json(current);
      });
    });
  }
}

export async function fleetControlRequest(
  binding: DurableObjectNamespace | undefined, path: '/read' | '/admit', body: object = {},
): Promise<FleetControlState> {
  if (!binding) return unknownFleetControl('binding-missing');
  try {
    const response = await binding.get(binding.idFromName('global')).fetch(new Request(`https://fleet-control${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }));
    if (!response.ok) return unknownFleetControl('read-failed');
    const result = await response.json() as FleetControlState;
    if (result.status === 'unknown') return unknownFleetControl(result.reason);
    return parseFleetControl(result);
  } catch { return unknownFleetControl('read-failed'); }
}

/**
 * Serialize the canonical control mutation and its mixed-version KV projection
 * inside the one global Durable Object. Caller-side read/write reconciliation
 * is intentionally forbidden because it has an unavoidable stale-write race.
 */
export async function mutateFleetControl(
  binding: DurableObjectNamespace | undefined,
  paused: boolean,
  resume?: FleetResumeRequest,
): Promise<FleetControlState> {
  if (!binding) return unknownFleetControl('binding-missing');
  try {
    const response = await binding.get(binding.idFromName('global')).fetch(new Request('https://fleet-control/mutate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paused, ...resume }),
    }));
    if (!response.ok) return unknownFleetControl('write-failed');
    const result = await response.json() as FleetControlState;
    if (result.status === 'unknown') return unknownFleetControl(result.reason);
    return parseFleetControl(result);
  } catch {
    return unknownFleetControl('write-failed');
  }
}
