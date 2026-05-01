import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Compass, FileText, RefreshCw } from 'lucide-react';

import { fetchCockpitMissions } from '../api';
import type { MissionCard, MissionIntake, MissionStatus } from '../types';

const FILTERS: ReadonlyArray<{ id: 'all' | MissionStatus; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'uncommitted', label: 'Uncommitted' },
  { id: 'in-flight', label: 'In flight' },
  { id: 'blocked', label: 'Blocked' },
  { id: 'drifting', label: 'Drifting' },
  { id: 'stalled', label: 'Stalled' },
  { id: 'mostly-committed', label: 'Mostly committed' },
  { id: 'mostly-resolved', label: 'Mostly resolved' },
  { id: 'closed', label: 'Closed' },
];

type StatusTone = 'default' | 'success' | 'warning' | 'critical';

const STATUS_TONE: Record<MissionStatus, StatusTone> = {
  closed: 'success',
  'mostly-resolved': 'success',
  'mostly-committed': 'success',
  uncommitted: 'warning',
  'in-flight': 'warning',
  blocked: 'critical',
  drifting: 'critical',
  stalled: 'critical',
  unknown: 'default',
};

function tonePalette(tone: StatusTone): [string, string, string] {
  if (tone === 'success') {
    return ['var(--pd-success-surface)', 'var(--pd-success)', 'var(--pd-success-border)'];
  }
  if (tone === 'warning') {
    return ['var(--pd-warning-surface)', 'var(--pd-warning)', 'var(--pd-warning-border)'];
  }
  if (tone === 'critical') {
    return ['var(--pd-danger-surface)', 'var(--pd-danger)', 'var(--pd-danger-border)'];
  }
  return ['var(--pd-bg)', 'var(--pd-muted)', 'var(--pd-border)'];
}

function StatusBadge({ status }: { status: MissionStatus }) {
  const [bg, fg, border] = tonePalette(STATUS_TONE[status]);
  return (
    <span
      className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
      style={{ backgroundColor: bg, color: fg, border: `1px solid ${border}` }}
    >
      {status}
    </span>
  );
}

function MissionRow({ mission }: { mission: MissionCard }) {
  const [open, setOpen] = useState(false);
  const fileChips = mission.files.slice(0, 4);
  const overflowFiles = Math.max(0, mission.files.length - fileChips.length);

  return (
    <div
      className="rounded-md border px-3 py-2"
      style={{ backgroundColor: 'var(--pd-bg)', borderColor: 'var(--pd-border)' }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold" style={{ color: 'var(--pd-text)' }}>
            {mission.title}
          </div>
          {mission.summary && (
            <div
              className="mt-1 line-clamp-2 text-xs leading-snug"
              style={{ color: 'var(--pd-muted)' }}
            >
              {mission.summary}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <StatusBadge status={mission.status} />
        </div>
      </div>
      <div
        className="mt-2 flex flex-wrap items-center gap-2 text-[10px] font-mono"
        style={{ color: 'var(--pd-dim)' }}
      >
        <span className="inline-flex items-center gap-1">
          <FileText size={10} />
          <span>{mission.source}</span>
        </span>
        {fileChips.map((file) => (
          <span
            key={file}
            className="rounded border px-1.5 py-0.5"
            style={{
              backgroundColor: 'var(--pd-surface)',
              borderColor: 'var(--pd-border)',
              color: 'var(--pd-muted)',
            }}
          >
            {file}
          </span>
        ))}
        {overflowFiles > 0 && (
          <span style={{ color: 'var(--pd-dim)' }}>+{overflowFiles} more</span>
        )}
      </div>
      {mission.evidence.length > 0 && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="text-[10px] font-semibold uppercase tracking-wide"
            style={{ color: 'var(--pd-accent)' }}
          >
            {open
              ? `Hide ${mission.evidence.length} evidence line${mission.evidence.length === 1 ? '' : 's'}`
              : `Show ${mission.evidence.length} evidence line${mission.evidence.length === 1 ? '' : 's'}`}
          </button>
          {open && (
            <ul
              className="mt-1 list-disc pl-4 text-xs leading-snug"
              style={{ color: 'var(--pd-muted)' }}
            >
              {mission.evidence.map((line, i) => (
                <li key={i} className="break-words">
                  {line}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

interface CockpitMissionsPanelProps {
  projectDir?: string;
}

export default function CockpitMissionsPanel({ projectDir }: CockpitMissionsPanelProps) {
  const [intake, setIntake] = useState<MissionIntake | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | MissionStatus>('all');

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await fetchCockpitMissions(projectDir ? { projectDir } : {});
      setIntake(next);
    } catch (err) {
      setError((err as Error).message || 'failed to load missions');
    } finally {
      setLoading(false);
    }
  }, [projectDir]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const visible = useMemo(() => {
    if (!intake) return [];
    if (filter === 'all') return intake.missions;
    return intake.missions.filter((m) => m.status === filter);
  }, [intake, filter]);

  const counts = useMemo(() => {
    if (!intake) return new Map<string, number>();
    const map = new Map<string, number>();
    map.set('all', intake.missions.length);
    for (const m of intake.missions) map.set(m.status, (map.get(m.status) ?? 0) + 1);
    return map;
  }, [intake]);

  return (
    <section
      className="rounded-lg border p-4"
      style={{ backgroundColor: 'var(--pd-surface)', borderColor: 'var(--pd-border)' }}
    >
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Compass size={16} style={{ color: 'var(--pd-accent)' }} />
          <div>
            <div className="text-sm font-semibold" style={{ color: 'var(--pd-text)' }}>
              Roadmap intake
            </div>
            <div className="text-[10px]" style={{ color: 'var(--pd-dim)' }}>
              Cockpit work queue from CURRENT-WORK.md, UNIFIED-ROADMAP.md, and
              .cartographer/status.md
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void reload()}
          disabled={loading}
          className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[10px] font-semibold disabled:cursor-not-allowed"
          style={{
            color: 'var(--pd-text)',
            border: '1px solid var(--pd-border)',
            backgroundColor: 'var(--pd-bg)',
            opacity: loading ? 0.65 : 1,
          }}
          title="Reload missions"
        >
          <RefreshCw size={10} />
          <span>{loading ? 'Loading' : 'Reload'}</span>
        </button>
      </header>

      <div className="mt-3 flex flex-wrap gap-1">
        {FILTERS.map((f) => {
          const count = counts.get(f.id) ?? 0;
          const active = filter === f.id;
          if (f.id !== 'all' && count === 0) return null;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
              style={{
                color: active ? 'var(--pd-accent)' : 'var(--pd-muted)',
                border: `1px solid ${active ? 'var(--pd-accent)' : 'var(--pd-border)'}`,
                backgroundColor: active ? 'var(--pd-accent-surface)' : 'var(--pd-bg)',
              }}
            >
              {f.label} <span style={{ opacity: 0.7 }}>{count}</span>
            </button>
          );
        })}
      </div>

      {error && (
        <div
          className="mt-3 flex items-start gap-2 rounded-md border px-3 py-2 text-xs"
          style={{
            backgroundColor: 'var(--pd-danger-surface)',
            borderColor: 'var(--pd-danger-border)',
            color: 'var(--pd-danger)',
          }}
        >
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {!error && intake && intake.missing.length > 0 && (
        <div
          className="mt-3 rounded-md border px-3 py-2 text-[11px]"
          style={{
            backgroundColor: 'var(--pd-warning-surface)',
            borderColor: 'var(--pd-warning-border)',
            color: 'var(--pd-warning)',
          }}
        >
          {intake.missing.length} source file(s) missing in this project:{' '}
          <span className="font-mono">{intake.missing.join(', ')}</span>
        </div>
      )}

      <div className="mt-3 flex flex-col gap-2">
        {!loading && visible.length === 0 && !error && (
          <div
            className="rounded-md border border-dashed px-3 py-6 text-center text-xs"
            style={{ borderColor: 'var(--pd-border)', color: 'var(--pd-dim)' }}
          >
            {intake && intake.missions.length === 0
              ? 'No mission cards parsed from this project yet. Add status tags like (UNCOMMITTED), (BLOCKED), (CLOSED) to your roadmap headings.'
              : `No missions match the ${filter} filter.`}
          </div>
        )}
        {visible.map((mission) => (
          <MissionRow key={mission.id} mission={mission} />
        ))}
      </div>
    </section>
  );
}
