#!/usr/bin/env tsx
/**
 * pd-distress-allclear — the operator's signed ALL-CLEAR (ADR-0132 §4, phase 4).
 *
 * The node helper that `bin/pd-distress all-clear` (phase 0's dependency-free
 * shell script) shells out to for the ONE thing a shell script cannot do:
 * produce and verify an Ed25519 signature. Everything else about the register
 * stays in the shell floor.
 *
 *   npx tsx scripts/pd-distress-allclear.ts keygen              # once, operator only
 *   npx tsx scripts/pd-distress-allclear.ts status              # halt state + key fingerprint
 *   npx tsx scripts/pd-distress-allclear.ts all-clear --as erich [--repo <path>]
 *   npx tsx scripts/pd-distress-allclear.ts verify '<register line>'
 *
 * `keygen` and `all-clear` read the passphrase from the controlling TTY with
 * echo off. There is no `--passphrase` flag and no env var: a non-interactive
 * caller cannot sign, by design (a documented bypass is not a control,
 * ADR-0119). `verify` and `status` never need the private key and are safe for
 * any listener to run.
 *
 * Under the halt this repo is in as this is written, this script is the
 * operator's path to lift it. It does not talk to the daemon, `pd`, the relay,
 * or the network — A0 floor only.
 */

import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import {
  applyAllClear,
  defaultDistressPaths,
  liftHalt,
  loadOperatorPublicKey,
  publicKeyFingerprint,
  readHaltState,
  verifyAllClear,
  writeOperatorKeyFiles,
} from '../lib/distress-allclear.js';

function usage(code: number): never {
  const text = `usage:
  pd-distress-allclear keygen
  pd-distress-allclear status
  pd-distress-allclear all-clear --as <operator-id> [--repo <repo-root>]
  pd-distress-allclear verify '<register line>'`;
  (code === 0 ? console.log : console.error)(text);
  process.exit(code);
}

function arg(flag: string, argv: string[]): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function promptSecret(question: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error('refusing: the ALL-CLEAR passphrase is read from a TTY only; there is no flag or env var for it.');
    process.exit(3);
  }
  const muted = new Writable({ write(_chunk, _enc, cb) { cb(); } });
  const rl = createInterface({ input: process.stdin, output: muted, terminal: true });
  process.stdout.write(question);
  return new Promise((resolve) => {
    rl.question('', (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function main(argv: string[]): Promise<number> {
  const cmd = argv[0];
  if (!cmd || cmd === '-h' || cmd === '--help') usage(cmd ? 0 : 2);
  const repoRoot = arg('--repo', argv);
  const paths = defaultDistressPaths({ repoRoot });

  switch (cmd) {
    case 'keygen': {
      const p1 = await promptSecret('ALL-CLEAR passphrase (min 8 chars): ');
      const p2 = await promptSecret('again: ');
      if (p1 !== p2) { console.error('passphrases differ'); return 2; }
      const { fingerprint } = writeOperatorKeyFiles(paths, p1);
      console.log(`wrote ${paths.privateKeyFile} (0600) and ${paths.publicKeyFile}`);
      console.log(`operator ALL-CLEAR key fingerprint: ${fingerprint}`);
      console.log('record that fingerprint somewhere agents cannot edit (the incident runbook, a note on paper).');
      return 0;
    }

    case 'status': {
      const pub = loadOperatorPublicKey(paths);
      const ev = readHaltState({ paths, publicKey: pub, removeSentinelOnLift: false });
      console.log(`key: ${pub ? publicKeyFingerprint(pub) : 'NONE (run keygen)'}`);
      console.log(`state: ${ev.status.state}`);
      if (ev.status.halt) console.log(`halt: ${ev.status.halt.raw}`);
      if (ev.status.state !== 'clear') console.log(`sentinel: ${ev.status.sentinelPresent ? 'present' : 'ABSENT'}`);
      if (ev.status.state === 'lifted') console.log(`all-clear: ${ev.status.allClear.raw}`);
      for (const v of ev.violations) console.log(`violation: ${v.rule} (${v.reason}) ${v.line}`);
      return ev.status.state === 'hoisted' ? 1 : 0;
    }

    case 'all-clear':
    case 'sign': {
      const operatorId = arg('--as', argv);
      if (!operatorId) usage(2);
      const before = readHaltState({ paths, removeSentinelOnLift: false });
      if (before.status.state !== 'hoisted') {
        console.log(`nothing to lift: state is ${before.status.state}`);
        return 1;
      }
      console.log(`hoisted halt: ${before.status.halt.raw}`);
      const passphrase = await promptSecret('ALL-CLEAR passphrase: ');
      const result = liftHalt({ operatorId, passphrase, paths, repoRoot });
      if (!result.lifted) {
        console.error(`NOT lifted: ${result.reason}`);
        return 1;
      }
      console.log(`lifted. appended: ${result.line}`);
      console.log(`sentinel ${paths.haltFile} removed.`);
      return 0;
    }

    case 'verify': {
      const line = argv[1];
      if (!line) usage(2);
      const pub = loadOperatorPublicKey(paths);
      if (!pub) { console.error('no operator public key pinned; nothing can verify'); return 1; }
      const ev = readHaltState({ paths, publicKey: pub, removeSentinelOnLift: false, forensics: null });
      const expected = ev.status.state === 'hoisted' ? ev.status.halt.ts : undefined;
      const verdict = verifyAllClear(line, pub, expected);
      if (verdict.ok) { console.log(`ok: lifts halt ${verdict.haltTs}`); return 0; }
      console.log(`rejected: ${verdict.reason}`);
      return 1;
    }

    case 'apply': {
      // Apply an ALL-CLEAR line signed elsewhere (e.g. on another machine).
      const line = argv[1];
      if (!line) usage(2);
      const result = applyAllClear(line, { paths, repoRoot });
      if (result.lifted) { console.log(`lifted: ${result.line}`); return 0; }
      console.error(`NOT lifted: ${result.reason}`);
      return 1;
    }

    default:
      usage(2);
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  },
);
