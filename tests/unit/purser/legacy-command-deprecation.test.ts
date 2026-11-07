// tests/unit/purser/legacy-command-deprecation.test.ts
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { jest } from '@jest/globals';
import { handleJuryRig } from '../../../lib/jury-rig-bootstrap.ts';

describe('Legacy `query` command deprecation', () => {
  let root: string;
  const logs: string[] = [];

  beforeEach(() => {
    // Isolated temporary workspace for each test run.
    root = mkdtempSync(join(tmpdir(), 'jury-rig-cli-'));
    logs.length = 0;

    // Capture any output the CLI writes to the console.
    jest.spyOn(console, 'error').mockImplementation((msg?: any) => {
      logs.push(String(msg));
    });
    jest.spyOn(console, 'log').mockImplementation((msg?: any) => {
      logs.push(String(msg));
    });
    jest.spyOn(console, 'info').mockImplementation((msg?: any) => {
      logs.push(String(msg));
    });
  });

  afterEach(() => {
    // Clean up temporary directory and restore mocked globals.
    rmSync(root, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  test('rejects the deprecated `query` operation with clear guidance', async () => {
    // The old `query` sub‑command must be treated as unknown.
    await expect(
      handleJuryRig(['query', 'write', 'fleet', 'trigger', 'tests'], {
        root,
        json: true,
      })
    ).rejects.toThrow(/unknown operation/i);

    const output = logs.join('\n');

    // The emitted guidance must mention the removed command and the new ones.
    expect(output).toMatch(/query/i);
    expect(output).toMatch(/unknown operation/i);
    expect(output).toMatch(/search.*graft/i);
  });
});