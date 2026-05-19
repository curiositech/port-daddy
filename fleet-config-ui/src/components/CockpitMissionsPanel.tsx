import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Clock, Compass, FileText, RefreshCw, Undo2, X } from 'lucide-react';

import {
  clearCockpitMissionState,
  dismissCockpitMission,
  fetchCockpitMissions,
  snoozeCockpitMission,
} from '../api';
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
    // No --pd-danger* tokens defined in the theme; reuse cinnabar accent
    // family which is the closest "warning/critical" hue we ship.
    return ['var(--pd-accent-surface)', 'var(--pd-accent)', 'var(--pd-accent-border)'];
  }
  return ['var(--pd-bg)', 'var(--pd-muted)', 'var(--pd-border)'];
}

function StatusBadge({ status }: { status: MissionStatus }) {
  const [bg, fg, border] = tonePalette(STATUS_TONE[status]);
  return (
    <span
      className="rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-wide"
      style={{ backgroundColor: bg, color: fg, border: `1px solid ${border}` }}
    >
      {status}
    </span>
  );
}

interface MissionRowProps {
  mission: MissionCard;
  projectDir?: string;
  onMutated: () => void;
}

function formatSnoozeUntil(ts: number): string {
  const diffMs = ts - Date.now();
  if (diffMs <= 0) return 'expired';
  const hours = Math.round(diffMs / 3600000);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  return `${days}d`;
}

function MissionRow({ mission, projectDir, onMutated }: MissionRowProps) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<null | 'dismiss' | 'snooze' | 'restore'>(null);
  const fileChips = mission.files.slice(0, 4);
  const overflowFiles = Math.max(0, mission.files.length - fileChips.length);

  const isDismissed = !!mission.state?.dismissedAt;
  const isSnoozed = !!mission.state?.snoozedUntil && mission.state.snoozedUntil > Date.now();

  const handleDismiss = async () => {
    setPending('dismiss');
    try {
      await dismissCockpitMission({ missionId: mission.id, projectDir });
      onMutated();
    } finally {
      setPending(null);
    }
  };

  const handleSnooze = async (hours: number) => {
    setPending('snooze');
    try {
      const until = Date.now() + hours * 3600000;
      await snoozeCockpitMission({ missionId: mission.id, until, projectDir });
      onMutated();
    } finally {
      setPending(null);
    }
  };

  const handleRestore = async () => {
    setPending('restore');
    try {
      await clearCockpitMissionState({ missionId: mission.id, projectDir, field: 'all' });
      onMutated();
    } finally {
      setPending(null);
    }
  };

  return (
    <div
      className="rounded-md border px-3 py-2"
      style={{
        backgroundColor: 'var(--pd-bg)',
        borderColor: 'var(--pd-border)',
        opacity: isDismissed ? 0.55 : 1,
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold" style={{ color: 'var(--pd-text)' }}>
            {mission.title}
          </div>
          {mission.summary && (
            <div
              className="mt-1 line-clamp-2 text-sm leading-snug"
              style={{ color: 'var(--pd-muted)' }}
            >
              {mission.summary}
            </div>
          )}
          {(isDismissed || isSnoozed) && (
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs" style={{ color: 'var(--pd-dim)' }}>
              {isDismissed && (
                <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-semibold uppercase tracking-wide" style={{ borderColor: 'var(--pd-border)' }}>
                  <X size={11} /> Dismissed
                </span>
              )}
              {isSnoozed && mission.state?.snoozedUntil && (
                <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-semibold uppercase tracking-wide" style={{ borderColor: 'var(--pd-border)' }}>
                  <Clock size={11} /> Snoozed {formatSnoozeUntil(mission.state.snoozedUntil)}
                </span>
              )}
              {mission.state?.notes && <span className="italic">— {mission.state.notes}</span>}
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <StatusBadge status={mission.status} />
          <div className="flex items-center gap-1">
            {!isDismissed && !isSnoozed && (
              <>
                <button
                  type="button"
                  onClick={handleDismiss}
                  disabled={pending !== null}
                  title="Dismiss mission (persists)"
                  className="inline-flex h-7 items-center gap-1 rounded-md border px-2 text-sm font-semibold disabled:cursor-not-allowed"
                  style={{ borderColor: 'var(--pd-border)', color: 'var(--pd-muted)', backgroundColor: 'var(--pd-bg)', opacity: pending ? 0.6 : 1 }}
                >
                  <X size={12} /> Dismiss
                </button>
                <button
                  type="button"
                  onClick={() => handleSnooze(24)}
                  disabled={pending !== null}
                  title="Snooze for 24h"
                  className="inline-flex h-7 items-center gap-1 rounded-md border px-2 text-sm font-semibold disabled:cursor-not-allowed"
                  style={{ borderColor: 'var(--pd-border)', color: 'var(--pd-muted)', backgroundColor: 'var(--pd-bg)', opacity: pending ? 0.6 : 1 }}
                >
                  <Clock size={12} /> 24h
                </button>
              </>
            )}
            {(isDismissed || isSnoozed) && (
              <button
                type="button"
                onClick={handleRestore}
                disabled={pending !== null}
                title="Restore (clear all persisted state for this mission)"
                className="inline-flex h-7 items-center gap-1 rounded-md border px-2 text-sm font-semibold disabled:cursor-not-allowed"
                style={{ borderColor: 'var(--pd-border)', color: 'var(--pd-accent)', backgroundColor: 'var(--pd-bg)', opacity: pending ? 0.6 : 1 }}
              >
                <Undo2 size={12} /> Restore
              </button>
            )}
          </div>
        </div>
      </div>
      <div
        className="mt-2 flex flex-wrap items-center gap-2 text-sm font-mono"
        style={{ color: 'var(--pd-dim)' }}
      >
        <span className="inline-flex items-center gap-1">
          <FileText size={12} />
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
            className="text-xs font-semibold uppercase tracking-wide"
            style={{ color: 'var(--pd-accent)' }}
          >
            {open
              ? `Hide ${mission.evidence.length} evidence line${mission.evidence.length === 1 ? '' : 's'}`
              : `Show ${mission.evidence.length} evidence line${mission.evidence.length === 1 ? '' : 's'}`}
          </button>
          {open && (
            <ul
              className="mt-1 list-disc pl-4 text-sm leading-snug"
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
  const [showHidden, setShowHidden] = useState(false);

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

  const isHidden = (m: MissionCard): boolean => {
    if (m.state?.dismissedAt) return true;
    if (m.state?.snoozedUntil && m.state.snoozedUntil > Date.now()) return true;
    return false;
  };

  const visible = useMemo(() => {
    if (!intake) return [];
    const byStatus = filter === 'all' ? intake.missions : intake.missions.filter((m) => m.status === filter);
    return showHidden ? byStatus : byStatus.filter((m) => !isHidden(m));
  }, [intake, filter, showHidden]);

  const hiddenCount = useMemo(() => {
    if (!intake) return 0;
    return intake.missions.filter(isHidden).length;
  }, [intake]);

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
            <div className="text-sm" style={{ color: 'var(--pd-dim)' }}>
              Cockpit work queue from CURRENT-WORK.md, UNIFIED-ROADMAP.md, and
              .cartographer/status.md
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void reload()}
          disabled={loading}
          className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-sm font-semibold disabled:cursor-not-allowed"
          style={{
            color: 'var(--pd-text)',
            border: '1px solid var(--pd-border)',
            backgroundColor: 'var(--pd-bg)',
            opacity: loading ? 0.65 : 1,
          }}
          title="Reload missions"
        >
          <RefreshCw size={14} />
          <span>{loading ? 'Loading' : 'Reload'}</span>
        </button>
      </header>

      <div className="mt-3 flex flex-wrap items-center gap-1">
        {FILTERS.map((f) => {
          const count = counts.get(f.id) ?? 0;
          const active = filter === f.id;
          if (f.id !== 'all' && count === 0) return null;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className="rounded-full px-2 py-0.5 text-sm font-semibold"
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
        {hiddenCount > 0 && (
          <button
            type="button"
            onClick={() => setShowHidden((v) => !v)}
            className="ml-2 rounded-full px-2 py-0.5 text-sm font-semibold"
            style={{
              color: showHidden ? 'var(--pd-accent)' : 'var(--pd-muted)',
              border: `1px solid ${showHidden ? 'var(--pd-accent)' : 'var(--pd-border)'}`,
              backgroundColor: showHidden ? 'var(--pd-accent-surface)' : 'var(--pd-bg)',
            }}
            title="Toggle visibility of dismissed and snoozed missions"
          >
            {showHidden ? 'Hide hidden' : 'Show hidden'}{' '}
            <span style={{ opacity: 0.7 }}>{hiddenCount}</span>
          </button>
        )}
      </div>

      {error && (
        <div
          className="mt-3 flex items-start gap-2 rounded-md border px-3 py-2 text-sm"
          style={{
            // No --pd-danger* tokens defined in the theme; reuse the
            // cinnabar accent family which is the closest "critical" hue
            // we ship. Mirrors the StatusBadge palette decision.
            backgroundColor: 'var(--pd-accent-surface)',
            borderColor: 'var(--pd-accent-border)',
            color: 'var(--pd-accent)',
          }}
        >
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {!error && intake && intake.missing.length > 0 && (
        <div
          className="mt-3 rounded-md border px-3 py-2 text-sm"
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

      {!error && intake && intake.sourcesWithNoCards && intake.sourcesWithNoCards.length > 0 && (
        <div
          className="mt-3 rounded-md border px-3 py-2 text-sm"
          style={{
            backgroundColor: 'var(--pd-bg)',
            borderColor: 'var(--pd-border)',
            color: 'var(--pd-muted)',
          }}
        >
          {intake.sourcesWithNoCards.length} source file(s) present but parsed
          zero mission cards (likely missing status tags like (UNCOMMITTED),
          (BLOCKED), (CLOSED)):{' '}
          <span className="font-mono">{intake.sourcesWithNoCards.join(', ')}</span>
        </div>
      )}

      <div className="mt-3 flex flex-col gap-2">
        {!loading && visible.length === 0 && !error && (
          <div
            className="rounded-md border border-dashed px-3 py-6 text-center text-sm"
            style={{ borderColor: 'var(--pd-border)', color: 'var(--pd-dim)' }}
          >
            {intake && intake.missions.length === 0
              ? 'No mission cards parsed from this project yet. Add status tags like (UNCOMMITTED), (BLOCKED), (CLOSED) to your roadmap headings.'
              : `No missions match the ${filter} filter.`}
          </div>
        )}
        {visible.map((mission) => (
          <MissionRow
            key={mission.id}
            mission={mission}
            projectDir={projectDir}
            onMutated={() => void reload()}
          />
        ))}
      </div>
    </section>
  );
}
