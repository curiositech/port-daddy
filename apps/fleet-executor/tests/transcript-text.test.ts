/**
 * Unit tests for the bounded transcript-text capture (src/transcript-text.ts).
 */

import { describe, it, expect } from 'vitest';
import { capText, TRANSCRIPT_TEXT_CAP } from '../src/transcript-text.js';

describe('capText', () => {
  it('returns text untouched, truncated:false, when under the cap', () => {
    const result = capText('hello world');
    expect(result).toEqual({ text: 'hello world', truncated: false, length: 11 });
  });

  it('handles empty string', () => {
    expect(capText('')).toEqual({ text: '', truncated: false, length: 0 });
  });

  it('treats any non-string as empty text, and never throws', () => {
    // capText takes `unknown` deliberately: it runs on the best-effort
    // transcript path, where the value came back from a model. The signature
    // used to say `string` while the body defended against undefined, so this
    // test needed @ts-expect-error to prove the guard worked -- the directive
    // was evidence the type was lying, not evidence the test was hostile.
    //
    // Non-strings are treated as EMPTY rather than coerced. String({}) would
    // write "[object Object]" into a field a human reads as the model's actual
    // prompt, which is worse than an obvious blank.
    for (const bad of [undefined, null, 42, {}, [], true, Symbol('s'), () => {}]) {
      expect(capText(bad)).toEqual({ text: '', truncated: false, length: 0 });
    }
  });

  it('truncates text longer than the default cap, reporting the ORIGINAL length', () => {
    const long = 'x'.repeat(TRANSCRIPT_TEXT_CAP + 500);
    const result = capText(long);
    expect(result.truncated).toBe(true);
    expect(result.text).toHaveLength(TRANSCRIPT_TEXT_CAP);
    expect(result.length).toBe(TRANSCRIPT_TEXT_CAP + 500); // never lied about
  });

  it('is exact at the boundary: cap chars is NOT truncated, cap+1 IS', () => {
    const exact = 'y'.repeat(50);
    expect(capText(exact, 50)).toEqual({ text: exact, truncated: false, length: 50 });

    const overByOne = 'y'.repeat(51);
    const result = capText(overByOne, 50);
    expect(result.truncated).toBe(true);
    expect(result.text).toHaveLength(50);
    expect(result.length).toBe(51);
  });

  it('honors a custom cap smaller than the default', () => {
    const result = capText('abcdefghij', 4);
    expect(result).toEqual({ text: 'abcd', truncated: true, length: 10 });
  });

  it('never drops the fact of truncation silently — length is always present', () => {
    const long = 'z'.repeat(TRANSCRIPT_TEXT_CAP * 3);
    const result = capText(long);
    // The whole point: a caller can ALWAYS tell how much was cut, even though
    // the cut content itself is gone from this call's return value.
    expect(result.length).toBeGreaterThan(result.text.length);
    expect(result.truncated).toBe(true);
  });
});
