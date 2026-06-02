/**
 * Tests for cli/utils/destructive-confirm.ts
 *
 * The helper has four behaviors:
 *   - --yes / -y bypass returns true and prints the audit summary.
 *   - PORT_DADDY_YES=1 bypass returns true and prints the audit summary.
 *   - Interactive TTY with user "yes" returns true.
 *   - Interactive TTY with user "no" returns false.
 *   - Non-TTY without --yes returns false.
 *   - The summary is ALWAYS printed to stderr regardless of branch.
 */

import { jest } from '@jest/globals';

const { requireConfirmation, DESTRUCTIVE_EXIT_CODE } = await import(
  '../../cli/utils/destructive-confirm.js'
);

function makeStderr() {
  const lines = [];
  return {
    write(msg) {
      lines.push(msg);
    },
    lines,
    joined() {
      return lines.join('');
    },
  };
}

describe('requireConfirmation: bypass paths', () => {
  test('--yes flag bypasses the prompt and returns true', async () => {
    const stderr = makeStderr();
    const result = await requireConfirmation({
      summary: 'will release 3 file claims',
      args: { yes: true },
      writeStderr: stderr.write,
      canPrompt: () => false,
      prompt: async () => {
        throw new Error('prompt should not be called when --yes');
      },
    });
    expect(result).toBe(true);
    expect(stderr.joined()).toMatch(/destructive: will release 3 file claims/);
    expect(stderr.joined()).toMatch(/bypassed via --yes/);
  });

  test('-y short flag bypasses the prompt', async () => {
    const stderr = makeStderr();
    const result = await requireConfirmation({
      summary: 'will release 3 file claims',
      args: { y: true },
      writeStderr: stderr.write,
      canPrompt: () => false,
      prompt: async () => {
        throw new Error('prompt should not be called when -y');
      },
    });
    expect(result).toBe(true);
  });

  test('PORT_DADDY_YES=1 env var bypasses the prompt', async () => {
    const stderr = makeStderr();
    const result = await requireConfirmation({
      summary: 'will release 3 file claims',
      args: {},
      env: { PORT_DADDY_YES: '1' },
      writeStderr: stderr.write,
      canPrompt: () => false,
      prompt: async () => {
        throw new Error('prompt should not be called with env bypass');
      },
    });
    expect(result).toBe(true);
    expect(stderr.joined()).toMatch(/bypassed via --yes \/ PORT_DADDY_YES/);
  });

  test('PORT_DADDY_YES=true env var also bypasses', async () => {
    const stderr = makeStderr();
    const result = await requireConfirmation({
      summary: 'x',
      args: {},
      env: { PORT_DADDY_YES: 'true' },
      writeStderr: stderr.write,
      canPrompt: () => false,
      prompt: async () => {
        throw new Error('prompt should not be called');
      },
    });
    expect(result).toBe(true);
  });
});

describe('requireConfirmation: non-interactive refusal', () => {
  test('returns false when not a TTY and --yes is missing', async () => {
    const stderr = makeStderr();
    const result = await requireConfirmation({
      summary: 'will release 3 file claims from agent abc-123',
      args: {},
      env: {},
      writeStderr: stderr.write,
      canPrompt: () => false,
      prompt: async () => {
        throw new Error('prompt should not be called in non-interactive mode');
      },
    });
    expect(result).toBe(false);
    // Impact summary is emitted (audit trail) ...
    expect(stderr.joined()).toMatch(/will release 3 file claims from agent abc-123/);
    expect(stderr.joined()).toMatch(/refusing in non-interactive mode/);
    // ... but the refusal NEVER advertises its own bypass (guardrails-never-name-
    // their-override rule; CWE-1390). --yes stays in `pd <cmd> --help` for humans.
    expect(stderr.joined()).not.toMatch(/--yes|-y\b|PORT_DADDY_YES/);
  });
});

describe('requireConfirmation: interactive prompts', () => {
  test('returns true when user confirms in TTY', async () => {
    const stderr = makeStderr();
    const result = await requireConfirmation({
      summary: 'dismiss agent xyz',
      args: {},
      env: {},
      writeStderr: stderr.write,
      canPrompt: () => true,
      prompt: async () => true,
    });
    expect(result).toBe(true);
    expect(stderr.joined()).toMatch(/dismiss agent xyz/);
    expect(stderr.joined()).toMatch(/confirmed by user/);
  });

  test('returns false when user declines in TTY', async () => {
    const stderr = makeStderr();
    const result = await requireConfirmation({
      summary: 'dismiss agent xyz',
      args: {},
      env: {},
      writeStderr: stderr.write,
      canPrompt: () => true,
      prompt: async () => false,
    });
    expect(result).toBe(false);
    expect(stderr.joined()).toMatch(/cancelled by user/);
  });

  test('prompt receives the summary so the user sees impact', async () => {
    const stderr = makeStderr();
    let receivedMessage;
    await requireConfirmation({
      summary: 'release 12 ports across all projects',
      args: {},
      env: {},
      writeStderr: stderr.write,
      canPrompt: () => true,
      prompt: async (msg) => {
        receivedMessage = msg;
        return true;
      },
    });
    expect(receivedMessage).toContain('release 12 ports across all projects');
  });
});

describe('requireConfirmation: audit trail', () => {
  test('summary is always printed to stderr regardless of branch', async () => {
    // --yes bypass
    {
      const stderr = makeStderr();
      await requireConfirmation({
        summary: 'IMPACT-A',
        args: { yes: true },
        env: {},
        writeStderr: stderr.write,
        canPrompt: () => false,
        prompt: async () => true,
      });
      expect(stderr.joined()).toContain('IMPACT-A');
    }
    // Non-TTY refusal
    {
      const stderr = makeStderr();
      await requireConfirmation({
        summary: 'IMPACT-B',
        args: {},
        env: {},
        writeStderr: stderr.write,
        canPrompt: () => false,
        prompt: async () => true,
      });
      expect(stderr.joined()).toContain('IMPACT-B');
    }
    // Interactive yes
    {
      const stderr = makeStderr();
      await requireConfirmation({
        summary: 'IMPACT-C',
        args: {},
        env: {},
        writeStderr: stderr.write,
        canPrompt: () => true,
        prompt: async () => true,
      });
      expect(stderr.joined()).toContain('IMPACT-C');
    }
    // Interactive no
    {
      const stderr = makeStderr();
      await requireConfirmation({
        summary: 'IMPACT-D',
        args: {},
        env: {},
        writeStderr: stderr.write,
        canPrompt: () => true,
        prompt: async () => false,
      });
      expect(stderr.joined()).toContain('IMPACT-D');
    }
  });
});

describe('DESTRUCTIVE_EXIT_CODE constant', () => {
  test('is the conventional SIGINT-style 130', () => {
    expect(DESTRUCTIVE_EXIT_CODE).toBe(130);
  });
});
