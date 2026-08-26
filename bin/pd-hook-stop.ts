// Minimal implementation of the pd-hook-stop binary used by unit tests.
// This placeholder respects the Stop tentacle contract for test purposes.

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

// Simple protocol: read JSON payload from stdin, write a status file, exit 0.
function main() {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => (input += chunk));
  process.stdin.on('end', () => {
    try {
      const payload = JSON.parse(input || '{}');
      // Echo back a minimal response indicating the hook was processed.
      const response = { status: 'processed', hook: 'Stop', payload };
      const outPath = resolve(process.env.PD_SQUID_TENTACLES_END || '/tmp/pd-hook-stop-output.json');
      writeFileSync(outPath, JSON.stringify(response));
      process.exit(0);
    } catch (e) {
      console.error('pd-hook-stop error:', e);
      process.exit(1);
    }
  });
}

if (require.main === module) {
  main();
}
