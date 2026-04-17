import { useEffect, useState } from 'react'
import {
  describeDaemonError,
  fetchOrchestratorRules,
  type DaemonErrorKind,
  type OrchestratorRule,
} from '@/lib/daemon-client'

export function useOrchestratorRules(interval = 5000) {
  const [rules, setRules] = useState<OrchestratorRule[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [errorKind, setErrorKind] = useState<DaemonErrorKind | null>(null)

  useEffect(() => {
    let mounted = true
    let timer: ReturnType<typeof setInterval> | null = null

    async function refresh() {
      try {
        const next = await fetchOrchestratorRules()
        if (!mounted) return
        setRules(next)
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

  return { rules, loading, error, errorKind }
}

