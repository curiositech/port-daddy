// tests/unit/purser/model-context-extraction.test.ts
import { describe, expect, test } from '@jest/globals';
import { decodeSquidTapEnvelope } from '../../../cli/commands/squid.ts';

/**
 * Helper that builds the JSON envelope the Squid “tap” hook emits.
 *
 * The real hook wraps the user‑visible payload (`additionalContext`) together
 * with a `hookEventName`.  The harness under test must peel this wrapper off
 * and expose the raw `additionalContext` to the model while reporting that
 * the payload was a structured envelope.
 */
const structuredEnvelope = (
  additionalContext: unknown,
  hookEventName: unknown = 'UserPromptSubmit',
): string =>
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName,
      additionalContext,
    },
  });

describe('decodeSquidTapEnvelope', () => {
  test('extracts exact additionalContext from a structured hook envelope', () => {
    const context = '[PORT DADDY — INBOX]\n2 unread messages\n[PORT DADDY — ACTIONABLE COORDINATION]\nrun pd attention';
    const decoded = decodeSquidTapEnvelope(structuredEnvelope(context));
    expect(decoded).toEqual({
      context,
      eventName: 'UserPromptSubmit',
      structured: true,
    });
  });

  test('never decodes the transport wrapper into the model context', () => {
    const context = 'the exact payload';
    const raw = structuredEnvelope(context);
    const decoded = decodeSquidTapEnvelope(raw);
    expect(decoded.context).toBe(context);
    expect(decoded.context).not.toBe(raw);
    expect(decoded.context).not.toContain('hookSpecificOutput');
    expect(decoded.structured).toBe(true);
  });

  test('preserves context bytes verbatim including leading, trailing, and blank lines', () => {
    const context = '\n[PORT DADDY — INBOX]\n\n1 unread message\n';
    expect(decodeSquidTapEnvelope(structuredEnvelope(context))).toEqual({
      context,
      eventName: 'UserPromptSubmit',
      structured: true,
    });
  });

  test('treats a structured envelope with a non‑string additionalContext as direct text', () => {
    const raw = structuredEnvelope(null);
    expect(decodeSquidTapEnvelope(raw)).toEqual({
      context: raw,
      eventName: null,
      structured: false,
    });
  });

  test('treats a structured envelope missing additionalContext as direct text', () => {
    const raw = JSON.stringify({
      hookSpecificOutput: { hookEventName: 'UserPromptSubmit' },
    });
    expect(decodeSquidTapEnvelope(raw)).toEqual({
      context: raw,
      eventName: null,
      structured: false,
    });
  });

  test('treats an array JSON payload as direct text rather than a structured envelope', () => {
    const raw = '["not", "an", "envelope"]';
    expect(decodeSquidTapEnvelope(raw)).toEqual({
      context: raw,
      eventName: null,
      structured: false,
    });
  });

  test('falls back to direct text when the provider emits malformed JSON', () => {
    const raw = ' {not-json}\n';
    expect(decodeSquidTapEnvelope(raw)).toEqual({
      // the implementation trims whitespace before returning the raw payload
      context: '{not-json}',
      eventName: null,
      structured: false,
    });
  });

  test('reports an empty hook response as no model context', () => {
    expect(decodeSquidTapEnvelope('')).toEqual({
      context: '',
      eventName: null,
      structured: false,
    });
  });
});