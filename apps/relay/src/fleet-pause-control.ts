/** Shared admission contract. KV projections never authorize work. */
export type FleetControlState =
  | { status: 'paused' | 'unpaused'; paused: boolean; revision: number; pausedAt: number }
  | { status: 'unknown'; paused: null; revision: null; reason: string };

export interface FleetControlServiceContract {
  admit(expectedRevision?: number, runId?: string): Promise<FleetControlState>;
}

export interface FleetResumeRequest {
  expectedRevision: number;
  requestId: string;
}

export type FleetResumePreparation =
  | {
      status: 'prepared';
      paused: true;
      revision: number;
      targetRevision: number;
      effectiveAt: number;
      requestId: string;
    }
  | FleetControlState;

interface FleetResumeReceipt {
  phase: 'prepared' | 'committed';
  expectedRevision: number;
  targetRevision: number;
  effectiveAt: number;
}

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
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (request.method !== 'POST'
        || !['/read', '/admit', '/set', '/prepare-resume', '/commit-resume'].includes(path)) {
      return new Response('Not found', { status: 404 });
    }
    const body = await request.json() as {
      paused?: unknown;
      expectedRevision?: unknown;
      targetRevision?: unknown;
      requestId?: unknown;
      runId?: unknown;
    };
    return this.state.storage.transaction(async (storage) => {
      const current = parseFleetControl(await storage.get('control'));
      const revision = await storage.get<number>('revision');
      if (current.status !== 'unknown' && revision !== current.revision) {
        return Response.json(unknownFleetControl('revision-corrupt'));
      }
      const expectedRevision = Number(body.expectedRevision);
      const requestId = typeof body.requestId === 'string' ? body.requestId : '';
      const validResume = Number.isSafeInteger(expectedRevision)
        && expectedRevision >= 1
        && /^[A-Za-z0-9._:-]{1,128}$/.test(requestId);
      if (path === '/prepare-resume') {
        if (!validResume) {
          return Response.json(unknownFleetControl('resume-precondition-required'), { status: 400 });
        }
        const key = `resume:${requestId}`;
        const previous = await storage.get<FleetResumeReceipt>(key);
        if (previous) {
          if (previous.expectedRevision !== expectedRevision) {
            return Response.json(unknownFleetControl('resume-superseded'));
          }
          if (previous.phase === 'committed') {
            if (current.status !== 'unpaused' || current.revision !== previous.targetRevision) {
              return Response.json(unknownFleetControl('resume-superseded'));
            }
            return Response.json(current);
          }
          if (current.status !== 'paused' || current.revision !== previous.expectedRevision) {
            return Response.json(unknownFleetControl('revision-changed'));
          }
          return Response.json({
            status: 'prepared',
            paused: true,
            revision: previous.expectedRevision,
            targetRevision: previous.targetRevision,
            effectiveAt: previous.effectiveAt,
            requestId,
          } satisfies FleetResumePreparation);
        }
        if (current.status !== 'paused' || expectedRevision !== revision || revision === undefined) {
          return Response.json(unknownFleetControl('revision-changed'));
        }
        if (revision >= Number.MAX_SAFE_INTEGER) {
          return Response.json(unknownFleetControl('revision-exhausted'));
        }
        const receipt: FleetResumeReceipt = {
          phase: 'prepared',
          expectedRevision: revision,
          targetRevision: revision + 1,
          effectiveAt: Math.floor(Date.now() / 1000),
        };
        await storage.put({ [key]: receipt });
        return Response.json({
          status: 'prepared',
          paused: true,
          revision,
          targetRevision: receipt.targetRevision,
          effectiveAt: receipt.effectiveAt,
          requestId,
        } satisfies FleetResumePreparation);
      }
      if (path === '/commit-resume') {
        if (!validResume || !Number.isSafeInteger(body.targetRevision)
            || Number(body.targetRevision) <= Number(body.expectedRevision)) {
          return Response.json(unknownFleetControl('resume-precondition-required'), { status: 400 });
        }
        const key = `resume:${requestId}`;
        const previous = await storage.get<FleetResumeReceipt>(key);
        if (!previous || previous.expectedRevision !== expectedRevision
            || previous.targetRevision !== Number(body.targetRevision)) {
          return Response.json(unknownFleetControl('resume-not-prepared'));
        }
        if (previous.phase === 'committed') {
          if (current.status !== 'unpaused' || current.revision !== previous.targetRevision) {
            return Response.json(unknownFleetControl('resume-superseded'));
          }
          return Response.json(current);
        }
        if (current.status !== 'paused' || current.revision !== previous.expectedRevision
            || revision !== previous.expectedRevision) {
          return Response.json(unknownFleetControl('revision-changed'));
        }
        const next = {
          paused: false,
          revision: previous.targetRevision,
          pausedAt: previous.effectiveAt,
        };
        const result = parseFleetControl(next);
        await storage.put({
          control: next,
          revision: next.revision,
          [key]: { ...previous, phase: 'committed' } satisfies FleetResumeReceipt,
        });
        return Response.json(result);
      }
      if (path === '/set') {
        if (typeof body.paused !== 'boolean') return new Response('Invalid pause state', { status: 400 });
        if (!body.paused) {
          return Response.json(unknownFleetControl('resume-protocol-required'), { status: 409 });
        }
        // A malformed persisted record cannot safely reset the monotonic epoch.
        if (revision !== undefined && (!Number.isSafeInteger(revision) || revision < 1 || revision >= Number.MAX_SAFE_INTEGER)) {
          return new Response('Invalid control revision', { status: 503 });
        }
        const next = { paused: body.paused, revision: (revision ?? 0) + 1, pausedAt: Math.floor(Date.now() / 1000) };
        await storage.put({ control: next, revision: next.revision });
        return Response.json(parseFleetControl(next));
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
  }
}

export async function fleetControlRequest(
  binding: DurableObjectNamespace | undefined, path: '/read' | '/admit' | '/set', body: object = {},
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

async function fleetResumeRequest(
  binding: DurableObjectNamespace | undefined,
  path: '/prepare-resume' | '/commit-resume',
  body: object,
): Promise<FleetResumePreparation> {
  if (!binding) return unknownFleetControl('binding-missing');
  try {
    const response = await binding.get(binding.idFromName('global')).fetch(new Request(`https://fleet-control${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }));
    if (!response.ok) return unknownFleetControl('read-failed');
    const result = await response.json() as FleetResumePreparation;
    if (result.status === 'prepared') {
      if (!Number.isSafeInteger(result.revision) || result.revision < 1
          || !Number.isSafeInteger(result.targetRevision) || result.targetRevision !== result.revision + 1
          || !Number.isSafeInteger(result.effectiveAt) || result.effectiveAt < 0
          || typeof result.requestId !== 'string') {
        return unknownFleetControl('value-malformed');
      }
      return result;
    }
    if (result.status === 'unknown') return unknownFleetControl(result.reason);
    return parseFleetControl(result);
  } catch {
    return unknownFleetControl('read-failed');
  }
}

export async function prepareFleetResume(
  binding: DurableObjectNamespace | undefined,
  request: FleetResumeRequest,
): Promise<FleetResumePreparation> {
  return fleetResumeRequest(binding, '/prepare-resume', request);
}

export async function commitFleetResume(
  binding: DurableObjectNamespace | undefined,
  request: FleetResumeRequest & { targetRevision: number },
): Promise<FleetControlState> {
  const result = await fleetResumeRequest(binding, '/commit-resume', request);
  return result.status === 'prepared' ? unknownFleetControl('resume-not-committed') : result;
}
