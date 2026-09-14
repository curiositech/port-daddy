#!/usr/bin/env tsx
/**
 * Test-only helper for scripts/pd-distress-drill.sh: pins an operator
 * ALL-CLEAR key and signs + applies an ALL-CLEAR without a TTY, so the drill's
 * jest driver can exercise ADR-0132 §5 step (d) "resumed only on a signed
 * ALL-CLEAR" end to end.
 *
 * This is NOT a product bypass of the TTY-only passphrase rule (ADR-0119):
 *   - it refuses any PD_HOME that is not a `distress-drill` scratch home, so
 *     it can never sign against the operator's real ~/.port-daddy;
 *   - the key it generates is a throwaway with a fixed, public passphrase and
 *     is written only under that scratch home (writeOperatorKeyFiles still
 *     refuses to overwrite an existing key);
 *   - the real operator CLI (scripts/pd-distress-allclear.ts) is untouched and
 *     still reads the passphrase from a TTY only.
 *
 *   tsx tests/helpers/distress-drill-allclear.ts keygen
 *   tsx tests/helpers/distress-drill-allclear.ts lift <operator-id> [<halt-ts>]
 */

import { defaultDistressPaths, liftHalt, writeOperatorKeyFiles } from '../../lib/distress-allclear.js';

const DRILL_PASSPHRASE = 'drill-only-passphrase-not-a-secret';

const home = process.env.PD_HOME ?? '';
if (!home.includes('distress-drill')) {
  console.error(`refusing: PD_HOME must be a distress-drill scratch home, got ${JSON.stringify(home)}`);
  process.exit(3);
}

const [cmd, operatorId, haltTs] = process.argv.slice(2);
const paths = defaultDistressPaths({ home, repoRoot: process.env.DRILL_REPO || undefined });

switch (cmd) {
  case 'keygen': {
    const { fingerprint } = writeOperatorKeyFiles(paths, DRILL_PASSPHRASE);
    console.log(`drill operator key pinned: ${fingerprint}`);
    break;
  }
  case 'lift': {
    if (!operatorId) {
      console.error('usage: lift <operator-id> [<halt-ts>]');
      process.exit(2);
    }
    const result = liftHalt({ operatorId, passphrase: DRILL_PASSPHRASE, paths, forensics: null });
    if (!result.lifted) {
      console.error(`NOT lifted: ${result.reason}`);
      process.exit(1);
    }
    if (haltTs && result.halt.ts !== haltTs) {
      console.error(`lifted halt ${result.halt.ts} but the drill expected ${haltTs}`);
      process.exit(1);
    }
    console.log(`lifted: ${result.line}`);
    break;
  }
  default:
    console.error('usage: distress-drill-allclear.ts keygen | lift <operator-id> [<halt-ts>]');
    process.exit(2);
}
