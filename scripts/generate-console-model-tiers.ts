#!/usr/bin/env tsx
/**
 * generate-console-model-tiers — emit core/pd-console/config/model-tiers.json
 * from the TypeScript registry (ADR-0057 model-abstraction unification).
 *
 * Before this script existed, core/pd-console/config/model-tiers.json was a
 * hand-edited SECOND copy of lib/model-registry-data.ts's data — and it had
 * already drifted (console claude.high = "claude-opus-4-8" vs the registry's
 * claude.high = "claude-opus-4-1-20250805"; "claude-opus-4-8" is actually
 * the registry's `max-thinking` tier). Nothing in the Rust console currently
 * reads this file (verified: no `.rs` file references "model-tiers.json"),
 * so the drift was latent rather than a live bug — but the file is a
 * maintenance trap either way: a human editing it believes they're changing
 * behavior, and a future consumer would inherit stale data.
 *
 * This script makes lib/model-registry-data.ts the ONLY place a human edits;
 * the JSON is a generated build artifact from here on. Regenerate after any
 * registry change:
 *
 *   npx tsx scripts/generate-console-model-tiers.ts --write
 *
 * Without --write, it prints the would-be JSON to stdout (dry run).
 * tests/unit/console-model-tiers-sync.test.js calls `buildConsoleModelTiers()`
 * directly and fails the suite if the checked-in file has drifted — that
 * test IS the CI drift gate (it runs in the same `npm test` CI already runs).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { resolveModel, type Capability } from '../lib/model-registry.js';

export const CONSOLE_MODEL_TIERS_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'core',
  'pd-console',
  'config',
  'model-tiers.json',
);

/** console tier name -> registry capability. Mirrors lib/model-registry-data.ts tierAliases (low/mid/high -> cheap/balanced/high). */
const CONSOLE_TIER_CAPABILITY: Record<'high' | 'mid' | 'low', Capability> = {
  high: 'high',
  mid: 'balanced',
  low: 'cheap',
};

/**
 * Registry backend key -> console provider key + the human-readable
 * per-provider `_comment` the JSON has historically carried. `lmstudio` is
 * NOT registry-derived: LM Studio serves whatever model is loaded, so all
 * three tiers stay the static "local-model" placeholder regardless of what
 * the registry says (kept literal here on purpose, not a drift risk since
 * it never varies).
 */
const REGISTRY_DERIVED_PROVIDERS: Array<{ registryBackend: string; consoleKey: string; comment?: string }> = [
  { registryBackend: 'claude', consoleKey: 'claude' },
  { registryBackend: 'gemini', consoleKey: 'gemini' },
  { registryBackend: 'groq', consoleKey: 'groq' },
  {
    registryBackend: 'deepseek',
    consoleKey: 'deepseek',
    comment:
      "DeepSeek OpenAI-compatible API. deepseek-chat = V3 (general+coder), deepseek-reasoner = R1 (reasoning). 'low' mirrors DEFAULT_DEEPSEEK_MODEL (deepseek-chat) and is priced in cost-tracker MODEL_RATES.",
  },
  {
    registryBackend: 'xai',
    consoleKey: 'xai',
    comment:
      "xAI (Grok) OpenAI-compatible API. The general and code-specialised lines are separate; the 'low' rung mirrors DEFAULT_XAI_MODEL and is priced in cost-tracker MODEL_RATES.",
  },
  { registryBackend: 'openai', consoleKey: 'openai' },
  { registryBackend: 'cloudflare', consoleKey: 'cloudflare' },
  { registryBackend: 'ollama', consoleKey: 'ollama' },
];

export interface ConsoleModelTiers {
  _comment: string;
  _tiers: string[];
  providers: Record<string, Record<string, string> & { _comment?: string }>;
}

/**
 * Build the console's model-tiers table from the registry.
 *
 * The design intent is purity — no filesystem I/O — so the drift test can call
 * it and compare against the checked-in JSON without staging a temp file. That
 * is what makes "the console's copy matches the registry" a mechanical check
 * rather than a habit: the Rust console cannot import the TS registry, so this
 * generated JSON is its only view of the ladder, and it had already drifted once.
 *
 * @returns The tier table, ready to serialize.
 */
export function buildConsoleModelTiers(): ConsoleModelTiers {
  const providers: ConsoleModelTiers['providers'] = {};

  for (const { registryBackend, consoleKey, comment } of REGISTRY_DERIVED_PROVIDERS) {
    const tiers: Record<string, string> = {};
    for (const [consoleTier, capability] of Object.entries(CONSOLE_TIER_CAPABILITY)) {
      tiers[consoleTier] = resolveModel({ backend: registryBackend, capability });
    }
    providers[consoleKey] = comment ? { _comment: comment, ...tiers } : tiers;
  }

  // LM Studio: not registry-tier-derived (see comment above). Kept literal —
  // stable across every capability, always has been.
  providers.lmstudio = {
    _comment:
      "LM Studio serves whatever model is loaded in the app; the concrete id is resolved at runtime (GET /v1/models reports it). 'local-model' is the conventional placeholder and is priced by the daemon's lmstudio catch-all electricity-proxy rate, so every tier launches. Load 'Qwen 3 Next Coder' as the prime in LM Studio.",
    high: 'local-model',
    mid: 'local-model',
    low: 'local-model',
  };

  return {
    _comment:
      "Single source of truth for provider capability tiers. GENERATED from lib/model-registry-data.ts by scripts/generate-console-model-tiers.ts — do not hand-edit; run `npx tsx scripts/generate-console-model-tiers.ts --write` after changing the registry. Every model id MUST exist in the daemon's cost-rate registry (lib/cost-tracker MODEL_RATES) or the launch fails closed with a 'no cost rate entry' message; when that happens, fix the id in lib/model-registry-data.ts. The 'low' tier of each provider mirrors the daemon's DEFAULT_OPERATOR_*_MODEL, which is guaranteed priced.",
    _tiers: ['high = most capable', 'mid = balanced', 'low = fast & cheap (daemon operator default)'],
    providers,
  };
}

/**
 * CLI entry: report or rewrite the console's copy.
 *
 * The rationale for defaulting to REPORT rather than write: a generator that
 * silently rewrites a committed artifact on every invocation makes the drift it
 * exists to prevent invisible in review. `--write` is the deliberate act.
 *
 * @returns Process exit code — non-zero when the checked-in file is stale.
 */
function main(): void {
  const write = process.argv.includes('--write');
  const data = buildConsoleModelTiers();
  const json = JSON.stringify(data, null, 2) + '\n';
  if (write) {
    writeFileSync(CONSOLE_MODEL_TIERS_PATH, json, 'utf8');
    console.log(`Wrote ${CONSOLE_MODEL_TIERS_PATH}`);
  } else {
    process.stdout.write(json);
    // Dry-run drift check: report whether the checked-in file differs.
    try {
      const existing = readFileSync(CONSOLE_MODEL_TIERS_PATH, 'utf8');
      if (existing !== json) {
        console.error('\n! core/pd-console/config/model-tiers.json is STALE relative to the registry. Re-run with --write.');
        process.exitCode = 1;
      }
    } catch {
      /* file doesn't exist yet — nothing to diff */
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
