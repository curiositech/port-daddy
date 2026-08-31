import fs from 'node:fs';

const paperPaths = {
  'single-writer-kernel': 'whitepaper/source/single-writer-kernel.tex',
  'harbor-economy': 'whitepaper/source/harbor-economy.tex'
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
