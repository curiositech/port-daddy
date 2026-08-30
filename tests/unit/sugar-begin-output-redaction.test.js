import { describe, expect, test } from '@jest/globals';
import {
  detachBeginCredential,
  renderBeginSessionExports,
} from '../../cli/commands/sugar.js';

describe('pd begin credential output boundary', () => {
  test('detaches the one-time credential before JSON or human rendering', () => {
    const secret = 'actor-selector.once-only-secret';
    const response = {
      success: true,
      agentId: 'agent-safe',
      sessionId: 'session-safe',
      credential: secret,
    };

    expect(detachBeginCredential(response)).toBe(secret);
    expect(response).not.toHaveProperty('credential');
    expect(JSON.stringify(response)).not.toContain(secret);
  });

  test('bash, zsh, and fish exports contain selectors but never an authority variable', () => {
    for (const shell of ['/bin/bash', '/bin/zsh', '/opt/homebrew/bin/fish']) {
      const output = renderBeginSessionExports('agent-safe', 'session-safe', shell).join('\n');
      expect(output).toContain('PD_AGENT_ID');
      expect(output).toContain('PD_SESSION_ID');
      expect(output).not.toContain('PD_ACTOR_CREDENTIAL');
      expect(output).not.toMatch(/credential|secret/i);
    }
  });
});
