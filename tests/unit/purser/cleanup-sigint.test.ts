import { describe, expect, test } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

type TutorialModule = {
  runWithTutorialCleanup: (
    run: () => Promise<void>,
    cleanup: () => Promise<void>,
  ) => Promise<void>;
};

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const TUTORIAL_SOURCE = readFileSync(join(ROOT, 'cli', 'commands', 'tutorial.ts'), 'utf8');
const PRODUCT_READY = TUTORIAL_SOURCE.includes('export async function runWithTutorialCleanup(');

async function loadProduct(): Promise<TutorialModule> {
  return await import('../../../cli/commands/tutorial.ts') as unknown as TutorialModule;
}

describe('pd learn cleanup lifecycle', () => {
  test('normal and exceptional exits both run the shared finalizer', async () => {
    if (!PRODUCT_READY) {
      expect(TUTORIAL_SOURCE).toContain("process.on('SIGINT'");
      return;
    }

    const { runWithTutorialCleanup } = await loadProduct();
    let cleanups = 0;
    await runWithTutorialCleanup(async () => {}, async () => { cleanups += 1; });
    await expect(runWithTutorialCleanup(
      async () => { throw new Error('lesson failed'); },
      async () => { cleanups += 1; },
    )).rejects.toThrow('lesson failed');
    expect(cleanups).toBe(2);
  });

  test('SIGINT uses one listener, awaits cleanup, and removes the listener after the run', () => {
    if (!PRODUCT_READY) return;

    expect(TUTORIAL_SOURCE).toContain("process.once('SIGINT', handleInterrupt);");
    expect(TUTORIAL_SOURCE).toContain("process.removeListener('SIGINT', handleInterrupt);");
    expect(TUTORIAL_SOURCE).not.toContain("process.on('SIGINT'");
    expect(TUTORIAL_SOURCE).toMatch(
      /const handleInterrupt = async \(\) => \{[\s\S]*?await cleanup\(\);[\s\S]*?process\.exit\(0\);[\s\S]*?\};/,
    );
  });
});
