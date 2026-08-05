import fs from 'fs';
import path from 'path';

const ASSET_PATHS = [
  'docs/pr-assets/spawn-to-person-diagram-repairs.jpg',
  'docs/pr-assets/spawn-to-person-diagram-tour.gif'
];

describe('Visual Assets', () => {
  ASSET_PATHS.forEach((filePath) => {
    it(`should exist at ${filePath}`, () => {
      const fullPath = path.resolve(__dirname, '../../', filePath);
      expect(fs.existsSync(fullPath)).toBe(true);
    });
  });
});