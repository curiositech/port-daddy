import { collectSemanticAliases } from '../../lib/semantic-terms.js';

describe('semantic term normalization', () => {
  test('collapses paraphrases onto one canonical term set', () => {
    const aliases = collectSemanticAliases([
      'Writing the CSS for Port Daddy website design system',
      'PortDaddy site design-system css work',
      'Styling the Port Daddy website design tokens',
    ]);

    expect(aliases).toHaveLength(1);
    expect(aliases[0].canonical).toBe('css design-system port-daddy site');
  });

  test('drops filler words and keeps stable token fingerprints', () => {
    const aliases = collectSemanticAliases([
      'Make a new task for the docs system',
    ]);

    expect(aliases[0].tokens).toEqual(['doc', 'system']);
    expect(aliases[0].fingerprint).toHaveLength(16);
  });
});
