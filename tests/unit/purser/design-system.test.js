// tests/unit/purser/design-system.test.js
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// `import.meta.url` is a `file://` URL string, not a filesystem path -- the
// original version of this file passed it straight to `path.resolve`,
// which does not decode file:// URLs and silently resolved every TARGETS
// entry against the wrong root, so every test here failed on "file not
// found" rather than on anything about the design system. Route it through
// `fileURLToPath` first, the way the rest of the repo's ESM tests do.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..', '..', '..');

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
  // NOTE: despite the variable name below, /whitepaper is NOT a redirect to
  // /library in PR #10070 -- it stays a full standalone reader page (it
  // links to /library with an ordinary <Link>, same as any other cross
  // reference). The original file asserted a 301 redirect here; that
  // assertion was false and has been removed (see redirects.test.js for the
  // fuller account). This entry is kept only to confirm the page still
  // exists at its expected path.
  whitepaperPage: path.join(
    ROOT,
    'website-v2/src/pages/whitepaper/index.tsx',
  ),
};

// Which primitives (imported from '@/components/site/primitives') each file
// is expected to import and actually render. `Button` is deliberately not
// in this list: it ships from the separate '@/components/ui/Button' module
// in both target files, not from the primitives barrel, so it gets its own
// import-source assertion below instead of being folded in here (the
// original version asserted Button was importable from primitives, which
// is not how either file actually imports it, and always failed).
const EXPECTED = {
  libraryPage: {
    primitiveImports: [
      'LandingSection',
      'LandingSectionIntro',
      'LandingStatsStrip',
      'PanelEyebrow',
      'PanelTitle',
      'PanelBody',
      'SurfacePanel',
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
    primitiveImports: ['SurfacePanel', 'PanelEyebrow', 'PanelTitle', 'PanelBody'],
    used: ['SurfacePanel', 'PanelEyebrow', 'PanelTitle', 'PanelBody', 'Button'],
  },
  whitepaperPage: {
    primitiveImports: [], // not part of this PR's design-system contract
    used: [],
  },
};

// Targets whose Button usage is expected to come from '@/components/ui/Button'.
const EXPECT_UI_BUTTON = new Set(['libraryPage', 'tableOfContents']);

/**
 * Helper: read a file, return its text content.
 */
async function readFile(filePath) {
  return fs.readFile(filePath, 'utf8');
}

/**
 * Helper: extract the named imports from the given module specifier.
 * Returns an array of imported identifier strings.
 */
function getNamedImportsFrom(source, modulePath) {
  const escaped = modulePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`import\\s*{\\s*([^}]+)\\s*}\\s*from\\s*['"]${escaped}['"]`);
  const match = source.match(re);
  if (!match) return [];
  return match[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Helper: does the source contain a JSX element with the given name?
 * Simple string regex is sufficient for our purpose.
 */
function usesComponent(source, name) {
  const regex = new RegExp(`<\\s*${name}\\b`);
  return regex.test(source);
}

describe('Design‑system compliance', () => {
  for (const [key, filePath] of Object.entries(TARGETS)) {
    test(`${key} exists`, async () => {
      await expect(fs.access(filePath)).resolves.toBeUndefined();
    });

    test(`${key} imports required primitives from @/components/site/primitives`, async () => {
      const src = await readFile(filePath);
      const imported = getNamedImportsFrom(src, '@/components/site/primitives');
      const expectedImports = EXPECTED[key]?.primitiveImports ?? [];
      for (const comp of expectedImports) {
        expect(imported).toContain(comp);
      }
    });

    if (EXPECT_UI_BUTTON.has(key)) {
      test(`${key} imports Button from @/components/ui/Button`, async () => {
        const src = await readFile(filePath);
        const imported = getNamedImportsFrom(src, '@/components/ui/Button');
        expect(imported).toContain('Button');
      });
    }

    test(`${key} uses required primitives in JSX`, async () => {
      const src = await readFile(filePath);
      const required = EXPECTED[key]?.used ?? [];
      for (const comp of required) {
        expect(usesComponent(src, comp)).toBe(true);
      }
    });

    // The original file also asserted every target contains no literal
    // `className="..."` string, on the theory that primitives replace
    // hand-written Tailwind classes entirely. That is not how this
    // codebase's design system works: every page and component that uses
    // the site primitives -- including both files above -- also carries
    // extensive literal className strings for layout and spacing
    // (`className="grid gap-[var(--space-6)] ..."` etc. throughout
    // library/index.tsx and TableOfContents.tsx). The primitives are typed
    // surfaces layered on top of Tailwind, not a replacement for it, so
    // that assertion was checking a rule the codebase does not follow and
    // always failed. It has been deleted rather than kept as a guaranteed
    // failure or a skipped stub.
  }

  // The original file also asserted, right here, that the whitepaper page
  // performs a 301-style redirect to /library. It does not: PR #10070
  // keeps /whitepaper as its own full reader page (see
  // website-v2/src/pages/whitepaper/index.tsx, which renders its own
  // header, paper switcher, and PDF viewer, and only links to /library as
  // an ordinary in-page cross-reference). That assertion was testing a
  // redirect that was never implemented and always failed; it has been
  // deleted along with the equivalent (and more detailed) false premise in
  // redirects.test.js rather than left in place.
});
