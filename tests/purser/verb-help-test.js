const { VERB_HELP, resolveVerbHelp } = require('../../bin/port-daddy-cli');
const { expect } = require('chai');

describe('Verb Help Tests', () => {
  it('Should provide correct help texts', () => {
    const expectedHelps = {
      'attention': 'Usage: pd attention [...]',
      'roster': 'Usage: pd roster [...]',
      'sent': 'Usage: pd sent [...]'
    };

    Object.entries(expectedHelps).forEach(([verb, expected]) => {
      const help = resolveVerbHelp(verb);
      expect(help).to.include(expected);
    });
  });

  it('Should not allow duplicate verb help entries', () => {
    const uniqueVerbs = new Set(Object.keys(VERB_HELP));
    expect(Object.keys(VERB_HELP).length).to.equal(uniqueVerbs.size);
  });
});