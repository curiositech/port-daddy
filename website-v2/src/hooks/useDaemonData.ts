import { useEffect, useState } from 'react'
import { daemonFetchJson } from '@/lib/daemon-client'

export function useDaemonData<T>(path: string, interval = 2000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    let currentController: AbortController | null = null;

    async function fetchData() {
      currentController?.abort()
      const controller = new AbortController()
      currentController = controller

      try {
        const json = await daemonFetchJson<T>(
          path,
          { signal: controller.signal },
        )
        if (mounted) {
          setData(json);
          setError(null);
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Failed to fetch daemon data');
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }

    fetchData();
    const timer = setInterval(fetchData, interval);

    return () => {
      mounted = false;
      currentController?.abort()
      clearInterval(timer);
    };
  }, [path, interval]);

  return { data, error, loading };
}
