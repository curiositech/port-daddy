import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { stageBookAssets } from './stage-book-public-assets.mjs';

function fixture() {
  const parent = resolve('.cache/book-public-assets-test');
  mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(join(parent, 'case-'));
  for (const path of ['book/plates', 'book/figures', 'book/fonts', 'website-v2/public/whitepaper']) mkdirSync(join(root, path), { recursive: true });
  return root;
}

test('publishes source images at stable URLs, removes stale derivatives, and excludes TeX and fonts', () => {
  const root = fixture();
  try {
    writeFileSync(join(root, 'book/plates/cover.jpg'), 'cover image');
    writeFileSync(join(root, 'book/plates/provenance.json'), '{}');
    writeFileSync(join(root, 'book/figures/diagram.svg'), '<svg/>');
    writeFileSync(join(root, 'book/figures/diagram.tex'), 'authored TeX');
    writeFileSync(join(root, 'book/fonts/private.otf'), 'must not copy');
    mkdirSync(join(root, 'book/plates/originals'));
    writeFileSync(join(root, 'book/plates/originals/cover.jpg'), 'original source only');
    mkdirSync(join(root, 'website-v2/public/whitepaper/plates'));
    writeFileSync(join(root, 'website-v2/public/whitepaper/plates/stale.jpg'), 'stale');
    writeFileSync(join(root, 'website-v2/public/whitepaper/book.pdf'), 'accepted PDF');
    assert.equal(stageBookAssets(root), 3);
    assert.equal(readFileSync(join(root, 'website-v2/public/whitepaper/plates/cover.jpg'), 'utf8'), 'cover image');
    assert.equal(readFileSync(join(root, 'website-v2/public/whitepaper/book.pdf'), 'utf8'), 'accepted PDF');
    for (const path of ['plates/stale.jpg','plates/originals','figures/diagram.tex','fonts']) assert.equal(existsSync(join(root, 'website-v2/public/whitepaper', path)), false);
    assert.equal(stageBookAssets(root), 3);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('refuses a symlink source asset instead of publishing files outside the canonical tree', () => {
  const root = fixture();
  try {
    writeFileSync(join(root, 'outside.jpg'), 'private');
    symlinkSync(join(root, 'outside.jpg'), join(root, 'book/figures/leak.jpg'));
    assert.throws(() => stageBookAssets(root), /cannot be symlinks/);
    assert.equal(existsSync(join(root, 'website-v2/public/whitepaper/figures/leak.jpg')), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
