import { FilePersistence } from '../../src/spawn/persistence';

describe('FilePersistence', () => {
  let persistence;

  beforeEach(() => {
    persistence = new FilePersistence('test-file.json');
  });

  it('loads data from file', async () => {
    const mockData = { key: 'value' };
    jest.spyOn(persistence, 'load').mockResolvedValue(mockData);
    const result = await persistence.load();
    expect(result).toEqual(mockData);
  });

  it('saves data to file', async () => {
    const data = { key: 'value' };
    const saveMock = jest.spyOn(persistence, 'save').mockImplementation(jest.fn());
    await persistence.save(data);
    expect(saveMock).toHaveBeenCalledWith(data);
  });

  it('handles file not found error', async () => {
    jest.spyOn(persistence, 'load').mockRejectedValue(new Error('File not found'));
    await expect(persistence.load()).rejects.toThrow('File not found');
  });
});