import { describe, expect, it } from '@jest/globals';
import { stripThinkTags } from '../../../apps/fleet-executor/src/ai-response.js';

describe('stripThinkTags adversarial cases', () => {
  it('removes multiple complete blocks while preserving the answer between them', () => {
    expect(stripThinkTags(
      '<think>first</think>real <think>second</think>answer',
    )).toBe('real answer');
  });

  it('unwinds deeply nested blocks to a fixpoint', () => {
    expect(stripThinkTags(
      '<think>a<think>b<think>BLOCK</think>c</think>d</think>FLEET-VERDICT: PASS',
    )).toBe('FLEET-VERDICT: PASS');
  });

  it('drops orphan closers but preserves text on both sides', () => {
    expect(stripThinkTags('prefix</think>suffix')).toBe('prefixsuffix');
  });

  it('truncates at an unclosed opener because the remainder is unfinished reasoning', () => {
    expect(stripThinkTags('answer before <think>unfinished BLOCK reasoning'))
      .toBe('answer before');
  });

  it('returns empty for complete or incomplete reasoning with no answer', () => {
    expect(stripThinkTags('<think>complete reasoning</think>')).toBe('');
    expect(stripThinkTags('<think>incomplete reasoning')).toBe('');
  });

  it('preserves ordinary angle-bracket content and trims only the boundary', () => {
    expect(stripThinkTags('  <thinking>not a think tag</thinking>  '))
      .toBe('<thinking>not a think tag</thinking>');
  });
});
