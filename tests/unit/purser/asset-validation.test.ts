/**
 * Purser contract for #7504, obligation 2 — every image and relative link in
 * README.md resolves on disk, and the hero image (the first image in the
 * file) exists.
 *
 * REPAIRED IN PLACE (argue-with-the-test protocol): the authored assertions
 * were close to sound; two defects are repaired, all obligations kept:
 *
 *   1. FAILED TO LOAD. `__dirname` does not exist in this repo's test
 *      runtime (jest runs .ts tests as ESM — `"type": "module"` +
 *      extensionsToTreatAsEsm — so the suite crashed with `ReferenceError:
 *      __dirname is not defined`). Repaired with the same
 *      `dirname(fileURLToPath(import.meta.url))` pattern every other unit
 *      test in this repo uses.
 *   2. REMOTE IMAGES TREATED AS DISK PATHS. The draft's link check skipped
 *      absolute URLs but its IMAGE checks did not — so the shields.io
 *      badges (`![npm](https://img.shields.io/...)`) "failed to resolve on
 *      disk", and the "hero image" (defined as the FIRST image) resolved to
 *      the npm badge rather than the recording. Obligation 2 is about
 *      assets that must exist IN THE REPO — the same scope as the accuracy
 *      gate's own image check. Images with absolute URLs are now skipped,
 *      and the hero is the first ON-DISK image, which is the quickstart
 *      recording (whose GIF validity is asserted in
 *      execution-block-validation.test.ts).
 */
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));

describe('README asset validation', () => {
  const readmePath = resolve(here, '..', '..', '..', 'README.md');
  const readmeDir = resolve(here, '..', '..', '..');
  const readmeContent = readFileSync(readmePath, 'utf8');

  // Helper to report missing assets
  function failIfMissing(missing: string[]) {
    if (missing.length > 0) {
      const msg = [
        `Missing assets in README.md: ${missing.length} item(s) not found.`,
        ...missing.map((x) => `  • ${x}`),
      ].join('\n');
      throw new Error(msg);
    }
  }

  test('all image links resolve on disk', () => {
    const imageRegex = /!\[[^\]]*\]\(([^)]+)\)/g;
    const missingImages: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = imageRegex.exec(readmeContent)) !== null) {
      const src = match[1].trim();
      // Remote images (badges) are not on-disk assets; skip them.
      if (/^(https?:)?\/\//i.test(src) || /^data:/i.test(src)) continue;
      // Resolve relative to README directory
      const absPath = resolve(readmeDir, src);
      if (!existsSync(absPath)) {
        missingImages.push(src);
      }
    }
    failIfMissing(missingImages);
  });

  test('all relative markdown links resolve on disk', () => {
    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    const missingLinks: string[] = [];
    const imageTargets = new Set<string>();
    // Collect image targets to skip them in link checks
    const imgRegex = /!\[[^\]]*\]\(([^)]+)\)/g;
    let imgMatch: RegExpExecArray | null;
    while ((imgMatch = imgRegex.exec(readmeContent)) !== null) {
      imageTargets.add(imgMatch[1].trim());
    }

    let match: RegExpExecArray | null;
    while ((match = linkRegex.exec(readmeContent)) !== null) {
      const target = match[2].trim();

      // Skip image links (already checked)
      if (imageTargets.has(target)) continue;

      // Skip absolute URLs and anchors
      if (
        /^https?:\/\//i.test(target) ||
        /^mailto:/i.test(target) ||
        /^ftp:\/\//i.test(target) ||
        /^#/.test(target)
      )
        continue;

      // Resolve relative links
      const absPath = resolve(readmeDir, target);
      if (!existsSync(absPath)) {
        missingLinks.push(target);
      }
    }
    failIfMissing(missingLinks);
  });

  test('hero image path exists and is the correct file', () => {
    // The hero is the first ON-DISK image in the file — remote badge images
    // (shields.io) precede it and are not the hero.
    const imageRegex = /!\[[^\]]*\]\(([^)]+)\)/g;
    let heroPath: string | null = null;
    let match: RegExpExecArray | null;
    while ((match = imageRegex.exec(readmeContent)) !== null) {
      const src = match[1].trim();
      if (/^(https?:)?\/\//i.test(src) || /^data:/i.test(src)) continue;
      heroPath = src;
      break;
    }
    if (!heroPath) {
      throw new Error('README.md does not contain any on-disk image (hero image missing)');
    }
    const absPath = resolve(readmeDir, heroPath);
    if (!existsSync(absPath)) {
      throw new Error(`Hero image not found: ${heroPath}`);
    }
  });
});
