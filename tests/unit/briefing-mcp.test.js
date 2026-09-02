import { jest } from '@jest/globals';
import { EventEmitter } from 'node:events';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const handlers = new Map();
const requests = [];
jest.unstable_mockModule('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: class {
    setRequestHandler(schema, handler) { handlers.set(schema, handler); }
    async connect() {}
  },
}));
jest.unstable_mockModule('@modelcontextprotocol/sdk/server/stdio.js', () => ({ StdioServerTransport: class {} }));
jest.unstable_mockModule('../../shared/daemon-discovery.js', () => ({ getDaemonTcpUrl: () => 'http://briefing.invalid:9876' }));
jest.unstable_mockModule('../../lib/mcp-session-cache.js', () => ({
  setActiveSession: jest.fn(), clearActiveSession: jest.fn(), resolveSessionId: jest.fn(),
  resolveAgentId: jest.fn(), resolveActorCredential: () => undefined,
}));
jest.unstable_mockModule('node:http', () => ({
  request(options, callback) {
    const req = new EventEmitter();
    let body = '';
    req.write = chunk => { body += chunk; };
    req.end = () => {
      requests.push({ method: options.method, path: options.path, body: body ? JSON.parse(body) : undefined });
      const response = new EventEmitter();
      response.statusCode = 200;
      callback(response);
      response.emit('data', Buffer.from(JSON.stringify({ success: true })));
      response.emit('end');
    };
    req.destroy = jest.fn();
    return req;
  },
}));

const priorFull = process.env.PORT_DADDY_MCP_FULL;
process.env.PORT_DADDY_MCP_FULL = '1';
await import('../../mcp/server.js');
if (priorFull === undefined) delete process.env.PORT_DADDY_MCP_FULL;
else process.env.PORT_DADDY_MCP_FULL = priorFull;

const call = (name, args) => handlers.get(CallToolRequestSchema)({ params: { name, arguments: args } });

describe('briefing MCP actual handler request contract', () => {
  beforeEach(() => { requests.length = 0; });

  test('tools require a caller root, accept an explicit project, and describe read-only freshness honestly', async () => {
    const { tools } = await handlers.get(ListToolsRequestSchema)();
    for (const name of ['briefing_generate', 'briefing_read']) {
      const tool = tools.find(item => item.name === name);
      expect(tool.inputSchema.required).toEqual(['project_root']);
      expect(tool.inputSchema.properties.project.type).toBe('string');
    }
    expect(tools.find(item => item.name === 'briefing_read').description).toContain('without writing files');
  });

  test('read puts the root in a query, never in the project path', async () => {
    await call('briefing_read', { project_root: '/fixture/nested space' });
    expect(requests).toEqual([{ method: 'GET', path: '/briefing?projectRoot=%2Ffixture%2Fnested%20space', body: undefined }]);
  });

  test.each(['auto', 'team:project'])('explicit project %s remains literal', async project => {
    await call('briefing_read', { project_root: '/fixture', project });
    expect(requests[0].path).toBe(`/briefing/${encodeURIComponent(project)}?projectRoot=%2Ffixture`);
    await call('briefing_generate', { project_root: '/fixture', project });
    expect(requests[1]).toEqual({ method: 'POST', path: '/briefing', body: { projectRoot: '/fixture', project } });
  });

  test('generation preserves omitted project instead of manufacturing auto', async () => {
    await call('briefing_generate', { project_root: '/fixture' });
    expect(requests).toEqual([{ method: 'POST', path: '/briefing', body: { projectRoot: '/fixture' } }]);
  });

  describe.each(['briefing_read', 'briefing_generate'])('%s', tool => {
    test.each([undefined, '', 42, null, {}, ['/fixture']])('a missing or malformed root %s cannot select the MCP or daemon cwd', async project_root => {
      await expect(call(tool, { project_root })).rejects.toThrow('project_root is required');
      expect(requests).toEqual([]);
    });
  });
});
