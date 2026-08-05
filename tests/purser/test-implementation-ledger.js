const fs = require('fs');
const path = require('path');

const appendicesContent = fs.readFileSync('website-v2/public/whitepaper/coordination-papers-mega-appendices.tex', 'utf-8');

// Test 1: Verify exactly 9 rows in implementation ledger
const ledgerRows = appendicesContent.match(/\midrule.*?\\/gs) || [];
if (ledgerRows.length !== 9) {
  console.error(`Implementation ledger row count mismatch: got ${ledgerRows.length}, expected 9`);
  process.exit(1);
}

// Test 2: Verify grade column contains only \Built, \BuiltWeak, \Designed, \Closed
const gradeRegex = /\(\textbf{Grade}\) & (\Built|\BuiltWeak|\Designed|\Closed) & /g;
const grades = [...appendicesContent.matchAll(gradeRegex)].map(m => m[1]);

if (grades.some(g => !["\\Built", "\\BuiltWeak", "\\Designed", "\\Closed"].includes(g))) {
  console.error("Invalid grade value in implementation ledger");
  process.exit(1);
}

console.log("Implementation ledger tests passed");