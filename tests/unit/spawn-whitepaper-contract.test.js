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
  contact: 'docs/pr-assets/spawn-to-person-diagram-repairs.jpg',
  tour: 'docs/pr-assets/spawn-to-person-diagram-tour.gif',
  proof: 'docs/pr-assets/spawn-to-person-diagram-repairs.md',
};

const expectedSha256 = {
  pdf: 'c98d07339bf56fd7693c263c7d0c526c2ca6975423108129e69443d45282dc5b',
  contact: '6c5507dd28e2050ffaa5171625d0839c70b9b2b0b742261362540fe7528291ef',
  tour: '833a1ef14c71d1ed6a1f1460959e2b6998119734fb19520e639abe51877ad265',
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
  return decodedPdfText(pdf).match(/\/Type\s*\/Page\b/g)?.length ?? 0;
}

function jpegDimensions(jpeg) {
  expect(jpeg.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
  let cursor = 2;
  const startOfFrame = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
    0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
  ]);

  while (cursor + 9 < jpeg.length) {
    if (jpeg[cursor] !== 0xff) {
      cursor += 1;
      continue;
    }
    const marker = jpeg[cursor + 1];
    if (startOfFrame.has(marker)) {
      return {
        height: jpeg.readUInt16BE(cursor + 5),
        width: jpeg.readUInt16BE(cursor + 7),
      };
    }
    if (marker === 0xd8 || marker === 0xd9) {
      cursor += 2;
      continue;
    }
    const segmentLength = jpeg.readUInt16BE(cursor + 2);
    cursor += 2 + segmentLength;
  }
  throw new Error('JPEG has no start-of-frame marker');
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
    expect(keystone).toContain('daemon-minted \\texttt{actor-souls}');
    expect(keystone).toContain('full write-boundary\nenforcement remains');
    expect(organs).toContain('checkpoint (\\BUILTWEAK)');
    expect(organs).toContain('witnessed-outcome ledger (\\BUILTWEAK)');
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
    const chapter = catalog.slice(chapterStart, chapterEnd);

    expect(chapter).toContain("status: 'Version 1.4 (collected-volume edition)'");
    expect(chapter).toContain('pages: 35');
    expect(chapter).toContain('sizeKb: 618');
    expect(catalog).toContain('Spawn-to-Person diagrams and implementation status align');
    expect(catalog).toContain("chapters: ['III']");
  });

  test('the committed PDF is the declared 35-page, 618 KiB artifact', () => {
    const pdf = readFileSync(paths.pdf);
    expect(pdfPageCount(pdf)).toBe(35);
    expect(Math.floor(pdf.length / 1024)).toBe(618);
    expect(sha256(paths.pdf)).toBe(expectedSha256.pdf);
  });

  test('the proof manifest cryptographically binds the PDF and visual evidence', () => {
    const proof = text(paths.proof);
    for (const [artifact, expected] of Object.entries(expectedSha256)) {
      expect(sha256(paths[artifact])).toBe(expected);
      expect(proof).toContain(expected);
    }
  });

  test('the still and four-frame tour preserve the inspected diagram geometry', () => {
    expect(jpegDimensions(readFileSync(paths.contact))).toEqual({ width: 2072, height: 2968 });
    const gif = parseGif(readFileSync(paths.tour));
    expect(gif.canvas).toEqual({ width: 900, height: 1303 });
    expect(gif.frames).toHaveLength(4);
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
