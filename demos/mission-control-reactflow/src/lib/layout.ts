import type { Edge, Node } from '@xyflow/react';
import type { LayoutMetrics, MissionNodeData } from '../types';

export interface LayoutProfile {
  nodeWidth: number;
  nodeHeight: number;
  xGap: number;
  yGap: number;
}

export interface ViewportPolicy {
  padding: number;
  minZoom: number;
  maxZoom: number;
}

export function layoutProfileFor(count: number): LayoutProfile {
  if (count <= 18) return { nodeWidth: 214, nodeHeight: 150, xGap: 26, yGap: 42 };
  if (count <= 50) return { nodeWidth: 220, nodeHeight: 126, xGap: 48, yGap: 28 };
  if (count <= 100) return { nodeWidth: 210, nodeHeight: 118, xGap: 38, yGap: 22 };
  return { nodeWidth: 200, nodeHeight: 110, xGap: 32, yGap: 18 };
}

export function viewportPolicyFor(count: number, inspectorOpen: boolean): ViewportPolicy {
  if (count <= 18) {
    return inspectorOpen
      ? { padding: 0.055, minZoom: 0.72, maxZoom: 0.86 }
      : { padding: 0.07, minZoom: 0.88, maxZoom: 1.04 };
  }
  if (count <= 50) return { padding: 0.1, minZoom: 0.34, maxZoom: 0.72 };
  if (count <= 100) return { padding: 0.12, minZoom: 0.2, maxZoom: 0.5 };
  return { padding: 0.14, minZoom: 0.12, maxZoom: 0.36 };
}

export function layoutMission(nodes: Node<MissionNodeData>[], edges: Edge[]) {
  const started = performance.now();
  const profile = layoutProfileFor(nodes.length);
  const byWave = new Map<number, Node<MissionNodeData>[]>();

  for (const node of nodes) {
    const wave = node.data.wave;
    const group = byWave.get(wave) ?? [];
    group.push(node);
    byWave.set(wave, group);
  }

  const positioned: Node<MissionNodeData>[] = [...byWave.entries()]
    .sort(([a], [b]) => a - b)
    .flatMap(([wave, group]) => {
      const totalHeight = group.length * profile.nodeHeight + Math.max(0, group.length - 1) * profile.yGap;
      return group.map((node, index) => ({
        ...node,
        style: { width: profile.nodeWidth, height: profile.nodeHeight },
        position: {
          x: wave * (profile.nodeWidth + profile.xGap),
          y: index * (profile.nodeHeight + profile.yGap) - totalHeight / 2,
        },
      }));
    });

  const metrics: LayoutMetrics = {
    count: positioned.length,
    edgeCount: edges.length,
    durationMs: Number((performance.now() - started).toFixed(2)),
    serializedBytes: new TextEncoder().encode(JSON.stringify({ nodes: positioned, edges })).byteLength,
  };

  return { nodes: positioned, metrics };
}
