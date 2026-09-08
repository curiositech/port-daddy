/**
 * Tests for lib/squid/terminal.ts — the centralized capability detection and
 * semantic color tokens shared by `pd squid on|off|status|tap`. Every
 * assertion here exists because cli/commands/squid.ts used to hardcode raw
 * ANSI escapes directly in handleSquidStatus, bypassing NO_COLOR/TERM=dumb
 * entirely (a real bug this module fixes).
 */
import { detectSquidCapabilities, squidTokens } from '../../lib/squid/terminal.js';

const TTY_ENV = { TERM: 'xterm-256color' };

describe('detectSquidCapabilities', () => {
  test('NO_COLOR disables color regardless of TTY', () => {
    const caps = detectSquidCapabilities('stdout', { isTTY: true, env: { ...TTY_ENV, NO_COLOR: '1' } });
    expect(caps.colorLevel).toBe('none');
    expect(caps.reducedMotion).toBe(true);
  });

  test('TERM=dumb disables color regardless of TTY', () => {
    const caps = detectSquidCapabilities('stdout', { isTTY: true, env: { TERM: 'dumb' } });
    expect(caps.colorLevel).toBe('none');
    expect(caps.reducedMotion).toBe(true);
  });

  test('non-TTY (pipe/CI) disables color and forces reduced motion', () => {
    const caps = detectSquidCapabilities('stdout', { isTTY: false, env: TTY_ENV });
    expect(caps.colorLevel).toBe('none');
    expect(caps.isTTY).toBe(false);
    expect(caps.reducedMotion).toBe(true);
  });

  test('CI=true forces reduced motion even if isTTY is spoofed true', () => {
    const caps = detectSquidCapabilities('stdout', { isTTY: true, env: { ...TTY_ENV, CI: 'true' } });
    expect(caps.ci).toBe(true);
    expect(caps.reducedMotion).toBe(true);
  });

  test('CI=false / CI unset is not treated as CI', () => {
    const unset = detectSquidCapabilities('stdout', { isTTY: true, env: TTY_ENV });
    expect(unset.ci).toBe(false);
    const explicit = detectSquidCapabilities('stdout', { isTTY: true, env: { ...TTY_ENV, CI: 'false' } });
    expect(explicit.ci).toBe(false);
  });

  test('a real color-capable TTY enables color and motion', () => {
    const caps = detectSquidCapabilities('stdout', { isTTY: true, env: TTY_ENV });
    expect(caps.colorLevel).not.toBe('none');
    expect(caps.reducedMotion).toBe(false);
  });

  test('explicit PD_SQUID_REDUCED_MOTION=1 opts out of motion even with full color support', () => {
    const caps = detectSquidCapabilities('stdout', {
      isTTY: true,
      env: { ...TTY_ENV, PD_SQUID_REDUCED_MOTION: '1' },
    });
    expect(caps.colorLevel).not.toBe('none');
    expect(caps.reducedMotion).toBe(true);
  });

  test('NO_ANIMATION=1 also opts out of motion', () => {
    const caps = detectSquidCapabilities('stdout', { isTTY: true, env: { ...TTY_ENV, NO_ANIMATION: '1' } });
    expect(caps.reducedMotion).toBe(true);
  });
});

describe('squidTokens', () => {
  test('wraps text in ANSI codes when color is enabled', () => {
    const t = squidTokens('stdout', { isTTY: true, env: TTY_ENV });
    expect(t.ok('armed')).toBe('\x1b[32marmed\x1b[0m');
    expect(t.bad('down')).toBe('\x1b[31mdown\x1b[0m');
    expect(t.identity('◆ PD')).toBe('\x1b[36m◆ PD\x1b[0m');
  });

  test('returns plain text with NO_COLOR — no stray escape codes leak', () => {
    const t = squidTokens('stdout', { isTTY: true, env: { ...TTY_ENV, NO_COLOR: '1' } });
    expect(t.ok('armed')).toBe('armed');
    expect(t.bad('down')).toBe('down');
    expect(t.identity('◆ PD')).toBe('◆ PD');
  });

  test('returns plain text for a non-TTY pipe', () => {
    const t = squidTokens('stdout', { isTTY: false, env: TTY_ENV });
    expect(t.warn('degraded')).toBe('degraded');
  });
});
