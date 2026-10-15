#!/usr/bin/env node
/**
 * A5 — Sybil-attack regime extension to the Pareto Monte Carlo (§8.4.4).
 *
 * Spec: proofs/bonded/recovery/cuckoo-pollution.md (anchor pollution),
 *       proofs/bonded/pareto/dominance.md (§8.4.4 baseline).
 *
 * Attack model
 *   An adversary spins up K Sybil "insurer" identities. Each Sybil
 *   posts the protocol-mandated deposit B_dep, then bids aggressively
 *   (1 − epsilon below honest cost) to win auctions. On loss, the
 *   Sybil defaults: pays nothing, forfeits its deposit, the protocol
 *   slashes min(B_dep, coverage) to the commons.
 *
 * Contract and interpretation
 *   Premium is retained on every winning transaction, including default.
 *   Default forfeits min(B_dep, coverage). Capital is replenished for each
 *   transaction; funding and entry costs are zero. For fixed q, p, coverage:
 *     E[profit] = q - p * min(B_dep, coverage).
 *   Increasing deposit cannot deter the attack when q > p * coverage.
 *   Under a DIFFERENT full-forfeiture contract, E[profit] = q - p * B_dep,
 *   whose break-even is B_dep = q / p. This sweep tests the capped rule only.
 *   Bids use mu (conditional loss scale), not actuarially fair payouts, so
 *   these inputs do not establish a competitive-insurance equilibrium.
 *
 * Run:
 *   node proofs/bonded/pareto/simulation-sybil.mjs \
 *     > proofs/bonded/pareto/simulation-sybil.run.log
 */

import { pathToFileURL } from 'node:url';

const TRIALS_PER_CONFIG = 2000;
const TXNS_PER_TRIAL = 50;

const RISK_CLASSES = {
  low: { mu: 1, var: 0.5, lossProb: 0.05 },
  med: { mu: 10, var: 4.0, lossProb: 0.10 },
  high: { mu: 100, var: 40.0, lossProb: 0.20 },
};

const SAFETY_FACTOR = 0.5;
const OPPORTUNITY_RATE = 0.05;
const SYBIL_EPSILON = 0.1; // Sybil undercuts honest by 10%

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

function randLogNormal(rng, logMean, logSd) {
  return Math.exp(logMean + logSd * randn(rng));
}

function realizedLoss(txn, rng) {
  const occurs = rng() < txn.lossProb;
  if (!occurs) return 0;
  return Math.max(0, txn.mu + Math.sqrt(txn.var) * Math.abs(randn(rng)));
}

/**
 * Single auction with k honest insurers + sybilCount Sybils.
 *
 * Returns { winnerIsSybil, premium, payout, deposit_at_risk }.
 *
 * Sybil bids honestlyMin * (1 − epsilon), guaranteed-undercut. On
 * loss, the protocol transfers min(B_dep, coverage) to the commons.
 * The Sybil keeps the premium in either outcome; unslashed capital remains
 * its property. Deposits are replenished for every transaction.
 */
export function runAuction(txn, honestInsurers, sybilCount, b_dep, rng) {
  const coverage = txn.mu * (1 + SAFETY_FACTOR);
  const honestBids = honestInsurers.map((ins) => ({
    id: `h${ins.id}`,
    bid: txn.mu + ins.alpha,
    isSybil: false,
    deposit: 0,
  }));
  const honestMin = honestBids.reduce((m, b) => Math.min(m, b.bid), Infinity);

  const sybilBids = [];
  for (let s = 0; s < sybilCount; s++) {
    sybilBids.push({
      id: `s${s}`,
      bid: honestMin * (1 - SYBIL_EPSILON),
      isSybil: true,
      deposit: b_dep,
    });
  }

  const all = [...honestBids, ...sybilBids].sort((a, b) => a.bid - b.bid);
  const winner = all[0];
  const premium = all.length > 1 ? all[1].bid : winner.bid;

  const d = realizedLoss(txn, rng);
  let payoutToCommons = 0;
  let depositSlashed = 0;

  if (d > 0) {
    if (winner.isSybil) {
      // Sybil defaults: commons gets only the slashed deposit (capped
      // at coverage), not the realized loss.
      depositSlashed = Math.min(winner.deposit, coverage);
      payoutToCommons = depositSlashed;
    } else {
      payoutToCommons = Math.min(d, coverage);
    }
  }

  return {
    winnerIsSybil: winner.isSybil,
    premium,
    payoutToCommons,
    depositSlashed,
    realizedLoss: d,
    coverage,
  };
}

function runTrial({ seed, n_honest, sybilCount, b_dep }) {
  const rng = mulberry32(seed);

  const honest = [];
  for (let i = 0; i < n_honest; i++) {
    honest.push({ id: i, alpha: randLogNormal(rng, Math.log(0.10), 0.6) });
  }

  let sybilWins = 0;
  let sybilPremium = 0;
  let sybilDepositLost = 0;
  let commonsDeficit = 0; // (honest_payout - sybil_payout) per loss event
  let principalCost = 0;

  for (let t = 0; t < TXNS_PER_TRIAL; t++) {
    const classes = Object.keys(RISK_CLASSES);
    const cls = classes[Math.floor(rng() * classes.length)];
    const txn = { ...RISK_CLASSES[cls] };

    const r = runAuction(txn, honest, sybilCount, b_dep, rng);
    principalCost += r.premium;
    if (r.winnerIsSybil) {
      sybilWins++;
      sybilPremium += r.premium;
      sybilDepositLost += r.depositSlashed;
      // What an honest insurer would have paid for this loss:
      const honestPayout = Math.min(r.realizedLoss, r.coverage);
      commonsDeficit += Math.max(0, honestPayout - r.payoutToCommons);
    }
  }

  // Sybil net = premiums collected − deposits slashed − ops cost (set
  // to zero here; deposits dominate). Sybil attack is unprofitable
  // when sybilNet < 0.
  const sybilNet = sybilPremium - sybilDepositLost;

  return {
    sybilWins,
    sybilPremium,
    sybilDepositLost,
    commonsDeficit,
    principalCost,
    sybilNet,
    attackProfitable: sybilNet > 0,
  };
}

function runSweep() {
  // Sweep capped deposits; saturation does not imply deterrence.
  const depositSweep = [0.5, 1, 2, 5, 10, 25, 50, 100, 200, 500, 1000];
  const configs = [];
  for (const b_dep of depositSweep) {
    for (const sybilCount of [1, 3]) {
      configs.push({ n_honest: 5, sybilCount, b_dep });
    }
  }

  console.log('# A5 — Sybil-attack regime — Bonded Commons §8.4.4 extension');
  console.log(`# trials_per_config=${TRIALS_PER_CONFIG} txns_per_trial=${TXNS_PER_TRIAL}`);
  console.log(`# safety_factor=${SAFETY_FACTOR} sybil_epsilon=${SYBIL_EPSILON}`);
  console.log('# attack: K Sybil identities undercut honest bids by 10%, default on loss');
  console.log('# question: smallest B_dep that makes sybilNet < 0 (attack unprofitable)');
  console.log('');
  console.log(
    [
      'b_dep',
      'sybilCount',
      'mean_sybil_wins',
      'mean_sybil_premium',
      'mean_sybil_deposit_lost',
      'mean_sybil_net',
      'attack_profitable_rate',
      'mean_commons_deficit',
    ].join('\t'),
  );

  for (const cfg of configs) {
    let sumWins = 0,
      sumPremium = 0,
      sumDepositLost = 0,
      sumNet = 0,
      sumProfitable = 0,
      sumDeficit = 0;
    for (let trial = 0; trial < TRIALS_PER_CONFIG; trial++) {
      const seed = (cfg.b_dep * 1e5 + cfg.sybilCount * 1e3 + trial) | 0;
      const r = runTrial({ ...cfg, seed });
      sumWins += r.sybilWins;
      sumPremium += r.sybilPremium;
      sumDepositLost += r.sybilDepositLost;
      sumNet += r.sybilNet;
      sumProfitable += r.attackProfitable ? 1 : 0;
      sumDeficit += r.commonsDeficit;
    }
    console.log(
      [
        cfg.b_dep.toFixed(2),
        cfg.sybilCount,
        (sumWins / TRIALS_PER_CONFIG).toFixed(2),
        (sumPremium / TRIALS_PER_CONFIG).toFixed(2),
        (sumDepositLost / TRIALS_PER_CONFIG).toFixed(2),
        (sumNet / TRIALS_PER_CONFIG).toFixed(2),
        (sumProfitable / TRIALS_PER_CONFIG).toFixed(3),
        (sumDeficit / TRIALS_PER_CONFIG).toFixed(2),
      ].join('\t'),
    );
  }

  console.log('');
  console.log('# Reading the result:');
  console.log('# - mean_sybil_net > 0 → attack profitable, B_dep too low');
  console.log('# - mean_sybil_net < 0 → deposit forfeitures exceed premiums');
  console.log('# - attack_profitable_rate: fraction of trials with sybilNet > 0');
  console.log('# - commons_deficit: under-compensation suffered by commons when sybil wins');
  console.log('');
  console.log('# Fixed-class check, premium retained on default:');
  console.log('#   E[profit] = q - p * min(B_dep, coverage)');
  console.log('#   If q > p * coverage, no capped deposit deters this attack.');
  console.log('# Full forfeiture is a different contract: E[profit] = q - p*B_dep.');
  console.log('# Example q=10, p=.1, coverage=20, B_dep=110: capped +8, full -1.');
  console.log('# This sweep does not prove a composite Sybil policy sufficient.');

}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runSweep();
