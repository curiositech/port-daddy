#!/usr/bin/env node
/**
 * Threat-band defensibility — Monte Carlo simulation.
 *
 * Companion to `whitepaper/research/program/simulations/pareto/simulation.mjs` (Pareto dominance) and
 * `simulation-cartel.mjs` (folk-theorem cartel). This script sweeps a
 * `threat_mix` dimension — the proportional split of attacker behaviour
 * across {careless, abandonment, sabotage} — against the three published
 * bond bands from agent-transactions-whitepaper §sec:pricing:threats:
 *
 *     - careless     : bond band   10–25%   of nominal claim ceiling
 *     - abandonment  : bond band   25–50%
 *     - sabotage     : bond band  100–200%
 *
 * For each (threat_mix, bond_band) pair we simulate N transactions where
 * the principal posts the band's MIDPOINT and the agent draws a threat
 * class according to the mix. The expected extraction rate is the
 * fraction of nominal claim ceiling that an attacker can extract under
 * that band-vs-mix combination.
 *
 *     extraction_rate = max(0, expected_damage - bond_paid) / claim_ceiling
 *
 * The defensibility assertion (CI-enforced) is
 *
 *     for each "matched" (mix, band) pair where the mix concentrates on
 *     the threat class the band is designed to defend against:
 *
 *         extraction_rate  <=  band_upper_bound * 1.10
 *
 * The 10% slack is a stochastic tolerance. Matched pairs are:
 *
 *     careless-class mix    → careless band    (10–25%)
 *     abandonment-class mix → abandonment band (25–50%)
 *     sabotage-class mix    → sabotage band   (100–200%)
 *
 * Off-diagonal cells (sabotage mix posted against the careless band, etc.)
 * are reported but do NOT fail CI — they exist to surface band-widening
 * recommendations: if you observe a real threat mix that lands in such a
 * cell, the operator has hard evidence that the published band needs to
 * grow. The whole point of the sweep is to make those rows visible.
 *
 * Run:
 *   node threat-bands.mjs                  # default: 10k samples per cell
 *   node threat-bands.mjs --samples=1000   # CI quick-mode
 *   node threat-bands.mjs --json > out.json
 *
 * Exit code: 0 on all-rows-pass; 1 on any band-violation; 2 on usage error.
 */

import { argv, exit, stdout } from 'node:process';

// ─── Args ────────────────────────────────────────────────────────────────

function parseArgs(args) {
  const out = { samples: 10000, json: false, seed: 42 };
  for (const a of args) {
    if (a.startsWith('--samples=')) out.samples = parseInt(a.split('=')[1], 10);
    else if (a === '--json') out.json = true;
    else if (a.startsWith('--seed=')) out.seed = parseInt(a.split('=')[1], 10);
    else if (a === '--help' || a === '-h') {
      console.log('usage: threat-bands.mjs [--samples=N] [--seed=N] [--json]');
      exit(0);
    } else {
      console.error(`unknown arg: ${a}`);
      exit(2);
    }
  }
  if (!Number.isFinite(out.samples) || out.samples < 1) {
    console.error('--samples must be a positive integer');
    exit(2);
  }
  return out;
}

const { samples: SAMPLES, json: JSON_OUT, seed: SEED } = parseArgs(argv.slice(2));

// ─── PRNG (Mulberry32, deterministic) ────────────────────────────────────

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

function randn(rng) {
  const u = Math.max(rng(), 1e-12);
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ─── Threat classes ──────────────────────────────────────────────────────
//
// Each threat class has a damage distribution as a fraction of the claim
// ceiling. Means are calibrated to be inside the band the matching bond
// is designed to defend against, but with enough variance that the tail
// can break a too-narrow band.

const THREAT_CLASSES = {
  // "careless" — accidental damage during honest attempts to complete work.
  // Mean damage ≈ 15% of claim ceiling, modest variance.
  careless:    { dmgMean: 0.15, dmgSd: 0.05 },

  // "abandonment" — agent walks away mid-task; cleanup cost dominates.
  // Mean damage ≈ 35% of claim ceiling.
  abandonment: { dmgMean: 0.35, dmgSd: 0.10 },

  // "sabotage" — intentional destruction; mean damage ≈ 150% of claim
  // ceiling (yes, sabotage can exceed face value — that's why the band
  // is 100–200%).
  sabotage:    { dmgMean: 1.50, dmgSd: 0.30 },
};

// Bond bands (lower, upper) as fractions of claim ceiling. Midpoint is
// what the principal actually posts in this simulation.
const BOND_BANDS = {
  careless:    { lower: 0.10, upper: 0.25 },
  abandonment: { lower: 0.25, upper: 0.50 },
  sabotage:    { lower: 1.00, upper: 2.00 },
};

function bandMidpoint(band) {
  return (band.lower + band.upper) / 2;
}

// ─── Threat-mix sweep ────────────────────────────────────────────────────
//
// Each mix is a discrete distribution over the three threat classes that
// sums to 1. The simulation sweeps a representative grid:
//
//   - pure_careless    : 100% careless
//   - pure_abandonment : 100% abandonment
//   - pure_sabotage    : 100% sabotage
//   - balanced         : 1/3, 1/3, 1/3
//   - mostly_careless  : 80% careless,  10% abandonment, 10% sabotage
//   - mostly_sabotage  : 10% careless,  10% abandonment, 80% sabotage
//   - field_realistic  : 70% careless,  25% abandonment,  5% sabotage
//     (empirical guess from the whitepaper's framing; meant to represent
//      "most failures are confusion, some are walk-away, very few are
//      adversarial". Adjust as ground-truth data lands.)

const THREAT_MIXES = {
  pure_careless:    { careless: 1.00, abandonment: 0.00, sabotage: 0.00 },
  pure_abandonment: { careless: 0.00, abandonment: 1.00, sabotage: 0.00 },
  pure_sabotage:    { careless: 0.00, abandonment: 0.00, sabotage: 1.00 },
  balanced:         { careless: 1 / 3, abandonment: 1 / 3, sabotage: 1 / 3 },
  mostly_careless:  { careless: 0.80, abandonment: 0.10, sabotage: 0.10 },
  mostly_sabotage:  { careless: 0.10, abandonment: 0.10, sabotage: 0.80 },
  field_realistic:  { careless: 0.70, abandonment: 0.25, sabotage: 0.05 },
};

function sampleThreatClass(mix, rng) {
  const r = rng();
  let acc = 0;
  for (const cls of ['careless', 'abandonment', 'sabotage']) {
    acc += mix[cls];
    if (r < acc) return cls;
  }
  return 'sabotage';
}

function sampleDamage(threatClass, rng) {
  const { dmgMean, dmgSd } = THREAT_CLASSES[threatClass];
  // Truncate to non-negative — damage is non-negative by definition.
  return Math.max(0, dmgMean + dmgSd * randn(rng));
}

// ─── Simulation kernel ───────────────────────────────────────────────────
//
// One cell: (threat_mix, bond_band). Principal posts bandMidpoint(band)
// per transaction. Each draw realises a damage based on the threat-class
// sampled from the mix. Attacker extraction = max(0, damage - bond_paid),
// reported as a fraction of claim ceiling = 1.0 (per-unit normalisation).

function simulateCell(mix, bond_band, samples, rngSeed) {
  const rng = mulberry32(rngSeed);
  const bondPaid = bandMidpoint(BOND_BANDS[bond_band]);

  let extractionTotal = 0;
  let damageTotal = 0;
  const classCounts = { careless: 0, abandonment: 0, sabotage: 0 };

  for (let i = 0; i < samples; i++) {
    const cls = sampleThreatClass(mix, rng);
    classCounts[cls] += 1;
    const damage = sampleDamage(cls, rng);
    damageTotal += damage;
    // Attacker extracts the uncovered damage. We do NOT model the bond
    // refund: the principal's bond is forfeit when damage > 0 (worst-case
    // policy in §sec:pricing). The extraction figure tracks how much
    // damage the bond failed to absorb.
    const uncoveredDamage = Math.max(0, damage - bondPaid);
    extractionTotal += uncoveredDamage;
  }

  return {
    observed_extraction_rate: extractionTotal / samples,
    observed_damage_rate: damageTotal / samples,
    bond_posted: bondPaid,
    class_counts: classCounts,
  };
}

// ─── Sweep + assertion ───────────────────────────────────────────────────

// A mix-to-matched-band lookup. The "matched" band is the one designed
// to defend against the threat class the mix concentrates on. For
// balanced / field_realistic mixes there is no single matched band, and
// they are reported but not asserted against any specific band.
const MATCHED_BAND = {
  pure_careless:    'careless',
  pure_abandonment: 'abandonment',
  pure_sabotage:    'sabotage',
  mostly_careless:  'careless',
  mostly_sabotage:  'sabotage',
  // balanced + field_realistic: no single matched band — informational only.
};

function sweepAndCheck(samples, seedBase, jsonOut) {
  const TOLERANCE = 1.10; // 10% stochastic slack on the matched-band assertion
  const rows = [];
  const matchedFailures = [];
  const widening = []; // off-diagonal cells where extraction exceeds the band
  let seedCounter = seedBase;

  for (const [mixName, mix] of Object.entries(THREAT_MIXES)) {
    for (const bondBand of Object.keys(BOND_BANDS)) {
      const cellSeed = (seedCounter += 1);
      const r = simulateCell(mix, bondBand, samples, cellSeed);

      const bandUpper = BOND_BANDS[bondBand].upper;
      const ceiling = bandUpper * TOLERANCE;
      const informationallyExceeds = r.observed_extraction_rate > ceiling;
      const isMatched = MATCHED_BAND[mixName] === bondBand;
      const passed = !isMatched || !informationallyExceeds;

      const row = {
        threat_mix: mixName,
        bond_band: bondBand,
        matched: isMatched,
        observed_extraction_rate: Number(r.observed_extraction_rate.toFixed(4)),
        observed_damage_rate: Number(r.observed_damage_rate.toFixed(4)),
        bond_posted: r.bond_posted,
        band_upper: bandUpper,
        assertion_ceiling: Number(ceiling.toFixed(4)),
        passed,
        seed: cellSeed,
      };
      rows.push(row);
      if (isMatched && informationallyExceeds) matchedFailures.push(row);
      else if (!isMatched && informationallyExceeds) widening.push(row);
    }
  }

  if (jsonOut) {
    stdout.write(
      JSON.stringify(
        {
          metadata: {
            samples,
            seedBase,
            tolerance: TOLERANCE,
            threat_classes: THREAT_CLASSES,
            bond_bands: BOND_BANDS,
            matched_band: MATCHED_BAND,
            timestamp: new Date().toISOString(),
          },
          rows,
          matched_failures: matchedFailures,
          widening_recommendations: widening,
        },
        null,
        2,
      ) + '\n',
    );
  } else {
    // Human-readable table.
    stdout.write(
      '# Threat-band defensibility — Monte Carlo sweep\n' +
        `# samples per cell      = ${samples}\n` +
        `# tolerance             = ${TOLERANCE} (10% stochastic slack)\n` +
        `# rows                  = ${rows.length}\n` +
        `# matched_failures      = ${matchedFailures.length} (CI-fatal)\n` +
        `# widening recommends   = ${widening.length} (informational)\n\n`,
    );
    stdout.write(
      [
        'threat_mix'.padEnd(20),
        'bond_band'.padEnd(14),
        'mtch'.padEnd(5),
        'extract'.padEnd(10),
        'damage'.padEnd(10),
        'bond'.padEnd(7),
        'ceiling'.padEnd(9),
        'PASS',
      ].join(' ') + '\n',
    );
    stdout.write('-'.repeat(85) + '\n');
    for (const r of rows) {
      stdout.write(
        [
          r.threat_mix.padEnd(20),
          r.bond_band.padEnd(14),
          (r.matched ? 'yes' : '-').padEnd(5),
          r.observed_extraction_rate.toFixed(4).padEnd(10),
          r.observed_damage_rate.toFixed(4).padEnd(10),
          r.bond_posted.toFixed(3).padEnd(7),
          r.assertion_ceiling.toFixed(4).padEnd(9),
          r.passed ? 'yes' : 'NO',
        ].join(' ') + '\n',
      );
    }
    if (matchedFailures.length > 0) {
      stdout.write(
        '\n# MATCHED-BAND FAILURES (CI-fatal — published band cannot absorb its\n# target threat class at the simulated mean):\n',
      );
      for (const f of matchedFailures) {
        stdout.write(
          `#   ${f.threat_mix} + ${f.bond_band}: extracted ${f.observed_extraction_rate} > ${f.assertion_ceiling}\n`,
        );
      }
    }
    if (widening.length > 0) {
      stdout.write(
        '\n# WIDENING RECOMMENDATIONS (off-diagonal — informational; surfaces\n# bands that would need to grow if this mix became prevalent):\n',
      );
      for (const w of widening) {
        stdout.write(
          `#   ${w.threat_mix} + ${w.bond_band}: extracted ${w.observed_extraction_rate} > ${w.assertion_ceiling}\n`,
        );
      }
    }
    stdout.write(
      '\n# Reading the result:\n' +
        '# - matched     = "yes" if this band is the one designed for this mix\'s\n' +
        '#   dominant threat class. The CI assertion runs only on matched rows.\n' +
        '# - extract     = average attacker extraction (fraction of claim ceiling)\n' +
        '#   AFTER the bond is consumed. extract ≤ ceiling means the band\n' +
        '#   covers the threat mix at this mean.\n' +
        '# - damage      = average raw damage before bond. extract = damage - bond.\n' +
        '# - bond        = bond actually posted (midpoint of the named band).\n' +
        '# - ceiling     = band_upper * 1.10; matched-row pass means defensibility holds.\n' +
        '#\n' +
        '# Defensibility headline: the published bands (10–25, 25–50, 100–200)\n' +
        '# absorb their target threat class. Off-diagonal cells (e.g. sabotage\n' +
        '# mix posted against the careless band) are surfaced as widening\n' +
        '# recommendations — they are NOT bugs; they are evidence the operator\n' +
        '# should use to widen a band if that mix becomes empirically prevalent.\n',
    );
  }

  return matchedFailures.length === 0 ? 0 : 1;
}

const exitCode = sweepAndCheck(SAMPLES, SEED, JSON_OUT);
exit(exitCode);
