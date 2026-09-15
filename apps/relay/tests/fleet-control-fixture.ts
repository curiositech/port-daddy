import { FleetControl } from '../src/fleet-pause-control.js';

export function memoryFleetControl(initial?: unknown, projectionKv?: KVNamespace) {
  const values = new Map<string, unknown>();
  const projectionValues = new Map<string, string>();
  const kv = projectionKv ?? {
    get: async (key: string) => projectionValues.get(key) ?? null,
    put: async (key: string, value: string) => void projectionValues.set(key, value),
    delete: async (key: string) => void projectionValues.delete(key),
  } as unknown as KVNamespace;
  if (initial !== undefined) {
    values.set('control', initial);
    if (typeof initial === 'object' && initial !== null && 'revision' in initial) {
      values.set('revision', initial.revision);
    }
  }
  const faults = { failControlPut: false };
  let tail = Promise.resolve();
  const storage = {
    get: async (key: string) => values.get(key),
    put: async (entries: Record<string, unknown>) => {
      if (faults.failControlPut && Object.hasOwn(entries, 'control')) {
        throw new Error('durable control write failed');
      }
      for (const [key, value] of Object.entries(entries)) values.set(key, value);
    },
    transaction: (callback: (store: unknown) => Promise<unknown>) => {
      const result = tail.then(() => callback(storage));
      tail = result.then(() => undefined, () => undefined);
      return result;
    },
  };
  const object = new FleetControl(
    { storage } as unknown as DurableObjectState,
    { KV: kv },
  );
  const namespace = {
    idFromName: (name: string) => name,
    get: () => ({ fetch: (request: Request) => object.fetch(request) }),
  } as unknown as DurableObjectNamespace;
  return { namespace, values, projectionValues, faults, object };
}
