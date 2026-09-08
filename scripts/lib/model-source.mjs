/**
 * Read the canonical model source from a plain-Node script.
 *
 * WHY THIS EXISTS. `lib/model-registry.ts` is the daemon's resolver, and a
 * `.mjs` script run by bare `node` cannot import a TypeScript module — the
 * import throws ERR_MODULE_NOT_FOUND and the script dies before it does
 * anything. That is not a hypothetical: it is exactly what happened when the
 * canonical-registry sweep converted two node scripts to `resolveModel()`
 * without noticing they run outside tsx.
 *
 * The wrong fixes were both available and both worse. Hardcoding an id back
 * into the scripts would make them the first place the canonical registry
 * stopped being canonical — the precise rot the registry exists to end.
 * Requiring every operator script to run under `tsx` would trade a one-line
 * reader for a toolchain dependency in scripts whose whole value is that they
 * run anywhere, including a bare CI container.
 *
 * So this reads `config/models.yaml` — the SAME source the generator reads, not
 * a copy of its output. There is one source of truth; this is a second reader
 * of it, which is a different thing from a second source.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

let cached = null;

/**
 * Parse the canonical model source, memoized.
 *
 * @returns The parsed `config/models.yaml` document.
 */
export function loadModelSource() {
  if (!cached) {
    cached = parseYaml(readFileSync(join(ROOT, 'config', 'models.yaml'), 'utf8'));
  }
  return cached;
}

/**
 * The concrete model id for a (backend, capability) pair.
 *
 * Mirrors `resolveModel()`'s lookup, including backend aliasing, but without
 * its explicit-override precedence — a script that wants an override already
 * has one in its own argv or env, and re-implementing that half here would be
 * the beginning of a second resolver.
 *
 * @param {string} backend Backend key or alias.
 * @param {string} [capability] Capability rung; defaults to `cheap`.
 * @returns {string|undefined} The model id, or undefined when unmapped.
 */
export function modelFor(backend, capability = 'cheap') {
  const doc = loadModelSource();
  const canonical = doc.backendAliases?.[backend] ?? backend;
  return doc.backends?.[canonical]?.[capability];
}

/**
 * The value a tier-aware agent CLI accepts on its `--model` flag.
 *
 * A transport vocabulary (family nicknames like `sonnet`), not a second model
 * list — see `vocabularies.cliAliases` in the source.
 *
 * @param {string} cli The CLI transport key, e.g. `claude-cli`.
 * @param {string} [capability] Capability rung; defaults to `cheap`.
 * @returns {string|undefined} The flag value, or undefined when that CLI takes real ids.
 */
export function cliAliasFor(cli, capability = 'cheap') {
  return loadModelSource().vocabularies?.cliAliases?.[cli]?.[capability];
}

/**
 * The concrete Workers AI id for a named cloud-plane role.
 *
 * @param {string} role A role from `cloudPlaneRoles`.
 * @returns {string|undefined} The model id, or undefined for an unknown role.
 */
export function cloudRoleFor(role) {
  return loadModelSource().cloudPlaneRoles?.[role];
}
