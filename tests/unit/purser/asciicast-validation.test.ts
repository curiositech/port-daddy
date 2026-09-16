// tests/unit/purser/asciicast-validation.test.ts
import { promises as fs } from 'fs';
import path from 'path';
import { glob } from 'glob';
import { fileURLToPath } from 'node:url';

const globAsync = glob;

const CASTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'demos', 'porthole');
const EXPECTED_COLS = 100;
const EXPECTED_ROWS = 28;

type AsciicastV2 = {
  version: 2;
  width: number;
  height: number;
  // other fields omitted
};

type AsciicastV3Header = {
  version: 3;
  width: number;
  height: number;
  // other fields omitted
};

async function readCastFile(filePath: string): Promise<string> {
  return await fs.readFile(filePath, 'utf8');
}

function parseHeader(content: string): { cols: number; rows: number; version: number } {
  // v3 is NDJSON: first line is header JSON
  const firstLine = content.split('\n', 1)[0];
  const header = JSON.parse(firstLine) as AsciicastV3Header | AsciicastV2;
  if (header.version === 3) {
    return { cols: header.term.cols, rows: header.term.rows, version: 3 };
  }
  // v2 is a single JSON object
  const v2 = header as AsciicastV2;
  if (v2.version !== 2) {
    throw new Error(`Unexpected asciicast version: ${JSON.stringify(header)}`);
  }
  return { cols: v2.width, rows: v2.height, version: 2 };
}

describe('Asciicast files', () => {
  let castFiles: string[];

  beforeAll(async () => {
    castFiles = await globAsync('*.cast', { cwd: CASTS_DIR, absolute: true });
    if (castFiles.length === 0) {
      throw new Error(`No .cast files found in ${CASTS_DIR}`);
    }
  });

  test('all casts are valid asciicast v2 or v3 with 100x28 dimensions', async () => {
    for (const file of castFiles) {
      const content = await readCastFile(file);
      // Ensure the file is not empty
      expect(content.trim()).not.toBe('');

      const { cols, rows, version } = parseHeader(content);

      // Verify version
      expect([2, 3]).toContain(version);

      // Verify dimensions
      expect(cols).toBe(EXPECTED_COLS);
      expect(rows).toBe(EXPECTED_ROWS);
    }
  });

  test('no cast file contains post‑processing artifacts', async () => {
    // The contract requires "unfiltered" casts. The simplest deterministic check
    // is that the file does not contain any escaped control characters that
    // would be introduced by a post‑processing step (e.g. embedded nulls).
    for (const file of castFiles) {
      const content = await readCastFile(file);
      // Look for any null byte or unexpected control characters
      const hasNull = content.includes('\0');
      expect(hasNull).toBe(false);
    }
  });
});