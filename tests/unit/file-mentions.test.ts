import { describe, expect, test } from '@jest/globals';
import { extractMentionedPaths } from '../../fleet-config-ui/src/fileMentions.ts';

describe('extractMentionedPaths', () => {
  test('keeps real repo-style file paths', () => {
    expect(extractMentionedPaths(
      'Touched fleet-config-ui/src/components/FileActionLinks.tsx and docs/recovery/CURRENT-WORK.md',
    )).toEqual([
      'fleet-config-ui/src/components/FileActionLinks.tsx',
      'docs/recovery/CURRENT-WORK.md',
    ]);
  });

  test('rejects slash phrases pulled from prose', () => {
    expect(extractMentionedPaths(
      'Investigating FleetBar/control-plane regressions plus Fleet Control Center/Fleet embed issues.',
    )).toEqual([]);
  });

  test('allows known repo directories when they are explicit repo paths', () => {
    expect(extractMentionedPaths(
      'Check apps/FleetBar and public/fleet-ui for the live shell.',
    )).toEqual([
      'apps/FleetBar',
      'public/fleet-ui',
    ]);
  });
});
