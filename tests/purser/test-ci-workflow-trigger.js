const fs = require('fs');
const path = require('path');

const ciYmlPath = path.join(__dirname, '../../.github/workflows/ci.yml');
const ciYml = fs.readFileSync(ciYmlPath, 'utf-8');

// Check if branches filter is removed from pull_request event
if (ciYml.includes('branches: [main]')) {
  throw new Error('CI workflow still restricts pull_request to main branch');
}

// Check if workflow triggers on any pull_request
if (!ciYml.includes('on:
  pull_request:')) {
  throw new Error('CI workflow missing pull_request event trigger');
}

console.log('CI workflow trigger check passed');