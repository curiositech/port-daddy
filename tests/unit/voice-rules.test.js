/**
 * Unit tests for scripts/check-voice-rules.ts.
 *
 * Runs the script via `npx tsx` against fixture files in a temp directory.
 * Verifies (a) true positives, (b) override behavior, (c) clean files, (d) regression
 * test that the actual byline drift the script was built to catch is now absent.
 */

import { execFileSync } from 'child_process';
import { writeFileSync, mkdtempSync, mkdirSync, rmSync, readFileSync, existsSync, symlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, '..', '..');
const SCRIPT = join(REPO_ROOT, 'scripts', 'check-voice-rules.ts');

function runChecker(cwd, scriptOverride) {
  // The script uses `import.meta.dirname/..` to resolve repo root, so we exec the
  // copy that lives inside the fixture (scripts/check-voice-rules.ts under cwd).
  const script = scriptOverride ?? join(cwd, 'scripts', 'check-voice-rules.ts');
  try {
    const out = execFileSync('npx', ['tsx', script], {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { exit: 0, stdout: out, stderr: '' };
  } catch (e) {
    return {
      exit: e.status ?? 1,
      stdout: e.stdout?.toString() ?? '',
      stderr: e.stderr?.toString() ?? '',
    };
  }
}

function setupFixture(files) {
  const dir = mkdtempSync(join(tmpdir(), 'voice-rules-test-'));
  // Minimal .voice-rules.yml in the fixture root.
  const yml = `forbidden_phrases:
  - phrase: "Port Daddy Engineering Team"
    reason: "single-person operation"
  - phrase: "FORBIDDEN_TEST_PHRASE"
    reason: "test fixture"
scan_paths:
  - "docs/"
scan_extensions:
  - ".md"
  - ".tex"
exclude_paths:
  - ".voice-rules.yml"
`;
  writeFileSync(join(dir, '.voice-rules.yml'), yml);
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  // Copy the real script in so import.meta.dirname/.. resolves to the fixture root.
  const realScript = readFileSync(SCRIPT, 'utf-8');
  writeFileSync(join(dir, 'scripts', 'check-voice-rules.ts'), realScript);
  // Symlink node_modules from the repo so the script can resolve its `yaml` import.
  symlinkSync(join(REPO_ROOT, 'node_modules'), join(dir, 'node_modules'), 'dir');
  for (const [path, content] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
}

describe('check-voice-rules.ts', () => {
  test('clean file → exit 0', () => {
    const dir = setupFixture({ 'docs/clean.md': '# Clean content\n\nNothing forbidden here.\n' });
    const r = runChecker(dir);
    cleanup(dir);
    expect(r.exit).toBe(0);
    expect(r.stdout).toContain('No forbidden phrases found');
  });

  test('forbidden phrase, no override → exit 1', () => {
    const dir = setupFixture({
      'docs/drift.md': '**Authors:** The Port Daddy Engineering Team\n\nBody.\n',
    });
    const r = runChecker(dir);
    cleanup(dir);
    expect(r.exit).toBe(1);
    expect(r.stdout).toContain('Port Daddy Engineering Team');
    expect(r.stdout).toContain('drift.md');
  });

  test('forbidden phrase with inline override on same line → exit 0', () => {
    const dir = setupFixture({
      'docs/quoted.md': 'Old byline said "Port Daddy Engineering Team" historically. <!-- voice-rule:ok reason=historical-quote -->\n',
    });
    const r = runChecker(dir);
    cleanup(dir);
    expect(r.exit).toBe(0);
  });

  test('forbidden phrase with override on line ABOVE → exit 0', () => {
    const dir = setupFixture({
      'docs/quoted.md': '<!-- voice-rule:ok reason=block-quote -->\n> The Port Daddy Engineering Team — quoted from PR42 archive\n',
    });
    const r = runChecker(dir);
    cleanup(dir);
    expect(r.exit).toBe(0);
  });

  test('multiple violations in same file → all reported, exit 1', () => {
    const dir = setupFixture({
      'docs/messy.md': 'Line 1: FORBIDDEN_TEST_PHRASE here.\nLine 2: also FORBIDDEN_TEST_PHRASE.\n',
    });
    const r = runChecker(dir);
    cleanup(dir);
    expect(r.exit).toBe(1);
    // Both lines reported
    expect(r.stdout).toContain('messy.md:1');
    expect(r.stdout).toContain('messy.md:2');
  });

  test('empty file → exit 0', () => {
    const dir = setupFixture({ 'docs/empty.md': '' });
    const r = runChecker(dir);
    cleanup(dir);
    expect(r.exit).toBe(0);
  });

  test('regression: byline drift the script was built to catch is FIXED in this repo', () => {
    // Run the REAL script against the REAL repo. After this PR lands, no violations.
    const r = runChecker(REPO_ROOT, SCRIPT);
    expect(r.exit).toBe(0);
    expect(r.stdout).toContain('No forbidden phrases found');
  });
});
