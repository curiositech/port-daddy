import fs from 'node:fs';
import path from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));

// The Book's build log. This used to name legible-swarm-whitepaper.pdf.log,
// at a path no build ever wrote to; with the per-chapter PDFs retired, the
// only log there is is the one scripts/build-whitepapers.sh leaves under
// .cache/whitepaper-build/ after compiling the Book. Still quarantined --
// the log is not committed -- but reachable now: build the Book, then run it.
const logPath = '.cache/whitepaper-build/coordination-papers-mega-volume/coordination-papers-mega-volume.log';

describe('Undefined references check', () => {
  test('No undefined references in final PDF logs', () => {
    const content = fs.readFileSync(path.resolve(__dirname, '../../', logPath), 'utf-8');
    expect(content).not.toMatch(/undefined reference/);
    expect(content).not.toMatch(/missing citation/);
    expect(content).not.toMatch(/overfull box/);
  });
});