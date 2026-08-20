const fs = require('fs');
const path = require('path');

const figurePath = 'whitepaper/figures/fig-swk-continuity-organs.tex';
const expectedFigureContent = [
  'partial',
  'witnessed-outcome ledger',
  'durable commitments',
  'oracle-bound closure',
  'neutral graded outcomes'
];

describe('Whitepaper figure content validation', () => {
  test('Figure reflects correct implementation status', () => {
    const content = fs.readFileSync(path.resolve(__dirname, '../../', figurePath), 'utf-8');
    expectedFigureContent.forEach(term => {
      expect(content).toContain(term);
    });
  });

  test('Figure does not contain outdated status markers', () => {
    const content = fs.readFileSync(path.resolve(__dirname, '../../', figurePath), 'utf-8');
    expect(content).not.toContain('specified');
    expect(content).not.toContain('Designed');
  });
});