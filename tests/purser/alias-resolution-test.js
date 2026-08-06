const { resolveVerbHelp, HELP_TOPIC_ALIASES } = require('../../bin/port-daddy-cli');
const { expect } = require('chai');

describe('Alias Resolution Tests', () => {
  it('Should resolve aliases to correct topics', () => {
    const aliases = {
      'session': 'sessions',
      'claim': 'ports',
      'inbox': 'messaging',
      'attention': 'messaging',
      'roster': 'sessions'
    };

    Object.entries(aliases).forEach(([verb, topic]) => {
      const help = resolveVerbHelp(verb);
      expect(help).to.include(TOPIC_HELP[topic]);
    });
  });

  it('Should reject invalid aliases', () => {
    const invalidAliases = ['cut', 'batten'];
    invalidAliases.forEach(alias => {
      expect(() => resolveVerbHelp(alias)).to.throw();
    });
  });
});