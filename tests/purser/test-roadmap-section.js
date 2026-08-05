const fs = require('fs');
const path = require('path');

const appendicesContent = fs.readFileSync('website-v2/public/whitepaper/coordination-papers-mega-appendices.tex', 'utf-8');

// Test 1: Verify three roadmap categories with 7 subsections
const roadmapSections = appendicesContent.match(/\subsection{.*?}/g) || [];
const categoryCounts = {
  'Add to the papers': 0,
  'Prove or falsify': 0,
  'Try, measure, and add to the code': 0
};

roadmapSections.forEach(section => {
  if (section.includes('Add to the papers')) categoryCounts['Add to the papers']++;
  else if (section.includes('Prove or falsify')) categoryCounts['Prove or falsify']++;
  else if (section.includes('Try, measure, and add to the code')) categoryCounts['Try, measure, and add to the code']++;
});

if (Object.values(categoryCounts).some(count => count === 0)) {
  console.error(`Roadmap category missing: ${Object.keys(categoryCounts).filter(k => categoryCounts[k] === 0)}`);
  process.exit(1);
}

// Test 2: Verify total 7 subsections across all categories
if (roadmapSections.length !== 7) {
  console.error(`Roadmap subsection count mismatch: ${roadmapSections.length} found, 7 expected`);
  process.exit(1);
}

console.log("Roadmap section tests passed");