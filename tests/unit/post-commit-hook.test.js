import { describe, expect, test } from '@jest/globals';
import {
  isLegacyPortDaddyPostCommitHook,
  isPortDaddyPostCommitHook,
  isScopedPortDaddyPostCommitHook,
} from '../../cli/utils/post-commit-hook.js';

describe('post-commit hook detection', () => {
  test('recognizes legacy naked git:committed Port Daddy hook', () => {
    const content = `#!/usr/bin/env zsh
# Port Daddy Post-Commit Hook
curl -s -X POST "\${PD_URL}/msg/git:committed" -d "{}"
`;

    expect(isPortDaddyPostCommitHook(content)).toBe(true);
    expect(isLegacyPortDaddyPostCommitHook(content)).toBe(true);
    expect(isScopedPortDaddyPostCommitHook(content)).toBe(false);
  });

  test('recognizes scoped Port Daddy hook as current', () => {
    const content = `#!/usr/bin/env zsh
# Port Daddy Post-Commit Hook
CHANNEL="project:port-daddy:abc123:git:committed"
curl -s -X POST "\${PORT_DADDY_BASE}/msg/\${CHANNEL}" -d "{}"
`;

    expect(isPortDaddyPostCommitHook(content)).toBe(true);
    expect(isLegacyPortDaddyPostCommitHook(content)).toBe(false);
    expect(isScopedPortDaddyPostCommitHook(content)).toBe(true);
  });

  test('does not treat foreign hooks as Port Daddy hooks', () => {
    const content = `#!/bin/sh
echo "hello from custom hook"
`;

    expect(isPortDaddyPostCommitHook(content)).toBe(false);
    expect(isLegacyPortDaddyPostCommitHook(content)).toBe(false);
    expect(isScopedPortDaddyPostCommitHook(content)).toBe(false);
  });
});
