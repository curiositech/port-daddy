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

export interface ShipConfig {
  name: string;
  trigger: string | string[];
  prompt: string;
  cfModel: string;
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

// Default Cloudflare AI model per ship if not declared in fallbacks.
//
// THE "BLACKOUT" WAS A PARSING BUG, NOT AN EMPTY MODEL (corrected 2026-07-08).
// `@cf/openai/gpt-oss-120b` speaks the OpenAI **Responses API** — its generated
// text arrives under `output[].content[].text` / `output_text`, NOT `response`.
// The 2026-07-07 outage was the executor reading only `res.response` (empty for
// that shape), which {@link extractAiText} (ai-response.ts, #731) now reads
// correctly. gpt-oss-120b returns real output; treating it as "empty" and
// remapping it to qwen was a stale reaction to a bug already fixed — and it
// steered the fleet onto the PRICIER qwen2.5-coder ($0.66/$1.00) when gpt-oss-120b
// is both MORE capable (120B) AND CHEAPER ($0.35/$0.75). (Prices per the
// Cloudflare pricing page on 2026-07-08; verify the live page as they drift.)
//
// gpt-oss-120b works but is PRICEY ($0.35/$0.75 per M tok) — reserve it for the
// one ship where quality most earns the cost: the CODE REVIEW BOT. Every other
// ship runs on the cheap qwen3-30b ($0.051/$0.335). Operator directive: "super
// expensive — only use it for the review bot, nothing else."
const REVIEW_BOT_CF_MODEL = '@cf/openai/gpt-oss-120b'; // code review bot ONLY
const CHEAP_CF_MODEL = '@cf/qwen/qwen3-30b-a3b-fp8'; // every other ship
const WORKING_CF_MODEL = CHEAP_CF_MODEL; // guard fallback: cheap + verified working
const DEFAULT_CF_MODEL = CHEAP_CF_MODEL; // every ship except the review bot
const CODER_CF_MODEL = REVIEW_BOT_CF_MODEL; // the code review bot only

// Cloudflare model ids the executor honors as an explicit ship pin. Only the
// cheap model is honorable — the review bot gets gpt-oss by ROLE (below), not by
// pin, so no other ship can accidentally pin its way onto the expensive model. An
// id OUTSIDE this set is remapped to {@link WORKING_CF_MODEL} (the cheap model),
// because a nonexistent Workers AI id doesn't error — it yields a blank response
// the parser reads as "clean", silencing the ship.
const KNOWN_GOOD_CF_MODELS: ReadonlySet<string> = new Set(['@cf/qwen/qwen3-30b-a3b-fp8']);

/**
 * Guard a requested Cloudflare model id: pass through a known-good one, else
 * remap to {@link WORKING_CF_MODEL}. Exported for the unit tests that pin this
 * behavior — the fleet must never again go dark because a pinned model id
 * silently returns nothing.
 */
export function resolveCfModel(requested: string): string {
  return KNOWN_GOOD_CF_MODELS.has(requested) ? requested : WORKING_CF_MODEL;
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
  /** Purser: direct model pin (still guarded by KNOWN_GOOD_CF_MODELS). */
  model?: unknown;
  /** Purser: block when tests could not be executed (default false). */
  blockWithoutSandbox?: unknown;
  /** Purser: path prefixes authored tests must live under. */
  testPaths?: unknown;
  /** Any ship: repo skill ids to graft onto the prompt (skill-graft.ts). */
  graft?: unknown;
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
 *   1. Honor the first `@cf/` fallback IF it is in {@link KNOWN_GOOD_CF_MODELS}
 *      — which is ONLY the cheap qwen3-30b, so a pin can never reach the pricey
 *      model.
 *   2. Otherwise (any other pin, e.g. gpt-oss / kimi / qwen-coder, or no `@cf/`
 *      pin) → a name-based default: {@link CODER_CF_MODEL} (gpt-oss-120b) for the
 *      code-review bot per {@link isReviewBot}, {@link DEFAULT_CF_MODEL} (cheap
 *      qwen3-30b) for every other ship.
 */
function deriveCfModel(agent: RawAgent, name: string): string {
  for (const fb of agent.fallbacks ?? []) {
    if (typeof fb?.model === 'string' && fb.model.startsWith('@cf/')) {
      if (KNOWN_GOOD_CF_MODELS.has(fb.model)) return fb.model; // explicit, verified pin
      break; // pin outside the honored set → fall through to the name default
    }
  }
  return isReviewBot(name) ? CODER_CF_MODEL : DEFAULT_CF_MODEL;
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

/** Purser model: honor a direct `model:` pin when known-good, else the usual derivation. */
function derivePurserModel(agent: RawAgent, name: string): string {
  if (typeof agent.model === 'string' && KNOWN_GOOD_CF_MODELS.has(agent.model)) {
    return agent.model;
  }
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

    ships.push({
      name,
      trigger: agent.trigger as string | string[],
      prompt,
      cfModel: purser ? derivePurserModel(agent, name) : deriveCfModel(agent, name),
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
