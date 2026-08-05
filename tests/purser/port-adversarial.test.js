import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { join, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { REPO_ROOT, findHardcodedPortOffenders } from '../unit/no-hardcoded-daemon-port.test.js';

const TEST_DIR = join(REPO_ROOT, 'tests', 'purser', 'port-test');

beforeAll(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterAll(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('Adversarial port checks', () => {
  test('Detects port in comment', () => {
    const filePath = join(TEST_DIR, 'comment.ts');
    writeFileSync(filePath, '// Daemon port is 9876\nconst port = 9876;');
    const offenders = findHardcodedPortOffenders();
    expect(offenders.some(o => o.path.includes('comment.ts'))).toBe(true);
  });

  test('Detects port in string', () => {
    const filePath = join(TEST_DIR, 'string.ts');
    writeFileSync(filePath, 'const url = "http://localhost:9876";');
    const offenders = findHardcodedPortOffenders();
    expect(offenders.some(o => o.path.includes('string.ts'))).toBe(true);
  });

  test('Excludes generated directory', () => {
    const filePath = join(TEST_DIR, 'target', 'generated.ts');
    mkdirSync(join(TEST_DIR, 'target'), { recursive: true });
    writeFileSync(filePath, 'const port = 9876;');
    const offenders = findHardcodedPortOffenders();
    expect(offenders.some(o => o.path.includes('generated.ts'))).toBe(false);
  });
});