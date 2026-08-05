const fs = require('fs');
const path = require('path');

const logFiles = [
  'website-v2/public/whitepaper/harbor-economy.log',
  'website-v2/public/whitepaper/legible-swarm.log'
];

for (const file of logFiles) {
  const content = fs.readFileSync(file, 'utf-8');
  if (content.includes('Overfull') || content.includes('Undefined')) {
    throw new Error(`LaTeX log contains errors: ${file}`);
  }
}
console.log('LaTeX logs verified no critical errors');