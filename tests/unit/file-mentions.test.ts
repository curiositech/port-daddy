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

  test('rejects model identifiers whose dots are versions, not extensions', () => {
    expect(extractMentionedPaths(
      'Spawn failed: File not found: ollama/qwen2.5-coder, falling back to anthropic/claude-sonnet-4.5 then meta-llama/Llama-3.1-8B.',
    )).toEqual([]);
  });

  test('still keeps real paths alongside model identifiers', () => {
    expect(extractMentionedPaths(
      'Backend ollama/qwen2.5-coder edited lib/spawner.ts per docs/adr/0019-declarative-fleet-yaml.md',
    )).toEqual([
      'lib/spawner.ts',
      'docs/adr/0019-declarative-fleet-yaml.md',
    ]);
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
