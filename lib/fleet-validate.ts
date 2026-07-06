/**
 * Fleet ship-definition validator (operator directive 2026-07-06).
 *
 * The rule: a ship NEVER pins a concrete model id. It declares a PROVIDER
 * (`backend`) plus a POWER TIER (`modelTier`); the concrete id is injected from
 * the single ground-truth registry (lib/model-registry-data.ts) at resolve time.
 * A literal `model:` in a ship or a fallback is fragile — the id churns and the
 * ship silently rots (or, worse, pins a phantom Workers AI id and hangs). This
 * validator turns that rule into a check that runs at commit time
 * (`pd guard`, via cli/commands/guard.ts) and in CI
 * (tests/unit/fleet-ship-definitions.test.js), so a bad ship def fails BEFORE it
 * reaches production, not after.
 *
 * Validation is intentionally parser-light: it walks the raw YAML document so it
 * can flag a stray `model:` key wherever it appears in a ship or fallback,
 * independent of the fleet AST's own tolerance for legacy `model:`.
 */

import { parse as parseYaml } from 'yaml';

/** The power tiers a ship may declare (legacy aliases + registry capabilities). */
export const VALID_MODEL_TIERS = new Set<string>([
  'low', 'mid', 'high', 'cheap', 'balanced', 'max-thinking', 'code',
]);

export interface ShipDefViolation {
  /** Ship (agent/watcher) name, or '<fleet>' for document-level problems. */
  ship: string;
  /** 'error' fails the commit / CI; 'warning' is advisory. */
  severity: 'error' | 'warning';
  /** Machine-readable rule id. */
  rule: 'pinned-model' | 'invalid-tier' | 'missing-backend' | 'parse-error';
  /** Human-readable explanation with the fix. */
  message: string;
}

interface RawTarget {
  backend?: unknown;
  model?: unknown;
  modelTier?: unknown;
  model_tier?: unknown;
  fallbacks?: unknown;
  prompt?: unknown;
  body?: unknown;
  backend_preference?: unknown;
}

function isConcreteModel(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function tierOf(t: RawTarget): unknown {
  return t.modelTier ?? t.model_tier;
}

function checkTier(ship: string, where: string, tier: unknown, out: ShipDefViolation[]): void {
  if (tier == null) return;
  if (typeof tier !== 'string' || !VALID_MODEL_TIERS.has(tier.trim().toLowerCase())) {
    out.push({
      ship,
      severity: 'error',
      rule: 'invalid-tier',
      message: `${where}: modelTier "${String(tier)}" is not a valid power tier. Use one of: ${[...VALID_MODEL_TIERS].join(', ')}.`,
    });
  }
}

/** Validate one target (a ship's primary runtime or one fallback). */
function checkTarget(ship: string, where: string, t: RawTarget, out: ShipDefViolation[]): void {
  if (isConcreteModel(t.model)) {
    out.push({
      ship,
      severity: 'error',
      rule: 'pinned-model',
      message:
        `${where}: pins a concrete model id "${t.model}". Ships must declare a ` +
        `provider + power tier (e.g. \`backend: ollama\` + \`modelTier: low\`), never a model id — ` +
        `the id lives only in lib/model-registry-data.ts (operator directive 2026-07-06).`,
    });
  }
  checkTier(ship, where, tierOf(t), out);
}

/** True when a ship is an LLM ship (has a prompt) vs a deterministic body. */
function isLlmShip(a: RawTarget): boolean {
  return typeof a.prompt === 'string' && a.prompt.trim().length > 0 && a.body == null;
}

function validateShip(name: string, raw: unknown, out: ShipDefViolation[]): void {
  if (!raw || typeof raw !== 'object') return;
  const a = raw as RawTarget;

  checkTarget(name, 'primary backend', a, out);

  if (Array.isArray(a.fallbacks)) {
    a.fallbacks.forEach((fb, i) => {
      if (fb && typeof fb === 'object') checkTarget(name, `fallback[${i}]`, fb as RawTarget, out);
    });
  }

  // Personal-fleet shorthand: `backend_preference: [ "provider/model", ... ]`.
  // A `/` with a segment after it embeds a model id — flag it.
  if (Array.isArray(a.backend_preference)) {
    a.backend_preference.forEach((pref, i) => {
      if (typeof pref === 'string' && /^[a-z0-9:_-]+\/.+/i.test(pref.trim())) {
        out.push({
          ship: name,
          severity: 'error',
          rule: 'pinned-model',
          message:
            `backend_preference[${i}] "${pref}" embeds a concrete model id after "/". ` +
            `Use the bare provider (e.g. "ollama") and let the registry pick the tier's model.`,
        });
      }
    });
  }

  // An LLM ship with neither a backend nor any fallback backend can't resolve a
  // model at all — surface it (advisory: env defaults may still apply).
  if (isLlmShip(a)) {
    const hasBackend =
      isConcreteModel(a.backend) ||
      (Array.isArray(a.fallbacks) &&
        a.fallbacks.some((fb) => fb && typeof fb === 'object' && isConcreteModel((fb as RawTarget).backend))) ||
      (Array.isArray(a.backend_preference) && a.backend_preference.length > 0);
    if (!hasBackend) {
      out.push({
        ship: name,
        severity: 'warning',
        rule: 'missing-backend',
        message: `LLM ship declares no backend and no fallback backend; it relies entirely on env defaults.`,
      });
    }
  }
}

/**
 * Validate every ship in a fleet YAML source. Returns all violations (empty =
 * clean). Errors should fail a commit / CI; warnings are advisory.
 */
export function validateFleetShipDefinitions(yamlSource: string): ShipDefViolation[] {
  const out: ShipDefViolation[] = [];
  let doc: unknown;
  try {
    doc = parseYaml(yamlSource);
  } catch (err) {
    return [{ ship: '<fleet>', severity: 'error', rule: 'parse-error', message: `YAML parse failed: ${String(err)}` }];
  }

  const fleet = (doc as { fleet?: { agents?: unknown; watchers?: unknown } } | null)?.fleet;
  if (!fleet) return out;

  for (const section of [fleet.agents, fleet.watchers]) {
    if (section && typeof section === 'object' && !Array.isArray(section)) {
      for (const [name, raw] of Object.entries(section as Record<string, unknown>)) {
        validateShip(name, raw, out);
      }
    } else if (Array.isArray(section)) {
      section.forEach((raw, i) => {
        const name = (raw as { name?: string } | null)?.name ?? `#${i}`;
        validateShip(name, raw, out);
      });
    }
  }
  return out;
}

/** Convenience: only the errors (what a commit gate should block on). */
export function fleetShipDefinitionErrors(yamlSource: string): ShipDefViolation[] {
  return validateFleetShipDefinitions(yamlSource).filter((v) => v.severity === 'error');
}
