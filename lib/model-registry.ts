/**
 * Declarative model registry — the ONE place that maps a (backend, capability)
 * descriptor to a concrete model ID.
 *
 * The rule (operator directive, 2026-06-15): **never hardcode a model name.**
 * Model IDs churn like secrets — a `claude-sonnet-4-6` becomes `-4-7` next month
 * and every literal scattered across the repo silently rots. So code and config
 * declare INTENT — a backend plus a capability like `cheap` / `high` /
 * `max-thinking` — and call `resolveModel()` to splice in the real ID at the last
 * second. The concrete IDs live in ONE data file, `lib/model-registry-data.ts`,
 * generated from `config/models.yaml` by `scripts/generate-model-registry.ts`
 * (which also carries the live phantom-id probe: `--probe`).
 *
 * This module is the model analogue of `lib/llm-backend-resolver.ts` (the single
 * backend resolver): one reader, no parallel lookup paths. The
 * `no-hardcoded-model-ids` guard test allowlists only the data module and the
 * cost-rate table — every other runtime site must come through here.
 */

import {
  MODEL_REGISTRY_DATA,
  type EmbeddingProfile,
  type ModelRegistryData,
} from './model-registry-data.js';

export type Capability = 'cheap' | 'balanced' | 'high' | 'max-thinking' | 'code';

export const CAPABILITIES: readonly Capability[] = [
  'cheap',
  'balanced',
  'high',
  'max-thinking',
  'code',
] as const;

/** The default capability when a caller declares a backend but no capability. */
export const DEFAULT_CAPABILITY: Capability = 'cheap';

// The registry data is a TS module resolved through the import graph — no
// runtime file read, so it loads identically under bun, @swc/jest, tsc, and
// the dist build. `_resetRegistryCache` exists only for the test API.
let cached: ModelRegistryData | null = null;

/**
 * Memoized access to the generated registry data.
 *
 * The design point is the static import above: a runtime file read would resolve
 * differently under bun, @swc/jest, tsc and the dist build, and a registry that
 * is present in tests and absent in production is worse than one that is always
 * absent. The memo is a formality — the import is already a module singleton —
 * kept so `_resetRegistryCache` has something to clear.
 *
 * @returns The registry data.
 */
function load(): ModelRegistryData {
  if (cached) return cached;
  cached = MODEL_REGISTRY_DATA;
  return cached;
}

/**
 * Map a legacy model_tier (low/mid/high) to a capability.
 *
 * The rationale for keeping this rather than renaming the persisted vocabulary:
 * `model_tier` is written into stored rows and schema fixtures, so a rename is a
 * data migration. Declaring the mapping is cheaper and keeps both readable.
 *
 * @param tier The legacy tier name, or null/undefined.
 * @returns The capability, defaulting when the tier is absent or unknown.
 */
export function capabilityForTier(tier: string | null | undefined): Capability {
  if (!tier) return DEFAULT_CAPABILITY;
  const key = tier.trim().toLowerCase();
  const reg = load();
  // BOTH declared vocabularies resolve here, and the second one is not optional
  // politeness. `harborTiers` (fast / mid / strong / local / custom) is a
  // persisted schema vocabulary; before it was consulted, only `mid` resolved —
  // by coincidence, because it collides with a legacy alias. `strong` fell
  // through to the DEFAULT, which is the CHEAPEST rung: a caller asking for the
  // strongest model silently got the weakest one, and nothing errored. A
  // declared mapping that the resolver does not read is worse than no mapping,
  // because it reads as support.
  const alias = reg.tierAliases[key] ?? reg.harborTiers[key];
  return (alias as Capability) || DEFAULT_CAPABILITY;
}

/**
 * Resolve a backend alias (`anthropic`, `claude-cli`, …) to its canonical
 * family key (`claude`) via `backendAliases`. Unaliased backends pass
 * through unchanged. The design rule: this is the ONE place backend-name aliasing happens —
 * every caller (registry lookups, the Rust console's generated tier table,
 * agent-harbor's tier policy) goes through here rather than re-deriving its
 * own claude/anthropic/claude-cli equivalence.
 *
 * @param backend A backend key or alias.
 * @returns The canonical family key.
 */
export function canonicalBackend(backend: string): string {
  const reg = load();
  return reg.backendAliases[backend] || backend;
}

export interface ResolveModelOptions {
  /** The backend/provider key, e.g. 'anthropic' | 'claude-cli' | 'cloudflare'. */
  backend: string;
  /** The declarative capability. Mutually informative with `tier`. */
  capability?: Capability;
  /** Legacy model_tier (low/mid/high) — mapped to a capability if `capability` is unset. */
  tier?: string | null;
  /**
   * An explicit operator-supplied model ID. If a real human/operator pinned a
   * specific model, honor it — the registry governs DEFAULTS, not overrides.
   * Backend-name placeholders (e.g. the literal 'claude-code') are ignored.
   */
  explicit?: string | null;
}

const BACKEND_NAME_PLACEHOLDERS = new Set([
  'claude-code',
  'claude-cli',
  'codex',
  'agy',
  'agy-cli',
  'gemini',
  'groq',
  'grok',
  'cloudflare',
  'aider',
  'custom',
]);

/**
 * Resolve a concrete model ID from declarative intent.
 *
 * Precedence: a real `explicit` override wins; otherwise (backend, capability)
 * — or (backend, tier→capability) — is looked up in the registry.
 *
 * The design decision worth stating is the failure mode: an unknown backend or
 * an unmapped capability THROWS rather than falling back to something plausible.
 * A registry that guesses is worse than no registry, because the guess reaches
 * a provider and either bills for the wrong model or — on Workers AI — hangs.
 *
 * @param opts Declarative intent: backend, and one of capability / tier / explicit.
 * @returns The concrete model id.
 * @throws When the backend is unknown or the capability has no mapping.
 */
/**
 * Resolve a human-typed family nickname to the concrete id it names.
 *
 * Case-insensitive, because the vendor materials these words come from are not
 * consistent about it ("Sol" in prose, `gpt-5.6-sol` in the id) and an operator
 * copying either should land in the same place.
 *
 * @param name A nickname or a concrete model id.
 * @returns The catalogued id for a known nickname, else `name` unchanged.
 */
export function resolveModelAlias(name: string): string {
  const aliases = load().modelAliases ?? {};
  return aliases[name.trim().toLowerCase()] ?? name;
}

/**
 * Every family nickname the registry understands, for surfaces that list them.
 *
 * @returns Nickname → concrete id, a copy the caller may not mutate into drift.
 */
export function modelAliases(): Record<string, string> {
  return { ...(load().modelAliases ?? {}) };
}

/**
 * Every declared embedding profile, separate from backend capability ladders.
 * These rows are content-addressed targets, not producer attestations. A
 * `declarative-only` row must not stamp persisted vectors, authorize
 * ResourceScope compatibility, or enter similarity comparison; callers keep
 * its output ephemeral/quarantined until a separate signed conformance receipt
 * binds the space id, artifact digests, preprocessing digest, and runtime.
 *
 * @returns A model-keyed copy whose rows callers cannot mutate into registry drift.
 */
export function embeddingProfiles(): Readonly<Record<string, Readonly<EmbeddingProfile>>> {
  const profiles = Object.fromEntries(
    Object.entries(load().embeddingProfiles).map(([modelId, profile]) => [
      modelId,
      Object.freeze({ ...profile }),
    ]),
  );
  return Object.freeze(profiles);
}

/**
 * Read the declared vector-space target for one exact model row.
 * Callers must inspect `runtimeBinding`; a declarative profile is not evidence
 * that the active provider or loader honored its content or preprocessing and
 * is never sufficient authority for persistence or similarity on its own.
 *
 * @param modelId Exact key from `config/models.yaml`.
 * @returns A defensive copy, or undefined when the model is not an embedder.
 */
export function embeddingProfileForModel(modelId: string): EmbeddingProfile | undefined {
  const profile = load().embeddingProfiles[modelId];
  return profile ? { ...profile } : undefined;
}

export function resolveModel(opts: ResolveModelOptions): string {
  const explicit = opts.explicit?.trim();
  if (explicit && !BACKEND_NAME_PLACEHOLDERS.has(explicit)) {
    // A family nickname a human typed resolves to the id it names; anything
    // else passes through untouched, because an explicit pin the registry has
    // never seen is still the operator's call to make.
    //
    // The asymmetry this closes: `sonnet` already worked, but only as an
    // accident of transport — the claude-code CLI accepts that word on its own
    // --model flag, so it never had to be translated here. No other vendor's
    // names got the same courtesy, so `sol` reached the provider as the literal
    // string `sol`. One vendor's CLI quirk was reading as a feature only that
    // family had.
    return resolveModelAlias(explicit);
  }

  const reg = load();
  const table = reg.backends[canonicalBackend(opts.backend)];
  if (!table) {
    throw new Error(
      `model-registry: no backend "${opts.backend}" in lib/model-registry-data.ts. ` +
        `Known backends: ${Object.keys(reg.backends).join(', ')} ` +
        `(plus aliases: ${Object.keys(reg.backendAliases).join(', ')}). ` +
        `Add it to the registry — do not hardcode a model ID at the call site.`,
    );
  }

  const capability: Capability =
    opts.capability || capabilityForTier(opts.tier);

  const id = table[capability] || table[DEFAULT_CAPABILITY];
  if (!id) {
    throw new Error(
      `model-registry: backend "${opts.backend}" has no "${capability}" (or "${DEFAULT_CAPABILITY}") ` +
        `mapping in lib/model-registry-data.ts.`,
    );
  }
  return id;
}

/**
 * Resolve the value a CLI's own `--model` flag accepts, for a capability.
 *
 * The rationale for a second lookup: some agent CLIs take family NICKNAMES
 * (`haiku`, `sonnet`, `opus`) rather than API ids, and passing an API id there
 * is rejected or silently ignored. That is
 * a TRANSPORT vocabulary, not a second model list, so it is declared alongside
 * the registry (`vocabularies.cliAliases` in config/models.yaml) rather than
 * hardcoded at each spawn site — which is what it was, in several places, each
 * with its own idea of the mapping.
 *
 * @param cli The CLI transport key, e.g. `claude-cli`.
 * @param capability The capability rung being requested.
 * @returns The CLI's accepted flag value, or undefined when that CLI takes real
 *          model ids (in which case the caller should use {@link resolveModel}).
 */
export function resolveCliModelAlias(
  cli: string,
  capability: Capability = DEFAULT_CAPABILITY,
): string | undefined {
  const table = load().cliAliases?.[cli];
  return table?.[capability];
}

/**
 * Provenance for diagnostics / `pd doctor` ("registry seeded 2026-06-15 from …").
 *
 * The purpose is that a STALE registry is visible rather than silent: the ids
 * still resolve when the source has not been refreshed in months, so the only
 * signal a reader gets is this stamp.
 *
 * @returns When the registry was generated, by what, and from which sources.
 */
export function registryProvenance(): { generatedAt: string; generatedBy: string; source: string } {
  const reg = load();
  return {
    generatedAt: reg.generatedAt,
    generatedBy: reg.generatedBy,
    source: reg.source,
  };
}

/**
 * Every model a backend can actually produce, de-duped and ladder-ordered.
 *
 * The purpose is that a picker can OFFER exactly what the resolver will PICK. Before
 * it, `lib/backend-catalog.ts` carried a hand-written `models[]` per backend and
 * the two disagreed: the FleetBar advertised ids `resolveModel()` never returns,
 * and the Cloudflare row advertised `@cf/moonshotai/kimi-k2-instruct` under a
 * comment calling it the REAL slug — an id Workers AI had stopped serving, which
 * does not error but hangs. A catalog that can name a model the resolver cannot
 * reach is a catalog that can name a model that does not exist.
 *
 * @param backend Backend key or alias.
 * @returns Concrete ids for that backend, cheap rung first; empty when the
 *          backend deliberately has no registry table (agy names its own models;
 *          ollama's list is discovered from the running daemon).
 */
export function modelsForBackend(backend: string): string[] {
  const table = load().backends[canonicalBackend(backend)];
  if (!table) return [];
  const seen = new Set<string>();
  for (const capability of CAPABILITIES) {
    const id = table[capability];
    if (id) seen.add(id);
  }
  return [...seen];
}

/**
 * Every concrete model ID the registry currently maps to.
 *
 * The purpose is coverage checking: "every model the resolver can return is
 * priced" is only assertable if the set is enumerable. It is the read side of
 * the registry ⊆ priced invariant.
 *
 * @returns The de-duped id set across all backends and capabilities.
 */
export function allRegisteredModelIds(): string[] {
  const reg = load();
  const ids = new Set<string>();
  for (const table of Object.values(reg.backends)) {
    for (const id of Object.values(table)) ids.add(id);
  }
  return [...ids];
}

/**
 * Reasoning-effort rungs, weakest to strongest.
 *
 * Ordered so an unsupported request can be CLAMPED rather than refused. The
 * order is the vendor's own — it is the sequence OpenAI lists in the 400 it
 * returns for an unsupported value — not an opinion about how hard each rung
 * thinks.
 */
const EFFORT_LADDER = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;

/**
 * The reasoning effort to send for a model, clamped to what that model accepts.
 *
 * WHY THIS IS NOT A CONSTANT AT THE CALL SITE. It used to be: the OpenAI adapter
 * hardcoded `effort: 'minimal'`, correct for the original gpt-5 generation and
 * rejected by everything after it. The registry pinned the model id, so the id
 * was always right — and four of the five OpenAI rungs still returned HTTP 400
 * on every call, because the id is only half of what a request has to get right.
 * `cheap` kept working purely because gpt-5-mini is the last model that still
 * accepts `minimal`, which is why the outage was invisible to a smoke that only
 * exercised the cheap rung.
 *
 * CLAMPING RATHER THAN THROWING is the deliberate choice. A caller asking for
 * `max` on a model that stops at `xhigh` wants the most thinking available, not
 * an error; a caller asking for `none` on a model whose floor is `medium` (one
 * whose thinking cannot be switched off) gets that floor. Refusing would turn a
 * survivable mismatch into a dead backend — precisely what the failover work in
 * this slice exists to prevent.
 *
 * @param model Concrete model id.
 * @param requested Effort the caller asked for, if any.
 * @returns The effort to send, or undefined when this model takes no effort
 *          parameter at all — in which case the caller must OMIT the field
 *          rather than send a default, because an unknown id plus an invented
 *          parameter is two guesses instead of one.
 */
export function resolveReasoningEffort(
  model: string,
  requested?: string | null,
): string | undefined {
  const row = load().models[model];
  const supported = row?.reasoningEfforts;
  if (!supported || supported.length === 0) return undefined;

  if (!requested) return row.defaultEffort ?? supported[0];
  if (supported.includes(requested)) return requested;

  const wantedRung = EFFORT_LADDER.indexOf(requested as (typeof EFFORT_LADDER)[number]);
  // An effort we have never heard of is not clampable against a ladder it is not
  // on; fall back to the row's own default rather than guessing a position.
  if (wantedRung < 0) return row.defaultEffort ?? supported[0];

  const ranked = supported
    .map((effort) => ({ effort, rung: EFFORT_LADDER.indexOf(effort as (typeof EFFORT_LADDER)[number]) }))
    .filter((entry) => entry.rung >= 0)
    .sort((a, b) => a.rung - b.rung);
  if (ranked.length === 0) return row.defaultEffort ?? supported[0];

  const atOrBelow = ranked.filter((entry) => entry.rung <= wantedRung);
  return atOrBelow.length ? atOrBelow[atOrBelow.length - 1].effort : ranked[0].effort;
}

/**
 * Every reasoning-effort value a model accepts, weakest first.
 *
 * Exposed so a picker or a policy can show the real range instead of the union
 * of every model's range — the union is what the vendor's request schema
 * validates against, and it is wrong for every individual model.
 *
 * @param model Concrete model id.
 * @returns The accepted values, or an empty array when the model takes none.
 */
export function reasoningEffortsFor(model: string): string[] {
  return [...(load().models[model]?.reasoningEfforts ?? [])];
}

/**
 * Test-only: drop the memoized registry so a rewritten data module is re-read.
 *
 * The intent is to keep tests honest about generation: a suite that regenerates
 * the data module mid-run would otherwise assert against the pre-generation
 * snapshot and pass while the artifact on disk disagreed.
 */
export function _resetRegistryCache(): void {
  cached = null;
}
