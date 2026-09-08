import { describe, expect, it } from '@jest/globals';
import { extractAiText } from '../../../apps/fleet-executor/src/ai-response.js';

describe('typed chat content arrays', () => {
  it('joins string text parts and ignores malformed parts', () => {
    const response = {
      choices: [{
        message: {
          content: [
            null,
            { type: 'image', image_url: 'https://example.invalid/image.png' },
            { type: 'text', text: 42 },
            { type: 'text', text: 'first ' },
            { text: 'second' },
            { type: 'text', text: false },
          ],
        },
      }],
    };
    expect(extractAiText(response)).toEqual({
      text: 'first second',
      shape: 'chat-completions',
    });
  });

  it('strips a think block split across separate content parts', () => {
    const response = {
      choices: [{
        message: {
          content: [
            { type: 'text', text: '<think>consider ' },
            { type: 'text', text: 'BLOCK?</think>' },
            { type: 'text', text: 'FLEET-VERDICT: PASS' },
          ],
        },
      }],
    };
    expect(extractAiText(response)).toEqual({
      text: 'FLEET-VERDICT: PASS',
      shape: 'chat-completions',
    });
  });

  it('falls through from an unreadable array to completion text', () => {
    const response = {
      choices: [{
        text: 'completion fallback',
        message: {
          content: [{ type: 'text', text: null }, { type: 'image' }],
          reasoning_content: 'reasoning fallback',
        },
      }],
    };
    expect(extractAiText(response)).toEqual({
      text: 'completion fallback',
      shape: 'text-completions',
    });
  });

  it('does not confuse an empty typed array with a usable chat answer', () => {
    expect(extractAiText({ choices: [{ message: { content: [] } }] })).toEqual({
      text: '',
      shape: 'unknown',
    });
  });
});
