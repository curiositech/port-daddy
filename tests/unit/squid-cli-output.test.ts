import { describe, expect, test } from '@jest/globals';
import { decodeSquidTapEnvelope } from '../../cli/commands/squid.js';

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
});
