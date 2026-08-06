const fs = require('fs');
const path = require('path');

const d1TranscriptPath = path.join(__dirname, '../../fleet_run_steps');
const d1Transcript = fs.readFileSync(d1TranscriptPath, 'utf-8');

// Check if sandbox-absent reports are consistent
if (!d1Transcript.includes('"SANDBOX binding absent"')) {
  throw new Error('D1 transcript missing sandbox-absent reports');
}

// Check if deploy logs show successful container application updates
if (!d1Transcript.includes('SUCCESS  Modified application fleet-executor-sandbox')) {
  throw new Error('D1 transcript missing deploy success logs');
}

console.log('D1 sandbox status validation passed');