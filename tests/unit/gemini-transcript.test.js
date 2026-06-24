/**
 * Unit tests for the gemini `generateContent` → structured transcript parser.
 *
 * Fixtures are VERBATIM `candidates[].content.parts[]` captured from live
 * `gemini-2.5-flash` REST calls (v1beta `:generateContent`) with
 * `thinkingConfig.includeThoughts` enabled and a `functionDeclarations`
 * tool, so the parser is exercised against the real response shape — not a
 * guessed schema. See .scratch/probe.mjs / probe2.mjs in the worktree.
 */

import { describe, it, expect } from '@jest/globals';

const { parseGeminiTranscript } = await import('../../lib/spawner/gemini-transcript.js');

// ── Live capture #1: thinking + two parallel functionCall parts ──
// One functionCall part also carried a `thoughtSignature` blob (verbatim,
// truncated here but structurally identical) — the parser must ignore it.
const TOOL_RESPONSE = {
  candidates: [
    {
      content: {
        parts: [
          {
            text: 'Okay, the user wants the weather for Paris and Tokyo. I will call get_weather twice.',
            thought: true,
          },
          {
            functionCall: { name: 'get_weather', args: { city: 'Paris' } },
            thoughtSignature: 'CqIEAQw51sf6kbzr8jcTP6Ir4EHDR2FFAYaJhlXJCmm',
          },
          {
            functionCall: { name: 'get_weather', args: { city: 'Tokyo' } },
          },
        ],
        role: 'model',
      },
      finishReason: 'STOP',
      index: 0,
    },
  ],
  usageMetadata: {
    promptTokenCount: 94,
    candidatesTokenCount: 30,
    thoughtsTokenCount: 108,
    totalTokenCount: 232,
  },
  modelVersion: 'gemini-2.5-flash',
};

// ── Live capture #2: thinking + plain assistant text, no tools ──
const TEXT_RESPONSE = {
  candidates: [
    {
      content: {
        parts: [
          {
            text: 'The user wants the capital of France in one sentence. That is Paris.',
            thought: true,
          },
          { text: 'Paris is the capital of France.' },
        ],
        role: 'model',
      },
      finishReason: 'STOP',
      index: 0,
    },
  ],
  usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 7, thoughtsTokenCount: 136 },
  modelVersion: 'gemini-2.5-flash',
};

describe('parseGeminiTranscript', () => {
  it('maps thought parts to thinking and functionCall parts to tool, preserving order', () => {
    const turns = parseGeminiTranscript(TOOL_RESPONSE);
    expect(turns).toHaveLength(3);

    expect(turns[0].role).toBe('thinking');
    expect(turns[0].content).toContain('Paris and Tokyo');
    expect(turns[0].toolCalls).toBeUndefined();

    expect(turns[1].role).toBe('tool');
    expect(turns[1].toolCalls).toEqual([{ name: 'get_weather', args: { city: 'Paris' } }]);
    expect(turns[1].content).toBe('get_weather({"city":"Paris"})');

    expect(turns[2].role).toBe('tool');
    expect(turns[2].toolCalls).toEqual([{ name: 'get_weather', args: { city: 'Tokyo' } }]);
  });

  it('ignores thoughtSignature riding on a functionCall part', () => {
    const turns = parseGeminiTranscript(TOOL_RESPONSE);
    // The Paris call had a thoughtSignature; it must not leak into the turn.
    expect(turns[1].content).not.toContain('CqIEAQ');
    expect(JSON.stringify(turns[1].toolCalls)).not.toContain('thoughtSignature');
  });

  it('maps thinking then plain text to thinking then assistant', () => {
    const turns = parseGeminiTranscript(TEXT_RESPONSE);
    expect(turns).toHaveLength(2);
    expect(turns[0].role).toBe('thinking');
    expect(turns[1].role).toBe('assistant');
    expect(turns[1].content).toBe('Paris is the capital of France.');
  });

  it('captures functionResponse parts (multi-turn echo) as tool turns with result', () => {
    const resp = {
      candidates: [{
        content: {
          parts: [
            { functionResponse: { name: 'get_weather', response: { tempC: 18 } } },
            { text: 'Paris is 18°C.' },
          ],
        },
      }],
    };
    const turns = parseGeminiTranscript(resp);
    expect(turns).toHaveLength(2);
    expect(turns[0].role).toBe('tool');
    expect(turns[0].toolCalls[0].result).toEqual({ tempC: 18 });
    expect(turns[1].role).toBe('assistant');
  });

  it('captures unknown part kinds as system turns rather than dropping them', () => {
    const resp = {
      candidates: [{
        content: {
          parts: [
            { inlineData: { mimeType: 'image/png', data: 'AAAA' } },
            { text: 'Here is the image.' },
          ],
        },
      }],
    };
    const turns = parseGeminiTranscript(resp);
    expect(turns).toHaveLength(2);
    expect(turns[0].role).toBe('system');
    expect(turns[0].content).toContain('gemini:unknown-part');
    expect(turns[0].content).toContain('inlineData');
    expect(turns[1].role).toBe('assistant');
  });

  it('skips thoughtSignature-only / empty parts without emitting a turn', () => {
    const resp = {
      candidates: [{
        content: { parts: [{ thoughtSignature: 'abc' }, {}, { text: 'hi' }] },
      }],
    };
    const turns = parseGeminiTranscript(resp);
    expect(turns).toHaveLength(1);
    expect(turns[0].role).toBe('assistant');
    expect(turns[0].content).toBe('hi');
  });

  it('walks multiple candidates in order', () => {
    const resp = {
      candidates: [
        { content: { parts: [{ text: 'a' }] } },
        { content: { parts: [{ text: 'b' }] } },
      ],
    };
    const turns = parseGeminiTranscript(resp);
    expect(turns.map((t) => t.content)).toEqual(['a', 'b']);
  });

  it('handles a functionCall part missing args', () => {
    const resp = {
      candidates: [{ content: { parts: [{ functionCall: { name: 'ping' } }] } }],
    };
    const turns = parseGeminiTranscript(resp);
    expect(turns[0].role).toBe('tool');
    expect(turns[0].toolCalls).toEqual([{ name: 'ping', args: undefined }]);
    expect(turns[0].content).toBe('ping({})');
  });

  describe('malformed input → [] (never throws)', () => {
    it.each([
      ['null', null],
      ['undefined', undefined],
      ['string', 'not json'],
      ['number', 42],
      ['empty object', {}],
      ['no candidates array', { candidates: 'nope' }],
      ['empty candidates', { candidates: [] }],
      ['blocked (no content)', { candidates: [{ finishReason: 'SAFETY' }] }],
      ['content not object', { candidates: [{ content: 'x' }] }],
      ['parts not array', { candidates: [{ content: { parts: 'x' } }] }],
    ])('%s', (_label, input) => {
      expect(parseGeminiTranscript(input)).toEqual([]);
    });
  });
});
