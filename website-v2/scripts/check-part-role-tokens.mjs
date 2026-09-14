/**
 * The part role layer is an indirection with no compiler behind it.
 *
 * textbook.json gives each part a `slug` and a `webRoleAlias`; Slab.tsx
 * derives the block colour from the slug mechanically as var(--part-${slug})
 * / var(--part-${slug}-on); and the generated region of tokens.roles.css
 * defines those two names as aliases of the semantic tokens webRoleAlias
 * points at. The generator validates the alias's SHAPE — an object with bg
 * and on, each spelled like a custom property — but nothing checks that the
 * token it names exists. A typo that still looks like a custom property
 * passes validation, generates `var(--story-golld)`, and fails silently:
 * CSS drops the declaration, the slab paints nothing, the oversized numeral
 * prints the page's default ink on the page's default ground, and the build
 * stays green. The same hole swallows a part whose slug has no pair at all.
 *
 * So this check walks the indirection end to end and fails where it breaks:
 *
 *   1. every part slug in textbook.json has --part-<slug> AND --part-<slug>-on
 *   2. every --part-* pair in roles.css names a part that still exists
 *   3. each pair's var() target is a token that is really defined
 *   4. and defined in BOTH themes, since a slab renders in both
 *   5. every literal <Slab slug="..."> in the site names a real part
 *   6. every webRoleAlias in textbook.json names a SEMANTIC-layer token,
 *      present in the light block and in the dark block of
 *      tokens.semantic.css, and the generated pair really aliases it
 *
 * Checks 3 and 4 were "is this name defined in any token file", which lets a
 * part alias a SOURCE-layer token: tokens.source.css defines its names once,
 * in a plain `:root`, so a source token is trivially present "in both themes"
 * and the pair passes. It still breaks the page. Point webRoleAlias.bg at
 * --radnika-opsz-body and the slab's background becomes var(--radnika-opsz-body),
 * which is the unitless number 17: an invalid background, dropped by CSS,
 * slab paints nothing, build green. The semantic layer is the only layer that
 * promises a theme-aware colour, so a part role has to alias that layer, and
 * checks 3, 4 and 6 now say so by name and by file.
 *
 * Check 6 anchors on textbook.json rather than on the CSS the generator wrote
 * from it, so the source of record is validated in its own right: without it
 * the whole check is a statement about a generated artifact, and a bad alias
 * is only caught on the round trip through --sync-shared.
 *
 * Run: npm run test:part-roles
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readdirSync, statSync } from 'node:fs';

const root = resolve(import.meta.dirname, '..', '..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');

const TEXTBOOK = 'whitepaper/textbook.json';
const ROLES = 'website-v2/src/styles/tokens.roles.css';
// The one layer that redefines every name it owns per theme, and therefore
// the only layer a part role may alias. See aliasProblem().
const SEMANTIC = 'website-v2/src/styles/tokens.semantic.css';
const TOKEN_FILES = [
  'website-v2/src/styles/tokens.source.css',
  SEMANTIC,
  ROLES,
];
const SRC = 'website-v2/src';

/**
 * Custom properties defined per theme, and the file each definition is in.
 *
 * A `:root` block applies to both themes; a `[data-theme='light']` or
 * `[data-theme='dark']` block applies to one. A media-query dark block is
 * read as dark for the same reason. Anything else (a component selector,
 * a state class) defines a token only where that selector matches, which is
 * not a promise the part layer can rely on, so it does not count here.
 *
 * Each theme is a Map of token name -> Set of the files that define it in
 * that theme, not a bare Set of names. `.has(name)` still answers "defined in
 * this theme", so the presence checks read exactly as before; the value is
 * what lets a check say WHICH LAYER a name comes from, which is the
 * difference between "--radnika-opsz-body exists" and "--radnika-opsz-body is
 * a source-layer length, not a theme-aware colour".
 */
function definitionsByTheme(files) {
  const light = new Map();
  const dark = new Map();
  const note = (bucket, name, file) => {
    if (!bucket.has(name)) bucket.set(name, new Set());
    bucket.get(name).add(file);
  };
  for (const file of files) {
    const css = read(file);
    // Strip comments first: a commented-out declaration is not a definition,
    // and the role file's prose mentions plenty of token names.
    const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
    let depth = 0;
    let selector = '';
    let pending = '';
    const stack = [];
    for (const ch of bare) {
      if (ch === '{') {
        stack.push(pending.trim());
        pending = '';
        depth += 1;
      } else if (ch === '}') {
        stack.pop();
        pending = '';
        depth = Math.max(0, depth - 1);
      } else {
        pending += ch;
        if (ch === ';') {
          const m = /(--[\w-]+)\s*:/.exec(pending);
          if (m) {
            selector = stack.join(' ');
            const isDark = /\[data-theme=['"]?dark/.test(selector)
              || /prefers-color-scheme:\s*dark/.test(selector);
            const isLight = /\[data-theme=['"]?light/.test(selector);
            if (isDark) note(dark, m[1], file);
            else if (isLight) note(light, m[1], file);
            else { note(light, m[1], file); note(dark, m[1], file); }
          }
          pending = '';
        }
      }
    }
  }
  return { light, dark };
}

/** Every `--part-*: value;` declaration in the role layer, value included. */
function partDeclarations() {
  const bare = read(ROLES).replace(/\/\*[\s\S]*?\*\//g, '');
  const out = new Map();
  for (const m of bare.matchAll(/(--part-[\w-]+)\s*:\s*([^;]+);/g)) {
    out.set(m[1], m[2].trim());
  }
  return out;
}

function tsxFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = resolve(dir, entry);
    if (statSync(p).isDirectory()) out.push(...tsxFiles(p));
    else if (/\.tsx?$/.test(entry)) out.push(p);
  }
  return out;
}

const failures = [];
const fail = (msg) => failures.push(msg);

const textbook = JSON.parse(read(TEXTBOOK));
const slugs = textbook.parts.map((p) => p.slug);
const slugSet = new Set(slugs);
const declared = partDeclarations();
const { light, dark } = definitionsByTheme(TOKEN_FILES);

// 1. Every part has both halves of its pair.
for (const slug of slugs) {
  for (const name of [`--part-${slug}`, `--part-${slug}-on`]) {
    if (!declared.has(name)) {
      fail(`${ROLES}: part "${slug}" (${TEXTBOOK}) has no ${name} — Slab would paint var(${name}), which resolves to nothing`);
    }
  }
}

// 2. No role token for a part that no longer exists.
for (const name of declared.keys()) {
  const slug = name.replace(/^--part-/, '').replace(/-on$/, '');
  if (!slugSet.has(slug)) {
    fail(`${ROLES}: ${name} names part "${slug}", which is not a part in ${TEXTBOOK} (${slugs.join(', ')})`);
  }
}

/**
 * Why `ref` is not usable as a part role's target, or null if it is.
 *
 * Three ways to fail, in the order a reader would ask about them: the name is
 * defined nowhere; it is defined in one theme only; or it is defined in both
 * themes but not by the SEMANTIC layer — which happens whenever it comes from
 * tokens.source.css, where one plain `:root` block makes every name look
 * theme-complete while promising nothing about theme at all, and where most
 * names are not colours in the first place.
 */
function aliasProblem(ref) {
  const inLight = light.get(ref);
  const inDark = dark.get(ref);
  if (!inLight && !inDark) return 'which no token file defines';
  if (!inLight) return 'defined only in the dark theme — a slab renders in both';
  if (!inDark) return 'defined only in the light theme — a slab renders in both';
  if (!inLight.has(SEMANTIC) || !inDark.has(SEMANTIC)) {
    const where = [...new Set([...inLight, ...inDark])].join(', ');
    return `defined in ${where} but not in both themes of ${SEMANTIC}`
      + ' — a part role must alias the semantic layer, the only layer that redefines'
      + ' its names per theme';
  }
  return null;
}

// 3 and 4. Each alias resolves, in both themes, out of the semantic layer.
for (const [name, value] of declared) {
  const refs = [...value.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]);
  if (refs.length === 0) {
    fail(`${ROLES}: ${name}: ${value} — a part role must alias a semantic token, not carry a literal`);
    continue;
  }
  for (const ref of refs) {
    const problem = aliasProblem(ref);
    if (problem) fail(`${ROLES}: ${name} aliases ${ref}, ${problem}`);
  }
}

// 5. Literal slugs passed to Slab name real parts.
for (const file of tsxFiles(resolve(root, SRC))) {
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(/<Slab\b[^>]*?\bslug=["']([^"']+)["']/g)) {
    if (!slugSet.has(m[1])) {
      const rel = file.slice(root.length + 1);
      fail(`${rel}: <Slab slug="${m[1]}"> — no such part in ${TEXTBOOK} (${slugs.join(', ')})`);
    }
  }
}

// 6. The source of record itself: each part's webRoleAlias names a real
// semantic token in both themes, and the generated pair really aliases it.
// Checks 1-5 all read the generated CSS; without this one, textbook.json —
// the file an author actually edits — is never checked on its own terms.
for (const part of textbook.parts) {
  const where = `${TEXTBOOK}: part "${part.slug}"`;
  const alias = part.webRoleAlias;
  if (typeof alias !== 'object' || alias === null) {
    fail(`${where}: webRoleAlias must be an object with bg and on — Slab has nothing to derive its ink from`);
    continue;
  }
  for (const [side, roleName] of [['bg', `--part-${part.slug}`], ['on', `--part-${part.slug}-on`]]) {
    const ref = alias[side];
    if (typeof ref !== 'string' || !/^--[\w-]+$/.test(ref)) {
      fail(`${where}: webRoleAlias.${side} is ${JSON.stringify(ref)}, not a CSS custom-property name like "--brand-primary"`);
      continue;
    }
    const problem = aliasProblem(ref);
    if (problem) {
      fail(`${where}: webRoleAlias.${side} names ${ref}, ${problem}`);
      continue;
    }
    // The generated region is kept in step with textbook.json by
    // `node scripts/generate-mega-whitepaper.mjs --check-shared`, which runs in
    // a different workflow. Saying it here too means this check does not
    // depend on that one having run to mean what its name says.
    const emitted = declared.get(roleName);
    if (emitted !== undefined && emitted !== `var(${ref})`) {
      fail(`${where}: webRoleAlias.${side} names ${ref}, but ${ROLES} has ${roleName}: ${emitted}`
        + ' — regenerate with node scripts/generate-mega-whitepaper.mjs --sync-shared');
    }
  }
}


if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(
  `part role tokens resolve: ${slugs.length} parts, ${declared.size} role tokens,`
  + ` every alias a ${SEMANTIC.split('/').pop()} token defined in both themes`,
);
