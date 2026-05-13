import { useMemo, useState } from 'react';
import { BarChart3, ExternalLink, RefreshCw } from 'lucide-react';
import { getDaemonUrl } from '../api';

interface MetricsPanelProps {
  theme: 'light' | 'dark';
  embedded: boolean;
}

export function MetricsPanel({ theme, embedded }: MetricsPanelProps) {
  const [reloadKey, setReloadKey] = useState(0);

  const src = useMemo(() => {
    const base = getDaemonUrl().replace(/\/$/, '');
    const params = new URLSearchParams({
      embed: embedded ? 'fleetbar' : 'fleet-ui',
      theme,
      v: String(reloadKey),
    });
    return `${base}/metrics.html?${params.toString()}`;
  }, [theme, embedded, reloadKey]);

  const popOutHref = useMemo(() => `${getDaemonUrl().replace(/\/$/, '')}/metrics.html`, []);

  return (
    <div className="flex flex-col h-full w-full" style={{ backgroundColor: 'var(--pd-bg)' }}>
      <div
        className="flex items-center justify-between gap-3 px-4 py-2"
        style={{ borderBottom: '1px solid var(--pd-border)', backgroundColor: 'var(--pd-surface)' }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <BarChart3 size={14} style={{ color: 'var(--pd-accent)' }} />
          <div className="min-w-0">
            <div
              className="text-[10px] font-semibold tracking-wider"
              style={{ color: 'var(--pd-dim)' }}
            >
              METRICS
            </div>
            <div className="text-sm font-semibold truncate" style={{ color: 'var(--pd-text)' }}>
              Request volume, latency, seasonality, and outliers
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            className="flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded"
            style={{
              backgroundColor: 'var(--pd-surface)',
              color: 'var(--pd-text)',
              border: '1px solid var(--pd-border)',
            }}
            title="Reload metrics view"
          >
            <RefreshCw size={11} />
            Reload
          </button>
          <a
            href={popOutHref}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded"
            style={{
              backgroundColor: 'var(--pd-accent-surface)',
              color: 'var(--pd-accent)',
              border: '1px solid var(--pd-accent-border)',
              textDecoration: 'none',
            }}
            title="Open metrics dashboard in a new tab"
          >
            <ExternalLink size={11} />
            Pop out
          </a>
        </div>
      </div>
      <iframe
        key={reloadKey}
        src={src}
        title="Port Daddy metrics dashboard"
        className="flex-1 w-full"
        style={{ border: 0, backgroundColor: 'var(--pd-bg)' }}
        // sandbox: same-origin needed for the page to call its own /metrics/* endpoints.
        // scripts needed because Chart.js renders the panels.
        sandbox="allow-same-origin allow-scripts allow-popups"
        referrerPolicy="no-referrer"
      />
    </div>
  );
}
