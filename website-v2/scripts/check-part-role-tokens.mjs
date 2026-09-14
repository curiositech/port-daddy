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
const TOKEN_FILES = [
  'website-v2/src/styles/tokens.source.css',
  'website-v2/src/styles/tokens.semantic.css',
  ROLES,
];
const SRC = 'website-v2/src';

/**
 * Custom properties defined per theme.
 *
 * A `:root` block applies to both themes; a `[data-theme='light']` or
 * `[data-theme='dark']` block applies to one. A media-query dark block is
 * read as dark for the same reason. Anything else (a component selector,
 * a state class) defines a token only where that selector matches, which is
 * not a promise the part layer can rely on, so it does not count here.
 */
function definitionsByTheme(files) {
  const light = new Set();
  const dark = new Set();
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
            if (isDark) dark.add(m[1]);
            else if (isLight) light.add(m[1]);
            else { light.add(m[1]); dark.add(m[1]); }
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

// 3 and 4. Each alias resolves, in both themes.
for (const [name, value] of declared) {
  const refs = [...value.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]);
  if (refs.length === 0) {
    fail(`${ROLES}: ${name}: ${value} — a part role must alias a semantic token, not carry a literal`);
    continue;
  }
  for (const ref of refs) {
    const inLight = light.has(ref);
    const inDark = dark.has(ref);
    if (!inLight && !inDark) {
      fail(`${ROLES}: ${name} aliases ${ref}, which no token file defines`);
    } else if (!inLight) {
      fail(`${ROLES}: ${name} aliases ${ref}, defined only in the dark theme — a slab renders in both`);
    } else if (!inDark) {
      fail(`${ROLES}: ${name} aliases ${ref}, defined only in the light theme — a slab renders in both`);
    }
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

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`part role tokens resolve: ${slugs.length} parts, ${declared.size} role tokens, both themes`);
