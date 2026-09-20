/**
 * lib/distress-allclear-pins.ts — the committed trust root for the signed
 * ALL-CLEAR (ADR-0132 §4, phase 4).
 *
 * Every file under `~/.port-daddy` is writable by the operator's own user,
 * which is the user every agent runs as. So the on-disk public key
 * (`~/.port-daddy/operator-allclear.pub`) cannot be the trust root on its own:
 * an agent could mint a keypair, overwrite the `.pub`, sign an ALL-CLEAR with
 * the matching private key, and lift the halt without ever touching a TTY.
 *
 * This file is that trust root. It is source, compiled into the CLI and the
 * daemon; a key swap here is a commit in git history with an author, a review,
 * and a diff — not a silent `writeFileSync`. `loadOperatorPublicKey()` refuses
 * an on-disk key whose fingerprint is not listed here, and `readHaltState()`
 * journals `KEY_ROTATED` (ADR-0089, critical) and keeps the halt in force.
 *
 * ── Pinning a key (operator runbook) ─────────────────────────────────────────
 *
 *   1. `npx tsx scripts/pd-distress-allclear.ts keygen` — prompts for the
 *      passphrase on a TTY, writes the 0600 private PEM and the `.pub`, and
 *      prints the pin entry below verbatim.
 *   2. Paste that entry into `OPERATOR_ALLCLEAR_PINNED_KEYS`, open a PR, and
 *      merge it yourself. Record the fingerprint on the pinned status issue
 *      (ADR-0132 A3 rung 15) and in the incident runbook, so phase 2's observer
 *      and any human can echo it.
 *   3. `chflags uchg ~/.port-daddy/operator-allclear.pub` — an immutable flag
 *      the same user can clear, so it is a speed bump, not a boundary; the
 *      boundary is this file.
 *
 * Until an entry lands here the ALL-CLEAR key is inert: nothing verifies, and
 * the halt cannot be lifted by anyone. That is ADR-0132's "correct failure
 * direction" — key loss is a halt that needs the A4 runbook, never a halt an
 * agent can lift.
 *
 * Rotation is the same procedure: add the new entry, keep the old one only as
 * long as a halt it lifted is still on record, then remove it in a later PR.
 */

export interface PinnedOperatorKey {
  /** `publicKeyFingerprint()` of the key: SHA-256 over the raw 32 bytes, first 16 hex. */
  fingerprint: string;
  /**
   * The SPKI PEM itself. Optional but recommended: with it, listeners verify
   * even when `~/.port-daddy/operator-allclear.pub` is absent (a fresh clone,
   * CI, the phase-2 observer). Its fingerprint must equal `fingerprint`.
   */
  publicKeyPem?: string;
  /** Who holds the private half, e.g. `operator:erich`. */
  holder: string;
  /** ISO date the pin was committed. */
  pinnedOn: string;
}

/**
 * The operator ALL-CLEAR keys this build trusts. EMPTY means no key is
 * trusted and no halt can be lifted — deliberately so, until the operator
 * runs keygen and commits the entry it prints.
 */
export const OPERATOR_ALLCLEAR_PINNED_KEYS: readonly PinnedOperatorKey[] = [];
