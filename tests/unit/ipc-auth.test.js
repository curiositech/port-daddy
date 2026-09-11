import { jest } from '@jest/globals';
import { IpcAction } from '../../lib/ipc-types.ts';
import {
  verifyAgent,
  actionRequiresRegistration,
  actionRequiresCredentialedTransport,
} from '../../lib/ipc-auth.ts';

describe('IPC Auth', () => {
  test('null verifier allows registration checks in test mode', () => {
    expect(verifyAgent('any', null, true).allowed).toBe(true);
    expect(verifyAgent('any', null, false).allowed).toBe(true);
    expect(verifyAgent(null, null, false).allowed).toBe(true);
  });

  test('registered-agent verification stays fail-closed when a verifier exists', () => {
    const verifier = { isRegistered: jest.fn((id) => id === 'real-agent' ? { id } : null) };

    expect(verifyAgent(null, verifier, true)).toMatchObject({
      allowed: false,
      reason: 'no_agent_id',
    });
    expect(verifyAgent('ghost', verifier, true)).toMatchObject({
      allowed: false,
      reason: 'agent_not_registered',
    });
    expect(verifyAgent('real-agent', verifier, true)).toMatchObject({
      allowed: true,
      agentId: 'real-agent',
    });
  });

  test.each([
    IpcAction.BEGIN,
    IpcAction.DONE,
    IpcAction.SESSION_START,
    IpcAction.SESSION_END,
    IpcAction.SESSION_REMOVE,
    IpcAction.SESSION_TAKEOVER,
    IpcAction.NOTE,
    IpcAction.FILES_CLAIM,
    IpcAction.FILES_RELEASE,
    IpcAction.LOCK_ACQUIRE,
    IpcAction.LOCK_EXTEND,
    IpcAction.LOCK_RELEASE,
    IpcAction.SALVAGE_CLAIM,
  ])('%s requires credentialed transport', (action) => {
    expect(actionRequiresCredentialedTransport(action)).toBe(true);
  });

  test.each([
    IpcAction.HEARTBEAT,
    IpcAction.SESSION_LIST,
    IpcAction.WHOAMI,
    IpcAction.LOCK_CHECK,
    IpcAction.LOCK_LIST,
    IpcAction.SALVAGE_LIST,
    IpcAction.FIND,
    IpcAction.SNIFF,
    IpcAction.FLEET_PROMPT,
  ])('%s remains available over IPC', (action) => {
    expect(actionRequiresCredentialedTransport(action)).toBe(false);
  });

  test('undefined action requires neither registration nor credentialed transport', () => {
    expect(actionRequiresRegistration(undefined)).toBe(false);
    expect(actionRequiresCredentialedTransport(undefined)).toBe(false);
  });
});
