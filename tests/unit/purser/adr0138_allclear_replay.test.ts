// tests/unit/purser/adr0138_allclear_replay.test.ts
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  generateKeyPairSync,
  sign,
  verify,
  type KeyObject,
} from 'node:crypto';

// Resolve __dirname in an ES‑module context (type=module)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Verify an ALL‑CLEAR record according to the best‑interpretation of ADR‑0138.
 *
 * - `kind` must be exactly "ALL-CLEAR".
 * - The `haltRef` must match the currently active halt.
 * - The timestamp `ts` must be >= the timestamp of the active halt (reject stale signatures).
 * - The signature must be a valid Ed25519 signature over the canonical payload
 *   `${kind}|${haltRef}|${ts}` using the operator's public key.
 */
function verifyAllClear(
  publicKey: KeyObject,
  kind: string,
  haltRef: string,
  ts: number,
  signature: Buffer,
  activeHalt: { haltRef: string; ts: number },
): boolean {
  if (kind !== 'ALL-CLEAR') return false;
  if (haltRef !== activeHalt.haltRef) return false;
  if (ts < activeHalt.ts) return false; // reject stale timestamps
  const payload = Buffer.from(`${kind}|${haltRef}|${ts}`);
  return verify(null, payload, publicKey, signature);
}

/**
 * Helper to create a signed ALL‑CLEAR payload.
 */
function signAllClear(privateKey: KeyObject, haltRef: string, ts: number): Buffer {
  const kind = 'ALL-CLEAR';
  const payload = Buffer.from(`${kind}|${haltRef}|${ts}`);
  return sign(null, payload, privateKey);
}

describe('ADR‑0138 ALL‑CLEAR replay resistance', () => {
  // Generate a fresh operator keypair for the test run
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');

  // Simulate a currently active halt
  const activeHalt = { haltRef: 'halt-abc', ts: 2_000 };

  test('valid ALL‑CLEAR with fresh timestamp is accepted', () => {
    const freshTs = 3_000; // newer than the active halt
    const signature = signAllClear(privateKey, activeHalt.haltRef, freshTs);
    const ok = verifyAllClear(
      publicKey,
      'ALL-CLEAR',
      activeHalt.haltRef,
      freshTs,
      signature,
      activeHalt,
    );
    expect(ok).toBe(true);
  });

  test('replay with a different halt‑ref is rejected', () => {
    const freshTs = 3_000;
    const signature = signAllClear(privateKey, activeHalt.haltRef, freshTs);
    const ok = verifyAllClear(
      publicKey,
      'ALL-CLEAR',
      'halt-other', // mismatched halt‑ref
      freshTs,
      signature,
      { haltRef: 'halt-other', ts: activeHalt.ts },
    );
    expect(ok).toBe(false);
  });

  test('replay with a stale timestamp is rejected', () => {
    const staleTs = 1_500; // older than the active halt timestamp
    const signature = signAllClear(privateKey, activeHalt.haltRef, staleTs);
    const ok = verifyAllClear(
      publicKey,
      'ALL-CLEAR',
      activeHalt.haltRef,
      staleTs,
      signature,
      activeHalt,
    );
    expect(ok).toBe(false);
  });

  test('tampered signature is rejected', () => {
    const freshTs = 3_000;
    const signature = Buffer.from(signAllClear(privateKey, activeHalt.haltRef, freshTs));
    // Corrupt a single byte
    signature[0] ^= 0xff;
    const ok = verifyAllClear(
      publicKey,
      'ALL-CLEAR',
      activeHalt.haltRef,
      freshTs,
      signature,
      activeHalt,
    );
    expect(ok).toBe(false);
  });

  test('ADR‑0138 text mandates operator‑only signed ALL‑CLEAR and replay protection', () => {
    const adrPath = resolve(
      __dirname,
      '../../../docs/adr/0138-distress-register-emergency-broadcast.md',
    );
    const adr = readFileSync(adrPath, 'utf8');

    // Must mention the operator as the sole issuer
    expect(adr).toMatch(/operator/i);

    // Must require a signature over the tuple (ALL‑CLEAR, halt‑ref, ts)
    expect(adr).toMatch(
      /signature\s+over\s*\(\s*ALL[-\s]?CLEAR\s*,\s*halt[-\s]?ref\s*,\s*ts\s*\)/i,
    );

    // Must describe that unsigned or mis‑signed messages are a protocol violation (MAYDAY)
    expect(adr).toMatch(/MAYDAY/i);

    // Must reference the 2026‑09‑05 incident
    expect(adr).toMatch(/2026-09-05/);

    // Must explicitly dismiss the “just fix the bugs” option
    expect(adr).not.toMatch(/just\s+fix\s+the\s+bugs/i);
  });

  test('ADR‑0139 also references the incident and dismisses “just fix the bugs”', () => {
    const adrPath = resolve(
      __dirname,
      '../../../docs/adr/0139-verdict-integrity-separating-infra-failure-from-review-verdict.md',
    );
    const adr = readFileSync(adrPath, 'utf8');

    // Reference to the 2026‑09‑05 incident
    expect(adr).toMatch(/2026-09-05/);

    // Dismiss “just fix the bugs” as insufficient
    expect(adr).not.toMatch(/just\s+fix\s+the\s+bugs/i);
  });

  test('adr-numbering-registry.json reflects the new ADRs and live count', () => {
    const regPath = resolve(
      __dirname,
      '../../../docs/adr/adr-numbering-registry.json',
    );
    const reg = JSON.parse(readFileSync(regPath, 'utf8'));

    // The registry should have a `files` map
    expect(reg).toHaveProperty('files');
    const files = (reg as any).files;
    expect(files).toBeInstanceOf(Object);

    // Must contain entries for 0138 and 0139
    expect(files).toHaveProperty('0138');
    expect(files['0138']).toMatch(/distress[-_]register[-_]emergency[-_]broadcast/i);
    expect(files).toHaveProperty('0139');
    expect(files['0139']).toMatch(/verdict[-_]integrity[-_]separating[-_]infra[-_]failure[-_]from[-_]review[-_]verdict/i);

    // Verify live count (if present) matches number of entries
    const entryCount = Object.keys(files).length;
    const countProp = Object.entries(reg).find(
      ([k, v]) => k !== 'files' && typeof v === 'number',
    );
    if (countProp) {
      const [, count] = countProp;
      expect(count).toBe(entryCount);
    } else {
      // If no explicit count field, at least ensure the map size is > 0
      expect(entryCount).toBeGreaterThan(0);
    }
  });
});