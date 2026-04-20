import { describe, expect, test } from '@jest/globals';
import {
  buildDecisionSegments,
  buildPressureBars,
  buildSimilarityRunway,
} from '../../fleet-config-ui/src/lib/semantic-viz.ts';
import type {
  SemanticResolutionEvent,
  SemanticResolutionStats,
} from '../../fleet-config-ui/src/types.ts';

const baseStats: SemanticResolutionStats = {
  model: 'Xenova/all-MiniLM-L6-v2',
  autoThreshold: 0.88,
  reviewThreshold: 0.8,
  boundaryMargin: 0.02,
  totalTerms: 12,
  totalEvents: 10,
  reviewBacklog: 4,
  nearAutoBoundary: 3,
  nearReviewBoundary: 2,
  lastResolvedAt: 1_710_000_000_000,
  decisions: {
    auto: 5,
    review: 3,
    reject: 1,
    error: 1,
    seeded: 0,
  },
};

function makeEvent(overrides: Partial<SemanticResolutionEvent>): SemanticResolutionEvent {
  return {
    id: 1,
    projectDir: '/tmp/project',
    harbor: 'port-daddy:fleet',
    sourceType: 'fleet_task',
    sourceId: 'task-1',
    rawTerm: 'css tokens',
    canonicalTerm: 'design system tokens',
    candidateTerm: 'portdaddy design tokens',
    similarity: 0.9,
    decision: 'auto',
    thresholdAuto: 0.88,
    thresholdReview: 0.8,
    model: 'Xenova/all-MiniLM-L6-v2',
    metadata: null,
    createdAt: 1_710_000_000_000,
    ...overrides,
  };
}

describe('semantic-viz helpers', () => {
  test('buildDecisionSegments preserves count ratios and offsets', () => {
    const segments = buildDecisionSegments(baseStats);

    expect(segments.map((segment) => segment.decision)).toEqual([
      'auto',
      'review',
      'reject',
      'error',
    ]);
    expect(segments[0]?.ratio).toBeCloseTo(0.5, 6);
    expect(segments[1]?.offset).toBeCloseTo(0.5, 6);
    expect(segments[2]?.ratio).toBeCloseTo(0.1, 6);
  });

  test('buildSimilarityRunway sorts by time and flags near-threshold points', () => {
    const runway = buildSimilarityRunway([
      makeEvent({ id: 3, createdAt: 300, similarity: 0.79, decision: 'review' }),
      makeEvent({ id: 1, createdAt: 100, similarity: 0.9, decision: 'auto' }),
      makeEvent({ id: 2, createdAt: 200, similarity: 0.81, decision: 'review' }),
    ], baseStats, { width: 300, height: 180 });

    expect(runway.points.map((point) => point.id)).toEqual([1, 2, 3]);
    expect(runway.points[0]?.isNearAutoBoundary).toBe(true);
    expect(runway.points[1]?.isNearReviewBoundary).toBe(true);
    expect(runway.autoY).toBeLessThan(runway.reviewY);
    expect(runway.summary).toContain('0.79');
    expect(runway.summary).toContain('0.90');
  });

  test('buildPressureBars normalizes against the highest visible pressure', () => {
    const bars = buildPressureBars(baseStats);

    expect(bars.map((bar) => bar.key)).toEqual([
      'reviewBacklog',
      'nearAutoBoundary',
      'nearReviewBoundary',
    ]);
    expect(bars[0]?.ratio).toBe(1);
    expect(bars[1]?.ratio).toBeCloseTo(0.75, 6);
    expect(bars[2]?.ratio).toBeCloseTo(0.5, 6);
  });
});
