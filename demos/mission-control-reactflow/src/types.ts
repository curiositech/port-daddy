export type Provenance = 'live' | 'recorded' | 'fixture' | 'unknown';
export type NodeStatus = 'queued' | 'running' | 'blocked' | 'success' | 'error' | 'cancelled';
export type NodeKind = 'objective' | 'prompt' | 'skill' | 'agent' | 'tool' | 'test' | 'decision' | 'artifact';
export type TerminalState = 'complete' | 'failed' | 'cancelled';

export interface Evidence {
  id: string;
  label: string;
  kind: 'receipt' | 'test' | 'artifact' | 'trace' | 'decision';
  provenance: Provenance;
  detail: string;
  locator: string;
  verified: boolean;
}

export interface MissionNodeData extends Record<string, unknown> {
  id: string;
  label: string;
  eyebrow: string;
  kind: NodeKind;
  provenance: Provenance;
  wave: number;
  critical: boolean;
  summary: string;
  prompt: string;
  skills: string[];
  dependencies: string[];
  agent: string;
  session: string;
  tests: string[];
  receipts: string[];
  cost: number;
  artifacts: string[];
  evaluation: string;
  conundrum: string;
  evidence: Evidence[];
  durationMs: number;
}

export interface RuntimeNodeState {
  status: NodeStatus;
  progress: number;
  lastSequence: number;
  renderCount: number;
}

export interface MissionEvent {
  version: 1;
  id: string;
  sequence: number;
  cursor: string;
  idempotencyKey: string;
  nodeId: string;
  type: 'thinking.delta' | 'tool.start' | 'tool.result' | 'node.status' | 'receipt' | 'error' | 'terminal';
  provenance: Provenance;
  timestamp: string;
  payload: Record<string, unknown>;
}

export interface LayoutMetrics {
  count: number;
  edgeCount: number;
  durationMs: number;
  serializedBytes: number;
}
