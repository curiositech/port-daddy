const fs = require('fs');
const path = require('path');

const appendicesContent = fs.readFileSync('website-v2/public/whitepaper/coordination-papers-mega-appendices.tex', 'utf-8');

// Test 1: Verify bibliography input path
const bibliographyPath = appendicesContent.match(/\input{(.+?)}/')[1];
const expectedPath = '../../../.cache/whitepaper-build/coordination-papers-mega-volume/mega-volume-bibliography.tex';

if (bibliographyPath !== expectedPath) {
  console.error(`Bibliography path mismatch: got ${bibliographyPath}, expected ${expectedPath}`);
  process.exit(1);
}

// Test 2: Verify references section has correct content
const referencesSection = appendicesContent.match(/\section{References}.*?\end{tabularx}/s)[0];
if (!referencesSection.includes('\addcontentsline{toc}{section}{References}')) {
  console.error("References section missing toc entry");
  process.exit(1);
}

console.log("References section tests passed");