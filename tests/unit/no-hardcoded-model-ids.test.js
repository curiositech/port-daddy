/**
 * CI guard: no hardcoded model IDs in runtime business logic.
 *
 * Rule (operator directive 2026-06-15; see ADR-0057 + lib/model-registry.ts):
 *   Model IDs churn like secrets — `claude-sonnet-4-6` becomes `-4-7` next month
 *   and every literal scattered across the repo silently rots. Runtime code and
 *   config must declare INTENT — a backend + a capability (`cheap` / `high` /
 *   `max-thinking`) — and resolve the concrete ID through
 *   `resolveModel()` (lib/model-registry.ts), which reads the one data file
 *   `lib/model-registry-data.ts` (refreshed per build). Never hardcode an ID in
 *   business logic.
 *
 * A literal model ID anywhere under lib/ routes/ cli/ mcp/ core/ config/ (plus
 * a short list of individually-tracked root files) — outside the allowlisted
 * ENUMERATION surfaces — fails this test.
 *
 * Legitimately ID-keyed surfaces (a pricing table, a provider's supported-model
 * validation list, a per-model context-window table, a benchmark suite, a
 * CLI's own short-alias vocabulary like `opus`/`sonnet`/`haiku`, a GENERATED
 * artifact whose drift is checked by its own test) MUST enumerate IDs; those
 * are in ALLOWED_FILES with a one-line reason. New entries require reviewer
 * sign-off — the allowlist is the visible exception set, not a silent escape
 * hatch.
 *
 * 2026-07-14 (ADR-0057 model-abstraction unification) widened coverage after
 * an audit found hardcodes this guard's original scope structurally could not
 * see: `core/` was unwalked entirely (the Rust console's hand-edited
 * model-tiers.json had already drifted from the TS registry), yaml/json
 * config was unscanned (v4.dag.yaml, config/managed-agents.json), and the
 * regex set required a version-number dash so it missed dash-less local tags
 * (`llama3.1:8b`) and bare vendor nicknames used as if they were an API id
 * (`'opus'` outside the CLI-alias allowlist).
 */

import { describe, test, expect } from '@jest/globals';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');

// Files allowed to contain literal model IDs. Each MUST say why.
const ALLOWED_FILES = new Set([
  // The registry data + resolver themselves — the ONE home for concrete IDs.
  'lib/model-registry-data.ts',
  'lib/model-registry.ts',
  // Pricing table — rates are keyed by model ID by definition.
  'lib/cost-tracker.ts',
  // Per-model context-window limits — a capability table keyed by model family.
  'lib/context-window-tracker.ts',
  // Benchmark suite — names the exact models under test.
  'lib/benchmark.ts',
  'cli/commands/benchmark.ts',
  // Provider supported-model VALIDATION allowlists (reject unknown user input).
  'lib/spawner/backends/groq.ts',
  'lib/spawner/backends/openai.ts',
  // xAI provider supported-model VALIDATION allowlist (same category as groq/openai).
  'lib/spawner/backends/xai.ts',
  // Local-citizen per-backend DEFAULT-model map — an enumeration keyed by backend,
  // one default ID per OpenAI-compatible substrate (groq/lmstudio/ollama).
  'lib/local-citizen/backends.ts',
  // claude-cli / codex CLI short-ALIAS tables (haiku/sonnet/opus, gpt/o-prefix
  // detection) — these are the real `--model` values those CLIs accept, not
  // churning API ids. Same category as backend-catalog.ts above.
  'lib/fleet-runtime.ts',
  'lib/spawn-forecast.ts',
  'lib/spawner/backends/cli-tube-provider-specs.ts',
  // Persona manifest: `claude_local` is the CLI short-alias the Pilot persona
  // launches with locally, not an API id.
  'lib/pilot-agent-render.ts',
  // GENERATED artifact from lib/model-registry-data.ts
  // (scripts/generate-console-model-tiers.ts) — drift is checked by
  // tests/unit/console-model-tiers-sync.test.js, not this guard.
  'core/pd-console/config/model-tiers.json',
  // GENERATED receipt of the actual deployed Anthropic managed-agent version
  // (scripts/create-managed-agent.ts writes it after the real API call).
  // config/managed-agents.json records what WAS created — analogous to a
  // lockfile — while the INPUT (agents/port-daddy-pilot/agent.config.json)
  // declares intent via `capability` and resolves through resolveModel().
  'config/managed-agents.json',
  // Rust console: presentational vendor-color-chip lookup against the
  // WorkPlan/predicted-DAG's own model_tier vocabulary (vendor nicknames —
  // "opus"/"sonnet"/"haiku"/"gemini"/"codex"/"gpt"/… — a DIFFERENT, human-
  // readable tier vocabulary than the runtime capability ladder; see
  // work_plan.rs). Chip color only — no backend/spawn decision reads this.
  'core/pd-console/src/app.rs',
  'core/pd-conjure-proto/src/scene.rs',
  // WorkPlan struct + its own inline #[cfg(test)] fixtures using that same
  // vendor-nickname model_tier vocabulary.
  'core/pd-console/src/work_plan.rs',
  'core/pd-conjure-proto/fixture.json',
  // Inline Rust #[cfg(test)] fixtures mocking a real daemon transcript
  // payload (backend/model pass-through, not a resolution call site).
  'core/pd-console/src/lane_pane.rs',
  // Static demo/mock TUI screen text for the `vibe` showcase binary — not a
  // runtime model-selection call site.
  'core/pd-tui/src/bin/vibe.rs',
  // THE canonical source of truth for every model id in the repo — and the two
  // artifacts generated from it (drift asserted by model-registry-canon).
  'config/models.yaml',
  'apps/shared/model-registry.generated.ts',
  // agent-harbor v0 schema FIXTURES: example payloads whose whole job is to show
  // a realistic recorded value. A fixture with a resolved-at-runtime placeholder
  // would stop demonstrating the shape it exists to demonstrate.
  'schemas/agent-harbor/v0/fixtures/agent-run.json',
  'schemas/agent-harbor/v0/fixtures/body.json',
  'schemas/agent-harbor/v0/fixtures/cost-accrual-event.json',
  'schemas/agent-harbor/v0/fixtures/durable-agent-profile.json',
  'schemas/agent-harbor/v0/fixtures/work-receipt.json',
  // DOCUMENTATION ILLUSTRATIONS. These render sample terminal output, sample
  // MCP/SDK responses, and `--model` flag examples — the explicit-override
  // escape hatch, which is the one place a literal id is the correct thing to
  // show. Replacing them with placeholders would make the documentation worse
  // rather than the code better. They are NOT unguarded:
  // tests/unit/docs-model-ids-current.test.js asserts every id these files name
  // is one the registry still maps, which is the failure that actually bites a
  // reader (the website advertised gemini-2.5-flash for weeks after it stopped
  // resolving). Fleet-CONFIG examples are a different category and were
  // converted to `capability:` — a doc teaching a key the parser stopped
  // reading is a bug, not an illustration.
  'website-v2/src/components/agents/AgentAnatomy.tsx',
  'website-v2/src/components/landing/TerminalDemos.tsx',
  'website-v2/src/data/docs.ts',
  'website-v2/src/docs-content/referenceArchitectures.ts',
  'website-v2/src/pages/AgentsPage.tsx',
  'website-v2/src/pages/SquidCodexPage.tsx',
  'website-v2/src/pages/docs/cli/SpawnCommand.tsx',
  'website-v2/src/pages/docs/cli/SpawnedCommand.tsx',
  'website-v2/src/pages/docs/mcp/ListSpawnedTool.tsx',
  'website-v2/src/pages/docs/mcp/SpawnTool.tsx',
  'website-v2/src/pages/docs/sdk/ListSpawned.tsx',
  'website-v2/src/pages/tutorials/AlwaysOn.tsx',
  'website-v2/src/pages/tutorials/Spawn.tsx',
  // This guard test itself.
  'tests/unit/no-hardcoded-model-ids.test.js',
]);

// 2026-08-23 (canonical-model-registry supplant): the perimeter now covers every
// plane that can put an id in front of a provider. The audit that motivated
// config/models.yaml found the WORST drift outside the old perimeter — the cloud
// plane (apps/) carried its own hardcoded constants including a phantom id, and
// pd-fleet.yml pinned models by literal in 36 places. A guard that cannot see the
// planes that drift is a guard that certifies drift.
const ENFORCED_PATH_PREFIXES = [
  'lib/',
  'routes/',
  'cli/',
  'mcp/',
  'core/',
  'config/',
  'apps/',
  'scripts/',
  'schemas/',
  'roles/',
  'fleet/',
  'website-v2/src/',
];

// Individually-tracked root-level files outside the prefixes above (walk()
// only recurses into directories; a lone top-level file needs its own entry).
const ENFORCED_FILES = ['v4.dag.yaml', 'pd-fleet.yml', 'README.md'];

// Churning, provider-API model IDs, PLUS local-tag defaults (dash-less
// `provider3.1:8b`-shaped ollama tags) and bare vendor nicknames used as a
// stand-in model id. Deliberately does NOT match the bare backend
// placeholders (`claude-cli`, `codex`) — those are not model ids at all.
const FORBIDDEN_PATTERNS = [
  'claude-(haiku|sonnet|opus)-[0-9]',
  'gpt-[0-9]',
  // Require the vendor path, so a `startsWith('@cf/')` PREFIX TEST — which is
  // the shape that distinguishes a Workers AI id from any other string, and is
  // therefore exactly what a non-hardcoding file writes — is not itself
  // reported as a hardcoded id.
  '@cf/[a-z0-9._-]+/',
  'gemini-[0-9]\\.',
  'llama-[0-9]\\.[0-9]',
  'grok-[0-9]',
  // Dash-less local model tags: llama3.1:8b, qwen2.5-coder:7b, deepseek-r1:32b.
  // The part after the colon must be digit-led (a parameter-count size spec,
  // optionally decimal, optionally one trailing unit letter) — narrower than
  // "any word after a colon" so it doesn't trip on unrelated `key:value`
  // strings (a content hash "sha256:unknown", a semantic id
  // "project:stack:context").
  '\\b[a-z]+[0-9]+(\\.[0-9]+)?(-[a-z]+)?:[0-9]+(\\.[0-9]+)?[a-z]?\\b',
  // Bare vendor nicknames as a quoted string value, standing in for a real
  // model id outside the documented CLI-alias allowlist above.
  "['\"](opus|sonnet|haiku)['\"]",
  "['\"]gpt['\"]",
];

const INCLUDE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.rs', '.yaml', '.yml', '.json']);
const EXCLUDE_DIRS = new Set(['node_modules', '.build', 'dist', '.git', 'target', 'bundle']);

function isTestFile(name) {
  return /\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs)$/.test(name);
}

// Skip comment lines — JSDoc/// examples legitimately mention model IDs. We only
// care about IDs baked into executable code (string literals in logic/data).
function isCommentLine(line) {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('#');
}

function* walk(dir) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); }
  catch { return; }
  for (const e of entries) {
    if (EXCLUDE_DIRS.has(e.name)) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      yield* walk(full);
    } else if (e.isFile()) {
      if (isTestFile(e.name)) continue;
      const ext = e.name.slice(e.name.lastIndexOf('.'));
      if (!INCLUDE_EXTS.has(ext)) continue;
      yield { path: full, rel: relative(REPO_ROOT, full) };
    }
  }
}

function isEnforced(rel) {
  return ENFORCED_PATH_PREFIXES.some((p) => rel.startsWith(p));
}

function scanFile(path, rel, re, offenders) {
  if (ALLOWED_FILES.has(rel)) return;
  let content;
  try { content = readFileSync(path, 'utf-8'); }
  catch { return; }
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (isCommentLine(lines[i])) continue;
    if (re.test(lines[i])) {
      offenders.push({ path: rel, lineNumber: i + 1, line: lines[i].trim() });
    }
  }
}

function findOffenders(pattern) {
  const re = new RegExp(pattern);
  const offenders = [];
  for (const prefix of ENFORCED_PATH_PREFIXES) {
    for (const { path, rel } of walk(join(REPO_ROOT, prefix.replace(/\/$/, '')))) {
      if (!isEnforced(rel)) continue;
      scanFile(path, rel, re, offenders);
    }
  }
  for (const rel of ENFORCED_FILES) {
    scanFile(join(REPO_ROOT, rel), rel, re, offenders);
  }
  return offenders;
}

describe('no-hardcoded-model-ids', () => {
  for (const pattern of FORBIDDEN_PATTERNS) {
    test(`no runtime file hardcodes a model ID matching /${pattern}/`, () => {
      const offenders = findOffenders(pattern);
      if (offenders.length > 0) {
        const detail = offenders.map((o) => `  ${o.path}:${o.lineNumber}  ${o.line}`).join('\n');
        throw new Error(
          `Found ${offenders.length} hardcoded model ID(s) in runtime code:\n${detail}\n\n` +
          `Declare intent and resolve at the last second instead:\n` +
          `  import { resolveModel } from './model-registry.js';\n` +
          `  const model = resolveModel({ backend, capability: 'cheap' });\n` +
          `Concrete IDs live ONLY in lib/model-registry-data.ts (refreshed per build).\n` +
          `If this file legitimately enumerates IDs (pricing, catalog, validation),\n` +
          `add it to ALLOWED_FILES in this test with a one-line reason.`,
        );
      }
      expect(offenders).toEqual([]);
    });
  }
});
