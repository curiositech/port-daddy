/**
 * Unit Tests for shared/validators.js
 *
 * Tests every validator function with valid, invalid, and edge-case inputs.
 * These are pure functions — no daemon, no DB, no network required.
 */

import { describe, test, expect } from '@jest/globals';
import {
  validateProjectName,
  validateIdentity,
  validatePid,
  validatePort,
  validatePreferredPort,
  validateChannel,
  validateUrl,
  validateEnv,
  validateMetadata,
  validateStatus,
  validateLockName,
  validateAgentId,
  PROJECT_NAME_REGEX,
  IDENTITY_REGEX,
  PROJECT_NAME_MAX_LENGTH,
  PID_MIN,
  PID_MAX,
} from '../../shared/validators.js';

// ─── Constants ───────────────────────────────────────────────────────────────

describe('Constants', () => {
  test('PROJECT_NAME_REGEX is exported and is a RegExp', () => {
    expect(PROJECT_NAME_REGEX).toBeInstanceOf(RegExp);
  });

  test('IDENTITY_REGEX is exported and is a RegExp', () => {
    expect(IDENTITY_REGEX).toBeInstanceOf(RegExp);
  });

  test('PROJECT_NAME_MAX_LENGTH is 255', () => {
    expect(PROJECT_NAME_MAX_LENGTH).toBe(255);
  });

  test('PID_MIN is 1', () => {
    expect(PID_MIN).toBe(1);
  });

  test('PID_MAX is 99999', () => {
    expect(PID_MAX).toBe(99999);
  });
});

// ─── validateProjectName ─────────────────────────────────────────────────────

describe('validateProjectName', () => {
  test('accepts simple alphanumeric names', () => {
    expect(validateProjectName('myapp').valid).toBe(true);
    expect(validateProjectName('MyApp123').valid).toBe(true);
    expect(validateProjectName('app123').valid).toBe(true);
  });

  test('accepts names with dashes, underscores, dots', () => {
    expect(validateProjectName('my-app').valid).toBe(true);
    expect(validateProjectName('my_app').valid).toBe(true);
    expect(validateProjectName('my.app').valid).toBe(true);
    expect(validateProjectName('my-app_v2.0').valid).toBe(true);
  });

  test('rejects null and undefined', () => {
    expect(validateProjectName(null).valid).toBe(false);
    expect(validateProjectName(undefined).valid).toBe(false);
  });

  test('rejects empty string', () => {
    expect(validateProjectName('').valid).toBe(false);
  });

  test('rejects non-string types', () => {
    expect(validateProjectName(42).valid).toBe(false);
    expect(validateProjectName({}).valid).toBe(false);
    expect(validateProjectName([]).valid).toBe(false);
  });

  test('rejects names exceeding max length', () => {
    const tooLong = 'a'.repeat(PROJECT_NAME_MAX_LENGTH + 1);
    const result = validateProjectName(tooLong);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('too long');
  });

  test('accepts name exactly at max length', () => {
    const atMax = 'a'.repeat(PROJECT_NAME_MAX_LENGTH);
    expect(validateProjectName(atMax).valid).toBe(true);
  });

  test('rejects names with spaces', () => {
    expect(validateProjectName('my app').valid).toBe(false);
    expect(validateProjectName(' myapp').valid).toBe(false);
  });

  test('rejects names with special characters', () => {
    expect(validateProjectName('my@app').valid).toBe(false);
    expect(validateProjectName('my/app').valid).toBe(false);
    expect(validateProjectName('my:app').valid).toBe(false);
    expect(validateProjectName('my+app').valid).toBe(false);
    expect(validateProjectName('my=app').valid).toBe(false);
  });

  test('error message mentions invalid characters', () => {
    const result = validateProjectName('my app');
    expect(result.error).toContain('invalid characters');
  });
});

// ─── validateIdentity ────────────────────────────────────────────────────────

describe('validateIdentity', () => {
  test('accepts simple identity', () => {
    const result = validateIdentity('myapp:api:main');
    expect(result.valid).toBe(true);
  });

  test('accepts single-segment identity', () => {
    expect(validateIdentity('myapp').valid).toBe(true);
  });

  test('accepts wildcard segment', () => {
    expect(validateIdentity('myapp:*').valid).toBe(true);
    expect(validateIdentity('myapp:api:*').valid).toBe(true);
  });

  test('rejects null and undefined', () => {
    expect(validateIdentity(null).valid).toBe(false);
    expect(validateIdentity(undefined).valid).toBe(false);
  });

  test('rejects empty string', () => {
    expect(validateIdentity('').valid).toBe(false);
  });

  test('rejects identity exceeding 200 chars', () => {
    const tooLong = 'a'.repeat(201);
    const result = validateIdentity(tooLong);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('too long');
  });

  test('rejects identity with invalid characters', () => {
    const result = validateIdentity('my app:api');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('invalid characters');
  });

  test('rejects identity with @ symbol', () => {
    expect(validateIdentity('myapp@host').valid).toBe(false);
  });
});

// ─── validatePid ─────────────────────────────────────────────────────────────

describe('validatePid', () => {
  test('returns valid: true with pid: null when undefined', () => {
    const result = validatePid(undefined);
    expect(result.valid).toBe(true);
    expect(result.pid).toBeNull();
  });

  test('returns valid: true with pid: null when null', () => {
    const result = validatePid(null);
    expect(result.valid).toBe(true);
    expect(result.pid).toBeNull();
  });

  test('accepts valid PIDs', () => {
    expect(validatePid(1).valid).toBe(true);
    expect(validatePid(1234).valid).toBe(true);
    expect(validatePid(99999).valid).toBe(true);
  });

  test('returns parsed integer', () => {
    const result = validatePid('1234');
    expect(result.valid).toBe(true);
    expect(result.pid).toBe(1234);
  });

  test('rejects PID below minimum (0)', () => {
    expect(validatePid(0).valid).toBe(false);
    expect(validatePid(-1).valid).toBe(false);
  });

  test('rejects PID above maximum', () => {
    expect(validatePid(100000).valid).toBe(false);
  });

  test('rejects non-numeric strings', () => {
    expect(validatePid('abc').valid).toBe(false);
    expect(validatePid('').valid).toBe(false);
  });

  test('error message mentions PID range', () => {
    const result = validatePid(0);
    expect(result.error).toContain('1');
    expect(result.error).toContain('99999');
  });
});

// ─── validatePort ────────────────────────────────────────────────────────────

describe('validatePort', () => {
  test('returns null port for undefined', () => {
    const result = validatePort(undefined);
    expect(result.valid).toBe(true);
    expect(result.port).toBeNull();
  });

  test('returns null port for null', () => {
    const result = validatePort(null);
    expect(result.valid).toBe(true);
    expect(result.port).toBeNull();
  });

  test('accepts valid ports', () => {
    expect(validatePort(1).valid).toBe(true);
    expect(validatePort(80).valid).toBe(true);
    expect(validatePort(3000).valid).toBe(true);
    expect(validatePort(65535).valid).toBe(true);
  });

  test('rejects port 0', () => {
    expect(validatePort(0).valid).toBe(false);
  });

  test('rejects port above 65535', () => {
    expect(validatePort(65536).valid).toBe(false);
  });

  test('rejects negative port', () => {
    expect(validatePort(-1).valid).toBe(false);
  });

  test('parses string ports', () => {
    const result = validatePort('3000');
    expect(result.valid).toBe(true);
    expect(result.port).toBe(3000);
  });

  test('rejects non-numeric strings', () => {
    expect(validatePort('abc').valid).toBe(false);
  });

  test('error message mentions range', () => {
    const result = validatePort(0);
    expect(result.error).toContain('1');
    expect(result.error).toContain('65535');
  });
});

// ─── validatePreferredPort ───────────────────────────────────────────────────

describe('validatePreferredPort', () => {
  const rangeStart = 3000;
  const rangeEnd = 4000;
  const reserved = [3001, 3002];

  test('accepts null portValue (optional)', () => {
    const result = validatePreferredPort(null, rangeStart, rangeEnd, reserved);
    expect(result.valid).toBe(true);
    expect(result.port).toBeNull();
  });

  test('accepts valid port within range', () => {
    expect(validatePreferredPort(3500, rangeStart, rangeEnd, reserved).valid).toBe(true);
  });

  test('accepts boundary ports', () => {
    expect(validatePreferredPort(rangeStart, rangeStart, rangeEnd, reserved).valid).toBe(true);
    expect(validatePreferredPort(rangeEnd, rangeStart, rangeEnd, reserved).valid).toBe(true);
  });

  test('rejects port outside range (below)', () => {
    const result = validatePreferredPort(2999, rangeStart, rangeEnd, reserved);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('range');
  });

  test('rejects port outside range (above)', () => {
    const result = validatePreferredPort(4001, rangeStart, rangeEnd, reserved);
    expect(result.valid).toBe(false);
  });

  test('rejects reserved ports', () => {
    const result = validatePreferredPort(3001, rangeStart, rangeEnd, reserved);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('reserved');
  });

  test('propagates invalid port error', () => {
    const result = validatePreferredPort(0, rangeStart, rangeEnd, reserved);
    expect(result.valid).toBe(false);
  });
});

// ─── validateChannel ─────────────────────────────────────────────────────────

describe('validateChannel', () => {
  test('accepts simple channel names', () => {
    expect(validateChannel('mychannel').valid).toBe(true);
    expect(validateChannel('my-channel').valid).toBe(true);
    expect(validateChannel('my.channel').valid).toBe(true);
    expect(validateChannel('my:channel').valid).toBe(true);
  });

  test('accepts scoped channels', () => {
    expect(validateChannel('mayday:incident-42:all-stations').valid).toBe(true);
    expect(validateChannel('bridge:myapp:helm').valid).toBe(true);
  });

  test('accepts wildcard channels', () => {
    expect(validateChannel('myapp:*').valid).toBe(true);
  });

  test('rejects null and undefined', () => {
    expect(validateChannel(null).valid).toBe(false);
    expect(validateChannel(undefined).valid).toBe(false);
  });

  test('rejects empty string', () => {
    expect(validateChannel('').valid).toBe(false);
  });

  test('rejects channel exceeding 100 chars', () => {
    const result = validateChannel('a'.repeat(101));
    expect(result.valid).toBe(false);
    expect(result.error).toContain('too long');
  });

  test('rejects channel with spaces', () => {
    expect(validateChannel('my channel').valid).toBe(false);
  });

  test('rejects channel with @ or / chars', () => {
    expect(validateChannel('ch@nnel').valid).toBe(false);
    expect(validateChannel('ch/nnel').valid).toBe(false);
  });
});

// ─── validateUrl ─────────────────────────────────────────────────────────────

describe('validateUrl', () => {
  test('accepts http URLs', () => {
    expect(validateUrl('http://example.com').valid).toBe(true);
    expect(validateUrl('http://localhost:3000/webhook').valid).toBe(true);
  });

  test('accepts https URLs', () => {
    expect(validateUrl('https://example.com/api/hook').valid).toBe(true);
  });

  test('accepts ws and wss URLs', () => {
    expect(validateUrl('ws://example.com/socket').valid).toBe(true);
    expect(validateUrl('wss://example.com/socket').valid).toBe(true);
  });

  test('rejects null and undefined', () => {
    expect(validateUrl(null).valid).toBe(false);
    expect(validateUrl(undefined).valid).toBe(false);
  });

  test('rejects empty string', () => {
    expect(validateUrl('').valid).toBe(false);
  });

  test('rejects malformed URLs', () => {
    expect(validateUrl('not-a-url').valid).toBe(false);
    expect(validateUrl('://missing-protocol').valid).toBe(false);
  });

  test('rejects non-http protocols', () => {
    const result = validateUrl('ftp://example.com');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('protocol');
  });

  test('rejects file:// protocol', () => {
    expect(validateUrl('file:///etc/passwd').valid).toBe(false);
  });

  test('rejects URLs exceeding 2048 chars', () => {
    const longUrl = 'http://example.com/' + 'a'.repeat(2030);
    const result = validateUrl(longUrl);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('too long');
  });

  test('returns url property on success', () => {
    const result = validateUrl('http://example.com/hook');
    expect(result.valid).toBe(true);
    expect(result.url).toBe('http://example.com/hook');
  });

  test('rejects javascript: protocol', () => {
    expect(validateUrl('javascript:alert(1)').valid).toBe(false);
  });
});

// ─── validateEnv ─────────────────────────────────────────────────────────────

describe('validateEnv', () => {
  test('accepts lowercase alphanumeric envs', () => {
    expect(validateEnv('production').valid).toBe(true);
    expect(validateEnv('development').valid).toBe(true);
    expect(validateEnv('staging').valid).toBe(true);
    expect(validateEnv('test').valid).toBe(true);
  });

  test('accepts envs with dashes and underscores', () => {
    expect(validateEnv('prod-us-east').valid).toBe(true);
    expect(validateEnv('dev_local').valid).toBe(true);
  });

  test('accepts numeric chars', () => {
    expect(validateEnv('env1').valid).toBe(true);
    expect(validateEnv('stage2').valid).toBe(true);
  });

  test('rejects null and undefined', () => {
    expect(validateEnv(null).valid).toBe(false);
    expect(validateEnv(undefined).valid).toBe(false);
  });

  test('rejects empty string', () => {
    expect(validateEnv('').valid).toBe(false);
  });

  test('rejects uppercase letters', () => {
    const result = validateEnv('PRODUCTION');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('invalid characters');
  });

  test('rejects env exceeding 50 chars', () => {
    const result = validateEnv('a'.repeat(51));
    expect(result.valid).toBe(false);
    expect(result.error).toContain('too long');
  });

  test('rejects dots', () => {
    expect(validateEnv('prod.local').valid).toBe(false);
  });
});

// ─── validateMetadata ────────────────────────────────────────────────────────

describe('validateMetadata', () => {
  test('returns null metadata for undefined', () => {
    const result = validateMetadata(undefined);
    expect(result.valid).toBe(true);
    expect(result.metadata).toBeNull();
  });

  test('returns null metadata for null', () => {
    const result = validateMetadata(null);
    expect(result.valid).toBe(true);
    expect(result.metadata).toBeNull();
  });

  test('accepts an object', () => {
    const meta = { foo: 'bar', count: 42 };
    const result = validateMetadata(meta);
    expect(result.valid).toBe(true);
    expect(result.metadata).toEqual(meta);
  });

  test('accepts nested objects', () => {
    const meta = { nested: { a: 1, b: [1, 2, 3] } };
    expect(validateMetadata(meta).valid).toBe(true);
  });

  test('rejects metadata that serializes to > 10KB', () => {
    const big = { data: 'x'.repeat(10001) };
    const result = validateMetadata(big);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('too large');
  });

  test('accepts metadata right at the size limit', () => {
    // JSON.stringify adds {"data":""}, so we need exactly 10000 chars total
    const data = 'x'.repeat(10000 - '{"data":""}'.length);
    const meta = { data };
    expect(validateMetadata(meta).valid).toBe(true);
  });
});

// ─── validateStatus ──────────────────────────────────────────────────────────

describe('validateStatus', () => {
  test('accepts all valid statuses', () => {
    expect(validateStatus('assigned').valid).toBe(true);
    expect(validateStatus('running').valid).toBe(true);
    expect(validateStatus('stopped').valid).toBe(true);
    expect(validateStatus('crashed').valid).toBe(true);
  });

  test('returns undefined status for falsy input', () => {
    const result = validateStatus(null);
    expect(result.valid).toBe(true);
    expect(result.status).toBeUndefined();
  });

  test('returns undefined status for empty string', () => {
    const result = validateStatus('');
    expect(result.valid).toBe(true);
    expect(result.status).toBeUndefined();
  });

  test('rejects unknown status', () => {
    const result = validateStatus('unknown');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('invalid status');
  });

  test('rejects case-mismatched statuses', () => {
    expect(validateStatus('Running').valid).toBe(false);
    expect(validateStatus('RUNNING').valid).toBe(false);
    expect(validateStatus('ASSIGNED').valid).toBe(false);
  });

  test('returns the status value on success', () => {
    expect(validateStatus('running').status).toBe('running');
  });
});

// ─── validateLockName ────────────────────────────────────────────────────────

describe('validateLockName', () => {
  test('accepts simple lock names', () => {
    expect(validateLockName('mylock').valid).toBe(true);
    expect(validateLockName('deploy-lock').valid).toBe(true);
    expect(validateLockName('db.write').valid).toBe(true);
  });

  test('accepts scoped lock names', () => {
    expect(validateLockName('db:write').valid).toBe(true);
    expect(validateLockName('fs:critical').valid).toBe(true);
  });

  test('accepts wildcard', () => {
    expect(validateLockName('myapp:*').valid).toBe(true);
  });

  test('rejects null and undefined', () => {
    expect(validateLockName(null).valid).toBe(false);
    expect(validateLockName(undefined).valid).toBe(false);
  });

  test('rejects empty string', () => {
    expect(validateLockName('').valid).toBe(false);
  });

  test('rejects lock name exceeding 100 chars', () => {
    const result = validateLockName('a'.repeat(101));
    expect(result.valid).toBe(false);
    expect(result.error).toContain('too long');
  });

  test('rejects names with spaces', () => {
    expect(validateLockName('my lock').valid).toBe(false);
  });

  test('rejects names with @ or /', () => {
    expect(validateLockName('my@lock').valid).toBe(false);
    expect(validateLockName('my/lock').valid).toBe(false);
  });
});

// ─── validateAgentId ─────────────────────────────────────────────────────────

describe('validateAgentId', () => {
  test('accepts simple agent IDs', () => {
    expect(validateAgentId('agent-001').valid).toBe(true);
    expect(validateAgentId('worker_1').valid).toBe(true);
    expect(validateAgentId('claude-3-opus').valid).toBe(true);
  });

  test('accepts alphanumeric IDs', () => {
    expect(validateAgentId('AGENT001').valid).toBe(true);
    expect(validateAgentId('agent123').valid).toBe(true);
  });

  test('accepts dots and colons', () => {
    expect(validateAgentId('myapp:api.main').valid).toBe(true);
  });

  test('rejects null and undefined', () => {
    expect(validateAgentId(null).valid).toBe(false);
    expect(validateAgentId(undefined).valid).toBe(false);
  });

  test('rejects empty string', () => {
    expect(validateAgentId('').valid).toBe(false);
  });

  test('rejects ID exceeding 100 chars', () => {
    const result = validateAgentId('a'.repeat(101));
    expect(result.valid).toBe(false);
    expect(result.error).toContain('too long');
  });

  test('rejects IDs with spaces', () => {
    expect(validateAgentId('my agent').valid).toBe(false);
  });

  test('rejects IDs with @ or /', () => {
    expect(validateAgentId('agent@host').valid).toBe(false);
    expect(validateAgentId('agent/1').valid).toBe(false);
  });

  test('error message mentions invalid characters', () => {
    const result = validateAgentId('agent/1');
    expect(result.error).toContain('invalid characters');
  });
});
