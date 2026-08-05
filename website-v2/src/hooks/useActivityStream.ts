import { useEffect, useState } from 'react'
import {
  createActivityStream,
  describeDaemonError,
  type DaemonErrorKind,
} from '@/lib/daemon-client'

export interface Activity {
  id: number;
  type: string;
  agentId: string | null;
  targetId: string | null;
  details: string | null;
  timestamp: number;
  metadata?: Record<string, unknown> | null;
}

interface UseActivityStreamOptions {
  limit?: number;
  url?: string;
}

export function useActivityStream(options: UseActivityStreamOptions = {}) {
  const { limit = 50, url } = options;
  const [activities, setActivities] = useState<Activity[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<DaemonErrorKind | null>(null);

  useEffect(() => {
    let eventSource: EventSource | null = null
    try {
      eventSource = url
        ? new EventSource(url)
        : createActivityStream()
    } catch (err) {
      setConnected(false)
      const normalized = describeDaemonError(err)
      setError(normalized.message)
      setErrorKind(normalized.kind)
      console.error('SSE Error: connection failed', err)
      return
    }

    eventSource.onopen = () => {
      setConnected(true);
      setError(null);
      setErrorKind(null);
    };

    eventSource.onerror = () => {
      setConnected(false);
      const normalized = describeDaemonError(new TypeError('Connection failed'))
      setError(normalized.message);
      setErrorKind(normalized.kind);
      console.error('SSE Error: connection failed');
    };

    eventSource.onmessage = (event: MessageEvent<string>) => {
      try {
        const activity = JSON.parse(event.data) as Activity;
        setActivities((prev) => {
          const next = [activity, ...prev];
          return next.slice(0, limit);
        });
      } catch (err) {
        console.error('Failed to parse activity:', err);
      }
    };

    return () => {
      eventSource?.close();
    };
  }, [url, limit]);

  return { activities, connected, error, errorKind };
}
