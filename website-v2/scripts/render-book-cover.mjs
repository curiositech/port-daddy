/**
 * The Book's cover, as an image the site can show.
 *
 * It lands beside the PDF it comes from, not in /img/ and not in /plates/.
 * Not /img/, because the site's theme-pair guard requires every raster there
 * to have a dark twin, and a cover has none: a book is an object, and
 * inverting it would advertise a book that does not exist. Not /plates/,
 * because a plate is an image-model render with a provenance entry naming the
 * model and prompt, and this is a render of page 1 of the committed PDF --
 * filing it there would claim a provenance it does not have, which is exactly
 * what the plate-provenance guard caught.
 *
 * The cover is page 1 of the built PDF: the Swiss plate under type set in
 * LaTeX. Hand-exporting it is how a site ends up advertising a jacket the
 * Book stopped having — which is what happened with the watercolour jacket,
 * still on the home page a week after the Swiss edition became the central
 * one. So the site's copy is DERIVED from the committed PDF, and this script
 * is the derivation:
 *
 *   node scripts/render-book-cover.mjs          # write it
 *   node scripts/render-book-cover.mjs --check  # fail if it has drifted
 *
 * --check is the CI form. It re-renders into a temp file and compares bytes,
 * so a rebuilt Book whose cover changed fails here rather than shipping a
 * stale one. Needs poppler's pdftoppm, which the whitepaper-metadata job
 * already installs for pdfinfo.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, renameSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', '..');
const PDF = resolve(root, 'website-v2/public/whitepaper/coordination-papers-mega-volume.pdf');
const OUT = resolve(root, 'website-v2/public/whitepaper/book-cover.jpg');

// 110 dpi on a 7x10in trim is 770x1100: sharp at the ~420px the cover is ever
// shown at, including on a 2x display, without carrying a print-size raster.
const DPI = '110';
const QUALITY = '88';

function render(prefix) {
  execFileSync('pdftoppm', [
    '-f', '1', '-l', '1', '-r', DPI, '-jpeg', '-jpegopt', `quality=${QUALITY}`, PDF, prefix,
  ]);
  return `${prefix}-001.jpg`;
}

if (!existsSync(PDF)) {
  console.error(`missing ${PDF} — build the Book first`);
  process.exit(1);
}

const check = process.argv.includes('--check');
const dir = mkdtempSync(resolve(tmpdir(), 'bookcover-'));
try {
  const rendered = render(resolve(dir, 'cover'));
  if (check) {
    if (!existsSync(OUT)) {
      console.error('website-v2/public/whitepaper/book-cover.jpg is missing — run node scripts/render-book-cover.mjs');
      process.exit(1);
    }
    if (!readFileSync(rendered).equals(readFileSync(OUT))) {
      console.error(
        'website-v2/public/whitepaper/book-cover.jpg does not match page 1 of the committed Book —\n' +
        'the cover changed and the site is still showing the old one.\n' +
        'Run: node scripts/render-book-cover.mjs',
      );
      process.exit(1);
    }
    console.log('book cover matches page 1 of the committed Book');
  } else {
    mkdirSync(dirname(OUT), { recursive: true });
    renameSync(rendered, OUT);
    console.log(`wrote ${OUT}`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
