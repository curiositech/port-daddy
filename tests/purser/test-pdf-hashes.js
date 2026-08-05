const fs = require('fs');
const crypto = require('crypto');

const expectedHashes = {
  'harbor-economy-whitepaper.pdf': '940074e1dd6114a672813cc5085857a313f4cc43cb264af2f196db46d46dbce2',
  'legible-swarm-whitepaper.pdf': 'dc20d28fa9158910b89efc3c43353c8e6eb47bb14151545c6ac7682657f8a5c0'
};

for (const [file, expectedHash] of Object.entries(expectedHashes)) {
  const filePath = `website-v2/public/whitepaper/${file}`;
  const fileData = fs.readFileSync(filePath);
  const hash = crypto.createHash('sha256').update(fileData).digest('hex');
  if (hash !== expectedHash) {
    throw new Error(`SHA-256 mismatch for ${file}: expected ${expectedHash}, got ${hash}`);
  }
}
console.log('All PDF hashes verified');