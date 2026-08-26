import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  type Edge,
  type Node,
  type NodeMouseHandler,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { createMissionFixture } from '../lib/fixtures';
import { layoutMission, viewportPolicyFor } from '../lib/layout';
import { useMissionStore } from '../store';
import type { MissionNodeData } from '../types';
import { MissionNode } from './MissionNode';

const nodeTypes = { mission: MissionNode };

interface GraphCanvasProps {
  fixtureCount: number;
  inspectorOpen: boolean;
}

function GraphCanvasView({ fixtureCount, inspectorOpen }: GraphCanvasProps) {
  const instanceRef = useRef<ReactFlowInstance<Node<MissionNodeData>, Edge> | null>(null);
  const selectNode = useMissionStore((state) => state.selectNode);
  const initializeNodes = useMissionStore((state) => state.initializeNodes);
  const setLayoutMetrics = useMissionStore((state) => state.setLayoutMetrics);
  const markGraphRender = useMissionStore((state) => state.markGraphRender);
  const graph = useMemo(() => {
    const fixture = createMissionFixture(fixtureCount);
    const layout = layoutMission(fixture.nodes, fixture.edges);
    return { ...fixture, nodes: layout.nodes, metrics: layout.metrics };
  }, [fixtureCount]);
  const viewportPolicy = useMemo(() => viewportPolicyFor(fixtureCount, inspectorOpen), [fixtureCount, inspectorOpen]);
  const fitMission = useCallback(() => {
    void instanceRef.current?.fitView({
      nodes: graph.nodes,
      ...viewportPolicy,
      duration: 0,
    });
  }, [graph.nodes, viewportPolicy]);

  useEffect(() => {
    initializeNodes(graph.nodes.map((node) => node.id));
    setLayoutMetrics(graph.metrics);
  }, [graph, initializeNodes, setLayoutMetrics]);

  useEffect(() => {
    let nestedFrame = 0;
    const frame = window.requestAnimationFrame(() => {
      nestedFrame = window.requestAnimationFrame(fitMission);
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (nestedFrame) window.cancelAnimationFrame(nestedFrame);
    };
  }, [fitMission, inspectorOpen]);

  useEffect(() => {
    markGraphRender();
  }, [markGraphRender]);

  const handleNodeClick: NodeMouseHandler = (_, node) => selectNode(node.id);

  return (
    <section className="graph-shell" data-mode={fixtureCount === 18 ? 'hero' : 'scale'} data-testid="graph-shell" aria-label="Inspectable AST and Suggestibility DAG">
      <div className="graph-watermark">
        <span>AST + SUGGESTIBILITY · DETERMINISTIC FIXTURE</span>
        <strong>{fixtureCount === 18 ? 'Hero mission · 6 ordered waves' : `${fixtureCount}-node scale probe`}</strong>
      </div>
      <ReactFlow
        nodes={graph.nodes}
        edges={graph.edges}
        nodeTypes={nodeTypes}
        onNodeClick={handleNodeClick}
        onInit={(instance) => {
          instanceRef.current = instance;
          window.requestAnimationFrame(fitMission);
        }}
        defaultViewport={{ x: 0, y: 0, zoom: fixtureCount === 18 ? 0.92 : 0.35 }}
        minZoom={0.1}
        maxZoom={2.4}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        onlyRenderVisibleElements
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} />
        <Controls showInteractive={false} position="bottom-left" />
      </ReactFlow>
      <div className="wave-legend" aria-label="Execution wave legend">
        <span><i className="line critical" /> critical path</span>
        <span><i className="line parallel" /> parallel waves</span>
      </div>
    </section>
  );
}

export const GraphCanvas = memo(GraphCanvasView);
