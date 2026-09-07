// the complete contents of tests/unit/purser/test_aspect_forgery_and_header_tampering.test.ts
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  mkdirSync,
  readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Generate a simple image (PNG) of the given dimensions using Pillow.
 * The image is written to `outPath`. The function throws if Pillow fails.
 */
function generatePillowImage(
  width: number,
  height: number,
  outPath: string,
): void {
  const pythonCode = `
import sys
from pathlib import Path
from PIL import Image

w = int(sys.argv[1])
h = int(sys.argv[2])
p = Path(sys.argv[3])
p.parent.mkdir(parents=True, exist_ok=True)
Image.new("RGB", (w, h), color="white").save(p)
`;
  const result = spawnSync('python', ['-c', pythonCode, `${width}`, `${height}`, outPath], {
    stdio: 'ignore',
    encoding: 'utf-8',
  });
  if (result.status !== 0) {
    throw new Error(`Pillow image generation failed (status ${result.status})`);
  }
}

/**
 * Run the repository's `check_plate_provenance.py` script against a given
 * repository‑root directory. Returns the process exit code (0 = success).
 */
function runCheckPlateProvenance(rootDir: string): number {
  const scriptPath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../../scripts/harbor-research/check_plate_provenance.py',
  );
  const result = spawnSync('python', [scriptPath, rootDir], {
    encoding: 'utf-8',
  });
  // Forward script output for debugging – Jest will capture it.
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status === null) {
    throw new Error('check_plate_provenance terminated by signal');
  }
  return result.status;
}

/**
 * Directly invoke the `read_image_size` helper from the Python module.
 * Returns an object `{ width, height }`.
 */
function readImageSizeViaPython(imagePath: string): { width: number; height: number } {
  const wrapper = `
import json, importlib.util, pathlib, sys
spec = importlib.util.spec_from_file_location(
    "mod",
    pathlib.Path("${resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../../../scripts/harbor-research/check_plate_provenance.py',
    )}").as_posix(),
)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
w, h = mod.read_image_size("${imagePath.replace(/\\/g, '\\\\')}")
print(json.dumps({"width": w, "height": h}))
`;
  const result = spawnSync('python', ['-c', wrapper], {
    encoding: 'utf-8',
  });
  if (result.status !== 0) {
    throw new Error(`read_image_size failed: ${result.stderr}`);
  }
  return JSON.parse(result.stdout);
}

/**
 * Helper to write a minimal PROVENANCE.json file.
 * The caller provides an array of entry objects.
 */
function writeProvenance(dir: string, entries: any[]): void {
  const provPath = join(dir, 'PROVENANCE.json');
  writeFileSync(provPath, JSON.stringify(entries, null, 2), 'utf8');
}

/* -------------------------------------------------------------------------- */
/*                               TEST SUITE                                   */
/* -------------------------------------------------------------------------- */

describe('check_plate_provenance – read_image_size and 2 % aspect‑ratio tolerance', () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'purser-plates-'));
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  /**
   * Build the directory layout that the production script expects:
   *
   *   <root>/website-v2/public/whitepaper/plates/swiss/
   *
   * Returns the absolute path to that `swiss` folder.
   */
  function swissPlateDir(): string {
    const dir = join(
      tempRoot,
      'website-v2',
      'public',
      'whitepaper',
      'plates',
      'swiss',
    );
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  test('read_image_size returns correct dimensions', () => {
    const imgPath = join(tempRoot, 'sample.jpg');
    generatePillowImage(200, 100, imgPath);
    const { width, height } = readImageSizeViaPython(imgPath);
    expect(width).toBe(200);
    expect(height).toBe(100);
  });

  test('passes when declared aspect matches actual ratio within 2 % tolerance', () => {
    const dir = swissPlateDir();
    const imgName = 'match.jpg';
    const imgPath = join(dir, imgName);
    // 150 × 100 → aspect = 1.5
    generatePillowImage(150, 100, imgPath);
    writeProvenance(dir, [{ filename: imgName, final_aspect: 1.5 }]);

    const exitCode = runCheckPlateProvenance(tempRoot);
    expect(exitCode).toBe(0);
  });

  test('fails when declared aspect deviates beyond the 2 % tolerance', () => {
    const dir = swissPlateDir();
    const imgName = 'off.jpg';
    const imgPath = join(dir, imgName);
    // 150 × 100 → aspect = 1.5
    generatePillowImage(150, 100, imgPath);
    // Declare a wildly different aspect (2.0) → >2 % error
    writeProvenance(dir, [{ filename: imgName, final_aspect: 2.0 }]);

    const exitCode = runCheckPlateProvenance(tempRoot);
    expect(exitCode).not.toBe(0);
  });

  test('fails when provenance references a non‑existent image file', () => {
    const dir = swissPlateDir();
    // No image is created.
    writeProvenance(dir, [{ filename: 'missing.jpg', final_aspect: 1.5 }]);

    const exitCode = runCheckPlateProvenance(tempRoot);
    expect(exitCode).not.toBe(0);
  });

  test('fails when an image exists without a provenance entry', () => {
    const dir = swissPlateDir();
    const imgName = 'lonely.jpg';
    const imgPath = join(dir, imgName);
    generatePillowImage(120, 80, imgPath);
    // Empty provenance array → the image is unaccounted for.
    writeProvenance(dir, []);

    const exitCode = runCheckPlateProvenance(tempRoot);
    expect(exitCode).not.toBe(0);
  });
});