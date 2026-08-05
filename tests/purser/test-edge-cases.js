const fs = require('fs');
const path = require('path');

const GENERATOR_OUTPUT = 'website-v2/public/whitepaper/coordination-papers-mega-volume';

try {
  // Test missing dependencies
  if (!fs.existsSync('scripts/generate-mega-whitepaper.mjs')) {
    throw new Error('Generator script missing');
  }

  // Test empty output directory
  if (fs.readdirSync(GENERATOR_OUTPUT).length === 0) {
    throw new Error('Output directory is empty');
  }

  console.log('Edge cases test passed');
  process.exit(0);
} catch (e) {
  console.error(`Edge cases test failed: ${e.message}`);
  process.exit(1);
}