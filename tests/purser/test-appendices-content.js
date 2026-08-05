const fs = require('fs');
const path = require('path');

const APPENDICES_PATH = 'website-v2/public/whitepaper/coordination-papers-mega-volume-appendices.tex';
const REQUIRED_SECTIONS = [
  'Implementation and assurance ledger',
  'Research and engineering roadmap',
  'Notation and cross-chapter concordance',
  'References'
];

try {
  const content = fs.readFileSync(APPENDICES_PATH, 'utf-8');
  for (const section of REQUIRED_SECTIONS) {
    if (!content.includes(section)) {
      throw new Error(`Missing appendix section: ${section}`);
    }
  }
  console.log('Appendices content test passed');
  process.exit(0);
} catch (e) {
  console.error(`Appendices test failed: ${e.message}`);
  process.exit(1);
}