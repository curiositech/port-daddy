import { useState, useEffect, useCallback } from 'react';
import {
  fetchFleetStatus,
  fetchFleetConfig,
  fetchActivity,
  fetchStories,
  subscribeFleetEvents,
  subscribeActivity,
} from '../api';
import type {
  FleetDaemonStatus,
  FleetConfig,
  TopologyValidation,
  FleetEvent,
  ActivityEntry,
  StoryNote,
} from '../types';

export interface FleetState {
  status: FleetDaemonStatus | null;
  loading: boolean;
  error: string | null;
  events: FleetEvent[];
  activity: ActivityEntry[];
  stories: StoryNote[];
  // Per-project config (loaded on demand)
  configs: Map<string, {
    yaml: string;
    parsed: FleetConfig;
    topology: TopologyValidation;
    path: string;
    projectDir: string;
    resolvedChannels: Record<string, string>;
  }>;
}

function createInitialState(): FleetState {
  return {
    status: null,
    loading: true,
    error: null,
    events: [],
    activity: [],
    stories: [],
    configs: new Map(),
  };
}

export function useFleet(daemonUrl: string) {
  const [state, setState] = useState<FleetState>(createInitialState);

  const refresh = useCallback(async () => {
    try {
      const status = await fetchFleetStatus();
      setState(s => ({ ...s, status, loading: false, error: null }));
    } catch (err) {
      setState(s => ({ ...s, status: null, loading: false, error: (err as Error).message }));
    }
  }, [daemonUrl]);

  const refreshFeeds = useCallback(async () => {
    try {
      const [activity, stories] = await Promise.all([
        fetchActivity(250),
        fetchStories(50),
      ]);
      setState(s => ({ ...s, activity, stories }));
    } catch (err) {
      console.error('Failed to refresh fleet feeds', err);
    }
  }, [daemonUrl]);

  const loadConfig = useCallback(async (project: string) => {
    try {
      const config = await fetchFleetConfig(project);
      setState(s => {
        const configs = new Map(s.configs);
        configs.set(project, config);
        return { ...s, configs };
      });
    } catch (err) {
      console.error('Failed to load config for', project, err);
    }
  }, [daemonUrl]);

  // Initial fetch + SSE subscription
  useEffect(() => {
    setState(createInitialState());
    refresh();
    refreshFeeds();

    // SSE for live events
    const unsubFleet = subscribeFleetEvents((event) => {
      const ev = event as FleetEvent;
      setState(s => ({
        ...s,
        events: [...s.events.slice(-200), ev], // keep last 200
      }));
      // Refresh status on lifecycle events
      if (['agent_started', 'agent_completed', 'agent_failed', 'agent_paused', 'agent_resumed', 'fleet_started', 'fleet_stopped'].includes(ev.type)) {
        refresh();
      }
    });

    const unsubActivity = subscribeActivity((entry) => {
      setState(s => ({
        ...s,
        activity: [entry, ...s.activity.filter(existing => existing.id !== entry.id)].slice(0, 300),
      }));
    });

    // Polling fallback every 30s
    const poll = setInterval(refresh, 30000);
    const feedPoll = setInterval(refreshFeeds, 30000);

    return () => {
      unsubFleet();
      unsubActivity();
      clearInterval(poll);
      clearInterval(feedPoll);
    };
  }, [daemonUrl, refresh, refreshFeeds]);

  return {
    ...state,
    refresh,
    refreshFeeds,
    loadConfig,
  };
}
