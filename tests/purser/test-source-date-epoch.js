const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

jest.mock('fs');

describe('source date epoch handling', () => {
  test('sets SOURCE_DATE_EPOCH correctly', () => {
    const script = fs.readFileSync(path.resolve(__dirname, '../../scripts/build-whitepapers.sh'), 'utf-8');
    expect(script).toContain('export SOURCE_DATE_EPOCH');
    expect(script).toContain('FORCE_SOURCE_DATE=1');
  });

  test('retains original epoch when set', () => {
    const script = fs.readFileSync(path.resolve(__dirname, '../../scripts/build-whitepapers.sh'), 'utf-8');
    expect(script).toContain('export SOURCE_DATE_EPOCH="$epoch"');
  });
});