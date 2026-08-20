import { describe, expect, it } from '@jest/globals';
import { extractAiText } from '../../../apps/fleet-executor/src/ai-response.js';

describe('reasoning-only response classification', () => {
  it('labels a truncated think block as reasoning-only, never as review text', () => {
    expect(extractAiText({
      choices: [{
        message: {
          content: '',
          reasoning_content: '<think>maybe FLEET-VERDICT: BLOCK applies',
        },
      }],
    })).toEqual({ text: '', shape: 'reasoning-only' });
  });

  it('labels a completed think block with no answer as reasoning-only', () => {
    expect(extractAiText({
      choices: [{
        message: {
          content: '',
          reasoning_content: '<think>internal deliberation only</think>',
        },
      }],
    })).toEqual({ text: '', shape: 'reasoning-only' });
  });

  it('returns the answer after reasoning and removes verdict-like deliberation', () => {
    const result = extractAiText({
      choices: [{
        message: {
          content: '',
          reasoning_content:
            '<think>should this be FLEET-VERDICT: BLOCK? no</think>FLEET-VERDICT: PASS',
        },
      }],
    });
    expect(result).toEqual({
      text: 'FLEET-VERDICT: PASS',
      shape: 'chat-completions-reasoning',
    });
    expect(result.text).not.toContain('BLOCK');
  });

  it('keeps empty reasoning distinct from reasoning that stripped to empty', () => {
    expect(extractAiText({
      choices: [{ message: { content: '', reasoning_content: '' } }],
    })).toEqual({ text: '', shape: 'unknown' });
  });

  it('joins reasoning across choices before stripping nested blocks', () => {
    expect(extractAiText({
      choices: [
        { message: { content: '', reasoning_content: '<think>outer' } },
        { message: { content: '', reasoning_content: '<think>inner</think>tail</think>answer' } },
      ],
    })).toEqual({
      text: 'answer',
      shape: 'chat-completions-reasoning',
    });
  });
});
