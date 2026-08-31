import { describe, expect, test } from '@jest/globals';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  exportPublicRepo,
  loadPublicRepoExportConfig,
  listTrackedFilesAtRef,
  selectPublicExportPaths,
  validatePublicExportSelection,
} from '../../lib/public-repo-export.js';

describe('public repo export', () => {
  test('HEAD selection includes required public surfaces and excludes internal ones', () => {
    const config = loadPublicRepoExportConfig();
    const selectedPaths = selectPublicExportPaths(listTrackedFilesAtRef('HEAD'), config);
    const validation = validatePublicExportSelection(selectedPaths, config);
    const selected = new Set(selectedPaths);

    expect(validation).toEqual({
      missingIncludedSmokePaths: [],
      leakedExcludedSmokePaths: [],
    });

    for (const path of [
      'AGENTS.md',
      'README.md',
      'apps/FleetBar/Package.swift',
      'docs/ROADMAP.md',
      'lib/client.ts',
      'public/index.html',
    ]) {
      expect(selected.has(path)).toBe(true);
    }

    for (const path of [
      '.cartographer/status.md',
      'docs/product-research/analyses/product-appeal.md',
      'docs/recovery/CURRENT-WORK.md',
      'public/app-surgery.html',
      'website-v2/public/llms.txt',
    ]) {
      expect(selected.has(path)).toBe(false);
    }
  });

  test('export materializes only allowed files from HEAD', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'pd-public-export-'));
    const outDir = join(tempRoot, 'mirror');

    try {
      const result = exportPublicRepo({
        outDir,
        validateSelection: false,
        trackedFilesOverride: [
          'README.md',
          'docs/recovery/CURRENT-WORK.md',
          'public/index.html',
          'public/app-surgery.html',
        ],
      });

      expect(result.selectedPaths).toEqual(['README.md', 'public/index.html']);
      expect(existsSync(join(outDir, 'README.md'))).toBe(true);
      expect(existsSync(join(outDir, 'public/index.html'))).toBe(true);
      expect(existsSync(join(outDir, 'docs/recovery/CURRENT-WORK.md'))).toBe(false);
      expect(existsSync(join(outDir, 'public/app-surgery.html'))).toBe(false);

      const manifest = JSON.parse(
        readFileSync(join(outDir, 'PORT_DADDY_PUBLIC_EXPORT.json'), 'utf8'),
      );
      expect(manifest.selectedCount).toBe(2);
      expect(manifest.selectedPaths).toEqual(['README.md', 'public/index.html']);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
