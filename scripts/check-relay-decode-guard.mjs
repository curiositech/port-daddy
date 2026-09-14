#!/usr/bin/env node
/**
 * check-relay-decode-guard.mjs — stops a class of malformed-URL 500s from
 * coming back, in every source area configured below.
 *
 * ORIGIN: PR #10150 fixed 13 Relay router routes that called the throwing
 * builtin `decodeURIComponent` raw instead of through the router's existing
 * fail-closed helper, `safeDecodeSegment`. Four independent review bots on
 * that PR asked for a mechanical guard so route #14 could not reintroduce the
 * defect; PR #10156 added it, scoped to `apps/relay/src/index.ts` alone.
 * pd-lookout's follow-up review on that merge pointed out the obvious gap —
 * every OTHER Relay source file was unchecked — and pd-spark's asked for the
 * rule itself to generalize beyond Relay. This file is both fixes: the scan
 * now covers the declared file set below (a list or a `**` glob, never a
 * single hard-coded path an added file could silently fall outside of), and
 * the rule it enforces — "forbidden identifier" and "sanctioned helper" — is
 * a config per AREA, not a constant baked into the walker.
 *
 * THE RULE, per configured area: no raw reference to that area's
 * `forbiddenIdentifier` anywhere in its `files`, OUTSIDE the body of its
 * `helperName` function — wherever in the area that function is actually
 * defined. Every other file in the area must IMPORT the helper and call it;
 * it must never reimplement the try/catch itself, which is exactly the
 * duplication PR #10150's own review turned up (see AREAS.relay.files below
 * — apps/relay/src/coordination.ts used to hand-roll the same try/catch
 * decode instead of calling the one shared helper, and now imports it).
 *
 * WHY (concretely, for the Relay area): `decodeURIComponent` throws
 * `URIError` on a malformed percent-escape (`%ZZ`). A raw call — or a raw
 * bare reference, e.g. `.map(decodeURIComponent)` — lets that throw escape
 * routing and reach the worker's global boundary, which answers a bare 500
 * INTERNAL_ERROR for what is only a bad URL. `safeDecodeSegment` is the
 * legitimate call site: it turns the throw into `''` fail-closed, for the
 * caller's own existing validation to reject like any other bad input.
 *
 * Deliberately NOT the two related-but-wrong rules other bots also proposed:
 *   - Banning the forbidden identifier outright — impossible, the helper's
 *     own body must call it; its body is the one exempted site.
 *   - Requiring the decoded result be compared against `''` — too narrow
 *     (most call sites reject '' via a regex/shape test, a DB lookup that
 *     misses, or `Number('') === 0`, never an equality check) and answers a
 *     human-review question ("does this route reject '' downstream?"), not
 *     something a mechanical rule can decide.
 *
 * AREA CONFIG is deliberately data, not code: adding coverage for another
 * app that decodes URL segments raw (a fresh `apps/<name>/` audited for the
 * same defect class) is one entry in AREAS, naming its own files, its own
 * forbidden identifier, and its own sanctioned helper — no new walker logic.
 * A survey across `apps/` at the time this file was written found exactly
 * one other candidate identifier in real code, `apps/relay/src/coordination.ts`
 * (folded into the relay area below); every other app under `apps/` has zero
 * `decodeURIComponent` references and gets no entry — inventing one for an
 * app that does not decode URL segments would just be a config that always
 * trivially passes, worse than no entry at all.
 *
 * PER-AREA HELPER ANCHOR (fail-closed by construction, not just by test):
 * this script requires `helperName` to resolve to an actual function
 * declaration or `const NAME = (...) => {}` / `const NAME = function(...){}`
 * in AT LEAST ONE of the area's files before it will bless anything in that
 * area as clean. Renaming the helper — anywhere the config isn't updated in
 * the same commit — makes the anchor unresolvable, and the guard exits 2
 * (not 0, and not the "1 violation" exit code) rather than silently reporting
 * every file clean because it can no longer find anything to flag. See
 * tests/unit/relay-decode-guard.test.js's "renamed helper" case, which
 * reproduces exactly this by cloning a working fixture and renaming its
 * helper without touching this file's config.
 *
 * AST-based (TypeScript compiler API), not text/regex, for two reasons:
 *   1. A raw reference passed as a bare callback has no trailing `(` — the
 *      naive text search `decodeURIComponent(` MISSES `.map(decodeURIComponent)`,
 *      which is the actual shape of two of the sites this guard exists to
 *      catch (apps/relay/src/index.ts's /account/parleys/ and
 *      /account/harbors/ branches).
 *   2. Parsing means comments and string literals that merely MENTION the
 *      name — this very file's own docstrings, including safeDecodeSegment's
 *      — never trip the guard, without hand-written comment-stripping
 *      regexes that are themselves a source of false positives/negatives.
 *
 * Usage:
 *   node scripts/check-relay-decode-guard.mjs
 *     Scans every file in every configured area. This is the real CI use.
 *   node scripts/check-relay-decode-guard.mjs <path> [--area=<name>]
 *     Overrides the file set with a single explicit path (sandbox fixtures
 *     used by the regression tests; real CI use never passes a path).
 *     `--area` selects which area's forbidden-identifier/helper-name rule to
 *     apply to that one file; it defaults to the first configured area
 *     ("relay") since every existing fixture is written against that rule.
 */
import ts from 'typescript';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Every area this guard scans. Add an entry here to cover another app —
 * nothing else in this file needs to change.
 *
 *   name                A short label used only in messages.
 *   files                A list of repo-relative paths and/or `**` globs of
 *                        the shape `<dir>/**\/*.<ext>` (recursive; the only
 *                        wildcard shape this guard supports, which is enough
 *                        to name "every TypeScript file under this source
 *                        tree" without hand-maintaining the file list).
 *   forbiddenIdentifier  The raw builtin/global that must not be referenced
 *                        outside the helper.
 *   helperName           The sanctioned helper's declared name. Must resolve
 *                        to a real function/const-arrow declaration in at
 *                        least one of `files`, or the area fails closed
 *                        (exit 2) — see the file-level comment above.
 */
export const AREAS = [
  {
    name: 'relay',
    files: ['apps/relay/src/**/*.ts'],
    forbiddenIdentifier: 'decodeURIComponent',
    helperName: 'safeDecodeSegment',
  },
];

const DEFAULT_AREA = AREAS[0].name;

/**
 * Expand one glob-or-literal entry to a sorted list of absolute file paths.
 * Supports exactly two shapes: a literal repo-relative file path, and
 * `<dir>/**\/*.<ext>` (every file with that extension anywhere under `<dir>`,
 * recursively). Anything else is rejected loudly rather than silently
 * matching nothing — a typo'd glob that scans zero files is a guard that
 * passes for the wrong reason.
 */
function expandEntry(entry) {
  const starstar = '/**/*.';
  const idx = entry.indexOf(starstar);
  if (idx === -1) {
    // Literal path.
    return [resolve(REPO, entry)];
  }
  const dir = entry.slice(0, idx);
  const ext = entry.slice(idx + starstar.length);
  if (!ext || entry.slice(idx + starstar.length).includes('/')) {
    throw new Error(`relay-decode-guard: unsupported glob shape "${entry}" (only "<dir>/**/*.<ext>" is supported)`);
  }
  const root = resolve(REPO, dir);
  const out = [];
  const walk = (absDir) => {
    for (const entryName of readdirSync(absDir, { withFileTypes: true })) {
      if (entryName.name === 'node_modules' || entryName.name.startsWith('.')) continue;
      const abs = join(absDir, entryName.name);
      if (entryName.isDirectory()) {
        walk(abs);
      } else if (entryName.isFile() && abs.endsWith(`.${ext}`)) {
        out.push(abs);
      }
    }
  };
  walk(root);
  out.sort();
  return out;
}

/** Every absolute file path a config's `files` list expands to, de-duplicated. */
function areaFiles(area) {
  const seen = new Set();
  for (const entry of area.files) {
    for (const abs of expandEntry(entry)) seen.add(abs);
  }
  return [...seen].sort();
}

/** Repo-relative display path when possible, else the raw absolute path
 * (sandbox fixtures used by the regression tests live outside the repo). */
function displayPath(absPath) {
  const rel = relative(REPO, absPath);
  return rel.startsWith('..') ? absPath : rel;
}

/**
 * Find the [start, end) character range of `helperName`'s own function body
 * in the source file — the one span where a raw reference to
 * `forbiddenIdentifier` is exempt. Handles both a function declaration and a
 * `const helperName = (...) => {...}` form, in case the helper is ever
 * refactored from one to the other.
 */
function findHelperRange(sourceFile, helperName) {
  let range = null;
  const visit = (node) => {
    if (range) return; // first (only) declaration wins
    if (ts.isFunctionDeclaration(node) && node.name?.text === helperName) {
      range = [node.getStart(sourceFile), node.getEnd()];
      return;
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === helperName &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    ) {
      range = [node.initializer.getStart(sourceFile), node.initializer.getEnd()];
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return range;
}

/**
 * True when an Identifier node named `forbiddenIdentifier` is purely a NAME —
 * syntax that spells that string without ever reading the value it names —
 * and so can never be the raw reference this guard exists to catch. Verified
 * empirically against the TypeScript AST (see PR #10156 review discussion)
 * before writing this list; each bucket below is a shape probing showed the
 * parser gives its own dedicated node kind whose `.name`/`.propertyName`
 * field never denotes a value read:
 *
 *   - `{ NAME: fn }` — a PropertyAssignment's `name` (object literal key).
 *     Deliberately NOT ShorthandPropertyAssignment: `{ NAME }` as an
 *     object-literal shorthand is a genuine value read of whatever NAME
 *     resolves to in scope, and must stay flagged like any other bare
 *     reference.
 *   - `import { NAME } from './x'` / `import { NAME as y } from './x'` /
 *     `export { NAME }` / `export { y as NAME }` — an ImportSpecifier's or
 *     ExportSpecifier's `name`/`propertyName`. These name what a module
 *     imports or exports; they never read the global.
 *   - `interface I { NAME: string }` / `type T = { NAME: string }` — a
 *     PropertySignature's `name` (type-member name, no runtime value at all).
 *   - `class C { NAME() {} }` / `NAME = x;` / `get NAME() {}` — a
 *     MethodDeclaration's, a PropertyDeclaration's, or a Get/SetAccessorDeclaration's
 *     `name` (class- or object-literal-method member name).
 *   - A plain (non-destructuring) declaration name: a Parameter's or a
 *     VariableDeclaration's `name`, when that name is the Identifier
 *     directly — `function f(NAME) {}`, `const NAME = x;`. Declaring a new
 *     binding under this name is not itself a reference to the builtin.
 *
 * Deliberately EXCLUDED from this allowlist — kept flagged on purpose:
 *   - Property-qualified access: `globalThis.NAME`, `namespace.NAME`, and
 *     optional-chain variants. Syntax alone cannot prove what the receiver
 *     aliases; the real global can be reached through a receiver, so every
 *     such access is conservatively rejected. Computed `receiver['NAME']` is
 *     detected by the walker separately because its property is a
 *     StringLiteral, not an Identifier.
 *   - BindingElement, i.e. destructuring: `const { NAME } = x` (shorthand)
 *     and `const { NAME: y } = x` (renamed) both stay flagged, even though
 *     `x.name === node` looks exactly as "namey" as the PropertyAssignment
 *     case above. The difference that matters: destructuring BINDS the value
 *     out of `x` under this name — `const { NAME } = globalThis` is a
 *     genuine, real way to get the actual banned global function into scope
 *     under any alias you like, which is exactly the defect class this guard
 *     exists to stop from being smuggled back in. A guard that waves through
 *     the aliasing shape is worse than no guard.
 *   - A plain reference to an identifier that HAPPENS to resolve to a local
 *     shadow rather than the global — e.g. `function f(NAME) { return NAME; }`,
 *     where the `return` line's reference resolves to the shadowing
 *     parameter, not the builtin. Telling those apart needs real
 *     scope/symbol resolution (a TypeChecker), which this syntax-only walk
 *     deliberately doesn't do. This never occurs in the real target files
 *     today; if it ever did, the reference would still be conservatively
 *     flagged and need a one-line local rename to clear, which is a fine
 *     cost for not having to trust scope analysis to get the shadow test
 *     right.
 */
function isPureNameNode(node) {
  const parent = node.parent;
  if (!parent) return false;

  if (ts.isPropertyAssignment(parent) && parent.name === node) return true;
  if (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent)) return true;
  if (ts.isPropertySignature(parent) && parent.name === node) return true;
  if (
    (ts.isMethodDeclaration(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isGetAccessorDeclaration(parent) ||
      ts.isSetAccessorDeclaration(parent)) &&
    parent.name === node
  ) {
    return true;
  }
  if (ts.isParameter(parent) && parent.name === node) return true;
  if (ts.isVariableDeclaration(parent) && parent.name === node) return true;

  return false;
}

/** Every executable reference shaped like `forbiddenIdentifier`, including
 * receiver-qualified and computed access. Syntax alone cannot prove what a
 * receiver aliases, so this rejects those conservatively. */
function findRawReferences(sourceFile, forbiddenIdentifier) {
  const hits = [];
  const visit = (node) => {
    if (ts.isIdentifier(node) && node.text === forbiddenIdentifier && !isPureNameNode(node)) {
      hits.push(node);
    }
    if (
      ts.isElementAccessExpression(node) &&
      node.argumentExpression &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      node.argumentExpression.text === forbiddenIdentifier
    ) {
      hits.push(node.argumentExpression);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return hits;
}

/** Parse one file, or record why it could not be read/parsed. */
function loadSourceFile(absPath) {
  let text;
  try {
    text = readFileSync(absPath, 'utf8');
  } catch (e) {
    return { error: `cannot read ${displayPath(absPath)}: ${e.message}` };
  }
  return { sourceFile: ts.createSourceFile(absPath, text, ts.ScriptTarget.Latest, /* setParentNodes */ true, ts.ScriptKind.TS) };
}

/**
 * Check one area (its whole configured file set) and report:
 *   - `unreadable`: files that could not be read, each an error string.
 *   - `helperFound`: whether `helperName` resolved in at least one file.
 *   - `violations`: [{ file, node }] for every raw reference outside the
 *     helper's own body — in whichever file that body lives in, everywhere
 *     else in the area unconditionally.
 *   - `clean`: files with zero violations, for the success report.
 */
function checkArea(area, files) {
  const parsed = new Map(); // absPath -> sourceFile
  const unreadable = [];
  for (const absPath of files) {
    const { sourceFile, error } = loadSourceFile(absPath);
    if (error) {
      unreadable.push(error);
    } else {
      parsed.set(absPath, sourceFile);
    }
  }

  let helperFile = null;
  let helperRange = null;
  for (const [absPath, sourceFile] of parsed) {
    const range = findHelperRange(sourceFile, area.helperName);
    if (range) {
      helperFile = absPath;
      helperRange = range;
      break; // first (only) declaration wins, area-wide
    }
  }

  const violations = [];
  const clean = [];
  for (const [absPath, sourceFile] of parsed) {
    const refs = findRawReferences(sourceFile, area.forbiddenIdentifier);
    const exempt = absPath === helperFile ? helperRange : null;
    const fileViolations = refs.filter((node) => {
      if (!exempt) return true;
      const pos = node.getStart(sourceFile);
      return pos < exempt[0] || pos >= exempt[1];
    });
    if (fileViolations.length) {
      for (const node of fileViolations) violations.push({ absPath, sourceFile, node });
    } else {
      clean.push(absPath);
    }
  }

  return { unreadable, helperFound: helperFile !== null, violations, clean };
}

function reportViolations(area, violations) {
  console.error(
    `\n✗ relay-decode-guard: ${violations.length} raw \`${area.forbiddenIdentifier}\` reference(s) in ` +
    `area "${area.name}" outside ${area.helperName}()\n`,
  );
  for (const { absPath, sourceFile, node } of violations) {
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    const lines = sourceFile.text.split('\n');
    console.error(`  ${displayPath(absPath)}:${line + 1}  ${lines[line].trim()}`);
  }
  console.error(
    `\nUse ${area.helperName}(segment) instead of a raw ${area.forbiddenIdentifier} call or bare reference.\n` +
    `Reason: ${area.forbiddenIdentifier} throws URIError on a malformed escape ("%ZZ"), and the worker's ` +
    `global boundary turns an uncaught throw into a 500 INTERNAL_ERROR for what is only ` +
    `a bad URL — ${area.helperName} converts that into '' fail-closed instead, so the route's ` +
    `own existing validation rejects it like any other bad input.\n`,
  );
}

function main() {
  const args = process.argv.slice(2);
  const areaFlag = args.find((a) => a.startsWith('--area='));
  const argPath = args.find((a) => !a.startsWith('--'));
  const areaName = areaFlag ? areaFlag.slice('--area='.length) : DEFAULT_AREA;

  if (argPath && !AREAS.some((a) => a.name === areaName)) {
    console.error(`relay-decode-guard: unknown --area "${areaName}"`);
    process.exit(2);
  }

  const runAreas = argPath ? [AREAS.find((a) => a.name === areaName)] : AREAS;

  let anyMissingAnchor = false;
  let anyViolations = false;
  let anyUnreadable = false;

  for (const area of runAreas) {
    const files = argPath ? [resolve(process.cwd(), argPath)] : areaFiles(area);
    const result = checkArea(area, files);

    if (result.unreadable.length) {
      anyUnreadable = true;
      for (const msg of result.unreadable) console.error(`relay-decode-guard: ${msg}`);
      continue; // cannot trust an anchor/violation scan over a file that never loaded
    }

    if (!result.helperFound) {
      anyMissingAnchor = true;
      const where = argPath ? displayPath(files[0]) : `any file in area "${area.name}" (${area.files.join(', ')})`;
      console.error(
        `relay-decode-guard: could not find \`${area.helperName}\` in ${where} — the guard's ` +
        `one exemption anchor is missing. Fix the guard or the helper; do not ignore this.`,
      );
      continue; // no meaningful violation report without an anchor
    }

    if (result.violations.length) {
      anyViolations = true;
      reportViolations(area, result.violations);
    }

    for (const absPath of result.clean) {
      console.log(`✓ relay-decode-guard: ${displayPath(absPath)} has no raw ${area.forbiddenIdentifier} outside ${area.helperName}().`);
    }
  }

  if (anyUnreadable || anyMissingAnchor) process.exit(2);
  if (anyViolations) process.exit(1);
}

main();
