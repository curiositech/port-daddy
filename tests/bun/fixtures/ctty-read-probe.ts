/**
 * Probe binary for the `/dev/tty` line-reader pty test.
 *
 * Run under a real pty (`script`) by tests/bun/ctty-line-read.test.ts. Prints
 * exactly one marker line so the parent can assert on the read result without
 * having to parse the terminal echo that surrounds it.
 */
import { readLineFromControllingTerminal } from '../../../cli/utils/tty.ts';

const line = readLineFromControllingTerminal();
process.stdout.write(`\nPROBE_RESULT:${JSON.stringify(line)}\n`);
process.exit(0);
