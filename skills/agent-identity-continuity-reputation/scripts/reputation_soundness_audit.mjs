#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isBoolean(value) {
  return typeof value === 'boolean';
}

/**
 * Audit an agent identity/continuity/reputation design plan against the
 * chain of decision points in this skill's SKILL.md: identity gates
 * continuity, continuity gates outcomes, outcomes gate reputation,
 * reputation gates the market. Each unmet condition below is a named
 * chain-break from `references/failure-modes-and-defenses.md`, not a
 * generic lint warning.
 *
 * @param {unknown} plan - parsed JSON plan object matching
 *   schemas/reputation-plan.schema.json.
 * @returns {{pass: boolean, findings: Array<{id: string, severity: string, message: string}>, recommendations: string[]}}
 */
export function auditReputationDesign(plan) {
  if (!isPlainObject(plan)) {
    throw new Error('plan must be a JSON object matching schemas/reputation-plan.schema.json');
  }

  const findings = [];
  const recommendations = [];
  let criticalHit = false;
  let highHit = false;

  function fail(id, severity, message, recommendation) {
    findings.push({ id, severity, message });
    if (recommendation) recommendations.push(recommendation);
    if (severity === 'critical') criticalHit = true;
    if (severity === 'high') highHit = true;
  }

  // --- 1. Identity: the gate that blocks everything downstream ---
  if (!isBoolean(plan.identityNonForgeable)) {
    fail(
      'missing-identity-field',
      'critical',
      'plan.identityNonForgeable is missing or not a boolean: cannot tell whether identity is forgeable.',
      'Set identityNonForgeable explicitly. Until it is true, every other field in this audit is moot.'
    );
  } else if (plan.identityNonForgeable === false) {
    fail(
      'forgeable-self-asserted-identity',
      'critical',
      'STOP — identity is forgeable/self-asserted. An agent that can pick its own id makes every downstream reputation claim "climbing an imaginary staircase" (Sybil-reset risk).',
      'Mint an opaque id from the trusted substrate (daemon/server) bound to a credential the agent cannot cheaply re-pick. Do this before evaluating continuity, outcomes, or reputation.'
    );
  }

  // --- 2. Continuity: memory + checkpoint + outcome ledger ---
  const continuity = plan.continuityPersists;
  if (!isPlainObject(continuity)) {
    fail(
      'missing-continuity-block',
      'high',
      'plan.continuityPersists is missing: cannot tell what, if anything, survives process/context death.',
      'Add continuityPersists.{memory, checkpoint, outcomeLedger} as explicit booleans.'
    );
  } else {
    const need = ['memory', 'checkpoint', 'outcomeLedger'].filter((k) => !isBoolean(continuity[k]));
    if (need.length > 0) {
      fail(
        'incomplete-continuity-block',
        'high',
        `continuityPersists missing boolean field(s): ${need.join(', ')}.`,
        'Every continuity claim must state memory/checkpoint/outcomeLedger explicitly; an absent field cannot be assumed true.'
      );
    } else if (continuity.outcomeLedger === false) {
      fail(
        'weak-continuity-note-only',
        'high',
        'Weak continuity: outcomeLedger is false. If "resurrection" only forwards a memory note or checkpoint with no append-only, externally-witnessed outcome record, reputation has nothing durable to key on — label this continuity-of-record, not checkpointing.',
        'Add an append-only outcome ledger (registered outcomes closing against an oracle) before wiring any reputation estimator to this design.'
      );
    }
  }

  // --- 3. Outcome closure: oracle + adversarial re-open ---
  if (!isBoolean(plan.outcomesCloseAgainstOracle) || !isBoolean(plan.sampledAdversarialAuditor)) {
    fail(
      'missing-outcome-closure-fields',
      'high',
      'plan.outcomesCloseAgainstOracle and/or plan.sampledAdversarialAuditor is missing or not boolean.',
      'State both explicitly: how outcomes close, and whether a sampled adversarial auditor re-opens a fraction of them.'
    );
  } else {
    if (plan.outcomesCloseAgainstOracle === false) {
      fail(
        'self-closed-outcomes-no-oracle',
        'high',
        'Self-closed outcomes: outcomes do not close against an oracle the agent cannot author (a merged SHA, a passing test id, a satisfied monitor). Free-text "Result: done" is not an outcome (Goodhart, Strathern 1997).',
        'Bind outcome closure to ground truth the agent cannot self-author before trusting any reputation derived from it.'
      );
    }
    if (plan.sampledAdversarialAuditor === false) {
      fail(
        'no-adversarial-reopen',
        'high',
        'No sampled adversarial auditor: even oracle-bound outcomes can be hollow-but-technically-met without a random + risk-weighted re-open and re-validation.',
        'Add a sampled adversarial auditor that re-opens and re-runs validation on a fraction of cleared outcomes.'
      );
    }
  }

  // --- 4. Reputation estimator + uncertainty + gate wiring ---
  const validEstimators = ['elo', 'trueskill', 'bandit', 'none'];
  if (typeof plan.estimator !== 'string' || !validEstimators.includes(plan.estimator)) {
    fail(
      'invalid-estimator',
      'medium',
      `plan.estimator must be one of ${validEstimators.join('|')}.`,
      'Name the actual estimator in use (or "none") so uncertainty/cold-start behavior can be evaluated.'
    );
  } else if (plan.estimator === 'none') {
    fail(
      'no-reputation-estimator',
      'high',
      'No reputation estimator: pairwise/tournament or scalar outcome signal never gets consolidated into a score, so nothing downstream can be priced or routed on reputation yet.',
      'Pick Bradley-Terry/Elo or TrueSkill for pairwise signal, or a contextual bandit for scalar outcome signal, per the Decision Points in SKILL.md.'
    );
  } else if (!isBoolean(plan.representsUncertainty)) {
    fail(
      'missing-uncertainty-field',
      'medium',
      'plan.representsUncertainty is missing or not boolean.',
      'State whether the estimator represents calibrated uncertainty or budgets exploration.'
    );
  } else if (plan.representsUncertainty === false) {
    fail(
      'estimator-without-uncertainty',
      'medium',
      `Estimator "${plan.estimator}" does not represent uncertainty: a new backend/agent will look bad or untested and be starved of tasks (exploration starvation) instead of being trusted proportionally to sample size.`,
      'Use TrueSkill for calibrated variance, or add an explicit exploration bonus to the bandit/Elo estimator, so new entrants are neither trusted blindly nor starved.'
    );
  }

  if (!isBoolean(plan.scoreIsTelemetryGatesArePredicates)) {
    fail(
      'missing-gate-wiring-field',
      'high',
      'plan.scoreIsTelemetryGatesArePredicates is missing or not boolean: unclear whether the scalar score is wired directly to a gate.',
      'State explicitly whether the reputation score is telemetry-only with gates on separate predicates.'
    );
  } else if (plan.scoreIsTelemetryGatesArePredicates === false) {
    fail(
      'reputation-wired-to-gate',
      'high',
      'Reputation score is wired directly to a kill/spend/routing gate instead of being exposed as telemetry with gates on concrete predicates. This invites Goodhart: optimizing the proxy score instead of the underlying work.',
      'Expose the scalar score as telemetry only; gate on predicates (e.g. clean exits >= N, no open overdue obligations) until the estimator is independently trusted.'
    );
  }

  // --- 5. Newcomer policy (whitewashing / Sybil-reset defense) ---
  if (!isBoolean(plan.newcomerPolicy)) {
    fail(
      'missing-newcomer-policy-field',
      'medium',
      'plan.newcomerPolicy is missing or not boolean.',
      'State whether a newcomer floor exists.'
    );
  } else if (plan.newcomerPolicy === false) {
    fail(
      'no-newcomer-policy',
      'medium',
      'No newcomer policy: without a floor that prices churn without locking out genuine first runs, the design is vulnerable to whitewashing (rep-rot then re-enter clean) or Sybil-reset (respawn under a new id).',
      'Add a newcomer floor: full ability to work, reduced economic ceiling, until clean-exit history accrues.'
    );
  }

  // --- 6. Judge de-biasing ---
  const judge = plan.judge;
  if (!isPlainObject(judge) || !isBoolean(judge.present) || !isBoolean(judge.deBiased)) {
    fail(
      'missing-judge-block',
      'medium',
      'plan.judge.{present, deBiased} is missing or not boolean.',
      'State explicitly whether an LLM-as-judge participates and, if so, whether it is de-biased.'
    );
  } else if (judge.present === true && judge.deBiased === false) {
    fail(
      'undebiased-judge',
      'medium',
      'An LLM-as-judge is in the reputation loop and is not de-biased: position, verbosity, and self-preference bias (Zheng 2023) will systematically distort scores.',
      'Blind the judge, swap/average presentation order, prefer pairwise over absolute scoring, and exclude a backend from judging its own family.'
    );
  }

  // --- 7. Sanctions ---
  if (!isBoolean(plan.sanctionsStakedGraduated)) {
    fail(
      'missing-sanctions-field',
      'medium',
      'plan.sanctionsStakedGraduated is missing or not boolean.',
      'State whether sanctions are staked and graduated.'
    );
  } else if (plan.sanctionsStakedGraduated === false) {
    fail(
      'unstaked-sanctions',
      'medium',
      'Sanctions are not staked/graduated: if getting caught faking compliance costs less than honest non-completion, faking wins in expectation (incentive mis-design, Nisan 2007).',
      'Design a graduated, staked sanction ladder where an audit-failed fake costs strictly more than honest non-completion.'
    );
  }

  if (findings.length === 0) {
    recommendations.push(
      'Plan is structurally sound against every named chain-break. Spot-check that the honest-ceiling caveat is stated: this proves delivery against an oracle on a clock the agent did not set, not that the work was good.'
    );
  }

  const pass = !criticalHit && !highHit;

  return { pass, findings, recommendations };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: reputation_soundness_audit.mjs --input <file>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const data = JSON.parse(readFileSync(input, 'utf8'));
    process.stdout.write(`${JSON.stringify(auditReputationDesign(data), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`reputation_soundness_audit: ${error.message}\n`);
    process.exit(1);
  }
}
