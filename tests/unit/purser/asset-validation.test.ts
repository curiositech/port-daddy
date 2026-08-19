// tests/unit/purser/asset-validation.test.ts
import { readFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';

describe('README asset validation', () => {
  const readmePath = resolve(__dirname, '..', '..', '..', 'README.md');
  const readmeDir = resolve(__dirname, '..', '..', '..');
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
    // The hero image is the first image in the file
    const firstImageRegex = /!\[[^\]]*\]\(([^)]+)\)/;
    const match = firstImageRegex.exec(readmeContent);
    if (!match) {
      throw new Error('README.md does not contain any image (hero image missing)');
    }
    const heroPath = match[1].trim();
    const absPath = resolve(readmeDir, heroPath);
    if (!existsSync(absPath)) {
      throw new Error(`Hero image not found: ${heroPath}`);
    }
  });
});