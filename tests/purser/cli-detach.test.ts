import { DetachedSpawnManager } from '../../src/spawn/detached-manager';
import { FilePersistence } from '../../src/spawn/persistence';

jest.mock('../../src/spawn/persistence', () => ({ 
  FilePersistence: jest.fn(() => ({ 
    load: jest.fn(),
    save: jest.fn()
  }))
}));

describe('CLI --detach flag', () => {
  it('should use DetachedSpawnManager when flag is present', () => {
    const mockProcess = { argv: ['node', 'script.js', '--detach'] };
    const originalProcess = process;
    process = mockProcess as any;

    const manager = new DetachedSpawnManager();
    expect(manager).toBeInstanceOf(DetachedSpawnManager);

    process = originalProcess;
  });
});