/**
 * Fleet-dispatch pre-flight wiring for HITL operator interruptions
 * (docs/hitl-interruptions.md §4.3): `pd fleet up|run|approve` (and the
 * default run-agent-by-name path) must refuse to start NEW dependent work
 * while the interruptions gate reports a blocking critical ask.
 *
 * The gate's decision logic is covered in interruptions-cli.test.js; this
 * suite proves the WIRING — a blocked gate stops `handleFleet` before any
 * fleet machinery runs, and read-only subcommands never consult the gate.
 * Mirrors the jest.unstable_mockModule convention of agent-interrupt-cli.
 */

import { jest } from '@jest/globals';

const mockPreflight = jest.fn();

jest.unstable_mockModule('../../cli/commands/interruptions.js', () => ({
  preflightInterruptionsGate: mockPreflight,
}));

const { handleFleet } = await import('../../cli/commands/fleet.js');

describe('pd fleet — interruptions pre-flight wiring', () => {
  let exitSpy;
  const originalError = console.error;
  const originalLog = console.log;

  beforeEach(() => {
    jest.clearAllMocks();
    console.log = jest.fn();
    console.error = jest.fn();
    exitSpy = jest.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
  });

  afterEach(() => {
    exitSpy.mockRestore();
    console.error = originalError;
    console.log = originalLog;
  });

  test.each(['up', 'run', 'approve'])(
    'pd fleet %s exits 1 when the gate blocks (critical ask open)',
    async (subcommand) => {
      mockPreflight.mockResolvedValue(false);
      await expect(handleFleet([subcommand], {})).rejects.toThrow('process.exit(1)');
      expect(mockPreflight).toHaveBeenCalledWith(`pd fleet ${subcommand}`);
      expect(exitSpy).toHaveBeenCalledWith(1);
    },
  );

  test('read-only subcommands (validate) never consult the gate', async () => {
    mockPreflight.mockResolvedValue(false);
    // `validate` exits on its own when no pd-fleet.yml exists in cwd — either
    // way the gate must not have been consulted for a read-only subcommand.
    await handleFleet(['validate'], {}).catch(() => {});
    expect(mockPreflight).not.toHaveBeenCalled();
  });

  test('pd fleet help never consults the gate', async () => {
    mockPreflight.mockResolvedValue(false);
    await handleFleet(['help'], {}).catch(() => {});
    expect(mockPreflight).not.toHaveBeenCalled();
  });
});
