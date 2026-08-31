import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { inflateSync } from 'node:zlib';
import { describe, expect, test } from '@jest/globals';

// Executable, adversarial acceptance contract for the stacked publication artifact.
const paths = {
  catalog: 'website-v2/src/data/whitePapers.ts',
  source: 'website-v2/public/whitepaper/spawn-to-person.tex',
  honest: 'website-v2/public/whitepaper/figures/fig-stp-honest-state.tex',
  keystone: 'website-v2/public/whitepaper/figures/fig-stp-keystone-split.tex',
  organs: 'website-v2/public/whitepaper/figures/fig-stp-three-organs.tex',
  pdf: 'website-v2/public/whitepaper/spawn-to-person-whitepaper.pdf',
  contact: 'docs/artifacts/whitepaper-figure-semantics/all-volumes/all-seven-volumes-color-contact-sheet.png',
  tour: 'docs/artifacts/whitepaper-figure-semantics/all-volumes/all-seven-volumes-color-tour.gif',
  proof: 'docs/artifacts/whitepaper-figure-semantics/all-volumes/proof-manifest.md',
};

const expectedSha256 = {
  pdf: 'ae9d319d140e22e0e309eb04ea6ed399c066f0ba128b7aee2031ffb2c735ee7e',
  contact: 'e74fad8acce50400e536f8a81120643b48ff1589d8d1e3ff3da479a3b45768f6',
  tour: 'fd6021b6dffaf8670550b075bbd81bd1af555070aa353b4c90316393ac61f12f',
};

const publicationSha256 = {
  'website-v2/public/whitepaper/legible-swarm-whitepaper.pdf': 'bb5704b0b2acf5f9e6015a130b1578e9c14b2cc6dd6ebe27fffe45fabcd9e639',
  'website-v2/public/whitepaper/single-writer-kernel-whitepaper.pdf': '2ec6d1ae929e01880320d9d255f887d8635c4b27eb14a965d0d57057f732323c',
  'website-v2/public/whitepaper/harbor-economy-whitepaper.pdf': '5c70098c49051b2a89fa632f4ddada76288603b7c705a7bfd0406a980af98816',
  'website-v2/public/whitepaper/anchor-protocol-whitepaper.pdf': 'cfd4f6dd55f1868e9f8a13c4d9039994bc5f6e554af52fc4ee163e91d57712c1',
  'website-v2/public/whitepaper/agent-transactions-whitepaper.pdf': '0d52188306583518abf8b7755142b2df53f3f664152ec9305947c5fee3b12960',
  'website-v2/public/whitepaper/federated-harbor-whitepaper.pdf': 'cae3b19ca9bb961bf54bf1aa228d58a1d7a434729d97e7d437e7a86bef01c247',
  'website-v2/public/whitepaper/coordination-papers-mega-volume.pdf': '7886660dc50cd23a206cda020ad219d51008cbe999d1e23f178eb979c2cd1b92',
};

function text(path) {
  return readFileSync(path, 'utf8');
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function decodedPdfText(pdf) {
  const streamMarker = Buffer.from('stream');
  const endMarker = Buffer.from('endstream');
  const fragments = [pdf.toString('latin1')];
  let cursor = 0;

  while ((cursor = pdf.indexOf(streamMarker, cursor)) !== -1) {
    const dictionaryStart = pdf.lastIndexOf(Buffer.from('<<'), cursor);
    const dictionary = pdf
      .subarray(Math.max(0, dictionaryStart), cursor)
      .toString('latin1');
    let dataStart = cursor + streamMarker.length;
    if (pdf[dataStart] === 13 && pdf[dataStart + 1] === 10) dataStart += 2;
    else if (pdf[dataStart] === 10) dataStart += 1;
    const dataEnd = pdf.indexOf(endMarker, dataStart);
    if (dataEnd === -1) break;

    if (/\/FlateDecode/.test(dictionary)) {
      let data = pdf.subarray(dataStart, dataEnd);
      while (data.length > 0 && (data.at(-1) === 10 || data.at(-1) === 13)) {
        data = data.subarray(0, -1);
      }
      try {
        fragments.push(inflateSync(data).toString('latin1'));
      } catch {
        // A non-object content stream may use predictors; it cannot add page objects.
      }
    }
    cursor = dataEnd + endMarker.length;
  }

  return fragments.join('\n');
}

function pdfPageCount(pdf) {
  // Prefer the page-tree /Count: leaf /Type /Page objects can land inside
  // compressed object streams where a plain text scan undercounts (observed
  // with pdfTeX 1.40.29 output), and dict attribute order varies by producer.
  const text = decodedPdfText(pdf);
  const counts = [...text.matchAll(
    /\/Type\s*\/Pages\b[^>]*?\/Count\s+(\d+)|\/Count\s+(\d+)[^>]*?\/Type\s*\/Pages\b/g,
  )].map((m) => Number(m[1] ?? m[2]));
  if (counts.length) return Math.max(...counts);
  return text.match(/\/Type\s*\/Page\b/g)?.length ?? 0;
}

function pngDimensions(png) {
  expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  expect(png.subarray(12, 16).toString('ascii')).toBe('IHDR');
  return {
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
  };
}

function skipGifSubBlocks(gif, start) {
  let cursor = start;
  while (cursor < gif.length) {
    const size = gif[cursor];
    cursor += 1;
    if (size === 0) return cursor;
    cursor += size;
  }
  throw new Error('unterminated GIF sub-block stream');
}

function parseGif(gif) {
  expect(gif.subarray(0, 6).toString('ascii')).toMatch(/^GIF8[79]a$/);
  const canvas = { width: gif.readUInt16LE(6), height: gif.readUInt16LE(8) };
  const packed = gif[10];
  let cursor = 13;
  if (packed & 0x80) cursor += 3 * 2 ** ((packed & 0x07) + 1);
  const frames = [];

  while (cursor < gif.length) {
    const block = gif[cursor];
    if (block === 0x3b) break;
    if (block === 0x21) {
      cursor = skipGifSubBlocks(gif, cursor + 2);
      continue;
    }
    if (block !== 0x2c) throw new Error(`unexpected GIF block 0x${block.toString(16)}`);

    const frame = {
      width: gif.readUInt16LE(cursor + 5),
      height: gif.readUInt16LE(cursor + 7),
    };
    const imagePacked = gif[cursor + 9];
    cursor += 10;
    if (imagePacked & 0x80) cursor += 3 * 2 ** ((imagePacked & 0x07) + 1);
    cursor += 1; // LZW minimum code size
    cursor = skipGifSubBlocks(gif, cursor);
    frames.push(frame);
  }

  return { canvas, frames };
}

describe('Spawn-to-Person publication contract', () => {
  test('the maturity plot marks partial only where the runtime has a grounded substrate', () => {
    const source = text(paths.source);
    const honest = text(paths.honest);
    const keystone = text(paths.keystone);
    const organs = text(paths.organs);

    expect(source).toMatch(/\\newcommand\{\\BUILTWEAK\}.*\\textsc\{partial\}/);
    expect(honest).toContain('.58/outcome ledger,');
    expect(honest).toContain('-.92/local non-forgeable identity,');
    expect(honest).toContain('\\foreach \\y in {1.08,.58,-.92} \\node[pd caution datum]');
    expect(honest).toContain('commitment closure, not neutral grades');
    expect(honest).toContain('local root; full write gating owed');
    expect(keystone).toContain('daemon-minted actor/key');
    expect(keystone).toContain('accountable principal binding/no cross-operator binding proof');
    expect(keystone).toContain('a signed, intact history still does not prove who controls the foreign key');
    expect(organs).toContain('{checkpoint\\\\[-1pt]{\\tiny partial}}');
    expect(organs).toContain('{outcome ledger\\\\[-1pt]{\\tiny partial}}');
    expect(organs).toContain('execution state is not restored');

    expect(text('lib/actor-souls.ts')).toContain('daemon-minted, non-forgeable actor identity');
    expect(text('tests/unit/actor-souls.test.js')).toContain('forged / self-asserted rejection');
    expect(text('lib/commitments.ts')).toContain('Durable Commitments');
    expect(text('routes/commitments.ts')).toContain('commitment');
    expect(text('tests/unit/commitments.test.js')).toContain('commitment');
  });

  test('catalog and changelog publish the Chapter III edition transition', () => {
    const catalog = text(paths.catalog);
    const chapterStart = catalog.indexOf("id: 'spawn-to-person'");
    const chapterEnd = catalog.indexOf("id: 'harbor-economy'", chapterStart);
    expect(chapterStart).toBeGreaterThanOrEqual(0);
    expect(chapterEnd).toBeGreaterThan(chapterStart);
    const chapter = catalog.slice(chapterStart, chapterEnd);

    expect(chapter).toContain("status: 'Version 1.4 (collected-volume edition)'");
    expect(chapter).toContain('pages: 41');
    expect(chapter).toContain('sizeKb: 749');
    expect(catalog).toContain('Spawn-to-Person diagrams and implementation status align');
    expect(catalog).toContain("chapters: ['III']");
  });

  test('the committed PDF is the declared 41-page, 749 KiB artifact', () => {
    const pdf = readFileSync(paths.pdf);
    expect(pdfPageCount(pdf)).toBe(41);
    expect(Math.floor(pdf.length / 1024)).toBe(749);
    expect(sha256(paths.pdf)).toBe(expectedSha256.pdf);
  });

  test('the proof manifest cryptographically binds the PDF and visual evidence', () => {
    const proof = text(paths.proof);
    for (const [artifact, expected] of Object.entries(expectedSha256)) {
      expect(sha256(paths[artifact])).toBe(expected);
      expect(proof).toContain(expected);
    }
    for (const [artifact, expected] of Object.entries(publicationSha256)) {
      expect(sha256(artifact)).toBe(expected);
      expect(proof).toContain(expected);
    }
  });

  test('the color contact sheet and seven-frame tour preserve the inspected volume geometry', () => {
    expect(pngDimensions(readFileSync(paths.contact))).toEqual({ width: 3792, height: 3576 });
    const gif = parseGif(readFileSync(paths.tour));
    expect(gif.canvas).toEqual({ width: 900, height: 1740 });
    expect(gif.frames).toHaveLength(7);
    // Optimized GIFs encode later frames as delta rectangles inside the canvas.
    expect(gif.frames.every((frame) => (
      frame.width > 0
      && frame.height > 0
      && frame.width <= gif.canvas.width
      && frame.height <= gif.canvas.height
    ))).toBe(true);
  });

  test('all edited figures remain inside the AAA brand palette', () => {
    const result = spawnSync(process.execPath, ['website-v2/scripts/check-figure-palette.mjs'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('AAA');
  });
});
