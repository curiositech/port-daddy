/**
 * Purser contract for #7504, obligations 1 and 6 — every `pd` command the
 * README shows in a checkable example must exist in the authoritative CLI
 * registry (cli/permission-tiers.ts), and the checker must have real teeth
 * (it must be able to FAIL on a verb that does not exist).
 *
 * REPAIRED IN PLACE (argue-with-the-test protocol). Defects in the authored
 * draft, each fixed while keeping the adversarial intent:
 *
 *   1. FAILED TO LOAD. `__dirname` does not exist in this repo's test
 *      runtime (jest runs .ts tests as ESM); the suite crashed before any
 *      assertion. Repaired with `dirname(fileURLToPath(import.meta.url))`.
 *   2. FANTASY LAYOUT. The draft demanded a `cli/commands/<verb>.{ts,js}`
 *      file per README verb. The real CLI has no file-per-verb contract:
 *      cli/permission-tiers.ts's TIER_REGISTRY is the dispatch authority,
 *      and its keys include aliases (`w`, `f`, `l`, `ps`) and grouped verbs
 *      that share one source file. Demanding a file per verb fails honest
 *      READMEs and passes drifted ones — the check is now against the REAL
 *      registry, loaded through #7504's own `loadCommandSurface()` (the
 *      exact loader the readme-accuracy-guard CI job dispatches on, TS-AST
 *      parse with a guarded regex fallback), so this test and the gate
 *      cannot disagree about what the surface is.
 *   3. FANTASY REGISTRY SHAPE. The draft guessed at exports
 *      (`mod.permissionTiers` / `mod.default` / "the module itself") — none
 *      of which is the real named export, and the last of which would have
 *      treated helper exports like `ALL_TIERS` as verbs.
 *   4. PROSE FALSE POSITIVES. `\bpd\s+(\w+)/g` over the WHOLE document
 *      matches English ("pd help", "pd verb and subcommand" in prose,
 *      alt-text, anchors). The real obligation is about the EXAMPLES, so
 *      extraction now uses #7504's own fence parser
 *      (skills/readme-craft/scripts/extract-examples.mjs) over checkable
 *      (`surface`/`run`-tier) blocks — the same corpus the CI gate checks.
 *
 * Strengthened with the negative test #7504's PR body performed by hand:
 * the surface must REJECT a plausible fake verb (`notez`) while accepting
 * its real neighbor (`notes`) — a validator that cannot fail is not one.
 */
import { readFileSync } from 'fs';
import path, { dirname } from 'path';
import { fileURLToPath } from 'url';
import { test, expect } from '@jest/globals';
// #7504's own registry loader and fence parser — the same code the
// readme-accuracy-guard CI job runs, so test and gate cannot disagree.
import { loadCommandSurface } from '../../../scripts/check-readme-accuracy.mjs';
import { extractFences, shellInvocations } from '../../../skills/readme-craft/scripts/extract-examples.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const readmePath = path.resolve(here, '../../../README.md');

/** Placeholder tokens an author writes deliberately; not a real verb. */
const PLACEHOLDER = /^(<.*>|\[.*\]|\.\.\.|\$\{?\w+\}?)$/;

/**
 * Extract every `pd <verb>` from the README's checkable example blocks —
 * the corpus the accuracy gate itself checks.
 */
function extractReadmeVerbs(): Map<string, number> {
  const content = readFileSync(readmePath, 'utf8');
  const verbs = new Map<string, number>();
  for (const block of extractFences(content)) {
    if (block.tier !== 'surface' && block.tier !== 'run') continue;
    for (const inv of shellInvocations(block.code)) {
      if (inv.argv[0] !== 'pd' && inv.argv[0] !== 'port-daddy') continue;
      const verb = inv.argv[1];
      if (!verb || PLACEHOLDER.test(verb)) continue;
      verbs.set(verb, (verbs.get(verb) ?? 0) + 1);
    }
  }
  return verbs;
}

test('README CLI commands are valid against the real registry', () => {
  const surface = loadCommandSurface();
  const readmeVerbs = extractReadmeVerbs();

  // A README with no checkable pd examples would make this a vacuous pass.
  expect(readmeVerbs.size).toBeGreaterThan(0);

  const missingInTiers = [...readmeVerbs.keys()].filter((v) => !surface.verbs.has(v));
  if (missingInTiers.length) {
    throw new Error(
      `The following commands are referenced in README examples but missing from cli/permission-tiers.ts: ${missingInTiers.join(', ')}`,
    );
  }
});

test('the registry surface has teeth: rejects a fake verb, accepts its real neighbor', () => {
  const surface = loadCommandSurface();
  // The exact injection #7504's PR body verified by hand (`pd notez` →
  // unknown-verb), now pinned executable: if the loader ever degrades into
  // accepting everything (or into an empty set its own minimum-size guard
  // somehow missed), this fails.
  expect(surface.verbs.has('notes')).toBe(true);
  expect(surface.verbs.has('notez')).toBe(false);
  // Sanity: the surface is the real, full registry, not a stub.
  expect(surface.verbs.size).toBeGreaterThanOrEqual(50);
});
