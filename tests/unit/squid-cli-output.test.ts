import { describe, expect, test } from '@jest/globals';
import { decodeSquidTapEnvelope, squidTapSubtitle } from '../../cli/commands/squid.js';

describe('pd squid tap model-context preview', () => {
  test('extracts exact additionalContext instead of displaying provider transport JSON', () => {
    const context = '[PORT DADDY — INBOX]\n2 unread messages';
    const decoded = decodeSquidTapEnvelope(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: context,
      },
    }));
    expect(decoded).toEqual({ context, eventName: 'UserPromptSubmit', structured: true });
  });

  test('keeps direct adapter text while labelling it unstructured', () => {
    expect(decodeSquidTapEnvelope('direct model context')).toEqual({
      context: 'direct model context',
      eventName: null,
      structured: false,
    });
  });

  test('represents an empty hook response honestly', () => {
    expect(decodeSquidTapEnvelope('')).toEqual({ context: null, eventName: null, structured: false });
  });

  test('falls back to direct model text when a malformed provider wrapper arrives', () => {
    expect(decodeSquidTapEnvelope(' {not-json}\n')).toEqual({
      context: '{not-json}',
      eventName: null,
      structured: false,
    });
  });

  test('does not claim a structured envelope when JSON lacks string additionalContext', () => {
    const raw = JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: null } });

    expect(decodeSquidTapEnvelope(raw)).toEqual({
      context: raw,
      eventName: null,
      structured: false,
    });
  });

  test('falls back safely when valid JSON is not an object envelope', () => {
    expect(decodeSquidTapEnvelope('null')).toEqual({
      context: 'null',
      eventName: null,
      structured: false,
    });
  });

  test('preserves structured context bytes, including leading, trailing, and blank lines', () => {
    const context = '\n[PORT DADDY — INBOX]\n\n1 unread message\n';

    expect(decodeSquidTapEnvelope(JSON.stringify({
      hookSpecificOutput: { hookEventName: 42, additionalContext: context },
    }))).toEqual({ context, eventName: null, structured: true });
  });

  test('labels structured context as prose rather than a property path', () => {
    expect(squidTapSubtitle({ eventName: 'UserPromptSubmit' }))
      .toBe('UserPromptSubmit: additional context');
    expect(squidTapSubtitle({ eventName: null })).toBe('direct adapter context');
  });
});
