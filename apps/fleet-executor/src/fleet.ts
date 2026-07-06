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
import { cfModelForTier } from './models.js';

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
}

// Default Cloudflare AI model per ship if not declared in fallbacks.
// Upgraded from qwen-30B/32B: the small models produced speculative, noisy
// reviews ("potential tautology", "consider a JSDoc"). These are the strongest
// reasoning + code models on Workers AI (no external API key, stays edge-native).
const DEFAULT_CF_MODEL = '@cf/openai/gpt-oss-120b';        // reasoning reviewers
const CODER_CF_MODEL = '@cf/moonshotai/kimi-k2.7-code';    // code-specialized (1T, 262k ctx)

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
  modelTier?: string;
  model_tier?: string;
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
 * Derive the Cloudflare Workers AI model for a ship:
 *   1. a `cloudflare` fallback declaring a power TIER (`modelTier`/`model_tier`)
 *      resolved through the registry-mirrored tier→model map (the ground-truth
 *      way — no model id ever appears in the ship YAML), else
 *   2. a legacy literal `fallbacks[].model` starting with `@cf/` (deprecated
 *      back-compat during the tier migration), else
 *   3. a name-based default (coder model for *reviewer* ships, general otherwise).
 */
function deriveCfModel(agent: RawAgent, name: string): string {
  for (const fb of agent.fallbacks ?? []) {
    if (fb?.backend === 'cloudflare') {
      const tier = typeof fb.modelTier === 'string' ? fb.modelTier
        : typeof fb.model_tier === 'string' ? fb.model_tier
        : null;
      if (tier) {
        const resolved = cfModelForTier(tier);
        if (resolved) return resolved;
      }
    }
    if (typeof fb?.model === 'string' && fb.model.startsWith('@cf/')) return fb.model;
  }
  return name.includes('reviewer') ? CODER_CF_MODEL : DEFAULT_CF_MODEL;
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

    const prompt = typeof agent.prompt === 'string' ? agent.prompt.trim() : '';
    if (!prompt) continue; // deterministic/bodied ships and malformed entries

    const telos = typeof agent.telos === 'string' ? agent.telos : '';
    const role = telos || (typeof agent.role === 'string' ? agent.role : '') || `${name} ship`;

    ships.push({
      name,
      trigger: agent.trigger as string | string[],
      prompt,
      cfModel: deriveCfModel(agent, name),
      temperature: coerceTemperature(agent.temperature),
      role,
      telos,
      blocking: coerceBlocking(agent.blocking),
      needsExecution: deriveNeedsExecution(name, agent.allowedTools),
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
    },
  ];
}
