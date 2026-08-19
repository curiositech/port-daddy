// the complete contents of tests/unit/purser/cli-correctness.test.ts
import fs from 'fs';
import path from 'path';
import glob from 'glob';

/**
 * Parse an asciicast cast (v2 or v3 NDJSON) and return the concatenated
 * transcript of all output events.
 *
 * @param content The raw contents of a .cast file.
 * @returns The plain‑text transcript.
 */
function transcriptFromCast(content: string): string {
  const lines = content.split('\n').filter(Boolean);
  if (lines.length === 0) return '';

  // The first line is the header JSON; the rest are events.
  const header = JSON.parse(lines[0]) as Record<string, unknown>;
  const events = lines.slice(1).map(line => JSON.parse(line));

  // In v3, events are [delta, type, data], in v2 they are [timestamp, type, data].
  // We only care about events where type === 'o' (output).
  const output = events
    .filter((ev: any) => ev[1] === 'o')
    .map((ev: any) => ev[2] as string)
    .join('');

  // The header may contain a `version` field; we don't need it for the test.
  return output;
}

describe('CLI correctness – no Unknown command errors', () => {
  test('all committed casts contain no "Unknown command" in their transcript', () => {
    // Locate the cast directory relative to this test file.
    const castDir = path.join(__dirname, '../../../website-v2/public/casts');

    // Find all .cast files in the directory tree.
    const castFiles = glob.sync('**/*.cast', { cwd: castDir });

    const failures: string[] = [];

    for (const relPath of castFiles) {
      const absPath = path.join(castDir, relPath);
      const content = fs.readFileSync(absPath, 'utf8');
      const transcript = transcriptFromCast(content);

      if (/Unknown command/i.test(transcript)) {
        failures.push(relPath);
      }
    }

    if (failures.length > 0) {
      const msg = [
        'The following cast(s) contain the string "Unknown command":',
        ...failures.map(f => `  - ${f}`),
        '',
        'This indicates a regression in the CLI or the cast generation pipeline.',
      ].join('\n');
      // Fail the test with a clear diagnostic message.
      expect(failures.length).toBe(0);
    }
  });
});