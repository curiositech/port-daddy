#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VERTICES = {
  identityFit: ['visual', 'language', 'impliedUser'],
  problemUrgency: ['painAcknowledged', 'emotionalResonance', 'solutionClarity'],
  trustSignals: ['execution', 'socialProof', 'riskReduction'],
};

const OBJECTION_TYPES = ['trust', 'skepticism', 'value', 'effort', 'identity', 'risk', 'urgency'];

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteScore(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 10;
}

function average(values) {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Audit a structured, already-scored product-appeal spec against this
 * skill's own Desirability Triangle gates, 5-Second Test, and anti-pattern
 * detection rules from SKILL.md.
 *
 * Every check below reads a number or boolean the analyst already decided
 * during the Analysis Process (Steps 1-3 in SKILL.md); this script never
 * inspects headline text, images, or a live URL itself — no keyword or
 * text-pattern matching is performed anywhere in this function.
 *
 * @param {unknown} spec - parsed JSON matching schemas/appeal-spec.schema.json.
 * @returns {{pass: boolean, findings: Array<{id: string, severity: string, message: string}>, recommendations: string[], scorecard: object}}
 */
export function auditDesirability(spec) {
  if (!isPlainObject(spec)) {
    throw new Error('spec must be a JSON object');
  }
  if (!Array.isArray(spec.personas) || spec.personas.length === 0) {
    throw new Error('spec.personas must be a non-empty array');
  }
  if (!isPlainObject(spec.fiveSecondTest)) {
    throw new Error('spec.fiveSecondTest must be an object with category/forWho/promise/cta booleans');
  }

  const findings = [];
  const recommendations = [];
  let gatingHit = false;

  function flag(id, severity, message, recommendation, { gating = false } = {}) {
    findings.push({ id, severity, message });
    if (recommendation) recommendations.push(recommendation);
    if (gating) gatingHit = true;
  }

  // --- Desirability Triangle: score each persona, each vertex ---
  const personaScorecards = spec.personas.map((persona, index) => {
    if (!isPlainObject(persona) || typeof persona.name !== 'string' || persona.name.trim() === '') {
      throw new Error(`spec.personas[${index}] must have a non-empty "name"`);
    }
    const vertexScores = {};
    for (const [vertex, fields] of Object.entries(VERTICES)) {
      const sub = persona[vertex];
      if (!isPlainObject(sub)) {
        throw new Error(`spec.personas[${index}] ("${persona.name}") is missing "${vertex}"`);
      }
      const values = fields.map((f) => sub[f]);
      const invalid = fields.filter((f, i) => !isFiniteScore(values[i]));
      if (invalid.length > 0) {
        throw new Error(
          `spec.personas[${index}] ("${persona.name}").${vertex} has invalid field(s): ${invalid.join(', ')} (expected numbers 0-10)`
        );
      }
      const score = average(values);
      vertexScores[vertex] = score;
      if (score < 5) {
        flag(
          'triangle-vertex-below-five',
          'high',
          `${persona.name}: ${vertex} scored ${score.toFixed(1)}/10 (below 5).`,
          `SKILL.md's own decision tree: score each Desirability Triangle vertex 1-10; ${vertex} <5 for "${persona.name}" is the priority fix — address it before polishing the other two vertices.`,
          { gating: true }
        );
      }
    }
    const overall = average(Object.values(vertexScores));
    return { name: persona.name, vertexScores, overall };
  });

  // --- 5-Second Test ---
  const fst = spec.fiveSecondTest;
  const fstChecks = ['category', 'forWho', 'promise', 'cta'];
  const missingFst = fstChecks.filter((k) => typeof fst[k] !== 'boolean');
  if (missingFst.length > 0) {
    throw new Error(`spec.fiveSecondTest missing boolean field(s): ${missingFst.join(', ')}`);
  }
  const clearCount = fstChecks.filter((k) => fst[k] === true).length;
  if (clearCount < 3) {
    const severity = clearCount <= 1 ? 'critical' : 'high';
    flag(
      'five-second-test-failed',
      severity,
      `5-Second Test: only ${clearCount} of 4 elements (what/who/promise/cta) were clear.`,
      'Fix the unclear elements first — SKILL.md scores "2 or fewer clear" as 2-4/10 ("significant rework") and "3 of 4 clear" as the minimum passing bar.',
      { gating: true }
    );
  }

  // --- Trust Ladder Violation ---
  if (spec.trustLadderViolation === true) {
    flag(
      'trust-ladder-violation',
      'high',
      'Page asks for account creation or payment before demonstrating value.',
      'Move the value demonstration before any account/payment ask — see references/trust-ladder.md for the staged rungs.',
      { gating: true }
    );
  }

  // --- Identity Mismatch (explicit flag OR 3+ personas, per SKILL.md's own detection rule) ---
  const personaCount = spec.personas.length;
  const identityMismatchByCount = personaCount >= 3;
  if (spec.identityMismatch === true || identityMismatchByCount) {
    flag(
      'identity-mismatch',
      'medium',
      identityMismatchByCount
        ? `Spec targets ${personaCount} personas (SKILL.md's own detection rule: "Homepage tries to appeal to 3+ different personas").`
        : 'Analyst flagged identityMismatch: the page tries to appeal to too many distinct identities at once.',
      'Pick one dominant identity signal (visual + language + social proof) instead of splitting the page across many personas.',
      { gating: true }
    );
  }

  // --- Feature Soup Headline ---
  if (spec.featureSoupHeadline === true) {
    flag(
      'feature-soup-headline',
      'medium',
      'Headline lists capabilities/buzzwords instead of one outcome.',
      'Replace the feature list with a single outcome-focused promise (see the Feature Soup Headline anti-pattern table in SKILL.md).',
      { gating: true }
    );
  }

  // --- Screenshot Hero ---
  if (spec.screenshotHero === true) {
    flag(
      'screenshot-hero',
      'medium',
      'Hero image is a bare product screenshot with no outcome/context.',
      'Replace the screenshot with a person experiencing the benefit, the outcome, or an abstract visualization of the transformation.',
      { gating: true }
    );
  }

  // --- Objections (non-gating: opportunity, not a stop-ship defect) ---
  let objectionsAddressedCount = null;
  if (isPlainObject(spec.objectionsAddressed)) {
    const unaddressed = OBJECTION_TYPES.filter((t) => spec.objectionsAddressed[t] !== true);
    objectionsAddressedCount = OBJECTION_TYPES.length - unaddressed.length;
    if (unaddressed.length > OBJECTION_TYPES.length / 2) {
      flag(
        'objections-mostly-unaddressed',
        'medium',
        `${unaddressed.length} of ${OBJECTION_TYPES.length} standard objections are unaddressed: ${unaddressed.join(', ')}.`,
        `Address at least "trust" and "risk" first — see references/objection-catalog.md for counters by objection type.`
      );
    }
  } else {
    recommendations.push('No objectionsAddressed block supplied; map the page against the 7 standard objections in references/objection-catalog.md.');
  }

  const scorecard = {
    personas: personaScorecards,
    fiveSecondTest: { ...fst, clearCount },
    objectionsAddressedCount,
    objectionsTotal: OBJECTION_TYPES.length,
  };

  if (findings.length === 0) {
    recommendations.push('Spec passes every structural gate. Spot-check that the underlying scores still match the live page before shipping.');
  }

  return {
    pass: !gatingHit,
    findings,
    recommendations,
    scorecard,
  };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: appeal_audit.mjs --input <spec>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const data = JSON.parse(readFileSync(input, 'utf8'));
    process.stdout.write(`${JSON.stringify(auditDesirability(data), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`appeal_audit: ${error.message}\n`);
    process.exit(1);
  }
}
