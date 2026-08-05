/* eslint-disable react-refresh/only-export-components --
 * The selection/projection helpers (pointsInRect, clientToViewBox, …) are pure
 * functions unit-tested from SessionGalaxyPanel.test.tsx and shared with the
 * component; exporting them here only costs a full reload on dev fast-refresh. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { Check, Copy, ExternalLink, Layers, MessagesSquare, RefreshCw, X } from 'lucide-react';
import { callGalaxyParley, fetchGalaxyMap, fetchGalaxySessionDetail } from '../api';
import type {
  GalaxyCluster,
  GalaxyMapResponse,
  GalaxyPoint,
  GalaxySessionDetail,
} from '../types';

// ─── Map geometry (viewBox space) ────────────────────────────────────────────

export const VIEW_W = 1000;
export const VIEW_H = 700;
const PAD_X = 40;
const PAD_Y = 40;
const PLOT_W = VIEW_W - PAD_X * 2; // 920
const PLOT_H = VIEW_H - PAD_Y * 2; // 620

// Shared clusterId % 8 → color contract (see session-galaxy design decisions).
// Order matters: pd-console maps the SAME indices into its own theme tokens.
export const CLUSTER_COLORS: string[] = [
  'var(--pd-accent)',
  'var(--pd-success)',
  'var(--pd-warning)',
  'oklch(0.72 0.12 230)',
  'oklch(0.7 0.13 300)',
  'oklch(0.68 0.12 170)',
  'oklch(0.7 0.11 60)',
  'oklch(0.65 0.1 350)',
];

// When clustering is toggled off every point renders in one neutral color —
// there is no cluster identity to encode, so the palette collapses to a
// single shared token rather than an arbitrary member of CLUSTER_COLORS.
export const UNCLUSTERED_POINT_COLOR = 'var(--pd-line)';

export function clusterColor(clusterId: number): string {
  const idx = Number.isFinite(clusterId) ? Math.abs(Math.trunc(clusterId)) % CLUSTER_COLORS.length : 0;
  return CLUSTER_COLORS[idx];
}

/** Point fill color honoring the clustering toggle: neutral when disabled. */
export function pointColor(clusteringEnabled: boolean, clusterId: number): string {
  return clusteringEnabled ? clusterColor(clusterId) : UNCLUSTERED_POINT_COLOR;
}

/** Project a normalized [0,1] galaxy point into viewBox coordinates. */
export function pointToViewBox(p: Pick<GalaxyPoint, 'x' | 'y'>): { cx: number; cy: number } {
  return { cx: PAD_X + p.x * PLOT_W, cy: PAD_Y + p.y * PLOT_H };
}

export interface ViewBoxRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Convert a client (mouse) coordinate into viewBox space, honoring
 * preserveAspectRatio="xMidYMid meet" letterboxing.
 */
export function clientToViewBox(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
): { x: number; y: number } {
  if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };
  const scale = Math.min(rect.width / VIEW_W, rect.height / VIEW_H);
  if (scale <= 0) return { x: 0, y: 0 };
  const offsetX = (rect.width - VIEW_W * scale) / 2;
  const offsetY = (rect.height - VIEW_H * scale) / 2;
  return {
    x: (clientX - rect.left - offsetX) / scale,
    y: (clientY - rect.top - offsetY) / scale,
  };
}

/** Ids of every point whose projected position falls inside the rubber-band rect (viewBox space). */
export function pointsInRect(points: GalaxyPoint[], rect: ViewBoxRect): string[] {
  const minX = Math.min(rect.x0, rect.x1);
  const maxX = Math.max(rect.x0, rect.x1);
  const minY = Math.min(rect.y0, rect.y1);
  const maxY = Math.max(rect.y0, rect.y1);
  return points
    .filter((p) => {
      const { cx, cy } = pointToViewBox(p);
      return cx >= minX && cx <= maxX && cy >= minY && cy <= maxY;
    })
    .map((p) => p.id);
}

/** Deduped agent ids (fleet_transcripts.spawned_agent_id) — the parley party list. */
export function distinctAgentIds(points: GalaxyPoint[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of points) {
    const id = p.agentId?.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** The cluster most represented among the selected points (ties → lower id). */
export function modalCluster(points: GalaxyPoint[], clusters: GalaxyCluster[]): GalaxyCluster | null {
  if (points.length === 0) return null;
  const counts = new Map<number, number>();
  for (const p of points) counts.set(p.clusterId, (counts.get(p.clusterId) ?? 0) + 1);
  let bestId: number | null = null;
  let bestCount = -1;
  for (const [id, count] of counts) {
    if (count > bestCount || (count === bestCount && bestId !== null && id < bestId)) {
      bestId = id;
      bestCount = count;
    }
  }
  return clusters.find((c) => c.id === bestId) ?? null;
}

/**
 * Top terms of the selection's modal cluster, kebab-joined, <= 64 chars.
 * Feeds the parley surface string: `galaxy:<slug>`.
 */
export function selectionTermsSlug(points: GalaxyPoint[], clusters: GalaxyCluster[]): string {
  const cluster = modalCluster(points, clusters);
  const terms = (cluster?.terms ?? []).slice(0, 3).map((t) => t.term);
  const slug = terms
    .join('-')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 64)
    .replace(/^-+|-+$/g, '');
  return slug || 'selection';
}

export function defaultParleyReason(clusterLabel: string, sessionCount: number): string {
  return `Operator convened parley from session galaxy cluster "${clusterLabel}" (${sessionCount} sessions)`;
}

// ─── Time / duration formatting ───────────────────────────────────────────────

/**
 * HH:MM:SS (zero-padded, 24h, local time) from an epoch-ms value. Deliberately
 * not locale-formatted (unlike the summary-line `formatTime` below) so
 * transcript rows line up in a fixed-width column and so tests are
 * deterministic regardless of the runner's locale.
 */
export function formatClockTime(epochMs: number | null | undefined): string {
  if (typeof epochMs !== 'number' || !Number.isFinite(epochMs)) return '—';
  const d = new Date(epochMs);
  if (Number.isNaN(d.getTime())) return '—';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

/** "1h 5m 3s" style duration between two epoch-ms bounds; null when either bound is missing/invalid/negative. */
export function formatDuration(startedAt: number | null | undefined, endedAt: number | null | undefined): string | null {
  if (typeof startedAt !== 'number' || !Number.isFinite(startedAt)) return null;
  if (typeof endedAt !== 'number' || !Number.isFinite(endedAt)) return null;
  const deltaMs = endedAt - startedAt;
  if (deltaMs < 0) return null;
  const totalSeconds = Math.round(deltaMs / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(`${h}h`);
  if (h > 0 || m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
}

/**
 * Session bounds, preferring the daemon's guaranteed top-level startedAt/endedAt
 * and falling back to the legacy transcript.started_at/ended_at snake_case
 * fields for daemons that haven't shipped the top-level fields yet.
 */
export function resolveSessionTimes(
  detail: GalaxySessionDetail | null | undefined,
): { startedAt: number | null; endedAt: number | null } {
  if (!detail) return { startedAt: null, endedAt: null };
  const startedAt = typeof detail.startedAt === 'number'
    ? detail.startedAt
    : typeof detail.transcript?.started_at === 'number'
      ? detail.transcript.started_at
      : null;
  const endedAt = typeof detail.endedAt === 'number'
    ? detail.endedAt
    : typeof detail.transcript?.ended_at === 'number'
      ? detail.transcript.ended_at
      : null;
  return { startedAt, endedAt };
}

// ─── Files-touched hyperlinks ─────────────────────────────────────────────────

/** vscode://file/ deep link when an absolute path is known; null otherwise (caller falls back to copy-only). */
export function resolveFileLinkHref(file: { absolutePath?: string | null }): string | null {
  const abs = file.absolutePath;
  if (typeof abs !== 'string' || abs.trim() === '') return null;
  return `vscode://file/${abs}`;
}

/** Best-effort clipboard write; resolves false (never throws) so callers can skip the "copied" affordance. */
export async function copyFilePathToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* clipboard not available / permission denied */
  }
  return false;
}

// ─── Controls ─────────────────────────────────────────────────────────────────

const WINDOW_OPTIONS: Array<{ label: string; hours: number }> = [
  { label: '1h', hours: 1 },
  { label: '6h', hours: 6 },
  { label: '24h', hours: 24 },
  { label: '7d', hours: 168 },
];

const CUSTOM_WINDOW_DEBOUNCE_MS = 400;
const FILE_COPIED_AFFORDANCE_MS = 1500;

/** Positive whole number of hours from free-form input, or null when invalid (blank, decimal, zero, negative, non-numeric). */
export function parseWindowHours(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

const POLL_MS = 15_000; // daemon caches the whole map response 30s, so this is cheap

interface SessionGalaxyPanelProps {
  project: string | null;
  theme?: string;
}

interface DetailState {
  id: string;
  loading: boolean;
  error: string | null;
  detail: GalaxySessionDetail | null;
}

interface HoverState {
  point: GalaxyPoint;
  left: number;
  top: number;
}

interface DragState extends ViewBoxRect {
  additive: boolean;
}

function formatTime(epochMs: number | null | undefined): string {
  if (!epochMs || !Number.isFinite(epochMs)) return '—';
  try {
    return new Date(epochMs).toLocaleTimeString();
  } catch {
    return '—';
  }
}

function statusColor(status: GalaxyPoint['status']): string {
  switch (status) {
    case 'running': return 'var(--pd-success)';
    case 'failed': return 'var(--pd-accent)';
    case 'cancelled': return 'var(--pd-warning)';
    default: return 'var(--pd-muted)';
  }
}

export default function SessionGalaxyPanel({ project }: SessionGalaxyPanelProps) {
  const [map, setMap] = useState<GalaxyMapResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [windowHours, setWindowHours] = useState(24);
  const [customWindowInput, setCustomWindowInput] = useState('');
  const [customWindowError, setCustomWindowError] = useState<string | null>(null);
  const [minTokens, setMinTokens] = useState(256);
  const [clusteringEnabled, setClusteringEnabled] = useState(true);
  const [selection, setSelection] = useState<Set<string>>(() => new Set());
  const [hover, setHover] = useState<HoverState | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [detail, setDetail] = useState<DetailState | null>(null);
  const [copiedFileIdx, setCopiedFileIdx] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [parleyBusy, setParleyBusy] = useState(false);
  const [parleyNotice, setParleyNotice] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const copiedFileTimeoutRef = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await fetchGalaxyMap({
        windowHours,
        minTokens,
        ...(project ? { project } : {}),
        ...(clusteringEnabled ? {} : { cluster: false }),
      });
      setMap(data);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [project, windowHours, minTokens, clusteringEnabled]);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(interval);
  }, [refresh]);

  // Free-form "any lookback" hours input: debounced so every keystroke doesn't
  // refetch, validated so a malformed value never reaches the daemon query.
  useEffect(() => {
    if (customWindowInput.trim() === '') {
      setCustomWindowError(null);
      return;
    }
    const handle = window.setTimeout(() => {
      const parsed = parseWindowHours(customWindowInput);
      if (parsed === null) {
        setCustomWindowError('Enter a positive whole number of hours');
      } else {
        setCustomWindowError(null);
        setWindowHours(parsed);
      }
    }, CUSTOM_WINDOW_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [customWindowInput]);

  useEffect(() => () => {
    if (copiedFileTimeoutRef.current) window.clearTimeout(copiedFileTimeoutRef.current);
  }, []);

  const points = useMemo(() => map?.points ?? [], [map]);
  const clusters = useMemo(() => map?.clusters ?? [], [map]);
  const selectedPoints = useMemo(() => points.filter((p) => selection.has(p.id)), [points, selection]);
  const parleyParties = useMemo(() => distinctAgentIds(selectedPoints), [selectedPoints]);
  const selectionCluster = useMemo(() => modalCluster(selectedPoints, clusters), [selectedPoints, clusters]);
  const canParley = parleyParties.length >= 2;

  const hoverClusterLabel = useMemo(() => {
    if (!hover || !clusteringEnabled) return null;
    return clusters.find((c) => c.id === hover.point.clusterId) ?? null;
  }, [hover, clusters, clusteringEnabled]);

  // Not memoized: resolveSessionTimes/formatDuration are a handful of property
  // reads and one subtraction, far below the cost of a useMemo cache lookup —
  // memoizing here would be reflexive, not measured.
  const detailTimes = resolveSessionTimes(detail?.detail);
  const detailDuration = formatDuration(detailTimes.startedAt, detailTimes.endedAt);

  const openDetail = useCallback(async (id: string) => {
    setDetail({ id, loading: true, error: null, detail: null });
    try {
      const res = await fetchGalaxySessionDetail(id);
      setDetail({ id, loading: false, error: null, detail: res.detail ?? null });
    } catch (err) {
      setDetail({ id, loading: false, error: (err as Error).message, detail: null });
    }
  }, []);

  const handlePointClick = useCallback((e: ReactMouseEvent, p: GalaxyPoint) => {
    e.stopPropagation();
    if (e.metaKey || e.ctrlKey) {
      setSelection((prev) => {
        const next = new Set(prev);
        if (next.has(p.id)) next.delete(p.id);
        else next.add(p.id);
        return next;
      });
      return;
    }
    void openDetail(p.id);
  }, [openDetail]);

  const armDrag = useCallback((e: ReactMouseEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const svg = svgRef.current;
    if (!svg) return;
    const { x, y } = clientToViewBox(e.clientX, e.clientY, svg.getBoundingClientRect());
    setDrag({ x0: x, y0: y, x1: x, y1: y, additive: e.shiftKey });
  }, []);

  const moveDrag = useCallback((e: ReactMouseEvent<SVGSVGElement>) => {
    setDrag((prev) => {
      if (!prev) return prev;
      const svg = svgRef.current;
      if (!svg) return prev;
      const { x, y } = clientToViewBox(e.clientX, e.clientY, svg.getBoundingClientRect());
      return { ...prev, x1: x, y1: y };
    });
  }, []);

  const finishDrag = useCallback(() => {
    if (!drag) return;
    const w = Math.abs(drag.x1 - drag.x0);
    const h = Math.abs(drag.y1 - drag.y0);
    if (w >= 3 || h >= 3) {
      const inside = pointsInRect(points, drag);
      setSelection((old) => {
        const next = drag.additive ? new Set(old) : new Set<string>();
        for (const id of inside) next.add(id);
        return next;
      });
    }
    setDrag(null);
  }, [drag, points]);

  const handleParley = useCallback(async () => {
    if (!canParley || parleyBusy) return;
    const label = selectionCluster?.label ?? 'unlabeled';
    const fallbackReason = defaultParleyReason(label, selectedPoints.length);
    setParleyBusy(true);
    setParleyNotice(null);
    try {
      const res = await callGalaxyParley({
        surface: `galaxy:${selectionTermsSlug(selectedPoints, clusters)}`,
        reason: reason.trim() || fallbackReason,
        calledBy: 'operator',
        parties: parleyParties,
        trigger: 'operator',
      });
      if (res.success) {
        const parleyId = (res.parley as { parleyId?: string } | undefined)?.parleyId;
        setParleyNotice({ kind: 'success', message: `Parley ${parleyId ?? ''} convened`.replace(/\s+/g, ' ').trim() });
        setReason('');
      } else {
        setParleyNotice({ kind: 'error', message: res.error ?? 'Parley call failed' });
      }
    } catch (err) {
      // The api helper surfaces the daemon 400 body verbatim in the Error message.
      setParleyNotice({ kind: 'error', message: (err as Error).message });
    } finally {
      setParleyBusy(false);
    }
  }, [canParley, parleyBusy, selectionCluster, selectedPoints, clusters, reason, parleyParties]);

  const handleFileCopy = useCallback((idx: number, filePath: string) => {
    void copyFilePathToClipboard(filePath).then((ok) => {
      if (!ok) return;
      setCopiedFileIdx(idx);
      if (copiedFileTimeoutRef.current) window.clearTimeout(copiedFileTimeoutRef.current);
      copiedFileTimeoutRef.current = window.setTimeout(() => setCopiedFileIdx(null), FILE_COPIED_AFFORDANCE_MS);
    });
  }, []);

  const clusterLabelText = selectionCluster?.label ?? 'unlabeled';
  const reasonPlaceholder = defaultParleyReason(clusterLabelText, selectedPoints.length);

  return (
    <div className="h-full flex flex-col overflow-hidden gap-3 p-4">
      {/* Controls row */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="pd-kicker">Session galaxy</div>
        <select
          className="pd-select"
          style={{ width: 'auto' }}
          aria-label="Time window"
          value={windowHours}
          onChange={(e) => {
            setWindowHours(Number(e.target.value));
            setCustomWindowInput('');
            setCustomWindowError(null);
          }}
        >
          {WINDOW_OPTIONS.map((opt) => (
            <option key={opt.hours} value={opt.hours}>{opt.label}</option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--pd-muted)' }}>
          custom hours
          <input
            className="pd-input"
            style={{ width: '5.5rem' }}
            type="text"
            inputMode="numeric"
            placeholder="e.g. 48"
            aria-label="Custom time window in hours"
            value={customWindowInput}
            onChange={(e) => setCustomWindowInput(e.target.value)}
          />
        </label>
        {customWindowError && (
          <span role="alert" className="text-[13px]" style={{ color: 'var(--pd-accent)' }}>
            {customWindowError}
          </span>
        )}
        <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--pd-muted)' }}>
          min tokens
          <input
            className="pd-input"
            style={{ width: '6.5rem' }}
            type="number"
            min={0}
            step={64}
            aria-label="Minimum tail tokens"
            value={minTokens}
            onChange={(e) => {
              const value = Number(e.target.value);
              setMinTokens(Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 0);
            }}
          />
        </label>
        <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--pd-muted)' }}>
          <input
            type="checkbox"
            className="pd-checkbox"
            aria-label="Enable clustering"
            checked={clusteringEnabled}
            onChange={(e) => setClusteringEnabled(e.target.checked)}
          />
          <Layers size={14} />
          Cluster
        </label>
        <button className="pd-button pd-button-secondary" onClick={() => void refresh()}>
          <RefreshCw size={15} />
          Refresh
        </button>
        <div className="ml-auto text-sm" style={{ color: 'var(--pd-muted)' }}>
          {map
            ? `Computed ${formatTime(map.computedAt)} · ${map.stats?.sessionCount ?? points.length} sessions${clusteringEnabled ? ` · ${clusters.length} clusters` : ''}`
            : loading
              ? 'Loading galaxy…'
              : 'No map yet'}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border px-4 py-3 text-sm" style={{ backgroundColor: 'var(--pd-accent-surface)', borderColor: 'var(--pd-accent-border)', color: 'var(--pd-accent)' }}>
          Could not load /galaxy/map: {error}
        </div>
      )}

      {parleyNotice && (
        <div
          className="rounded-lg border px-4 py-3 text-sm flex items-center justify-between gap-3"
          style={parleyNotice.kind === 'success'
            ? { backgroundColor: 'var(--pd-success-surface)', borderColor: 'var(--pd-success-border)', color: 'var(--pd-success)' }
            : { backgroundColor: 'var(--pd-accent-surface)', borderColor: 'var(--pd-accent-border)', color: 'var(--pd-accent)' }}
        >
          <span>{parleyNotice.message}</span>
          <button
            className="shrink-0"
            aria-label="Dismiss notice"
            onClick={() => setParleyNotice(null)}
            style={{ color: 'inherit' }}
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Map + detail drawer */}
      <div className="flex-1 min-h-0 flex gap-3 overflow-hidden">
        <div ref={wrapRef} className="relative flex-1 min-w-0 pd-card overflow-hidden">
          {!loading && points.length === 0 && !error ? (
            <div className="absolute inset-0 flex items-center justify-center text-sm" style={{ color: 'var(--pd-muted)' }}>
              No sessions with enough transcript in this window. Widen the time window or lower the token floor.
            </div>
          ) : null}
          <svg
            ref={svgRef}
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
            preserveAspectRatio="xMidYMid meet"
            className="w-full h-full"
            style={{ background: 'var(--pd-surface)', cursor: drag ? 'crosshair' : 'default' }}
            data-testid="galaxy-map"
            onMouseDown={armDrag}
            onMouseMove={moveDrag}
            onMouseUp={finishDrag}
            onMouseLeave={() => { setDrag(null); setHover(null); }}
          >
            {clusteringEnabled && clusters.map((cluster) => {
              const { cx, cy } = pointToViewBox({ x: cluster.centroid?.[0] ?? 0.5, y: cluster.centroid?.[1] ?? 0.5 });
              return (
                <text
                  key={`cluster-${cluster.id}`}
                  x={cx}
                  y={cy}
                  textAnchor="middle"
                  fontSize={14}
                  fontWeight={600}
                  fill="var(--pd-muted)"
                  style={{ pointerEvents: 'none', userSelect: 'none' }}
                >
                  {cluster.label}
                </text>
              );
            })}
            {points.map((p) => {
              const { cx, cy } = pointToViewBox(p);
              const isSelected = selection.has(p.id);
              const color = pointColor(clusteringEnabled, p.clusterId);
              return (
                <g key={p.id}>
                  {p.status === 'running' && (
                    <circle cx={cx} cy={cy} r={isSelected ? 12 : 10} fill="none" stroke={color} strokeWidth={1.5} strokeOpacity={0.45} style={{ pointerEvents: 'none' }} />
                  )}
                  <circle
                    cx={cx}
                    cy={cy}
                    r={isSelected ? 8 : 6}
                    fill={color}
                    stroke={isSelected ? 'var(--pd-text)' : 'none'}
                    strokeWidth={isSelected ? 2 : 0}
                    style={{ cursor: 'pointer' }}
                    data-galaxy-point={p.id}
                    data-testid={`galaxy-point-${p.id}`}
                    role="button"
                    aria-label={`Session ${p.purpose ?? p.ship ?? p.agentId}`}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => handlePointClick(e, p)}
                    onMouseEnter={(e) => {
                      const wrap = wrapRef.current;
                      if (!wrap) return;
                      const rect = wrap.getBoundingClientRect();
                      setHover({ point: p, left: e.clientX - rect.left, top: e.clientY - rect.top });
                    }}
                    onMouseLeave={() => setHover(null)}
                  />
                </g>
              );
            })}
            {drag && (Math.abs(drag.x1 - drag.x0) >= 3 || Math.abs(drag.y1 - drag.y0) >= 3) && (
              <rect
                x={Math.min(drag.x0, drag.x1)}
                y={Math.min(drag.y0, drag.y1)}
                width={Math.abs(drag.x1 - drag.x0)}
                height={Math.abs(drag.y1 - drag.y0)}
                fill="var(--pd-accent)"
                fillOpacity={0.12}
                stroke="var(--pd-accent)"
                strokeWidth={1}
                strokeDasharray="6 4"
                style={{ pointerEvents: 'none' }}
              />
            )}
          </svg>

          {hover && (
            <div
              className="absolute z-20 pd-card px-3 py-2.5 max-w-xs"
              style={{
                left: Math.max(8, hover.left),
                top: Math.max(8, hover.top - 12),
                transform: 'translate(-50%, -100%)',
                pointerEvents: 'none',
                boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
              }}
              data-testid="galaxy-tooltip"
            >
              <div className="text-sm font-semibold" style={{ color: 'var(--pd-text)' }}>
                {hover.point.purpose ?? hover.point.ship ?? hover.point.agentId}
              </div>
              <div className="mt-1 text-[13px]" style={{ color: 'var(--pd-muted)' }}>
                {hover.point.agentId}
              </div>
              <div className="mt-1 flex items-center gap-2 text-[13px]" style={{ color: 'var(--pd-muted)' }}>
                <span style={{ color: statusColor(hover.point.status) }}>{hover.point.status}</span>
                <span>· {hover.point.tailTokens} tokens</span>
                <span>· last active {formatTime(hover.point.endedAt ?? hover.point.startedAt)}</span>
              </div>
              {hoverClusterLabel && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {(hoverClusterLabel.terms ?? []).slice(0, 5).map((term) => (
                    <span
                      key={term.term}
                      className="rounded-full px-2 py-0.5 text-[13px] font-semibold"
                      style={{ backgroundColor: 'var(--pd-bg)', color: clusterColor(hover.point.clusterId), border: '1px solid var(--pd-border)' }}
                    >
                      {term.term}
                    </span>
                  ))}
                </div>
              )}
              {hover.point.snippet && (
                <div className="mt-2 text-[13px] leading-snug" style={{ color: 'var(--pd-muted)', fontFamily: 'var(--pd-font-mono)' }}>
                  {hover.point.snippet}
                </div>
              )}
            </div>
          )}
        </div>

        {detail && (
          <div className="w-[400px] shrink-0 pd-card overflow-y-auto p-4" data-testid="galaxy-detail-drawer">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="pd-kicker">Session detail</div>
                <div className="mt-1 text-sm font-semibold break-words" style={{ color: 'var(--pd-text)' }}>
                  {detail.detail?.session?.purpose
                    ?? points.find((p) => p.id === detail.id)?.purpose
                    ?? detail.detail?.transcript?.ship
                    ?? detail.id}
                </div>
                <div className="mt-1 text-[13px]" style={{ color: 'var(--pd-muted)' }}>
                  {detail.detail?.transcript?.spawned_agent_id ?? points.find((p) => p.id === detail.id)?.agentId ?? ''}
                  {detail.detail?.transcript?.status ? ` · ${detail.detail.transcript.status}` : ''}
                </div>
                {detail.detail && (detailTimes.startedAt != null || detailTimes.endedAt != null) && (
                  <div className="mt-1 text-[13px]" style={{ color: 'var(--pd-muted)' }} data-testid="galaxy-detail-times">
                    Started {formatClockTime(detailTimes.startedAt)} · Ended {detailTimes.endedAt != null ? formatClockTime(detailTimes.endedAt) : 'ongoing'}
                    {detailDuration ? ` · ${detailDuration}` : ''}
                  </div>
                )}
              </div>
              <button className="pd-button pd-button-secondary" aria-label="Close detail" onClick={() => setDetail(null)}>
                <X size={15} />
              </button>
            </div>

            {detail.loading && (
              <div className="mt-4 text-sm" style={{ color: 'var(--pd-muted)' }}>Loading session detail…</div>
            )}
            {detail.error && (
              <div className="mt-4 rounded-lg border px-3 py-2.5 text-sm" style={{ backgroundColor: 'var(--pd-accent-surface)', borderColor: 'var(--pd-accent-border)', color: 'var(--pd-accent)' }}>
                {detail.error}
              </div>
            )}

            {detail.detail && (
              <div className="mt-4 flex flex-col gap-5">
                {/* Linked artifacts — best-effort provenance; absence does not mean no PRs. */}
                <section>
                  <div className="pd-kicker">Linked artifacts</div>
                  {(detail.detail.prs ?? []).length > 0 ? (
                    <ul className="mt-2 flex flex-col gap-1.5">
                      {(detail.detail.prs ?? []).map((pr, idx) => (
                        <li key={idx} className="text-sm flex items-center gap-2" style={{ color: 'var(--pd-text)' }}>
                          {pr.url ? (
                            <a
                              href={pr.url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1.5 underline"
                              style={{ color: 'var(--pd-accent)' }}
                            >
                              <ExternalLink size={14} />
                              {pr.prNumber != null ? `PR #${pr.prNumber}` : pr.type}
                            </a>
                          ) : (
                            <span>{pr.prNumber != null ? `PR #${pr.prNumber}` : pr.type}</span>
                          )}
                          <span className="truncate" style={{ color: 'var(--pd-muted)' }}>{pr.summary}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="mt-2 text-sm" style={{ color: 'var(--pd-muted)' }}>
                      None recorded (provenance is best-effort — the agent may still have produced PRs).
                    </div>
                  )}
                </section>

                <section>
                  <div className="pd-kicker">Files touched</div>
                  {(detail.detail.files ?? []).length > 0 ? (
                    <ul className="mt-2 flex flex-col gap-1.5">
                      {(detail.detail.files ?? []).map((file, idx) => {
                        const href = resolveFileLinkHref(file);
                        const label = `${file.filePath}${file.startLine != null ? `:${file.startLine}${file.endLine != null ? `-${file.endLine}` : ''}` : ''}`;
                        const isCopied = copiedFileIdx === idx;
                        const linkStyle = {
                          color: 'var(--pd-text)',
                          fontFamily: 'var(--pd-font-mono)',
                          cursor: 'pointer',
                          background: 'none',
                          border: 'none',
                          padding: 0,
                          textAlign: 'left' as const,
                        };
                        return (
                          <li key={idx} className="text-sm break-all flex items-center gap-2 flex-wrap">
                            {href ? (
                              <a
                                href={href}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1.5 hover:underline"
                                style={linkStyle}
                                onClick={() => handleFileCopy(idx, file.filePath)}
                              >
                                <ExternalLink size={12} />
                                {label}
                              </a>
                            ) : (
                              <button
                                type="button"
                                className="inline-flex items-center gap-1.5 hover:underline"
                                style={linkStyle}
                                onClick={() => handleFileCopy(idx, file.filePath)}
                                title="Copy path to clipboard"
                              >
                                <Copy size={12} />
                                {label}
                              </button>
                            )}
                            {isCopied && (
                              <span
                                role="status"
                                className="inline-flex items-center gap-1 text-[13px] font-semibold"
                                style={{ color: 'var(--pd-success)' }}
                              >
                                <Check size={12} />
                                Copied
                              </span>
                            )}
                            {file.symbol ? <span style={{ color: 'var(--pd-muted)' }}>· {file.symbol}</span> : null}
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <div className="mt-2 text-sm" style={{ color: 'var(--pd-muted)' }}>No file claims recorded.</div>
                  )}
                </section>

                <section>
                  <div className="pd-kicker">Tool uses</div>
                  {(detail.detail.toolUses ?? []).length > 0 ? (
                    <ul className="mt-2 flex flex-col gap-1.5">
                      {(detail.detail.toolUses ?? []).map((tool, idx) => (
                        <li key={idx} className="text-sm flex items-center justify-between gap-3" style={{ color: 'var(--pd-text)' }}>
                          <span style={{ fontFamily: 'var(--pd-font-mono)' }}>{tool.name}</span>
                          <span className="shrink-0 text-[13px]" style={{ color: 'var(--pd-muted)' }}>{formatTime(tool.at)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="mt-2 text-sm" style={{ color: 'var(--pd-muted)' }}>No tool calls recorded.</div>
                  )}
                </section>

                {(detail.detail.notes ?? []).length > 0 && (
                  <section>
                    <div className="pd-kicker">Notes</div>
                    <ul className="mt-2 flex flex-col gap-2">
                      {(detail.detail.notes ?? []).map((note) => (
                        <li key={note.id} className="text-sm rounded-lg border px-3 py-2" style={{ color: 'var(--pd-text)', borderColor: 'var(--pd-border)', backgroundColor: 'var(--pd-bg)' }}>
                          <div className="text-[13px] mb-1" style={{ color: 'var(--pd-muted)' }}>{note.type} · {formatTime(note.createdAt)}</div>
                          <div className="whitespace-pre-wrap break-words">{note.content}</div>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                <section>
                  <div className="pd-kicker">Transcript</div>
                  {(detail.detail.transcript?.messages ?? []).length > 0 ? (
                    <div className="mt-2 flex flex-col gap-2.5">
                      {(detail.detail.transcript?.messages ?? []).map((msg, idx) => (
                        <div key={idx} className="rounded-lg border px-3 py-2" style={{ borderColor: 'var(--pd-border)', backgroundColor: 'var(--pd-bg)' }}>
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-[13px] font-semibold uppercase tracking-wide" style={{ color: 'var(--pd-muted)' }}>{msg.role}</span>
                            <span className="text-[13px]" style={{ color: 'var(--pd-dim)' }}>{formatClockTime(msg.timestamp)}</span>
                          </div>
                          <pre className="mt-1.5 text-sm whitespace-pre-wrap break-words" style={{ color: 'var(--pd-text)', fontFamily: 'var(--pd-font-mono)', margin: 0 }}>
                            {msg.content}
                          </pre>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-2 text-sm" style={{ color: 'var(--pd-muted)' }}>No transcript messages recorded.</div>
                  )}
                </section>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Selection bar */}
      {selection.size > 0 && (
        <div className="pd-card px-4 py-3 flex items-center gap-3 flex-wrap" data-testid="galaxy-selection-bar">
          <div className="text-sm font-semibold" style={{ color: 'var(--pd-text)' }}>
            {selectedPoints.length} session{selectedPoints.length === 1 ? '' : 's'} · {parleyParties.length} distinct agent{parleyParties.length === 1 ? '' : 's'}
          </div>
          <div className="flex items-center gap-1.5 flex-wrap min-w-0">
            {parleyParties.slice(0, 6).map((agentId) => (
              <span key={agentId} className="pd-chip" style={{ backgroundColor: 'var(--pd-bg)', color: 'var(--pd-text)', border: '1px solid var(--pd-border)' }}>
                {agentId}
              </span>
            ))}
            {parleyParties.length > 6 && (
              <span className="text-[13px]" style={{ color: 'var(--pd-muted)' }}>+{parleyParties.length - 6} more</span>
            )}
          </div>
          <input
            className="pd-input flex-1"
            style={{ minWidth: '14rem' }}
            placeholder={reasonPlaceholder}
            aria-label="Parley reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <button
            className="pd-button pd-button-primary"
            disabled={!canParley || parleyBusy}
            title={canParley ? 'Convene a parley between the selected agents' : 'Select sessions from at least 2 distinct agents — the daemon rejects parleys with fewer parties'}
            onClick={() => void handleParley()}
          >
            <MessagesSquare size={15} />
            {parleyBusy ? 'Convening…' : 'Initiate parley'}
          </button>
          <button
            className="pd-button pd-button-secondary"
            onClick={() => { setSelection(new Set()); setParleyNotice(null); }}
          >
            <X size={15} />
            Clear selection
          </button>
        </div>
      )}
    </div>
  );
}
