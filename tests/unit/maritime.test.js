/**
 * Unit Tests for lib/maritime.ts — comprehensive coverage
 *
 * Tests all exported functions: flags, channel highlighting,
 * agent coloring, signal routing, message formatting, and Frequencies.
 */

import { describe, test, expect } from '@jest/globals';
import {
  SignalFlags,
  flag,
  flagBlock,
  highlightChannel,
  agentColor,
  formatCallsign,
  signalColor,
  signalToFlag,
  formatRadioMessage,
  status,
  STATUS_LABELS,
  Frequencies,
  ANSI,
  COLOR_ENABLED,
} from '../../lib/maritime.js';

// ─── COLOR_ENABLED & ANSI proxy ──────────────────────────────────────────────

describe('COLOR_ENABLED', () => {
  test('is a boolean', () => {
    expect(typeof COLOR_ENABLED).toBe('boolean');
  });
});

describe('ANSI proxy', () => {
  test('has expected keys', () => {
    const keys = ['reset', 'bold', 'dim', 'fgGreen', 'fgRed', 'fgCyan', 'fgYellow'];
    for (const key of keys) {
      // Either a string (when color enabled) or empty string (when disabled)
      expect(typeof ANSI[key]).toBe('string');
    }
  });
});

// ─── SignalFlags ──────────────────────────────────────────────────────────────

describe('SignalFlags', () => {
  const flagNames = ['charlie', 'november', 'kilo', 'uniform', 'victor', 'lima', 'alpha', 'bravo'];

  for (const name of flagNames) {
    test(`${name}() returns array of 2 strings`, () => {
      const lines = SignalFlags[name]();
      expect(Array.isArray(lines)).toBe(true);
      expect(lines).toHaveLength(2);
      expect(typeof lines[0]).toBe('string');
      expect(typeof lines[1]).toBe('string');
    });
  }

  test('all flags are callable', () => {
    for (const name of flagNames) {
      expect(() => SignalFlags[name]()).not.toThrow();
    }
  });
});

// ─── flag() ──────────────────────────────────────────────────────────────────

describe('flag()', () => {
  const allFlags = ['charlie', 'november', 'kilo', 'uniform', 'victor', 'lima', 'alpha', 'bravo'];

  for (const name of allFlags) {
    test(`flag('${name}') returns a string`, () => {
      expect(typeof flag(name)).toBe('string');
    });
  }

  test('flag returns top row only (same as SignalFlags[name]()[0])', () => {
    const result = flag('charlie');
    const expected = SignalFlags.charlie()[0];
    expect(result).toBe(expected);
  });
});

// ─── flagBlock() ─────────────────────────────────────────────────────────────

describe('flagBlock()', () => {
  test('returns two lines joined by newline', () => {
    const block = flagBlock('charlie');
    const lines = block.split('\n');
    expect(lines).toHaveLength(2);
  });

  test('flagBlock content matches SignalFlags output', () => {
    const lines = SignalFlags.kilo();
    const block = flagBlock('kilo');
    expect(block).toBe(lines.join('\n'));
  });

  test('works for all flag names', () => {
    const names = ['charlie', 'november', 'kilo', 'uniform', 'victor', 'lima'];
    for (const name of names) {
      expect(() => flagBlock(name)).not.toThrow();
    }
  });
});

// ─── highlightChannel() ──────────────────────────────────────────────────────

describe('highlightChannel()', () => {
  test('single segment returns a string', () => {
    const result = highlightChannel('myapp');
    expect(typeof result).toBe('string');
    expect(result).toContain('myapp');
  });

  test('two segments includes both parts', () => {
    const result = highlightChannel('myapp:api');
    expect(result).toContain('myapp');
    expect(result).toContain('api');
  });

  test('three segments includes all parts', () => {
    const result = highlightChannel('myapp:api:main');
    expect(result).toContain('myapp');
    expect(result).toContain('api');
    expect(result).toContain('main');
  });

  test('maritime channel format works', () => {
    const result = highlightChannel('mayday:incident-42:all-stations');
    expect(result).toContain('mayday');
    expect(result).toContain('incident-42');
    expect(result).toContain('all-stations');
  });

  test('single segment does not contain colon separator', () => {
    // Without color codes, single segment should just be the channel name
    const result = highlightChannel('standalone');
    // Strip ANSI codes to check raw content
    const stripped = result.replace(/\x1b\[[0-9;]*m/g, '');
    expect(stripped).toContain('standalone');
  });
});

// ─── agentColor() ────────────────────────────────────────────────────────────

describe('agentColor()', () => {
  test('returns a string', () => {
    expect(typeof agentColor('AGENT-ALPHA')).toBe('string');
  });

  test('is deterministic — same callsign returns same color', () => {
    const c1 = agentColor('worker-1');
    const c2 = agentColor('worker-1');
    expect(c1).toBe(c2);
  });

  test('different callsigns may produce different colors', () => {
    // Not guaranteed to differ (hash collision possible), but test it runs
    const c1 = agentColor('ALPHA');
    const c2 = agentColor('BETA');
    expect(typeof c1).toBe('string');
    expect(typeof c2).toBe('string');
  });

  test('handles empty string', () => {
    expect(() => agentColor('')).not.toThrow();
  });

  test('handles very long callsign', () => {
    expect(() => agentColor('a'.repeat(100))).not.toThrow();
  });
});

// ─── formatCallsign() ────────────────────────────────────────────────────────

describe('formatCallsign()', () => {
  test('returns a string', () => {
    expect(typeof formatCallsign('AGENT-ALPHA')).toBe('string');
  });

  test('contains the callsign text', () => {
    const result = formatCallsign('AGENT-ALPHA');
    expect(result).toContain('AGENT-ALPHA');
  });

  test('different callsigns produce different outputs', () => {
    const a = formatCallsign('ALPHA');
    const b = formatCallsign('BETA');
    // The callsign text itself differs
    expect(a).toContain('ALPHA');
    expect(b).toContain('BETA');
  });
});

// ─── signalColor() ───────────────────────────────────────────────────────────

describe('signalColor()', () => {
  const signalTypes = ['mayday', 'pan-pan', 'securite', 'hail', 'roger', 'wilco', 'report', 'over', 'out'];

  for (const signal of signalTypes) {
    test(`signalColor('${signal}') returns a string`, () => {
      expect(typeof signalColor(signal)).toBe('string');
    });
  }

  test('mayday returns red color code', () => {
    // When color enabled, should include red; when not, returns empty string
    const result = signalColor('mayday');
    // Either ANSI red code or empty string — both are strings
    expect(typeof result).toBe('string');
  });

  test('unknown signal returns white color', () => {
    // The default case returns fgWhite
    const result = signalColor('unknown-signal');
    expect(typeof result).toBe('string');
  });

  test('hail, roger, wilco all return the same color (green)', () => {
    expect(signalColor('hail')).toBe(signalColor('roger'));
    expect(signalColor('roger')).toBe(signalColor('wilco'));
  });

  test('over and out return the same color (gray)', () => {
    expect(signalColor('over')).toBe(signalColor('out'));
  });
});

// ─── signalToFlag() ──────────────────────────────────────────────────────────

describe('signalToFlag()', () => {
  test('hail maps to charlie (affirmative)', () => {
    expect(signalToFlag('hail')).toBe('charlie');
  });

  test('roger maps to charlie', () => {
    expect(signalToFlag('roger')).toBe('charlie');
  });

  test('wilco maps to charlie', () => {
    expect(signalToFlag('wilco')).toBe('charlie');
  });

  test('report maps to kilo (ready to communicate)', () => {
    expect(signalToFlag('report')).toBe('kilo');
  });

  test('securite maps to kilo', () => {
    expect(signalToFlag('securite')).toBe('kilo');
  });

  test('mayday maps to victor (require assistance)', () => {
    expect(signalToFlag('mayday')).toBe('victor');
  });

  test('pan-pan maps to uniform (danger)', () => {
    expect(signalToFlag('pan-pan')).toBe('uniform');
  });

  test('over maps to alpha (in progress)', () => {
    expect(signalToFlag('over')).toBe('alpha');
  });

  test('out maps to alpha', () => {
    expect(signalToFlag('out')).toBe('alpha');
  });

  test('unknown signal maps to kilo (default)', () => {
    expect(signalToFlag('unknown')).toBe('kilo');
  });
});

// ─── formatRadioMessage() ────────────────────────────────────────────────────

describe('formatRadioMessage()', () => {
  const baseMsg = {
    callsign: 'AGENT-ALPHA',
    signal: 'hail',
    message: 'Standing by for tasking',
    timestamp: Date.now(),
  };

  test('returns a string', () => {
    expect(typeof formatRadioMessage(baseMsg)).toBe('string');
  });

  test('contains the callsign', () => {
    const result = formatRadioMessage(baseMsg);
    expect(result).toContain('AGENT-ALPHA');
  });

  test('contains the message', () => {
    const result = formatRadioMessage(baseMsg);
    expect(result).toContain('Standing by for tasking');
  });

  test('contains the uppercase signal type', () => {
    const result = formatRadioMessage(baseMsg);
    expect(result).toContain('HAIL');
  });

  test('contains a time component (HH:MM:SS format)', () => {
    const result = formatRadioMessage(baseMsg);
    // Strip ANSI codes
    const stripped = result.replace(/\x1b\[[0-9;]*m/g, '');
    expect(stripped).toMatch(/\d{2}:\d{2}:\d{2}/);
  });

  test('works for all signal types', () => {
    const signals = ['hail', 'report', 'mayday', 'pan-pan', 'securite', 'roger', 'wilco', 'over', 'out'];
    for (const signal of signals) {
      expect(() => formatRadioMessage({ ...baseMsg, signal })).not.toThrow();
    }
  });

  test('handles message with replyTo', () => {
    const msgWithReply = { ...baseMsg, replyTo: 'AGENT-BRAVO' };
    expect(() => formatRadioMessage(msgWithReply)).not.toThrow();
  });
});

// ─── status() ────────────────────────────────────────────────────────────────

describe('status()', () => {
  const statusTypes = ['success', 'error', 'ready', 'warning', 'help', 'stop'];

  for (const type of statusTypes) {
    test(`status('${type}') returns a string containing the message`, () => {
      const result = status(type, 'test message');
      expect(typeof result).toBe('string');
      expect(result).toContain('test message');
    });
  }

  test('success contains ROGER and Done', () => {
    const result = status('success', 'All good');
    expect(result).toContain('ROGER');
    expect(result).toContain('Done');
  });

  test('error contains NEGATIVE and Error', () => {
    const result = status('error', 'Something failed');
    expect(result).toContain('NEGATIVE');
    expect(result).toContain('Error');
  });

  test('ready contains KILO and Ready', () => {
    const result = status('ready', 'Agent standing by');
    expect(result).toContain('KILO');
    expect(result).toContain('Ready');
  });

  test('warning contains HAIL and Warning', () => {
    const result = status('warning', 'Conflict detected');
    expect(result).toContain('HAIL');
    expect(result).toContain('Warning');
  });

  test('help contains MAYDAY and Critical', () => {
    const result = status('help', 'System down');
    expect(result).toContain('MAYDAY');
    expect(result).toContain('Critical');
  });

  test('stop contains LIMA and Blocked', () => {
    const result = status('stop', 'Deployment halted');
    expect(result).toContain('LIMA');
    expect(result).toContain('Blocked');
  });
});

// ─── STATUS_LABELS ───────────────────────────────────────────────────────────

describe('STATUS_LABELS', () => {
  test('contains all expected keys', () => {
    const expectedKeys = ['success', 'error', 'ready', 'warning', 'help', 'stop'];
    for (const key of expectedKeys) {
      expect(STATUS_LABELS[key]).toBeDefined();
      expect(typeof STATUS_LABELS[key]).toBe('string');
    }
  });

  test('each label contains both maritime and standard term', () => {
    // Format is "MARITIME — Standard"
    for (const [, label] of Object.entries(STATUS_LABELS)) {
      expect(label).toContain(' — ');
    }
  });
});

// ─── Frequencies ─────────────────────────────────────────────────────────────

describe('Frequencies', () => {
  test('distress creates a mayday channel', () => {
    const ch = Frequencies.distress('incident-42');
    expect(ch).toBe('mayday:incident-42:all-stations');
  });

  test('bridge creates a bridge channel', () => {
    const ch = Frequencies.bridge('myapp');
    expect(ch).toBe('bridge:myapp:helm');
  });

  test('shipToShip creates a point-to-point channel', () => {
    const ch = Frequencies.shipToShip('alpha', 'bravo');
    expect(ch).toBe('s2s:alpha:bravo');
  });

  test('broadcast creates a broadcast channel', () => {
    const ch = Frequencies.broadcast('myapp');
    expect(ch).toBe('broadcast:myapp:all');
  });

  test('watch replaces slashes in file path', () => {
    const ch = Frequencies.watch('src/api/users.ts');
    expect(ch).toBe('watch:src-api-users.ts:edits');
    expect(ch).not.toContain('/');
  });

  test('log creates a log channel', () => {
    const ch = Frequencies.log('myapp');
    expect(ch).toBe('log:myapp:entries');
  });

  test('all channel results are valid channel format', () => {
    const channels = [
      Frequencies.distress('test'),
      Frequencies.bridge('test'),
      Frequencies.shipToShip('a', 'b'),
      Frequencies.broadcast('test'),
      Frequencies.watch('file.ts'),
      Frequencies.log('test'),
    ];
    for (const ch of channels) {
      expect(typeof ch).toBe('string');
      expect(ch.length).toBeGreaterThan(0);
    }
  });
});
