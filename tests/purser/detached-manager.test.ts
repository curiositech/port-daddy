import { DetachedSpawnManager } from '../../src/spawn/detached-manager';
import { FilePersistence } from '../../src/spawn/persistence';

jest.mock('../../src/spawn/persistence', () => ({ 
  FilePersistence: jest.fn(() => ({ 
    load: jest.fn(),
    save: jest.fn()
  }))
}));

describe('DetachedSpawnManager', () => {
  let manager;
  let persistenceMock;

  beforeEach(() => {
    manager = new DetachedSpawnManager();
    persistenceMock = new FilePersistence('detached-spawns.json');
  });

  it('should extend SpawnManager', () => {
    expect(manager instanceof DetachedSpawnManager).toBe(true);
    expect(manager).toHaveProperty('spawns');
  });

  it('should use correct persistence file', () => {
    expect(manager.persistence).toBeInstanceOf(FilePersistence);
    expect(manager.persistence.constructor).toHaveBeenCalledWith('detached-spawns.json');
  });

  it('track should call super.track and save', async () => {
    const superTrackMock = jest.spyOn(manager, 'track').mockImplementation(jest.fn());
    const saveMock = jest.spyOn(manager.persistence, 'save');

    await manager.track('test-id', {});
    expect(superTrackMock).toHaveBeenCalled();
    expect(saveMock).toHaveBeenCalledWith(manager.spawns);
  });

  it('list should load from persistence', async () => {
    const loadMock = jest.spyOn(manager.persistence, 'load').mockResolvedValue({ test: 'data' });
    const result = await manager.list();
    expect(loadMock).toHaveBeenCalled();
    expect(result).toEqual({ test: 'data' });
  });

  it('handles persistence errors', async () => {
    const loadMock = jest.spyOn(manager.persistence, 'load').mockRejectedValue(new Error('File error'));
    await expect(manager.list()).rejects.toThrow('File error');
  });
});