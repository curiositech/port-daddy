/**
 * CockpitControlPanel — operator mission management.
 *
 * Route used: GET /cockpit/missions
 *
 * This wraps CockpitMissionsPanel in a full-bleed panel with header and
 * serves as the Cockpit tab's top-level container.  Missions are read-only
 * here (they come from the roadmap / cartographer) — the operator acts on
 * them through Dispatch (propose a dispatch for a mission) or the CLI
 * (`pd dispatch propose`).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Compass, ExternalLink, RefreshCw } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

type MissionStatus = 'now' | 'backlog' | 'parked' | 'merge' | 'done';

interface MissionCard {
  id: string;
  title: string;
  summary: string | null;
  source: string;
  status: MissionStatus;
  files: string[];
  evidence: string[];
  prUrl?: string | null;
  prNumber?: number | null;
  branch?: string | null;
  createdAt?: number;
  updatedAt?: number;
}

interface MissionIntake {
  generatedAt: number;
  projectDir: string | null;
  missions: MissionCard[];
}

// ─── API helper ───────────────────────────────────────────────────────────────

function daemonBase(): string {
  if (typeof window !== 'undefined') {
    const stored = window.localStorage?.getItem('pd.fleet-ui.daemon-url');
    if (stored) return stored;
  }
  return 'http://127.0.0.1:9876';
}

async function fetchMissions(projectDir?: string): Promise<MissionIntake> {
  const params = new URLSearchParams();
  if (projectDir) params.set('projectDir', projectDir);
  const res = await fetch(`${daemonBase()}/cockpit/missions${params.toString() ? `?${params}` : ''}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const body = await res.json() as { success: boolean; intake?: MissionIntake };
  if (!body.intake) throw new Error('no intake in response');
  return body.intake;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

type StatusTone = 'default' | 'success' | 'warning' | 'critical';

const STATUS_TONE: Record<MissionStatus, StatusTone> = {
  now: 'warning',
  backlog: 'default',
  parked: 'default',
  merge: 'success',
  done: 'success',
};

function tonePalette(tone: StatusTone): [string, string, string] {
  switch (tone) {
    case 'success': return ['var(--pd-success-surface)', 'var(--pd-success)', 'var(--pd-success-border)'];
    case 'warning': return ['var(--pd-warning-surface)', 'var(--pd-warning)', 'var(--pd-warning-border)'];
    case 'critical': return ['var(--pd-accent-surface)', 'var(--pd-accent)', 'var(--pd-accent-border)'];
    default: return ['var(--pd-bg)', 'var(--pd-muted)', 'var(--pd-border)'];
  }
}

function StatusBadge({ status }: { status: MissionStatus }) {
  const [bg, fg, border] = tonePalette(STATUS_TONE[status]);
  return (
    <span
      className="rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-wide whitespace-nowrap"
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
      style={{
        backgroundColor: 'var(--pd-bg)',
        borderColor: mission.status === 'now' ? 'var(--pd-warning-border)' : 'var(--pd-border)',
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold" style={{ color: 'var(--pd-text)' }}>{mission.title}</div>
          {mission.summary && (
            <div className="mt-1 text-sm leading-snug" style={{ color: 'var(--pd-muted)' }}>
              {mission.summary}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <StatusBadge status={mission.status} />
        </div>
      </div>

      {/* Source + files */}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm font-mono" style={{ color: 'var(--pd-dim)' }}>
        <span className="inline-flex items-center gap-1">
          <Compass size={11} />
          <span className="text-xs">{mission.source}</span>
        </span>
        {mission.prUrl && (
          <a
            href={mission.prUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs hover:underline"
            style={{ color: 'var(--pd-accent)' }}
          >
            <ExternalLink size={10} />
            {mission.prNumber ? `#${mission.prNumber}` : 'PR'}
          </a>
        )}
        {mission.branch && (
          <span className="text-xs font-mono rounded border px-1.5 py-0.5" style={{ backgroundColor: 'var(--pd-surface)', borderColor: 'var(--pd-border)', color: 'var(--pd-muted)' }}>
            {mission.branch}
          </span>
        )}
        {fileChips.map(file => (
          <span
            key={file}
            className="text-xs rounded border px-1.5 py-0.5"
            style={{ backgroundColor: 'var(--pd-surface)', borderColor: 'var(--pd-border)', color: 'var(--pd-muted)' }}
          >
            {file}
          </span>
        ))}
        {overflowFiles > 0 && (
          <span className="text-xs" style={{ color: 'var(--pd-dim)' }}>+{overflowFiles} more</span>
        )}
      </div>

      {/* Evidence */}
      {mission.evidence.length > 0 && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setOpen(v => !v)}
            className="text-xs font-semibold uppercase tracking-wide"
            style={{ color: 'var(--pd-accent)' }}
          >
            {open
              ? `Hide ${mission.evidence.length} evidence line${mission.evidence.length !== 1 ? 's' : ''}`
              : `Show ${mission.evidence.length} evidence line${mission.evidence.length !== 1 ? 's' : ''}`}
          </button>
          {open && (
            <ul className="mt-1 list-disc pl-4 text-sm leading-snug" style={{ color: 'var(--pd-muted)' }}>
              {mission.evidence.map((line, i) => (
                <li key={i} className="break-words">{line}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

type FilterId = 'all' | MissionStatus;

const FILTERS: Array<{ id: FilterId; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'now', label: 'Now' },
  { id: 'backlog', label: 'Backlog' },
  { id: 'parked', label: 'Parked' },
  { id: 'merge', label: 'Merge' },
  { id: 'done', label: 'Done' },
];

// ─── CockpitControlPanel ──────────────────────────────────────────────────────

interface Props {
  projectDir?: string;
}

export default function CockpitControlPanel({ projectDir }: Props) {
  const [intake, setIntake] = useState<MissionIntake | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterId>('all');

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchMissions(projectDir);
      setIntake(result);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [projectDir]);

  useEffect(() => { void reload(); }, [reload]);

  const filtered = useMemo(() => {
    if (!intake) return [];
    if (filter === 'all') return intake.missions;
    return intake.missions.filter(m => m.status === filter);
  }, [intake, filter]);

  const countByStatus = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const m of intake?.missions ?? []) {
      counts[m.status] = (counts[m.status] ?? 0) + 1;
    }
    return counts;
  }, [intake]);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="px-4 py-3 flex items-center justify-between gap-3 flex-shrink-0" style={{ borderBottom: '1px solid var(--pd-border)' }}>
        <div>
          <div className="text-[10px] font-semibold tracking-wider" style={{ color: 'var(--pd-dim)' }}>COCKPIT — MISSION INTAKE</div>
          <div className="text-sm font-semibold mt-0.5" style={{ color: 'var(--pd-text)' }}>
            {loading ? 'Loading…' : `${intake?.missions.length ?? 0} mission${intake?.missions.length !== 1 ? 's' : ''}`}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {intake && (
            <div className="hidden sm:flex flex-wrap gap-2">
              {(Object.entries(countByStatus) as [string, number][])
                .filter(([, c]) => c > 0)
                .map(([status, count]) => {
                  const tone = STATUS_TONE[status as MissionStatus] ?? 'default';
                  const [bg, fg, border] = tonePalette(tone);
                  return (
                    <span
                      key={status}
                      className="rounded-full px-2 py-0.5 text-xs font-semibold"
                      style={{ backgroundColor: bg, color: fg, border: `1px solid ${border}` }}
                    >
                      {count} {status}
                    </span>
                  );
                })}
            </div>
          )}
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
      </div>

      {/* Filter bar */}
      <div className="flex gap-0.5 px-4 pt-2 flex-shrink-0" style={{ borderBottom: '1px solid var(--pd-border)' }}>
        {FILTERS.map(opt => (
          <button
            key={opt.id}
            onClick={() => setFilter(opt.id)}
            className="px-3 py-1.5 text-xs font-semibold tracking-wide rounded-t whitespace-nowrap"
            style={{
              backgroundColor: filter === opt.id ? 'var(--pd-surface)' : 'transparent',
              color: filter === opt.id ? 'var(--pd-text)' : 'var(--pd-muted)',
              borderBottom: filter === opt.id ? '2px solid var(--pd-accent)' : '2px solid transparent',
            }}
          >
            {opt.label}
            {opt.id !== 'all' && countByStatus[opt.id] != null ? (
              <span
                className="ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold"
                style={{
                  backgroundColor: filter === opt.id ? 'var(--pd-accent-surface)' : 'var(--pd-bg)',
                  color: filter === opt.id ? 'var(--pd-accent)' : 'var(--pd-dim)',
                }}
              >
                {countByStatus[opt.id]}
              </span>
            ) : null}
          </button>
        ))}
      </div>

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
            <Compass size={28} style={{ color: 'var(--pd-dim)' }} />
            <div className="mt-3 text-sm font-semibold" style={{ color: 'var(--pd-muted)' }}>
              {filter === 'all' ? 'No missions yet' : `No ${filter} missions`}
            </div>
            <div className="mt-1 text-xs max-w-[260px]" style={{ color: 'var(--pd-dim)' }}>
              Missions are surfaced from the cartographer's roadmap analysis. Dispatch a goal to start one.
            </div>
          </div>
        )}
        <div className="flex flex-col gap-2">
          {filtered.map(m => (
            <MissionRow key={m.id} mission={m} />
          ))}
        </div>
      </div>
    </div>
  );
}
