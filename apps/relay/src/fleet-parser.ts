/**
 * Fleet config parser for the relay control-plane API.
 *
 * DUPLICATED (lowest-risk, per spec) from apps/fleet-executor/src/fleet.ts
 * lines 16-152. The relay control-plane needs a deterministic, pure parse of
 * pd-fleet.yml to validate operator edits and to look up a single ship for a
 * smoke test — without taking a runtime dependency on the executor package.
 *
 * Like the executor's parser this is PURE (no Workers AI) and reads the ENTIRE
 * document via the real `yaml` package — no truncation, no LLM round-trip.
 *
 * Two surfaces over the same parse:
 *   - {@link parseFleetShips}  — trigger-filtered list (executor parity); the
 *     sentinel trigger '*' matches every ship.
 *   - {@link validateFleetYaml} — schema validation with structured errors for
 *     the POST /v1/fleet/validate endpoint.
 */

import { parse as parseYaml } from 'yaml';
import {
  CF_ROLE_MODELS,
  resolveCfModel,
} from '../../shared/model-registry.generated.js';

export interface ShipConfig {
  name: string;
  trigger: string | string[];
  prompt: string;
  cfModel: string;
  role: string;
  telos: string;
  /** When true, this ship can BLOCK the merge (fail-closed). */
  blocking: boolean;
  /** When true, ship needs execution (bash/write) — dispatch to GHA instead. */
  needsExecution: boolean;
}

export interface ValidationError {
  field: string;
  message: string;
}

/** Compact ship view returned by the validate endpoint. */
export interface ShipSummary {
  name: string;
  trigger: string | string[];
  blocking: boolean;
  cfModel: string;
  needsExecution: boolean;
}

export interface FleetValidationResult {
  code: 'OK_VALID' | 'BAD_YAML' | 'BAD_SCHEMA';
  valid: boolean;
  ships: ShipSummary[];
  errors: ValidationError[];
  /** Human-readable summary (used as the envelope `error` field on failure). */
  message: string | null;
}

// Default Cloudflare AI model per ship if not declared in fallbacks.
//
// SUPPLANTED (2026-08-23): this pair was a hand-maintained duplicate of the
// executor's, and it had drifted — different ids, and, worse, no pin guard at
// all (see deriveCfModel). Both now read the one generated registry, so the
// relay's view of which model a ship will actually run cannot disagree with the
// executor that runs it.

// Tools that require local execution (can't run in a Worker). Matches any
// Bash(...) tool whose command is NOT `gh` (gh runs fine against the API).
const EXECUTION_TOOLS_RE = /Bash\((?!gh)[^)]*\)/;

// Ships that are CLOUD-STATIC reviewers by contract: never execute.
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

/**
 * Derive the Cloudflare Workers AI model for a ship:
 *   1. the first Workers AI `fallbacks[].model` pin, GUARDED — a pin outside the
 *      pinnable set is remapped to the ship default rather than reported, else
 *   2. a name-based default (the review model for *reviewer* ships).
 *
 * The guard is the correction: this function previously honored ANY `@cf/`-
 * prefixed string, so the relay would report a ship as valid and name the model
 * it would run while that id did not exist — and an unknown Workers AI id hangs
 * rather than erroring. The relay is the surface an operator checks a fleet
 * config against; it must not certify a model the executor will refuse.
 */
function deriveCfModel(agent: RawAgent, name: string): string {
  for (const fb of agent.fallbacks ?? []) {
    if (typeof fb?.model === 'string' && fb.model.startsWith('@cf/')) {
      return resolveCfModel(fb.model);
    }
  }
  return name.includes('reviewer') ? CF_ROLE_MODELS.reviewBot : CF_ROLE_MODELS.shipDefault;
}

function deriveNeedsExecution(name: string, allowedTools: unknown): boolean {
  if (CLOUD_STATIC_SHIPS.has(name)) return false;
  return EXECUTION_TOOLS_RE.test(typeof allowedTools === 'string' ? allowedTools : '');
}

/**
 * Does a ship's trigger (string or array) match the requested event trigger?
 * Matches an exact trigger (`pull_request:opened`) or a wildcard
 * (`pull_request:*`). The sentinel `'*'` matches every ship (used by the
 * control-plane to enumerate all ships regardless of trigger).
 */
function triggerMatches(trigger: unknown, requested: string): boolean {
  if (requested === '*') return true;
  const reqEvent = requested.split(':')[0];
  const triggers = Array.isArray(trigger) ? trigger : [trigger];
  return triggers.some(
    (t) => typeof t === 'string' && (t === requested || t === `${reqEvent}:*`),
  );
}

/**
 * Deterministically parse pd-fleet.yml and return every ship whose trigger
 * matches `trigger`. Pure (no Workers AI). Reads the ENTIRE document.
 *
 * Ships without a `prompt` are skipped — the cloud executor only runs
 * prompt-driven LLM ships. Returns `null` when the document can't be parsed
 * or yields no matching ship.
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
      role,
      telos,
      blocking: coerceBlocking(agent.blocking),
      needsExecution: deriveNeedsExecution(name, agent.allowedTools),
    });
  }

  return ships.length > 0 ? ships : null;
}

/**
 * Parse EVERY prompt-driven ship regardless of trigger. Convenience over
 * {@link parseFleetShips} for the smoke-test endpoint, which finds a ship by
 * name without caring which event triggers it.
 */
export function parseAllShips(fleetYaml: string): ShipConfig[] {
  return parseFleetShips(fleetYaml, '*') ?? [];
}

/**
 * Schema-validate a pd-fleet.yml string for the control-plane validate endpoint.
 *
 * Distinguishes three outcomes:
 *   - BAD_YAML   the document does not parse
 *   - BAD_SCHEMA it parses but is structurally wrong (no fleet.agents, or an
 *                agent is missing a required field)
 *   - OK_VALID   parses and every agent declares the required fields
 *
 * Required per agent: `trigger` (string or string[]) and a non-empty `prompt`.
 */
export function validateFleetYaml(fleetYaml: string): FleetValidationResult {
  let doc: unknown;
  try {
    doc = parseYaml(fleetYaml);
  } catch (e) {
    const detail = e instanceof Error ? e.message : 'invalid YAML';
    return {
      code: 'BAD_YAML',
      valid: false,
      ships: [],
      errors: [{ field: 'yaml', message: detail }],
      message: `YAML parse error: ${detail}`,
    };
  }

  const fleet = (doc as { fleet?: unknown } | null)?.fleet;
  const agents = (fleet as { agents?: unknown } | null)?.agents;
  if (!agents || typeof agents !== 'object') {
    return {
      code: 'BAD_SCHEMA',
      valid: false,
      ships: [],
      errors: [{ field: 'fleet.agents', message: 'required' }],
      message: "Document missing required field: fleet.agents",
    };
  }

  const errors: ValidationError[] = [];
  const ships: ShipSummary[] = [];

  for (const [name, rawUnknown] of Object.entries(agents as Record<string, unknown>)) {
    if (!rawUnknown || typeof rawUnknown !== 'object') {
      errors.push({ field: name, message: 'agent must be a mapping' });
      continue;
    }
    const agent = rawUnknown as RawAgent;

    const hasTrigger =
      typeof agent.trigger === 'string' ||
      (Array.isArray(agent.trigger) && agent.trigger.every((t) => typeof t === 'string'));
    const prompt = typeof agent.prompt === 'string' ? agent.prompt.trim() : '';

    if (!hasTrigger) {
      errors.push({ field: `${name}.trigger`, message: 'required' });
    }
    if (!prompt) {
      errors.push({ field: `${name}.prompt`, message: 'required' });
    }

    if (hasTrigger && prompt) {
      ships.push({
        name,
        trigger: agent.trigger as string | string[],
        blocking: coerceBlocking(agent.blocking),
        cfModel: deriveCfModel(agent, name),
        needsExecution: deriveNeedsExecution(name, agent.allowedTools),
      });
    }
  }

  if (errors.length > 0) {
    const first = errors[0]!;
    return {
      code: 'BAD_SCHEMA',
      valid: false,
      ships,
      errors,
      message: `Agent schema invalid: ${first.field} ${first.message}`,
    };
  }

  return { code: 'OK_VALID', valid: true, ships, errors: [], message: null };
}
