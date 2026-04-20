import type {
  SemanticResolutionDecision,
  SemanticResolutionEvent,
  SemanticResolutionStats,
} from '../types';

/**
 * Stable operator-facing order for semantic decision summaries and charts.
 *
 * Example:
 * - output: `['auto', 'review', 'reject', 'error', 'seeded']`
 */
export const SEMANTIC_DECISION_ORDER: SemanticResolutionDecision[] = [
  'auto',
  'review',
  'reject',
  'error',
  'seeded',
];

/**
 * Shared color/label metadata for a semantic decision class.
 *
 * Example:
 * - input: `'review'`
 * - output: `{ label: 'Review', fillVar: '--pd-accent', ... }`
 */
export function semanticDecisionPalette(decision: SemanticResolutionDecision): {
  label: string;
  fillVar: string;
  surfaceVar: string;
  borderVar: string;
  textVar: string;
} {
  switch (decision) {
    case 'auto':
      return {
        label: 'Auto',
        fillVar: '--pd-success',
        surfaceVar: '--pd-success-surface',
        borderVar: '--pd-success-border',
        textVar: '--pd-success',
      };
    case 'review':
      return {
        label: 'Review',
        fillVar: '--pd-accent',
        surfaceVar: '--pd-accent-surface',
        borderVar: '--pd-accent-border',
        textVar: '--pd-accent',
      };
    case 'reject':
      return {
        label: 'Reject',
        fillVar: '--pd-danger',
        surfaceVar: '--pd-danger-surface',
        borderVar: '--pd-danger-border',
        textVar: '--pd-danger',
      };
    case 'error':
      return {
        label: 'Error',
        fillVar: '--pd-danger',
        surfaceVar: '--pd-danger-surface',
        borderVar: '--pd-danger-border',
        textVar: '--pd-danger',
      };
    case 'seeded':
    default:
      return {
        label: 'Seeded',
        fillVar: '--pd-text',
        surfaceVar: '--pd-surface',
        borderVar: '--pd-border',
        textVar: '--pd-text',
      };
  }
}

/**
 * One segment of the semantic decision distribution bar.
 */
export interface SemanticDecisionSegment {
  decision: SemanticResolutionDecision;
  label: string;
  count: number;
  ratio: number;
  offset: number;
  fillVar: string;
  surfaceVar: string;
  borderVar: string;
  textVar: string;
}

/**
 * One plotted point on the recent similarity runway chart.
 */
export interface SemanticSimilarityRunwayPoint {
  id: number;
  decision: SemanticResolutionDecision;
  x: number;
  y: number;
  similarity: number | null;
  label: string;
  fillVar: string;
  borderVar: string;
  isNearAutoBoundary: boolean;
  isNearReviewBoundary: boolean;
}

/**
 * Fully-shaped SVG runway model for recent semantic decisions.
 */
export interface SemanticSimilarityRunway {
  width: number;
  height: number;
  paddingX: number;
  paddingTop: number;
  paddingBottom: number;
  autoY: number;
  reviewY: number;
  points: SemanticSimilarityRunwayPoint[];
  summary: string;
}

/**
 * One relative pressure bar for the operator summary.
 */
export interface SemanticPressureBar {
  key: 'reviewBacklog' | 'nearAutoBoundary' | 'nearReviewBoundary';
  label: string;
  description: string;
  value: number;
  ratio: number;
  fillVar: string;
  surfaceVar: string;
  borderVar: string;
  textVar: string;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function resolutionCount(
  stats: SemanticResolutionStats | null | undefined,
  decision: SemanticResolutionDecision,
): number {
  return Math.max(0, stats?.decisions?.[decision] ?? 0);
}

function runwayY(value: number, height: number, paddingTop: number, paddingBottom: number): number {
  const drawableHeight = height - paddingTop - paddingBottom;
  return paddingTop + (1 - clamp01(value)) * drawableHeight;
}

function withinBoundary(value: number, threshold: number, margin: number): boolean {
  return Math.abs(value - threshold) <= margin + 1e-9;
}

/**
 * Convert aggregate decision counts into a stacked-bar model.
 *
 * Example:
 * - input: `totalEvents=10`, `decisions.auto=6`, `decisions.review=4`
 * - output: auto ratio `0.6`, review ratio `0.4`
 */
export function buildDecisionSegments(
  stats: SemanticResolutionStats | null | undefined,
): SemanticDecisionSegment[] {
  const computedTotal = SEMANTIC_DECISION_ORDER.reduce(
    (sum, decision) => sum + resolutionCount(stats, decision),
    0,
  );
  const total = Math.max(stats?.totalEvents ?? 0, computedTotal);
  if (total <= 0) return [];

  let offset = 0;
  return SEMANTIC_DECISION_ORDER
    .map((decision) => {
      const palette = semanticDecisionPalette(decision);
      const count = resolutionCount(stats, decision);
      const ratio = count / total;
      const segment: SemanticDecisionSegment = {
        decision,
        label: palette.label,
        count,
        ratio,
        offset,
        fillVar: palette.fillVar,
        surfaceVar: palette.surfaceVar,
        borderVar: palette.borderVar,
        textVar: palette.textVar,
      };
      offset += ratio;
      return segment;
    })
    .filter((segment) => segment.count > 0);
}

/**
 * Shape recent resolution events into a threshold runway with exact threshold
 * lines and boundary pressure markers.
 *
 * Example:
 * - input: two decisions at similarities `0.92` and `0.81`
 * - output: two plotted points plus threshold Y positions
 */
export function buildSimilarityRunway(
  events: SemanticResolutionEvent[],
  stats: SemanticResolutionStats | null | undefined,
  options: { width?: number; height?: number } = {},
): SemanticSimilarityRunway {
  const width = options.width ?? 360;
  const height = options.height ?? 208;
  const paddingX = 26;
  const paddingTop = 18;
  const paddingBottom = 28;
  const autoThreshold = clamp01(stats?.autoThreshold ?? 0.88);
  const reviewThreshold = clamp01(stats?.reviewThreshold ?? 0.8);
  const boundaryMargin = Math.max(0, stats?.boundaryMargin ?? 0);
  const ordered = [...events].sort((left, right) => left.createdAt - right.createdAt);

  const points = ordered.map((event, index) => {
    const palette = semanticDecisionPalette(event.decision);
    const progress = ordered.length <= 1 ? 0.5 : index / (ordered.length - 1);
    const similarity = typeof event.similarity === 'number' ? clamp01(event.similarity) : null;
    const x = paddingX + progress * (width - paddingX * 2);
    const y = similarity === null
      ? height - paddingBottom
      : runwayY(similarity, height, paddingTop, paddingBottom);
    const similarityLabel = similarity === null ? 'n/a' : similarity.toFixed(2);
    return {
      id: event.id,
      decision: event.decision,
      x,
      y,
      similarity,
      label: `${palette.label}: ${event.canonicalTerm} vs ${event.candidateTerm ?? event.rawTerm} at ${similarityLabel}`,
      fillVar: palette.fillVar,
      borderVar: palette.borderVar,
      isNearAutoBoundary: similarity !== null && withinBoundary(similarity, autoThreshold, boundaryMargin),
      isNearReviewBoundary: similarity !== null && withinBoundary(similarity, reviewThreshold, boundaryMargin),
    } satisfies SemanticSimilarityRunwayPoint;
  });

  const observedValues = points
    .map((point) => point.similarity)
    .filter((value): value is number => value !== null);
  const summary = observedValues.length === 0
    ? 'No recent semantic similarity decisions recorded for this scope.'
    : `Recent similarities range from ${Math.min(...observedValues).toFixed(2)} to ${Math.max(...observedValues).toFixed(2)} across ${observedValues.length} decisions. Auto threshold is ${autoThreshold.toFixed(2)} and review threshold is ${reviewThreshold.toFixed(2)}.`;

  return {
    width,
    height,
    paddingX,
    paddingTop,
    paddingBottom,
    autoY: runwayY(autoThreshold, height, paddingTop, paddingBottom),
    reviewY: runwayY(reviewThreshold, height, paddingTop, paddingBottom),
    points,
    summary,
  };
}

/**
 * Normalize the main operator-pressure counters into comparable progress bars.
 *
 * Example:
 * - input: `{ reviewBacklog: 8, nearAutoBoundary: 3, nearReviewBoundary: 2 }`
 * - output: review backlog ratio `1`, near auto ratio `0.375`
 */
export function buildPressureBars(
  stats: SemanticResolutionStats | null | undefined,
): SemanticPressureBar[] {
  const rows = [
    {
      key: 'reviewBacklog' as const,
      label: 'Pending review',
      description: 'Candidates currently waiting on an operator decision.',
      value: Math.max(0, stats?.reviewBacklog ?? 0),
      fillVar: '--pd-accent',
      surfaceVar: '--pd-accent-surface',
      borderVar: '--pd-accent-border',
      textVar: '--pd-accent',
    },
    {
      key: 'nearAutoBoundary' as const,
      label: 'Near auto',
      description: 'Decisions landing within the auto-threshold warning margin.',
      value: Math.max(0, stats?.nearAutoBoundary ?? 0),
      fillVar: '--pd-success',
      surfaceVar: '--pd-success-surface',
      borderVar: '--pd-success-border',
      textVar: '--pd-success',
    },
    {
      key: 'nearReviewBoundary' as const,
      label: 'Near review',
      description: 'Decisions landing within the review-threshold warning margin.',
      value: Math.max(0, stats?.nearReviewBoundary ?? 0),
      fillVar: '--pd-danger',
      surfaceVar: '--pd-danger-surface',
      borderVar: '--pd-danger-border',
      textVar: '--pd-danger',
    },
  ];

  const maxValue = Math.max(1, ...rows.map((row) => row.value));
  return rows.map((row) => ({
    ...row,
    ratio: row.value / maxValue,
  }));
}
