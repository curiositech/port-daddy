import { spawnSync } from 'node:child_process';

describe('removed skill discovery command rejection', () => {
  it.each(['skill-graft', 'skillgraft'])('rejects removed command %s with exit code 1', (command) => {
    const result = spawnSync(process.execPath, [
      '--import', 'tsx',
      'bin/port-daddy-cli.ts',
      command, 'query', 'write tests',
    ], { cwd: process.cwd(), encoding: 'utf8' });
    expect(result.status).toBe(1);
    const output = `${result.stdout}\n${result.stderr}`;
    expect(output).toContain(command);
    expect(output).toMatch(/unknown command|not a command|did you mean/i);
  });
});
