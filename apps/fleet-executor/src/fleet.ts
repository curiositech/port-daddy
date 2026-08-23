/**
 * Fleet config parser for the cloud executor.
 *
 * Reads pd-fleet.yml from the repo and extracts ships whose trigger matches
 * a given event. The model selected is the first cloudflare fallback entry,
 * falling back to a sane default per ship.
 *
 * DETERMINISTIC PARSE (2026-06): the parser now uses the real `yaml` package on
 * the ENTIRE document — no truncation, no LLM round-trip. The previous version
 * sliced the YAML to 12000 chars and asked Workers AI to extract JSON, which
 * silently dropped every ship declared past the cutoff (and could hallucinate
 * fields). The deterministic parser reads all ships, every time, and is pure
 * (no `Ai` dependency), so callers can parse once and never re-parse.
 */

import { parse as parseYaml } from 'yaml';
import {
  CF_MODELS,
  CF_ROLE_MODELS,
  CF_ADMITTED_MODELS,
  resolveCfModel,
} from '../../shared/model-registry.generated.js';

import { WORKERS_AI_RATES } from './spend.js';

export interface ShipConfig {
  name: string;
  trigger: string | string[];
  prompt: string;
  cfModel: string;
  /**
   * Model for the MAP fan-out, when it should differ from `cfModel`.
   *
   * MAP scans one chunk in isolation and is forbidden from cross-chunk
   * judgement; REDUCE does the synthesis. Those are different jobs needing
   * different capability, and MAP runs N times to REDUCE's one — so paying the
   * capable model's rate on every chunk spends the most on the stage that needs
   * the least. Undefined means "same as cfModel", which is honest but untiered;
   * see tests/map-reduce-invariants.test.ts for why that is a regression rather
   * than a default.
   */
  cfMapModel?: string;
  /**
   * Purser only: model for the PLAN step, when it should differ from
   * {@link cfModel}. Undefined means "same as cfModel".
   */
  cfPlanModel?: string;
  /**
   * Purser only: model for the per-file AUTHOR step, when it should differ from
   * {@link cfModel}. Undefined means "same as cfModel".
   *
   * Split from {@link cfPlanModel} because the two steps have opposite cost
   * shapes — PLAN is input-heavy and output-tiny, AUTHOR is the reverse — so one
   * model for both is wrong in one direction whichever one is picked.
   */
  cfAuthorModel?: string;
  temperature: number | null;
  role: string;
  telos: string;
  /**
   * When true, this ship can BLOCK the merge: a BLOCK verdict, an error, or a
   * missing/unparseable verdict fails the umbrella check (fail-closed). When
   * false (default), the ship posts findings but never fails the check.
   */
  blocking: boolean;
  /** When true, ship needs execution (bash/write) — dispatch to GHA instead */
  needsExecution: boolean;
  /**
   * When true, this is an IDEATION ship (spark, spider, lookout, snipe): it
   * proposes forward work via the {@link Proposal} schema and its comment is
   * rendered into real actionable Port Daddy syntax, rather than raising
   * file:line findings. Ideation ships are ALWAYS advisory (never blocking) and
   * never gate a merge. Derived from a `class: ideation` field in pd-fleet.yml
   * OR from membership in {@link IDEATION_SHIPS} (belt-and-suspenders so a ship
   * that forgets the field still gets the ideation contract).
   */
  ideation: boolean;
  /**
   * When true, this is a PURSER ship (`class: purser` in pd-fleet.yml): an
   * adversarial gatekeeper that steel-mans the PR into its best-interpretation
   * contract, authors adversarial tests against it, and stacks the reviewed PR
   * on top of a test branch (src/purser.ts). Purser ships run AFTER the
   * reviewer/ideation ships and are OFF unless explicitly declared — there is
   * no purser in {@link defaultPRShips} (safe rollout).
   */
  purser: boolean;
  /**
   * Purser only. When true AND the ship is blocking, the purser BLOCKS when it
   * could not execute its tests (no SANDBOX binding / sandbox error) — an
   * explicit fail-closed opt-in. Default false: never block on tests that were
   * never run.
   */
  blockWithoutSandbox: boolean;
  /**
   * Purser only, optional (`testPaths:` in pd-fleet.yml). Path prefixes the
   * purser's authored test files must live under (e.g. ['tests/purser']).
   * Empty ⇒ any path passing the global stacked-pr whitelist is allowed.
   */
  testPaths: string[];
  /**
   * ANY ship, optional (`graft: [skill-id, ...]` in pd-fleet.yml). Repo skill
   * ids whose `skills/<id>/SKILL.md` is fetched from the TRUSTED default
   * branch and prepended to the ship's prompt under `## Grafted skill: <id>`
   * (src/skill-graft.ts). Capped at {@link MAX_GRAFTS_PER_SHIP} at parse time;
   * unknown ids degrade to a transcript warning, never a failure. A purser
   * declared without a graft list gets {@link PURSER_DEFAULT_GRAFT}.
   */
  graft: string[];
}

/**
 * Ships that are ideation-class by identity, regardless of whether pd-fleet.yml
 * declares `class: ideation`. These four always propose forward work and are
 * always advisory. A repo can add more via `class: ideation` on its own ships.
 */
export const IDEATION_SHIPS: ReadonlySet<string> = new Set([
  'spark',
  'spider',
  'lookout',
  'snipe',
]);

function deriveIdeation(name: string, agentClass: unknown): boolean {
  if (IDEATION_SHIPS.has(name)) return true;
  return agentClass === 'ideation';
}

// Cloudflare AI model selection for the cloud plane.
//
// SUPPLANTED (2026-08-23): these were six hand-maintained constants and a
// hand-rolled allowlist, kept "in sync" with lib/cost-tracker.ts and the daemon
// registry by comment. They drifted, and one of the drifts was a PHANTOM id —
// which on Workers AI does not error, it HANGS, and the caller reads the blank
// as a clean result (#654, and again on 2026-07-03). The ids now come from
// config/models.yaml through a generated artifact, so an id that is not
// catalogued and verified cannot reach `ai.run()` at all.
//
// The POLICY the old constants encoded is preserved and now lives in that same
// source as named cloud-plane roles:
//
//   shipDefault  every ship that does not name a role
//   shipMid      steps whose output on shipDefault was too weak to use
//   reviewBot    the code review bot's DEFAULT — the role a ship gets without
//                asking; a ship may still pin the same id deliberately
//   author       steps that emit whole files rather than commentary
//
// A role sets what a ship gets by DEFAULT. It is not a ceiling: any admitted id
// is pinnable, because a ceiling here was measured doing more harm than good
// (see KNOWN_GOOD_CF_MODELS).
const REVIEW_BOT_CF_MODEL = CF_ROLE_MODELS.reviewBot; // code review bot ONLY
const CHEAP_CF_MODEL = CF_ROLE_MODELS.shipDefault; // every other ship
const WORKING_CF_MODEL = CHEAP_CF_MODEL; // guard fallback: cheap + verified working
const DEFAULT_CF_MODEL = CHEAP_CF_MODEL; // every ship except the review bot
const CODER_CF_MODEL = REVIEW_BOT_CF_MODEL; // the code review bot only

// The mid tier has no constant here any more. It had one because the purser's
// AUTHOR step defaulted to it; that default moved to the `author` role on live
// evidence, leaving this binding unreferenced. The tier is still reachable —
// `cf_role: shipMid` resolves through CF_ROLE_MODELS like any other role — and
// everything the constant's docblock explained (the input-heavy/output-heavy
// shape, and why #6813's theory was retired) now lives on the catalog rows in
// config/models.yaml, next to the prices that make the argument.


/**
 * Resolve a pd-fleet.yml model TOKEN — a declared name — to a concrete id.
 *
 * pd-fleet.yml no longer carries model ids (supplant, 2026-08-23). A ship names
 * either a cloud-plane ROLE (`cf_role: shipMid`) or a capability RUNG
 * (`capability: cheap`), and both vocabularies are declared in
 * config/models.yaml and reach this file through the generated registry. The
 * reason is not tidiness: a literal in this YAML was a literal nobody verified,
 * and an unverified Workers AI id does not error — it hangs.
 *
 * The design intent is that unrecognised input degrades identically to how a
 * bad id used to: this returns undefined so every existing guard keeps its
 * behavior unchanged: the caller treats it exactly as it treated an id outside
 * the known-good set, which is to drop the pin rather than dispatch it.
 *
 * @param raw The operator's YAML value, in any spelling.
 * @returns The concrete Workers AI id, or undefined when the token is unknown.
 */
function resolveModelToken(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const token = raw.trim();
  if (!token) return undefined;
  if (token in CF_ROLE_MODELS) return CF_ROLE_MODELS[token as keyof typeof CF_ROLE_MODELS];
  if (token in CF_MODELS) return CF_MODELS[token as keyof typeof CF_MODELS];
  // A literal admitted id. Config may name one directly — that is how
  // pd-fleet.yml records the fleet's measured per-ship assignments, and what
  // the Shipwright's model board hands an operator to paste. A declared pin is
  // config data checked against the catalog, not a hardcoded id in code, and
  // the difference is that this one cannot name a model that does not exist.
  if (CF_ADMITTED_MODELS.includes(token)) return token;
  return undefined;
}

// Tools that require local execution (can't run in a Worker). Matches any
// Bash(...) tool whose command is NOT `gh` (gh runs fine against the API).
const EXECUTION_TOOLS_RE = /Bash\((?!gh)[^)]*\)/;

/**
 * Ships that are CLOUD-STATIC reviewers by contract: they analyze the diff and
 * existing tests but NEVER execute. `qa` historically lists `Bash(npm test*)`
 * in `allowedTools` (a relic of its local-runner past); the cloud executor runs
 * it as a static reviewer per fleet/ships/qa.md, so we force needsExecution=false
 * for it regardless of allowedTools.
 */
const CLOUD_STATIC_SHIPS = new Set(['qa']);

interface RawFallback {
  backend?: string;
  /**
   * A capability RUNG (`cheap` | `balanced` | `high` | `max-thinking` | `code`)
   * or a cloud-plane role name — a token that survives a model swap, so a
   * fleet config does not need editing when the fleet re-tiers. Resolved by
   * {@link resolveModelToken}, which also accepts `model:` below.
   */
  capability?: string;
  /**
   * A literal admitted Workers AI id.
   *
   * Kept, deliberately, after a revision of this file removed it: pd-fleet.yml
   * uses it to record the fleet's MEASURED per-ship assignments — which model
   * actually reviewed code well, which one authored tests that ran — and a
   * capability rung cannot express a choice made about one specific model. The
   * two spellings are not redundant: a role says "whatever fills this job", an
   * id says "this one, because we measured it".
   */
  model?: string;
}

interface RawAgent {
  trigger?: string | string[];
  prompt?: string;
  backend?: string;
  fallbacks?: RawFallback[];
  allowedTools?: string;
  telos?: string;
  role?: string;
  temperature?: unknown;
  blocking?: unknown;
  class?: unknown;
  /** Any ship: cloud-plane ROLE pin (`cf_role:`), guarded by CF_ADMITTED_MODELS. */
  cf_role?: unknown;
  /** Purser: block when tests could not be executed (default false). */
  blockWithoutSandbox?: unknown;
  /** Purser: path prefixes authored tests must live under. */
  testPaths?: unknown;
  /** Any ship: repo skill ids to graft onto the prompt (skill-graft.ts). */
  graft?: unknown;
  /**
   * Any ship: the cloud-plane role that scans ONE chunk (`map_cf_role:` in
   * pd-fleet.yml; `mapCfRole` accepted too). REDUCE keeps the ship's `cfModel`.
   *
   * Readable from YAML and not only from code because a tiering only the
   * hardcoded fallback ships can express is a tiering the operator cannot use
   * -- exactly the half-implemented shape map-reduce-invariants.test.ts exists
   * to make impossible.
   */
  map_cf_role?: unknown;
  mapCfRole?: unknown;
  /**
   * The same MAP pin as a literal id. Every step token below accepts BOTH
   * spellings, and both are load-bearing rather than one being legacy: a role
   * says "whatever fills this job" and survives a re-tier untouched, while an
   * id records a choice made about one specific model — which is exactly what
   * pd-fleet.yml's per-ship assignments are, each one measured.
   */
  map_model?: unknown;
  mapModel?: unknown;
  cfMapModel?: unknown;
  /** Purser: role for the PLAN step (`plan_cf_role:`; camelCase accepted). */
  plan_cf_role?: unknown;
  planCfRole?: unknown;
  /** Purser: the PLAN step as a literal id. */
  plan_model?: unknown;
  planModel?: unknown;
  cfPlanModel?: unknown;
  /** Purser: role for the per-file AUTHOR step (`author_cf_role:`). */
  author_cf_role?: unknown;
  authorCfRole?: unknown;
  /** Purser: the AUTHOR step as a literal id. */
  author_model?: unknown;
  authorModel?: unknown;
  cfAuthorModel?: unknown;
}

/**
 * Coerce a YAML-ish truthy value into a strict boolean. Operator typos
 * (`blocking: yes`) default to `false` for safety — only an explicit, real
 * truthy value opts a ship into the merge gate.
 */
function coerceBlocking(value: unknown): boolean {
  return value === true || value === 'true';
}

function coerceTemperature(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value < 0 || value > 2) return null;
  return value;
}

/**
 * The code review bot(s) — the ONLY ships that get the expensive-but-capable
 * {@link CODER_CF_MODEL} (gpt-oss-120b). SUFFIX match (`*reviewer`), not
 * substring: a substring match on the *expensive* side is a budget leak (a ship
 * named e.g. `non-reviewer-audit` must NOT route onto the pricey model). Matches
 * `code-reviewer`, `my-reviewer`; excludes `reviewer-adjacent`, `qa`, red-team.
 */
function isReviewBot(name: string): boolean {
  return name.endsWith('reviewer');
}

/**
 * Derive the Cloudflare Workers AI model for a ship:
/**
 * Cloudflare model ids the executor honors as an explicit ship pin.
 *
 * WHAT THIS SET GUARDS (recalibrated 2026-08-22, operator directive): it exists
 * to stop SILENT-BLANK ids, not to enforce a price ceiling. An unknown Workers
 * AI id does not error — it yields a blank the parser reads as "clean",
 * silencing the ship; #654's phantom kimi ids are the tombstone. The old "no pin
 * can reach the priciest model" ratchet was retired with data: over a live
 * 14-day window the busiest ship's entire Workers AI spend was under $0.90,
 * while the guard was quietly remapping red-team's declared gpt-oss-120b pin and
 * code-reviewer's declared kimi-k2.7-code pin down to the cheap tier —
 * protecting pennies by degrading two ships the operator had deliberately
 * tiered up. A declared pin is honored iff the id is verified to exist.
 *
 * The admission contract used to be three separate facts kept in step by three
 * separate tests: the id is Cloudflare-hosted, it has a rate row in
 * WORKERS_AI_RATES, and it has a MODEL_CONTEXT_TOKENS entry. Those are now ONE
 * catalog row in config/models.yaml, so the contract holds by construction —
 * a model cannot be admitted without being priced and context-known, because
 * admission, price and context window are the same row.
 *
 * Being honored is not an endorsement: assignments are chosen on evidence and
 * judged on the scoreboard. Documented exclusions live with the rows they
 * exclude — the catalog's Deprecated tier (retirable ⇒ blank risk), ids with no
 * published price (unmeterable), safety classifiers and non-text models (not
 * generators), and the #654 phantom tombstones.
 */
export const KNOWN_GOOD_CF_MODELS: ReadonlySet<string> = new Set(CF_ADMITTED_MODELS);

/**
 * Guard a requested Workers AI id, re-exported from the generated registry.
 *
 * The implementation moved to the shared artifact so the relay parser and this
 * executor cannot disagree about what is admitted — they previously each had
 * their own, and the relay's honored ANY `@cf/`-prefixed string, so the surface
 * an operator validates a config against would certify a model the executor
 * refuses. The name stays here because callers and tests already know it.
 */
export { resolveCfModel };

/**
 * The Workers AI model one ship runs on.
 *
 * Reads the ship's first `cloudflare` fallback and honors its declared pin when
 * the id is admitted; anything else falls through to the ship's name default.
 * The `break` is deliberate — a cloudflare fallback that declares nothing
 * honorable means "run the default", not "keep looking down the list".
 *
 * @param agent The raw pd-fleet.yml ship block.
 * @param name The ship's name, which decides the default.
 * @returns A concrete, admitted Workers AI model id.
 */
function deriveCfModel(agent: RawAgent, name: string): string {
  for (const fb of agent.fallbacks ?? []) {
    if (fb?.backend !== 'cloudflare') continue;
    // Both vocabularies are accepted, stable token first: `capability:`/a role
    // name survives a model swap, a literal id records a measured choice.
    const pinned = resolveModelToken(fb.capability) ?? resolveModelToken(fb.model);
    if (pinned && KNOWN_GOOD_CF_MODELS.has(pinned)) return pinned;
    break; // a cloudflare fallback with no honorable pin → the name default
  }
  return isReviewBot(name) ? CODER_CF_MODEL : DEFAULT_CF_MODEL;
}

/**
 * The MAP-stage model for a ship, from `map_cf_role:` in pd-fleet.yml.
 *
 * Rationale: MAP runs once per chunk and REDUCE runs once, so the cheap model
 * belongs on the stage that repeats. Making this operator-settable is the
 * difference between a tiering feature and a tiering that only the built-in
 * fallback ships happen to have.
 *
 * Three guards, each for a failure that would otherwise be silent:
 *
 *   1. An id outside {@link KNOWN_GOOD_CF_MODELS} is DROPPED, not remapped.
 *      A nonexistent Workers AI id does not error -- it returns a blank the
 *      parser reads as "clean" -- so a typo here would silence every chunk of
 *      the ship while REDUCE dutifully reported nothing found. Dropping falls
 *      back to an untiered run: more expensive, but never mute.
 *   2. A MAP pin equal to the ship's REDUCE model is dropped as a no-op, so
 *      `mapModelFor(ship) !== reduceModelFor(ship)` stays a meaningful claim.
 *   3. A MAP pin more expensive than the ship's REDUCE model is economically
 *      backward (MAP repeats per chunk; REDUCE runs once) — that direction is
 *      enforced by map-reduce-invariants.test.ts against the live rate table
 *      rather than by shrinking the honored set.
 *
 * @param agent the raw pd-fleet.yml agent entry
 * @param cfModel the ship's already-resolved REDUCE model
 * @returns the MAP model id, or undefined for an untiered ship
 */
function deriveMapModel(agent: RawAgent, cfModel: string): string | undefined {
  // MAP has no default tier: an absent or unusable pin means "run untiered".
  const pin = deriveStepModel(
    agent.map_cf_role ?? agent.mapCfRole ?? agent.map_model ?? agent.mapModel ?? agent.cfMapModel,
    cfModel,
    'map_cf_role',
  ).model;
  if (pin === undefined) return undefined;
  // Economic direction guard: MAP repeats per chunk, REDUCE runs once, so a
  // MAP model with a higher blended rate than the ship's REDUCE model spends
  // the most where the least capability is needed. Now that the known-good
  // set includes premium ids (2026-08-22), the direction is enforced HERE by
  // construction rather than by the honored set's price ceiling — a backward
  // pin is dropped to an untiered run, matching the unusable-pin posture.
  // Blend weighted toward input (diffs are input-heavy), the same shape
  // map-reduce-invariants.test.ts asserts over the default ships.
  //
  // Unpriced-id semantics (pd-code-reviewer HIGH on #9249, examined): an
  // unpriced id blends to +Infinity. For the PIN that is deliberate — an
  // unpriced pin can never pass as "cheaper" and is dropped. For the REDUCE
  // model the Infinity case is UNREACHABLE by construction: cfModel is always
  // either a KNOWN_GOOD id or a role default, and the admission-contract test
  // (spend.test.ts) forces every KNOWN_GOOD id to have a rate row. Were that
  // invariant ever broken, blended(cfModel)=Infinity makes this guard KEEP
  // the pin (fail-open tiering), not drop it — the opposite of the reported
  // failure mode, and the safe direction.
  /**
   * Blended $/M for one model — the comparison currency for the direction
   * guard above; an unpriced id blends to +Infinity by design so it can never
   * pass as "cheaper".
   * @param m Workers AI model id
   * @returns blended per-million-token USD rate
   */
  const blended = (m: string): number => {
    const r = WORKERS_AI_RATES[m];
    return r ? r.input * 0.8 + r.output * 0.2 : Number.POSITIVE_INFINITY;
  };
  if (blended(pin) > blended(cfModel)) {
    console.warn(
      `[fleet-executor] map_cf_role '${pin}' is pricier than the ship's reduce model ` +
        `'${cfModel}'; fan-out on the pricier tier is economically backward — running untiered`,
    );
    return undefined;
  }
  return pin;
}

/**
 * Resolve ONE step's role pin against {@link KNOWN_GOOD_CF_MODELS}.
 *
 * Shared by every per-step tier ({@link deriveMapModel} and the purser's
 * plan/author steps) so there is exactly one place where an unknown token is
 * dropped. Duplicating this guard per step is how one step quietly ends up
 * remapping where the others drop.
 *
 * @param raw the operator's value, in any of the accepted spellings
 * @param shipModel the ship's already-resolved default model
 * @param label the YAML key, for the warning
 * @returns the pinned id, or undefined to mean "use the ship's own model"
 */
function deriveStepModel(raw: unknown, shipModel: string, label: string): StepPin {
  if (typeof raw !== 'string') return { supplied: false };
  const token = raw.trim();
  if (!token) {
    // `plan_cf_role: ""` falls back to the tier default like any unusable pin,
    // but it is NOT the same as the key being absent: someone typed the key and
    // left it blank. Staying silent there was inconsistent with the unknown-id
    // path below, which warns — so the one config mistake most likely to be a
    // half-finished edit was the one mistake that produced no output at all.
    // (Raised HIGH by pd-code-reviewer on #6813.)
    console.warn(
      `[fleet-executor] ${label} is present but empty; using the step default. ` +
        `Remove the key to silence this, or name a pinnable cloud-plane role.`,
    );
    return { supplied: false };
  }
  const pin = resolveModelToken(token);
  if (!pin || !KNOWN_GOOD_CF_MODELS.has(pin)) {
    console.warn(
      `[fleet-executor] ${label} '${token}' is not a pinnable cloud-plane role or ` +
        `capability; running this step untiered rather than risking a silent blank stage`,
    );
    return { supplied: false };
  }
  // A pin equal to the ship's own model resolves to undefined (repo convention:
  // absent means "same as cfModel") but is still SUPPLIED, so a caller with a
  // default knows not to override it. Collapsing those two cases is what made
  // an operator pinning back down to the cheap model get silently upgraded.
  return { supplied: true, ...(pin === shipModel ? {} : { model: pin }) };
}

/**
 * The outcome of reading one step's model pin.
 *
 * `supplied` answers "did the operator make a choice here?" — distinct from
 * `model`, which answers "which model, if it differs from the ship's own". A
 * step with a DEFAULT must apply that default only when nothing was supplied;
 * a step without one (map) treats both the same.
 */
interface StepPin {
  supplied: boolean;
  model?: string;
}

/**
 * The purser's PLAN-step model. Defaults to the cheap model.
 *
 * PLAN reads the whole diff and emits a handful of paths, so its cost is
 * dominated by INPUT — exactly where the cheap model's $0.051/M wins and the
 * mid tier's $0.200/M would be paid for nothing. Naming files is not the step
 * that needed more capability.
 */
function derivePurserPlanModel(agent: RawAgent, cfModel: string): string | undefined {
  const pin = deriveStepModel(
    agent.plan_cf_role ?? agent.planCfRole ?? agent.plan_model ?? agent.planModel ?? agent.cfPlanModel,
    cfModel,
    'plan_cf_role',
  );
  if (pin.supplied) return pin.model;
  return CHEAP_CF_MODEL === cfModel ? undefined : CHEAP_CF_MODEL;
}

/**
 * The purser's per-file AUTHOR-step model default: the strongest verified
 * Workers AI tier, because this step's failures gate the whole fleet.
 *
 * Why not the mid tier anymore (operator ruling 2026-08-22, on live D1
 * evidence): with gpt-oss-20b authoring, a 14-day window recorded 121
 * authored-test sets ending NON-EXECUTABLE, an author-repair loop failing 83
 * of 110 rewrites (75%), and 124 purser BROKEN-SHIP runs — which adjudicated
 * to fleet-wide neutral on 249 of 584 runs (#8870). The cost delta of
 * authoring on gpt-oss-120b (output $0.750/M vs $0.300/M over ~2.5M purser
 * output tokens per two weeks) is about a dollar; the mid tier was saving
 * that dollar by burning the fleet's verdict signal.
 *
 * Which strong tier (revised same day, repertoire expansion): the author step
 * IS agentic coding — emit a runnable file against a real repo tree — and the
 * independent record for deepseek-v4-flash-0731 on exactly that shape
 * (Terminal-Bench 2.1 82.7, DeepSWE 54.4; it beats DeepSeek's own Pro on nine
 * agent benchmarks) is far stronger than gpt-oss-120b's mixed code-domain
 * record, at a comparable blended price ($0.44/$1.32 vs $0.35/$0.75) and a 1M
 * context that ends diff-truncation for authoring. The repair rewrite stays
 * on {@link REPAIR_ESCALATION_MODEL} (gpt-oss-120b) deliberately: author and
 * repairer now come from different model families, so one family's blind
 * spot cannot both write and "fix" the same broken file. Judged on its
 * after-window via scripts/fleet-ship-stats.mjs.
 */
const AUTHOR_CF_MODEL = CF_ROLE_MODELS.author;

/**
 * The purser's per-file AUTHOR-step model. Defaults to {@link AUTHOR_CF_MODEL}.
 *
 * This is the step whose output is a runnable source file, and the one whose
 * failures are expensive in both directions: a weak model writes tests that
 * look plausible and do not run, and since those tests become a merge gate, a
 * bad one blocks a good PR — or, under the broken-ship doctrine, gates the
 * whole fleet. An operator can still pin the step down to a cheaper tier
 * (`author_model:`), guarded by the same known-good set.
 *
 * @param agent the raw pd-fleet.yml purser entry
 * @param cfModel the ship's already-resolved default model
 * @returns the AUTHOR-step model id, or undefined for "same as cfModel"
 */
function derivePurserAuthorModel(agent: RawAgent, cfModel: string): string | undefined {
  const pin = deriveStepModel(
    agent.author_cf_role ?? agent.authorCfRole ?? agent.author_model ?? agent.authorModel ?? agent.cfAuthorModel,
    cfModel,
    'author_cf_role',
  );
  if (pin.supplied) return pin.model;
  return AUTHOR_CF_MODEL === cfModel ? undefined : AUTHOR_CF_MODEL;
}

/**
 * Fallback persona prompt for a purser ship declared without a `prompt:` — the
 * purser's operational prompts (steel-man + test authoring) are built in
 * src/purser.ts; the YAML prompt only flavors its persona, so a minimal config
 * (`class: purser` + trigger) still works.
 */
const PURSER_DEFAULT_PROMPT =
  'You are pd-purser, the fleet’s adversarial purser. Steel-man each PR into ' +
  'the strongest, most complete interpretation of its contract, then demand the ' +
  'PR satisfy that interpretation — not its laziest reading. Firm, adversarial, ' +
  'professional. Demands come with reasons; never abuse.';

/** Purser model: honor a direct `cf_role:` pin when pinnable, else the usual derivation. */
function derivePurserModel(agent: RawAgent, name: string): string {
  const pinned = resolveModelToken(agent.cf_role);
  if (pinned && KNOWN_GOOD_CF_MODELS.has(pinned)) return pinned;
  return deriveCfModel(agent, name);
}

/** Coerce a YAML list value into a clean string[] (drops non-strings/blanks). */
function coerceStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
}

/** Hard cap on grafted skills per ship (mirrors skill-graft.ts). */
export const MAX_GRAFTS_PER_SHIP = 3;

/**
 * Default skill graft for a purser declared without a `graft:` list — the two
 * repo skills that most directly sharpen its job (both verified to exist in
 * skills/): the adversarial-test-harness playbook and the steel-man method.
 */
export const PURSER_DEFAULT_GRAFT: readonly string[] = [
  'sandboxed-adversarial-test-harness',
  'steel-man-argument',
];

/**
 * Derive a ship's skill-graft list from its `graft:` config. Capped at
 * {@link MAX_GRAFTS_PER_SHIP}. A purser with no configured graft gets
 * {@link PURSER_DEFAULT_GRAFT}; every other ship defaults to none.
 */
function deriveGraft(value: unknown, purser: boolean): string[] {
  const ids = coerceStringList(value).slice(0, MAX_GRAFTS_PER_SHIP);
  if (ids.length === 0 && purser) return [...PURSER_DEFAULT_GRAFT];
  return ids;
}

function deriveNeedsExecution(name: string, allowedTools: unknown): boolean {
  if (CLOUD_STATIC_SHIPS.has(name)) return false;
  return EXECUTION_TOOLS_RE.test(typeof allowedTools === 'string' ? allowedTools : '');
}

/**
 * Does a ship's trigger (string or array) match the requested event trigger?
 * Matches an exact trigger (`pull_request:opened`) or a wildcard
 * (`pull_request:*`). A ship triggered on a different action (e.g.
 * `pull_request:merged`) does NOT match `pull_request:opened`.
 */
function triggerMatches(trigger: unknown, requested: string): boolean {
  const reqEvent = requested.split(':')[0];
  const triggers = Array.isArray(trigger) ? trigger : [trigger];
  return triggers.some(
    t => typeof t === 'string' && (t === requested || t === `${reqEvent}:*`),
  );
}

/**
 * TENANCY CONSENT (cloud squid): does this repo's pd-fleet.yml opt in to
 * fleet-cloud coordination events? The executor announces run lifecycle events
 * (run-started / ship-verdict / pr-stacked / run-concluded — src/squid-events.ts)
 * onto the shared relay channel; those events carry the tenant's repo name, PR
 * numbers, ship verdicts, and stacked-PR urls, so emission requires the TENANT'S
 * explicit consent, not just the operator's env wiring.
 *
 * Consent is a top-level `squidEvents: true` under `fleet:` in pd-fleet.yml,
 * read from the TRUSTED default branch (same zero-trust fetch as the ship
 * config — never the PR head). Strict coercion, same rules as `blocking:`:
 * only `true` / `'true'` opt in; absent key, `yes`, `1`, an unparseable doc,
 * or a missing pd-fleet.yml all mean NO (default false, fail-closed).
 */
export function parseFleetSquidEvents(fleetYaml: string): boolean {
  let doc: unknown;
  try {
    doc = parseYaml(fleetYaml);
  } catch {
    return false;
  }
  const fleet = (doc as { fleet?: { squidEvents?: unknown } } | null)?.fleet;
  if (!fleet || typeof fleet !== 'object') return false;
  const value = fleet.squidEvents;
  return value === true || value === 'true';
}

/**
 * XO CONSENT: does this repo's pd-fleet.yml opt in to the XO synthesis officer
 * (src/xo.ts)? The XO adds two ADVISORY behaviors — an editor pass that
 * curates ideation proposals before they are filed, and an "XO's orders"
 * triage section on the review comment — both of which spend extra Workers AI
 * tokens and add model-judged text to the tenant's PR surfaces, so they are
 * opt-in per tenant, never ambient.
 *
 * Same rules and same rationale as {@link parseFleetSquidEvents}: a top-level
 * `xo: true` under `fleet:` in pd-fleet.yml, read from the TRUSTED default
 * branch (never the PR head — the zero-trust invariant). Strict coercion: only
 * `true` / `'true'` opt in; absent key, `yes`, `1`, an unparseable doc, or a
 * missing pd-fleet.yml all mean NO (default false, fail-closed on consent).
 *
 * @param fleetYaml The raw pd-fleet.yml body from the trusted default branch.
 * @returns True only when the tenant explicitly opted in with `xo: true`.
 */
export function parseFleetXo(fleetYaml: string): boolean {
  let doc: unknown;
  try {
    doc = parseYaml(fleetYaml);
  } catch {
    return false;
  }
  const fleet = (doc as { fleet?: { xo?: unknown } } | null)?.fleet;
  if (!fleet || typeof fleet !== 'object') return false;
  const value = fleet.xo;
  return value === true || value === 'true';
}

/** The tenant's mediator opt-in block (grand-plan node mediator-body). */
export interface FleetMediatorConfig {
  /** True only on an explicit `enabled: true` (fail-closed consent). */
  enabled: boolean;
  /** 'namespace/name' of the relay harbor conflict parleys convene in. */
  harbor: string | null;
  /** The irreversible action the human gate guards, when declared. */
  action: 'merge' | 'revert' | 'force-push' | null;
  /** author login (lowercased) → daemon fingerprint that speaks for them (D11). */
  daemons: Record<string, string>;
}

/**
 * MEDIATOR CONSENT: does this repo's pd-fleet.yml opt in to symbol-level
 * conflict prediction and auto-convened parleys (src/mediator.ts)? The
 * mediator posts neutral check runs on the tenant's PRs and reports predicted
 * conflicts — with PR numbers, author logins, and symbol names — to the
 * relay, so it is opt-in per tenant exactly like squidEvents and xo, never
 * ambient. Shape, under `fleet:`:
 *
 *   mediator:
 *     enabled: true                # required, strict (true / 'true' only)
 *     harbor: alice/dock           # required for convening (ns/name)
 *     action: merge                # optional; creates the human gate
 *     daemons:                     # optional; agent-first summons targets
 *       alice: <64-hex fingerprint>
 *
 * Same zero-trust rule as every other config read: TRUSTED default branch
 * only, never the PR head. Anything malformed degrades to disabled or to the
 * affected field's absence — a config typo must never widen behavior.
 *
 * @param fleetYaml The raw pd-fleet.yml body from the trusted default branch.
 * @returns The parsed mediator config; `enabled: false` on any refusal path.
 */
export function parseFleetMediator(fleetYaml: string): FleetMediatorConfig {
  const off: FleetMediatorConfig = { enabled: false, harbor: null, action: null, daemons: {} };
  let doc: unknown;
  try {
    doc = parseYaml(fleetYaml);
  } catch {
    return off;
  }
  const fleet = (doc as { fleet?: { mediator?: unknown } } | null)?.fleet;
  if (!fleet || typeof fleet !== 'object') return off;
  const m = (fleet as { mediator?: unknown }).mediator;
  if (!m || typeof m !== 'object' || Array.isArray(m)) return off;
  const mm = m as { enabled?: unknown; harbor?: unknown; action?: unknown; daemons?: unknown };
  if (mm.enabled !== true && mm.enabled !== 'true') return off;

  const harbor =
    typeof mm.harbor === 'string' && /^[^/\s]+\/[^/\s]+$/.test(mm.harbor.trim())
      ? mm.harbor.trim().toLowerCase()
      : null;
  const action =
    mm.action === 'merge' || mm.action === 'revert' || mm.action === 'force-push' ? mm.action : null;
  const daemons: Record<string, string> = {};
  if (mm.daemons && typeof mm.daemons === 'object' && !Array.isArray(mm.daemons)) {
    for (const [login, fp] of Object.entries(mm.daemons as Record<string, unknown>)) {
      if (typeof fp === 'string' && /^[0-9a-f]{64}$/i.test(fp.trim())) {
        daemons[login.toLowerCase()] = fp.trim().toLowerCase();
      }
    }
  }
  return { enabled: true, harbor, action, daemons };
}

/**
 * Deterministically parse pd-fleet.yml and return every ship whose trigger
 * matches `trigger`. Pure (no Workers AI). Reads the ENTIRE document.
 *
 * Ships without a `prompt` (e.g. deterministic-body ships like harbor-pilot that
 * carry `body:` instead) are skipped — the cloud executor only runs prompt-driven
 * LLM ships. Returns `null` when the document can't be parsed or yields no
 * matching ship, so callers fall back to {@link defaultPRShips} exactly once.
 */
export function parseFleetShips(fleetYaml: string, trigger: string): ShipConfig[] | null {
  let doc: unknown;
  try {
    doc = parseYaml(fleetYaml);
  } catch {
    return null;
  }

  const agents = (doc as { fleet?: { agents?: Record<string, unknown> } } | null)?.fleet?.agents;
  if (!agents || typeof agents !== 'object') return null;

  const ships: ShipConfig[] = [];
  for (const [name, rawUnknown] of Object.entries(agents)) {
    if (!rawUnknown || typeof rawUnknown !== 'object') continue;
    const agent = rawUnknown as RawAgent;
    if (!triggerMatches(agent.trigger, trigger)) continue;

    const purser = agent.class === 'purser';
    const rawPrompt = typeof agent.prompt === 'string' ? agent.prompt.trim() : '';
    // A purser ship's operational prompts are built in code (src/purser.ts), so
    // its YAML `prompt:` is optional persona flavor; every other ship without a
    // prompt is a deterministic/bodied ship (or malformed) and is skipped.
    const prompt = rawPrompt || (purser ? PURSER_DEFAULT_PROMPT : '');
    if (!prompt) continue; // deterministic/bodied ships and malformed entries

    const telos = typeof agent.telos === 'string' ? agent.telos : '';
    const role = telos || (typeof agent.role === 'string' ? agent.role : '') || `${name} ship`;
    const ideation = purser ? false : deriveIdeation(name, agent.class);
    const shipCfModel = purser ? derivePurserModel(agent, name) : deriveCfModel(agent, name);
    const shipMapModel = deriveMapModel(agent, shipCfModel);
    // Per-step tiers exist only for the purser, whose steps genuinely differ in
    // job and cost shape. Deriving them for every ship would put two keys in
    // every snapshot that nothing reads.
    const shipPlanModel = purser ? derivePurserPlanModel(agent, shipCfModel) : undefined;
    const shipAuthorModel = purser ? derivePurserAuthorModel(agent, shipCfModel) : undefined;

    ships.push({
      name,
      trigger: agent.trigger as string | string[],
      prompt,
      cfModel: shipCfModel,
      // MAP-stage pin, dropped rather than remapped when unusable -- see
      // deriveMapModel(). Spread so an untiered ship has NO key at all rather
      // than an explicit undefined, keeping `cfMapModel` absent in snapshots.
      ...(shipMapModel ? { cfMapModel: shipMapModel } : {}),
      // Same spread-when-present rule as cfMapModel: an untiered step has NO key
      // rather than an explicit undefined.
      ...(shipPlanModel ? { cfPlanModel: shipPlanModel } : {}),
      ...(shipAuthorModel ? { cfAuthorModel: shipAuthorModel } : {}),
      temperature: coerceTemperature(agent.temperature),
      role,
      telos,
      // Ideation ships are advisory by definition — they can never gate a merge,
      // even if pd-fleet.yml mistakenly sets `blocking: true` on one.
      blocking: ideation ? false : coerceBlocking(agent.blocking),
      // Purser runs entirely against the GitHub API + Workers AI: cloud-executable
      // by contract, regardless of any allowedTools relic.
      needsExecution: purser ? false : deriveNeedsExecution(name, agent.allowedTools),
      ideation,
      purser,
      blockWithoutSandbox: purser ? coerceBlocking(agent.blockWithoutSandbox) : false,
      testPaths: purser ? coerceStringList(agent.testPaths) : [],
      graft: deriveGraft(agent.graft, purser),
    });
  }

  return ships.length > 0 ? ships : null;
}

/**
 * Built-in fallback ship configs for the four PR-review ships.
 * Used when pd-fleet.yml can't be fetched or parsed.
 *
 * code-reviewer and red-team are gate-keepers (blocking: true); qa and
 * copy-pm are advisory (blocking: false). This matches the BLOCKING spec's
 * recommended opt-in posture.
 */
export function defaultPRShips(): ShipConfig[] {
  return [
    {
      name: 'code-reviewer',
      trigger: 'pull_request:opened',
      prompt: `You are pd-reviewer, a code reviewer for the Port Daddy project.

Review the PR diff below. Look for:
- Bugs, logic errors, off-by-one errors, null dereferences
- Security issues (injection, auth bypass, secret leaks)
- Violations of patterns established in existing code
- TypeScript type safety issues
- Missing error handling at system boundaries

Output format:
- Severity-ranked list of findings (HIGH / MED / LOW)
- Each finding: file:line, severity, description, suggested fix
- If nothing notable: output nothing (silence = clean)
- No praise, no "looks good", no filler

Be direct. Cite specific lines. Flag ADR violations if you see them.`,
      cfModel: CODER_CF_MODEL,
      // MAP scans chunks in isolation; REDUCE synthesises across them. Only the
      // latter needs the capable model, and MAP runs once per chunk — on a
      // 92-chunk diff that is 92 calls at 6.9x the input rate for work the
      // cheap model does as well.
      cfMapModel: CHEAP_CF_MODEL,
      temperature: null,
      role: 'Catch the bugs the diff would otherwise ship.',
      telos: 'Catch the bugs the diff would otherwise ship; cite ADRs.',
      blocking: true,
      needsExecution: false,
      ideation: false,
      purser: false,
      blockWithoutSandbox: false,
      testPaths: [],
      graft: [],
    },
    {
      name: 'qa',
      trigger: 'pull_request:opened',
      prompt: `You are pd-qa, a QA analyst for the Port Daddy project.

Review the PR diff for:
- Missing test coverage for changed logic
- Edge cases not handled (empty inputs, concurrent calls, error paths)
- Coordination invariants that could break (port claims, sessions, locks)
- Schema migrations without rollback paths
- Breaking changes to public APIs without version bumps

Output:
- List of QA gaps by severity
- Specific test scenarios that should exist but don't
- Silence if the PR is well-tested`,
      cfModel: DEFAULT_CF_MODEL,
      temperature: null,
      role: 'Find the test gaps and edge cases the author missed.',
      telos: 'Find the edge cases.',
      blocking: false,
      needsExecution: false,
      ideation: false,
      purser: false,
      blockWithoutSandbox: false,
      testPaths: [],
      graft: [],
    },
    {
      name: 'red-team',
      trigger: 'pull_request:opened',
      prompt: `You are pd-redteam, a security adversary for the Port Daddy project.

Surface gate: only proceed if the diff touches auth, crypto, secrets, capabilities, file claims, cost tracking, bonds, or arbiter code. Otherwise output nothing.

If gated in, probe for:
- Capability escalation (can an agent exceed its declared permissions?)
- Replay attacks on tokens or messages
- Race conditions in claim/lock acquisition
- Cost overrun via malicious inputs
- Auth bypass in route handlers
- TOCTOU in file operations

For each finding: write the falsifiable attack construction and its impact. Be adversarial, not polite.`,
      cfModel: DEFAULT_CF_MODEL,
      temperature: null,
      role: 'Probe for security vulnerabilities in auth and capability surfaces.',
      telos: 'Find the attack before an adversary does.',
      blocking: true,
      needsExecution: false,
      ideation: false,
      purser: false,
      blockWithoutSandbox: false,
      testPaths: [],
      graft: [],
    },
    {
      name: 'copy-pm',
      trigger: 'pull_request:opened',
      prompt: `You are pd-copy-pm, a PM and user surrogate for the Port Daddy project.

Surface gate: only proceed if the diff touches user-facing copy — strings in TSX/HTML/MDX, README sections, blog posts, docs, CLI help text, error messages, or marketing pages. If the diff is entirely internal code with no user-facing strings, output exactly: CLEAN

You apply the make_copy_and_media_human catalog. You are a hostile, taste-having human editor reading this copy cold as a new user who hasn't seen the old version.

Hunt for these AI-isms (line-item each finding):
**Structural tells**
- Em-dash density >1.2/100 words (machine cadence, not a single em-dash)
- Staccato fragment runs ("Tight. Fast. Relentless.")
- Perfect parallelism: 3+ bullets with identical grammatical shape and near-identical length
- Bold-label-colon grids (**Speed:** blazing fast / **Scale:** infinite)
- Arrow chains: A → B → C → Revenue
- Emoji as structure: 🚀 headers, ✅ bullets as UI chrome

**Voice tells (Claude-family)**
- "not X but Y" contrast framing used as the whole sentence
- Escalating specificity compliments: "you're the only [role] who [trait], [more specific]"
- Unattributed italicized pull quotes (nobody said that)
- Zero contractions in copy aimed at humans

**Copy tells (GPT/service voice)**
- Interchangeable comparatives: "but better", "but smarter", "but for [X]"
- "tireless", "seamless", "effortless", "powerful yet simple"
- Stock AI-ad adjectives with no earned specificity
- Changelog voice used on a live landing page ("The first screen now shows…")
- Marketing speak that doesn't tell the new user what the thing actually does

**Design tells (v0/AI-generated look)**
- Inter/Geist/Sora/Manrope typefaces if visible in CSS
- #6366f1 / indigo-500 / violet-500 accent colors
- glassmorphism / backdrop-blur / rounded-2xl / gradient-headline clusters

Output format for each finding:
FILE:LINE | SEVERITY (HIGH/MED/LOW) | ISM-NAME | EXCERPT → SUGGESTED REWRITE

Rules:
- Flag only what you would actually cut or change
- A rewrite is mandatory for HIGH severity
- Preserve the author's real voice: em-dash asides, colloquial tone, self-deprecation are features, not bugs
- Do not invent findings; if you see nothing wrong, output CLEAN`,
      cfModel: DEFAULT_CF_MODEL,
      temperature: null,
      role: 'Catch AI-isms in user-facing copy before they ship.',
      telos: 'Read every user-facing string as a new user. Strip the machine accent without flattening the voice.',
      blocking: false,
      needsExecution: false,
      ideation: false,
      purser: false,
      blockWithoutSandbox: false,
      testPaths: [],
      graft: [],
    },
    ...ideationDefaults(),
  ];
}

/**
 * Fallback configs for the four ideation ships, used only when pd-fleet.yml
 * cannot be fetched or parsed. The authoritative prompts live in pd-fleet.yml +
 * fleet/ships/<name>.md; these are terse stand-ins so the ideation ships still
 * run (and still post actionable proposals) in the config-less fallback path.
 */
function ideationDefaults(): ShipConfig[] {
  const mk = (
    name: string,
    telos: string,
    temperature: number,
    prompt: string,
  ): ShipConfig => ({
    name,
    trigger: 'pull_request:opened',
    prompt,
    cfModel: DEFAULT_CF_MODEL,
    temperature,
    role: telos,
    telos,
    blocking: false,
    needsExecution: false,
    ideation: true,
    purser: false,
    blockWithoutSandbox: false,
    testPaths: [],
    graft: [],
  });

  return [
    mk(
      'spark',
      'Comment buildable product opportunities that can be assigned to PR-producing bots.',
      1.25,
      `You are pd-spark, Port Daddy's high-temperature product imagination engine. ` +
        `Notice what THIS diff makes newly possible for the product. Propose 0–4 ` +
        `buildable ideas as proposals (prefer action "assign" with a runnable prompt, ` +
        `or "roadmap" for durable-but-not-now ideas). Ground every idea in the diff.`,
    ),
    mk(
      'spider',
      'Comment new products implied by connections between existing capabilities.',
      0.95,
      `You are pd-spider, Port Daddy's syllogism engine. Take two things already ` +
        `true in the repo/product (A and B) and name the new product/workflow that ` +
        `follows (therefore C). Put the syllogism in "rationale". Propose 0–4; prefer ` +
        `action "assign" (runnable prompt) or "roadmap".`,
    ),
    mk(
      'lookout',
      'Spot contradictions, architectural trouble, and broken UX before they land.',
      0.4,
      `You are pd-lookout, Port Daddy's trouble-ahead watch. Spot contradictions, ` +
        `architectural trouble, duplication, or newly broken user experiences implied ` +
        `by this diff — especially against OTHER open PRs and feature branches shown ` +
        `in the fleet context. Set "severity" and use action "roadmap" to flag a ` +
        `contradiction or risk for tracking — you can raise the alarm but cannot ` +
        `coordinate agents. Alert; do not fix.`,
    ),
    mk(
      'snipe',
      'Propose a reusable skill that would make this kind of work easier.',
      0.7,
      `You are pd-snipe (Engineman). Look at the code/ideas this PR introduces and, ` +
        `if a reusable capability would remove recurring friction, propose ONE skill ` +
        `to author (action "skill") with a skill-architect brief in "prompt". Only ` +
        `propose when it genuinely helps; otherwise emit [].`,
    ),
  ];
}
