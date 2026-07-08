import { useCallback, useEffect, useState } from 'react';
import { Cloud, RefreshCw, AlertTriangle } from 'lucide-react';
import { fetchCloudFleetTelemetry, type CloudFleetTelemetry } from '../api';

interface CloudFleetPanelProps {
  theme: 'light' | 'dark';
  embedded: boolean;
  daemonUrl: string;
}

const REFRESH_MS = 15_000;

function usd(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n === 0) return '$0';
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

function tokens(n: number | null | undefined): string {
  if (!n) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div
      className="flex flex-col gap-1 px-3 py-2 rounded"
      style={{ backgroundColor: 'var(--pd-surface)', border: '1px solid var(--pd-border)' }}
    >
      <div className="text-[10px] font-semibold tracking-wider" style={{ color: 'var(--pd-dim)' }}>
        {label}
      </div>
      <div className="text-lg font-semibold tabular-nums" style={{ color: 'var(--pd-text)' }}>
        {value}
      </div>
      {hint ? (
        <div className="text-[10px]" style={{ color: 'var(--pd-dim)' }}>
          {hint}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Cloud Fleet — the Cloudflare edge PR-review fleet. Surfaces the daemon's
 * cloud-app telemetry: aggregate cost/tokens, per-ship clean/findings/errors,
 * per-repo PR counts, and per-model spend. This is the operator's answer to
 * "what is the Cloudflare cloud fleet doing right now, and what is it costing?"
 */
export default function CloudFleetPanel({ theme: _theme, embedded: _embedded, daemonUrl }: CloudFleetPanelProps) {
  const [data, setData] = useState<CloudFleetTelemetry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchCloudFleetTelemetry({ limit: 50 });
      setData(res);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(t);
  }, [load, daemonUrl]);

  const t = data?.totals;
  const empty = !!data && (t?.events ?? 0) === 0;

  return (
    <div className="flex flex-col h-full w-full overflow-auto" style={{ backgroundColor: 'var(--pd-bg)' }}>
      <div
        className="flex items-center justify-between gap-3 px-4 py-2 sticky top-0 z-10"
        style={{ borderBottom: '1px solid var(--pd-border)', backgroundColor: 'var(--pd-surface)' }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <Cloud size={14} style={{ color: 'var(--pd-accent)' }} />
          <div className="min-w-0">
            <div className="text-[10px] font-semibold tracking-wider" style={{ color: 'var(--pd-dim)' }}>
              CLOUD FLEET
            </div>
            <div className="text-sm font-semibold truncate" style={{ color: 'var(--pd-text)' }}>
              Cloudflare PR-review fleet — cost, tokens, models, verdicts
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded"
          style={{ backgroundColor: 'var(--pd-surface)', color: 'var(--pd-text)', border: '1px solid var(--pd-border)' }}
          title="Refresh cloud fleet telemetry"
        >
          <RefreshCw size={11} className={loading ? 'animate-spin' : undefined} />
          Refresh
        </button>
      </div>

      {error ? (
        <div className="flex items-center gap-2 m-4 px-3 py-2 rounded text-sm"
          style={{ backgroundColor: 'var(--pd-surface)', border: '1px solid var(--pd-border)', color: 'var(--pd-text)' }}>
          <AlertTriangle size={13} style={{ color: 'var(--pd-accent)' }} />
          <span>Could not reach cloud fleet telemetry: {error}</span>
        </div>
      ) : null}

      {data ? (
        <div className="flex flex-col gap-4 p-4">
          {/* Totals */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Stat label="PR REVIEWS" value={String(t?.uniqueDeliveries ?? 0)} hint={`${t?.shipEvents ?? 0} ship runs`} />
            <Stat label="COST" value={usd(t?.costUsd)} hint={t?.estimatedCostEvents ? `${t.estimatedCostEvents} estimated` : 'derived from tokens'} />
            <Stat label="TOKENS" value={tokens(t?.totalTokens)} hint={`${tokens(t?.inputTokens)} in / ${tokens(t?.outputTokens)} out`} />
            <Stat label="ERRORS" value={String(t?.errorEvents ?? 0)} hint={`${t?.commentEvents ?? 0} comments posted`} />
          </div>

          {empty ? (
            <div className="text-sm px-3 py-6 text-center rounded"
              style={{ color: 'var(--pd-dim)', border: '1px dashed var(--pd-border)' }}>
              No cloud fleet activity in the window yet. When the Cloudflare fleet reviews a PR,
              its cost, tokens, model, and verdict appear here.
            </div>
          ) : null}

          {/* Per ship */}
          {data.byShip.length > 0 ? (
            <section>
              <h3 className="text-[10px] font-semibold tracking-wider mb-2" style={{ color: 'var(--pd-dim)' }}>
                BY SHIP — clean / findings / errors
              </h3>
              <div className="flex flex-col gap-1">
                {data.byShip.map((s) => (
                  <div key={s.ship} className="grid grid-cols-12 items-center gap-2 px-3 py-1.5 rounded text-sm"
                    style={{ backgroundColor: 'var(--pd-surface)', border: '1px solid var(--pd-border)' }}>
                    <span className="col-span-3 font-semibold truncate" style={{ color: 'var(--pd-text)' }}>pd-{s.ship}</span>
                    <span className="col-span-4 tabular-nums" style={{ color: 'var(--pd-dim)' }}>
                      <span style={{ color: 'var(--pd-text)' }}>{s.clean}</span> clean ·{' '}
                      <span style={{ color: 'var(--pd-text)' }}>{s.findings}</span> found ·{' '}
                      <span style={{ color: s.errors ? 'var(--pd-accent)' : 'var(--pd-text)' }}>{s.errors}</span> err
                    </span>
                    <span className="col-span-3 tabular-nums text-right" style={{ color: 'var(--pd-dim)' }}>
                      {tokens(s.inputTokens + s.outputTokens)} tok
                    </span>
                    <span className="col-span-2 tabular-nums text-right font-semibold" style={{ color: 'var(--pd-text)' }}>
                      {usd(s.costUsd)}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {/* Per model/backend */}
          {data.byBackend.length > 0 ? (
            <section>
              <h3 className="text-[10px] font-semibold tracking-wider mb-2" style={{ color: 'var(--pd-dim)' }}>
                BY MODEL
              </h3>
              <div className="flex flex-col gap-1">
                {data.byBackend.map((b, i) => (
                  <div key={`${b.backend}:${b.model}:${i}`} className="grid grid-cols-12 items-center gap-2 px-3 py-1.5 rounded text-sm"
                    style={{ backgroundColor: 'var(--pd-surface)', border: '1px solid var(--pd-border)' }}>
                    <span className="col-span-6 font-mono truncate" style={{ color: 'var(--pd-text)' }}>{b.model ?? b.backend}</span>
                    <span className="col-span-3 tabular-nums text-right" style={{ color: 'var(--pd-dim)' }}>{b.events} calls</span>
                    <span className="col-span-3 tabular-nums text-right font-semibold" style={{ color: 'var(--pd-text)' }}>{usd(b.costUsd)}</span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {/* Per repo */}
          {data.byRepo.length > 0 ? (
            <section>
              <h3 className="text-[10px] font-semibold tracking-wider mb-2" style={{ color: 'var(--pd-dim)' }}>
                BY REPO
              </h3>
              <div className="flex flex-col gap-1">
                {data.byRepo.map((r, i) => (
                  <div key={`${r.owner}/${r.repo}:${i}`} className="grid grid-cols-12 items-center gap-2 px-3 py-1.5 rounded text-sm"
                    style={{ backgroundColor: 'var(--pd-surface)', border: '1px solid var(--pd-border)' }}>
                    <span className="col-span-7 truncate" style={{ color: 'var(--pd-text)' }}>
                      {r.owner ? `${r.owner}/` : ''}{r.repo ?? '—'}
                    </span>
                    <span className="col-span-3 tabular-nums text-right" style={{ color: 'var(--pd-dim)' }}>{r.pullRequests} PRs</span>
                    <span className="col-span-2 tabular-nums text-right font-semibold" style={{ color: 'var(--pd-text)' }}>{usd(r.costUsd)}</span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      ) : (
        !error ? (
          <div className="text-sm p-4" style={{ color: 'var(--pd-dim)' }}>Loading cloud fleet telemetry…</div>
        ) : null
      )}
    </div>
  );
}
