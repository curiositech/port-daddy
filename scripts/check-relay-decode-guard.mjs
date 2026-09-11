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
// This is deliberately coupled to the canonical router helper. Renaming the
// helper requires changing this constant in the same commit; otherwise the
// missing-anchor branch exits 2, and the unit test below pins that fail-closed
// behavior so a rename cannot silently disable the rule.
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

/**
 * True when an Identifier node named `decodeURIComponent` is purely a NAME —
 * syntax that spells the string "decodeURIComponent" without ever reading the
 * global builtin's value — and so can never be the raw reference this guard
 * exists to catch. Verified empirically against the TypeScript AST (see
 * PR #10156 review discussion) before writing this list; each bucket below
 * is a shape probing showed the parser gives its own dedicated node kind
 * whose `.name`/`.propertyName` field never denotes a value read:
 *
 *   - `{ decodeURIComponent: fn }` — a PropertyAssignment's `name` (object
 *     literal key). Deliberately NOT ShorthandPropertyAssignment: `{
 *     decodeURIComponent }` as an object-literal shorthand is a genuine
 *     value read of whatever `decodeURIComponent` resolves to in scope, and
 *     must stay flagged like any other bare reference.
 *   - `import { decodeURIComponent } from './x'` / `import { decodeURIComponent
 *     as y } from './x'` / `export { decodeURIComponent }` / `export { y as
 *     decodeURIComponent }` — an ImportSpecifier's or ExportSpecifier's
 *     `name`/`propertyName`. These name what a module imports or exports;
 *     they never read the global.
 *   - `interface I { decodeURIComponent: string }` / `type T = {
 *     decodeURIComponent: string }` — a PropertySignature's `name`
 *     (type-member name, no runtime value at all).
 *   - `class C { decodeURIComponent() {} }` / `decodeURIComponent = x;` /
 *     `get decodeURIComponent() {}` — a MethodDeclaration's, a
 *     PropertyDeclaration's, or a Get/SetAccessorDeclaration's `name`
 *     (class- or object-literal-method member name).
 *   - A plain (non-destructuring) declaration name: a Parameter's or a
 *     VariableDeclaration's `name`, when that name is the Identifier
 *     directly — `function f(decodeURIComponent) {}`,
 *     `const decodeURIComponent = x;`. Declaring a new binding under this
 *     name is not itself a reference to the builtin.
 *
 * Deliberately EXCLUDED from this allowlist — kept flagged on purpose:
 *   - Property-qualified access: `globalThis.decodeURIComponent`,
 *     `namespace.decodeURIComponent`, and optional-chain variants. Syntax
 *     alone cannot prove what the receiver aliases; the real global can be
 *     reached through a receiver, so every such access is conservatively
 *     rejected. Computed `receiver['decodeURIComponent']` is detected by the
 *     walker separately because its property is a StringLiteral, not an
 *     Identifier.
 *   - BindingElement, i.e. destructuring: `const { decodeURIComponent } = x`
 *     (shorthand) and `const { decodeURIComponent: y } = x` (renamed) both
 *     stay flagged, even though `x.name === node` looks exactly as
 *     "namey" as the PropertyAssignment case above. The difference that
 *     matters: destructuring BINDS the value out of `x` under this name —
 *     `const { decodeURIComponent } = globalThis` is a genuine, real way to
 *     get the actual banned global function into scope under any alias you
 *     like, which is exactly the defect class this guard exists to stop
 *     from being smuggled back in. A guard that waves through the aliasing
 *     shape is worse than no guard. (If a legitimate non-builtin destructure
 *     of a same-named property ever shows up in this one file, that's the
 *     moment to add a narrow, commented exemption — not preemptively here.)
 *   - A plain reference to an identifier that HAPPENS to resolve to a local
 *     shadow rather than the global — e.g. `function f(decodeURIComponent) {
 *     return decodeURIComponent; }`, where the `return` line's reference
 *     resolves to the shadowing parameter, not the builtin. Telling those
 *     apart needs real scope/symbol resolution (a TypeChecker), which this
 *     syntax-only walk deliberately doesn't do — see the file-level comment
 *     on why AST-over-regex was already the chosen tradeoff. This never
 *     occurs in the real target file today; if it ever did, the reference
 *     would still be conservatively flagged and need a one-line local
 *     rename to clear, which is a fine cost for not having to trust
 *     scope analysis to get the shadow test right.
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

/** Every executable reference shaped like `decodeURIComponent`, including
 * receiver-qualified and computed access. Syntax alone cannot prove what a
 * receiver aliases, so the one-file router rule rejects those conservatively. */
function findRawDecodeReferences(sourceFile) {
  const hits = [];
  const visit = (node) => {
    if (ts.isIdentifier(node) && node.text === BANNED && !isPureNameNode(node)) {
      hits.push(node);
    }
    if (
      ts.isElementAccessExpression(node) &&
      node.argumentExpression &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      node.argumentExpression.text === BANNED
    ) {
      hits.push(node.argumentExpression);
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
