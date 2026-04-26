import { useEffect, useState } from 'react';
import type { ShipSnapshotRequest, ShipSnapshotState } from './types';

/**
 * useShipSnapshot - fetch a snapshot-worker image for one ship.
 *
 * WHY IT EXISTS: FleetBar and unfurls cannot assume WebGL. The hook keeps the
 * snapshot transport small and replaceable while local SVG fallback stays
 * available when the worker is not configured.
 *
 * @example
 *   const snapshot = useShipSnapshot('/shipwright/snapshot', {
 *     identity: 'port-daddy:fleet:spark',
 *     mode: 'png',
 *   });
 */
export function useShipSnapshot(
  endpoint: string | undefined,
  request: ShipSnapshotRequest,
): ShipSnapshotState {
  const [snapshot, setSnapshot] = useState<ShipSnapshotState>({ status: 'idle' });
  const { identity, mode, size, state } = request;

  useEffect(() => {
    if (!endpoint) {
      queueMicrotask(() => setSnapshot({ status: 'idle' }));
      return undefined;
    }

    const targetEndpoint = endpoint;
    const controller = new AbortController();
    let objectUrl: string | undefined;

    async function fetchSnapshot() {
      try {
        setSnapshot({ status: 'loading' });
        const response = await fetch(targetEndpoint, {
          body: JSON.stringify({ identity, mode, size, state }),
          headers: { 'Content-Type': 'application/json' },
          method: 'POST',
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`snapshot worker returned ${response.status}`);
        }
        objectUrl = URL.createObjectURL(await response.blob());
        setSnapshot({ objectUrl, status: 'ready' });
      } catch (error) {
        if (!controller.signal.aborted) {
          setSnapshot({ error: error instanceof Error ? error.message : String(error), status: 'error' });
        }
      }
    }

    void fetchSnapshot();

    return () => {
      controller.abort();
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [endpoint, identity, mode, size, state]);

  return snapshot;
}
