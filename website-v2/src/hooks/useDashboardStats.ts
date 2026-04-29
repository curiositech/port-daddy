import { useEffect, useState } from 'react'
import {
  describeDaemonError,
  fetchDashboardStats,
  type DashboardStats,
  type DaemonErrorKind,
} from '@/lib/daemon-client'

export function useDashboardStats(interval = 5000) {
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [errorKind, setErrorKind] = useState<DaemonErrorKind | null>(null)

  useEffect(() => {
    let mounted = true
    let timer: ReturnType<typeof setInterval> | null = null

    async function refresh() {
      try {
        const next = await fetchDashboardStats()
        if (!mounted) return
        setStats(next)
        setError(null)
        setErrorKind(null)
      } catch (err) {
        if (!mounted) return
        const normalized = describeDaemonError(err)
        setError(normalized.message)
        setErrorKind(normalized.kind)
      } finally {
        if (mounted) setLoading(false)
      }
    }

    void refresh()
    timer = setInterval(refresh, interval)

    return () => {
      mounted = false
      if (timer) clearInterval(timer)
    }
  }, [interval])

  return { stats, loading, error, errorKind }
}
