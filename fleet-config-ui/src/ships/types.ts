import type { CSSProperties, ReactNode } from 'react';
import type { ShipPlan } from './ship-grammar';

export type ShipRuntimeState =
  | 'running'
  | 'idle'
  | 'throttled'
  | 'selected'
  | 'unselected'
  | 'ghost'
  | 'slashed'
  | 'mayday';

export type ShipThumbnailMode = 'svg' | 'r3f';
export type ShipSnapshotMode = 'png' | 'gif' | 'apng';

export interface AgentShipProps {
  identity: string;
  status?: ShipRuntimeState;
  selected?: boolean;
  reducedMotion?: boolean;
  scale?: number;
  plan?: ShipPlan;
  className?: string;
  style?: CSSProperties;
  ariaLabel?: string;
}

export interface FleetStageProps {
  children?: ReactNode;
  reducedMotion?: boolean;
  className?: string;
  style?: CSSProperties;
}

export interface DitherPipelineProps {
  children: ReactNode;
  palette?: readonly string[];
  enabled?: boolean;
  className?: string;
}

export interface AgentCardThumbnailProps {
  identities: string[];
  selectedIdentity?: string;
  statusByIdentity?: Record<string, ShipRuntimeState>;
  mode?: ShipThumbnailMode;
  className?: string;
  ariaLabel?: string;
}

export interface ShipSnapshotRequest {
  identity: string;
  state?: ShipRuntimeState;
  size?: number;
  mode?: ShipSnapshotMode;
}

export interface ShipSnapshotState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  objectUrl?: string;
  error?: string;
}

export interface SnapshotWorkerClientProps extends ShipSnapshotRequest {
  endpoint?: string;
  fallbackMode?: ShipThumbnailMode;
  className?: string;
  alt?: string;
}
