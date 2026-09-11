#!/usr/bin/env node
/**
 * check-relay-decode-guard.mjs — stops the relay's malformed-URL 500 defect
 * class from coming back. Four review bots independently proposed this
 * generalization on PR #10150 after that PR routed 13 routes through the
 * existing fail-closed helper `safeDecodeSegment` (apps/relay/src/index.ts);
 * this guard is what stops route #14 from reintroducing it.
 *
 * THE RULE: no raw `decodeURIComponent` reference anywhere in
 * apps/relay/src/index.ts OUTSIDE the body of `safeDecodeSegment` itself.
 *
 * WHY: `decodeURIComponent` throws `URIError` on a malformed percent-escape
 * (`%ZZ`). A raw call — or a raw bare reference, e.g. `.map(decodeURIComponent)`
 * — lets that throw escape routing and reach the worker's global boundary,
 * which answers a bare 500 INTERNAL_ERROR for what is only a bad URL.
 * `safeDecodeSegment` is the ONE legitimate call site: it turns the throw
 * into `''` fail-closed, for the route's own existing validation to reject
 * like any other bad input. Every route must go through it instead of
 * calling the raw builtin itself.
 *
 * Deliberately NOT the two related-but-wrong rules other bots also proposed:
 *   - Banning `decodeURIComponent` outright — impossible, the helper's own
 *     body must call it; its body is the one exempted site.
 *   - Requiring the decoded result be compared against `''` — too narrow
 *     (most call sites reject '' via a regex/shape test, a DB lookup that
 *     misses, or `Number('') === 0`, never an equality check) and answers a
 *     human-review question ("does this route reject '' downstream?"), not
 *     something a mechanical rule can decide.
 *
 * Scope is `apps/relay/src/index.ts` ONLY — the router this defect class
 * lives in. A raw decode found elsewhere under apps/relay is real but out of
 * this guard's scope; it is reported by hand, not silently swept in here.
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
 *   node scripts/check-relay-decode-guard.mjs <path>   # override target file
 *                                                       # (the regression test
 *                                                       # points this at sandbox
 *                                                       # fixtures; real CI use
 *                                                       # never passes a path)
 */
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_TARGET = 'apps/relay/src/index.ts';
const HELPER_NAME = 'safeDecodeSegment';
const BANNED = 'decodeURIComponent';

const argPath = process.argv[2];
const absPath = argPath ? resolve(process.cwd(), argPath) : resolve(REPO, DEFAULT_TARGET);
// Display path: repo-relative when possible (real CI run), else the raw
// override path (sandbox fixtures used by the regression test).
const TARGET = argPath ? (relative(REPO, absPath).startsWith('..') ? absPath : relative(REPO, absPath)) : DEFAULT_TARGET;

/**
 * Find the [start, end) character range of `safeDecodeSegment`'s own function
 * body in the source file — the one span where a raw `decodeURIComponent`
 * reference is exempt. Handles both a function declaration and a
 * `const safeDecodeSegment = (...) => {...}` form, in case the helper is ever
 * refactored from one to the other.
 */
function findHelperRange(sourceFile) {
  let range = null;
  const visit = (node) => {
    if (range) return; // first (only) declaration wins
    if (ts.isFunctionDeclaration(node) && node.name?.text === HELPER_NAME) {
      range = [node.getStart(sourceFile), node.getEnd()];
      return;
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === HELPER_NAME &&
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

/** Every Identifier node named `decodeURIComponent` that is a real reference to the global builtin (not a `.decodeURIComponent` property-access name). */
function findRawDecodeReferences(sourceFile) {
  const hits = [];
  const visit = (node) => {
    if (ts.isIdentifier(node) && node.text === BANNED) {
      const parent = node.parent;
      const isPropertyAccessName = parent && ts.isPropertyAccessExpression(parent) && parent.name === node;
      if (!isPropertyAccessName) hits.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return hits;
}

function main() {
  let text;
  try {
    text = readFileSync(absPath, 'utf8');
  } catch (e) {
    console.error(`relay-decode-guard: cannot read ${TARGET}: ${e.message}`);
    process.exit(2);
  }

  const sourceFile = ts.createSourceFile(absPath, text, ts.ScriptTarget.Latest, /* setParentNodes */ true, ts.ScriptKind.TS);

  const helperRange = findHelperRange(sourceFile);
  if (!helperRange) {
    console.error(
      `relay-decode-guard: could not find \`${HELPER_NAME}\` in ${TARGET} — the guard's ` +
      `one exemption anchor is missing. Fix the guard or the helper; do not ignore this.`,
    );
    process.exit(2);
  }
  const [helperStart, helperEnd] = helperRange;

  const refs = findRawDecodeReferences(sourceFile);
  const violations = refs.filter((node) => {
    const pos = node.getStart(sourceFile);
    return pos < helperStart || pos >= helperEnd;
  });

  if (violations.length) {
    console.error(
      `\n✗ relay-decode-guard: ${violations.length} raw \`${BANNED}\` reference(s) in ` +
      `${TARGET} outside ${HELPER_NAME}()\n`,
    );
    const lines = sourceFile.text.split('\n');
    for (const node of violations) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      console.error(`  ${TARGET}:${line + 1}  ${lines[line].trim()}`);
    }
    console.error(
      `\nUse ${HELPER_NAME}(segment) instead of a raw ${BANNED} call or bare reference.\n` +
      `Reason: ${BANNED} throws URIError on a malformed escape ("%ZZ"), and the worker's ` +
      `global boundary turns an uncaught throw into a 500 INTERNAL_ERROR for what is only ` +
      `a bad URL — ${HELPER_NAME} converts that into '' fail-closed instead, so the route's ` +
      `own existing validation rejects it like any other bad input.\n`,
    );
    process.exit(1);
  }

  console.log(`✓ relay-decode-guard: ${TARGET} has no raw ${BANNED} outside ${HELPER_NAME}().`);
}

main();
