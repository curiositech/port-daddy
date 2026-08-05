const fs = require('fs');
const path = require('path');

const whitePapersPath = 'website-v2/src/data/whitePapers.ts';
const content = fs.readFileSync(whitePapersPath, 'utf-8');

const expectedStatuses = {
  'harbor-economy': 'Version 1.3 (collected-volume edition)',
  'legible-swarm': 'Version 1.2 (collected-volume edition)'
};

for (const [paper, status] of Object.entries(expectedStatuses)) {
  if (!content.includes(`status: '${status}'`)) {
    throw new Error(`Missing expected status for ${paper}: ${status}`);
  }
}
console.log('WhitePapers.ts status checks passed');