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
  pdf: '2961ca6ec3533f9e8ad80e251d414e3fafa76186ab65f7b600582e76b92e35ad',
  contact: 'e74fad8acce50400e536f8a81120643b48ff1589d8d1e3ff3da479a3b45768f6',
  tour: 'fd6021b6dffaf8670550b075bbd81bd1af555070aa353b4c90316393ac61f12f',
};

const publicationSha256 = {
  'website-v2/public/whitepaper/legible-swarm-whitepaper.pdf': '599f5b5389aae34a7cb6d7a42abcf3c967d813268bbd9f75087d5f381fc6e21e',
  'website-v2/public/whitepaper/single-writer-kernel-whitepaper.pdf': 'c38ceed5075dd2d891d0a9926f5abd1833a138e8158f9af117d1e68a1eb82ca2',
  'website-v2/public/whitepaper/harbor-economy-whitepaper.pdf': 'd54e817d88510367c8f2c755bc8c358934e0623d40c94b55fd00572a53f00076',
  'website-v2/public/whitepaper/anchor-protocol-whitepaper.pdf': '44e0d08b1b80557d89c53e5f0a34c79d3a73930b0c41c806440403785172d9f9',
  'website-v2/public/whitepaper/agent-transactions-whitepaper.pdf': 'dbd1ddaaa4665aa2c28701aab07082271a188eb0e0631a7dd658950c1db5cb6d',
  'website-v2/public/whitepaper/federated-harbor-whitepaper.pdf': 'fefdfe6deb4bb9d0115aa042f2f19d3fb26579d2ce54f75a48912b374cfecfdc',
  'website-v2/public/whitepaper/coordination-papers-mega-volume.pdf': '9d5db6a8464fbedaaa2daaa903145fc227a44a133b4ed5e6c51f4e2e28f7f5dd',
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
  test('maturity labels say partial only where the runtime has a grounded substrate', () => {
    const source = text(paths.source);
    const honest = text(paths.honest);
    const keystone = text(paths.keystone);
    const organs = text(paths.organs);

    expect(source).toMatch(/\\newcommand\{\\BUILTWEAK\}.*\\textsc\{partial\}/);
    expect(honest).toMatch(/Outcome ledger[^&]*& \\BUILTWEAK/);
    expect(honest).toMatch(/Local non-forgeable identity & \\BUILTWEAK/);
    expect(honest).toContain('\\S\\ref{sec:organs}, Def.~\\ref{def:oracle}');
    expect(honest).toContain('\\S\\ref{sec:identity}, Thm.~\\ref{thm:necessity}');
    expect(keystone).toContain('daemon-issued identity root');
    expect(keystone).toContain('\\textsc{partial: enforcement owed}');
    expect(organs).toContain('checkpoint (\\BUILTWEAK)');
    expect(organs).toContain('outcome ledger (\\BUILTWEAK)');
    expect(organs).toContain('\\S\\ref{sec:organs}');

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
    expect(chapter).toContain('sizeKb: 702');
    expect(catalog).toContain('Spawn-to-Person diagrams and implementation status align');
    expect(catalog).toContain("chapters: ['III']");
  });

  test('the committed PDF is the declared 41-page, 702 KiB artifact', () => {
    const pdf = readFileSync(paths.pdf);
    expect(pdfPageCount(pdf)).toBe(41);
    expect(Math.floor(pdf.length / 1024)).toBe(702);
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
