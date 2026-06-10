/**
 * CoastGuardPanel — daemon-side attestation report from GET /attest.
 *
 * Route used: GET /attest
 *
 * The OS-sandbox posture is CLI-only (pd attest runs on the CLI side and
 * merges its own checks with the daemon's). This panel surfaces what the
 * daemon's /attest returns and shows a clear note that a full posture
 * report requires `pd attest` in the terminal.
 */

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, RefreshCw, ShieldCheck, Terminal } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

type InvariantStatus = 'pass' | 'fail' | 'skipped' | 'unknown';
type InvariantSeverity = 'critical' | 'warn' | 'info';
type InvariantClass = 'liveness' | 'integrity' | 'security' | 'freshness' | string;

interface InvariantResult {
  id: string;
  class: InvariantClass;
  severity: InvariantSeverity;
  title: string;
  status: InvariantStatus;
  detail?: string;
  fix?: string;
}

interface AttestReport {
  results: InvariantResult[];
  green: boolean;
  counts: Record<string, number>;
  criticalProblems: InvariantResult[];
  unverified: InvariantResult[];
  generatedAt: number;
}

// ─── API helper ───────────────────────────────────────────────────────────────

function daemonBase(): string {
  if (typeof window !== 'undefined') {
    const stored = window.localStorage?.getItem('pd.fleet-ui.daemon-url');
    if (stored) return stored;
  }
  return 'http://127.0.0.1:9876';
}

async function fetchAttest(): Promise<{ success: boolean; report?: AttestReport; error?: string }> {
  const res = await fetch(`${daemonBase()}/attest`);
  const body = await res.json().catch(() => ({ success: false, error: 'failed to parse response' })) as {
    success: boolean; report?: AttestReport; error?: string
  };
  return body;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function statusIcon(status: InvariantStatus, severity: InvariantSeverity) {
  if (status === 'pass') return <CheckCircle2 size={13} style={{ color: 'var(--pd-success)', flexShrink: 0 }} />;
  if (status === 'fail' && severity === 'critical') return <AlertTriangle size={13} style={{ color: 'var(--pd-accent)', flexShrink: 0 }} />;
  if (status === 'fail') return <AlertTriangle size={13} style={{ color: 'var(--pd-warning)', flexShrink: 0 }} />;
  if (status === 'skipped') return <Info size={13} style={{ color: 'var(--pd-dim)', flexShrink: 0 }} />;
  return <Info size={13} style={{ color: 'var(--pd-warning)', flexShrink: 0 }} />;
}

function severityStyle(severity: InvariantSeverity): React.CSSProperties {
  if (severity === 'critical') return { color: 'var(--pd-accent)' };
  if (severity === 'warn') return { color: 'var(--pd-warning)' };
  return { color: 'var(--pd-dim)' };
}

function statusRowBg(result: InvariantResult): React.CSSProperties {
  if (result.status === 'pass') return { backgroundColor: 'var(--pd-bg)' };
  if (result.status === 'fail' && result.severity === 'critical') return { backgroundColor: 'var(--pd-accent-surface)' };
  if (result.status === 'fail') return { backgroundColor: 'var(--pd-warning-surface)' };
  return { backgroundColor: 'var(--pd-bg)' };
}

function InvariantRow({ result }: { result: InvariantResult }) {
  const [open, setOpen] = useState(false);
  const hasExtra = !!(result.detail || result.fix);

  return (
    <div
      className="rounded-md border px-3 py-2"
      style={{ borderColor: 'var(--pd-border)', ...statusRowBg(result) }}
    >
      <div className="flex items-start gap-2">
        {statusIcon(result.status, result.severity)}
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold" style={{ color: 'var(--pd-text)' }}>{result.title}</span>
            <span
              className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
              style={severityStyle(result.severity)}
            >
              {result.severity}
            </span>
            <span className="text-sm font-mono" style={{ color: 'var(--pd-dim)' }}>{result.class}</span>
          </div>
          {hasExtra && (
            <button
              type="button"
              onClick={() => setOpen(v => !v)}
              className="mt-1 text-sm font-semibold"
              style={{ color: 'var(--pd-accent)' }}
            >
              {open ? 'Hide detail' : 'Show detail'}
            </button>
          )}
          {open && (
            <div className="mt-2 space-y-1">
              {result.detail && (
                <div className="text-sm" style={{ color: 'var(--pd-muted)' }}>{result.detail}</div>
              )}
              {result.fix && (
                <div
                  className="rounded-md px-2 py-1.5 text-sm font-mono"
                  style={{ backgroundColor: 'var(--pd-code)', color: 'var(--pd-muted)', border: '1px solid var(--pd-border)' }}
                >
                  fix: {result.fix}
                </div>
              )}
            </div>
          )}
        </div>
        <span
          className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase"
          style={{
            backgroundColor: result.status === 'pass' ? 'var(--pd-success-surface)'
              : result.status === 'fail' ? 'var(--pd-accent-surface)'
              : 'var(--pd-bg)',
            color: result.status === 'pass' ? 'var(--pd-success)'
              : result.status === 'fail' ? 'var(--pd-accent)'
              : 'var(--pd-dim)',
          }}
        >
          {result.status}
        </span>
      </div>
    </div>
  );
}

type ClassFilter = 'all' | InvariantClass;

function useClassFilters(results: InvariantResult[]): ClassFilter[] {
  const classes = Array.from(new Set(results.map(r => r.class))).sort();
  return ['all', ...classes] as ClassFilter[];
}

// ─── CoastGuardPanel ──────────────────────────────────────────────────────────

export default function CoastGuardPanel() {
  const [report, setReport] = useState<AttestReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [classFilter, setClassFilter] = useState<ClassFilter>('all');

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchAttest();
      if (!result.success || !result.report) {
        setError(result.error ?? 'Attest returned no report');
      } else {
        setReport(result.report);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const classFilters = useClassFilters(report?.results ?? []);

  const filtered = (report?.results ?? []).filter(r =>
    classFilter === 'all' ? true : r.class === classFilter
  );

  const green = report?.green ?? false;
  const criticalCount = report?.criticalProblems.length ?? 0;
  const skippedCount = report?.unverified.length ?? 0;
  const passCount = (report?.counts?.['pass'] as number | undefined) ?? 0;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="px-4 py-3 flex items-center justify-between gap-3 flex-shrink-0" style={{ borderBottom: '1px solid var(--pd-border)' }}>
        <div>
          <div className="text-[10px] font-semibold tracking-wider" style={{ color: 'var(--pd-dim)' }}>COAST GUARD — ATTESTATION</div>
          <div className="mt-0.5 flex items-center gap-2">
            {!loading && report && (
              <span
                className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold"
                style={{
                  backgroundColor: green ? 'var(--pd-success-surface)' : 'var(--pd-warning-surface)',
                  color: green ? 'var(--pd-success)' : 'var(--pd-warning)',
                  border: `1px solid ${green ? 'var(--pd-success-border)' : 'var(--pd-warning-border)'}`,
                }}
              >
                <ShieldCheck size={11} />
                {green ? 'GREEN — all checked invariants pass' : 'NOT GREEN'}
              </span>
            )}
            {loading && <span className="text-sm" style={{ color: 'var(--pd-muted)' }}>Loading…</span>}
          </div>
        </div>
        <button
          onClick={() => void reload()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold"
          style={{ color: 'var(--pd-text)', border: '1px solid var(--pd-border)', backgroundColor: 'var(--pd-surface)' }}
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* CLI note */}
      <div
        className="px-4 py-2 flex items-start gap-2 flex-shrink-0 text-sm"
        style={{ backgroundColor: 'var(--pd-surface)', borderBottom: '1px solid var(--pd-border)' }}
      >
        <Terminal size={13} className="shrink-0 mt-0.5" style={{ color: 'var(--pd-dim)' }} />
        <span style={{ color: 'var(--pd-muted)' }}>
          This panel shows the <span className="font-mono">GET /attest</span> report (daemon-side invariants only).
          For the full posture including CLI/install probes, run{' '}
          <span
            className="font-mono rounded-sm px-1"
            style={{ backgroundColor: 'var(--pd-code)', color: 'var(--pd-accent)' }}
          >
            pd attest
          </span>{' '}
          in your terminal.
        </span>
      </div>

      {/* Counts strip */}
      {report && (
        <div className="px-4 py-2 flex flex-wrap gap-3 text-sm flex-shrink-0" style={{ borderBottom: '1px solid var(--pd-border)' }}>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: 'var(--pd-success)' }} />
            <span style={{ color: 'var(--pd-muted)' }}>{passCount} passed</span>
          </span>
          {criticalCount > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: 'var(--pd-accent)' }} />
              <span style={{ color: 'var(--pd-accent)', fontWeight: 600 }}>{criticalCount} critical problem{criticalCount !== 1 ? 's' : ''}</span>
            </span>
          )}
          {skippedCount > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: 'var(--pd-dim)' }} />
              <span style={{ color: 'var(--pd-dim)' }}>{skippedCount} unverified (scoped green)</span>
            </span>
          )}
          {report.generatedAt > 0 && (
            <span style={{ color: 'var(--pd-dim)' }}>
              generated {new Date(report.generatedAt).toLocaleTimeString()}
            </span>
          )}
        </div>
      )}

      {/* Class filter tabs */}
      {classFilters.length > 1 && (
        <div className="flex gap-0.5 px-4 pt-2 flex-shrink-0" style={{ borderBottom: '1px solid var(--pd-border)' }}>
          {classFilters.map(cls => (
            <button
              key={cls}
              onClick={() => setClassFilter(cls)}
              className="px-3 py-1.5 text-xs font-semibold tracking-wide rounded-t whitespace-nowrap capitalize"
              style={{
                backgroundColor: classFilter === cls ? 'var(--pd-surface)' : 'transparent',
                color: classFilter === cls ? 'var(--pd-text)' : 'var(--pd-muted)',
                borderBottom: classFilter === cls ? '2px solid var(--pd-accent)' : '2px solid transparent',
              }}
            >
              {cls}
            </button>
          ))}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
        {error && (
          <div
            className="mb-3 flex items-center gap-2 rounded-md px-3 py-2 text-xs font-semibold"
            style={{ backgroundColor: 'var(--pd-accent-surface)', color: 'var(--pd-accent)', border: '1px solid var(--pd-accent-border)' }}
          >
            <AlertTriangle size={13} />
            {error}
          </div>
        )}
        {!loading && filtered.length === 0 && !error && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="text-sm font-semibold" style={{ color: 'var(--pd-muted)' }}>No invariants to show</div>
          </div>
        )}
        <div className="flex flex-col gap-2">
          {filtered.map(r => (
            <InvariantRow key={r.id} result={r} />
          ))}
        </div>
      </div>
    </div>
  );
}
