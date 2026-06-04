/**
 * `pd account` — first-class user identity (ADR-0029, Phases A0 + A1).
 *
 *   pd account create         # mint the account-owned Ed25519 identity (A0)
 *   pd account status         # account, this device, and bound devices
 *   pd account pair           # bilaterally-signed pairing receipt (A1)
 *   pd account list-devices   # enumerate account⇄daemon pairings
 *   pd account revoke-device  # revoke one device's pairing (local marker)
 *
 * Everything here is local and offline. The account key is the durable
 * cross-device identity that pairing receipts, the Merkle audit forest, and
 * the relay mesh all build on — but none of that transport is wired here.
 */
import * as ui from '../utils/ui.js';
import type { CLIOptions } from '../types.js';
import {
  createAccount,
  accountExists,
  loadAccount,
  loadDevice,
  loadPairings,
  pairLocalDevice,
  revokePairing,
  verifyPairingReceipt,
  accountPubkeyRaw,
  devicePubkeyRaw,
  type PairingReceipt,
} from '../../lib/account.js';

function fmtTime(ms: number): string {
  if (!ms) return '—';
  return new Date(ms).toISOString().replace('T', ' ').replace(/\.\d+Z$/, 'Z');
}

function parseCapabilities(opt: unknown): string[] | undefined {
  if (opt === undefined) return undefined;
  const list = Array.isArray(opt) ? opt : [opt];
  return list
    .flatMap((v) => String(v).split(','))
    .map((s) => s.trim())
    .filter(Boolean);
}

function receiptStatus(r: PairingReceipt, now: number): string {
  if (r.revokedAt) return 'revoked';
  if (r.expiresAt !== 0 && now > r.expiresAt) return 'expired';
  return 'active';
}

export async function handleAccount(positional: string[], options: CLIOptions): Promise<void> {
  const sub = positional[0] ?? 'status';
  const opts = options as Record<string, unknown>;

  switch (sub) {
    case 'create': {
      if (accountExists() && !options.force) {
        ui.error('An account already exists. `pd account status` to inspect, or --force to rotate (this changes your account id).');
        process.exit(1);
      }
      const account = createAccount({
        displayName: typeof opts.name === 'string' ? (opts.name as string) : undefined,
        force: !!options.force,
      });
      if (options.json) {
        process.stdout.write(JSON.stringify(account, null, 2) + '\n');
        return;
      }
      ui.success('Account created.');
      ui.message(`  account id   ${account.accountId}`);
      ui.message(`  public key   ${account.accountPubkey}`);
      ui.message(`  display name ${account.displayName || '(none)'}`);
      ui.message('');
      ui.info('Private key stored in the OS keychain (or ~/.config/port-daddy/account.key on platforms without one).');
      ui.info('Next: `pd account pair` to bind this device to the account.');
      return;
    }

    case 'pair': {
      if (!accountExists()) {
        ui.error('No account yet. Run `pd account create` first.');
        process.exit(1);
      }
      const label = typeof opts.label === 'string' ? (opts.label as string) : undefined;
      const days = opts['expires-days'];
      const expiresAt = days !== undefined ? Date.now() + Number(days) * 86_400_000 : 0;
      const capabilities = parseCapabilities(opts.capability ?? opts.cap);
      let receipt: PairingReceipt;
      try {
        receipt = pairLocalDevice({ deviceLabel: label, expiresAt, capabilities });
      } catch (err) {
        ui.error(`Pairing failed: ${(err as Error).message}`);
        process.exit(1);
        return;
      }
      if (options.json) {
        process.stdout.write(JSON.stringify(receipt, null, 2) + '\n');
        return;
      }
      ui.success('Device paired — receipt co-signed by account + daemon keys.');
      ui.message(`  device label   ${receipt.deviceLabel}`);
      ui.message(`  fingerprint    ${receipt.daemonFingerprint}`);
      ui.message(`  capabilities   ${receipt.capabilities.join(', ')}`);
      ui.message(`  expires        ${receipt.expiresAt ? fmtTime(receipt.expiresAt) : 'never'}`);
      ui.message(`  nonce          ${receipt.nonce}`);
      return;
    }

    case 'list-devices':
    case 'devices': {
      const pairings = loadPairings();
      if (options.json) {
        process.stdout.write(JSON.stringify(pairings, null, 2) + '\n');
        return;
      }
      if (pairings.length === 0) {
        ui.info('No paired devices. Run `pd account pair` to bind this device.');
        return;
      }
      const account = loadAccount();
      const device = loadDevice();
      const now = Date.now();
      const rows = pairings.map((r) => {
        let verified = '—';
        // We can only fully verify a receipt whose device key we hold locally.
        if (account && device && device.daemonFingerprint === r.daemonFingerprint) {
          const res = verifyPairingReceipt(r, accountPubkeyRaw(account), devicePubkeyRaw(device), now);
          verified = res.valid ? 'yes' : res.accountSigValid && res.daemonSigValid ? 'sig-ok' : 'NO';
        }
        return [
          r.deviceLabel || '(unlabeled)',
          r.daemonFingerprint.slice(0, 16) + '…',
          receiptStatus(r, now),
          verified,
          fmtTime(r.issuedAt),
        ];
      });
      ui.table(['DEVICE', 'FINGERPRINT', 'STATUS', 'VERIFIED', 'ISSUED'], rows, { title: 'Paired devices' });
      return;
    }

    case 'revoke-device':
    case 'revoke': {
      const fingerprint = positional[1];
      if (!fingerprint) {
        ui.error('Usage: pd account revoke-device <fingerprint>');
        process.exit(1);
      }
      // Accept a unique prefix for convenience.
      const matches = loadPairings()
        .filter((r) => !r.revokedAt && r.daemonFingerprint.startsWith(fingerprint))
        .map((r) => r.daemonFingerprint);
      const unique = [...new Set(matches)];
      if (unique.length === 0) {
        ui.error(`No active pairing matches fingerprint "${fingerprint}".`);
        process.exit(1);
      }
      if (unique.length > 1) {
        ui.error(`Fingerprint "${fingerprint}" is ambiguous (${unique.length} matches). Use more characters.`);
        process.exit(1);
      }
      const ok = revokePairing(unique[0]);
      if (options.json) {
        process.stdout.write(JSON.stringify({ revoked: ok, fingerprint: unique[0] }, null, 2) + '\n');
        return;
      }
      if (ok) ui.success(`Revoked pairing ${unique[0].slice(0, 16)}… (local marker).`);
      else ui.error('Nothing revoked.');
      return;
    }

    case 'status':
    default: {
      const account = loadAccount();
      const device = loadDevice();
      const pairings = loadPairings();
      const now = Date.now();
      const active = pairings.filter((r) => receiptStatus(r, now) === 'active');
      if (options.json) {
        process.stdout.write(
          JSON.stringify(
            {
              account,
              device,
              pairings: { total: pairings.length, active: active.length },
            },
            null,
            2,
          ) + '\n',
        );
        return;
      }
      if (!account) {
        ui.info('No account yet. Run `pd account create` to mint your cross-device identity.');
        return;
      }
      ui.message(ui.fmtBold('Account'));
      ui.message(`  id            ${account.accountId}`);
      ui.message(`  public key    ${account.accountPubkey}`);
      ui.message(`  display name  ${account.displayName || '(none)'}`);
      ui.message(`  created       ${fmtTime(account.createdAt)}`);
      ui.message(`  oidc          ${account.oidcBindings.length ? account.oidcBindings.map((b) => b.subject).join(', ') : '(none — local-only identity)'}`);
      ui.message('');
      ui.message(ui.fmtBold('This device'));
      if (device) {
        ui.message(`  label         ${device.label}`);
        ui.message(`  fingerprint   ${device.daemonFingerprint}`);
      } else {
        ui.message('  (not yet established — run `pd account pair`)');
      }
      ui.message('');
      ui.message(ui.fmtBold('Bound devices'));
      ui.message(`  ${active.length} active / ${pairings.length} total — see \`pd account list-devices\``);
      return;
    }
  }
}
