const { ALL_COMMANDS, resolveVerbHelp } = require('../../bin/port-daddy-cli');
const { expect } = require('chai');

describe('Coverage Ratchet Test', () => {
  it('Should not allow new uncovered verbs', () => {
    const uncovered = ALL_COMMANDS.filter(cmd => !resolveVerbHelp(cmd));
    expect(uncovered).to.deep.equal(['cut', 'batten', 'spawn', 'work']);
  });

  it('Should block coverage of verbs without proper topic', () => {
    const verbsToCover = ['cut', 'batten'];
    verbsToCover.forEach(verb => {
      expect(() => resolveVerbHelp(verb)).to.throw();
    });
  });
});