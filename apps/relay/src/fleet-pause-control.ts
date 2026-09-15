/** Shared admission contract. KV projections never authorize work. */
export type FleetControlState =
  | { status: 'paused' | 'unpaused'; paused: boolean; revision: number; pausedAt: number }
  | { status: 'unknown'; paused: null; revision: null; reason: string };

export interface FleetControlServiceContract {
  admit(expectedRevision?: number, runId?: string): Promise<FleetControlState>;
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
    if (request.method !== 'POST' || !['/read', '/admit', '/set'].includes(path)) {
      return new Response('Not found', { status: 404 });
    }
    const body = await request.json() as { paused?: unknown; expectedRevision?: unknown; requestId?: unknown; runId?: unknown };
    return this.state.storage.transaction(async (storage) => {
      const current = parseFleetControl(await storage.get('control'));
      const revision = await storage.get<number>('revision');
      if (current.status !== 'unknown' && revision !== current.revision) {
        return Response.json(unknownFleetControl('revision-corrupt'));
      }
      if (path === '/set') {
        if (typeof body.paused !== 'boolean') return new Response('Invalid pause state', { status: 400 });
        if (!body.paused) {
          if (!Number.isSafeInteger(body.expectedRevision) || Number(body.expectedRevision) < 1
              || typeof body.requestId !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(body.requestId)) {
            return Response.json(unknownFleetControl('resume-precondition-required'), { status: 400 });
          }
          const previous = await storage.get<{ expectedRevision: number; result: FleetControlState }>(`resume:${body.requestId}`);
          if (previous) {
            // Replays never write. A receipt superseded by a later pause cannot
            // be presented as the current unpaused state.
            if (previous.expectedRevision !== body.expectedRevision || previous.result.revision !== current.revision) {
              return Response.json(unknownFleetControl('resume-superseded'));
            }
            return Response.json(previous.result);
          }
          if (current.status === 'unknown' || body.expectedRevision !== revision) {
            return Response.json(unknownFleetControl('revision-changed'));
          }
        }
        // A malformed persisted record cannot safely reset the monotonic epoch.
        if (revision !== undefined && (!Number.isSafeInteger(revision) || revision < 1 || revision >= Number.MAX_SAFE_INTEGER)) {
          return new Response('Invalid control revision', { status: 503 });
        }
        const next = { paused: body.paused, revision: (revision ?? 0) + 1, pausedAt: Math.floor(Date.now() / 1000) };
        await storage.put({ control: next, revision: next.revision });
        if (!body.paused) await storage.put({ [`resume:${body.requestId}`]: { expectedRevision: body.expectedRevision, result: parseFleetControl(next) } });
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
