const whitePapers = require('../../website-v2/src/data/whitePapers');

describe('Whitepaper metadata validation', () => {
  test('Legible Swarm metadata matches PDF', () => {
    const legible = whitePapers.find(p => p.id === 'legible-swarm');
    expect(legible.pages).toBe(40);
    expect(legible.status).toBe('Version 1.2 (collected-volume edition)');
  });

  test('Single-Writer Kernel metadata matches PDF', () => {
    const swk = whitePapers.find(p => p.id === 'single-writer-kernel');
    expect(swk.pages).toBe(35);
    expect(swk.status).toBe('Version 1.2 (collected-volume edition)');
  });

  test('No undefined references in metadata', () => {
    expect(whitePapers).not.toContainEqual(expect.objectContaining({ id: expect.stringMatching(/missing-.*$/)}));
  });
});