import { FleetControl } from '../src/fleet-pause-control.js';

export function memoryFleetControl(initial?: unknown) {
  const values = new Map<string, unknown>();
  if (initial !== undefined) {
    values.set('control', initial);
    if (typeof initial === 'object' && initial !== null && 'revision' in initial) {
      values.set('revision', initial.revision);
    }
  }
  let tail = Promise.resolve();
  const storage = {
    get: async (key: string) => values.get(key),
    put: async (entries: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(entries)) values.set(key, value);
    },
    transaction: (callback: (store: unknown) => Promise<unknown>) => {
      const result = tail.then(() => callback(storage));
      tail = result.then(() => undefined, () => undefined);
      return result;
    },
  };
  const object = new FleetControl({ storage } as unknown as DurableObjectState);
  const namespace = {
    idFromName: (name: string) => name,
    get: () => ({ fetch: (request: Request) => object.fetch(request) }),
  } as unknown as DurableObjectNamespace;
  return { namespace, values, object };
}
