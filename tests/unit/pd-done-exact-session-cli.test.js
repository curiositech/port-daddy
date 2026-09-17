/**
 * `pd done` must authorize the exact selected session with its stored actor
 * credential. The generated display agentId is lookup metadata, not a second
 * authority assertion on the final mutation.
 */
import { jest } from '@jest/globals';

const constructorOptions = [];
const whoami = jest.fn();
const done = jest.fn();
const clearCurrentContext = jest.fn();
const resolveCliActorCredential = jest.fn();

jest.unstable_mockModule('../../lib/client.js', () => ({
  default: class MockPortDaddy {
    constructor(options = {}) {
      constructorOptions.push(options);
    }

    whoami(options) {
      return whoami(options);
    }

    done(note, options) {
      return done(note, options);
    }
  },
}));

const currentContext = await import('../../cli/utils/current-context.js');
jest.unstable_mockModule('../../cli/utils/current-context.js', () => ({
  ...currentContext,
  clearCurrentContext,
  resolveCurrentContext: () => ({
    success: true,
    context: {
      agentId: 'agent-generated-display-id',
      sessionId: 'session-exact-owner',
    },
    provenance: null,
  }),
}));

const actorCredential = await import('../../cli/utils/actor-credential.js');
jest.unstable_mockModule('../../cli/utils/actor-credential.js', () => ({
  ...actorCredential,
  resolveCliActorCredential,
}));

const prompt = await import('../../cli/utils/prompt.js');
jest.unstable_mockModule('../../cli/utils/prompt.js', () => ({
  ...prompt,
  canPrompt: () => false,
}));

jest.unstable_mockModule('../../lib/db.js', () => ({
  initDatabase: () => {
    throw new Error('dispatch lookup intentionally unavailable in this unit test');
  },
}));

const { handleDone } = await import('../../cli/commands/sugar.js');

describe('pd done exact-session authority', () => {
  beforeEach(() => {
    constructorOptions.length = 0;
    whoami.mockReset();
    done.mockReset();
    clearCurrentContext.mockReset();
    resolveCliActorCredential.mockReset();

    whoami.mockResolvedValue({
      success: true,
      active: true,
      agentId: 'agent-generated-display-id',
      sessionId: 'session-exact-owner',
    });
    resolveCliActorCredential.mockReturnValue('ACTOR.owner-secret');
    done.mockResolvedValue({
      success: true,
      agentId: 'agent-generated-display-id',
      sessionId: 'session-exact-owner',
      sessionStatus: 'abandoned',
    });
  });

  test('uses the display agentId only to select the credential, then mutates by exact session', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await handleDone('Result: exact owner closed.', { status: 'abandoned', json: true });
    } finally {
      log.mockRestore();
    }

    expect(whoami).toHaveBeenCalledWith({
      agentId: 'agent-generated-display-id',
      sessionId: 'session-exact-owner',
    });
    expect(resolveCliActorCredential).toHaveBeenCalledWith('agent-generated-display-id');
    expect(constructorOptions).toEqual([
      { agentId: 'agent-generated-display-id' },
      { credential: 'ACTOR.owner-secret' },
    ]);
    expect(done).toHaveBeenCalledWith('Result: exact owner closed.', expect.objectContaining({
      sessionId: 'session-exact-owner',
      status: 'abandoned',
    }));
    expect(done.mock.calls[0][1]).not.toHaveProperty('agentId');
    expect(clearCurrentContext).toHaveBeenCalledTimes(1);
  });
});
