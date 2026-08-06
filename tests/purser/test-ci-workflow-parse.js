const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const ciYmlPath = path.join(__dirname, '../../.github/workflows/ci.yml');
const ciYml = fs.readFileSync(ciYmlPath, 'utf-8');

try {
  yaml.safeLoad(ciYml);
  console.log('CI workflow YAML parsed successfully');
} catch (e) {
  throw new Error(`CI workflow YAML parsing failed: ${e.message}`);
}