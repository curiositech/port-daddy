import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Clock3, Map, RefreshCw, Route, ScrollText } from 'lucide-react';

import { fetchRoadmapProgress } from '../api';
import { summarizeRoadmapProgress } from '../lib/roadmap-panel';
import type { RoadmapFeedbackEntry, RoadmapProgress } from '../types';

function formatAge(hours: number | null): string {
  if (hours === null) return 'freshness unknown';
  if (hours < 0.1) return 'updated just now';
  if (hours < 1) return `updated ${Math.round(hours * 60)}m ago`;
  if (hours < 24) return `updated ${hours.toFixed(1)}h ago`;
  return `updated ${(hours / 24).toFixed(1)}d ago`;
}

function formatClock(timestamp: number | null | undefined): string {
  if (!timestamp) return 'never';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return 'unknown';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function StatusBadge({ label, tone = 'default' }: { label: string; tone?: 'default' | 'success' | 'warning' }) {
  const palette = tone === 'success'
    ? ['var(--pd-success-surface)', 'var(--pd-success)', 'var(--pd-success-border)']
    : tone === 'warning'
      ? ['var(--pd-warning-surface)', 'var(--pd-warning)', 'var(--pd-warning-border)']
      : ['var(--pd-bg)', 'var(--pd-muted)', 'var(--pd-border)'];

  return (
    <span
      className="rounded-full px-2 py-1 text-[10px] font-semibold"
      style={{ backgroundColor: palette[0], color: palette[1], border: `1px solid ${palette[2]}` }}
    >
      {label}
    </span>
  );
}

function FeedbackRow({ entry }: { entry: RoadmapFeedbackEntry }) {
  return (
    <div className="rounded-md border px-3 py-2" style={{ backgroundColor: 'var(--pd-bg)', borderColor: 'var(--pd-border)' }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-mono text-xs font-semibold" style={{ color: 'var(--pd-text)' }}>{entry.slug}</div>
          {entry.hook && <div className="mt-1 text-xs leading-snug" style={{ color: 'var(--pd-muted)' }}>{entry.hook}</div>}
        </div>
        <StatusBadge label={entry.status} tone={entry.status === 'now' ? 'success' : 'default'} />
      </div>
      {entry.surface && (
        <div className="mt-2 text-[10px] font-semibold" style={{ color: 'var(--pd-dim)' }}>
          {entry.surface}
        </div>
      )}
    </div>
  );
}

function ExcerptPanel({ title, body }: { title: string; body: string | null }) {
  if (!body) return null;
  return (
    <div className="min-h-0 rounded-lg border" style={{ backgroundColor: 'var(--pd-bg)', borderColor: 'var(--pd-border)' }}>
      <div className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: '1px solid var(--pd-border)' }}>
        <ScrollText size={13} color="var(--pd-dim)" />
        <span className="text-[10px] font-semibold tracking-wider" style={{ color: 'var(--pd-dim)' }}>{title}</span>
      </div>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap px-3 py-2 text-[11px] leading-relaxed" style={{ color: 'var(--pd-muted)' }}>
        {body.trim()}
      </pre>
    </div>
  );
}

export default function RoadmapPanel({
  projectDir,
  projectName,
}: {
  projectDir?: string;
  projectName?: string;
}) {
  const [progress, setProgress] = useState<RoadmapProgress | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setProgress(await fetchRoadmapProgress(projectDir));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [projectDir]);

  useEffect(() => {
    void load();
  }, [load]);

  const summary = useMemo(() => summarizeRoadmapProgress(progress), [progress]);
  const nextCuts = progress?.nextCuts.slice(0, 8) ?? [];
  const ideasNow = progress?.ideasNow.slice(0, 8) ?? [];
  const dogfoodFeedback = progress?.dogfoodFeedback.slice(0, 8) ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3" style={{ borderBottom: '1px solid var(--pd-border)', backgroundColor: 'var(--pd-surface)' }}>
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[10px] font-semibold tracking-wider" style={{ color: 'var(--pd-dim)' }}>
            <Map size={13} />
            <span>CARTOGRAPHER ROADMAP</span>
          </div>
          <div className="mt-1 text-sm font-semibold" style={{ color: 'var(--pd-text)' }}>
            {projectName ?? 'Selected project'} projection
          </div>
          <div className="mt-1 text-xs" style={{ color: 'var(--pd-muted)' }}>{summary}</div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <StatusBadge
            label={formatAge(progress?.freshness.hoursSinceLastUpdate ?? null)}
            tone={progress?.freshness.hoursSinceLastUpdate != null && progress.freshness.hoursSinceLastUpdate < 24 ? 'success' : 'warning'}
          />
          <StatusBadge label={`generated ${formatClock(progress?.generatedAt)}`} />
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-semibold disabled:cursor-not-allowed"
            style={{ color: 'var(--pd-text)', border: '1px solid var(--pd-border)', backgroundColor: 'var(--pd-bg)', opacity: loading ? 0.65 : 1 }}
          >
            <RefreshCw size={13} />
            <span>{loading ? 'Refreshing' : 'Refresh'}</span>
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border px-3 py-2" style={{ backgroundColor: 'var(--pd-warning-surface)', borderColor: 'var(--pd-warning-border)', color: 'var(--pd-warning)' }}>
            <AlertTriangle size={15} />
            <span className="text-sm font-semibold">{error}</span>
          </div>
        )}

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
          <div className="grid gap-4">
            <div className="rounded-lg border" style={{ backgroundColor: 'var(--pd-surface)', borderColor: 'var(--pd-border)' }}>
              <div className="flex items-center justify-between gap-3 px-3 py-2" style={{ borderBottom: '1px solid var(--pd-border)' }}>
                <div className="flex items-center gap-2">
                  <Route size={13} color="var(--pd-dim)" />
                  <span className="text-[10px] font-semibold tracking-wider" style={{ color: 'var(--pd-dim)' }}>NEXT CUTS</span>
                </div>
                <StatusBadge label={`${progress?.nextCuts.length ?? 0} total`} />
              </div>
              <div className="grid gap-2 p-3">
                {nextCuts.length === 0 ? (
                  <div className="text-sm" style={{ color: 'var(--pd-muted)' }}>No next cuts surfaced yet.</div>
                ) : nextCuts.map((cut) => (
                  <div key={cut.slug} className="rounded-md border px-3 py-2" style={{ backgroundColor: 'var(--pd-bg)', borderColor: 'var(--pd-border)' }}>
                    <div className="font-mono text-xs font-semibold" style={{ color: 'var(--pd-text)' }}>{cut.slug}</div>
                    <div className="mt-1 text-xs leading-snug" style={{ color: 'var(--pd-muted)' }}>{cut.summary}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid gap-4 2xl:grid-cols-2">
              <div className="rounded-lg border" style={{ backgroundColor: 'var(--pd-surface)', borderColor: 'var(--pd-border)' }}>
                <div className="flex items-center justify-between gap-3 px-3 py-2" style={{ borderBottom: '1px solid var(--pd-border)' }}>
                  <span className="text-[10px] font-semibold tracking-wider" style={{ color: 'var(--pd-dim)' }}>CURATED NOW</span>
                  <StatusBadge label={`${progress?.ideasNow.length ?? 0} total`} tone="success" />
                </div>
                <div className="grid gap-2 p-3">
                  {ideasNow.length === 0 ? <div className="text-sm" style={{ color: 'var(--pd-muted)' }}>No now items surfaced.</div> : ideasNow.map((entry) => <FeedbackRow key={entry.slug} entry={entry} />)}
                </div>
              </div>

              <div className="rounded-lg border" style={{ backgroundColor: 'var(--pd-surface)', borderColor: 'var(--pd-border)' }}>
                <div className="flex items-center justify-between gap-3 px-3 py-2" style={{ borderBottom: '1px solid var(--pd-border)' }}>
                  <span className="text-[10px] font-semibold tracking-wider" style={{ color: 'var(--pd-dim)' }}>DOGFOOD FEEDBACK</span>
                  <StatusBadge label={`${progress?.dogfoodFeedback.length ?? 0} total`} />
                </div>
                <div className="grid gap-2 p-3">
                  {dogfoodFeedback.length === 0 ? <div className="text-sm" style={{ color: 'var(--pd-muted)' }}>No dogfood feedback surfaced.</div> : dogfoodFeedback.map((entry) => <FeedbackRow key={entry.slug} entry={entry} />)}
                </div>
              </div>
            </div>
          </div>

          <div className="grid min-h-0 gap-4">
            {progress?.warnings.length ? (
              <div className="rounded-lg border px-3 py-3" style={{ backgroundColor: 'var(--pd-warning-surface)', borderColor: 'var(--pd-warning-border)' }}>
                <div className="flex items-center gap-2 text-[10px] font-semibold tracking-wider" style={{ color: 'var(--pd-warning)' }}>
                  <AlertTriangle size={13} />
                  <span>WARNINGS</span>
                </div>
                <ul className="mt-2 space-y-1 text-xs" style={{ color: 'var(--pd-warning)' }}>
                  {progress.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                </ul>
              </div>
            ) : (
              <div className="rounded-lg border px-3 py-3" style={{ backgroundColor: 'var(--pd-success-surface)', borderColor: 'var(--pd-success-border)' }}>
                <div className="flex items-center gap-2 text-[10px] font-semibold tracking-wider" style={{ color: 'var(--pd-success)' }}>
                  <Clock3 size={13} />
                  <span>SOURCES READABLE</span>
                </div>
                <div className="mt-1 text-xs" style={{ color: 'var(--pd-muted)' }}>
                  Cartographer roadmap, trove, feedback, current-work, and status sources loaded.
                </div>
              </div>
            )}

            <ExcerptPanel title="CURRENT WORK" body={progress?.currentWorkExcerpt ?? null} />
            <ExcerptPanel title="CARTOGRAPHER STATUS" body={progress?.cartographerStatusExcerpt ?? null} />
          </div>
        </div>
      </div>
    </div>
  );
}
