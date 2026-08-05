const fs = require('fs');
const { join } = require('path');

const requiredSubstrates = [
  'daemon-minted actor-souls',
  'bounded newcomer pool',
  'outcome ledger',
  'local non-forgeable identity'
];

const latexFiles = [
  'website-v2/public/whitepaper/harbor-economy.tex',
  'website-v2/public/whitepaper/legible-swarm.tex'
];

for (const file of latexFiles) {
  const content = fs.readFileSync(file, 'utf-8');
  for (const substr of requiredSubstrates) {
    if (!content.includes(substr)) {
      throw new Error(`Missing required substrate in ${file}: ${substr}`);
    }
  }
}
console.log('All LaTeX substrates verified');