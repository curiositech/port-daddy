const fs = require('fs');
const path = require('path');

const wranglerTomlPath = path.join(__dirname, '../../apps/fleet-executor/wrangler.deploy.toml');
const wranglerToml = fs.readFileSync(wranglerTomlPath, 'utf-8');

// Check if comment reflects live status
if (!wranglerToml.includes('# Cloudflare Sandboxes (Containers) for the purser ship — LIVE since #4612')) {
  throw new Error('Stale comment in wrangler.deploy.toml');
}

// Check if sandbox configuration block exists
if (!wranglerToml.includes('[[containers]]')) {
  throw new Error('Sandbox configuration block missing in wrangler.deploy.toml');
}

console.log('Wrangler comment and config check passed');