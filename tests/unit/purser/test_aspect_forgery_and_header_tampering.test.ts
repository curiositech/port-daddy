// the complete contents of tests/unit/purser/test_aspect_forgery_and_header_tampering.test.ts
//
// This file was rewritten against the real
// scripts/harbor-research/check_plate_provenance.py. The version this
// replaces had three problems that kept every test in the "declared aspect"
// describe block from ever exercising real logic:
//
//   1. `runCheckPlateProvenance` invoked the script with a positional
//      argument (`[scriptPath, rootDir]`). The script's only CLI flag is
//      `--repo-root PATH` (argparse defines no positional argument at all),
//      so the process would exit 2 on "unrecognized arguments" before any
//      of its actual checks ran -- the aspect-ratio and dangling-entry
//      assertions below were never reachable from the CLI invocation.
//   2. Calling the CLI form even with the flag fixed still runs main(),
//      which also resolves every literal `plates/...` path reachable from
//      the .tex sources (Part B: check_tex_plate_paths) against
//      whitepaper/textbook.json and the two macro-bearing .tex files. None
//      of that exists in the ephemeral tempdir this file builds, so every
//      invocation would report those files missing regardless of whether
//      the provenance/aspect fixture under test was correct -- exit code 0
//      was unreachable even for a fully valid fixture. That machinery is
//      irrelevant to what this file is actually testing (aspect-ratio
//      forgery and provenance-entry integrity), so the fix calls the real
//      `check_all_provenance` module function directly instead -- the
//      Part A checker in isolation, with no textbook.json/tex dependency.
//   3. `writeProvenance` wrote a bare JSON array of `{filename, final_aspect}`
//      objects. The real schema (scripts/harbor-research/check_plate_provenance.py,
//      matching tests/harbor-research/test_check_plate_provenance.py on the
//      same branch) is a top-level object with a "plates" dict keyed by
//      plate stem, each entry requiring "prompt", model provenance (entry
//      "model"/doc "model"/entry "recovered_from"), a post-processing note
//      (entry "post"/doc "post"/entry "note"), and, when declared, an
//      aspect ratio as a "W:H" *string* (e.g. "3:2"), not a decimal number.
//      A bare array fails `isinstance(doc, dict)` immediately, so every
//      test using the old writeProvenance always hit "PROVENANCE.json does
//      not contain a JSON object" -- never the aspect-tolerance or
//      dangling-entry logic its name promised to test.
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Write a structurally valid baseline JPEG of the given declared dimensions:
 * SOI, one SOF0 segment carrying the real width and height, EOI. No entropy
 * data, no pixels.
 *
 * The unit under test is `read_image_size`, which reads the container's own
 * size fields out of the SOF0 segment and decodes nothing at all -- so a
 * header is the whole fixture, and writing one by hand is the more faithful
 * test as well as the portable one. The version this replaces shelled out to
 * Pillow, which is not installed on the CI runners: every assertion in this
 * file died on "Pillow image generation failed (status 1)" before reaching
 * the checker, on ubuntu and macos alike. The repository's own
 * tests/harbor-research/test_check_plate_provenance.py has always built its
 * fixtures this way; this is the same bytes in TypeScript.
 */
function writeImageHeader(
  width: number,
  height: number,
  outPath: string,
): void {
  mkdirSync(dirname(outPath), { recursive: true });
  const sofPayload = Buffer.alloc(15);
  sofPayload[0] = 8; // sample precision
  sofPayload.writeUInt16BE(height, 1);
  sofPayload.writeUInt16BE(width, 3);
  sofPayload[5] = 3; // three components
  Buffer.from([0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00]).copy(sofPayload, 6);
  const segmentLength = Buffer.alloc(2);
  segmentLength.writeUInt16BE(sofPayload.length + 2, 0);
  writeFileSync(outPath, Buffer.concat([
    Buffer.from([0xff, 0xd8]),        // SOI
    Buffer.from([0xff, 0xc0]),        // SOF0
    segmentLength,
    sofPayload,
    Buffer.from([0xff, 0xd9]),        // EOI
  ]));
}

const CHECKER_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../scripts/harbor-research/check_plate_provenance.py',
);

/**
 * Run the repository's real `check_all_provenance(repo_root)` function
 * (Part A of check_plate_provenance.py: PROVENANCE.json completeness,
 * dangling entries, and the 2% aspect-ratio tolerance) directly via Python,
 * the same way `readImageSizeViaPython` below calls `read_image_size`.
 * Returns the list of failure strings check_all_provenance produced (empty
 * = clean). Going through the real exported function instead of `main()`
 * avoids Part B's unrelated TeX-path resolution, which needs a whitepaper/
 * textbook.json and two macro-bearing .tex files this fixture never builds
 * and which this suite is not about.
 */
function runCheckAllProvenance(rootDir: string): string[] {
  const wrapper = `
import json, importlib.util, pathlib
spec = importlib.util.spec_from_file_location(
    "mod",
    pathlib.Path(${JSON.stringify(CHECKER_PATH)}).as_posix(),
)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
failures = mod.check_all_provenance(${JSON.stringify(rootDir)})
print(json.dumps(failures))
`;
  const result = spawnSync('python3', ['-c', wrapper], { encoding: 'utf-8' });
  if (result.status !== 0) {
    throw new Error(`check_all_provenance invocation failed: ${result.stderr}`);
  }
  return JSON.parse(result.stdout);
}

/**
 * Directly invoke the `read_image_size` helper from the Python module.
 * Returns an object `{ width, height }`.
 */
function readImageSizeViaPython(imagePath: string): { width: number; height: number } {
  const wrapper = `
import json, importlib.util, pathlib
spec = importlib.util.spec_from_file_location(
    "mod",
    pathlib.Path(${JSON.stringify(CHECKER_PATH)}).as_posix(),
)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
w, h = mod.read_image_size(${JSON.stringify(imagePath)})
print(json.dumps({"width": w, "height": h}))
`;
  const result = spawnSync('python3', ['-c', wrapper], { encoding: 'utf-8' });
  if (result.status !== 0) {
    throw new Error(`read_image_size failed: ${result.stderr}`);
  }
  return JSON.parse(result.stdout);
}

/**
 * Write a PROVENANCE.json in the real schema: a top-level object with a
 * "plates" dict keyed by plate stem. `plates` maps stem -> per-entry fields
 * (prompt/model/post/final_aspect etc.), matching what
 * scripts/harbor-research/check_plate_provenance.py actually parses.
 */
function writeProvenance(dir: string, plates: Record<string, Record<string, unknown>>): void {
  const provPath = join(dir, 'PROVENANCE.json');
  writeFileSync(provPath, JSON.stringify({ plates }, null, 2), 'utf8');
}

/* -------------------------------------------------------------------------- */
/*                               TEST SUITE                                   */
/* -------------------------------------------------------------------------- */

describe('check_plate_provenance – read_image_size and 2 % aspect‑ratio tolerance', () => {
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
   * Returns the absolute path to that `swiss` folder. "swiss" is one of
   * REQUIRED_PROVENANCE_DIRS in the real script, so a PROVENANCE.json is
   * mandatory there (unlike an arbitrary plates subdirectory).
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
    writeImageHeader(200, 100, imgPath);
    const { width, height } = readImageSizeViaPython(imgPath);
    expect(width).toBe(200);
    expect(height).toBe(100);
  });

  test('passes when declared aspect matches actual ratio within 2 % tolerance', () => {
    const dir = swissPlateDir();
    const imgName = 'match.jpg';
    const imgPath = join(dir, imgName);
    // 150 × 100 → aspect = 1.5 = 3:2
    writeImageHeader(150, 100, imgPath);
    writeProvenance(dir, {
      match: {
        prompt: 'a test plate',
        model: 'test-model',
        post: 'no post-processing',
        final_aspect: '3:2',
      },
    });

    const failures = runCheckAllProvenance(tempRoot);
    expect(failures).toEqual([]);
  });

  test('fails when declared aspect deviates beyond the 2 % tolerance', () => {
    const dir = swissPlateDir();
    const imgName = 'off.jpg';
    const imgPath = join(dir, imgName);
    // 150 × 100 → aspect = 1.5
    writeImageHeader(150, 100, imgPath);
    // Declare a wildly different aspect (2:1) → >2 % error
    writeProvenance(dir, {
      off: {
        prompt: 'a test plate',
        model: 'test-model',
        post: 'no post-processing',
        final_aspect: '2:1',
      },
    });

    const failures = runCheckAllProvenance(tempRoot);
    expect(failures.length).toBeGreaterThan(0);
    expect(failures.some((f) => f.includes('off') && f.includes('2:1'))).toBe(true);
  });

  test('fails when provenance references a non‑existent image file', () => {
    const dir = swissPlateDir();
    // check_provenance_dir bails out with "nothing to check" the moment a
    // directory has zero image files on disk -- so a dangling entry only
    // has anything to be dangling *against* once at least one real image
    // is present. Write one legitimate plate, then point its own entry's
    // "file" field at a filename that was never written.
    const imgName = 'plate.jpg';
    writeImageHeader(150, 100, join(dir, imgName));
    writeProvenance(dir, {
      plate: {
        file: 'does-not-exist.jpg',
        prompt: 'a ghost plate',
        model: 'test-model',
        post: 'no post-processing',
      },
    });

    const failures = runCheckAllProvenance(tempRoot);
    expect(failures.length).toBeGreaterThan(0);
    expect(failures.some((f) => f.includes('does-not-exist.jpg'))).toBe(true);
  });

  test('fails when an image exists without a provenance entry', () => {
    const dir = swissPlateDir();
    const imgName = 'lonely.jpg';
    const imgPath = join(dir, imgName);
    writeImageHeader(120, 80, imgPath);
    // Empty plates dict → the image is unaccounted for.
    writeProvenance(dir, {});

    const failures = runCheckAllProvenance(tempRoot);
    expect(failures.length).toBeGreaterThan(0);
    expect(failures.some((f) => f.includes('lonely.jpg') && f.includes('no provenance entry'))).toBe(true);
  });
});
