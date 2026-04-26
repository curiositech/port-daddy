import { AgentShip } from './AgentShip';
import { useShipSnapshot } from './useShipSnapshot';
import type { SnapshotWorkerClientProps } from './types';

/**
 * SnapshotWorkerClient - image-first ship surface with SVG fallback.
 *
 * WHY IT EXISTS: this component is the bridge between future headless R3F
 * snapshots and today's deterministic SVG fallback. Consumers can mount it now
 * without committing to a snapshot service URL.
 *
 * @example
 *   <SnapshotWorkerClient
 *     endpoint="/shipwright/snapshot"
 *     identity="port-daddy:fleet:spark"
 *     mode="png"
 *   />
 */
export function SnapshotWorkerClient({
  endpoint,
  identity,
  state = 'idle',
  size = 192,
  mode = 'png',
  fallbackMode = 'svg',
  className,
  alt,
}: SnapshotWorkerClientProps) {
  const snapshot = useShipSnapshot(endpoint, { identity, mode, size, state });

  if (snapshot.status === 'ready' && snapshot.objectUrl) {
    return (
      <img
        alt={alt ?? `${identity} ship snapshot`}
        className={className}
        data-snapshot-mode={mode}
        height={size}
        src={snapshot.objectUrl}
        width={size}
      />
    );
  }

  return (
    <AgentShip
      ariaLabel={alt}
      className={className}
      identity={identity}
      scale={fallbackMode === 'svg' ? 3 : 2}
      status={state}
      style={{ height: `${Math.min(size, 192)}px`, width: `${Math.min(size, 192)}px` }}
    />
  );
}
