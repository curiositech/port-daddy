import { describe, expect, test } from '@jest/globals';
import { accessSync, constants } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');

describe('Bosun filesystem escape validation', () => {
  test('No Bosun-specific files remain', () => {
    const bosunFiles = ['bosun-watchdog.sh', 'bosun-config.json', 'bosun-monitor.lua'];
    bosunFiles.forEach(file => {
      const path = resolve(ROOT, file);
      expect(() => accessSync(path, constants.F_OK)).toThrow();
    });
  });

  test('No Bosun-related directories exist', () => {
    const bosunDirs = ['bosun', 'watchdogs/bosun', 'system/bosun'];
    bosunDirs.forEach(dir => {
      const path = resolve(ROOT, dir);
      expect(() => accessSync(path, constants.F_OK)).toThrow();
    });
  });
});