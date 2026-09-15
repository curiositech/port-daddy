#!/usr/bin/env node
/**
 * Random-Surfer Reader Model.
 *
 * Generalises PageRank's random surfer (Brin & Page, 1998) from a hyperlink
 * graph to a *reading/interaction* graph, so the same machinery audits a web
 * flow, a wireframe, a PDF report, or a LaTeX book.
 *
 * The classic surfer has two behaviours: follow a link, or teleport. A reader
 * has four, and the extra two are where documents actually fail:
 *
 *   1. CONTINUE  - move forward along a link (next section, next screen).
 *   2. REGRESS   - jump *backwards* to find a definition they needed and did
 *                  not have. Regressive saccades are ~10-15% of saccades in
 *                  fluent reading (Rayner, 1998) and climb steeply with
 *                  comprehension difficulty. This is the term that makes
 *                  "unintroduced ideas" cost something measurable.
 *   3. TELEPORT  - jump to an arbitrary node (skim, flip to the figures, use
 *                  the index, click nav). This is PageRank's damping term.
 *   4. ABANDON   - stop. An absorbing state. This is the whole point.
 *
 * The chain is therefore an ABSORBING Markov chain over {nodes} + {DONE,
 * ABANDON}, and every readout below is exact linear algebra on the
 * fundamental matrix N = (I - Q)^-1, not a sampled simulation. Same input,
 * same numbers, every time.
 *
 * WHAT THIS SCRIPT DOES NOT DO: it never reads prose, images, or a URL. Every
 * input is a number, a boolean, or an explicit concept label that the analyst
 * decided while reading the surface. No keyword lists, no substring matching,
 * no lexical classification of unstructured content. The judgement is the
 * analyst's; the arithmetic is the script's.
 *
 * Model documentation: references/random-surfer-reader.md
 * Input schema:        schemas/surface-graph.schema.json
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Calibration constants.
//
// These are PRIORS, not measurements. They are set so that the model's
// qualitative behaviour matches things we do have evidence for (working-memory
// limits, regression rates, the fact that skimmers abandon faster than
// studiers). Treat a surfer readout as a RANKING of where a surface hurts,
// not as a predicted conversion rate. Recalibrate against real telemetry
// before quoting an absolute number to anyone. See the calibration section of
// references/random-surfer-reader.md.
// ---------------------------------------------------------------------------

/**
 * Reader modes are not a separate model - they are parameter presets on the
 * same chain. A skimmer is a surfer with a high teleport rate, little patience
 * for regression, and high sensitivity to payoff. A student is the opposite.
 * Run the same graph in several modes: a book that only survives `study` has
 * an acquisition problem, because nobody starts in `study` mode.
 */
export const READER_MODES = {
  // Flipping through to decide whether to invest at all. Keshav pass 1.
  skim: { teleport: 0.35, baseAbandon: 0.10, baseRegression: 0.02, payoffWeight: 0.10, hookWeight: 0.08 },
  // Hunting for one specific answer. Ctrl-F with eyes.
  scan: { teleport: 0.25, baseAbandon: 0.08, baseRegression: 0.05, payoffWeight: 0.10, hookWeight: 0.06 },
  // Committed linear reading, willing to re-read. Keshav pass 3.
  study: { teleport: 0.02, baseAbandon: 0.03, baseRegression: 0.22, payoffWeight: 0.04, hookWeight: 0.03 },
  // Driving a UI toward a goal. Abandons fast, teleports little.
  task: { teleport: 0.05, baseAbandon: 0.12, baseRegression: 0.10, payoffWeight: 0.12, hookWeight: 0.06 },
};

const WORKING_SET_LIMIT = 4;            // Cowan (2001): ~4 chunks, not Miller's 7
const WORKING_SET_WINDOW = 3;           // default nodes back whose new ideas are still "in play"
                                        // Override per graph with `workingSetWindowNodes`. This
                                        // window is counted in NODES, so node granularity matters:
                                        // size a node to one reading sitting (a section, a screen,
                                        // a page spread), not a whole chapter. Chapter-sized nodes
                                        // will overstate the working set and over-report overflow.
const DANGLING_SATURATION = 3;          // 3 never-introduced prerequisites saturates the term
const NEW_CONCEPT_RATE_SATURATION = 4;  // new concepts per minute that saturates the term
const ATTENTION_LIMIT = 4;              // simultaneous attention elements, per SKILL.md quality gates
const LOAD_WEIGHT = 0.35;               // how much comprehension load raises the abandon hazard
const PERCEPT_WEIGHT = 0.20;            // how much Gestalt/perceptual load raises it
const REGRESSION_DISTANCE_WEIGHT = 0.30;// how much far-away prerequisites pull the eye backwards
const MIN_HAZARD = 0.005;               // keeps the chain absorbing (and invertible)
const MAX_HAZARD = 0.85;
const MAX_REGRESSION = 0.60;
const ENTROPY_CLIFF_DELTA = 0.35;       // load jump vs. the previous node that reads as a wall

// Finding thresholds.
const MIN_COMPLETION = 0.35;            // below this, the surface loses most arrivals
const MIN_PAYOFF_REACH = 0.50;          // below this, most readers never see the point
const MAX_REGRESSIONS_PER_NODE = 0.25;  // above this, the reader is re-reading, not reading
const BURIED_PAYOFF_ATTENTION = 0.02;   // payoff node holding <2% of reading time is buried

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clamp(value, lo, hi) {
  return Math.min(hi, Math.max(lo, value));
}

function num(value, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Gauss-Jordan inversion with partial pivoting. Throws on a singular matrix. */
function invert(matrix) {
  const n = matrix.length;
  const a = matrix.map((row, i) => [
    ...row,
    ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  ]);

  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    }
    if (Math.abs(a[pivot][col]) < 1e-12) {
      throw new Error(
        `surfer chain is not absorbing: node index ${col} has no path to DONE or ABANDON. ` +
          'Every node needs either an outgoing link, a terminal position, or a non-zero abandon hazard.'
      );
    }
    [a[col], a[pivot]] = [a[pivot], a[col]];

    const d = a[col][col];
    for (let j = 0; j < 2 * n; j += 1) a[col][j] /= d;

    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const factor = a[row][col];
      if (factor === 0) continue;
      for (let j = 0; j < 2 * n; j += 1) a[row][j] -= factor * a[col][j];
    }
  }

  return a.map((row) => row.slice(n));
}

/**
 * Per-node comprehension load in [0,1] - the "is this bombarding me" term.
 *
 * Three additive pressures, each saturating:
 *   - dangling prerequisites: concepts this node leans on that the document
 *     never introduced, or introduces only LATER (a forward reference).
 *   - new-concept rate: ideas per minute of reading. Above the saturation
 *     rate the reader is transcribing, not understanding.
 *   - working-set overflow: distinct new ideas across the last few nodes that
 *     are still in play, measured against Cowan's ~4-chunk limit.
 */
function comprehensionLoad({ danglingCount, newConceptRate, workingSet }) {
  const dangling = clamp(danglingCount / DANGLING_SATURATION, 0, 1);
  const rate = clamp(newConceptRate / NEW_CONCEPT_RATE_SATURATION, 0, 1);
  const overflow = clamp(Math.max(0, workingSet - WORKING_SET_LIMIT) / WORKING_SET_LIMIT, 0, 1);
  return clamp(0.45 * dangling + 0.35 * rate + 0.20 * overflow, 0, 1);
}

/**
 * Per-node perceptual load in [0,1] - the Gestalt term.
 *
 * `groupingClarity` and `figureGroundClarity` are the analyst's 0-10 judgement
 * of whether the node's elements form the groups the content actually has, and
 * whether the primary thing separates from its background. Weak grouping means
 * the eye has to do the segmentation work the layout should have done.
 */
function perceptualLoad(node) {
  const gestalt = isPlainObject(node.gestalt) ? node.gestalt : {};
  const grouping = clamp(num(gestalt.groupingClarity, 10), 0, 10);
  const figureGround = clamp(num(gestalt.figureGroundClarity, 10), 0, 10);
  const elements = Math.max(0, num(node.attentionElements, 0));
  const crowding = clamp(Math.max(0, elements - ATTENTION_LIMIT) / ATTENTION_LIMIT, 0, 1);
  return clamp(
    0.35 * (1 - grouping / 10) + 0.25 * (1 - figureGround / 10) + 0.40 * crowding,
    0,
    1
  );
}

/**
 * Expected reading seconds before FIRST reaching `target`, counted only over
 * the paths that actually get there - the "time to first insight" metric.
 *
 * Done exactly, not by sampling: make `target` absorbing, compute h[i] =
 * P(ever reach target | start at i), then run Doob's h-transform to get the
 * chain conditioned on reaching it, and read the expected absorption time off
 * that conditioned chain's fundamental matrix. `target`'s own reading cost is
 * excluded, so this answers "how long until they arrive", not "until they
 * finish it".
 *
 * Returns null when the target is unreachable from every entry point.
 */
function expectedTimeToFirstReach(Q, costs, alpha, target) {
  const n = Q.length;
  const others = [];
  for (let i = 0; i < n; i += 1) if (i !== target) others.push(i);
  if (others.length === 0) return 0;

  // Q' with `target` absorbing, restricted to the non-target states.
  const sub = others.map((i) => others.map((j) => (i === target ? 0 : Q[i][j])));
  const toTarget = others.map((i) => Q[i][target]);
  const ImQ = sub.map((row, i) => row.map((v, j) => (i === j ? 1 : 0) - v));
  const Nsub = invert(ImQ);

  // h over the non-target states; h[target] = 1 by definition.
  const h = new Array(n).fill(0);
  h[target] = 1;
  others.forEach((state, i) => {
    let acc = 0;
    for (let k = 0; k < others.length; k += 1) acc += Nsub[i][k] * toTarget[k];
    h[state] = clamp(acc, 0, 1);
  });

  const reachMass = alpha.reduce((s, a, i) => s + a * h[i], 0);
  if (reachMass <= 1e-12) return null;

  // Conditioned chain over the states that can still reach the target.
  const live = others.filter((state) => h[state] > 1e-12);
  if (live.length === 0) return 0;
  const tilde = live.map((i) => live.map((j) => (Q[i][j] * h[j]) / h[i]));
  const ImT = tilde.map((row, i) => row.map((v, j) => (i === j ? 1 : 0) - v));
  const Ntilde = invert(ImT);

  // Re-weight the entry distribution by h: conditioning changes who is left.
  const time = live.map((_state, i) => {
    let acc = 0;
    for (let k = 0; k < live.length; k += 1) acc += Ntilde[i][k] * costs[live[k]];
    return acc;
  });

  let total = 0;
  live.forEach((state, i) => {
    total += ((alpha[state] * h[state]) / reachMass) * time[i];
  });
  // An entry point that IS the target contributes zero waiting time.
  return total;
}

/**
 * Run the random-surfer reader model over a surface graph.
 *
 * @param {unknown} graph - parsed JSON matching schemas/surface-graph.schema.json
 * @returns {{pass: boolean, findings: Array<{id: string, severity: string, message: string}>,
 *            recommendations: string[], readout: object}}
 */
export function simulateSurfer(graph) {
  if (!isPlainObject(graph)) {
    throw new Error('graph must be a JSON object');
  }
  if (!Array.isArray(graph.nodes) || graph.nodes.length === 0) {
    throw new Error('graph.nodes must be a non-empty array');
  }

  const modeName = typeof graph.readerMode === 'string' ? graph.readerMode : 'task';
  const mode = READER_MODES[modeName];
  if (!mode) {
    throw new Error(`graph.readerMode must be one of: ${Object.keys(READER_MODES).join(', ')}`);
  }

  const workingSetWindow = Math.max(1, Math.round(num(graph.workingSetWindowNodes, WORKING_SET_WINDOW)));

  const nodes = graph.nodes;
  const n = nodes.length;
  const index = new Map();
  nodes.forEach((node, i) => {
    if (!isPlainObject(node) || typeof node.id !== 'string' || node.id.trim() === '') {
      throw new Error(`graph.nodes[${i}] must have a non-empty string "id"`);
    }
    if (index.has(node.id)) throw new Error(`duplicate node id: ${node.id}`);
    index.set(node.id, i);
  });

  const resolveId = (id, field) => {
    if (!index.has(id)) throw new Error(`${field} references unknown node id: ${id}`);
    return index.get(id);
  };

  // --- Concept bookkeeping: who introduces what, and when ------------------
  const introducedAt = new Map();
  nodes.forEach((node, i) => {
    for (const concept of node.newConcepts ?? []) {
      if (!introducedAt.has(concept)) introducedAt.set(concept, i);
    }
  });

  // --- Per-node loads, hazards, and regression pull ------------------------
  const perNode = nodes.map((node, i) => {
    const costSeconds = Math.max(0, num(node.costSeconds, 30));
    const costMinutes = Math.max(costSeconds / 60, 0.25);
    const requires = node.requiresConcepts ?? [];

    const undefinedConcepts = [];   // never introduced anywhere in the document
    const forwardRefs = [];         // introduced, but only later than this node
    const backDistances = [];       // introduced earlier: how far back?

    for (const concept of requires) {
      const at = introducedAt.get(concept);
      if (at === undefined) undefinedConcepts.push(concept);
      else if (at > i) forwardRefs.push(concept);
      else if (at < i) backDistances.push(i - at);
    }

    const danglingCount = undefinedConcepts.length + forwardRefs.length;
    const newConceptRate = (node.newConcepts?.length ?? 0) / costMinutes;

    const windowStart = Math.max(0, i - workingSetWindow + 1);
    const windowConcepts = new Set();
    for (let k = windowStart; k <= i; k += 1) {
      for (const concept of nodes[k].newConcepts ?? []) windowConcepts.add(concept);
    }

    const load = comprehensionLoad({
      danglingCount,
      newConceptRate,
      workingSet: windowConcepts.size,
    });
    const percept = perceptualLoad(node);

    const payoff = clamp(num(node.payoff, 0), 0, 1);
    const hook = clamp(num(node.hook, 0), 0, 1);

    const hazard = clamp(
      mode.baseAbandon +
        LOAD_WEIGHT * load +
        PERCEPT_WEIGHT * percept -
        mode.hookWeight * hook -
        mode.payoffWeight * payoff,
      MIN_HAZARD,
      MAX_HAZARD
    );

    // Regression pull: the further back the needed definition sits, the more
    // often the reader goes looking for it instead of reading on.
    const meanBackDistance = backDistances.length
      ? backDistances.reduce((s, d) => s + d, 0) / backDistances.length
      : 0;
    const normalisedDistance = clamp(meanBackDistance / Math.max(1, n - 1), 0, 1);
    const regression = clamp(
      mode.baseRegression + REGRESSION_DISTANCE_WEIGHT * normalisedDistance * (backDistances.length ? 1 : 0),
      0,
      MAX_REGRESSION
    );

    return {
      id: node.id,
      label: typeof node.label === 'string' ? node.label : node.id,
      costSeconds,
      load,
      percept,
      payoff,
      hook,
      hazard,
      regression,
      undefinedConcepts,
      forwardRefs,
      backDistances,
      workingSet: windowConcepts.size,
      newConceptRate,
      attentionElements: Math.max(0, num(node.attentionElements, 0)),
    };
  });

  // --- Build the transition matrix -----------------------------------------
  const Q = Array.from({ length: n }, () => new Array(n).fill(0));
  const toDone = new Array(n).fill(0);

  nodes.forEach((node, i) => {
    const info = perNode[i];
    const links = Array.isArray(node.links) ? node.links : [];
    const validLinks = links.filter((l) => isPlainObject(l) && typeof l.to === 'string');
    for (const link of validLinks) resolveId(link.to, `graph.nodes[${i}].links[].to`);

    // Regression targets: the earlier nodes that introduced concepts this node
    // needs. No targets means nothing to go back TO, so that pressure is
    // re-expressed as teleporting or giving up rather than as a useful jump.
    const regressionTargets = [];
    for (const concept of node.requiresConcepts ?? []) {
      const at = introducedAt.get(concept);
      if (at !== undefined && at < i) regressionTargets.push(at);
    }

    let hazard = info.hazard;
    let regression = regressionTargets.length ? info.regression : 0;
    let teleport = mode.teleport;

    // Keep the row a probability distribution: if the non-forward terms
    // already exceed 1, scale the discretionary ones (regression, teleport)
    // back proportionally. Hazard is never scaled - giving up wins.
    const discretionary = regression + teleport;
    const room = Math.max(0, 1 - hazard);
    if (discretionary > room && discretionary > 0) {
      const scale = room / discretionary;
      regression *= scale;
      teleport *= scale;
    }
    const forward = Math.max(0, 1 - hazard - regression - teleport);

    if (regression > 0) {
      const share = regression / regressionTargets.length;
      for (const target of regressionTargets) Q[i][target] += share;
    }
    if (teleport > 0) {
      const share = teleport / n;
      for (let j = 0; j < n; j += 1) Q[i][j] += share;
    }

    if (validLinks.length === 0) {
      // A node with no outgoing link is a terminal: reaching its end IS
      // finishing. This is how "read to the last page" becomes P(DONE).
      toDone[i] += forward;
    } else {
      const totalWeight = validLinks.reduce((s, l) => s + Math.max(0, num(l.weight, 1)), 0);
      if (totalWeight <= 0) {
        toDone[i] += forward;
      } else {
        for (const link of validLinks) {
          const w = Math.max(0, num(link.weight, 1)) / totalWeight;
          Q[i][index.get(link.to)] += forward * w;
        }
      }
    }
  });

  // --- Solve the chain -----------------------------------------------------
  const IminusQ = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0) - Q[i][j])
  );
  const N = invert(IminusQ);

  // Entry distribution over nodes.
  const entryIds = Array.isArray(graph.entryNodes) && graph.entryNodes.length > 0
    ? graph.entryNodes
    : [nodes[0].id];
  const alpha = new Array(n).fill(0);
  for (const entry of entryIds) {
    const id = typeof entry === 'string' ? entry : entry?.id;
    const weight = typeof entry === 'string' ? 1 : Math.max(0, num(entry?.weight, 1));
    alpha[resolveId(id, 'graph.entryNodes')] += weight;
  }
  const alphaTotal = alpha.reduce((s, v) => s + v, 0);
  if (alphaTotal <= 0) throw new Error('graph.entryNodes must carry positive total weight');
  for (let i = 0; i < n; i += 1) alpha[i] /= alphaTotal;

  // Expected visits to each node, starting from the entry distribution.
  const expectedVisits = new Array(n).fill(0);
  for (let j = 0; j < n; j += 1) {
    let acc = 0;
    for (let i = 0; i < n; i += 1) acc += alpha[i] * N[i][j];
    expectedVisits[j] = acc;
  }

  // P(ever visit j) = expectedVisits[j] / N[j][j] - exact for absorbing chains.
  const reachProbability = expectedVisits.map((visits, j) => clamp(visits / N[j][j], 0, 1));

  // Attention mass: share of total expected reading TIME, not share of visits.
  const timePerNode = expectedVisits.map((visits, j) => visits * perNode[j].costSeconds);
  const totalTime = timePerNode.reduce((s, v) => s + v, 0);
  const attentionMass = timePerNode.map((t) => (totalTime > 0 ? t / totalTime : 0));

  const completion = clamp(
    expectedVisits.reduce((s, visits, j) => s + visits * toDone[j], 0),
    0,
    1
  );
  const abandonment = clamp(1 - completion, 0, 1);
  const expectedRegressions = expectedVisits.reduce(
    (s, visits, j) => s + visits * perNode[j].regression,
    0
  );
  const totalVisits = expectedVisits.reduce((s, v) => s + v, 0);
  const regressionsPerVisit = totalVisits > 0 ? expectedRegressions / totalVisits : 0;

  // Where the median arrival gives up, walking in reading order.
  let cumulativeAbandon = 0;
  let medianExitNode = null;
  for (let j = 0; j < n; j += 1) {
    cumulativeAbandon += expectedVisits[j] * perNode[j].hazard;
    if (cumulativeAbandon >= 0.5) {
      medianExitNode = { id: perNode[j].id, label: perNode[j].label, index: j };
      break;
    }
  }

  const costs = perNode.map((info) => info.costSeconds);
  const payoffIds = Array.isArray(graph.payoffNodes) ? graph.payoffNodes : [];
  const payoffReach = payoffIds.map((id) => {
    const j = resolveId(id, 'graph.payoffNodes');
    return {
      id,
      label: perNode[j].label,
      reachProbability: reachProbability[j],
      attentionMass: attentionMass[j],
      // Time to first insight: seconds of reading before the readers who DO
      // arrive here arrive. Compare against patienceBudget.seconds.
      expectedSecondsToReach: expectedTimeToFirstReach(Q, costs, alpha, j),
    };
  });

  // Expected seconds of reading before absorption (finish or quit).
  const expectedSecondsBeforeExit = totalTime;

  // --- Reader maps: prescribed routes through the book ---------------------
  //
  // Many technical books open with a "Reader's Map" or "How to read this book":
  // "practitioners read 1, 3, 7, 9; theorists read 1, 2, 4-6." Each route is a
  // promise made to a named kind of reader, and a promise that can be broken
  // in a way the book's linear order hides completely - because the concept
  // the route needs was introduced in a chapter the route skips.
  //
  // Each path is evaluated as its own surface: the same chain, restricted to
  // the prescribed nodes in the prescribed order. Everything the model already
  // knows then applies along the route, per persona.
  const readerPathSpecs = Array.isArray(graph.readerPaths) ? graph.readerPaths : [];
  const readerPaths = readerPathSpecs.map((spec, specIndex) => {
    if (!isPlainObject(spec) || !Array.isArray(spec.nodes) || spec.nodes.length === 0) {
      throw new Error(`graph.readerPaths[${specIndex}] must have a non-empty "nodes" array`);
    }
    const pathId = typeof spec.id === 'string' && spec.id.trim() !== '' ? spec.id : `path-${specIndex + 1}`;
    const pathLabel = typeof spec.label === 'string' && spec.label.trim() !== '' ? spec.label : pathId;
    const indices = spec.nodes.map((id) => resolveId(id, `graph.readerPaths[${specIndex}].nodes`));

    // Which prerequisites does this ROUTE satisfy, in the order it prescribes?
    const introducedOnPath = new Set();
    const brokenByMap = [];
    indices.forEach((nodeIndex, step) => {
      const node = nodes[nodeIndex];
      for (const concept of node.requiresConcepts ?? []) {
        if (introducedOnPath.has(concept)) continue;
        const bookIntroducedAt = introducedAt.get(concept);
        // Only a concept the BOOK does introduce, that this ROUTE skips past,
        // is a broken map. A concept nothing introduces is a book-wide defect
        // and is already reported as such.
        if (bookIntroducedAt !== undefined && !indices.slice(0, step).includes(bookIntroducedAt)) {
          brokenByMap.push({
            concept,
            neededAt: { id: node.id, label: perNode[nodeIndex].label },
            introducedIn: { id: nodes[bookIntroducedAt].id, label: perNode[bookIntroducedAt].label },
          });
        }
      }
      for (const concept of node.newConcepts ?? []) introducedOnPath.add(concept);
    });

    // The route as its own surface: prescribed nodes, prescribed order.
    const pathPayoffs = Array.isArray(spec.payoffNodes)
      ? spec.payoffNodes
      : (Array.isArray(graph.payoffNodes) ? graph.payoffNodes : []).filter((id) =>
          indices.includes(index.get(id))
        );
    const subGraph = {
      surfaceKind: graph.surfaceKind,
      readerMode: typeof spec.readerMode === 'string' ? spec.readerMode : modeName,
      workingSetWindowNodes: workingSetWindow,
      entryNodes: [nodes[indices[0]].id],
      payoffNodes: pathPayoffs,
      ...(spec.patienceBudgetSeconds > 0
        ? { patienceBudget: { seconds: spec.patienceBudgetSeconds } }
        : isPlainObject(graph.patienceBudget)
          ? { patienceBudget: graph.patienceBudget }
          : {}),
      nodes: indices.map((nodeIndex, step) => ({
        ...nodes[nodeIndex],
        links:
          step + 1 < indices.length
            ? [{ to: nodes[indices[step + 1]].id, kind: 'sequential', weight: 1 }]
            : [],
      })),
    };
    const report = simulateSurfer(subGraph);

    return {
      id: pathId,
      label: pathLabel,
      persona: typeof spec.persona === 'string' ? spec.persona : null,
      nodes: indices.map((i) => nodes[i].id),
      skipped: nodes.filter((_n, i) => !indices.includes(i)).map((n) => n.id),
      brokenByMap,
      payoffNodes: pathPayoffs,
      report,
    };
  });

  // --- Findings ------------------------------------------------------------
  const findings = [];
  const recommendations = [];
  let gatingHit = false;

  function flag(id, severity, message, recommendation, { gating = false } = {}) {
    findings.push({ id, severity, message });
    if (recommendation) recommendations.push(recommendation);
    if (gating) gatingHit = true;
  }

  if (completion < MIN_COMPLETION) {
    flag(
      'surfer-completion-collapse',
      completion < MIN_COMPLETION / 2 ? 'critical' : 'high',
      `Only ${(completion * 100).toFixed(0)}% of arrivals reach the end in "${modeName}" mode (floor: ${(MIN_COMPLETION * 100).toFixed(0)}%).`,
      medianExitNode
        ? `The median arrival quits at "${medianExitNode.label}". Fix that node's load, hook, or payoff before touching anything downstream of it - nobody downstream is being read.`
        : 'Reduce per-node abandon hazard: lower comprehension load, add hooks, or move payoff earlier.',
      { gating: true }
    );
  }

  const budget = isPlainObject(graph.patienceBudget) ? num(graph.patienceBudget.seconds, 0) : 0;

  for (const payoff of payoffReach) {
    if (payoff.reachProbability < MIN_PAYOFF_REACH) {
      flag(
        'payoff-unreachable',
        payoff.reachProbability < MIN_PAYOFF_REACH / 2 ? 'critical' : 'high',
        `Payoff node "${payoff.label}" is reached by only ${(payoff.reachProbability * 100).toFixed(0)}% of arrivals.`,
        `Move "${payoff.label}" earlier, or plant a legible promise of it before the nodes that are shedding readers.`,
        { gating: true }
      );
    } else if (payoff.attentionMass < BURIED_PAYOFF_ATTENTION) {
      flag(
        'payoff-buried',
        'medium',
        `Payoff node "${payoff.label}" holds ${(payoff.attentionMass * 100).toFixed(1)}% of expected reading time - readers pass through it without dwelling.`,
        `Give "${payoff.label}" more surface: a figure, a worked example, or a summary box that rewards stopping.`
      );
    }
    if (budget > 0 && payoff.expectedSecondsToReach !== null && payoff.expectedSecondsToReach > budget) {
      flag(
        'time-to-first-insight-exceeds-budget',
        'high',
        `Time to first insight at "${payoff.label}" is ${Math.round(payoff.expectedSecondsToReach)}s for the readers who get there, against a patience budget of ${Math.round(budget)}s.`,
        `Front-load "${payoff.label}": state the result, show the figure, or give the worked example before the machinery that earns it. A payoff outside the patience budget is a payoff most readers buy on credit and never collect.`,
        { gating: true }
      );
    }
  }

  if (budget > 0 && expectedSecondsBeforeExit > budget) {
    flag(
      'patience-budget-exceeded',
      'high',
      `Expected ${Math.round(expectedSecondsBeforeExit)}s of reading before exit against a stated patience budget of ${Math.round(budget)}s.`,
      'Cut length ahead of the first payoff, or split the surface so the first payoff lands inside the budget.',
      { gating: true }
    );
  }

  for (const info of perNode) {
    if (info.undefinedConcepts.length > 0) {
      flag(
        'unintroduced-prerequisite',
        info.undefinedConcepts.length >= DANGLING_SATURATION ? 'high' : 'medium',
        `"${info.label}" leans on ${info.undefinedConcepts.length} concept(s) the surface never introduces: ${info.undefinedConcepts.join(', ')}.`,
        `Either introduce ${info.undefinedConcepts.join(', ')} before "${info.label}", or state them as declared prerequisites up front so readers can self-select honestly.`,
        { gating: info.undefinedConcepts.length >= DANGLING_SATURATION }
      );
    }
    if (info.forwardRefs.length > 0) {
      flag(
        'forward-reference',
        'medium',
        `"${info.label}" uses ${info.forwardRefs.join(', ')} before the surface introduces them.`,
        `Reorder so ${info.forwardRefs.join(', ')} is introduced before "${info.label}", or give an inline one-line gloss at first use.`
      );
    }
    if (info.workingSet > WORKING_SET_LIMIT) {
      flag(
        'working-set-overflow',
        info.workingSet >= WORKING_SET_LIMIT * 2 ? 'high' : 'medium',
        `"${info.label}" sits under ${info.workingSet} freshly-introduced concepts (working-memory limit: ${WORKING_SET_LIMIT}).`,
        `Space the new ideas around "${info.label}" out, or consolidate them with a worked example before adding more.`
      );
    }
    if (info.attentionElements > ATTENTION_LIMIT) {
      flag(
        'attention-crowding',
        info.attentionElements >= ATTENTION_LIMIT * 2 ? 'high' : 'medium',
        `"${info.label}" competes for attention across ${info.attentionElements} elements (limit: ${ATTENTION_LIMIT}).`,
        `Group or defer elements on "${info.label}" until at most ${ATTENTION_LIMIT} compete at once.`
      );
    }
  }

  // Entropy cliff: a node whose comprehension load jumps sharply above its
  // predecessor. This is the "wall of unintroduced ideas" reading experience -
  // the page where a reader stops feeling slow and starts feeling stupid.
  for (let j = 1; j < n; j += 1) {
    const delta = perNode[j].load - perNode[j - 1].load;
    if (delta >= ENTROPY_CLIFF_DELTA) {
      flag(
        'entropy-cliff',
        delta >= ENTROPY_CLIFF_DELTA * 1.5 ? 'high' : 'medium',
        `Comprehension load jumps ${delta.toFixed(2)} from "${perNode[j - 1].label}" to "${perNode[j].label}" - a difficulty wall rather than a ramp.`,
        `Insert a bridging node before "${perNode[j].label}": a motivating example, a worked instance, or an explicit "what you need to know before this" box.`
      );
    }
  }

  if (regressionsPerVisit > MAX_REGRESSIONS_PER_NODE) {
    flag(
      'regression-churn',
      regressionsPerVisit > MAX_REGRESSIONS_PER_NODE * 2 ? 'high' : 'medium',
      `${regressionsPerVisit.toFixed(2)} backward jumps per node visited (threshold: ${MAX_REGRESSIONS_PER_NODE}) - readers spend their budget re-finding definitions.`,
      'Move definitions closer to their use, or repeat them inline at the point of use instead of relying on a cross-reference.'
    );
  }

  for (const path of readerPaths) {
    const who = path.persona ? `${path.label} (${path.persona})` : path.label;
    if (path.brokenByMap.length > 0) {
      const first = path.brokenByMap[0];
      flag(
        'reader-map-broken-prerequisite',
        'high',
        `Reader map "${who}" routes past ${path.brokenByMap.length} prerequisite(s) it then needs - e.g. "${first.concept}" is required at "${first.neededAt.label}" but introduced in "${first.introducedIn.label}", which this route skips.`,
        `Either add "${first.introducedIn.label}" to the "${path.label}" route, or give that route a self-contained gloss of ${path.brokenByMap.map((b) => b.concept).join(', ')} at the point of use. A map that skips a definition its own route needs is worse than no map: the reader trusted it.`,
        { gating: true }
      );
    }
    if (path.payoffNodes.length === 0) {
      flag(
        'reader-map-omits-payoff',
        'high',
        `Reader map "${who}" never reaches a payoff node - the route pays this reader nothing.`,
        `Add a payoff to the "${path.label}" route, or drop the route. Sending a named reader down a path with no reward is a promise broken in public.`,
        { gating: true }
      );
    }
    for (const sub of path.report.findings) {
      // Surface the route's own gating problems at the top level, scoped, so a
      // book that reads fine linearly and badly along its own prescribed route
      // cannot pass quietly.
      if (sub.severity !== 'high' && sub.severity !== 'critical') continue;
      findings.push({
        id: `reader-path-${sub.id}`,
        severity: sub.severity,
        path: path.id,
        message: `Reader map "${who}": ${sub.message}`,
      });
      if (!path.report.pass) gatingHit = true;
    }
  }

  if (findings.length === 0) {
    recommendations.push(
      `Chain is clean in "${modeName}" mode: ${(completion * 100).toFixed(0)}% completion, ${regressionsPerVisit.toFixed(2)} regressions/visit. Re-run in the other reader modes before shipping - a surface that only survives "study" has an acquisition problem.`
    );
  }

  return {
    pass: !gatingHit,
    findings,
    recommendations,
    readout: {
      readerMode: modeName,
      workingSetWindowNodes: workingSetWindow,
      surfaceKind: typeof graph.surfaceKind === 'string' ? graph.surfaceKind : 'unspecified',
      completion,
      abandonment,
      expectedSecondsBeforeExit,
      expectedRegressions,
      regressionsPerVisit,
      medianExitNode,
      patienceBudgetSeconds: budget || null,
      payoffReach,
      readerPaths: readerPaths.map((path) => ({
        id: path.id,
        label: path.label,
        persona: path.persona,
        nodes: path.nodes,
        skipped: path.skipped,
        brokenByMap: path.brokenByMap,
        completion: path.report.readout.completion,
        expectedSecondsBeforeExit: path.report.readout.expectedSecondsBeforeExit,
        medianExitNode: path.report.readout.medianExitNode,
        payoffReach: path.report.readout.payoffReach,
        findings: path.report.findings,
      })),
      nodes: perNode.map((info, j) => ({
        id: info.id,
        label: info.label,
        reachProbability: reachProbability[j],
        attentionMass: attentionMass[j],
        expectedVisits: expectedVisits[j],
        abandonHazard: info.hazard,
        comprehensionLoad: info.load,
        perceptualLoad: info.percept,
        regressionRate: info.regression,
        workingSet: info.workingSet,
        newConceptRate: info.newConceptRate,
        undefinedConcepts: info.undefinedConcepts,
        forwardRefs: info.forwardRefs,
      })),
    },
  };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) {
    throw new Error('usage: surfer_model.mjs --input <graph>.json [--mode skim|scan|study|task]');
  }
  const m = argv.indexOf('--mode');
  return { input: argv[i + 1], mode: m === -1 ? null : argv[m + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input, mode } = parseArgs(process.argv.slice(2));
    const data = JSON.parse(readFileSync(input, 'utf8'));
    if (mode) data.readerMode = mode;
    process.stdout.write(`${JSON.stringify(simulateSurfer(data), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`surfer_model: ${error.message}\n`);
    process.exit(1);
  }
}
