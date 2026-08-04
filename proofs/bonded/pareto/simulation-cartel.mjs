#!/usr/bin/env node
/**
 * A6 — Repeated-game cartel folk-theorem simulation (§8.4.4 extension).
 *
 * Spec: proofs/bonded/pareto/cartel-resilience.md.
 *
 * Question
 *   In a one-shot Vickrey auction, a single round of cartel collusion
 *   raises principal cost by an O(safety_factor · mu) wedge per
 *   transaction. The Pareto-dominance theorem (§8.4.4) is robust
 *   against this in one-shot. The harder question — answered here —
 *   is whether cartel collusion is sustainable across many rounds
 *   under the protocol's detection mechanism.
 *
 * Folk theorem setup (Friedman 1971, repeated Bertrand)
 *   Each round:
 *     - cartel members may COLLUDE (charge floor q_floor) or DEFECT
 *       (undercut to q_floor − ε).
 *     - protocol detects collusion with probability p_d per round.
 *       On detection, the cartel member is slashed for a one-shot
 *       penalty L = 5 · (q_floor − mu).
 *     - players discount future payoffs at delta ∈ (0, 1).
 *
 * Sustainability condition (one-shot deviation principle)
 *   Cartel is self-enforcing if:
 *     (collusion stream value) ≥ (defection one-shot gain) +
 *                                (post-defection competitive payoff)
 *
 *   Because detection happens before the current-round payoff, the
 *   collusion value satisfies
 *
 *     V_C = pi_C - p_d L + delta (1 - p_d) V_C.
 *
 *   With pi_N ≈ 0, sustainability is therefore
 *
 *     (pi_C - p_d L) / (1 - delta (1 - p_d)) >= pi_D.
 *
 *   where:
 *     pi_C = per-round cartel profit (each member)
 *     pi_D = one-shot defection profit (winner takes all that round)
 *     pi_N = competitive (Nash) per-round profit (≈ 0 at zero-profit)
 *     p_d  = per-round detection probability
 *     delta = discount factor
 *
 * What this sim computes
 *   For a grid of (p_d, delta), Monte-Carlo simulate T-round games
 *   where each member follows a "collude until detected" strategy.
 *   Measure:
 *     - cartel mean lifespan in rounds (until first detection)
 *     - cartel mean discounted profit per member
 *     - defector mean discounted profit (counterfactual one-shot)
 *     - sustainable? (collusion > defection EV)
 *
 *   Find p_d* (threshold above which cartel collapses for each delta).
 *
 * Run:
 *   node proofs/bonded/pareto/simulation-cartel.mjs \
 *     > proofs/bonded/pareto/simulation-cartel.run.log
 */

const TRIALS_PER_CONFIG = 5000;
const ROUNDS = 200;
const CARTEL_SIZE = 3;
const CARTEL_PENALTY_MULT = 5;
const SAFETY_FACTOR = 0.5;
const MU = 10; // representative med-risk class
const DEFECT_EPSILON = 0.05; // defector undercuts cartel floor by 5%

const Q_FLOOR = MU * (1 + SAFETY_FACTOR); // collusion price
const Q_COMPETITIVE = MU; // ≈ zero-profit competitive price

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * One T-round Bertrand game with detection prob p_d and discount delta.
 *
 * Strategy: "collude until detected." This is the grim trigger / trigger
 * strategy that supports cartel under the folk theorem when sustainable.
 *
 * Returns: { lifespan, colludePV, defectorOneShotPV, detected }.
 *   - colludePV: discounted PV of per-member profit while cartel survives
 *   - defectorOneShotPV: discounted PV if one member defects in round 1
 *     and the rest play competitive ever after
 */
function runOneGame({ seed, p_d, delta }) {
  const rng = mulberry32(seed);

  // Per-round profit when colluding: each member wins 1/CARTEL_SIZE of
  // the auctions at q_floor margin (q_floor − mu). Outsiders win none.
  const piCPerRound = (Q_FLOOR - MU) / CARTEL_SIZE;

  let lifespan = 0;
  let colludePV = 0;
  let discount = 1;
  let detected = false;

  for (let t = 0; t < ROUNDS; t++) {
    if (rng() < p_d) {
      // Detected — cartel is slashed and collapses. Apply the one-time
      // penalty to the current round's payoff for the member detected.
      colludePV += discount * (piCPerRound - CARTEL_PENALTY_MULT * (Q_FLOOR - MU));
      detected = true;
      lifespan = t + 1;
      break;
    }
    colludePV += discount * piCPerRound;
    discount *= delta;
  }
  if (!detected) lifespan = ROUNDS;

  // Defector path: deviates round 0, takes the full (Q_FLOOR − DEFECT_EPSILON
  // − MU) margin alone that round. Subsequent rounds: cartel collapses
  // (deterrent strategy), all members revert to competitive ≈ zero profit.
  const defectGain = Q_FLOOR - DEFECT_EPSILON - MU;
  const defectorOneShotPV = defectGain + 0; // future ≈ 0

  return { lifespan, colludePV, defectorOneShotPV, detected };
}

function runSweep() {
  const pdGrid = [0.01, 0.03, 0.05, 0.10, 0.15, 0.20, 0.30, 0.50];
  const deltaGrid = [0.80, 0.90, 0.95, 0.99];

  console.log('# A6 — Repeated-game cartel folk-theorem — Bonded Commons §8.4.4 extension');
  console.log(`# trials_per_config=${TRIALS_PER_CONFIG} rounds=${ROUNDS} cartel_size=${CARTEL_SIZE}`);
  console.log(`# mu=${MU} q_floor=${Q_FLOOR} cartel_penalty_mult=${CARTEL_PENALTY_MULT}`);
  console.log('# strategy: grim trigger / collude-until-detected');
  console.log('');
  console.log(
    [
      'p_d',
      'delta',
      'mean_lifespan',
      'mean_collude_PV',
      'mean_defect_PV',
      'collude_dominates_rate',
      'sustainable',
    ].join('\t'),
  );

  for (const delta of deltaGrid) {
    for (const p_d of pdGrid) {
      let sumLifespan = 0,
        sumColludePV = 0,
        sumDefectorPV = 0,
        sumColludeDominates = 0;
      for (let trial = 0; trial < TRIALS_PER_CONFIG; trial++) {
        const seed = (p_d * 1e6 + delta * 1e3 + trial) | 0;
        const r = runOneGame({ seed, p_d, delta });
        sumLifespan += r.lifespan;
        sumColludePV += r.colludePV;
        sumDefectorPV += r.defectorOneShotPV;
        if (r.colludePV > r.defectorOneShotPV) sumColludeDominates++;
      }
      const meanColludePV = sumColludePV / TRIALS_PER_CONFIG;
      const meanDefectPV = sumDefectorPV / TRIALS_PER_CONFIG;
      const dominanceRate = sumColludeDominates / TRIALS_PER_CONFIG;
      const sustainable = meanColludePV > meanDefectPV ? 'YES' : 'NO';
      console.log(
        [
          p_d.toFixed(2),
          delta.toFixed(2),
          (sumLifespan / TRIALS_PER_CONFIG).toFixed(1),
          meanColludePV.toFixed(2),
          meanDefectPV.toFixed(2),
          dominanceRate.toFixed(3),
          sustainable,
        ].join('\t'),
      );
    }
  }

  console.log('');
  console.log('# Reading the result:');
  console.log('# - sustainable=YES: cartel PV > defector PV at this (p_d, delta)');
  console.log('# - sustainable=NO:  cartel is fragile; a rational member defects round 1');
  console.log('# - mean_lifespan: expected rounds before detection slashes the cartel');
  console.log('# - p_d* (threshold detection rate) is the smallest p_d in a delta row');
  console.log('#   where sustainable flips NO. That p_d* is the protocol target.');
  console.log('');
  console.log('# Closed-form check (no defection-stage punishment beyond detection):');
  console.log('#   V_C = (piC − p_d · L) / (1 − delta · (1 − p_d))');
  console.log('#   sustainable iff V_C ≥ piD');
  console.log('#   p_d* = (piC − (1 − delta) · piD) / (L + delta · piD)');
  console.log('');
  console.log('# Headline (assuming delta = 0.95, typical for one-month rounds):');
  console.log('# p_d* ≈ 0.0478. The tested grid first classifies the cartel as fragile');
  console.log('# at p_d = 0.05. This sets a model-conditional bar for');
  console.log('# the Anchor §6.4 detection mechanism (Merkle Forest binding + heat).');
}

runSweep();
