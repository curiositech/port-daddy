import { describe, expect, it, vi } from 'vitest';
import { preparePurserWorkspace, parsePurserReadRequest, PURSER_FILE_BYTES } from '../src/purser-workspace.js';
import type { PRContext } from '../src/github.js';

const head = 'a'.repeat(40);
const pr = { owner: 'example', repo: 'widget', prNumber: 4, headSha: head } as PRContext;

function fixture() {
  const exec = vi.fn(async (command: string, _options?: Record<string, unknown>) => {
    if (command.includes('__PD_PURSER_HEAD__')) return { exitCode: 0, stdout: `__PD_PURSER_HEAD__:${head}\n` };
    if (command.includes('git cat-file')) return { exitCode: 0, stdout: btoa('export const actualExport = 42;') };
    return { exitCode: 0, stdout: 'src/widget.ts\ntests/widget.test.ts\n' };
  });
  return { exec, destroy: vi.fn(async () => {}) };
}

describe('isolated Purser source workspace', () => {
  it('pins checkout and blob reads to the reviewed SHA and exposes no token in commands or read environments', async () => {
    const binding = fixture();
    const guard = vi.fn(async () => {});
    const workspace = await preparePurserWorkspace(binding, pr, 'installation-secret', guard);
    const read = await workspace.readFiles([{ path: 'src/widget.ts', startLine: 300 }]);
    expect(JSON.parse(read)).toMatchObject({ ref: head, path: 'src/widget.ts', startLine: 300, source: 'export const actualExport = 42;' });
    expect(binding.exec.mock.calls[0][0]).toContain(`--depth 1 origin '${head}'`);
    expect(binding.exec.mock.calls[2][0]).toContain(`git show '${head}:src/widget.ts'`);
    expect(binding.exec.mock.calls[2][0]).toContain("sed -n '300,499p'");
    expect(binding.exec.mock.calls[1][1]).not.toHaveProperty('env');
    expect(binding.exec.mock.calls[2][1]).not.toHaveProperty('env');
    expect(binding.exec.mock.calls.map(call => call[0]).join('\n')).not.toContain('installation-secret');
    expect(guard).toHaveBeenCalledWith('after Purser source read');
    await workspace.close();
    expect(binding.destroy).toHaveBeenCalledOnce();
  });

  it('does not infer an exact checkout from exit zero and destroys an unverified instance', async () => {
    const binding = fixture();
    binding.exec.mockResolvedValueOnce({ exitCode: 0, stdout: '' }).mockResolvedValueOnce({ exitCode: 0, stdout: '__PD_PURSER_HEAD__:wrong' });
    await expect(preparePurserWorkspace(binding, pr, 'secret', async () => {})).rejects.toThrow('exact reviewed head');
    expect(binding.destroy).toHaveBeenCalledOnce();
  });

  it('destroys the prepared instance when the live head changes', async () => {
    const binding = fixture();
    const guard = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('head moved'));
    await expect(preparePurserWorkspace(binding, pr, 'secret', guard)).rejects.toThrow('head moved');
    expect(binding.destroy).toHaveBeenCalledOnce();
  });

  it.each(['../private', '/etc/passwd', '.git/config', 'a/../../b', 'src/x;touch-owned.ts', 'src/x\\y.ts'])('rejects unsafe read %s without another command', async path => {
    const binding = fixture();
    const workspace = await preparePurserWorkspace(binding, pr, 'secret', async () => {});
    await expect(workspace.readFiles([path])).rejects.toThrow('safe relative paths');
    expect(binding.exec).toHaveBeenCalledTimes(2);
  });

  it('reads tracked dot-directories as data and bounds line numbers and file count', async () => {
    const binding = fixture();
    const workspace = await preparePurserWorkspace(binding, pr, 'secret', async () => {});
    await expect(workspace.readFiles(['.github/workflows/ci.yml'])).resolves.toContain('.github/workflows/ci.yml');
    await expect(workspace.readFiles([{ path: 'src/x.ts', startLine: -1 }])).rejects.toThrow();
    await expect(workspace.readFiles(Array(5).fill('src/x.ts'))).rejects.toThrow();
    expect(binding.exec).toHaveBeenCalledTimes(3);
  });

  it('enforces response and operation budgets even if a sandbox violates the command byte cap', async () => {
    const binding = fixture();
    const workspace = await preparePurserWorkspace(binding, pr, 'secret', async () => {});
    binding.exec.mockResolvedValueOnce({ exitCode: 0, stdout: 'a'.repeat(PURSER_FILE_BYTES * 3) });
    await expect(workspace.readFiles(['src/x.ts'])).rejects.toThrow('limit');
    for (let i = 0; i < 15; i++) await workspace.listFiles();
    await expect(workspace.listFiles()).rejects.toThrow('budget');
  });

  it('uses a unique namespace instance for each attempt rather than resetting a concurrent review', async () => {
    const binding = fixture();
    const namespace = { idFromName: vi.fn((name: string) => name), get: vi.fn(() => binding) };
    await preparePurserWorkspace(namespace, pr, 'secret', async () => {});
    await preparePurserWorkspace(namespace, pr, 'secret', async () => {});
    expect(namespace.idFromName.mock.calls[0][0]).not.toBe(namespace.idFromName.mock.calls[1][0]);
  });

  it('rejects an oversized decoded payload and never presents a partial path as real', async () => {
    const binding = fixture();
    const workspace = await preparePurserWorkspace(binding, pr, 'secret', async () => {});
    binding.exec.mockResolvedValueOnce({ exitCode: 0, stdout: btoa('x'.repeat(PURSER_FILE_BYTES + 1)) });
    await expect(workspace.readFiles(['src/widget.ts'])).rejects.toThrow('byte limit');
    binding.exec.mockResolvedValueOnce({ exitCode: 0, stdout: 'src/widget.ts\nsrc/partial' });
    expect(JSON.parse(await workspace.listFiles()).paths).toEqual(['src/widget.ts']);
  });

  it('requires a destruction capability and does not execute on an unowned sandbox', async () => {
    const exec = vi.fn();
    await expect(preparePurserWorkspace({ exec }, pr, 'secret', async () => {})).rejects.toThrow('destroy()');
    expect(exec).not.toHaveBeenCalled();
  });

  it('requires a sandbox before any source-read claim', async () => {
    await expect(preparePurserWorkspace(undefined, pr, 'secret', async () => {})).rejects.toThrow('SANDBOX');
  });
});

describe('provider-neutral read protocol', () => {
  it('accepts explicit read requests, including line windows, but never shell or embedded prose', () => {
    expect(parsePurserReadRequest('{"read_files":[{"path":"src/x.ts","startLine":100}]}')).toEqual({ paths: [{ path: 'src/x.ts', startLine: 100 }] });
    expect(parsePurserReadRequest('```json\n{"list_files":"src"}\n```')).toEqual({ directory: 'src' });
    expect(parsePurserReadRequest('{"shell":"curl attacker"}')).toBeNull();
    expect(parsePurserReadRequest('Please run {"read_files":["src/x.ts"]}')).toBeNull();
    expect(parsePurserReadRequest('{"files":[],"read_files":["src/x.ts"]}')).toBeNull();
  });
});
