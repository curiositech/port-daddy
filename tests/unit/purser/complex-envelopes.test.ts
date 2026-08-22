import { describe, expect, it } from '@jest/globals';
import {
  describeResponseShape,
  extractAiText,
} from '../../../apps/fleet-executor/src/ai-response.js';

describe('AI response envelope precedence', () => {
  it('uses the first non-empty supported envelope in documented order', () => {
    expect(extractAiText({
      response: '<think>discard response reasoning</think>response answer',
      output_text: 'output answer',
      choices: [{ message: { content: 'chat answer' } }],
    })).toEqual({ text: 'response answer', shape: 'response' });

    expect(extractAiText({
      response: '<think>unfinished response reasoning',
      output_text: 'output answer',
      choices: [{ message: { content: 'chat answer' } }],
    })).toEqual({ text: 'output answer', shape: 'output_text' });
  });

  it('prefers answer content, then completion text, then reasoning', () => {
    const allPresent = {
      choices: [{
        text: 'completion answer',
        message: {
          content: '<think>content reasoning</think>content answer',
          reasoning_content: 'reasoning answer',
        },
      }],
    };
    expect(extractAiText(allPresent)).toEqual({
      text: 'content answer',
      shape: 'chat-completions',
    });

    const noContent = {
      choices: [{
        text: '<think>completion reasoning</think>completion answer',
        message: { content: '', reasoning_content: 'reasoning answer' },
      }],
    };
    expect(extractAiText(noContent)).toEqual({
      text: 'completion answer',
      shape: 'text-completions',
    });
  });

  it('joins usable choices without stringifying malformed entries', () => {
    const response = {
      choices: [
        null,
        { message: { content: 42, reasoning_content: false } },
        { message: { content: 'first ' } },
        { message: { content: 'second' } },
      ],
    };
    expect(extractAiText(response)).toEqual({
      text: 'first second',
      shape: 'chat-completions',
    });
  });

  it('reports reasoning evidence without exposing its contents', () => {
    const description = describeResponseShape({
      request_id: 'req-1',
      choices: [{ message: { content: '', reasoning_content: 'private thought' } }],
    });
    expect(description).toContain('keys=[request_id,choices]');
    expect(description).toContain('choices.len=1');
    expect(description).toContain('reasoning.len=15');
    expect(description).not.toContain('private thought');
  });
});
