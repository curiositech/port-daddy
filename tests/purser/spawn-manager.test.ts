import { SpawnManager } from '../../src/spawn/spawn-manager';
import { FilePersistence } from '../../src/spawn/persistence';

jest.mock('../../src/spawn/persistence', () => ({ 
  FilePersistence: jest.fn(() => ({ 
    load: jest.fn(),
    save: jest.fn()
  }))
}));

describe('SpawnManager', () => {
  let manager;
  let persistenceMock;

  beforeEach(() => {
    manager = new SpawnManager();
    persistenceMock = new FilePersistence('spawn-state.json');
  });

  it('should initialize persistence with correct file', () => {
    expect(manager.persistence).toBeInstanceOf(FilePersistence);
    expect(manager.persistence.constructor).toHaveBeenCalledWith('spawn-state.json');
  });

  it('track should save to persistence', async () => {
    const saveMock = jest.spyOn(manager.persistence, 'save');
    await manager.track('test-id', {});
    expect(saveMock).toHaveBeenCalledWith(manager.spawns);
  });

  it('get should retrieve from in-memory store', () => {
    manager.spawns['test-id'] = { status: 'active' };
    expect(manager.get('test-id')).toEqual({ status: 'active' });
  });
});