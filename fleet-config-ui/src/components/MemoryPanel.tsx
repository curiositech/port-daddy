import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, FileStack, Network, ScrollText } from 'lucide-react';
import {
  fetchEpisodes,
  fetchGraphEdges,
  fetchGraphStats,
  fetchMemoryStats,
  fetchSemanticResolutions,
  fetchSemanticStats,
  fetchTupleEntries,
  openFileInEditor,
  revealFileInFinder,
} from '../api';
import { extractMentionedPaths } from '../fileMentions';
import {
  buildDecisionSegments,
  buildPressureBars,
  buildSimilarityRunway,
  semanticDecisionPalette,
  SEMANTIC_DECISION_ORDER,
  type SemanticDecisionSegment,
  type SemanticPressureBar,
  type SemanticSimilarityRunway,
} from '../lib/semantic-viz';
import type {
  Episode,
  GraphEdge,
  GraphStats,
  MemoryStats,
  SemanticResolutionEvent,
  SemanticResolutionStats,
  TupleEntry,
} from '../types';

/**
 * Human-readable age label used across tuple, graph, episode, and semantic rows.
 *
 * Example:
 * - input: `Date.now() - 90_000`
 * - output: `"1m ago"`
 */
function relativeTime(timestamp: number | null | undefined): string {
  if (!timestamp) return 'never';
  const delta = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(delta / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Guess which tuple/edge payload fields are likely file paths so the operator
 * can jump straight into Finder or their editor.
 *
 * Example:
 * - input: `['lib/semantic-resolver.ts', 'https://example.com', 'notes']`
 * - output: `['lib/semantic-resolver.ts']`
 */
function likelyPaths(fields: string[], projectDir?: string): string[] {
  return [...new Set(fields.filter(Boolean).filter((value) => {
    if (value.startsWith('/')) return true;
    if (value.startsWith('./') || value.startsWith('../')) return true;
    if (projectDir && !value.includes('\n') && value.includes('/') && !value.includes('://')) return true;
    return false;
  }))];
}

/**
 * Format semantic similarity for operator review.
 *
 * Example:
 * - input: `0.8761`
 * - output: `"0.88"`
 */
function formatSimilarity(value: number | null | undefined): string {
  return typeof value === 'number' ? value.toFixed(2) : 'n/a';
}

/**
 * Render concise percentages for legends and summary cards.
 *
 * Example:
 * - input: `0.375`
 * - output: `"38%"`
 */
function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/**
 * Render editor/Finder shortcuts for the first few file-like paths discovered
 * in a tuple, graph edge, or episode payload.
 */
function fileActionButtons(paths: string[], projectDir?: string) {
  if (paths.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {paths.slice(0, 4).map((path) => (
        <div key={path} className="flex items-center gap-1">
          <button
            onClick={() => void openFileInEditor(path, projectDir)}
            className="text-[10px] px-2 py-1 rounded border"
            style={{ borderColor: 'var(--pd-border)', color: 'var(--pd-text)', backgroundColor: 'var(--pd-bg)' }}
          >
            EDITOR
          </button>
          <button
            onClick={() => void revealFileInFinder(path, projectDir)}
            className="text-[10px] px-2 py-1 rounded border"
            style={{ borderColor: 'var(--pd-border)', color: 'var(--pd-text)', backgroundColor: 'var(--pd-bg)' }}
          >
            FINDER
          </button>
        </div>
      ))}
    </div>
  );
}

/**
 * Compact stacked-bar summary of the current semantic decision mix.
 */
function DecisionMixChart({
  segments,
  totalEvents,
}: {
  segments: SemanticDecisionSegment[];
  totalEvents: number;
}) {
  if (segments.length === 0 || totalEvents <= 0) {
    return <div className="text-sm opacity-50">Decision mix will appear after semantic joins start landing.</div>;
  }

  const chartWidth = 320;
  const chartHeight = 18;
  const ariaLabel = `Semantic decision distribution across ${totalEvents} recorded events. ${segments
    .map((segment) => `${segment.label} ${segment.count}`)
    .join(', ')}.`;

  return (
    <div className="space-y-3">
      <svg
        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
        role="img"
        aria-label={ariaLabel}
        className="block h-[18px] w-full overflow-visible rounded-full"
      >
        <rect
          x="0"
          y="0"
          width={chartWidth}
          height={chartHeight}
          rx="9"
          fill="var(--pd-bg)"
          stroke="var(--pd-border)"
        />
        {segments.map((segment) => (
          <rect
            key={segment.decision}
            x={segment.offset * chartWidth}
            y="0"
            width={Math.max(segment.ratio * chartWidth, 4)}
            height={chartHeight}
            rx="9"
            fill={`var(${segment.fillVar})`}
          />
        ))}
      </svg>
      <div className="grid gap-2 sm:grid-cols-2">
        {SEMANTIC_DECISION_ORDER.map((decision) => {
          const segment = segments.find((candidate) => candidate.decision === decision);
          if (!segment) return null;
          return (
            <div
              key={decision}
              className="rounded-2xl px-3 py-2"
              style={{ border: `1px solid var(${segment.borderVar})`, backgroundColor: `var(${segment.surfaceVar})` }}
            >
              <div className="flex items-center justify-between gap-3 text-[11px]">
                <span className="font-semibold" style={{ color: `var(${segment.textVar})` }}>{segment.label}</span>
                <span className="opacity-70">{segment.count} • {formatPercent(segment.ratio)}</span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="text-[11px] opacity-65">
        Distribution across all semantic decisions currently visible for this project scope.
      </div>
    </div>
  );
}

/**
 * Plot recent similarity scores against both live thresholds.
 */
function SimilarityRunwayChart({
  runway,
  autoThreshold,
  reviewThreshold,
}: {
  runway: SemanticSimilarityRunway;
  autoThreshold: number;
  reviewThreshold: number;
}) {
  if (runway.points.length === 0) {
    return <div className="text-sm opacity-50">Similarity runway will appear after enough semantic comparisons are recorded.</div>;
  }

  const drawableWidth = runway.width - runway.paddingX * 2;
  const drawableHeight = runway.height - runway.paddingTop - runway.paddingBottom;
  const polylinePoints = runway.points.map((point) => `${point.x},${point.y}`).join(' ');

  return (
    <div className="space-y-3">
      <svg
        viewBox={`0 0 ${runway.width} ${runway.height}`}
        role="img"
        aria-label={runway.summary}
        className="block h-[220px] w-full"
      >
        <rect
          x={runway.paddingX}
          y={runway.paddingTop}
          width={drawableWidth}
          height={drawableHeight}
          rx="14"
          fill="var(--pd-bg)"
          stroke="var(--pd-border)"
        />
        <rect
          x={runway.paddingX}
          y={runway.paddingTop}
          width={drawableWidth}
          height={Math.max(0, runway.autoY - runway.paddingTop)}
          fill="var(--pd-success-surface)"
          opacity="0.22"
        />
        <rect
          x={runway.paddingX}
          y={runway.autoY}
          width={drawableWidth}
          height={Math.max(0, runway.reviewY - runway.autoY)}
          fill="var(--pd-accent-surface)"
          opacity="0.28"
        />
        <rect
          x={runway.paddingX}
          y={runway.reviewY}
          width={drawableWidth}
          height={Math.max(0, runway.height - runway.paddingBottom - runway.reviewY)}
          fill="var(--pd-danger-surface)"
          opacity="0.18"
        />
        <line
          x1={runway.paddingX}
          x2={runway.width - runway.paddingX}
          y1={runway.autoY}
          y2={runway.autoY}
          stroke="var(--pd-success)"
          strokeDasharray="4 4"
        />
        <line
          x1={runway.paddingX}
          x2={runway.width - runway.paddingX}
          y1={runway.reviewY}
          y2={runway.reviewY}
          stroke="var(--pd-accent)"
          strokeDasharray="4 4"
        />
        <polyline
          fill="none"
          stroke="var(--pd-text)"
          strokeOpacity="0.28"
          strokeWidth="2"
          points={polylinePoints}
        />
        {runway.points.map((point) => (
          <g key={point.id}>
            {point.isNearAutoBoundary || point.isNearReviewBoundary ? (
              <circle
                cx={point.x}
                cy={point.y}
                r="7"
                fill={`var(${point.fillVar})`}
                opacity="0.18"
              />
            ) : null}
            <circle
              cx={point.x}
              cy={point.y}
              r="4.25"
              fill={`var(${point.fillVar})`}
              stroke={`var(${point.borderVar})`}
              strokeWidth="1.5"
            >
              <title>{point.label}</title>
            </circle>
          </g>
        ))}
        <text x="4" y={runway.paddingTop + 4} fontSize="10" fill="var(--pd-text)" opacity="0.55">1.00</text>
        <text x="4" y={runway.height - runway.paddingBottom + 4} fontSize="10" fill="var(--pd-text)" opacity="0.55">0.00</text>
        <text x={runway.width - runway.paddingX - 2} y={runway.autoY - 6} textAnchor="end" fontSize="10" fill="var(--pd-success)">
          auto {autoThreshold.toFixed(2)}
        </text>
        <text x={runway.width - runway.paddingX - 2} y={runway.reviewY - 6} textAnchor="end" fontSize="10" fill="var(--pd-accent)">
          review {reviewThreshold.toFixed(2)}
        </text>
        <text x={runway.paddingX} y={runway.height - 6} fontSize="10" fill="var(--pd-text)" opacity="0.45">older</text>
        <text x={runway.width - runway.paddingX} y={runway.height - 6} textAnchor="end" fontSize="10" fill="var(--pd-text)" opacity="0.45">newer</text>
      </svg>
      <div className="flex flex-wrap gap-2 text-[11px]">
        <span className="rounded-full px-2 py-1" style={{ backgroundColor: 'var(--pd-success-surface)', border: '1px solid var(--pd-success-border)', color: 'var(--pd-success)' }}>
          auto-accept band
        </span>
        <span className="rounded-full px-2 py-1" style={{ backgroundColor: 'var(--pd-accent-surface)', border: '1px solid var(--pd-accent-border)', color: 'var(--pd-accent)' }}>
          review band
        </span>
        <span className="rounded-full px-2 py-1" style={{ backgroundColor: 'var(--pd-danger-surface)', border: '1px solid var(--pd-danger-border)', color: 'var(--pd-danger)' }}>
          reject/error band
        </span>
      </div>
      <div className="text-[11px] opacity-65">
        Recent comparisons plotted oldest to newest so threshold drift and edge-of-band clustering are obvious.
      </div>
    </div>
  );
}

/**
 * Relative pressure bars for backlog and threshold-adjacent decision counts.
 */
function PressureBars({ bars }: { bars: SemanticPressureBar[] }) {
  return (
    <div className="space-y-3">
      {bars.map((bar) => (
        <div key={bar.key} className="space-y-1">
          <div className="flex items-center justify-between gap-3 text-[11px]">
            <span className="font-semibold">{bar.label}</span>
            <span className="opacity-70">{bar.value}</span>
          </div>
          <div
            className="h-2 overflow-hidden rounded-full"
            style={{ border: `1px solid var(${bar.borderVar})`, backgroundColor: `var(${bar.surfaceVar})` }}
          >
            <div
              className="h-full rounded-full"
              style={{ width: `${Math.max(bar.ratio * 100, bar.value > 0 ? 6 : 0)}%`, backgroundColor: `var(${bar.fillVar})` }}
            />
          </div>
          <div className="text-[11px] opacity-60">{bar.description}</div>
        </div>
      ))}
    </div>
  );
}

/**
 * Unified operator view for short-term tuples, durable graph edges, promoted
 * episodes, and semantic-resolution monitoring.
 *
 * Example props:
 * ```tsx
 * <MemoryPanel
 *   projectDir="/Users/erichowens/coding/port-daddy"
 *   projectName="port-daddy"
 *   harbor="port-daddy:fleet"
 * />
 * ```
 */
export default function MemoryPanel({
  projectDir,
  projectName,
  harbor,
}: {
  projectDir?: string;
  projectName?: string | null;
  harbor?: string | null;
}) {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tuples, setTuples] = useState<TupleEntry[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [graphStats, setGraphStats] = useState<GraphStats | null>(null);
  const [memoryStats, setMemoryStats] = useState<MemoryStats | null>(null);
  const [semanticStats, setSemanticStats] = useState<SemanticResolutionStats | null>(null);
  const [semanticResolutions, setSemanticResolutions] = useState<SemanticResolutionEvent[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function loadMemorySurfaces() {
      setLoading(true);
      setError(null);

      try {
        const [
          tupleData,
          edgeData,
          episodeData,
          graphStatsData,
          memoryStatsData,
          semanticStatsData,
          semanticResolutionData,
        ] = await Promise.all([
          fetchTupleEntries({ harbor: harbor || undefined, query, limit: 50 }),
          fetchGraphEdges({ projectDir, query, limit: 120 }),
          fetchEpisodes({ projectDir, project: projectName || undefined, harbor: harbor || undefined, query, limit: 80 }),
          fetchGraphStats(projectDir),
          fetchMemoryStats(projectDir, projectName || undefined),
          fetchSemanticStats(projectDir),
          fetchSemanticResolutions({ projectDir, query, limit: 60 }),
        ]);

        if (cancelled) return;
        setTuples(tupleData);
        setEdges(edgeData);
        setEpisodes(episodeData);
        setGraphStats(graphStatsData);
        setMemoryStats(memoryStatsData);
        setSemanticStats(semanticStatsData);
        setSemanticResolutions(semanticResolutionData);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void Promise.resolve().then(loadMemorySurfaces);

    return () => {
      cancelled = true;
    };
  }, [harbor, projectDir, projectName, query]);

  const tuplePaths = useMemo(() => tuples.map((tuple) => {
    const extracted = extractMentionedPaths(JSON.stringify(tuple.fields), 6);
    return [tuple.id, likelyPaths(extracted, projectDir)] as const;
  }), [projectDir, tuples]);
  const semanticDecisionSegments = useMemo(
    () => buildDecisionSegments(semanticStats),
    [semanticStats],
  );
  const semanticPressureBars = useMemo(
    () => buildPressureBars(semanticStats),
    [semanticStats],
  );
  const semanticRunway = useMemo(
    () => buildSimilarityRunway(semanticResolutions, semanticStats),
    [semanticResolutions, semanticStats],
  );
  const visibleSemanticResolutions = useMemo(
    () => semanticResolutions.slice(0, 24),
    [semanticResolutions],
  );

  return (
    <div className="h-full overflow-y-auto p-5" style={{ color: 'var(--pd-text)' }}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[10px] font-semibold tracking-wider opacity-35">MEMORY</div>
            <div className="mt-1 text-xl font-semibold">Live tuples, durable graph edges, episodic memory, and semantic joins</div>
            <div className="mt-1 text-sm opacity-70">
              Blackboard coordination stays short-term. Graph edges capture durable structure. Episodes keep the story. Semantic resolution shows where the embedding thresholds are landing.
            </div>
          </div>
          <div className="flex items-center gap-3">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search tuples, graph edges, episodes, and semantic decisions"
              className="w-[360px] max-w-full rounded-xl px-3 py-2 text-sm outline-none"
              style={{
                backgroundColor: 'var(--pd-surface)',
                border: '1px solid var(--pd-border)',
                color: 'var(--pd-text)',
              }}
            />
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl p-4" style={{ border: '1px solid var(--pd-border)', backgroundColor: 'var(--pd-surface)' }}>
            <div className="flex items-center gap-2 text-[11px] font-semibold tracking-wider opacity-50"><FileStack size={14} /> TUPLES</div>
            <div className="mt-2 text-2xl font-semibold">{tuples.length}</div>
            <div className="mt-1 text-sm opacity-70">Visible short-term coordination tuples{harbor ? ` in ${harbor}` : ''}.</div>
          </div>
          <div className="rounded-2xl p-4" style={{ border: '1px solid var(--pd-border)', backgroundColor: 'var(--pd-surface)' }}>
            <div className="flex items-center gap-2 text-[11px] font-semibold tracking-wider opacity-50"><Network size={14} /> GRAPH</div>
            <div className="mt-2 text-2xl font-semibold">{graphStats?.total ?? 0}</div>
            <div className="mt-1 text-sm opacity-70">
              {graphStats?.sources ?? 0} sources, {graphStats?.targets ?? 0} targets, {graphStats?.scopes ?? 0} scopes.
            </div>
          </div>
          <div className="rounded-2xl p-4" style={{ border: '1px solid var(--pd-border)', backgroundColor: 'var(--pd-surface)' }}>
            <div className="flex items-center gap-2 text-[11px] font-semibold tracking-wider opacity-50"><ScrollText size={14} /> EPISODES</div>
            <div className="mt-2 text-2xl font-semibold">{memoryStats?.total ?? 0}</div>
            <div className="mt-1 text-sm opacity-70">
              {memoryStats?.episodeTypes ?? 0} episode types promoted from sessions and missions.
            </div>
          </div>
          <div className="rounded-2xl p-4" style={{ border: '1px solid var(--pd-border)', backgroundColor: 'var(--pd-surface)' }}>
            <div className="flex items-center gap-2 text-[11px] font-semibold tracking-wider opacity-50"><Network size={14} /> SEMANTIC</div>
            <div className="mt-2 text-2xl font-semibold">{semanticStats?.totalEvents ?? 0}</div>
            <div className="mt-1 text-sm opacity-70">
              {semanticStats?.reviewBacklog ?? 0} review candidates • auto {semanticStats?.autoThreshold?.toFixed(2) ?? 'n/a'} / review {semanticStats?.reviewThreshold?.toFixed(2) ?? 'n/a'}
            </div>
          </div>
        </div>

        {loading ? (
          <div className="rounded-2xl p-10 text-center opacity-60" style={{ border: '1px solid var(--pd-border)', backgroundColor: 'var(--pd-surface)' }}>
            Loading semantic memory surfaces...
          </div>
        ) : error ? (
          <div className="rounded-2xl p-4 text-sm" style={{ border: '1px solid var(--pd-accent-border)', backgroundColor: 'var(--pd-accent-surface)', color: 'var(--pd-accent)' }}>
            {error}
          </div>
        ) : (
          <div className="grid gap-4 xl:grid-cols-[1.05fr_1.2fr_1.15fr]">
            <section className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--pd-border)', backgroundColor: 'var(--pd-surface)' }}>
              <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--pd-border)' }}>
                <div className="text-[10px] font-semibold tracking-wider opacity-35">TUPLE SPACE</div>
                <div className="mt-1 text-sm font-semibold">Short-term coordination tuples</div>
              </div>
              <div className="max-h-[720px] overflow-y-auto p-4 space-y-3">
                {tuples.length === 0 ? <div className="text-sm opacity-50">No tuples matched this scope yet.</div> : tuples.map((tuple) => {
                  const paths = tuplePaths.find(([id]) => id === tuple.id)?.[1] ?? [];
                  return (
                    <div key={tuple.id} className="rounded-2xl p-4" style={{ border: '1px solid var(--pd-border)', backgroundColor: 'var(--pd-bg)' }}>
                      <div className="flex items-center justify-between gap-3 text-xs">
                        <div className="font-semibold">{tuple.harbor || 'unscoped tuple'}</div>
                        <div className="opacity-50">{relativeTime(tuple.createdAt)}</div>
                      </div>
                      <div className="mt-2 text-[11px] opacity-55">written by {tuple.writtenBy || 'unknown'}{tuple.expiresAt ? ` • expires ${relativeTime(tuple.expiresAt)}` : ''}</div>
                      <pre className="mt-3 whitespace-pre-wrap break-words text-[12px] leading-5" style={{ color: 'var(--pd-text)' }}>
                        {JSON.stringify(tuple.fields, null, 2)}
                      </pre>
                      {fileActionButtons(paths, projectDir)}
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--pd-border)', backgroundColor: 'var(--pd-surface)' }}>
              <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--pd-border)' }}>
                <div className="text-[10px] font-semibold tracking-wider opacity-35">GRAPH EDGES</div>
                <div className="mt-1 text-sm font-semibold">Durable semantic and causal structure</div>
              </div>
              <div className="max-h-[720px] overflow-y-auto p-4 space-y-3">
                {edges.length === 0 ? <div className="text-sm opacity-50">No durable edges have been written for this project yet.</div> : edges.map((edge) => {
                  const paths = likelyPaths(
                    extractMentionedPaths(`${edge.sourceId}\n${edge.targetId}\n${JSON.stringify(edge.metadata ?? {})}`, 8),
                    projectDir,
                  );
                  return (
                    <div key={edge.id} className="rounded-2xl p-4" style={{ border: '1px solid var(--pd-border)', backgroundColor: 'var(--pd-bg)' }}>
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-[11px] font-semibold tracking-wider opacity-45">{edge.scope}</div>
                        <div className="text-xs opacity-50">{relativeTime(edge.updatedAt)}</div>
                      </div>
                      <div className="mt-3 flex items-center gap-2 text-sm flex-wrap">
                        <span className="rounded-full px-2 py-1 text-[11px]" style={{ backgroundColor: 'var(--pd-surface)', border: '1px solid var(--pd-border)' }}>{edge.sourceType}</span>
                        <span className="font-mono text-xs break-all">{edge.sourceId}</span>
                        <ArrowRight size={14} className="opacity-35" />
                        <span className="rounded-full px-2 py-1 text-[11px]" style={{ backgroundColor: 'var(--pd-success-surface)', border: '1px solid var(--pd-success-border)', color: 'var(--pd-success)' }}>{edge.edgeType}</span>
                        <ArrowRight size={14} className="opacity-35" />
                        <span className="rounded-full px-2 py-1 text-[11px]" style={{ backgroundColor: 'var(--pd-surface)', border: '1px solid var(--pd-border)' }}>{edge.targetType}</span>
                        <span className="font-mono text-xs break-all">{edge.targetId}</span>
                      </div>
                      {edge.metadata ? (
                        <pre className="mt-3 whitespace-pre-wrap break-words text-[11px] leading-5 opacity-80">
                          {JSON.stringify(edge.metadata, null, 2)}
                        </pre>
                      ) : null}
                      {fileActionButtons(paths, projectDir)}
                    </div>
                  );
                })}
              </div>
            </section>

            <div className="space-y-4">
              <section className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--pd-border)', backgroundColor: 'var(--pd-surface)' }}>
                <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--pd-border)' }}>
                  <div className="text-[10px] font-semibold tracking-wider opacity-35">SEMANTIC RESOLUTION</div>
                  <div className="mt-1 text-sm font-semibold">Threshold health and recent join decisions</div>
                </div>
                <div className="p-4 space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl p-3" style={{ border: '1px solid var(--pd-border)', backgroundColor: 'var(--pd-bg)' }}>
                      <div className="text-[10px] font-semibold tracking-wider opacity-40">MODEL</div>
                      <div className="mt-2 text-sm font-semibold break-all">{semanticStats?.model ?? 'unavailable'}</div>
                      <div className="mt-2 text-[11px] opacity-65">
                        auto {semanticStats?.autoThreshold?.toFixed(2) ?? 'n/a'} • review {semanticStats?.reviewThreshold?.toFixed(2) ?? 'n/a'} • margin {semanticStats?.boundaryMargin?.toFixed(2) ?? 'n/a'}
                      </div>
                      <div className="mt-2 text-[11px] opacity-65">
                        {semanticStats?.totalTerms ?? 0} learned terms • last resolved {relativeTime(semanticStats?.lastResolvedAt)}
                      </div>
                    </div>
                    <div className="rounded-2xl p-3" style={{ border: '1px solid var(--pd-border)', backgroundColor: 'var(--pd-bg)' }}>
                      <div className="text-[10px] font-semibold tracking-wider opacity-40">PRESSURE</div>
                      <div className="mt-2 text-sm font-semibold">{semanticStats?.reviewBacklog ?? 0} pending review</div>
                      <div className="mt-2 text-[11px] opacity-65">
                        near auto {semanticStats?.nearAutoBoundary ?? 0} • near review {semanticStats?.nearReviewBoundary ?? 0}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl p-3" style={{ border: '1px solid var(--pd-border)', backgroundColor: 'var(--pd-bg)' }}>
                    <div className="text-[10px] font-semibold tracking-wider opacity-40">DECISION MIX</div>
                    <div className="mt-2 text-sm font-semibold">What the current policy is actually doing</div>
                    <div className="mt-3">
                      <DecisionMixChart
                        segments={semanticDecisionSegments}
                        totalEvents={semanticStats?.totalEvents ?? 0}
                      />
                    </div>
                  </div>

                  <div className="rounded-2xl p-3" style={{ border: '1px solid var(--pd-border)', backgroundColor: 'var(--pd-bg)' }}>
                    <div className="text-[10px] font-semibold tracking-wider opacity-40">SIMILARITY RUNWAY</div>
                    <div className="mt-2 text-sm font-semibold">Recent scores against the live thresholds</div>
                    <div className="mt-3">
                      <SimilarityRunwayChart
                        runway={semanticRunway}
                        autoThreshold={semanticStats?.autoThreshold ?? 0}
                        reviewThreshold={semanticStats?.reviewThreshold ?? 0}
                      />
                    </div>
                  </div>

                  <div className="rounded-2xl p-3" style={{ border: '1px solid var(--pd-border)', backgroundColor: 'var(--pd-bg)' }}>
                    <div className="text-[10px] font-semibold tracking-wider opacity-40">BOUNDARY PRESSURE</div>
                    <div className="mt-2 text-sm font-semibold">Where the magic number is under stress</div>
                    <div className="mt-3">
                      <PressureBars bars={semanticPressureBars} />
                    </div>
                  </div>

                  <div className="space-y-3 max-h-[300px] overflow-y-auto">
                    {visibleSemanticResolutions.length === 0 ? <div className="text-sm opacity-50">No semantic decisions recorded for this scope yet.</div> : visibleSemanticResolutions.map((resolution) => {
                      const palette = semanticDecisionPalette(resolution.decision);
                      return (
                        <div key={resolution.id} className="rounded-2xl p-4" style={{ border: '1px solid var(--pd-border)', backgroundColor: 'var(--pd-bg)' }}>
                          <div className="flex items-start justify-between gap-3">
                            <div className="text-sm font-semibold break-words">{resolution.canonicalTerm}</div>
                            <div className="text-xs opacity-50 whitespace-nowrap">{relativeTime(resolution.createdAt)}</div>
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                            <span
                              className="rounded-full px-2 py-1 font-semibold uppercase"
                              style={{
                                backgroundColor: `var(${palette.surfaceVar})`,
                                border: `1px solid var(${palette.borderVar})`,
                                color: `var(${palette.textVar})`,
                              }}
                            >
                              {resolution.decision}
                            </span>
                            <span className="rounded-full px-2 py-1" style={{ backgroundColor: 'var(--pd-surface)', border: '1px solid var(--pd-border)' }}>
                              sim {formatSimilarity(resolution.similarity)}
                            </span>
                            <span className="rounded-full px-2 py-1" style={{ backgroundColor: 'var(--pd-surface)', border: '1px solid var(--pd-border)' }}>
                              {resolution.sourceType}
                            </span>
                          </div>
                          <div className="mt-3 text-[12px] leading-5 opacity-75">
                            raw: <span className="font-mono">{resolution.rawTerm}</span>
                          </div>
                          {resolution.candidateTerm ? (
                            <div className="mt-2 text-[12px] leading-5 opacity-75">
                              candidate: <span className="font-mono">{resolution.candidateTerm}</span>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </section>

              <section className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--pd-border)', backgroundColor: 'var(--pd-surface)' }}>
                <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--pd-border)' }}>
                  <div className="text-[10px] font-semibold tracking-wider opacity-35">EPISODIC MEMORY</div>
                  <div className="mt-1 text-sm font-semibold">Promoted notes, outcomes, and mission moments</div>
                </div>
                <div className="max-h-[420px] overflow-y-auto p-4 space-y-3">
                  {episodes.length === 0 ? <div className="text-sm opacity-50">No episodes have been promoted for this project yet.</div> : episodes.map((episode) => {
                    const paths = likelyPaths(
                      extractMentionedPaths(`${episode.title}\n${episode.summary}\n${JSON.stringify(episode.metadata ?? {})}`, 8),
                      projectDir,
                    );
                    return (
                      <div key={episode.id} className="rounded-2xl p-4" style={{ border: '1px solid var(--pd-border)', backgroundColor: 'var(--pd-bg)' }}>
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-semibold">{episode.title}</div>
                          <div className="text-xs opacity-50">{relativeTime(episode.updatedAt)}</div>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                          <span className="rounded-full px-2 py-1" style={{ backgroundColor: 'var(--pd-accent-surface)', border: '1px solid var(--pd-accent-border)', color: 'var(--pd-accent)' }}>{episode.episodeType}</span>
                          {episode.agentId ? <span className="rounded-full px-2 py-1" style={{ backgroundColor: 'var(--pd-surface)', border: '1px solid var(--pd-border)' }}>{episode.agentId}</span> : null}
                          {episode.harbor ? <span className="rounded-full px-2 py-1" style={{ backgroundColor: 'var(--pd-surface)', border: '1px solid var(--pd-border)' }}>{episode.harbor}</span> : null}
                        </div>
                        <div className="mt-3 text-sm whitespace-pre-wrap break-words">{episode.summary}</div>
                        <div className="mt-3 text-[11px] opacity-55">source: {episode.sourceType} / {episode.sourceId}</div>
                        {fileActionButtons(paths, projectDir)}
                      </div>
                    );
                  })}
                </div>
              </section>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
