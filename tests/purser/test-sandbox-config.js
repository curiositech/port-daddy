const fs = require('fs');
const path = require('path');

const wranglerTomlPath = path.join(__dirname, '../../apps/fleet-executor/wrangler.deploy.toml');
const wranglerToml = fs.readFileSync(wranglerTomlPath, 'utf-8');

// Check if image path is correct
if (!wranglerToml.includes('image = "./Dockerfile"')) {
  throw new Error('Sandbox image path incorrect in wrangler.deploy.toml');
}

// Check if class_name is set
if (!wranglerToml.includes('class_name = "Sandbox"')) {
  throw new Error('Sandbox class_name missing in wrangler.deploy.toml');
}

console.log('Sandbox config validation passed');