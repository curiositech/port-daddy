import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

const mockPdFetch = jest.fn();
const mockResolveCredential = jest.fn((agentId) => agentId === 'OWNER' ? 'OWNER.stored-secret' : undefined);
const mockUi = {
  error: jest.fn(),
  info: jest.fn(),
  success: jest.fn(),
  warn: jest.fn(),
};

jest.unstable_mockModule('../../cli/utils/fetch.js', () => ({
  pdFetch: mockPdFetch,
  PORT_DADDY_URL: 'http://localhost:9876',
}));
jest.unstable_mockModule('../../cli/utils/actor-credential.js', () => ({
  resolveCliActorCredential: mockResolveCredential,
}));
jest.unstable_mockModule('../../cli/utils/current-context.js', () => ({
  readCurrentContext: () => ({ agentId: 'OWNER', credential: 'OWNER.stored-secret' }),
}));
jest.unstable_mockModule('../../cli/utils/ui.js', () => mockUi);
jest.unstable_mockModule('../../cli/commands/messaging.js', () => ({
  handleSub: jest.fn(),
}));

const { handleInbox, handleSent } = await import('../../cli/commands/inbox.js');

function response(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return data; },
  };
}

describe('pd inbox canonical credential propagation', () => {
  let exit;

  beforeEach(() => {
    jest.clearAllMocks();
    exit = jest.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    exit.mockRestore();
    console.log.mockRestore();
    console.error.mockRestore();
  });

  test('list and sent reads present the stored exact-owner credential', async () => {
    mockPdFetch
      .mockResolvedValueOnce(response({ success: true, messages: [], count: 0 }))
      .mockResolvedValueOnce(response({ success: true, messages: [], count: 0 }));

    await handleInbox('list', [], { agent: 'OWNER', json: true });
    await handleSent({ agent: 'OWNER', json: true });

    expect(mockResolveCredential).toHaveBeenCalledWith('OWNER');
    expect(mockPdFetch.mock.calls[0]).toEqual([
      'http://localhost:9876/agents/OWNER/inbox',
      { headers: { 'x-actor-credential': 'OWNER.stored-secret' } },
    ]);
    expect(mockPdFetch.mock.calls[1]).toEqual([
      'http://localhost:9876/agents/OWNER/sent',
      { headers: { 'x-actor-credential': 'OWNER.stored-secret' } },
    ]);
  });

  test('send omits caller-authored from/type/wake fields and authenticates only by credential', async () => {
    mockPdFetch.mockResolvedValueOnce(response({ success: true, messageId: 1 }));

    await handleInbox('send', ['TARGET', 'review', 'this'], { agent: 'OWNER', json: true });

    const [url, init] = mockPdFetch.mock.calls[0];
    expect(url).toBe('http://localhost:9876/agents/TARGET/inbox');
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      'x-actor-credential': 'OWNER.stored-secret',
    });
    expect(JSON.parse(init.body)).toEqual({ content: 'review this' });
  });

  test('a caller-selected victim alias does not borrow the current soul credential', async () => {
    mockPdFetch.mockResolvedValueOnce(response({ success: true, messages: [], count: 0 }));
    await handleInbox('list', [], { agent: 'VICTIM', json: true });

    expect(mockResolveCredential).toHaveBeenCalledWith('VICTIM');
    expect(mockPdFetch.mock.calls[0][1].headers).toEqual({ 'x-actor-credential': '' });
  });

  test('removed clear form is an unknown command and never reaches the daemon', async () => {
    await expect(handleInbox('clear', [], { agent: 'OWNER' })).rejects.toThrow('process.exit(1)');
    expect(mockPdFetch).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
  });

  test('retired generic inbox watch fails locally without a daemon request', async () => {
    await expect(handleInbox('watch', [], { agent: 'OWNER' })).rejects.toThrow('process.exit(2)');
    expect(mockPdFetch).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(2);
  });
});
