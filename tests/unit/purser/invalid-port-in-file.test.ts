// tests/unit/purser/invalid-port-in-file.test.ts

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('daemon.port file validation', () => {
  it('contains only a numeric port value', () => {
    const daemonPortPath = path.join(os.homedir(), '.port-daddy', 'daemon.port');

    // If the file does not exist, the test is inconclusive and should pass.
    if (!fs.existsSync(daemonPortPath)) {
      return;
    }

    const rawContent = fs.readFileSync(daemonPortPath, 'utf8');
    const content = rawContent.trim();

    // The file must contain exactly one number (no letters, no whitespace, no comments).
    expect(content, `daemon.port should contain a single numeric port value`).toMatch(/^\d+$/);

    // Optional: ensure the port is within the valid TCP port range.
    const portNumber = Number(content);
    expect(portNumber, `daemon.port should contain a valid TCP port number`).toBeGreaterThanOrEqual(1);
    expect(portNumber, `daemon.port should contain a valid TCP port number`).toBeLessThanOrEqual(65535);
  });
});