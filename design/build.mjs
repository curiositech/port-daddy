#!/usr/bin/env node
// Port Daddy Design System — token compiler.
//
// Reads:
//   design/tokens/primitives.json
//   design/tokens/semantic.json
//   design/tokens/themes/{dark,light}.json
//
// Emits:
//   design/build/tokens.css       — CSS custom properties for both themes
//   design/build/tokens.rs        — Rust constants + ratatui Color::Rgb pairs
//   design/build/Tokens.swift     — SwiftUI Color extension
//   design/build/tokens.ansi.ts   — TypeScript ANSI palette + RGB pairs
//   design/build/tokens.json      — flat tree for tools/docs
//
// Validates:
//   - primitive hex ↔ rgb consistency
//   - every semantic id satisfied by both themes
//   - WCAG 2.1 AA contrast on declared text/bg pairs
//   - type-scale floor (≥ 0.875rem on prose)
//
// Zero external deps. Run with: node design/build.mjs

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOKENS = resolve(__dirname, 'tokens');
const OUT = resolve(__dirname, 'build');

const VERSION = '0.1.0';
const NOW = new Date().toISOString().slice(0, 10);

mkdirSync(OUT, { recursive: true });

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const primitives = readJson(join(TOKENS, 'primitives.json'));
const semantic = readJson(join(TOKENS, 'semantic.json'));
const themes = {
  dark: readJson(join(TOKENS, 'themes/dark.json')),
  light: readJson(join(TOKENS, 'themes/light.json')),
};

const errors = [];
const warnings = [];

// ─── Validation ─────────────────────────────────────────────────────────────

const hexToRgb = (hex) => {
  const m = hex.replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return null;
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
};

for (const [id, p] of Object.entries(primitives.color)) {
  const expected = hexToRgb(p.hex);
  if (!expected) {
    errors.push(`primitive.color.${id}: invalid hex ${p.hex}`);
    continue;
  }
  if (expected[0] !== p.rgb[0] || expected[1] !== p.rgb[1] || expected[2] !== p.rgb[2]) {
    errors.push(`primitive.color.${id}: hex ${p.hex} != rgb ${JSON.stringify(p.rgb)} (expected ${JSON.stringify(expected)})`);
  }
}

const requiredSemanticIds = Object.keys(semantic.ids);
for (const [themeName, theme] of Object.entries(themes)) {
  for (const id of requiredSemanticIds) {
    if (!(id in theme.map)) errors.push(`theme.${themeName}: missing semantic id "${id}"`);
  }
  for (const [id, ref] of Object.entries(theme.map)) {
    if (!requiredSemanticIds.includes(id)) {
      warnings.push(`theme.${themeName}: defines extra id "${id}" not declared in semantic.json`);
    }
    const m = ref.match(/^color\.([\w-]+)$/);
    if (!m) {
      errors.push(`theme.${themeName}.${id}: reference "${ref}" must match /^color\\.[\\w-]+$/`);
      continue;
    }
    if (!(m[1] in primitives.color)) {
      errors.push(`theme.${themeName}.${id}: references primitive "${m[1]}" which is not defined`);
    }
  }
}

// Type scale floor check
const typeScale = primitives['type-scale'];
const remToPx = (v) => {
  // crude: extract last rem number from clamp or plain rem
  const nums = String(v).match(/(\d*\.?\d+)rem/g) || [];
  if (nums.length === 0) return null;
  return Math.min(...nums.map((n) => parseFloat(n) * 16));
};
for (const [k, v] of Object.entries(typeScale)) {
  if (k.startsWith('$') || k === 'baseline') continue;
  const px = remToPx(v);
  if (px !== null && px < 14 && k !== 'eyebrow') {
    errors.push(`type-scale.${k}: minimum is ${px}px, below 14px floor`);
  }
}

// WCAG 2.1 contrast on a few canonical pairs
const luminance = (rgb) => {
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const L1 = luminance(a);
  const L2 = luminance(b);
  const [hi, lo] = L1 > L2 ? [L1, L2] : [L2, L1];
  return (hi + 0.05) / (lo + 0.05);
};
const resolveSemantic = (theme, id) => {
  const ref = themes[theme].map[id];
  const name = ref.split('.')[1];
  return primitives.color[name];
};
const auditPairs = [
  ['text-body', 'bg-page'],
  ['text-heading', 'bg-page'],
  ['text-body-subtle', 'bg-page'],
  ['text-on-brand', 'bg-brand'],
  ['text-on-danger', 'bg-danger'],
  ['text-on-inverse', 'bg-inverse'],
  ['term-fg', 'term-bg'],
  ['term-ok', 'term-bg'],
  ['term-warn', 'term-bg'],
  ['term-err', 'term-bg'],
  ['term-dim', 'term-bg'],
  ['severity-securite-fg', 'severity-securite-bg'],
  ['severity-pan-pan-fg', 'severity-pan-pan-bg'],
  ['severity-mayday-fg', 'severity-mayday-bg'],
];
const contrastReport = { dark: [], light: [] };
for (const themeName of ['dark', 'light']) {
  for (const [fgId, bgId] of auditPairs) {
    const fg = resolveSemantic(themeName, fgId);
    const bg = resolveSemantic(themeName, bgId);
    const ratio = contrast(fg.rgb, bg.rgb);
    contrastReport[themeName].push({
      fg: fgId, bg: bgId,
      fgHex: fg.hex, bgHex: bg.hex,
      ratio: Math.round(ratio * 10) / 10,
      aaNormal: ratio >= 4.5,
      aaLarge: ratio >= 3.0,
    });
    if (ratio < 4.5) {
      const isEyebrow = fgId.endsWith('-eyebrow') || bgId.includes('-soft');
      if (!isEyebrow) {
        errors.push(`theme.${themeName}: contrast ${fgId} on ${bgId} = ${ratio.toFixed(2)}:1 fails AA Normal (4.5)`);
      }
    }
  }
}

if (errors.length) {
  console.error('\n❌ Build failed with errors:\n');
  errors.forEach((e) => console.error('  • ' + e));
  process.exit(1);
}
if (warnings.length) {
  console.warn('\n⚠  Warnings (non-fatal):\n');
  warnings.forEach((w) => console.warn('  • ' + w));
}

// ─── Emit: tokens.css ───────────────────────────────────────────────────────

const cssHeader = `/* Port Daddy Design Tokens — generated ${NOW} by design/build.mjs.
 * DO NOT EDIT THIS FILE. Edit design/tokens/*.json and re-run \`node design/build.mjs\`.
 * Source: primitives.json (${Object.keys(primitives.color).length} colors)
 *       + semantic.json   (${requiredSemanticIds.length} ids)
 *       + themes/{dark,light}.json
 * Version: ${VERSION}
 */\n`;

const semanticToCssVar = (id) => `--pd-${id}`;
const primitiveToCssVar = (name) => `--pd-color-${name}`;

let css = cssHeader + '\n';

// Tier 1 — primitives as their own vars (debug aid, also lets external code reference)
css += '/* ── Tier 1 — primitives (raw values) ────────────────────────────────────── */\n';
css += ':root {\n';
for (const [name, p] of Object.entries(primitives.color)) {
  css += `  ${primitiveToCssVar(name)}: ${p.hex};\n`;
}
css += '\n';
for (const [k, v] of Object.entries(primitives.space)) {
  css += `  --pd-space-${k}: ${v};\n`;
}
for (const [k, v] of Object.entries(primitives.radius)) {
  css += `  --pd-radius-${k}: ${v};\n`;
}
for (const [k, v] of Object.entries(primitives['border-width'])) {
  css += `  --pd-bw-${k}: ${v};\n`;
}
for (const [k, v] of Object.entries(primitives.shadow)) {
  css += `  --pd-shadow-${k}: ${v};\n`;
}
css += `  --pd-font-display: ${primitives.font.display};\n`;
css += `  --pd-font-body: ${primitives.font.body};\n`;
css += `  --pd-font-mono: ${primitives.font.mono};\n`;
for (const [k, v] of Object.entries(primitives['type-scale'])) {
  if (k.startsWith('$')) continue;
  css += `  --pd-type-${k}: ${v};\n`;
}
css += '}\n\n';

// Tier 2 — semantic per theme
for (const themeName of ['dark', 'light']) {
  const selector = themeName === 'dark'
    ? ':root, [data-theme="dark"]'
    : '[data-theme="light"]';
  css += `/* ── Tier 2 — semantic · ${themeName} theme ─────────────────────────────────── */\n`;
  css += `${selector} {\n`;
  for (const id of requiredSemanticIds) {
    const ref = themes[themeName].map[id];
    const primName = ref.split('.')[1];
    css += `  ${semanticToCssVar(id)}: var(${primitiveToCssVar(primName)});\n`;
  }
  css += '}\n\n';
}

// Optional: @media prefers-color-scheme for graceful default
css += '/* ── Prefers-color-scheme fallback (no [data-theme] attribute set) ────────── */\n';
css += '@media (prefers-color-scheme: light) {\n';
css += '  :root:not([data-theme]) {\n';
for (const id of requiredSemanticIds) {
  const ref = themes.light.map[id];
  const primName = ref.split('.')[1];
  css += `    ${semanticToCssVar(id)}: var(${primitiveToCssVar(primName)});\n`;
}
css += '  }\n';
css += '}\n';

writeFileSync(join(OUT, 'tokens.css'), css);
console.log(`✓ wrote design/build/tokens.css (${css.split('\n').length} lines)`);

// ─── Emit: tokens.json (flat tree) ──────────────────────────────────────────

const flat = {
  $generated: NOW,
  $version: VERSION,
  primitives: primitives.color,
  themes: {},
  contrastReport,
};
for (const themeName of ['dark', 'light']) {
  flat.themes[themeName] = {};
  for (const id of requiredSemanticIds) {
    const ref = themes[themeName].map[id];
    const primName = ref.split('.')[1];
    flat.themes[themeName][id] = {
      ref,
      hex: primitives.color[primName].hex,
      rgb: primitives.color[primName].rgb,
    };
  }
}
writeFileSync(join(OUT, 'tokens.json'), JSON.stringify(flat, null, 2));
console.log(`✓ wrote design/build/tokens.json`);

// ─── Emit: tokens.rs (Rust constants for ratatui binary) ────────────────────

let rs = `// Port Daddy Design Tokens — generated ${NOW} by design/build.mjs.
// DO NOT EDIT. Edit design/tokens/*.json and re-run \`node design/build.mjs\`.
// Version: ${VERSION}
//
// Usage in ratatui:
//   use ratatui::style::Color;
//   use port_daddy_tokens::{dark, light, Theme};
//   let theme: &dyn Theme = if std::env::var("PD_THEME").as_deref() == Ok("light")
//       { &light::THEME } else { &dark::THEME };
//   let bg = theme.bg_page();

#![allow(dead_code)]

use ratatui::style::Color;

pub trait Theme: Sync {
`;
for (const id of requiredSemanticIds) {
  rs += `    fn ${id.replace(/-/g, '_')}(&self) -> Color;\n`;
}
rs += `}\n\n`;

for (const themeName of ['dark', 'light']) {
  rs += `pub mod ${themeName} {\n    use super::*;\n    pub struct Tokens;\n    pub const THEME: Tokens = Tokens;\n    impl Theme for Tokens {\n`;
  for (const id of requiredSemanticIds) {
    const ref = themes[themeName].map[id];
    const primName = ref.split('.')[1];
    const [r, g, b] = primitives.color[primName].rgb;
    rs += `        fn ${id.replace(/-/g, '_')}(&self) -> Color { Color::Rgb(${r}, ${g}, ${b}) }\n`;
  }
  rs += `    }\n}\n\n`;
}

// Primitive constants (raw RGB, theme-invariant)
rs += `pub mod primitive {\n    use super::*;\n`;
for (const [name, p] of Object.entries(primitives.color)) {
  const constName = name.toUpperCase().replace(/-/g, '_');
  rs += `    pub const ${constName}: Color = Color::Rgb(${p.rgb[0]}, ${p.rgb[1]}, ${p.rgb[2]});\n`;
}
rs += `}\n`;
writeFileSync(join(OUT, 'tokens.rs'), rs);
console.log(`✓ wrote design/build/tokens.rs`);

// ─── Emit: Tokens.swift (SwiftUI Color extension) ───────────────────────────

let swift = `// Port Daddy Design Tokens — generated ${NOW} by design/build.mjs.
// DO NOT EDIT. Edit design/tokens/*.json and re-run \`node design/build.mjs\`.
// Version: ${VERSION}

import SwiftUI

public enum PDTheme: String {
    case dark, light
    public static var current: PDTheme {
        // Honor an explicit override; otherwise follow appearance.
        if let v = ProcessInfo.processInfo.environment["PD_THEME"],
           let theme = PDTheme(rawValue: v) { return theme }
        return .dark
    }
}

public extension Color {
    static func pd(_ id: PDSemantic, theme: PDTheme = .current) -> Color {
        switch theme {
        case .dark:  return PDDark.color(for: id)
        case .light: return PDLight.color(for: id)
        }
    }
}

public enum PDSemantic: String, CaseIterable {
`;
for (const id of requiredSemanticIds) {
  swift += `    case ${id.replace(/-/g, '_')} = "${id}"\n`;
}
swift += `}\n\n`;

for (const themeName of ['dark', 'light']) {
  const camelName = themeName.charAt(0).toUpperCase() + themeName.slice(1);
  swift += `enum PD${camelName} {\n    static func color(for id: PDSemantic) -> Color {\n        switch id {\n`;
  for (const id of requiredSemanticIds) {
    const ref = themes[themeName].map[id];
    const primName = ref.split('.')[1];
    const [r, g, b] = primitives.color[primName].rgb;
    const rs = (r / 255).toFixed(3);
    const gs = (g / 255).toFixed(3);
    const bs = (b / 255).toFixed(3);
    swift += `        case .${id.replace(/-/g, '_')}: return Color(red: ${rs}, green: ${gs}, blue: ${bs})\n`;
  }
  swift += `        }\n    }\n}\n\n`;
}
writeFileSync(join(OUT, 'Tokens.swift'), swift);
console.log(`✓ wrote design/build/Tokens.swift`);

// ─── Emit: tokens.ansi.ts (ANSI escape sequences + RGB pairs for lib/maritime.ts) ──

const ansiEscape = (r, g, b, isBg) => `\\u001b[${isBg ? 48 : 38};2;${r};${g};${b}m`;
let ts = `// Port Daddy Design Tokens — generated ${NOW} by design/build.mjs.
// DO NOT EDIT. Edit design/tokens/*.json and re-run \`node design/build.mjs\`.
// Version: ${VERSION}
//
// Wire this into lib/maritime.ts to replace the named-ANSI palette with
// truecolor-from-design-system. Falls back gracefully on 256-color terminals
// (caller's responsibility — these strings produce no output on terminals
// that don't grok 38;2;r;g;b).

export type PDTheme = 'dark' | 'light';
export const RESET = '\\u001b[0m';

`;
for (const themeName of ['dark', 'light']) {
  ts += `export const ${themeName.toUpperCase()}_THEME = {\n`;
  for (const id of requiredSemanticIds) {
    const ref = themes[themeName].map[id];
    const primName = ref.split('.')[1];
    const [r, g, b] = primitives.color[primName].rgb;
    const k = id.replace(/-/g, '_');
    ts += `  ${k}: { fg: '${ansiEscape(r, g, b, false)}', bg: '${ansiEscape(r, g, b, true)}', rgb: [${r}, ${g}, ${b}] as const, hex: '${primitives.color[primName].hex}' },\n`;
  }
  ts += `} as const;\n\n`;
}
ts += `export const THEMES = { dark: DARK_THEME, light: LIGHT_THEME } as const;
export function activeTheme(): PDTheme {
  return (process.env.PD_THEME === 'light' ? 'light' : 'dark');
}
export function pd(id: keyof typeof DARK_THEME, theme: PDTheme = activeTheme()) {
  return THEMES[theme][id];
}
`;
writeFileSync(join(OUT, 'tokens.ansi.ts'), ts);
console.log(`✓ wrote design/build/tokens.ansi.ts`);

// ─── Summary ────────────────────────────────────────────────────────────────

console.log('\n📊 Contrast audit summary:');
for (const [themeName, pairs] of Object.entries(contrastReport)) {
  const fails = pairs.filter((p) => !p.aaNormal);
  console.log(`   ${themeName.padEnd(5)}: ${pairs.length - fails.length}/${pairs.length} pairs ≥ AA Normal (4.5:1)`);
  for (const f of fails) {
    console.log(`     ⚠ ${f.fg} on ${f.bg} = ${f.ratio}:1 (large-text only)`);
  }
}

console.log(`\n✓ Build complete. ${Object.keys(primitives.color).length} primitives → ${requiredSemanticIds.length} semantic ids × 2 themes → 5 targets.\n`);
