// tests/unit/purser/design-system.test.js
import { promises as fs } from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.url, '..', '..', '..');

// Files that must obey the design‑system rules
const TARGETS = {
  libraryPage: path.join(
    ROOT,
    'website-v2/src/pages/library/index.tsx',
  ),
  tableOfContents: path.join(
    ROOT,
    'website-v2/src/components/library/TableOfContents.tsx',
  ),
  // The whitepaper redirect page (if it exists) must also be checked.
  whitepaperRedirect: path.join(
    ROOT,
    'website-v2/src/pages/whitepaper/index.tsx',
  ),
};

// Which primitives each file is expected to import and actually render.
const EXPECTED = {
  libraryPage: {
    imports: [
      'LandingSection',
      'LandingSectionIntro',
      'LandingStatsStrip',
      'PanelEyebrow',
      'PanelTitle',
      'PanelBody',
      'SurfacePanel',
      'Button',
    ],
    used: [
      'LandingSection',
      'LandingSectionIntro',
      'LandingStatsStrip',
      'PanelEyebrow',
      'PanelTitle',
      'PanelBody',
      'SurfacePanel',
      'Button',
    ],
  },
  tableOfContents: {
    imports: ['SurfacePanel', 'PanelEyebrow', 'PanelTitle', 'PanelBody', 'Button'],
    used: ['SurfacePanel', 'PanelEyebrow', 'PanelTitle', 'PanelBody', 'Button'],
  },
  whitepaperRedirect: {
    imports: [], // we only care that it performs a redirect, not which primitives.
    used: [], // same as above.
  },
};

/**
 * Helper: read a file, return its text content.
 */
async function readFile(filePath) {
  return await fs.readFile(filePath, 'utf8');
}

/**
 * Helper: extract the named imports from '@/components/site/primitives'.
 * Returns an array of imported identifier strings.
 */
function getPrimitiveImports(source) {
  const match = source.match(
    /import\s*{\s*([^}]+)\s*}\s*from\s*['"]@\/components\/site\/primitives['"]/,
  );
  if (!match) return [];
  return match[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Helper: does the source contain any JSX attribute of the form
 *   className="…"
 * (i.e. a literal string – the only thing we consider a “custom style
 * declaration”). Returns true if such a literal is found.
 */
function hasLiteralClassName(source) {
  // Matches className="something" or className='something' where something is non‑empty.
  const regex = /className\s*=\s*["'][^"']+["']/;
  return regex.test(source);
}

/**
 * Helper: does the source contain a JSX element with the given name?
 * Simple string regex is sufficient for our purpose.
 */
function usesComponent(source, name) {
  const regex = new RegExp(`<\\s*${name}\\b`);
  return regex.test(source);
}

/**
 * Helper: does the whitepaper page perform a 301‑style redirect?
 * We accept either a React‑Router <Navigate replace to="/library" /> or a
 * manual window.location.replace call.
 */
function isRedirectPage(source) {
  const navigate = /<\s*Navigate[^>]*\bto\s*=\s*["']\/library["'][^>]*>/;
  const replace = /window\.location\.replace\s*\(\s*["']\/library["']\s*\)/;
  return navigate.test(source) || replace.test(source);
}

describe('Design‑system compliance', () => {
  for (const [key, filePath] of Object.entries(TARGETS)) {
    // Some projects may not ship a dedicated whitepaper redirect file; skip if missing.
    test(`${key} exists`, async () => {
      await expect(fs.access(filePath)).resolves.toBeUndefined();
    });

    test(`${key} imports required primitives`, async () => {
      const src = await readFile(filePath);
      const imported = getPrimitiveImports(src);
      const expectedImports = EXPECTED[key]?.imports ?? [];
      for (const comp of expectedImports) {
        expect(imported).toContain(
          comp,
          `${key} should import ${comp} from the primitives module`,
        );
      }
    });

    test(`${key} uses required primitives in JSX`, async () => {
      const src = await readFile(filePath);
      const required = EXPECTED[key]?.used ?? [];
      for (const comp of required) {
        expect(usesComponent(src, comp)).toBe(
          true,
          `${key} should render <${comp}>`,
        );
      }
    });

    test(`${key} contains no literal className strings`, async () => {
      const src = await readFile(filePath);
      expect(hasLiteralClassName(src)).toBe(
        false,
        `${key} must not contain hard‑coded className strings; use primitives instead`,
      );
    });
  }

  // Additional explicit test for the /whitepaper → /library redirect contract.
  test('whitepaper page performs a redirect to /library', async () => {
    const src = await readFile(TARGETS.whitepaperRedirect);
    expect(isRedirectPage(src)).toBe(
      true,
      'The whitepaper page should redirect (301‑style) to /library',
    );
  });
});