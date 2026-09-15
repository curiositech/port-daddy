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

// The 30-Second Shelf Test: the technical-document analogue of the 5-Second
// Test. Five questions, not four, because a technical reader has both a real
// alternative (the standard reference) and a real cost.
const SHELF_TEST_CHECKS = ['subject', 'audience', 'promise', 'cost', 'differentiation'];

// Return on Effort — the fourth vertex the Desirability Triangle grows when the
// price is forty hours instead of thirty seconds. See
// references/technical-document-appeal.md.
const REPRODUCIBILITY_LEVELS = ['code-and-data', 'code-only', 'described-only', 'none'];
const MIN_VERTEX_SCORE = 5;       // SKILL.md's own rule: any vertex <5 is the priority fix
const MIN_PAYOFF_REACH = 0.5;     // surfer model: under half the arrivals see the point
const MIN_COMPLETION = 0.35;
const MIN_TYPOGRAPHIC_CRAFT = 5;

/**
 * Score time-to-first-insight against the reader's patience budget, 0-10.
 * Full marks up to a quarter of the budget; zero at twice it. Linear between.
 */
function timeToFirstInsightScore(ttfiSeconds, budgetSeconds) {
  if (!(budgetSeconds > 0) || !(ttfiSeconds >= 0)) return null;
  const ratio = ttfiSeconds / budgetSeconds;
  if (ratio <= 0.25) return 10;
  if (ratio >= 2) return 0;
  return Math.max(0, Math.min(10, 10 * (1 - (ratio - 0.25) / 1.75)));
}

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
 * Normalise a persona name for joining a scored persona to a reader-map route.
 * This is a foreign-key join between two identifiers the analyst supplied on
 * purpose - not a search or a fuzzy match over unstructured text. Names must
 * correspond exactly up to case and surrounding whitespace.
 */
function personaKey(name) {
  return typeof name === 'string' ? name.trim().toLowerCase() : null;
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
      if (score < MIN_VERTEX_SCORE) {
        flag(
          'triangle-vertex-below-five',
          'high',
          `${persona.name}: ${vertex} scored ${score.toFixed(1)}/10 (below ${MIN_VERTEX_SCORE}).`,
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

  // --- Technical documents and scientific books ---------------------------
  // Optional block. Absent for a landing page; present for a paper, monograph,
  // textbook, or technical whitepaper. Everything here is the analyst's
  // structured judgement — the script never reads the document.
  let technicalScorecard = null;
  const td = spec.technicalDocument;
  if (isPlainObject(td)) {
    // The 30-Second Shelf Test.
    const missingShelf = SHELF_TEST_CHECKS.filter((k) => typeof td.shelfTest?.[k] !== 'boolean');
    if (isPlainObject(td.shelfTest) && missingShelf.length > 0) {
      throw new Error(
        `spec.technicalDocument.shelfTest missing boolean field(s): ${missingShelf.join(', ')}`
      );
    }
    let shelfClear = null;
    if (isPlainObject(td.shelfTest)) {
      shelfClear = SHELF_TEST_CHECKS.filter((k) => td.shelfTest[k] === true).length;
      if (shelfClear < 3) {
        flag(
          'shelf-test-failed',
          shelfClear <= 1 ? 'critical' : 'high',
          `30-Second Shelf Test: only ${shelfClear} of ${SHELF_TEST_CHECKS.length} questions (subject/audience/promise/cost/differentiation) were answerable.`,
          'Fix the unanswerable ones on the cover, the abstract, and the first page of the preface — not deeper in. A reader who cannot answer these is not choosing this on purpose.',
          { gating: true }
        );
      } else if (shelfClear === 3) {
        flag(
          'shelf-test-thin',
          'medium',
          `30-Second Shelf Test: 3 of ${SHELF_TEST_CHECKS.length} clear. The two usually missing are cost and differentiation.`,
          'State the required background and the length up front, and say in one sentence why this rather than the standard reference.'
        );
      }
    }

    // Return on Effort — the fourth vertex.
    let returnOnEffort = null;
    let ttfiScore = null;
    const roe = td.returnOnEffort;
    if (isPlainObject(roe)) {
      const cost = roe.costTransparency;
      const visibility = roe.payoffVisibility;
      const invalid = [
        ['costTransparency', cost],
        ['payoffVisibility', visibility],
      ].filter(([, v]) => !isFiniteScore(v));
      if (invalid.length > 0) {
        throw new Error(
          `spec.technicalDocument.returnOnEffort has invalid field(s): ${invalid.map(([k]) => k).join(', ')} (expected numbers 0-10)`
        );
      }
      ttfiScore = timeToFirstInsightScore(roe.timeToFirstInsightSeconds, roe.patienceBudgetSeconds);
      const parts = ttfiScore === null ? [cost, visibility] : [cost, visibility, ttfiScore];
      returnOnEffort = average(parts);

      if (returnOnEffort < MIN_VERTEX_SCORE) {
        flag(
          'return-on-effort-below-five',
          'high',
          `Return on Effort scored ${returnOnEffort.toFixed(1)}/10 (below ${MIN_VERTEX_SCORE}) — the reader cannot see what they get or what it costs.`,
          'This is the priority fix, ahead of the other three vertices: state the required background and the length, show where the payoff is, and move the first payoff earlier. See references/technical-document-appeal.md.',
          { gating: true }
        );
      }
      if (ttfiScore !== null && roe.timeToFirstInsightSeconds > roe.patienceBudgetSeconds) {
        flag(
          'payoff-outside-patience-budget',
          'high',
          `Time to first insight is ${Math.round(roe.timeToFirstInsightSeconds)}s against a patience budget of ${Math.round(roe.patienceBudgetSeconds)}s.`,
          'Front-load the payoff: state the result, show the figure, or give the worked example before the machinery that earns it. A payoff outside the budget is one most readers buy on credit and never collect.',
          { gating: true }
        );
      }
    }

    // Identity fit, technical form: who is this for, and is the answer honest?
    if (td.audienceDeclared === false) {
      flag(
        'audience-undeclared',
        'high',
        'The document never states who it is for.',
        'Name the reader in the preface or abstract. "For researchers and practitioners alike" is the technical form of identity mismatch — it targets nobody.',
        { gating: true }
      );
    }
    if (td.prerequisitesDeclared === false) {
      flag(
        'prerequisites-undeclared',
        'high',
        'Required background is never stated, so readers self-select wrongly and then blame themselves.',
        'Declare prerequisites honestly up front. It feels like turning readers away; it turns away the readers who were going to abandon at Chapter 3, which raises completion.',
        { gating: true }
      );
    }
    if (td.prerequisitesHonest === false) {
      flag(
        'prerequisites-dishonest',
        'high',
        'Stated prerequisites understate what the document actually assumes.',
        'Correct the stated background to what the hardest load-bearing section really needs. A broken promise on page 40 costs trust as well as readers.',
        { gating: true }
      );
    }

    // Anti-patterns with no landing-page ancestor.
    if (td.resultStatedInAbstract === false) {
      flag(
        'structural-abstract',
        'medium',
        'The abstract describes the document\'s organisation instead of its finding.',
        'State the result. "In Section 2 we introduce..." is free to fix and is the most common single appeal defect in academic writing.'
      );
    }
    if (td.contributionLocatable === false) {
      flag(
        'unlocatable-contribution',
        'medium',
        'A reader cannot tell what is new here versus what is standard.',
        'Mark the contribution explicitly — a "what is new here" paragraph, or a clear separation of recapitulation from result.'
      );
    }
    if (td.figuresSelfContained === false) {
      flag(
        'figures-not-self-contained',
        'medium',
        'Figures cannot be understood without the surrounding prose — the technical form of the Screenshot Hero anti-pattern.',
        'Rewrite captions to state the finding rather than label the axes. Readers go abstract -> figures -> conclusions -> methods, so a figure that needs the body text has thrown away the best entry point the document has.'
      );
    }

    // Trust: what evidence exists that the author checked.
    const repro = td.reproducibilityArtifacts;
    if (repro !== undefined && !REPRODUCIBILITY_LEVELS.includes(repro)) {
      throw new Error(
        `spec.technicalDocument.reproducibilityArtifacts must be one of: ${REPRODUCIBILITY_LEVELS.join(', ')}`
      );
    }
    const noRepro = repro === 'none';
    const noLimits = td.limitationsStated === false;
    if (noRepro && noLimits) {
      flag(
        'trust-evidence-absent',
        'high',
        'No reproducibility artifacts and no stated limitations: nothing shows the author went looking for the failure.',
        'Release code and data, or at minimum state a real limitation. A limitations section that only lists future work is the cheap fake — see the trust-signal table in references/technical-document-appeal.md.'
      );
    } else if (noRepro) {
      flag(
        'reproducibility-artifacts-absent',
        'medium',
        'No code, data, or reproduction path is offered.',
        'Release what you can, with pinned versions. "Should work with recent versions" is the counterfeit of a reproduction script.'
      );
    } else if (noLimits) {
      flag(
        'limitations-unstated',
        'medium',
        'No limitations section, or one that names no real weakness.',
        'Name a limitation a skeptical reader would find anyway. Doing it first is the signal; doing it not at all is also a signal.'
      );
    }

    if (isFiniteScore(td.typographicCraft) && td.typographicCraft < MIN_TYPOGRAPHIC_CRAFT) {
      flag(
        'typographic-craft-low',
        'medium',
        `Typographic craft scored ${td.typographicCraft}/10 — inconsistent notation, mis-set mathematics, or screenshotted figures.`,
        'Fix the setting. On technical material this is the "professional execution" row of the trust triangle doing more work than anywhere else, because the reader has no other cheap proxy for care.'
      );
    }

    // The reader map: routes the document prints for named kinds of reader.
    // Friction asks whether each route works; this asks whether it was worth
    // walking, and whether the persona it names is a persona we are scoring.
    let readerMapScorecard = null;
    const map = td.readerMap;
    if (isPlainObject(map)) {
      const scoredPersonas = new Map(
        spec.personas.map((persona) => [personaKey(persona.name), persona.name])
      );
      const paths = Array.isArray(map.paths) ? map.paths : [];
      const routedPersonas = new Set();

      if (map.declared === false) {
        flag(
          'reader-map-absent',
          spec.personas.length >= 2 ? 'medium' : 'low',
          `The document targets ${spec.personas.length} reader(s) and never says how each should read it.`,
          'Add a reader map. Every reader who has to invent their own route through a long technical document is a reader making a decision you could have made for them, with less information than you have.'
        );
      }
      if (map.discoverable === false) {
        flag(
          'reader-map-undiscoverable',
          'medium',
          'A reader map exists but is not where a skimmer will find it.',
          'Move it to the front matter or the landing page. A map only linear readers find is a map for the people who did not need it.'
        );
      }

      for (const path of paths) {
        if (!isPlainObject(path)) {
          throw new Error('spec.technicalDocument.readerMap.paths[] entries must be objects');
        }
        const routeId = typeof path.id === 'string' && path.id.trim() !== '' ? path.id : '(unnamed route)';
        const key = personaKey(path.persona);
        const matched = key !== null && scoredPersonas.has(key);
        if (matched) routedPersonas.add(key);

        if (!matched) {
          flag(
            'reader-path-persona-unmatched',
            'medium',
            `Reader-map route "${routeId}" addresses ${path.persona ? `"${path.persona}"` : 'no named persona'}, which is not among the personas being scored.`,
            `Either score that persona, or drop the route. A route invented because the structure suggested it, rather than because a reader wants it, costs the map its credibility for the routes that are real.`
          );
        }

        if (Number(path.brokenPrerequisiteCount) > 0) {
          flag(
            'reader-path-broken-prerequisites',
            'high',
            `Route "${routeId}" skips ${path.brokenPrerequisiteCount} prerequisite(s) it then needs.`,
            `Fix the route or gloss the missing concepts inline. This reader trusted the map, which makes the wall they hit the document's fault rather than theirs - and they will not experience it that way.`,
            { gating: true }
          );
        }
        if (path.payoffMatchesPersona === false) {
          flag(
            'reader-path-payoff-mismatch',
            'high',
            `Route "${routeId}" delivers something other than what ${path.persona ? `"${path.persona}"` : 'its named reader'} came for.`,
            'Re-point the route at what this reader wants, or stop naming them. A route that names a reader and rewards someone else is a promise broken in public.',
            { gating: true }
          );
        }
        const reach = path.payoffReachProbability;
        if (typeof reach === 'number' && Number.isFinite(reach) && reach < MIN_PAYOFF_REACH) {
          flag(
            'reader-path-payoff-unreachable',
            'high',
            `Route "${routeId}": only ${(reach * 100).toFixed(0)}% of the readers who take it reach its payoff.`,
            `Shorten the route to its payoff, or move the payoff earlier along it.`,
            { gating: true }
          );
        }
        const routeTtfi = timeToFirstInsightScore(
          path.timeToFirstInsightSeconds,
          path.patienceBudgetSeconds
        );
        if (
          routeTtfi !== null &&
          path.timeToFirstInsightSeconds > path.patienceBudgetSeconds
        ) {
          flag(
            'reader-path-over-budget',
            'high',
            `Route "${routeId}" pays off at ${Math.round(path.timeToFirstInsightSeconds)}s against this reader's budget of ${Math.round(path.patienceBudgetSeconds)}s.`,
            'Give this route its own shorter path to a result. The book\'s overall budget is nobody\'s; a practitioner track promising four hours to someone with one is broken even if every chapter on it is excellent.',
            { gating: true }
          );
        }
      }

      const unserved = [...scoredPersonas.entries()].filter(([key]) => !routedPersonas.has(key));
      if (paths.length > 0 && unserved.length > 0) {
        flag(
          'reader-map-persona-unserved',
          'high',
          `${unserved.length} scored persona(s) have no route in the reader map: ${unserved.map(([, name]) => name).join('; ')}.`,
          'Either add a route for each, or drop them as targets. A persona with no route is a reader the map forgot, and they will read the book in the order it happens to be printed.',
          { gating: true }
        );
      }

      readerMapScorecard = {
        declared: map.declared ?? null,
        discoverable: map.discoverable ?? null,
        routes: paths.length,
        personasScored: scoredPersonas.size,
        personasRouted: routedPersonas.size,
        unservedPersonas: unserved.map(([, name]) => name),
      };
    }

    technicalScorecard = {
      shelfTest: isPlainObject(td.shelfTest)
        ? { ...td.shelfTest, clearCount: shelfClear, total: SHELF_TEST_CHECKS.length }
        : null,
      returnOnEffort,
      timeToFirstInsightScore: ttfiScore,
      reproducibilityArtifacts: repro ?? null,
      typographicCraft: isFiniteScore(td.typographicCraft) ? td.typographicCraft : null,
      readerMap: readerMapScorecard,
    };
  }

  // --- Surfer readout, handed over from ux-friction-analyzer --------------
  // Appeal and friction are two readouts of one chain: friction is the terms
  // that raise the abandon hazard, appeal is the terms that lower it. If the
  // friction skill has already run scripts/surfer_model.mjs on this surface,
  // paste the numbers in and they gate here too.
  let surferScorecard = null;
  if (isPlainObject(spec.surfer)) {
    const reach = spec.surfer.payoffReachProbability;
    const completion = spec.surfer.completion;
    if (typeof reach === 'number' && Number.isFinite(reach) && reach < MIN_PAYOFF_REACH) {
      flag(
        'surfer-payoff-unreachable',
        reach < MIN_PAYOFF_REACH / 2 ? 'critical' : 'high',
        `Surfer model: only ${(reach * 100).toFixed(0)}% of arrivals reach the payoff${spec.surfer.readerMode ? ` in "${spec.surfer.readerMode}" mode` : ''}.`,
        'Appeal cannot be fixed downstream of where people stop. Move the payoff earlier, or promise it legibly before the sections that shed readers.',
        { gating: true }
      );
    }
    if (typeof completion === 'number' && Number.isFinite(completion) && completion < MIN_COMPLETION) {
      flag(
        'surfer-completion-low',
        'medium',
        `Surfer model: ${(completion * 100).toFixed(0)}% of arrivals reach the end.`,
        'Run ux-friction-analyzer on the same graph — a low completion with good appeal scores means the wanting is fine and the getting-through is not.'
      );
    }
    surferScorecard = {
      readerMode: spec.surfer.readerMode ?? null,
      payoffReachProbability: typeof reach === 'number' ? reach : null,
      completion: typeof completion === 'number' ? completion : null,
    };
  }

  // --- Wireframe honesty guard --------------------------------------------
  if (spec.surfaceKind === 'wireframe') {
    recommendations.push(
      'Surface is a wireframe: a wireframe can FAIL appeal but cannot PASS it. Language resonance, visual identity, tone, and real social proof are not present to be scored, so a clean result here means "no structural appeal defect found", never "this will appeal". Say that in the report. See references/surface-appeal-adapters.md.'
    );
  }

  const scorecard = {
    personas: personaScorecards,
    fiveSecondTest: { ...fst, clearCount },
    objectionsAddressedCount,
    objectionsTotal: OBJECTION_TYPES.length,
    surfaceKind: typeof spec.surfaceKind === 'string' ? spec.surfaceKind : null,
    technicalDocument: technicalScorecard,
    surfer: surferScorecard,
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
