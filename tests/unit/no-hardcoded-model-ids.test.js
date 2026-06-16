/**
 * CI guard: no hardcoded model IDs in runtime business logic.
 *
 * Rule (operator directive 2026-06-15; see ADR-0057 + lib/model-registry.ts):
 *   Model IDs churn like secrets — `claude-sonnet-4-6` becomes `-4-7` next month
 *   and every literal scattered across the repo silently rots. Runtime code and
 *   config must declare INTENT — a backend + a capability (`cheap` / `high` /
 *   `max-thinking`) — and resolve the concrete ID through
 *   `resolveModel()` (lib/model-registry.ts), which reads the one data file
 *   `config/model-registry.json` (refreshed per build). Never hardcode an ID in
 *   business logic.
 *
 * A literal model ID anywhere under lib/ routes/ cli/ mcp/ — outside the
 * allowlisted ENUMERATION surfaces — fails this test.
 *
 * Legitimately ID-keyed surfaces (a pricing table, a provider's supported-model
 * validation list, a per-model context-window table, a benchmark suite) MUST
 * enumerate IDs; those are in ALLOWED_FILES with a one-line reason. New entries
 * require reviewer sign-off — the allowlist is the visible exception set, not a
 * silent escape hatch.
 */

import { describe, test, expect } from '@jest/globals';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');

// Files allowed to contain literal model IDs. Each MUST say why.
const ALLOWED_FILES = new Set([
  // The registry source + resolver themselves.
  'lib/model-registry.ts',
  // Pricing table — rates are keyed by model ID by definition.
  'lib/cost-tracker.ts',
  // Backend catalog — enumerates each provider's offered models (a catalog).
  'lib/backend-catalog.ts',
  // Per-model context-window limits — a capability table keyed by model family.
  'lib/context-window-tracker.ts',
  // Benchmark suite — names the exact models under test.
  'lib/benchmark.ts',
  'cli/commands/benchmark.ts',
  // Provider supported-model VALIDATION allowlists (reject unknown user input).
  'lib/spawner/backends/groq.ts',
  'lib/spawner/backends/openai.ts',
  // FOLLOW-UP: archetype backendDefault slugs still embed an id; convert to a
  // capability descriptor in a follow-up. Tracked, not silently exempt.
  'lib/shipwright/archetypes.ts',
  // This guard test itself.
  'tests/unit/no-hardcoded-model-ids.test.js',
]);

const ENFORCED_PATH_PREFIXES = ['lib/', 'routes/', 'cli/', 'mcp/'];

// Churning, provider-API model IDs. Deliberately does NOT match stable CLI short
// aliases (`haiku`/`sonnet`/`opus`), local ollama names (`llama3.1:8b`), or the
// bare backend placeholders (`claude-cli`, `codex`) — those are not API IDs.
const FORBIDDEN_PATTERNS = [
  'claude-(haiku|sonnet|opus)-[0-9]',
  'gpt-[0-9]',
  '@cf/',
  'gemini-[0-9]\\.',
  'llama-[0-9]\\.[0-9]',
  'grok-[0-9]',
];

const INCLUDE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const EXCLUDE_DIRS = new Set(['node_modules', '.build', 'dist', '.git']);

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

function findOffenders(pattern) {
  const re = new RegExp(pattern);
  const offenders = [];
  for (const prefix of ENFORCED_PATH_PREFIXES) {
    for (const { path, rel } of walk(join(REPO_ROOT, prefix.replace(/\/$/, '')))) {
      if (!isEnforced(rel)) continue;
      if (ALLOWED_FILES.has(rel)) continue;
      let content;
      try { content = readFileSync(path, 'utf-8'); }
      catch { continue; }
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (isCommentLine(lines[i])) continue;
        if (re.test(lines[i])) {
          offenders.push({ path: rel, lineNumber: i + 1, line: lines[i].trim() });
        }
      }
    }
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
          `Concrete IDs live ONLY in config/model-registry.json (refreshed per build).\n` +
          `If this file legitimately enumerates IDs (pricing, catalog, validation),\n` +
          `add it to ALLOWED_FILES in this test with a one-line reason.`,
        );
      }
      expect(offenders).toEqual([]);
    });
  }
});
