import { describe, expect, test } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'node:json5';

const ROOT = resolve(import.meta.dirname, '../..');
const MANIFEST_PATH = resolve(ROOT, 'features.manifest.json');

describe('Feature manifest', () => {
  test('should not list install-bosun in commands', () => {
    const content = readFileSync(MANIFEST_PATH, 'utf8');
    const manifest = parse(content);
    expect(manifest.commands).not.toContain('install-bosun');
  });
});