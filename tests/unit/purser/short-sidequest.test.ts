import { handleBegin } from '../../../cli/commands/sugar.js';
import { jest } from '@jest/globals';

describe('short sidequest reason boundary', () => {
  const originalExit = process.exit;
  beforeEach(() => {
    jest.resetModules();
    process.exit = jest.fn(() => {
      throw new Error('process.exit called');
    });
  });
  afterEach(() => {
    process.exit = originalExit;
  });

  const baseOptions = {
    lifecycle: 'ephemeral',
    sidequest: undefined as any,
  };

  const baseFiles = ['file'];

  test('sidequest reason of 11 characters throws', async () => {
    const options = { ...baseOptions, sidequest: 'a'.repeat(11) };
    await expect(handleBegin('test purpose', baseFiles, options)).rejects.toThrow(/sidequest/i);
    expect(process.exit).not.toHaveBeenCalled();
  });

  test('sidequest reason of 12 characters passes', async () => {
    const options = { ...baseOptions, sidequest: 'a'.repeat(12) };
    await expect(handleBegin('test purpose', baseFiles, options)).resolves.toBeUndefined();
    expect(process.exit).not.toHaveBeenCalled();
  });
});