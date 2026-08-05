/**
 * Unit tests for lib/galaxy-math.ts — the pure, seeded numerics behind the
 * session galaxy. Everything is deterministic given a seed, and these tests
 * pin that contract down.
 */

import { describe, it, expect } from '@jest/globals';
import {
  mulberry32,
  pcaProject2,
  tsne2d,
  kmeans,
  silhouetteScore,
  chooseK,
  minMaxNormalize2d,
  estimateTokensFromText,
  clusterTerms,
} from '../../lib/galaxy-math.js';

/**
 * Plant `count` points around a center with a deterministic spread.
 * Well-separated centers → trivially recoverable clusters.
 */
function plantCluster(center, count, spread, rand) {
  const points = [];
  for (let i = 0; i < count; i++) {
    points.push(center.map((c) => c + (rand() - 0.5) * spread));
  }
  return points;
}

describe('mulberry32', () => {
  it('is deterministic for the same seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = Array.from({ length: 20 }, () => a());
    const seqB = Array.from({ length: 20 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it('produces different streams for different seeds', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    const seqA = Array.from({ length: 10 }, () => a());
    const seqB = Array.from({ length: 10 }, () => b());
    expect(seqA).not.toEqual(seqB);
  });

  it('stays in [0, 1)', () => {
    const rand = mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const v = rand();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('estimateTokensFromText', () => {
  it('estimates chars/4 rounded up', () => {
    expect(estimateTokensFromText('abcd')).toBe(1);
    expect(estimateTokensFromText('abcde')).toBe(2);
    expect(estimateTokensFromText('a'.repeat(400))).toBe(100);
  });

  it('floors at 1 for empty text', () => {
    expect(estimateTokensFromText('')).toBe(1);
  });
});

describe('pcaProject2', () => {
  it('returns 2-D coordinates and separates linearly-separated data', () => {
    const rand = mulberry32(3);
    const cloud = [
      ...plantCluster([0, 0, 0, 0], 10, 0.1, rand),
      ...plantCluster([10, 10, 10, 10], 10, 0.1, rand),
    ];
    const projected = pcaProject2(cloud, mulberry32(42));
    expect(projected).toHaveLength(20);
    expect(projected[0]).toHaveLength(2);
    // First PC should separate the two clouds
    const firstHalf = projected.slice(0, 10).map((p) => p[0]);
    const secondHalf = projected.slice(10).map((p) => p[0]);
    const meanA = firstHalf.reduce((s, v) => s + v, 0) / 10;
    const meanB = secondHalf.reduce((s, v) => s + v, 0) / 10;
    expect(Math.abs(meanA - meanB)).toBeGreaterThan(5);
  });

  it('handles empty input', () => {
    expect(pcaProject2([], mulberry32(42))).toEqual([]);
  });
});

describe('tsne2d', () => {
  it('is bitwise-identical for the same seed across two calls', () => {
    const rand = mulberry32(9);
    const data = [
      ...plantCluster([0, 0, 0], 6, 0.5, rand),
      ...plantCluster([8, 8, 8], 6, 0.5, rand),
    ];
    const a = tsne2d(data, { seed: 42 });
    const b = tsne2d(data, { seed: 42 });
    expect(a).toEqual(b);
  });

  it('spreads P < 3 on a fixed diagonal', () => {
    expect(tsne2d([[1, 2]], { seed: 42 })).toEqual([[0, 0]]);
    expect(tsne2d([[1, 2], [3, 4]], { seed: 42 })).toEqual([[0, 0], [1, 1]]);
    expect(tsne2d([], { seed: 42 })).toEqual([]);
  });

  it('keeps well-separated clusters apart in the embedding', () => {
    const rand = mulberry32(11);
    const data = [
      ...plantCluster([0, 0, 0, 0], 8, 0.2, rand),
      ...plantCluster([20, 20, 20, 20], 8, 0.2, rand),
    ];
    const coords = tsne2d(data, { seed: 42 });
    // Mean intra-cluster distance should be well below the inter-cluster
    // centroid distance.
    const centroid = (points) => points
      .reduce((acc, [x, y]) => [acc[0] + x, acc[1] + y], [0, 0])
      .map((v) => v / points.length);
    const cA = centroid(coords.slice(0, 8));
    const cB = centroid(coords.slice(8));
    const between = Math.hypot(cA[0] - cB[0], cA[1] - cB[1]);
    let within = 0;
    for (let i = 0; i < 8; i++) {
      within += Math.hypot(coords[i][0] - cA[0], coords[i][1] - cA[1]);
      within += Math.hypot(coords[8 + i][0] - cB[0], coords[8 + i][1] - cB[1]);
    }
    within /= 16;
    expect(between).toBeGreaterThan(within * 2);
  });
});

describe('kmeans', () => {
  it('recovers 3 planted well-separated gaussian clusters', () => {
    const rand = mulberry32(5);
    const data = [
      ...plantCluster([0, 0], 10, 0.5, rand),
      ...plantCluster([10, 0], 10, 0.5, rand),
      ...plantCluster([5, 10], 10, 0.5, rand),
    ];
    const { assignments, centroids } = kmeans(data, 3, mulberry32(42));
    expect(centroids).toHaveLength(3);
    // Each planted group must be internally consistent
    for (const start of [0, 10, 20]) {
      const group = assignments.slice(start, start + 10);
      expect(new Set(group).size).toBe(1);
    }
    // And the three groups must land in three distinct clusters
    expect(new Set([assignments[0], assignments[10], assignments[20]]).size).toBe(3);
  });

  it('is deterministic given the same seed', () => {
    const rand = mulberry32(6);
    const data = plantCluster([0, 0], 20, 4, rand);
    const a = kmeans(data, 4, mulberry32(42));
    const b = kmeans(data, 4, mulberry32(42));
    expect(a.assignments).toEqual(b.assignments);
    expect(a.centroids).toEqual(b.centroids);
  });

  it('clamps k to the number of points', () => {
    const { assignments, centroids } = kmeans([[0, 0], [1, 1]], 5, mulberry32(42));
    expect(assignments).toHaveLength(2);
    expect(centroids.length).toBeLessThanOrEqual(2);
  });

  it('handles empty input', () => {
    expect(kmeans([], 3, mulberry32(42))).toEqual({ assignments: [], centroids: [] });
  });
});

describe('silhouetteScore', () => {
  it('scores good separations higher than bad ones', () => {
    const rand = mulberry32(8);
    const data = [
      ...plantCluster([0, 0], 8, 0.5, rand),
      ...plantCluster([10, 10], 8, 0.5, rand),
    ];
    const good = data.map((_, i) => (i < 8 ? 0 : 1));
    // Alternating labels ignore geometry entirely
    const bad = data.map((_, i) => i % 2);
    expect(silhouetteScore(data, good)).toBeGreaterThan(silhouetteScore(data, bad));
    expect(silhouetteScore(data, good)).toBeGreaterThan(0.8);
  });

  it('returns 0 for a single cluster', () => {
    expect(silhouetteScore([[0, 0], [1, 1]], [0, 0])).toBe(0);
  });

  it('returns 0 for empty input', () => {
    expect(silhouetteScore([], [])).toBe(0);
  });
});

describe('chooseK', () => {
  it('picks k = 3 for 3 planted well-separated clusters', () => {
    const rand = mulberry32(13);
    const data = [
      ...plantCluster([0, 0, 0], 10, 0.4, rand),
      ...plantCluster([12, 0, 0], 10, 0.4, rand),
      ...plantCluster([6, 12, 0], 10, 0.4, rand),
    ];
    const { k, assignments } = chooseK(data, mulberry32(42));
    expect(k).toBe(3);
    expect(assignments).toHaveLength(30);
  });

  it('falls back to a single cluster for P < 4', () => {
    const { k, assignments } = chooseK([[0, 0], [1, 1], [2, 2]], mulberry32(42));
    expect(k).toBe(1);
    expect(assignments).toEqual([0, 0, 0]);
  });

  it('handles empty input', () => {
    expect(chooseK([], mulberry32(42))).toEqual({ k: 0, assignments: [] });
  });
});

describe('minMaxNormalize2d', () => {
  it('maps coordinates to [0, 1] per axis', () => {
    const normalized = minMaxNormalize2d([[-5, 100], [5, 200], [0, 150]]);
    expect(normalized).toEqual([[0, 0], [1, 1], [0.5, 0.5]]);
  });

  it('collapses a degenerate axis to 0.5', () => {
    const normalized = minMaxNormalize2d([[3, 1], [3, 2]]);
    expect(normalized).toEqual([[0.5, 0], [0.5, 1]]);
  });

  it('handles empty input', () => {
    expect(minMaxNormalize2d([])).toEqual([]);
  });
});

describe('clusterTerms', () => {
  it('surfaces planted discriminative bigrams and excludes uniform terms', () => {
    // Cluster 0 docs are about sqlite migrations; cluster 1 about css theming.
    // "shared banner" appears uniformly everywhere so MI should bury it.
    const docs = [
      'shared banner sqlite migration wal checkpoint rollback',
      'shared banner sqlite migration wal journal mode tuning',
      'shared banner sqlite migration schema versioning',
      'shared banner css theming dark mode tokens',
      'shared banner css theming oklch palette contrast',
      'shared banner css theming color rollout audit',
    ];
    const assignments = [0, 0, 0, 1, 1, 1];
    const terms = clusterTerms(docs, assignments, 2);
    expect(terms).toHaveLength(2);

    const cluster0Terms = terms[0].map((t) => t.term);
    const cluster1Terms = terms[1].map((t) => t.term);
    expect(cluster0Terms).toContain('sqlite migration');
    expect(cluster1Terms).toContain('css theming');
    // Uniform terms discriminate nothing
    expect(cluster0Terms).not.toContain('shared banner');
    expect(cluster1Terms).not.toContain('shared banner');
    expect(cluster0Terms).not.toContain('shared');
    expect(cluster1Terms).not.toContain('banner');
    // MI values are positive for surfaced terms
    for (const { mi } of terms[0]) expect(mi).toBeGreaterThan(0);
  });

  it('caps at 5 terms per cluster', () => {
    const docs = [
      'alpha beta gamma delta epsilon zeta eta theta',
      'alpha beta gamma delta epsilon zeta eta theta',
      'iota kappa lambda mu nu xi omicron pi',
      'iota kappa lambda mu nu xi omicron pi',
    ];
    const terms = clusterTerms(docs, [0, 0, 1, 1], 2);
    expect(terms[0].length).toBeLessThanOrEqual(5);
    expect(terms[1].length).toBeLessThanOrEqual(5);
  });

  it('drops short tokens and pure numbers', () => {
    const docs = [
      'ab 12 345 daemon restart loop',
      'cd 99 000 daemon restart loop',
      'ef 42 111 daemon restart loop',
    ];
    const terms = clusterTerms(docs, [0, 0, 0], 1);
    const flat = terms[0].map((t) => t.term);
    expect(flat).not.toContain('ab');
    expect(flat).not.toContain('12');
    expect(flat).not.toContain('345');
    expect(flat).toContain('daemon');
  });

  it('falls back to top-TF for a single cluster', () => {
    const docs = [
      'daemon spawn watch loop',
      'daemon spawn emergency stop',
      'daemon budget guard',
    ];
    const terms = clusterTerms(docs, [0, 0, 0], 1);
    expect(terms).toHaveLength(1);
    expect(terms[0][0].term).toBe('daemon');
    expect(terms[0][0].mi).toBe(3);
  });

  it('handles empty input', () => {
    expect(clusterTerms([], [], 0)).toEqual([]);
    expect(clusterTerms([], [], 2)).toEqual([[], []]);
  });
});
