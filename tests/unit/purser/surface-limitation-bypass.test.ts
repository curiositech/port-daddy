// tests/unit/purser/surface-limitation-bypass.test.ts
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// repository root (tests/unit/purser/../.. -> repo root)
const REPO_ROOT = path.resolve(__dirname, '../../../');

const OPENAPI_PATH = path.join(REPO_ROOT, 'docs', 'openapi.yaml');
const README_PATH = path.join(REPO_ROOT, 'README.md');

// The four recovery endpoints that must be fail‑closed
const RECOVERY_ENDPOINTS = [
  '/editor/recovery/request',
  '/editor/recovery/prepare',
  '/editor/recovery/replay',
  '/editor/recovery/finalize',
] as const;

/**
 * Helper: extracts the yaml block for a given path from the raw openapi file.
 * Returns the raw text of the block (including the path line) or null if not found.
 */
function extractPathBlock(openapi: string, pathKey: string): string | null {
  // Simple line‑based extraction: find the line that starts with the pathKey followed by ':'
  const lines = openapi.split(/\r?\n/);
  const startIdx = lines.findIndex((l) => l.trim().startsWith(`${pathKey}:`));
  if (startIdx === -1) return null;

  // Capture until we hit another top‑level key (no indentation) or end of file
  const blockLines: string[] = [];
  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i];
    // A new top‑level key has zero indentation and ends with ':' (e.g. /other/path:)
    if (i !== startIdx && /^\S/.test(line) && line.trim().endsWith(':')) break;
    blockLines.push(line);
  }
  return blockLines.join('\n');
}

/**
 * Checks that a recovery path block contains the required fail‑closed markers.
 */
function assertFailClosedBlock(block: string, endpoint: string) {
  // 1. The block must mention that it is unimplemented / scaffolding
  const unimplementedPhrases = [
    /unimplemented/i,
    /scaffolding/i,
    /not functional/i,
    /placeholder/i,
  ];
  const hasUnimplemented = unimplementedPhrases.some((re) => re.test(block));
  expect(hasUnimplemented).toBe(
    true,
    `OpenAPI definition for '${endpoint}' should contain language indicating it is unimplemented scaffolding (e.g. "unimplemented", "scaffolding")`,
  );

  // 2. Must expose a 503 response with the correct detail identifier
  const serviceUnavailableRe = new RegExp(
    `503\\s*:\\s*\\n[\\s\\S]*?description\\s*:\\s*["']?Service\\s+Unavailable["']?`,
    'i',
  );
  expect(serviceUnavailableRe.test(block)).toBe(
    true,
    `OpenAPI definition for '${endpoint}' must define a 503 Service Unavailable response`,
  );

  const detailRe = /editor-recovery-authority-unavailable/i;
  expect(detailRe.test(block)).toBe(
    true,
    `OpenAPI definition for '${endpoint}' should mention the detail 'editor-recovery-authority-unavailable'`,
  );

  // 3. Must NOT define any successful (200‑series) responses
  const successRe = /\b2\d{2}\b\s*:/;
  expect(successRe.test(block)).toBe(
    false,
    `OpenAPI definition for '${endpoint}' must not expose any 2xx responses`,
  );
}

/**
 * Checks that README does not make any false functional claims about recovery.
 */
function assertReadmeHasNoFalseClaims(readme: string) {
  // Phrases that would constitute a functional claim
  const falseClaimPatterns = [
    /recovery\s+functionality/i,
    /recovery\s+endpoint\s+is\s+available/i,
    /recovery\s+routes?\s+are\s+implemented/i,
    /recovery\s+authority\s+is\s+operational/i,
    /recovery\s+process\s+works/i,
  ];

  const offending = falseClaimPatterns.filter((re) => re.test(readme));
  expect(offending.length).toBe(
    0,
    `README contains statements that suggest recovery functionality is available: ${offending
      .map((r) => r.source)
      .join(', ')}`,
  );
}

/* -------------------------------------------------------------------------- */
/*                               Test Suite                                   */
/* -------------------------------------------------------------------------- */

describe('Recovery authority fail‑closed documentation contract', () => {
  let openapiContent: string;
  let readmeContent: string;

  beforeAll(async () => {
    [openapiContent, readmeContent] = await Promise.all([
      readFile(OPENAPI_PATH, 'utf8'),
      readFile(README_PATH, 'utf8'),
    ]);
  });

  test('OpenAPI must describe recovery routes as unimplemented scaffolding with 503', () => {
    for (const endpoint of RECOVERY_ENDPOINTS) {
      const block = extractPathBlock(openapiContent, endpoint);
      expect(block).not.toBeNull();
      assertFailClosedBlock(block as string, endpoint);
    }
  });

  test('README must not claim functional recovery capabilities', () => {
    assertReadmeHasNoFalseClaims(readmeContent);
  });
});