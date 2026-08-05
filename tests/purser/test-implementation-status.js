const fs = require('fs');
const path = require('path');

const latexFiles = [
  'website-v2/public/whitepaper/harbor-economy.tex',
  'website-v2/public/whitepaper/legible-swarm.tex'
];

const expectedStatuses = {
  'outcome ledger': 'BuiltWeak',
  'local non-forgeable identity': 'BuiltWeak',
  'cross-operator attestation': 'Designed/\Vision{}'
};

for (const file of latexFiles) {
  const content = fs.readFileSync(file, 'utf-8');
  for (const [item, status] of Object.entries(expectedStatuses)) {
    if (!content.includes(`${item} & ${status}`)) {
      throw new Error(`Missing expected implementation status for ${item} in ${file}: ${status}`);
    }
  }
}
console.log('Implementation status checks passed');