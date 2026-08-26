import { create } from 'zustand';
import type { LayoutMetrics, MissionEvent, NodeStatus, RuntimeNodeState, TerminalState } from './types';

export type TransportState = 'connected' | 'reconnecting' | 'paused' | 'error' | 'terminal';

interface MissionStore {
  selectedNodeId: string;
  runtimeById: Record<string, RuntimeNodeState>;
  events: MissionEvent[];
  playhead: number;
  transport: TransportState;
  terminalState: TerminalState | null;
  replayDropped: number;
  pendingFrames: number;
  layoutMetrics: LayoutMetrics | null;
  graphRenderCount: number;
  selectNode: (id: string) => void;
  initializeNodes: (ids: string[]) => void;
  applyEvent: (event: MissionEvent) => void;
  setEvents: (events: MissionEvent[]) => void;
  setPlayhead: (playhead: number) => void;
  setTransport: (transport: TransportState) => void;
  setTerminal: (terminalState: TerminalState | null) => void;
  setReplayDropped: (count: number) => void;
  setPendingFrames: (count: number) => void;
  setLayoutMetrics: (metrics: LayoutMetrics) => void;
  markGraphRender: () => void;
  reprioritize: () => void;
  setNodeStatus: (id: string, status: NodeStatus) => void;
}

function baseRuntime(index: number): RuntimeNodeState {
  const statuses: NodeStatus[] = ['success', 'success', 'running', 'queued', 'blocked', 'queued'];
  return { status: statuses[index % statuses.length], progress: (index * 19) % 100, lastSequence: 0, renderCount: 0 };
}

export const useMissionStore = create<MissionStore>((set) => ({
  selectedNodeId: '',
  runtimeById: {},
  events: [],
  playhead: 0,
  transport: 'connected',
  terminalState: null,
  replayDropped: 0,
  pendingFrames: 0,
  layoutMetrics: null,
  graphRenderCount: 0,
  selectNode: (selectedNodeId) => set({ selectedNodeId }),
  initializeNodes: (ids) => set((state) => ({
    runtimeById: Object.fromEntries(ids.map((id, index) => [id, state.runtimeById[id] ?? baseRuntime(index)])),
    selectedNodeId: state.selectedNodeId && ids.includes(state.selectedNodeId) ? state.selectedNodeId : '',
  })),
  applyEvent: (event) => set((state) => {
    const current = state.runtimeById[event.nodeId] ?? baseRuntime(0);
    const payloadStatus = event.payload.status as NodeStatus | undefined;
    return {
      runtimeById: {
        ...state.runtimeById,
        [event.nodeId]: {
          ...current,
          status: payloadStatus ?? (event.type === 'tool.start' ? 'running' : current.status),
          progress: Number(event.payload.progress ?? Math.min(99, current.progress + 7)),
          lastSequence: event.sequence,
        },
      },
    };
  }),
  setEvents: (events) => set({ events, playhead: Math.min(events.length - 1, Math.max(0, events.length - 12)) }),
  setPlayhead: (playhead) => set({ playhead }),
  setTransport: (transport) => set({ transport }),
  setTerminal: (terminalState) => set({ terminalState, transport: terminalState ? 'terminal' : 'connected' }),
  setReplayDropped: (replayDropped) => set({ replayDropped }),
  setPendingFrames: (pendingFrames) => set({ pendingFrames }),
  setLayoutMetrics: (layoutMetrics) => set({ layoutMetrics }),
  markGraphRender: () => set((state) => ({ graphRenderCount: state.graphRenderCount + 1 })),
  reprioritize: () => set((state) => ({
    runtimeById: {
      ...state.runtimeById,
      [state.selectedNodeId]: { ...state.runtimeById[state.selectedNodeId], status: 'running', progress: 34 },
    },
  })),
  setNodeStatus: (id, status) => set((state) => ({
    runtimeById: { ...state.runtimeById, [id]: { ...state.runtimeById[id], status } },
  })),
}));
