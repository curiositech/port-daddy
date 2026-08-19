// tests/unit/purser/execution-block-validation.test.ts
import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import path from 'path';

describe('README readme-verify: run blocks', () => {
  /**
   * The `check-readme-accuracy.mjs` script is the canonical verifier for
   * `readme-verify: run` blocks.  It must succeed in CI with a live daemon,
   * otherwise the PR would be blocked by the `readme-accuracy-guard` job.
   */
  it('passes `readme-verify: run` against a live daemon', () => {
    const cmd = 'node scripts/check-readme-accuracy.mjs --ci --run';
    const output = execSync(cmd, { encoding: 'utf8', stdio: 'pipe' });

    // The script emits JSON; we look for a top‑level `pass: true` field.
    let json: any;
    try {
      json = JSON.parse(output.trim());
    } catch (e) {
      throw new Error(`Script output is not valid JSON:\n${output}`);
    }

    expect(json).toHaveProperty('pass', true);
    expect(json).toHaveProperty('findings');
    expect(Array.isArray(json.findings)).toBe(true);
    expect(json.findings.length).toBe(0);
  });

  /**
   * The README should not contain any known outdated verb or flag names.
   * This test guards against regressions where a user might copy an old
   * example that no longer exists in the CLI.
   */
  it('contains no deprecated commands or flags', () => {
    const readme = readFileSync('README.md', 'utf8');
    // Commonly known deprecated patterns from the PR diff:
    const deprecatedPatterns = [
      /pd\s+notez\b/, // deprecated verb
      /--sinces\b/,    // misspelled flag
      /--roadmap\s+[^"]+/i, // old flag syntax
      /--identity\s+[^"]+/i, // old flag usage
    ];

    for (const pat of deprecatedPatterns) {
      const match = pat.test(readme);
      if (match) {
        throw new Error(`README contains deprecated pattern: ${pat}`);
      }
    }
  });

  /**
   * The hero recording is a VHS‑style GIF that must exist and be a valid
   * GIF file.  The test simply verifies the file exists, is non‑empty,
   * and starts with the GIF signature.
   */
  it('has a valid VHS recording', () => {
    const gifPath = path.join('website-v2', 'public', 'gifs', 'quickstart.gif');
    expect(existsSync(gifPath)).toBe(true);

    const data = readFileSync(gifPath);
    expect(data.length).toBeGreaterThan(0);

    const header = data.slice(0, 6).toString('ascii');
    const isGif = header === 'GIF89a' || header === 'GIF87a';
    expect(isGif).toBe(true);
  });
});