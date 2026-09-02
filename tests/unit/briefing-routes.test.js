import { jest } from '@jest/globals';
import Fastify from 'fastify';
import { briefingPlugin } from '../../routes/briefing.js';

describe('briefing HTTP project contract', () => {
  let app;
  let briefing;
  const root = '/workspace/team/project with spaces';

  beforeEach(async () => {
    briefing = {
      generate: jest.fn((projectRoot, options) => ({ success: true, briefing: { project: options.project ?? 'detected', projectRoot } })),
      sync: jest.fn(() => ({ success: true })),
    };
    app = Fastify();
    await app.register(briefingPlugin, { deps: { briefing } });
  });
  afterEach(async () => { await app.close(); });

  test('omitted project uses the query root and read-only generation', async () => {
    const response = await app.inject(`/briefing?projectRoot=${encodeURIComponent(root)}`);
    expect(response.statusCode).toBe(200);
    expect(response.json().briefing).toEqual({ project: 'detected', projectRoot: root });
    expect(briefing.generate).toHaveBeenCalledWith(root, { project: undefined, writeToDisk: false });
    expect(briefing.sync).not.toHaveBeenCalled();
  });

  test.each(['auto', 'explicit-project', 'team:project'])('explicit project %s remains literal', async project => {
    const response = await app.inject(`/briefing/${encodeURIComponent(project)}?projectRoot=${encodeURIComponent(root)}`);
    expect(response.statusCode).toBe(200);
    expect(response.json().briefing.project).toBe(project);
    expect(briefing.generate).toHaveBeenCalledWith(root, { project, writeToDisk: false });
  });

  test('GET and POST preserve the same omitted project and supplied directory', async () => {
    await app.inject(`/briefing?projectRoot=${encodeURIComponent(root)}`);
    await app.inject({ method: 'POST', url: '/briefing', payload: { projectRoot: root } });
    expect(briefing.generate.mock.calls).toEqual([
      [root, { project: undefined, writeToDisk: false }],
      [root, { project: undefined }],
    ]);
  });

  test.each(['/briefing', '/briefing?projectRoot=', '/briefing?projectRoot=relative', '/briefing?projectRoot=%2Fvalid%00bad', '/briefing?projectRoot=%2Fa&projectRoot=%2Fb'])('rejects invalid omitted-project request %s instead of guessing daemon cwd', async url => {
    const response = await app.inject(url);
    expect(response.statusCode).toBe(400);
    expect(briefing.generate).not.toHaveBeenCalled();
  });

  test('POST without a body reports a client error, not a destructuring crash', async () => {
    const response = await app.inject({ method: 'POST', url: '/briefing' });
    expect(response.statusCode).toBe(400);
  });

  test('read failures retain error status and never invoke sync', async () => {
    briefing.generate.mockReturnValueOnce({ success: false, error: 'invalid root' });
    expect((await app.inject('/briefing?projectRoot=%2Fproject')).statusCode).toBe(400);
    briefing.generate.mockImplementationOnce(() => { throw new Error('fixture failed'); });
    expect((await app.inject('/briefing?projectRoot=%2Fproject')).statusCode).toBe(500);
    expect(briefing.sync).not.toHaveBeenCalled();
  });
});
