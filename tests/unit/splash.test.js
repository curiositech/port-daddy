/**
 * Unit Tests for lib/splash.ts
 *
 * Verifies the launch-splash renderer:
 *   - PORT and DADDY block letters render in both colored and monochrome modes
 *   - The lighthouse art is gone (removed)
 *   - The tagline is present and customizable
 *   - NO_COLOR / non-TTY paths strip ANSI codes
 *   - No emojis leak into the output (rule: no emojis as design elements)
 */

import { describe, test, expect } from '@jest/globals';
import { renderSplash, supportsColor } from '../../lib/splash.js';

const ANSI_RE = /\x1b\[[0-9;]*m/g;

describe('renderSplash', () => {
  test('renders a non-empty string', () => {
    const out = renderSplash({ color: false });
    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(200);
  });

  test('contains both PORT and DADDY block letters', () => {
    // We can't grep for "PORT" or "DADDY" since the letters are ASCII art.
    // Instead, look for the block-character signature on each row of the
    // 5-row tall font. Every row has at least 4 █ glyphs (the thinnest "T"
    // row), so ≥10 such rows = both words rendered.
    const out = renderSplash({ color: false });
    const blockLines = out.split('\n').filter((line) =>
      (line.match(/█/g) ?? []).length >= 4
    );
    expect(blockLines.length).toBeGreaterThanOrEqual(10);

    // And the heaviest rows (top / middle / bottom bars) must be present
    // in both words — at least 6 rows with 20+ blocks.
    const heavyLines = out.split('\n').filter((line) =>
      (line.match(/█/g) ?? []).length >= 20
    );
    expect(heavyLines.length).toBeGreaterThanOrEqual(6);
  });

  test('no longer renders the lighthouse silhouette', () => {
    const out = renderSplash({ color: false });
    // The cove/lighthouse art was removed — none of its glyphs should remain.
    expect(out).not.toContain('╔═══╗');   // lantern room
    expect(out).not.toContain('╚═╤═╝');   // lantern base
    expect(out).not.toContain('┌─┴─┐');   // gallery
    expect(out).not.toContain('░░░');     // cobalt stripe fill
    expect(out).not.toContain('◁');       // beam-sweep arrow
  });

  test('contains the default tagline', () => {
    const out = renderSplash({ color: false });
    expect(out).toContain('the control plane for your fleet of agents.');
  });

  test('honors a custom tagline', () => {
    const out = renderSplash({
      color: false,
      tagline: 'small, sovereign, on your machine.',
    });
    expect(out).toContain('small, sovereign, on your machine.');
    expect(out).not.toContain('the control plane for your fleet of agents.');
  });

  test('emits ANSI codes when color is enabled with truecolor', () => {
    const out = renderSplash({ color: true, truecolor: true });
    expect(out).toMatch(ANSI_RE);
    // brand cobalt
    expect(out).toContain('\x1b[38;2;0;63;184m');
    // brand sage (bright variant for beam)
    expect(out).toContain('\x1b[38;2;72;167;152m');
  });

  test('emits no ANSI codes when color is disabled', () => {
    const out = renderSplash({ color: false });
    expect(out).not.toMatch(ANSI_RE);
  });

  test('contains no emoji glyphs (rule: no emojis as design elements)', () => {
    const out = renderSplash({ color: false });
    // Specific emojis the brief warned against
    expect(out).not.toMatch(/⛵|⚓|🚢|🌊|⭐/u);
    // Broader: no symbols in the Emoticons or Misc Symbols blocks that
    // would be rendered as full emoji glyphs by terminals
    // (box-drawing and geometric shapes are allowed; they are line-art).
    expect(out).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  });

  test('output width fits in a standard 100-column terminal', () => {
    // Strip ANSI before measuring
    const out = renderSplash({ color: true, truecolor: true }).replace(ANSI_RE, '');
    const widest = Math.max(...out.split('\n').map((l) => l.length));
    expect(widest).toBeLessThanOrEqual(100);
  });
});

describe('supportsColor', () => {
  test('returns false when NO_COLOR is set', () => {
    const prev = process.env.NO_COLOR;
    process.env.NO_COLOR = '1';
    try {
      // Pass a fake TTY stream so we know NO_COLOR is the deciding factor
      const fakeTTY = { isTTY: true };
      expect(supportsColor(fakeTTY)).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.NO_COLOR;
      else process.env.NO_COLOR = prev;
    }
  });

  test('returns false when stream is not a TTY', () => {
    const prevNC = process.env.NO_COLOR;
    const prevFC = process.env.FORCE_COLOR;
    delete process.env.NO_COLOR;
    delete process.env.FORCE_COLOR;
    try {
      const fakeNonTTY = { isTTY: false };
      expect(supportsColor(fakeNonTTY)).toBe(false);
    } finally {
      if (prevNC !== undefined) process.env.NO_COLOR = prevNC;
      if (prevFC !== undefined) process.env.FORCE_COLOR = prevFC;
    }
  });
});
