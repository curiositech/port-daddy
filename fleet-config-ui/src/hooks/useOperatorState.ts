import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchOperatorState } from '../api';
import type { OperatorState } from '../types';

const POLL_INTERVAL_MS = 8_000;

export interface OperatorStateHook {
  state: OperatorState | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  lastFetchedAt: number | null;
}

export function useOperatorState(opts: {
  project?: string | null;
  projectDir?: string | null;
  enabled?: boolean;
} = {}): OperatorStateHook {
  const { project, projectDir, enabled = true } = opts;

  const [state, setState] = useState<OperatorState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) return;

    // Abort any in-flight fetch
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);

    try {
      const result = await fetchOperatorState({
        project: project ?? undefined,
        projectDir: projectDir ?? undefined,
      });
      if (controller.signal.aborted) return;
      setState(result);
      setLastFetchedAt(Date.now());
    } catch (err) {
      if (controller.signal.aborted) return;
      setError((err as Error).message ?? 'Failed to load operator state');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [enabled, project, projectDir]);

  // Initial fetch + polling
  useEffect(() => {
    if (!enabled) return;

    void refresh();
    const interval = window.setInterval(() => { void refresh(); }, POLL_INTERVAL_MS);
    return () => {
      window.clearInterval(interval);
      abortRef.current?.abort();
    };
  }, [enabled, refresh]);

  return { state, loading, error, refresh, lastFetchedAt };
}
