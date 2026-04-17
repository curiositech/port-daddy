import { useEffect, useState } from 'react'
import {
  describeDaemonError,
  fetchActivityTimeline,
  type DaemonErrorKind,
} from '@/lib/daemon-client'

export function useTimeline(options: { limit?: number; agentId?: string; sessionId?: string; interval?: number } = {}) {
  const { limit = 50, agentId, sessionId, interval = 5000 } = options;
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<DaemonErrorKind | null>(null);

  useEffect(() => {
    let mounted = true;
    
    async function fetchTimeline() {
      try {
        const data = await fetchActivityTimeline({ limit, agentId, sessionId })
        
        if (mounted) {
          setEvents(data);
          setError(null);
          setErrorKind(null);
        }
      } catch (err) {
        if (mounted) {
          const normalized = describeDaemonError(err)
          setError(normalized.message);
          setErrorKind(normalized.kind);
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }

    fetchTimeline();
    const timer = setInterval(fetchTimeline, interval);

    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [limit, agentId, sessionId, interval]);

  return { events, loading, error, errorKind };
}
