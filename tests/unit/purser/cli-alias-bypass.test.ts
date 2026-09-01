import { jest } from '@jest/globals';
import { main, ALL_COMMANDS } from '../../../bin/port-daddy-cli.js';

describe('CLI deprecated skill-graft rejection', () => {
  let errorSpy: jest.SpiedFunction<typeof console.error>;
  let originalArgv: string[];
  let originalExitCode: number | undefined;

  beforeEach(() => {
    originalArgv = process.argv;
    originalExitCode = process.exitCode;
    process.exitCode = undefined;
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.exitCode = originalExitCode;
    errorSpy.mockRestore();
  });

  it.each(['skill-graft', 'skillgraft'])('rejects deprecated command %s with an explicit error and exit code 1', async (command) => {
    process.argv = ['node', 'pd', command, 'query', 'write tests'];
    await main();
    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalled();
    const output = errorSpy.mock.calls.map((args) => args.join(' ')).join('\n');
    expect(output).toContain(command);
    expect(output).toMatch(/unknown command|not a command|did you mean/i);
  });
});