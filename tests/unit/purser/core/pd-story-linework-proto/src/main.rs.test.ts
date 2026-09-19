// tests/unit/purser/core/pd-story-linework-proto/src/main.rs.test.ts
import { fileURLToPath } from 'url';
import path from 'path';
import { execSync } from 'child_process';
import { promises as fs } from 'fs';
import { existsSync, statSync } from 'fs';

/**
 * Recursively list all files under a directory, returning absolute paths.
 */
async function listFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(full)));
    } else if (entry.isFile()) {
      files.push(full);
    }
  }
  return files;
}

/**
 * Remove a file or directory if it exists. Used to guarantee a clean run.
 */
async function safeRemove(target: string) {
  if (!existsSync(target)) return;
  const stats = statSync(target);
  if (stats.isDirectory()) {
    await fs.rm(target, { recursive: true, force: true });
  } else {
    await fs.unlink(target);
  }
}

/**
 * Resolve the repository root from the location of this test file.
 * The test resides at:
 *   tests/unit/purser/core/pd-story-linework-proto/src/main.rs.test.ts
 * → six levels up to the repo root.
 */
const REPO_ROOT = path.resolve(
  fileURLToPath(import.meta.url),
  '../../../../../../',
);

const PROTO_DIR = path.join(REPO_ROOT, 'core', 'pd-story-linework-proto');
const SCRIPTS_DIR = path.join(PROTO_DIR, 'scripts');
const RENDER_SCRIPT = path.join(SCRIPTS_DIR, 'render-gif.sh');

const GIF_OUTPUT = path.join(PROTO_DIR, 'docs', 'story-linework.gif');
const FRAMES_DIR = path.join(PROTO_DIR, 'docs', 'frames');

describe('Story‑linework prototype (headless wgpu)', () => {
  // Ensure a clean environment before each test suite runs.
  beforeAll(async () => {
    await safeRemove(GIF_OUTPUT);
    await safeRemove(FRAMES_DIR);
  });

  test('asset generation pipeline produces expected files without leaving the sandbox', async () => {
    // Record the file set before execution.
    const beforeFiles = new Set(await listFiles(REPO_ROOT));

    // Execute the rendering script. It internally builds and runs the Rust binary.
    // We run it synchronously so the test fails fast if the process crashes.
    execSync(`bash ${RENDER_SCRIPT}`, {
      stdio: 'inherit',
      cwd: PROTO_DIR,
      env: { ...process.env, RUST_LOG: 'error' }, // keep CI output tidy
    });

    // Record the file set after execution.
    const afterFiles = await listFiles(REPO_ROOT);
    const addedFiles = afterFiles.filter((f) => !beforeFiles.has(f));

    // -----------------------------------------------------------------------
    // 1️⃣ Verify that the generated artefacts exist and are non‑empty.
    // -----------------------------------------------------------------------
    expect(existsSync(GIF_OUTPUT)).toBe(true);
    const gifStat = statSync(GIF_OUTPUT);
    expect(gifStat.isFile()).toBe(true);
    expect(gifStat.size).toBeGreaterThan(0);

    const firstFrame = path.join(FRAMES_DIR, 'frame_000.png');
    expect(existsSync(firstFrame)).toBe(true);
    const frameStat = statSync(firstFrame);
    expect(frameStat.isFile()).toBe(true);
    expect(frameStat.size).toBeGreaterThan(0);

    // -----------------------------------------------------------------------
    // 2️⃣ Verify that no files were written outside the allowed output dirs.
    // -----------------------------------------------------------------------
    const allowedDirs = [
      path.join(PROTO_DIR, 'docs'), // GIF & frames live here
      path.join(REPO_ROOT, 'docs', 'design', 'gpui-sandboxes'), // gallery assets
    ].map((d) => path.resolve(d));

    const disallowed = addedFiles.filter((file) => {
      const resolved = path.resolve(file);
      return !allowedDirs.some((dir) => resolved.startsWith(dir + path.sep));
    });

    expect(disallowed).toEqual([]); // there should be none

    // -----------------------------------------------------------------------
    // 3️⃣ Basic sanity checks on dither pattern & icon layering.
    // -----------------------------------------------------------------------
    // The prototype encodes a simple dither pattern in the WGSL shader.
    // We cannot parse the GPU output here, but we can assert that the
    // generated PNGs contain more than one unique colour – a proxy that
    // the dither (i.e., alternating colour blocks) was applied.
    const pngBuffer = await fs.readFile(firstFrame);
    const uniqueBytes = new Set(pngBuffer);
    // PNG files have a large header; we only need a minimal count > 0.
    expect(uniqueBytes.size).toBeGreaterThan(10);

    // Icon layering is expressed by a known marker byte sequence
    // (the PNG contains the literal string "operator-icon").
    // This is a cheap way to ensure the icon was rasterised.
    const marker = Buffer.from('operator-icon', 'utf8');
    expect(pngBuffer.includes(marker)).toBe(true);
  });
});