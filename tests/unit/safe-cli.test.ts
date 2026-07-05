import { afterAll, afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

const scanStagedDiff = jest.fn();
const formatStagedFinding = jest.fn((finding: { file: string; newLine: number; ruleId: string; last4: string }) => {
  return `${finding.file}:${finding.newLine}  ${finding.ruleId}  (...${finding.last4})`;
});

jest.unstable_mockModule('../../lib/safe/staged-guard.js', () => ({
  scanStagedDiff,
  formatStagedFinding,
}));

const { handleSafe } = await import('../../cli/commands/safe.js');

const exit = jest.spyOn(process, 'exit').mockImplementation((code) => {
  throw new Error(`process.exit(${code ?? 0})`);
});

let stdout: string[];
let stderr: string[];
const originalStdoutWrite = process.stdout.write.bind(process.stdout);
const originalStderrWrite = process.stderr.write.bind(process.stderr);

function stagedFinding() {
  return {
    path: '.env',
    line: 1,
    ruleId: 'aws-access-token',
    last4: 'MPLE',
    entropy: 3.9,
    method: 'structured-format',
    verified: null,
    file: '.env',
    newLine: 1,
  };
}

function stdoutText(): string {
  return stdout.join('');
}

function stderrText(): string {
  return stderr.join('');
}

beforeEach(() => {
  stdout = [];
  stderr = [];
  scanStagedDiff.mockReset();
  formatStagedFinding.mockClear();
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout.push(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk));
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr.push(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk));
    return true;
  }) as typeof process.stderr.write;
});

afterEach(() => {
  process.stdout.write = originalStdoutWrite;
  process.stderr.write = originalStderrWrite;
});

afterAll(() => {
  exit.mockRestore();
});

describe('pd safe guard CLI', () => {
  test('fails closed when the staged diff cannot be read', async () => {
    scanStagedDiff.mockReturnValue({ diffAvailable: false, files: [], findings: [] });

    await expect(handleSafe(['guard'], {})).rejects.toThrow('process.exit(1)');

    expect(stderrText()).toContain('could not read the staged diff');
    expect(stdoutText()).toBe('');
  });

  test('reports an unreadable staged diff as a blocking JSON result', async () => {
    scanStagedDiff.mockReturnValue({ diffAvailable: false, files: [], findings: [] });

    await expect(handleSafe(['guard'], { json: true })).rejects.toThrow('process.exit(1)');

    expect(JSON.parse(stdoutText())).toEqual({
      clean: false,
      diffAvailable: false,
      files: [],
      findings: [],
    });
    expect(stderrText()).toBe('');
  });

  test('prints the full staged findings shape for --json blocks', async () => {
    const finding = stagedFinding();
    scanStagedDiff.mockReturnValue({ diffAvailable: true, files: ['.env'], findings: [finding] });

    await expect(handleSafe(['guard'], { json: true })).rejects.toThrow('process.exit(1)');

    expect(JSON.parse(stdoutText())).toEqual({
      clean: false,
      diffAvailable: true,
      files: ['.env'],
      findings: [finding],
    });
    expect(stderrText()).toBe('');
  });

  test('prints the same JSON envelope when the staged diff is clean', async () => {
    scanStagedDiff.mockReturnValue({ diffAvailable: true, files: ['README.md'], findings: [] });

    await expect(handleSafe(['guard'], { json: true })).rejects.toThrow('process.exit(0)');

    expect(JSON.parse(stdoutText())).toEqual({
      clean: true,
      diffAvailable: true,
      files: ['README.md'],
      findings: [],
    });
    expect(stderrText()).toBe('');
  });
});
