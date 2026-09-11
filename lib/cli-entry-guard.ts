/** First CLI dependency: reject Off before command modules or DB initialization. */
import { assertLocalRuntimeEnabled } from './local-runtime-control.js';
// Only literal top-level help/version are exempt; adding a flag to an actuator
// must not turn it into an exemption. No command clears the stop markers here.
const args = process.argv.slice(2);
if (!(args.length === 1 && ['--help', '--version'].includes(args[0]))) {
  assertLocalRuntimeEnabled();
}
