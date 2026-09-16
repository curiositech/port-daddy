import fs from 'node:fs';

// Both are .tex sources. The harbor-economy entry named
// harbor-economy-whitepaper.pdf and read it as utf-8 -- a binary grep that
// could never have matched; with the per-chapter PDFs retired it could not
// even open. The chapter source is what the assertions below were written
// against, and it is what the successor test named in ROUTING.json reads.
const paperPaths = {
  'single-writer-kernel': 'whitepaper/single-writer-kernel.tex',
  'harbor-economy': 'website-v2/public/whitepaper/harbor-economy.tex'
};

const expectedContracts = {
  'single-writer-kernel': [
    'BuiltWeak substrate',
    'durable commitments',
    'oracle-bound closure',
    'neutral graded outcomes'
  ],
  'harbor-economy': [
    'outcome ledger',
    'neutral graded outcomes',
    'reputation binding'
  ]
};

describe('Implementation status contracts validation', () => {
  Object.entries(paperPaths).forEach(([name, path]) => {
    test(`Paper contains required implementation status markers for ${name}`, () => {
      const content = fs.readFileSync(path, 'utf-8');
      expectedContracts[name].forEach(marker => {
        expect(content).toContain(marker);
      });
    });
  });
});