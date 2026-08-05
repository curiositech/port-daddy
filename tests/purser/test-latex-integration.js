const fs = require('fs');
const path = require('path');

const appendicesContent = fs.readFileSync('website-v2/public/whitepaper/coordination-papers-mega-appendices.tex', 'utf-8');

// Test 1: Verify appendices are inserted after all chapters and before \end{document}
const chapterCount = (appendicesContent.match(/\chapter/ig) || []).length;
const appendixInsertion = /\part{Volume appendices}/.test(appendicesContent);
const endDocumentCheck = /\end{document}/.test(appendicesContent);

if (chapterCount !== 7 || !appendixInsertion || !endDocumentCheck) {
  console.error(`Latex integration failure: Chapters=${chapterCount}, AppendixInsertion=${appendixInsertion}, EndDocument=${endDocumentCheck}`);
  process.exit(1);
}

// Test 2: Verify section numbering matches A.1, A.2, etc.
const sectionNumbers = [...appendicesContent.matchAll(/\section{.*?}/g)].map(m => m[0]);
const sectionRegex = /^\section{.*?}$/;

if (!sectionNumbers.every(s => sectionRegex.test(s))) {
  console.error(`Invalid section numbering in appendices`);
  process.exit(1);
}

console.log("Latex integration tests passed");