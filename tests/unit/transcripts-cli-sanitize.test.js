/**
 * Regression test for the terminal-escape-injection fix (CWE-150) in
 * cli/commands/transcripts.ts. DB-sourced transcript fields (ship names,
 * message content, tool names, output summaries) originate from agent/external
 * input; `clean()` must strip ANSI/OSC escapes + C0/C1 control chars before any
 * of them reach a TTY, while preserving the TAB/newline the renderer relies on.
 */
import { describe, it, expect } from '@jest/globals';
import { clean } from '../../cli/commands/transcripts.js';

describe('transcripts CLI clean() — terminal-escape sanitization', () => {
  it('strips an OSC title/clipboard-rewrite injection', () => {
    expect(clean('evil\x1b]0;PWNED\x07ship')).toBe('evilship');
  });

  it('strips CSI sequences (color, cursor move, clear-screen)', () => {
    expect(clean('\x1b[31m\x1b[2J\x1b[Hred')).toBe('red');
  });

  it('strips C0/C1 control chars and DEL', () => {
    expect(clean('a\x00\x07\x08\x1f\x7fb')).toBe('ab');
  });

  it('preserves TAB and newline (the renderer handles them)', () => {
    expect(clean('col1\tcol2\nline2')).toBe('col1\tcol2\nline2');
  });

  it('handles null/undefined as empty string', () => {
    expect(clean(null)).toBe('');
    expect(clean(undefined)).toBe('');
  });

  it('leaves benign text untouched', () => {
    expect(clean('myapp:api  completed  $0.0042')).toBe('myapp:api  completed  $0.0042');
  });
});
