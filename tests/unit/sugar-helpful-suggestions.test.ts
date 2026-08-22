import { describe, expect, test } from '@jest/globals';
import {
  selectHelpfulPeerSuggestions,
  type HelpfulPeerSuggestion,
} from '../../cli/commands/sugar.js';

function hit(
  agentId: string,
  score: number,
  similarity = score,
  stage: HelpfulPeerSuggestion['stage'] = 'semantic',
): HelpfulPeerSuggestion {
  return { agentId, phrase: `capability for ${agentId}`, score, similarity, stage };
}

describe('pd begin helpful suggestions', () => {
  test('shows only high-confidence semantic peers, excluding the just-created agent', () => {
    const selected = selectHelpfulPeerSuggestions([
      hit('current', 1),
      hit('strong-a', 0.94),
      hit('weak', 0.79, 0.99),
      hit('strong-b', 0.88),
      hit('invalid', Number.NaN),
      hit('lexical-only', 1, 1, 'exact'),
    ], 'current');

    expect(selected.map((candidate) => candidate.agentId)).toEqual(['strong-a', 'strong-b']);
  });

  test('enforces the three-item arrival budget without adding a lexical fallback', () => {
    const selected = selectHelpfulPeerSuggestions([
      hit('a', 0.99),
      hit('b', 0.98),
      hit('c', 0.97),
      hit('d', 0.96),
    ], undefined);

    expect(selected.map((candidate) => candidate.agentId)).toEqual(['a', 'b', 'c']);
    expect(selected).toHaveLength(3);
  });
});
