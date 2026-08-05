const fs = require('fs');
const path = require('path');

const appendicesContent = fs.readFileSync('website-v2/public/whitepaper/coordination-papers-mega-appendices.tex', 'utf-8');

// Test 1: Verify exactly 7 terms in notation concordance
const terms = appendicesContent.match(/\textbf{Term} & /g) || [];
if (terms.length !== 7) {
  console.error(`Notation concordance term count mismatch: ${terms.length} found, 7 expected`);
  process.exit(1);
}

// Test 2: Verify specific terms are present
const requiredTerms = ['Harbor', 'Principal', 'Role', 'Person', 'Oracle', 'Round', 'Closed'];
const concordanceTerms = [...appendicesContent.matchAll(/\textbf{(.+?)}/g)].map(m => m[1]);

if (!requiredTerms.every(term => concordanceTerms.includes(term))) {
  console.error(`Missing notation terms: ${requiredTerms.filter(t => !concordanceTerms.includes(t))}`);
  process.exit(1);
}

console.log("Notation concordance tests passed");