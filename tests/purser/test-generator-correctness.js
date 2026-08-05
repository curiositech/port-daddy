const fs = require('fs');
const path = require('path');

const GENERATOR_OUTPUT = 'website-v2/public/whitepaper/coordination-papers-mega-volume';
const EXPECTED_CHAPTERS = 7;
const EXPECTED_REFERENCES = 202;

try {
  // Check chapter generation
  const chapters = fs.readdirSync(GENERATOR_OUTPUT).filter(f => f.startsWith('chapter-') && f.endsWith('.tex'));
  if (chapters.length !== EXPECTED_CHAPTERS) {
    throw new Error(`Expected ${EXPECTED_CHAPTERS} chapters, found ${chapters.length}`);
  }

  // Check reference count
  const bibContent = fs.readFileSync(`${GENERATOR_OUTPUT}/mega-volume-bibliography.tex`, 'utf-8');
  const referenceCount = (bibContent.match(/\bibitem{/g) || []).length;
  if (referenceCount !== EXPECTED_REFERENCES) {
    throw new Error(`Expected ${EXPECTED_REFERENCES} references, found ${referenceCount}`);
  }

  console.log('Generator correctness test passed');
  process.exit(0);
} catch (e) {
  console.error(`Generator test failed: ${e.message}`);
  process.exit(1);
}