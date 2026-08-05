const fs = require('fs');
const path = require('path');

const TEST_FILE = 'tests/purser/concurrency-test.lock';

try {
  // Simulate concurrent access
  if (fs.existsSync(TEST_FILE)) {
    throw new Error('Concurrency conflict detected');
  }
  fs.writeFileSync(TEST_FILE, 'locked');
  console.log('Concurrency test passed');
  process.exit(0);
} catch (e) {
  console.error(`Concurrency test failed: ${e.message}`);
  process.exit(1);
} finally {
  if (fs.existsSync(TEST_FILE)) {
    fs.unlinkSync(TEST_FILE);
  }
}