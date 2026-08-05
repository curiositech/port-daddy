const fs = require('fs');
const crypto = require('crypto');

const expectedHashes = {
  'companion-paper-figure-repairs.jpg': 'c1a0587e40b0df4fef63a0aa4cf738a6a97f313f4449ad1c61de42068c7bfc65',
  'companion-paper-figure-tour.gif': 'b46f6a8462fd2df69155d244896245346df8d62b9d79c64328a96643dc2bcb28'
};

for (const [file, expectedHash] of Object.entries(expectedHashes)) {
  const filePath = `docs/pr-assets/${file}`;
  const fileData = fs.readFileSync(filePath);
  const hash = crypto.createHash('sha256').update(fileData).digest('hex');
  if (hash !== expectedHash) {
    throw new Error(`SHA-256 mismatch for ${file}: expected ${expectedHash}, got ${hash}`);
  }
}
console.log('All visual assets verified');