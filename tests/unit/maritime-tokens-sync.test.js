/**
 * Sync gate: lib/maritime.ts's truecolor ANSI table MUST match the RGB
 * values declared in design/tokens/primitives.json. If they drift, the
 * CLI starts speaking a different palette than the rest of the design
 * system — silently — and we get the same five-unsynced-palettes mess
 * that the Phase 0 audit just untangled.
 *
 * This test reads both sources directly (no compilation step) and
 * asserts the truecolor sequences in maritime.ts encode the exact RGB
 * values from primitives.json for the ICS flag color block and the
 * dark-theme terminal palette.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { _ANSI_TABLES } from '../../lib/maritime.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '../..');

const primitives = JSON.parse(
  readFileSync(resolve(REPO, 'design/tokens/primitives.json'), 'utf8')
);
const darkTheme = JSON.parse(
  readFileSync(resolve(REPO, 'design/tokens/themes/dark.json'), 'utf8')
);

/** Pull RGB from a primitive name. */
const rgbOf = (primName) => primitives.color[primName].rgb;

/** Build the expected truecolor ANSI sequence (matches the build script). */
const fg = ([r, g, b]) => `\x1b[38;2;${r};${g};${b}m`;
const bg = ([r, g, b]) => `\x1b[48;2;${r};${g};${b}m`;

/** Resolve a semantic id in the dark theme to its primitive RGB. */
const rgbOfSemantic = (id) => {
  const ref = darkTheme.map[id];
  const primName = ref.split('.')[1];
  return rgbOf(primName);
};

describe('lib/maritime.ts truecolor table is in sync with design/tokens', () => {
  describe('ICS flag backgrounds (theme-invariant)', () => {
    test('bgBlue == navy primitive', () => {
      expect(_ANSI_TABLES.truecolor.bgBlue).toBe(bg(rgbOf('navy')));
    });
    test('bgWhite == ics-white primitive', () => {
      expect(_ANSI_TABLES.truecolor.bgWhite).toBe(bg(rgbOf('ics-white')));
    });
    test('bgRed == cinnabar primitive', () => {
      expect(_ANSI_TABLES.truecolor.bgRed).toBe(bg(rgbOf('cinnabar')));
    });
    test('bgYellow == mustard primitive', () => {
      expect(_ANSI_TABLES.truecolor.bgYellow).toBe(bg(rgbOf('mustard')));
    });
    test('bgBlack == ebony primitive', () => {
      expect(_ANSI_TABLES.truecolor.bgBlack).toBe(bg(rgbOf('ebony')));
    });
  });

  describe('Terminal foregrounds (dark-theme palette)', () => {
    test('fgWhite == dark-theme term-fg', () => {
      expect(_ANSI_TABLES.truecolor.fgWhite).toBe(fg(rgbOfSemantic('term-fg')));
    });
    test('fgGray == dark-theme term-dim (fog)', () => {
      expect(_ANSI_TABLES.truecolor.fgGray).toBe(fg(rgbOfSemantic('term-dim')));
    });
    test('fgGreen == dark-theme term-ok (kelp)', () => {
      expect(_ANSI_TABLES.truecolor.fgGreen).toBe(fg(rgbOfSemantic('term-ok')));
    });
    test('fgYellow == dark-theme term-warn (warning)', () => {
      expect(_ANSI_TABLES.truecolor.fgYellow).toBe(fg(rgbOfSemantic('term-warn')));
    });
    test('fgRed == dark-theme term-err (cinnabar-lit)', () => {
      expect(_ANSI_TABLES.truecolor.fgRed).toBe(fg(rgbOfSemantic('term-err')));
    });
    test('fgBlue and fgCyan == dark-theme term-info (sky)', () => {
      const expected = fg(rgbOfSemantic('term-info'));
      expect(_ANSI_TABLES.truecolor.fgBlue).toBe(expected);
      expect(_ANSI_TABLES.truecolor.fgCyan).toBe(expected);
    });
    test('fgMagenta == purple primitive', () => {
      expect(_ANSI_TABLES.truecolor.fgMagenta).toBe(fg(rgbOf('purple')));
    });
  });

  describe('Style codes (theme-invariant)', () => {
    test('reset, bold, dim are standard SGR codes', () => {
      expect(_ANSI_TABLES.truecolor.reset).toBe('\x1b[0m');
      expect(_ANSI_TABLES.truecolor.bold).toBe('\x1b[1m');
      expect(_ANSI_TABLES.truecolor.dim).toBe('\x1b[2m');
    });
  });
});
