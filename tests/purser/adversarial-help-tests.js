const { resolveVerbHelp, ALL_COMMANDS, TOPIC_HELP, HELP_TOPIC_ALIASES, VERB_HELP } = require('../../bin/port-daddy-cli');
const { expect } = require('chai');

describe('Adversarial Help Resolution Tests', () => {
  it('Should resolve topic help for covered verbs', () => {
    const coveredVerbs = ['session', 'claim', 'inbox', 'attention', 'roster'];
    coveredVerbs.forEach(verb => {
      const help = resolveVerbHelp(verb);
      expect(help).to.not.include('Get started:');
      expect(help).to.not.be.null;
    });
  });

  it('Should prioritize topic help over verb help', () => {
    const topicVerbs = ['session', 'inbox'];
    topicVerbs.forEach(verb => {
      const help = resolveVerbHelp(verb);
      expect(help).to.include(TOPIC_HELP[verb]);
    });
  });

  it('Should use verb-specific help when available', () => {
    const verbVerbs = ['attention', 'roster', 'sent'];
    verbVerbs.forEach(verb => {
      const help = resolveVerbHelp(verb);
      expect(help).to.include(VERB_HELP[verb]);
    });
  });

  it('Should fall back to global help for uncovered verbs', () => {
    const uncoveredVerbs = ['cut', 'batten', 'spawn', 'work'];
    uncoveredVerbs.forEach(verb => {
      const help = resolveVerbHelp(verb);
      expect(help).to.include('Get started:');
    });
  });

  it('Should not allow invalid topic aliases', () => {
    const invalidAliases = ['cut', 'batten'];
    invalidAliases.forEach(alias => {
      expect(() => resolveVerbHelp(alias)).to.throw();
    });
  });

  it('Should enforce coverage ratchet', () => {
    const uncovered = ALL_COMMANDS.filter(cmd => !resolveVerbHelp(cmd));
    expect(uncovered).to.deep.equal(['cut', 'batten', 'spawn', 'work']);
  });
});