/**
 * Galaxy Math — pure, dependency-free numerics behind the session galaxy.
 *
 * Everything here is deterministic given a seed: all stochastic algorithms
 * (t-SNE init/gradient, k-means++ init, silhouette-driven k selection) draw
 * exclusively from `mulberry32(seed)`. Same data + same seed → bitwise-identical
 * output across calls, which is what makes the /galaxy/map response cacheable
 * and testable.
 *
 * Scale envelope: the galaxy caps at 500 points, so the O(P^2) t-SNE and
 * silhouette implementations here are intentional — no Barnes-Hut, no
 * approximate neighbors, no extra dependencies.
 */

// =============================================================================
// Seeded PRNG
// =============================================================================

/**
 * Mulberry32 — small, fast, seedable PRNG. The single source of randomness for
 * every stochastic algorithm in this module.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// =============================================================================
// Linear algebra helpers (module-private)
// =============================================================================

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function norm(a: number[]): number {
  return Math.sqrt(dot(a, a));
}

function normalizeInPlace(a: number[]): void {
  const n = norm(a);
  if (n > 0) {
    for (let i = 0; i < a.length; i++) a[i] /= n;
  }
}

function squaredDistance(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return s;
}

// =============================================================================
// PCA (top-2 components via power iteration) — used as t-SNE init
// =============================================================================

/**
 * Project vectors onto their top-2 principal components.
 *
 * Mean-centers, then runs power iteration on the (implicit) covariance matrix;
 * the second component is found by Gram-Schmidt deflation against the first at
 * every iteration. Randomness (starting vectors) comes from `rand`.
 */
export function pcaProject2(vectors: number[][], rand: () => number): number[][] {
  const n = vectors.length;
  if (n === 0) return [];
  const dims = vectors[0].length;

  // Mean-center
  const mean = new Array<number>(dims).fill(0);
  for (const v of vectors) {
    for (let d = 0; d < dims; d++) mean[d] += v[d];
  }
  for (let d = 0; d < dims; d++) mean[d] /= n;
  const centered = vectors.map((v) => v.map((x, d) => x - mean[d]));

  const iterations = 50;

  function powerComponent(orthogonalTo: number[] | null): number[] {
    let w = new Array<number>(dims);
    for (let d = 0; d < dims; d++) w[d] = rand() - 0.5;
    normalizeInPlace(w);
    for (let it = 0; it < iterations; it++) {
      // w' = X^T (X w)  — one covariance power step without materializing X^T X
      const next = new Array<number>(dims).fill(0);
      for (const row of centered) {
        const proj = dot(row, w);
        for (let d = 0; d < dims; d++) next[d] += proj * row[d];
      }
      if (orthogonalTo) {
        const overlap = dot(next, orthogonalTo);
        for (let d = 0; d < dims; d++) next[d] -= overlap * orthogonalTo[d];
      }
      const mag = norm(next);
      if (mag < 1e-12) break; // degenerate direction — keep previous w
      for (let d = 0; d < dims; d++) next[d] /= mag;
      w = next;
    }
    return w;
  }

  const w1 = powerComponent(null);
  const w2 = powerComponent(w1);
  return centered.map((row) => [dot(row, w1), dot(row, w2)]);
}

// =============================================================================
// t-SNE (exact O(P^2), P <= 500)
// =============================================================================

export interface Tsne2dOptions {
  seed: number;
  perplexity?: number;
  iterations?: number;
}

/**
 * Compute per-row conditional probabilities p(j|i) by binary-searching the
 * Gaussian precision beta_i so each row hits the target perplexity.
 */
function conditionalProbabilities(
  d2: number[][],
  perplexity: number,
): number[][] {
  const n = d2.length;
  const logU = Math.log(perplexity);
  const P = Array.from({ length: n }, () => new Array<number>(n).fill(0));

  for (let i = 0; i < n; i++) {
    let betaMin = -Infinity;
    let betaMax = Infinity;
    let beta = 1;

    for (let attempt = 0; attempt < 50; attempt++) {
      // Compute entropy H and row probabilities at current beta
      let sum = 0;
      for (let j = 0; j < n; j++) {
        if (j === i) { P[i][j] = 0; continue; }
        const p = Math.exp(-beta * d2[i][j]);
        P[i][j] = p;
        sum += p;
      }
      if (sum <= 0) sum = 1e-12;
      let H = 0;
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const p = P[i][j] / sum;
        P[i][j] = p;
        if (p > 1e-12) H -= p * Math.log(p);
      }

      const diff = H - logU;
      if (Math.abs(diff) < 1e-5) break;
      if (diff > 0) {
        betaMin = beta;
        beta = betaMax === Infinity ? beta * 2 : (beta + betaMax) / 2;
      } else {
        betaMax = beta;
        beta = betaMin === -Infinity ? beta / 2 : (beta + betaMin) / 2;
      }
    }
  }

  return P;
}

/**
 * Deterministic 2-D t-SNE. All randomness comes from mulberry32(opts.seed):
 * PCA init starting vectors and the degenerate-init jitter. Gradient descent
 * itself is deterministic.
 *
 * Defaults: perplexity = min(30, max(2, floor((P-1)/3))), 300 iterations,
 * learning rate 200, early exaggeration x4 for the first 50 iterations,
 * momentum 0.5 switching to 0.8 at iteration 250.
 *
 * P < 3 is skipped entirely: points are spread on a fixed diagonal.
 */
export function tsne2d(vectors: number[][], opts: Tsne2dOptions): number[][] {
  const n = vectors.length;
  if (n === 0) return [];
  if (n < 3) {
    // Fixed diagonal spread — min-max normalization downstream maps this to
    // the [0,1] diagonal.
    return vectors.map((_, i) => [i, i]);
  }

  const rand = mulberry32(opts.seed);
  const iterations = opts.iterations ?? 300;
  const perplexity = opts.perplexity ?? Math.min(30, Math.max(2, Math.floor((n - 1) / 3)));

  // Pairwise squared distances in the input space
  const d2 = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = squaredDistance(vectors[i], vectors[j]);
      d2[i][j] = d;
      d2[j][i] = d;
    }
  }

  // Symmetrized joint probabilities
  const cond = conditionalProbabilities(d2, perplexity);
  const P = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      P[i][j] = Math.max((cond[i][j] + cond[j][i]) / (2 * n), 1e-12);
    }
  }

  // PCA init scaled so the embedding starts tiny (std ~1e-4), per the
  // reference implementation.
  const init = pcaProject2(vectors, rand);
  let mag = 0;
  for (const [x, y] of init) mag += x * x + y * y;
  const std = Math.sqrt(mag / (2 * n));
  const scale = std > 1e-12 ? 1e-4 / std : 0;
  const Y = init.map(([x, y]) =>
    std > 1e-12
      ? [x * scale, y * scale]
      : [(rand() - 0.5) * 1e-4, (rand() - 0.5) * 1e-4],
  );

  const velocity = Array.from({ length: n }, () => [0, 0]);
  const gains = Array.from({ length: n }, () => [1, 1]);
  const learningRate = 200;
  const earlyExaggeration = 4;
  const earlyExaggerationIters = 50;
  const momentumSwitchIter = 250;

  const qNum = Array.from({ length: n }, () => new Array<number>(n).fill(0));

  for (let iter = 0; iter < iterations; iter++) {
    const exaggeration = iter < earlyExaggerationIters ? earlyExaggeration : 1;
    const momentum = iter < momentumSwitchIter ? 0.5 : 0.8;

    // Student-t numerators and normalizer
    let Z = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = Y[i][0] - Y[j][0];
        const dy = Y[i][1] - Y[j][1];
        const num = 1 / (1 + dx * dx + dy * dy);
        qNum[i][j] = num;
        qNum[j][i] = num;
        Z += 2 * num;
      }
    }
    if (Z <= 0) Z = 1e-12;

    // Compute ALL gradients against a consistent snapshot of Y first, then
    // apply updates. Updating Y[i] inside the gradient loop would let each
    // point's step feed into the next point's gradient within the same
    // iteration — a cascading amplification that blows the embedding up.
    const gradients: number[][] = new Array(n);
    for (let i = 0; i < n; i++) {
      let gradX = 0;
      let gradY = 0;
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const num = qNum[i][j];
        const q = Math.max(num / Z, 1e-12);
        const mult = (exaggeration * P[i][j] - q) * num;
        gradX += 4 * mult * (Y[i][0] - Y[j][0]);
        gradY += 4 * mult * (Y[i][1] - Y[j][1]);
      }
      gradients[i] = [gradX, gradY];
    }

    // Momentum update with per-coordinate adaptive gains
    for (let i = 0; i < n; i++) {
      for (let d = 0; d < 2; d++) {
        const sameSign = Math.sign(gradients[i][d]) === Math.sign(velocity[i][d]);
        gains[i][d] = Math.max(0.01, sameSign ? gains[i][d] * 0.8 : gains[i][d] + 0.2);
        velocity[i][d] = momentum * velocity[i][d] - learningRate * gains[i][d] * gradients[i][d];
        Y[i][d] += velocity[i][d];
      }
    }

    // Recenter
    let meanX = 0;
    let meanY = 0;
    for (const [x, y] of Y) { meanX += x; meanY += y; }
    meanX /= n;
    meanY /= n;
    for (const p of Y) { p[0] -= meanX; p[1] -= meanY; }
  }

  return Y;
}

// =============================================================================
// k-means (k-means++ init, full-dimensional)
// =============================================================================

export interface KmeansResult {
  assignments: number[];
  centroids: number[][];
}

/**
 * Lloyd's k-means with k-means++ seeded initialization. Runs on the FULL
 * input dimensionality (the galaxy clusters 384-dim embeddings, never the 2-D
 * projection). Max 100 iterations; empty clusters are re-seeded with the point
 * farthest from its centroid.
 */
export function kmeans(vectors: number[][], k: number, rand: () => number): KmeansResult {
  const n = vectors.length;
  if (n === 0) return { assignments: [], centroids: [] };
  const effectiveK = Math.max(1, Math.min(k, n));
  const dims = vectors[0].length;

  // --- k-means++ init ---
  const centroids: number[][] = [];
  const firstIdx = Math.min(n - 1, Math.floor(rand() * n));
  centroids.push(vectors[firstIdx].slice());
  const minD2 = new Array<number>(n).fill(Infinity);
  while (centroids.length < effectiveK) {
    const latest = centroids[centroids.length - 1];
    let total = 0;
    for (let i = 0; i < n; i++) {
      const d = squaredDistance(vectors[i], latest);
      if (d < minD2[i]) minD2[i] = d;
      total += minD2[i];
    }
    let nextIdx = 0;
    if (total <= 0) {
      // All points coincide with a centroid — pick uniformly.
      nextIdx = Math.min(n - 1, Math.floor(rand() * n));
    } else {
      let threshold = rand() * total;
      for (let i = 0; i < n; i++) {
        threshold -= minD2[i];
        if (threshold <= 0) { nextIdx = i; break; }
        nextIdx = i;
      }
    }
    centroids.push(vectors[nextIdx].slice());
  }

  // --- Lloyd iterations ---
  const assignments = new Array<number>(n).fill(0);
  for (let iter = 0; iter < 100; iter++) {
    let changed = false;
    for (let i = 0; i < n; i++) {
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < effectiveK; c++) {
        const d = squaredDistance(vectors[i], centroids[c]);
        if (d < bestD) { bestD = d; best = c; }
      }
      if (assignments[i] !== best) { assignments[i] = best; changed = true; }
    }

    // Recompute centroids
    const counts = new Array<number>(effectiveK).fill(0);
    const sums = Array.from({ length: effectiveK }, () => new Array<number>(dims).fill(0));
    for (let i = 0; i < n; i++) {
      const c = assignments[i];
      counts[c] += 1;
      for (let d = 0; d < dims; d++) sums[c][d] += vectors[i][d];
    }
    for (let c = 0; c < effectiveK; c++) {
      if (counts[c] === 0) {
        // Empty cluster: reseed at the point farthest from its own centroid.
        let farIdx = 0;
        let farD = -1;
        for (let i = 0; i < n; i++) {
          const d = squaredDistance(vectors[i], centroids[assignments[i]]);
          if (d > farD) { farD = d; farIdx = i; }
        }
        centroids[c] = vectors[farIdx].slice();
        assignments[farIdx] = c;
        changed = true;
      } else {
        for (let d = 0; d < dims; d++) centroids[c][d] = sums[c][d] / counts[c];
      }
    }

    if (!changed) break;
  }

  return { assignments, centroids };
}

// =============================================================================
// Silhouette + k selection
// =============================================================================

/**
 * Mean silhouette coefficient over all points. O(P^2), fine for P <= 500.
 * Single-member clusters contribute 0 (the standard convention); a single
 * cluster overall scores 0.
 */
export function silhouetteScore(vectors: number[][], assignments: number[]): number {
  const n = vectors.length;
  if (n === 0) return 0;
  const clusterIds = [...new Set(assignments)];
  if (clusterIds.length < 2) return 0;

  const members = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const c = assignments[i];
    let arr = members.get(c);
    if (!arr) { arr = []; members.set(c, arr); }
    arr.push(i);
  }

  let total = 0;
  for (let i = 0; i < n; i++) {
    const own = members.get(assignments[i])!;
    if (own.length <= 1) continue; // s(i) = 0 for singleton clusters

    let a = 0;
    for (const j of own) {
      if (j === i) continue;
      a += Math.sqrt(squaredDistance(vectors[i], vectors[j]));
    }
    a /= own.length - 1;

    let b = Infinity;
    for (const c of clusterIds) {
      if (c === assignments[i]) continue;
      const other = members.get(c)!;
      let sum = 0;
      for (const j of other) sum += Math.sqrt(squaredDistance(vectors[i], vectors[j]));
      const mean = sum / other.length;
      if (mean < b) b = mean;
    }

    const denom = Math.max(a, b);
    if (denom > 0) total += (b - a) / denom;
  }

  return total / n;
}

export interface ChooseKResult {
  k: number;
  assignments: number[];
}

/**
 * Pick k by best silhouette over k in 2..min(8, P-1). P < 4 → a single
 * cluster (silhouette is uninformative on tiny sets).
 */
export function chooseK(vectors: number[][], rand: () => number): ChooseKResult {
  const n = vectors.length;
  if (n === 0) return { k: 0, assignments: [] };
  if (n < 4) return { k: 1, assignments: new Array<number>(n).fill(0) };

  const maxK = Math.min(8, n - 1);
  let bestK = 1;
  let bestScore = -Infinity;
  let bestAssignments = new Array<number>(n).fill(0);

  for (let k = 2; k <= maxK; k++) {
    const { assignments } = kmeans(vectors, k, rand);
    const score = silhouetteScore(vectors, assignments);
    if (score > bestScore) {
      bestScore = score;
      bestK = k;
      bestAssignments = assignments;
    }
  }

  return { k: bestK, assignments: bestAssignments };
}

// =============================================================================
// Coordinate normalization
// =============================================================================

/**
 * Min-max normalize 2-D coordinates to [0, 1] per axis. A degenerate axis
 * (zero range) collapses to 0.5 so the points still land on the map.
 */
export function minMaxNormalize2d(coords: number[][]): number[][] {
  if (coords.length === 0) return [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of coords) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const rangeX = maxX - minX;
  const rangeY = maxY - minY;
  return coords.map(([x, y]) => [
    rangeX > 0 ? (x - minX) / rangeX : 0.5,
    rangeY > 0 ? (y - minY) / rangeY : 0.5,
  ]);
}

// =============================================================================
// Token estimate
// =============================================================================

/**
 * chars/4 token estimate. Replicated here on purpose: lib/spawner.ts has a
 * module-private copy that is NOT exported, and modifying spawner.ts would drag
 * it into every lane's diff.
 */
export function estimateTokensFromText(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

// =============================================================================
// Cluster term labels via mutual information
// =============================================================================

export interface ClusterTerm {
  term: string;
  mi: number;
}

const TOKEN_SPLIT = /[^a-z0-9_-]+/;
const PURE_NUMBER = /^[0-9]+$/;

/**
 * Doc → set of terms (unigrams + adjacent bigrams). Tokens are lowercased,
 * split on non [a-z0-9_-] runs, and must be >= 3 chars and not pure numbers.
 */
function docTermSet(doc: string): Set<string> {
  const tokens = doc
    .toLowerCase()
    .split(TOKEN_SPLIT)
    .filter((t) => t.length >= 3 && !PURE_NUMBER.test(t));
  const terms = new Set<string>(tokens);
  for (let i = 0; i + 1 < tokens.length; i++) {
    terms.add(`${tokens[i]} ${tokens[i + 1]}`);
  }
  return terms;
}

/**
 * Statistical cluster descriptors: for each cluster, the top 5 terms by mutual
 * information I(term-presence; cluster-membership) over the 2x2 contingency
 * table with +0.5 Laplace smoothing, restricted to terms that appear in >= 2
 * documents and are POSITIVELY associated with the cluster (present more often
 * inside than outside — MI is symmetric, and an anti-associated term would be
 * a misleading label).
 *
 * This is computed statistics over the actual document texts — never a curated
 * keyword list.
 *
 * k === 1 fallback: MI is undefined with one class, so terms fall back to
 * top-5 document frequency (the `mi` field then carries the doc count).
 */
export function clusterTerms(
  docs: string[],
  assignments: number[],
  k: number,
): ClusterTerm[][] {
  const n = docs.length;
  if (n === 0 || k <= 0) return Array.from({ length: Math.max(0, k) }, () => []);

  const termSets = docs.map(docTermSet);

  // Document frequency; keep terms in >= 2 docs
  const df = new Map<string, number>();
  for (const set of termSets) {
    for (const term of set) df.set(term, (df.get(term) ?? 0) + 1);
  }
  const eligible = new Set<string>();
  for (const [term, count] of df) {
    if (count >= 2) eligible.add(term);
  }

  if (k === 1) {
    const top = [...eligible]
      .map((term) => ({ term, mi: df.get(term) ?? 0 }))
      .sort((a, b) => b.mi - a.mi || a.term.localeCompare(b.term))
      .slice(0, 5);
    return [top];
  }

  // Per-cluster present counts
  const clusterSizes = new Array<number>(k).fill(0);
  for (const c of assignments) {
    if (c >= 0 && c < k) clusterSizes[c] += 1;
  }
  const presentInCluster: Array<Map<string, number>> = Array.from({ length: k }, () => new Map());
  for (let i = 0; i < n; i++) {
    const c = assignments[i];
    if (c < 0 || c >= k) continue;
    const map = presentInCluster[c];
    for (const term of termSets[i]) {
      if (eligible.has(term)) map.set(term, (map.get(term) ?? 0) + 1);
    }
  }

  const results: ClusterTerm[][] = [];
  for (let c = 0; c < k; c++) {
    const inC = clusterSizes[c];
    const outC = n - inC;
    const scored: ClusterTerm[] = [];
    for (const term of eligible) {
      const n11 = presentInCluster[c].get(term) ?? 0; // present, in cluster
      const present = df.get(term) ?? 0;
      const n10 = present - n11;                       // present, outside
      const n01 = inC - n11;                           // absent, in cluster
      const n00 = outC - n10;                          // absent, outside

      // Positive association filter: p(t|c) must exceed p(t|not c)
      const rateIn = inC > 0 ? n11 / inC : 0;
      const rateOut = outC > 0 ? n10 / outC : 0;
      if (n11 === 0 || rateIn <= rateOut) continue;

      // MI over the 2x2 table with +0.5 Laplace smoothing (nats)
      const N = n + 2;
      const cells = [
        { joint: n11 + 0.5, pT: present + 1, pC: inC + 1 },
        { joint: n10 + 0.5, pT: present + 1, pC: outC + 1 },
        { joint: n01 + 0.5, pT: n - present + 1, pC: inC + 1 },
        { joint: n00 + 0.5, pT: n - present + 1, pC: outC + 1 },
      ];
      let mi = 0;
      for (const { joint, pT, pC } of cells) {
        const pJoint = joint / N;
        mi += pJoint * Math.log((pJoint * N * N) / (pT * pC));
      }
      scored.push({ term, mi });
    }
    scored.sort((a, b) => b.mi - a.mi || a.term.localeCompare(b.term));
    results.push(scored.slice(0, 5));
  }

  return results;
}
