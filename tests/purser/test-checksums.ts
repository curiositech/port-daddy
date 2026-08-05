import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const assetPaths = {
  pdf: 'website-v2/public/whitepaper/spawn-to-person-whitepaper.pdf',
  jpg: 'docs/pr-assets/spawn-to-person-diagram-repairs.jpg',
  gif: 'docs/pr-assets/spawn-to-person-diagram-tour.gif'
};

const expectedChecksums = {
  pdf: 'f72acad03574c3fb8fd30ef8e38c4e298971be49cd46186df4e0f0c209bda1a6',
  jpg: 'c3ec92cc47207eaad8f5d05f6a1a937e3a6f9e192228fac835c9459ed1209c41',
  gif: '13f3c4952b6e5954e4fa57d0ecce0489af854efec442bd182f8883b851d0d1f2'
};

describe('Checksum Verification', () => {
  for (const [asset, filePath] of Object.entries(assetPaths)) {
    it(`should match SHA-256 for ${asset}`, () => {
      const data = fs.readFileSync(filePath);
      const hash = crypto.createHash('sha256').update(data).digest('hex');
      expect(hash).toBe(expectedChecksums[asset]);
    });
  }
});