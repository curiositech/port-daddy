import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Activity, BarChart3, Boxes, DatabaseZap, Eye, RefreshCw, Table2 } from 'lucide-react';
import { fetchUsageSummary, recordUsageEvent } from '../api';
import type { UsageBreakdownRow, UsageCapabilityRow, UsageNameRow, UsageTelemetrySummary } from '../types';

const WINDOWS = [
  { label: '24H', value: '24h' },
  { label: '7D', value: '7d' },
  { label: '30D', value: '30d' },
] as const;

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 4 }).format(value);
}

function formatTime(ts: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(ts));
}

function formatDuration(value: number | null): string {
  if (value == null) return '-';
  if (value < 1000) return `${value}ms`;
  return `${(value / 1000).toFixed(1)}s`;
}

function statusColor(count: number): { bg: string; fg: string; border: string } {
  if (count === 0) return { bg: 'var(--pd-accent-surface)', fg: 'var(--pd-accent)', border: 'var(--pd-accent-border)' };
  if (count < 5) return { bg: 'var(--pd-warning-surface)', fg: 'var(--pd-warning)', border: 'var(--pd-warning-border)' };
  return { bg: 'var(--pd-success-surface)', fg: 'var(--pd-success)', border: 'var(--pd-success-border)' };
}

function MetricTile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="border px-3 py-3" style={{ backgroundColor: 'var(--pd-surface)', borderColor: 'var(--pd-border)' }}>
      <div className="text-[10px] font-semibold tracking-wider" style={{ color: 'var(--pd-dim)' }}>{label}</div>
      <div className="mt-2 text-2xl font-semibold tabular-nums" style={{ color: 'var(--pd-text)' }}>{value}</div>
      <div className="mt-1 text-[10px]" style={{ color: 'var(--pd-muted)' }}>{sub}</div>
    </div>
  );
}

function BreakdownBars({ title, icon, rows }: { title: string; icon: ReactNode; rows: UsageBreakdownRow[] }) {
  const max = Math.max(1, ...rows.map((row) => row.count));
  return (
    <div className="border p-3" style={{ backgroundColor: 'var(--pd-surface)', borderColor: 'var(--pd-border)' }}>
      <div className="flex items-center gap-2 text-[10px] font-semibold tracking-wider" style={{ color: 'var(--pd-dim)' }}>
        {icon}
        <span>{title}</span>
      </div>
      <div className="mt-3 space-y-2">
        {rows.length === 0 ? (
          <div className="text-xs" style={{ color: 'var(--pd-muted)' }}>No events in this window.</div>
        ) : rows.slice(0, 8).map((row) => (
          <div key={row.key}>
            <div className="mb-1 flex items-center justify-between gap-3 text-[11px]">
              <span className="truncate font-semibold" style={{ color: 'var(--pd-text)' }}>{row.label}</span>
              <span className="font-mono" style={{ color: 'var(--pd-muted)' }}>{formatNumber(row.count)} / {row.percentage}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden" style={{ backgroundColor: 'var(--pd-bg)' }}>
              <div
                className="h-full"
                style={{
                  width: `${Math.max(4, (row.count / max) * 100)}%`,
                  backgroundColor: 'var(--pd-accent)',
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CapabilityGrid({ rows }: { rows: UsageCapabilityRow[] }) {
  return (
    <div className="border p-3" style={{ backgroundColor: 'var(--pd-surface)', borderColor: 'var(--pd-border)' }}>
      <div className="flex items-center gap-2 text-[10px] font-semibold tracking-wider" style={{ color: 'var(--pd-dim)' }}>
        <Boxes size={13} />
        <span>CAPABILITY COVERAGE</span>
      </div>
      <div className="mt-3 grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
        {rows.map((row) => {
          const colors = statusColor(row.count);
          return (
            <div key={row.category} className="border px-2.5 py-2" style={{ backgroundColor: colors.bg, borderColor: colors.border }}>
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[11px] font-semibold uppercase" style={{ color: colors.fg }}>{row.category}</span>
                <span className="font-mono text-[11px]" style={{ color: colors.fg }}>{formatNumber(row.count)}</span>
              </div>
              <div className="mt-1 truncate text-[10px]" style={{ color: 'var(--pd-muted)' }}>
                {row.models[0]?.label ?? 'no model signal'}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CostScopeTable({ summary }: { summary: UsageTelemetrySummary | null }) {
  const rows = summary?.costByScope ?? [];
  return (
    <div className="border p-3" style={{ backgroundColor: 'var(--pd-surface)', borderColor: 'var(--pd-border)' }}>
      <div className="flex items-center gap-2 text-[10px] font-semibold tracking-wider" style={{ color: 'var(--pd-dim)' }}>
        <BarChart3 size={13} />
        <span>COST SCOPE</span>
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-left text-[11px]">
          <thead style={{ color: 'var(--pd-dim)' }}>
            <tr>
              <th className="border-b py-2 pr-3" style={{ borderColor: 'var(--pd-border)' }}>Scope</th>
              <th className="border-b py-2 pr-3 text-right" style={{ borderColor: 'var(--pd-border)' }}>Events</th>
              <th className="border-b py-2 pr-3 text-right" style={{ borderColor: 'var(--pd-border)' }}>Tokens</th>
              <th className="border-b py-2 pr-3 text-right" style={{ borderColor: 'var(--pd-border)' }}>Turns</th>
              <th className="border-b py-2 pr-3 text-right" style={{ borderColor: 'var(--pd-border)' }}>Tool calls</th>
              <th className="border-b py-2 pr-3 text-right" style={{ borderColor: 'var(--pd-border)' }}>Cost</th>
              <th className="border-b py-2 text-right" style={{ borderColor: 'var(--pd-border)' }}>Est.</th>
            </tr>
          </thead>
          <tbody style={{ color: 'var(--pd-text)' }}>
            {rows.map((row) => (
              <tr key={row.scope}>
                <td className="border-b py-2 pr-3 font-mono" style={{ borderColor: 'var(--pd-border)' }}>{row.scope}</td>
                <td className="border-b py-2 pr-3 text-right font-mono" style={{ borderColor: 'var(--pd-border)' }}>{formatNumber(row.events)}</td>
                <td className="border-b py-2 pr-3 text-right font-mono" style={{ borderColor: 'var(--pd-border)' }}>{formatNumber(row.totalTokens)}</td>
                <td className="border-b py-2 pr-3 text-right font-mono" style={{ borderColor: 'var(--pd-border)' }}>{formatNumber(row.turns)}</td>
                <td className="border-b py-2 pr-3 text-right font-mono" style={{ borderColor: 'var(--pd-border)' }}>{formatNumber(row.toolCalls)}</td>
                <td className="border-b py-2 pr-3 text-right font-mono" style={{ borderColor: 'var(--pd-border)' }}>{formatUsd(row.costUsd)}</td>
                <td className="border-b py-2 text-right font-mono" style={{ borderColor: 'var(--pd-border)' }}>{formatNumber(row.estimatedCostEvents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TopCallsTable({ rows }: { rows: UsageNameRow[] }) {
  return (
    <div className="border p-3" style={{ backgroundColor: 'var(--pd-surface)', borderColor: 'var(--pd-border)' }}>
      <div className="flex items-center gap-2 text-[10px] font-semibold tracking-wider" style={{ color: 'var(--pd-dim)' }}>
        <Table2 size={13} />
        <span>TOP CALLS, VIEWS, AND INTERACTIONS</span>
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[780px] border-collapse text-left text-[11px]">
          <thead style={{ color: 'var(--pd-dim)' }}>
            <tr>
              <th className="border-b py-2 pr-3" style={{ borderColor: 'var(--pd-border)' }}>Surface</th>
              <th className="border-b py-2 pr-3" style={{ borderColor: 'var(--pd-border)' }}>Kind</th>
              <th className="border-b py-2 pr-3" style={{ borderColor: 'var(--pd-border)' }}>Capability</th>
              <th className="border-b py-2 pr-3" style={{ borderColor: 'var(--pd-border)' }}>Name</th>
              <th className="border-b py-2 pr-3 text-right" style={{ borderColor: 'var(--pd-border)' }}>Count</th>
              <th className="border-b py-2 pr-3 text-right" style={{ borderColor: 'var(--pd-border)' }}>Avg</th>
              <th className="border-b py-2 text-right" style={{ borderColor: 'var(--pd-border)' }}>Last</th>
            </tr>
          </thead>
          <tbody style={{ color: 'var(--pd-text)' }}>
            {rows.slice(0, 14).map((row) => (
              <tr key={`${row.surface}:${row.kind}:${row.name}`}>
                <td className="border-b py-2 pr-3 font-mono" style={{ borderColor: 'var(--pd-border)' }}>{row.surface}</td>
                <td className="border-b py-2 pr-3" style={{ borderColor: 'var(--pd-border)' }}>{row.kind}</td>
                <td className="border-b py-2 pr-3" style={{ borderColor: 'var(--pd-border)' }}>{row.category}</td>
                <td className="border-b py-2 pr-3 font-mono" style={{ borderColor: 'var(--pd-border)' }}>{row.name}</td>
                <td className="border-b py-2 pr-3 text-right font-mono" style={{ borderColor: 'var(--pd-border)' }}>{formatNumber(row.count)}</td>
                <td className="border-b py-2 pr-3 text-right font-mono" style={{ borderColor: 'var(--pd-border)' }}>{formatDuration(row.avgDurationMs)}</td>
                <td className="border-b py-2 text-right" style={{ borderColor: 'var(--pd-border)' }}>{formatTime(row.lastSeen)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function UsageTelemetryPanel({ projectDir }: { projectDir?: string }) {
  const [windowValue, setWindowValue] = useState<typeof WINDOWS[number]['value']>('7d');
  const [summary, setSummary] = useState<UsageTelemetrySummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setSummary(await fetchUsageSummary({ window: windowValue, limit: 120 }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [windowValue]);

  useEffect(() => {
    void recordUsageEvent({
      surface: 'ui',
      kind: 'view',
      name: 'fleet-console.developer',
      category: 'usage',
      projectDir,
      metadata: { window: windowValue },
    });
  }, [projectDir, windowValue]);

  const insights = useMemo(() => {
    const pheromones = summary?.capabilities.find((row) => row.category === 'pheromones')?.count ?? 0;
    const tuples = summary?.capabilities.find((row) => row.category === 'tuples')?.count ?? 0;
    const codexTuple = summary?.agentCapabilityMatrix
      .filter((row) => row.category === 'tuples' && /codex|gpt/i.test(`${row.agentType} ${row.agentModel} ${row.backend} ${row.model}`))
      .reduce((sum, row) => sum + row.count, 0) ?? 0;
    return [
      { label: 'Pheromones', value: pheromones, note: pheromones === 0 ? 'Unused in window' : 'Observed' },
      { label: 'Tuples', value: tuples, note: tuples === 0 ? 'No tuple traffic' : 'Coordination signal' },
      { label: 'Codex + tuples', value: codexTuple, note: codexTuple === 0 ? 'Gap to investigate' : 'Codex is using tuples' },
    ];
  }, [summary]);

  return (
    <div className="h-full overflow-y-auto" style={{ backgroundColor: 'var(--pd-bg)' }}>
      <div className="mx-auto max-w-[1440px] px-4 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-semibold tracking-wider" style={{ color: 'var(--pd-dim)' }}>
              <DatabaseZap size={14} />
              <span>DEVELOPER TELEMETRY</span>
            </div>
            <h2 className="mt-1 text-xl font-semibold" style={{ color: 'var(--pd-text)' }}>Port Daddy usage traces</h2>
            <div className="mt-1 text-xs" style={{ color: 'var(--pd-muted)' }}>
              Local counters for CLI, SDK, MCP, daemon routes, and Fleet Console views.
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex border" style={{ borderColor: 'var(--pd-border)' }}>
              {WINDOWS.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setWindowValue(item.value)}
                  className="px-3 py-2 text-[11px] font-semibold"
                  style={{
                    backgroundColor: windowValue === item.value ? 'var(--pd-accent-surface)' : 'var(--pd-surface)',
                    color: windowValue === item.value ? 'var(--pd-accent)' : 'var(--pd-muted)',
                    borderRight: item.value === '30d' ? 'none' : '1px solid var(--pd-border)',
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="inline-flex items-center gap-2 border px-3 py-2 text-[11px] font-semibold disabled:opacity-50"
              style={{ color: 'var(--pd-text)', borderColor: 'var(--pd-border)', backgroundColor: 'var(--pd-surface)' }}
            >
              <RefreshCw size={13} />
              <span>{loading ? 'Refreshing' : 'Refresh'}</span>
            </button>
          </div>
        </div>

        {error ? (
          <div className="mt-4 border p-3 text-sm" style={{ color: 'var(--pd-accent)', borderColor: 'var(--pd-accent-border)', backgroundColor: 'var(--pd-accent-surface)' }}>
            {error}
          </div>
        ) : null}

        <div className="mt-4 grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
          <MetricTile label="EVENTS" value={formatNumber(summary?.totals.events ?? 0)} sub="append-only trace rows" />
          <MetricTile label="AGENTS" value={formatNumber(summary?.totals.uniqueAgents ?? 0)} sub="distinct agent signals" />
          <MetricTile label="PROJECTS" value={formatNumber(summary?.totals.uniqueProjects ?? 0)} sub="work contexts observed" />
          <MetricTile label="MODELS" value={formatNumber(summary?.totals.uniqueModels ?? 0)} sub="model/backend labels" />
          <MetricTile label="TOKENS" value={formatNumber(summary?.totals.totalTokens ?? 0)} sub="input + output tracked" />
          <MetricTile label="COST" value={formatUsd(summary?.totals.costUsd ?? 0)} sub="local estimate/exact USD" />
        </div>

        <div className="mt-3 grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          {insights.map((item) => {
            const colors = statusColor(item.value);
            return (
              <div key={item.label} className="border px-3 py-3" style={{ backgroundColor: colors.bg, borderColor: colors.border }}>
                <div className="text-[10px] font-semibold tracking-wider" style={{ color: colors.fg }}>{item.label.toUpperCase()}</div>
                <div className="mt-2 flex items-end justify-between gap-3">
                  <span className="text-2xl font-semibold tabular-nums" style={{ color: colors.fg }}>{formatNumber(item.value)}</span>
                  <span className="text-[11px] font-semibold" style={{ color: colors.fg }}>{item.note}</span>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-3 grid gap-3 xl:grid-cols-3">
          <BreakdownBars title="SURFACES" icon={<Eye size={13} />} rows={summary?.bySurface ?? []} />
          <BreakdownBars title="EVENT KINDS" icon={<Activity size={13} />} rows={summary?.byKind ?? []} />
          <BreakdownBars title="CAPABILITIES" icon={<BarChart3 size={13} />} rows={summary?.byCategory ?? []} />
        </div>

        <div className="mt-3">
          <CapabilityGrid rows={summary?.capabilities ?? []} />
        </div>

        <div className="mt-3">
          <CostScopeTable summary={summary} />
        </div>

        <div className="mt-3">
          <TopCallsTable rows={summary?.topNames ?? []} />
        </div>

        <div className="mt-3 grid gap-3 xl:grid-cols-[1fr_1.2fr]">
          <div className="border p-3" style={{ backgroundColor: 'var(--pd-surface)', borderColor: 'var(--pd-border)' }}>
            <div className="text-[10px] font-semibold tracking-wider" style={{ color: 'var(--pd-dim)' }}>AGENT TYPE AND MODEL</div>
            <div className="mt-3 space-y-2">
              {(summary?.agentModels ?? []).slice(0, 12).map((row) => (
                <div key={`${row.agentType}:${row.agentModel}:${row.backend}:${row.model}:${row.surface}`} className="flex items-center justify-between gap-3 border-b pb-2" style={{ borderColor: 'var(--pd-border)' }}>
                  <div className="min-w-0">
                    <div className="truncate text-xs font-semibold" style={{ color: 'var(--pd-text)' }}>
                      {row.agentType} / {row.agentModel}
                    </div>
                    <div className="truncate text-[10px]" style={{ color: 'var(--pd-muted)' }}>{row.backend} / {row.model} / {row.surface}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-xs" style={{ color: 'var(--pd-text)' }}>{formatNumber(row.count)}</div>
                    <div className="text-[10px]" style={{ color: 'var(--pd-muted)' }}>{formatTime(row.lastSeen)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="border p-3" style={{ backgroundColor: 'var(--pd-surface)', borderColor: 'var(--pd-border)' }}>
            <div className="text-[10px] font-semibold tracking-wider" style={{ color: 'var(--pd-dim)' }}>RECENT TRACE</div>
            <div className="mt-3 max-h-[420px] overflow-y-auto">
              {(summary?.recent ?? []).slice(0, 24).map((event) => (
                <div key={event.id} className="grid grid-cols-[90px_76px_1fr_72px] gap-2 border-b py-2 text-[11px]" style={{ borderColor: 'var(--pd-border)', color: 'var(--pd-text)' }}>
                  <span style={{ color: 'var(--pd-muted)' }}>{formatTime(event.timestamp)}</span>
                  <span className="font-mono">{event.surface}</span>
                  <span className="min-w-0 truncate font-mono">{event.name}</span>
                  <span className="text-right" style={{ color: 'var(--pd-muted)' }}>{event.category}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {summary ? (
          <div className="mt-3 text-[10px]" style={{ color: 'var(--pd-dim)' }}>
            Daemon build {summary.build.version} / {summary.build.codeHash} / {summary.build.buildDate}
          </div>
        ) : null}
      </div>
    </div>
  );
}
