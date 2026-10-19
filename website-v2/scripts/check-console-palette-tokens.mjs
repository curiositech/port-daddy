// Guards the pd-console GPU palette (core/pd-console/src/palette.rs) against
// the website's semantic design tokens (tokens.semantic.css / tokens.roles.css).
//
// HOW THIS FAILED SILENTLY BEFORE: the original version of this check
// grepped both files for literal strings like `'engaged: 0xf2be51'`. When
// pd-console's dark theme was restructured — its bg/panel/raised ladder
// shifted a rung, `accent` split into a fill (`accent`) and a text color
// (`accent_ink`) — the literal strings stopped appearing and the check
// failed. Nobody ran it (it was never wired into CI), so it rotted red on
// main. A substring check also cannot tell "this moved" from "this is
// wrong": it fails identically either way, which is why this version PARSES
// both sides into real field/token maps and compares values, not text.
//
// THE BINDING TABLE. `palette.rs`'s own module comment claims the website
// owns exactly five concepts for pd-console: "cobalt primary, kelp accent,
// coral heat, amber warning, paper/ink surfaces." BOUND_FIELDS below is
// that claim made mechanical — one entry per `Theme` field that is supposed
// to equal a website token, per theme (light and dark can bind to
// DIFFERENT token names for the same Rust field, because the surface
// ladder shifts a rung between the two themes — see the `bg`/`panel`
// comments below).
//
// Every other `Theme` field is deliberately NOT checked here (tuned for
// in-console contrast, invariant across themes, or plain unused) and must
// be named in UNBOUND_FIELDS. The two lists are asserted to cover the
// struct's fields EXACTLY — add a field to `Theme` and forget to classify
// it, and this check fails on the omission itself, not silently.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', '..');
const palettePath = resolve(root, 'core/pd-console/src/palette.rs');
const semanticPath = resolve(root, 'website-v2/src/styles/tokens.semantic.css');
const rolesPath = resolve(root, 'website-v2/src/styles/tokens.roles.css');

const paletteSrc = readFileSync(palettePath, 'utf8');
const semanticCss = readFileSync(semanticPath, 'utf8');
const rolesCss = readFileSync(rolesPath, 'utf8');

const errors = [];

// ── Parse palette.rs ────────────────────────────────────────────────────

/** Pull the field NAMES declared on `pub struct Theme { ... }`. */
function parseThemeStructFields(src) {
  const structMatch = src.match(/pub struct Theme \{([\s\S]*?)\n\}/);
  if (!structMatch) {
    throw new Error(`could not find 'pub struct Theme { ... }' in ${palettePath}`);
  }
  const fields = [];
  const fieldRe = /pub\s+(\w+):\s*(?:u32|ThemeMode)\s*,/g;
  let m;
  while ((m = fieldRe.exec(structMatch[1]))) fields.push(m[1]);
  if (fields.length === 0) {
    throw new Error('parsed zero fields out of the Theme struct — regex is broken');
  }
  return fields;
}

/** Pull one `const NAME: Theme = Theme { ... };` literal into a field->value map. */
function parseThemeConst(src, constName) {
  const re = new RegExp(`const ${constName}: Theme = Theme \\{([\\s\\S]*?)\\n\\};`);
  const m = src.match(re);
  if (!m) {
    throw new Error(`could not find 'const ${constName}: Theme = Theme { ... };' in ${palettePath}`);
  }
  const body = m[1];
  const values = new Map();
  const fieldRe = /(\w+):\s*0x([0-9a-fA-F]{6})\s*,/g;
  let fm;
  while ((fm = fieldRe.exec(body))) values.set(fm[1], fm[2].toLowerCase());
  return values;
}

const structFields = parseThemeStructFields(paletteSrc);
const paletteByTheme = {
  light: parseThemeConst(paletteSrc, 'LIGHT'),
  dark: parseThemeConst(paletteSrc, 'DARK'),
};

// ── Parse tokens.semantic.css / tokens.roles.css ───────────────────────────

/** Extract the declaration block for a selector, up to its own closing brace. */
function extractCssBlock(css, selectorRe, path) {
  const m = css.match(selectorRe);
  if (!m) throw new Error(`could not find a CSS block matching ${selectorRe} in ${path}`);
  const start = m.index + m[0].length;
  const end = css.indexOf('\n}', start);
  if (end === -1) throw new Error(`unterminated CSS block for ${selectorRe} in ${path}`);
  return css.slice(start, end);
}

/** Parse `--name: value;` declarations in a block into a name->rawValue map. */
function parseCssVars(block) {
  const vars = new Map();
  const re = /--([a-zA-Z0-9-]+):\s*([^;]+);/g;
  let m;
  while ((m = re.exec(block))) vars.set(m[1], m[2].trim());
  return vars;
}

/** Resolve a single level of `var(--x)` indirection against the same block's map. */
function resolveVar(vars, name, seen = new Set()) {
  if (!vars.has(name)) return undefined;
  if (seen.has(name)) throw new Error(`cyclic var() reference at --${name}`);
  seen.add(name);
  const raw = vars.get(name);
  const varRef = raw.match(/^var\(--([a-zA-Z0-9-]+)\)$/);
  return varRef ? resolveVar(vars, varRef[1], seen) : raw;
}

/** Normalize a resolved CSS value to a bare lowercase 6-hex string, or null. */
function asHex(value) {
  const m = value && value.match(/^#?([0-9a-fA-F]{6})$/);
  return m ? m[1].toLowerCase() : null;
}

const semanticLight = parseCssVars(
  extractCssBlock(semanticCss, /:root,\s*\n\[data-theme=['"]light['"]\]\s*\{/, semanticPath)
);
const semanticDark = parseCssVars(
  extractCssBlock(semanticCss, /\[data-theme=['"]dark['"]\]\s*\{/, semanticPath)
);
const semanticByTheme = { light: semanticLight, dark: semanticDark };

const rolesVars = parseCssVars(extractCssBlock(rolesCss, /:root\s*\{/, rolesPath));

// ── Part 1: Theme struct fields bound to website tokens ─────────────────
//
// `tokens` may name a single token used for BOTH themes, or {light, dark}
// when the website token that carries the same meaning changes name across
// themes. `bg`/`panel` are the ladder-shift case described in the module
// comment on DARK in palette.rs: the dark surface stack gained a rung
// (`sunken` split out under `bg`), so what LIGHT's `bg` binds to
// (--surface-base) is one rung below what DARK's `bg` binds to
// (--surface-sunken); `panel` shifts the same way.
const BOUND_FIELDS = [
  { field: 'bg', tokens: { light: 'surface-base', dark: 'surface-sunken' } },
  { field: 'panel', tokens: { light: 'surface-raised', dark: 'surface-base' } },
  { field: 'ink', tokens: 'text-primary' },
  { field: 'ink2', tokens: 'text-secondary' },
  // The "cobalt primary" the module comment promises — the TEXT/interactive
  // color, not the `accent` fill (see UNBOUND_FIELDS).
  { field: 'accent_ink', tokens: 'brand-primary' },
  // "amber warning" / "coral heat" / "kelp accent" from the module comment.
  { field: 'engaged', tokens: 'brand-warm' },
  { field: 'gated', tokens: 'brand-heat' },
  { field: 'landed', tokens: 'brand-accent' },
  { field: 'conflict', tokens: 'status-error' },
  { field: 'cobalt', tokens: 'status-info' },
];

// Every other `Theme` field, with why it is NOT checked against a token.
const UNBOUND_FIELDS = {
  mode: 'not a color',
  raised: 'no single website surface token matches both themes (dark ties to --surface-raised; light has no clean counterpart at this rung)',
  sunken: 'ditto — dark ties to --surface-sunken, but light ties to --surface-strong, a different rung than the name suggests',
  muted: 'tuned for in-console contrast against `sunken`, not a token mirror (light diverges from --text-muted by design)',
  line: 'console-only hairline color; the website expresses borders as alpha overlays (--border-*), not a comparable solid hex',
  line2: 'console-only hairline color, same reason as `line`',
  accent: 'the fill ("deep slab") half of the accent split — deliberately theme-invariant, so it cannot equal a per-theme token',
  resting: 'console-only muted-state color, tuned like `muted`',
  mayday: 'deliberately more saturated than `conflict`/status-error so CRITICAL never reads as an ordinary warning',
  flag_charlie: 'maritime flag color; currently unused by any renderer (dead field) — no shipped contract to guard',
  flag_kilo: 'maritime flag color; currently unused by any renderer (dead field)',
  flag_uniform: 'maritime flag color; currently unused by any renderer (dead field)',
  flag_november: 'maritime flag color; currently unused by any renderer (dead field)',
  flag_lima: 'maritime flag color; currently unused by any renderer (dead field)',
  syn_keyword: 'Harbor editor syntax color; the website\'s --code-* tokens are deliberately dark-in-both-themes, a different contract',
  syn_type: 'Harbor editor syntax color, same reason as `syn_keyword`',
  syn_string: 'Harbor editor syntax color, same reason as `syn_keyword`',
  syn_comment: 'Harbor editor syntax color, same reason as `syn_keyword`',
  syn_number: 'Harbor editor syntax color, same reason as `syn_keyword`',
};

// Coverage: every struct field must appear in exactly one of the two lists,
// and neither list may claim a field the struct no longer has. This is what
// makes "add a new field and forget to classify it" a hard failure instead
// of a silent hole.
{
  const boundNames = new Set(BOUND_FIELDS.map((b) => b.field));
  const unboundNames = new Set(Object.keys(UNBOUND_FIELDS));
  const structSet = new Set(structFields);

  for (const f of structFields) {
    if (boundNames.has(f) && unboundNames.has(f)) {
      errors.push(`Theme field '${f}' is listed in BOTH BOUND_FIELDS and UNBOUND_FIELDS — pick one`);
    } else if (!boundNames.has(f) && !unboundNames.has(f)) {
      errors.push(
        `Theme field '${f}' is new and unclassified — add it to BOUND_FIELDS (with its website token) ` +
          `or UNBOUND_FIELDS (with a reason) in ${palettePath.replace(root + '/', '')}'s check script`
      );
    }
  }
  for (const f of boundNames) {
    if (!structSet.has(f)) errors.push(`BOUND_FIELDS names '${f}', which is no longer a Theme field — remove it`);
  }
  for (const f of unboundNames) {
    if (!structSet.has(f)) errors.push(`UNBOUND_FIELDS names '${f}', which is no longer a Theme field — remove it`);
  }
}

// Value equality: for each bound field, in each theme, the Rust hex must
// equal the resolved website token's hex for that same theme.
for (const { field, tokens } of BOUND_FIELDS) {
  for (const theme of /** @type {const} */ (['light', 'dark'])) {
    const tokenName = typeof tokens === 'string' ? tokens : tokens[theme];
    const rustValues = paletteByTheme[theme];
    if (!rustValues.has(field)) {
      errors.push(`palette.rs ${theme} Theme is missing field '${field}' (parsed zero fields with that name)`);
      continue;
    }
    const rustHex = rustValues.get(field);

    const cssVars = semanticByTheme[theme];
    const resolved = resolveVar(cssVars, tokenName);
    if (resolved === undefined) {
      errors.push(`tokens.semantic.css ${theme} block has no --${tokenName} for palette.rs field '${field}'`);
      continue;
    }
    const cssHex = asHex(resolved);
    if (cssHex === null) {
      errors.push(
        `tokens.semantic.css ${theme} --${tokenName} = '${resolved}' is not a plain hex color; ` +
          `cannot compare it to palette.rs '${field}' (0x${rustHex}) — pick a literal-hex token or drop the binding`
      );
      continue;
    }
    if (rustHex !== cssHex) {
      errors.push(
        `${theme} theme: palette.rs '${field}' = 0x${rustHex} but tokens.semantic.css --${tokenName} = #${cssHex} ` +
          `(these are supposed to match — see the BOUND_FIELDS comment in this script)`
      );
    }
  }
}

// ── Part 2: the console-specific tokens the website added for pd-console ──
//
// Unlike Part 1 (Theme struct fields), these are website-only additions
// with no single Rust field to diff against directly — just literal values
// that must keep existing and keep matching. Still parsed via the same
// maps, not substring search.
const expectedSemanticTokens = {
  light: {
    'brand-heat': '#aa432e',
    'brand-heat-on-tint': '#6f2417',
    'brand-warm': '#8c540e',
    'brand-warm-on-tint': '#5b3900',
    'console-glow-primary': 'rgba(0, 63, 184, 0.28)',
    'console-glow-heat': 'rgba(170, 67, 46, 0.24)',
    'console-depth-shadow': 'rgba(31, 28, 23, 0.16)',
  },
  dark: {
    'brand-heat': '#ff9c85',
    'brand-heat-on-tint': '#ffd4c8',
    'brand-warm': '#f2be51',
    'brand-warm-on-tint': '#ffe0a0',
    'console-glow-primary': 'rgba(125, 180, 255, 0.34)',
    'console-glow-heat': 'rgba(255, 156, 133, 0.28)',
    'console-depth-shadow': 'rgba(0, 0, 0, 0.42)',
  },
};

for (const theme of /** @type {const} */ (['light', 'dark'])) {
  const cssVars = semanticByTheme[theme];
  for (const [name, expected] of Object.entries(expectedSemanticTokens[theme])) {
    const actual = cssVars.get(name);
    if (actual === undefined) {
      errors.push(`tokens.semantic.css ${theme} block is missing --${name} (expected '${expected}')`);
    } else if (actual !== expected) {
      errors.push(`tokens.semantic.css ${theme} --${name} = '${actual}', expected '${expected}'`);
    }
  }
}

// The console-facing role aliases in tokens.roles.css must still point at
// the tokens above (roles.css is theme-independent — it aliases into
// tokens.semantic.css, which switches per [data-theme]).
const expectedRoles = {
  heat: 'var(--brand-heat)',
  'heat-foreground': 'var(--brand-heat-on-tint)',
  warm: 'var(--brand-warm)',
  'warm-foreground': 'var(--brand-warm-on-tint)',
  'console-focus-glow': 'var(--console-glow-primary)',
  'console-alert-glow': 'var(--console-glow-heat)',
  'console-shadow-depth': 'var(--console-depth-shadow)',
};
for (const [name, expected] of Object.entries(expectedRoles)) {
  const actual = rolesVars.get(name);
  if (actual === undefined) {
    errors.push(`tokens.roles.css is missing --${name} (expected '${expected}')`);
  } else if (actual !== expected) {
    errors.push(`tokens.roles.css --${name} = '${actual}', expected '${expected}'`);
  }
}

// ── Verdict ────────────────────────────────────────────────────────────

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}

console.log('console palette tokens match website semantic roles');
