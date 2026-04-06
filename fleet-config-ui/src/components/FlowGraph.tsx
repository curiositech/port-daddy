import { useMemo, useCallback, useState } from 'react';
import {
  ReactFlow, Background, Controls,
  type Node, type Edge, type NodeProps,
  Handle, Position, BaseEdge, getSmoothStepPath,
  type EdgeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { FleetConfig, TopologyValidation } from '../types';
import { agentColor } from '../types';

// ─── Custom nodes ─────────────────────────────────────────────────────────────

function AgentNode({ data }: NodeProps) {
  const d = data as { label: string; color: string; status: string; selected: boolean; inCycle: boolean };
  const statusDot = d.status === 'running' ? 'var(--pd-success)' : d.status === 'scheduled' ? 'var(--pd-dim)' : 'var(--pd-border)';
  return (
    <div
      className="rounded-lg px-3 py-2 font-mono text-xs flex items-center gap-2 cursor-pointer"
      style={{
        backgroundColor: d.selected ? 'var(--pd-surface-hover, #1E1B18)' : 'var(--pd-surface)',
        border: `2px solid ${d.selected ? d.color : d.inCycle ? 'var(--pd-accent)' : 'var(--pd-border)'}`,
        boxShadow: d.selected ? `0 0 20px ${d.color}40` : d.inCycle ? '0 0 12px rgba(242,109,91,0.3)' : 'none',
        color: d.selected ? d.color : 'var(--pd-muted)',
        minWidth: 100,
      }}
    >
      <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: statusDot }} />
      {d.label}
      {d.inCycle && <span className="text-[8px] ml-1" style={{ color: 'var(--pd-accent)' }}>cycle</span>}
      <Handle type="source" position={Position.Bottom} style={{ background: 'transparent', border: 'none' }} />
      <Handle type="target" position={Position.Top} style={{ background: 'transparent', border: 'none' }} />
    </div>
  );
}

function ChannelNode({ data }: NodeProps) {
  const d = data as { label: string; selected: boolean; inCycle: boolean };
  const [prefix, suffix] = d.label.includes(':') ? [d.label.split(':')[0], d.label.split(':').slice(1).join(':')] : ['', d.label];
  return (
    <div
      className="rounded font-mono text-[11px] px-2.5 py-1.5 cursor-pointer"
      style={{
        backgroundColor: d.selected ? 'var(--pd-surface-hover, #2A1A1A)' : 'var(--pd-surface)',
        border: `1.5px solid ${d.selected ? 'var(--pd-accent)' : d.inCycle ? 'var(--pd-accent)' : 'var(--pd-border)'}`,
        boxShadow: d.selected ? '0 0 16px rgba(242,109,91,0.35)' : 'none',
        color: d.selected ? 'var(--pd-accent)' : 'var(--pd-muted)',
      }}
    >
      {prefix && <span style={{ color: 'var(--pd-accent)', opacity: d.selected ? 1 : 0.82 }}>{prefix}:</span>}
      <span>{suffix}</span>
      <Handle type="source" position={Position.Top} style={{ background: 'transparent', border: 'none' }} />
      <Handle type="target" position={Position.Bottom} style={{ background: 'transparent', border: 'none' }} />
    </div>
  );
}

function ScheduleNode({ data }: NodeProps) {
  const d = data as { label: string; selected: boolean };
  return (
    <div
      className="rounded font-mono text-[11px] px-2.5 py-1.5 cursor-pointer"
      style={{
        backgroundColor: d.selected ? 'var(--pd-surface-hover, #1A1510)' : 'var(--pd-surface)',
        border: `1px solid ${d.selected ? 'var(--pd-dim)' : 'var(--pd-border)'}`,
        color: d.selected ? 'var(--pd-text)' : 'var(--pd-muted)',
      }}
    >
      ⏱ {d.label}
      <Handle type="source" position={Position.Bottom} style={{ background: 'transparent', border: 'none' }} />
    </div>
  );
}

// ─── Custom edges ─────────────────────────────────────────────────────────────

function PublishEdge({ id, sourceX, sourceY, targetX, targetY, data }: EdgeProps) {
  const d = (data ?? {}) as { highlighted: boolean; inCycle: boolean };
  const [path] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, borderRadius: 16 });
  return (
    <BaseEdge id={id} path={path}
      style={{
        stroke: d.inCycle ? 'var(--pd-accent)' : d.highlighted ? 'var(--pd-accent)' : 'var(--pd-border)',
        strokeWidth: d.highlighted ? 3 : 2,
        strokeDasharray: d.inCycle ? '8,4' : '6,4',
        opacity: d.highlighted ? 0.9 : 0.5,
        transition: 'all 0.25s',
      }} />
  );
}

function TriggerEdge({ id, sourceX, sourceY, targetX, targetY, data }: EdgeProps) {
  const d = (data ?? {}) as { highlighted: boolean; inCycle: boolean };
  const [path] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, borderRadius: 16 });
  return (
    <BaseEdge id={id} path={path}
      style={{
        stroke: d.inCycle ? 'var(--pd-accent)' : d.highlighted ? 'var(--pd-warning)' : 'var(--pd-border)',
        strokeWidth: d.highlighted ? 3 : 2,
        opacity: d.highlighted ? 0.9 : 0.5,
        transition: 'all 0.25s',
      }} />
  );
}

function ScheduleEdge({ id, sourceX, sourceY, targetX, targetY, data }: EdgeProps) {
  const d = (data ?? {}) as { highlighted: boolean };
  const [path] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, borderRadius: 16 });
  return (
    <BaseEdge id={id} path={path}
      style={{
        stroke: d.highlighted ? 'var(--pd-dim)' : 'var(--pd-border)',
        strokeWidth: d.highlighted ? 3 : 2,
        opacity: d.highlighted ? 0.9 : 0.4,
        transition: 'all 0.25s',
      }} />
  );
}

const nodeTypes = { agent: AgentNode, channel: ChannelNode, schedule: ScheduleNode };
const edgeTypes = { publish: PublishEdge, trigger: TriggerEdge, schedule: ScheduleEdge };

// ─── Layout builder ───────────────────────────────────────────────────────────

interface BuildOpts {
  config: FleetConfig;
  selectedAgent: string | null;
  selectedChannel: string | null;
  hideUnrelated: boolean;
  cycleNodes: Set<string>;
}

function buildGraph({ config, selectedAgent, selectedChannel, hideUnrelated, cycleNodes }: BuildOpts) {
  const { agents } = config;
  const channels = new Set<string>();
  const schedules = new Set<string>();
  const channelToListeners = new Map<string, string[]>();

  agents.forEach(a => {
    for (const hook of [a.onSuccess, a.onFailure]) {
      if (!hook) continue;
      const [action, ch] = hook.split(' ');
      if (action === 'publish' && ch) channels.add(ch);
    }
    if (a.trigger) {
      channels.add(a.trigger);
      if (!channelToListeners.has(a.trigger)) channelToListeners.set(a.trigger, []);
      channelToListeners.get(a.trigger)!.push(a.name);
    }
    if (a.schedule) schedules.add(a.schedule);
  });

  // Also add declared channels
  Object.keys(config.channels).forEach(ch => channels.add(ch));

  const channelArr = Array.from(channels);
  const scheduleArr = Array.from(schedules);

  // HORIZONTAL layout: agents at top, channels at bottom
  const COL_W = 150;
  const AGENT_Y = 60;
  const CHANNEL_Y = 240;
  const SCHED_Y = -40;

  // Determine what's "related" to selection
  const relatedAgents = new Set<string>();
  const relatedChannels = new Set<string>();

  if (selectedAgent) {
    relatedAgents.add(selectedAgent);
    const a = agents.find(ag => ag.name === selectedAgent);
    if (a) {
      if (a.trigger) { relatedChannels.add(a.trigger); }
      if (a.onSuccess) { const [, ch] = a.onSuccess.split(' '); if (ch) relatedChannels.add(ch); }
      if (a.onFailure) { const [, ch] = a.onFailure.split(' '); if (ch) relatedChannels.add(ch); }
    }
  }
  if (selectedChannel) {
    relatedChannels.add(selectedChannel);
    agents.forEach(a => {
      if (a.trigger === selectedChannel) relatedAgents.add(a.name);
      if (a.onSuccess?.includes(selectedChannel)) relatedAgents.add(a.name);
      if (a.onFailure?.includes(selectedChannel)) relatedAgents.add(a.name);
    });
  }

  const hasSelection = !!(selectedAgent || selectedChannel);

  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // Schedule nodes
  scheduleArr.forEach((s, i) => {
    const selAgentHasSched = selectedAgent && agents.find(a => a.name === selectedAgent)?.schedule === s;
    const hidden = hasSelection && hideUnrelated && !selAgentHasSched;
    nodes.push({
      id: `sched-${s}`, type: 'schedule',
      position: { x: i * COL_W + 80, y: SCHED_Y },
      data: { label: s, selected: !!selAgentHasSched },
      hidden,
    });
  });

  // Agent nodes
  agents.forEach((a, i) => {
    const color = agentColor(a.name);
    const selected = selectedAgent === a.name || (selectedChannel != null && relatedAgents.has(a.name));
    const hidden = hasSelection && hideUnrelated && !relatedAgents.has(a.name) && selectedAgent !== a.name;
    const inCycle = cycleNodes.has(a.name);

    nodes.push({
      id: `agent-${a.name}`, type: 'agent',
      position: { x: i * COL_W + 40, y: AGENT_Y },
      data: { label: a.name, color, status: a.schedule ? 'scheduled' : 'triggered', selected, inCycle },
      hidden,
    });

    // Schedule → agent edges
    if (a.schedule) {
      edges.push({
        id: `e-sched-${a.schedule}-${a.name}`,
        source: `sched-${a.schedule}`, target: `agent-${a.name}`,
        type: 'schedule',
        data: { highlighted: selected },
        hidden,
      });
    }

    // Agent → channel (publish) edges
    for (const hook of [a.onSuccess, a.onFailure]) {
      if (!hook) continue;
      const [action, ch] = hook.split(' ');
      if (action !== 'publish' || !ch) continue;
      const chSel = selectedChannel === ch || selectedAgent === a.name;
      const eKey = `pub-${a.name}-${ch}`;
      const eHidden = hasSelection && hideUnrelated && !chSel;
      edges.push({
        id: `e-${eKey}`,
        source: `agent-${a.name}`, target: `chan-${ch}`,
        type: 'publish',
        data: { highlighted: chSel, inCycle: false },
        hidden: eHidden,
      });
    }
  });

  // Channel nodes
  channelArr.forEach((ch, i) => {
    const selected = selectedChannel === ch || (selectedAgent != null && relatedChannels.has(ch));
    const hidden = hasSelection && hideUnrelated && !relatedChannels.has(ch);
    const inCycle = cycleNodes.has(ch);

    nodes.push({
      id: `chan-${ch}`, type: 'channel',
      position: { x: i * COL_W + 40, y: CHANNEL_Y },
      data: { label: ch, selected, inCycle },
      hidden,
    });

    // Channel → agent (trigger) edges
    channelToListeners.get(ch)?.forEach(agentName => {
      const agentSel = selectedAgent === agentName || selectedChannel === ch;
      const eKey = `trig-${ch}-${agentName}`;
      const eHidden = hasSelection && hideUnrelated && !agentSel;
      edges.push({
        id: `e-${eKey}`,
        source: `chan-${ch}`, target: `agent-${agentName}`,
        type: 'trigger',
        data: { highlighted: agentSel, inCycle: false },
        hidden: eHidden,
      });
    });
  });

  return { nodes, edges };
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  config: FleetConfig;
  topology?: TopologyValidation | null;
  theme: 'dark' | 'light';
  selectedAgent: string | null;
  selectedChannel: string | null;
  onAgentSelect: (name: string | null) => void;
  onChannelSelect: (ch: string | null) => void;
}

export default function FlowGraph({ config, topology, theme, selectedAgent, selectedChannel, onAgentSelect, onChannelSelect }: Props) {
  const [hideUnrelated, setHideUnrelated] = useState(false);

  // Build cycle set from topology validation
  const cycleNodes = useMemo(() => {
    const cn = new Set<string>();
    if (topology?.cycles) {
      for (const cycle of topology.cycles) {
        cycle.forEach((n: string) => cn.add(n));
      }
    }
    return cn;
  }, [topology]);

  const { nodes, edges } = useMemo(
    () => buildGraph({ config, selectedAgent, selectedChannel, hideUnrelated, cycleNodes }),
    [config, selectedAgent, selectedChannel, hideUnrelated, cycleNodes]
  );

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    if (node.type === 'agent') {
      const name = (node.data as { label: string }).label;
      onAgentSelect(selectedAgent === name ? null : name);
      onChannelSelect(null);
    } else if (node.type === 'channel') {
      const ch = (node.data as { label: string }).label;
      onChannelSelect(selectedChannel === ch ? null : ch);
      onAgentSelect(null);
    }
  }, [selectedAgent, selectedChannel, onAgentSelect, onChannelSelect]);

  return (
    <div className="relative w-full h-full" style={{ minHeight: 320 }}>
      {/* Controls */}
      <div className="absolute top-3 right-3 z-10 flex flex-col gap-1.5 text-[10px]" style={{ color: 'var(--pd-muted)' }}>
        <label className="flex items-center gap-1.5 cursor-pointer select-none">
          <input type="checkbox" checked={hideUnrelated} onChange={e => setHideUnrelated(e.target.checked)}
            className="accent-red-600 w-3 h-3" />
          <span>Hide unrelated</span>
        </label>
        {topology && !topology.valid && (
          <div className="mt-1 text-[9px] px-2 py-1 rounded" style={{ backgroundColor: 'var(--pd-accent-surface)', color: 'var(--pd-accent)', border: '1px solid var(--pd-accent-border)' }}>
            {topology.cycles.length} cycle{topology.cycles.length > 1 ? 's' : ''} detected
          </div>
        )}
        <div className="flex items-center gap-3 mt-1 opacity-50">
          <span className="flex items-center gap-1"><span className="inline-block w-4 border-t-2 border-dashed" style={{ borderColor: 'var(--pd-accent)' }} /> publishes</span>
          <span className="flex items-center gap-1"><span className="inline-block w-4 border-t-2" style={{ borderColor: 'var(--pd-warning)' }} /> triggers</span>
        </div>
      </div>

      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={onNodeClick}
        onPaneClick={() => { onAgentSelect(null); onChannelSelect(null); }}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        colorMode={theme}
        style={{ backgroundColor: 'var(--pd-bg)' }}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="var(--pd-border)" gap={24} size={1} />
        <Controls position="bottom-right" />
      </ReactFlow>
    </div>
  );
}
