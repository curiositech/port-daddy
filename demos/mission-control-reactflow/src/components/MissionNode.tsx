import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { AlertTriangle, Bot, Braces, Check, CircleDot, FileCheck2, GitBranch, Hammer, Lightbulb, TestTube2 } from 'lucide-react';
import { useMissionStore } from '../store';
import type { MissionNodeData, NodeKind } from '../types';

const kindIcons: Record<NodeKind, typeof Bot> = {
  objective: CircleDot,
  prompt: Braces,
  skill: Lightbulb,
  agent: Bot,
  tool: Hammer,
  test: TestTube2,
  decision: GitBranch,
  artifact: FileCheck2,
};

export const nodeRenderCounts = new Map<string, number>();

function MissionNodeView({ data, selected }: NodeProps) {
  const mission = data as MissionNodeData;
  const runtime = useMissionStore((state) => state.runtimeById[mission.id]);
  const Icon = kindIcons[mission.kind];
  nodeRenderCounts.set(mission.id, (nodeRenderCounts.get(mission.id) ?? 0) + 1);

  return (
    <article
      className={`mission-node status-${runtime?.status ?? 'queued'} ${mission.critical ? 'is-critical' : ''} ${selected ? 'is-selected' : ''}`}
      aria-label={`${mission.label}, ${runtime?.status ?? 'queued'}, ${mission.provenance} provenance`}
      data-testid={`mission-node-${mission.id}`}
    >
      <Handle type="target" position={Position.Left} className="node-handle" />
      <div className="node-topline">
        <span className="node-kind"><Icon size={12} /> {mission.eyebrow}</span>
        <span className={`provenance provenance-${mission.provenance}`}>{mission.provenance}</span>
      </div>
      <h3>{mission.label}</h3>
      <p>{mission.summary}</p>
      <div className="node-footer">
        <span className={`status-label status-${runtime?.status ?? 'queued'}`}>
          {runtime?.status === 'success' ? <Check size={12} /> : runtime?.status === 'blocked' ? <AlertTriangle size={12} /> : <span className="status-pulse" />}
          {runtime?.status ?? 'queued'}
        </span>
        <span>seq {runtime?.lastSequence || '—'}</span>
        <span>{mission.durationMs < 1000 ? `${mission.durationMs}ms` : `${(mission.durationMs / 1000).toFixed(1)}s`}</span>
      </div>
      {runtime?.status === 'running' && <div className="node-progress"><i style={{ transform: `scaleX(${runtime.progress / 100})` }} /></div>}
      <Handle type="source" position={Position.Right} className="node-handle" />
    </article>
  );
}

export const MissionNode = memo(MissionNodeView);
