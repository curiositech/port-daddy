/**
 * Documentation surfaces may SHOW model ids — but only ids that still exist.
 *
 * The no-hardcoded-model-ids guard asks "is a model chosen here?" and the answer
 * for a docs page is no: a rendered `pd spawned` table or a sample MCP response
 * is illustrating what the operator sees, and replacing the id with a
 * placeholder makes the illustration worse rather than the code better. So
 * those files are exempt there.
 *
 * That exemption is exactly how documentation rots. The 2026-08-22 audit found
 * the website advertising `gemini-2.5-flash`, `qwen2.5-coder:7b` and
 * `@cf/qwen/qwen3-30b-a3b-fp8` — ids no live backend still resolves to — beside
 * a fleet-config example teaching a `model:` key the parser had stopped reading.
 * A newcomer copying either got something that does not work, and nothing in CI
 * disagreed with them.
 *
 * This test is the other half of the exemption: docs may name an id, and every
 * id they name must be one config/models.yaml still maps. It is deliberately
 * narrower than the guard — it does not care WHERE an id appears, only that it
 * is real — so the two together say: business logic resolves, documentation
 * illustrates, and both track one source.
 */

import { describe, test, expect } from '@jest/globals';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const { allRegisteredModelIds, _resetRegistryCache } = await import('../../lib/model-registry.js');
const { MODEL_REGISTRY_DATA } = await import('../../lib/model-registry-data.js');

/** Documentation surfaces scanned for stale ids. */
const DOC_ROOTS = ['website-v2/src', 'README.md'];

const INCLUDE_EXTS = new Set(['.ts', '.tsx', '.md']);
const EXCLUDE_DIRS = new Set([
  'node_modules',
  'dist',
  '.git',
  // Blog posts are DATED records of what was true when they were written. A post
  // describing the 2026-07 backend-readiness incident names the ids that were in
  // play then; rewriting them to today's ids would falsify the account, which is
  // a worse outcome than a reader seeing a retired id inside a story about a
  // retired id.
  'blog',
]);

/**
 * Model-id-shaped tokens. Intentionally the same families the guard forbids in
 * business logic, so the two tests cover one vocabulary between them.
 */
const ID_SHAPES = [
  /@cf\/[a-z0-9._-]+\/[a-z0-9._-]+/gi,
  /\bclaude-(?:haiku|sonnet|opus|fable)-[0-9][a-z0-9.-]*/gi,
  /\bgpt-[0-9][a-z0-9.-]*/gi,
  /\bgemini-[0-9][a-z0-9.-]*/gi,
  /\bgrok-[0-9][a-z0-9.-]*/gi,
  /\bllama-[0-9]\.[0-9][a-z0-9.-]*/gi,
  /\b[a-z]+[0-9]+(?:\.[0-9]+)?(?:-[a-z]+)?:[0-9]+(?:\.[0-9]+)?[a-z]?\b/gi,
];

/**
 * Ids a doc may name that the registry deliberately does not map.
 *
 * Each is a THIRD-PARTY identifier the reader types into someone else's tool,
 * not a model Port Daddy selects — so the registry is not their source and
 * pinning them here is honest rather than lazy.
 */
const FOREIGN_IDS = new Set([
  // Codex CLI's own model names, shown when documenting `pd squid`'s alias map.
  'gpt-5.1-codex',
]);

function* walk(target) {
  const abs = join(REPO_ROOT, target);
  let st;
  try { st = statSync(abs); } catch { return; }
  if (st.isFile()) { yield { path: abs, rel: target }; return; }
  for (const e of readdirSync(abs, { withFileTypes: true })) {
    if (EXCLUDE_DIRS.has(e.name)) continue;
    const rel = join(target, e.name);
    if (e.isDirectory()) { yield* walk(rel); continue; }
    const ext = e.name.slice(e.name.lastIndexOf('.'));
    if (INCLUDE_EXTS.has(ext)) yield { path: join(REPO_ROOT, rel), rel };
  }
}

describe('documentation names only model ids the registry still maps', () => {
  test('every model id shown in docs resolves in config/models.yaml', () => {
    _resetRegistryCache();
    // "Still mapped by a capability rung" is the wrong question to ask of a
    // doc. A doc names an id to SHOW the reader a real model — and the Workers
    // AI universe is full of ids that are real, priced, and pinnable without
    // filling a rung. The question that matters is whether the id still exists
    // in the catalog at all; an id that has left the catalog is the one that
    // will 404, or worse, hang.
    const live = new Set(
      [...allRegisteredModelIds(), ...Object.keys(MODEL_REGISTRY_DATA.models)].map((id) =>
        id.toLowerCase(),
      ),
    );
    const stale = [];

    for (const target of DOC_ROOTS) {
      for (const { path, rel } of walk(target)) {
        const lines = readFileSync(path, 'utf-8').split('\n');
        for (let i = 0; i < lines.length; i++) {
          for (const shape of ID_SHAPES) {
            for (const m of lines[i].matchAll(shape)) {
              const id = m[0];
              if (FOREIGN_IDS.has(id)) continue;
              if (live.has(id.toLowerCase())) continue;
              stale.push(`  ${rel}:${i + 1}  ${id}`);
            }
          }
        }
      }
    }

    if (stale.length) {
      throw new Error(
        `Documentation names ${stale.length} model id(s) the registry no longer maps:\n` +
          `${[...new Set(stale)].join('\n')}\n\n` +
          `Update the doc to a currently-mapped id (see config/models.yaml), or — if it is\n` +
          `a third-party tool's own model name the reader types elsewhere — add it to\n` +
          `FOREIGN_IDS in this test with the reason.`,
      );
    }
    expect(stale).toEqual([]);
  });
});
