import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { join, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { REPO_ROOT, findOffenders } from '../unit/no-hardcoded-daemon-url.test.js';

const TEST_DIR = join(REPO_ROOT, 'tests', 'purser', 'url-test');

beforeAll(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterAll(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('Adversarial URL checks', () => {
  test('Detects URL in comment', () => {
    const filePath = join(TEST_DIR, 'comment.ts');
    writeFileSync(filePath, '/* http://localhost:9876 */\nconst url = "http://localhost:9876";');
    const offenders = findOffenders(/http:\/\/localhost:\d+/);
    expect(offenders.some(o => o.path.includes('comment.ts'))).toBe(true);
  });

  test('Detects URL in string', () => {
    const filePath = join(TEST_DIR, 'string.ts');
    writeFileSync(filePath, 'const endpoint = "http://localhost:9876";');
    const offenders = findOffenders(/http:\/\/localhost:\d+/);
    expect(offenders.some(o => o.path.includes('string.ts'))).toBe(true);
  });

  test('Excludes generated directory', () => {
    const filePath = join(TEST_DIR, 'target', 'generated.ts');
    mkdirSync(join(TEST_DIR, 'target'), { recursive: true });
    writeFileSync(filePath, 'const url = "http://localhost:9876";');
    const offenders = findOffenders(/http:\/\/localhost:\d+/);
    expect(offenders.some(o => o.path.includes('generated.ts'))).toBe(false);
  });
});