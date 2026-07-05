import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', '..');
const semantic = readFileSync(resolve(root, 'website-v2/src/styles/tokens.semantic.css'), 'utf8');
const roles = readFileSync(resolve(root, 'website-v2/src/styles/tokens.roles.css'), 'utf8');
const palette = readFileSync(resolve(root, 'core/pd-console/src/palette.rs'), 'utf8');

const requiredRoles = [
  '--heat: var(--brand-heat);',
  '--heat-foreground: var(--brand-heat-on-tint);',
  '--warm: var(--brand-warm);',
  '--warm-foreground: var(--brand-warm-on-tint);',
  '--console-focus-glow: var(--console-glow-primary);',
  '--console-alert-glow: var(--console-glow-heat);',
  '--console-shadow-depth: var(--console-depth-shadow);',
];

const expectedTokens = [
  '--brand-heat: #aa432e;',
  '--brand-heat-on-tint: #6f2417;',
  '--brand-warm: #8c540e;',
  '--brand-warm-on-tint: #5b3900;',
  '--console-glow-primary: rgba(0, 63, 184, 0.28);',
  '--console-glow-heat: rgba(170, 67, 46, 0.24);',
  '--console-depth-shadow: rgba(31, 28, 23, 0.16);',
  '--brand-heat: #ff9c85;',
  '--brand-heat-on-tint: #ffd4c8;',
  '--brand-warm: #f2be51;',
  '--brand-warm-on-tint: #ffe0a0;',
  '--console-glow-primary: rgba(125, 180, 255, 0.34);',
  '--console-glow-heat: rgba(255, 156, 133, 0.28);',
  '--console-depth-shadow: rgba(0, 0, 0, 0.42);',
];

const expectedPalette = [
  'bg: 0xf2eee6',
  'panel: 0xf7f3eb',
  'accent: 0x003fb8',
  'engaged: 0x8c540e',
  'gated: 0xaa432e',
  'landed: 0x006b5f',
  'bg: 0x101216',
  'panel: 0x181c22',
  'accent: 0x7db4ff',
  'engaged: 0xf2be51',
  'gated: 0xff9c85',
  'landed: 0x8fd0a7',
];

const missing = [];
for (const role of requiredRoles) {
  if (!roles.includes(role)) missing.push(`roles.css missing ${role}`);
}
for (const token of expectedTokens) {
  if (!semantic.includes(token)) missing.push(`tokens.semantic.css missing ${token}`);
}
for (const value of expectedPalette) {
  if (!palette.includes(value)) missing.push(`palette.rs missing ${value}`);
}

if (missing.length) {
  console.error(missing.join('\n'));
  process.exit(1);
}

console.log('console palette tokens match website semantic roles');
