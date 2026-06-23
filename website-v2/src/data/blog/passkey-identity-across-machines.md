# Passkey Identity Across Machines

You bought a new laptop. You want it to see the same harbors as your desktop. So you go looking for the part of the docs that tells you how to enroll a second machine — and the honest answer, for a long time, was a paragraph titled *Single-node scope* that amounted to "you don't; that's not supported." One machine, one daemon, one database. The work was already spread across your desktop, your laptop, and your CI, and the paper's official position was that this situation did not exist.

That paragraph is gone in v2, replaced by something with a grander name than it has any right to: the **Federated Sovereign**. It is the answer to the new-laptop question — how a second device joins without anyone typing a master secret into a chat window — and the reason we anchor it on passkeys instead of passwords is the rest of this post.

![Federated identity across a laptop, desktop, and phone — each device holds its own passkey, and a new one joins by pairing rather than by copying a password between machines](/img/generated/blog-daemon-provenance.jpg)

## What "Single-Node Scope" Was Quietly Conceding

The original framing had one machine, one daemon, one SQLite database. Adding another machine required a hand-wave at "consensus primitives" that the paper said were unnecessary for local development. That was true when local development meant one laptop. It stopped being true the day Port Daddy started running:

- on a desktop and a laptop owned by the same user;
- on the same user's machines plus their CI;
- on a teammate's laptop sharing a harbor;
- with mobile devices nearby that should be able to approve actions without running the full daemon.

The product was already federated. The paper just hadn't caught up.

## The Federated Sovereign

The v2 §7 introduces a fourth actor in the trust model --- not by vendor, by *properties*:

| Actor | Role |
| --- | --- |
| Daemon | Commons authority within a machine; signs harbor roots; enforces bonds |
| Agent | Participant; holds Harbor Card; signs actions |
| Principal | Funds Float Plans; identifies via Ed25519 keypair |
| **KMS** | Key custody; recovery root-of-trust; witnesses harbor roots |

The KMS is abstract. The paper specifies it as any service satisfying five named properties (passphrase-wrapped custody with Argon2id at the 2026 floor, encryption at rest, signed witness log with detectable equivocation, rate-limited recovery, public key verification). Implementation choices --- Cloudflare Workers, an HSM, a Tang server, a self-hosted box --- live in design docs. The theory applies to any KMS meeting the properties.

The trust boundary becomes:

```
TB = daemon ∪ KMS ∪ user-email ∪ user-passphrase
```

Each element is necessary for its role; no element is sufficient alone.

The five admissible-KMS properties, in plain English:

```
1. Passphrase-wrapped private-key custody
   --- Argon2id at the 2026 floor.
2. Encryption at rest
   --- the KMS never sees plaintext keying material.
3. Signed witness log over harbor Merkle roots
   --- append-only, monotonic, equivocation detectable.
4. Rate-limited recovery via single-use email tokens
   --- bounded TTL, no SMS, no security questions.
5. Public verification of signed user pubkeys
   --- no mutual auth required to look up "is this key
       still good?"
```

Anyone running a service that satisfies all five is a valid KMS. The protocol does not care whether it is hosted, on-prem, or self-built.

- The **daemon** signs and enforces but never sees the unwrapped user master.
- The **KMS** stores encrypted blobs; it can deny service but cannot decrypt.
- **Email** is the recovery root. We document this as the weakest link, not a feature. An adversary with email control can trigger magic-link recovery.
- The **passphrase** wraps the user's master with Argon2id; offline brute force is expensive.

## Why Passkeys, Not Passwords

The §7.4 commitment is that Port Daddy identity is anchored in WebAuthn-backed device keypairs. Passkeys, not passwords. This is not branding. It changes the product in concrete ways:

1. **No phishable secret on the critical path.** The thing you use to authorize an action is a private key on a hardware-backed enclave, not a string you can be tricked into pasting.
2. **Devices pair without typing.** A new device enrolls by exchanging a short-lived pairing token that re-encrypts the KMS master under the new device's public key. You scan a QR code or tap a button. There is no password to share.
3. **Mobile is a viewer, not a peer.** Phones sign low-stakes actions --- approve an ask, bump a budget, acknowledge a distress signal --- over a WebSocket viewer channel. They do not run the full daemon. This means we can ship a thin mobile app without compromising the security model.
4. **Account-bounded harbor gossip.** Each account's harbors gossip Merkle roots among that account's devices. Cross-account gossip requires explicit signed consent. You opt in to share with a teammate.

What we deliberately do *not* do, and the paper says so out loud:

- We do not require passwords as a primary factor.
- We do not use TOTP as a primary factor (we may add it as a *recovery* factor, opt-in).
- We do not couple recovery to a single cloud vendor.

A device-pairing flow, in pseudocode --- this is the actual handshake, not a marketing diagram:

```typescript
// On the existing trusted device (Device A):
const pairingToken = await pdAuth.startPairing({ ttlSec: 300 })
// → token is a single-use, bounded-TTL secret displayed as QR.

// On the new device (Device B):
const newPubKey = await webauthn.register({ rpId: 'portdaddy' })
const pairing = await pdAuth.completePairing({
  token: pairingToken,
  newPubKey,
})
// Server-side, the existing wrap of the master key is rewrapped
// under newPubKey. Device B can now decrypt the master locally.

// On Device A:
await pdAuth.confirmPairing({ token: pairingToken, accept: true })
// Without confirmation, the rewrap is discarded.
```

There is no shared secret transmitted. The pairing token authorizes a specific rewrap, the new device contributes its passkey-bound public key, and the existing device gates the rewrap with a final confirmation signed by its own passkey.

![The FleetBar identity surface mid-pairing — a QR code on the trusted device and a confirm step that gates the rewrap, so a new machine joins without a shared secret crossing the wire](/img/app-screens/shipwright-control-light.webp)

## Recovery and Its Honest Limits

The Federated Security Theorem (§7, informal) says that an adversary with read access to KMS storage, daemon SQLite, and mesh gossip --- but *without* same-user code execution on the daemon's host --- cannot:

- forge a Harbor Card without the daemon's private key,
- read plaintext evidence without the harbor's session key,
- impersonate the user without both email access *and* passphrase,
- roll back the Merkle forest without the KMS's complicity.

The honest limit, written into the paper: *if the user loses both passphrase and old machine*, harbor session keys wrapped only for the old pubkey cannot be recovered. This is the price of zero-knowledge at-rest encryption. We do not pretend it away.

For users who want stronger recovery, we ship an opt-in **Shamir escrow** mode: `t`-of-`n` secret sharing across the KMS, email, and recovery contacts. You give up some of the zero-knowledge property in exchange for being able to recover from worst-case device-and-passphrase loss. This is a deliberate tradeoff users make project by project.

The theorem also explicitly excludes the same-user adversary --- an unsandboxed agent, a malicious postinstall, a compromised editor extension running as the same UNIX user. Such an adversary reads any file the user can read, which absent OS-mediated key custody includes the daemon's keys and database. The macOS Keychain integration ships now; native keyring on Linux and hardware-backed keystore on Windows extend the theorem's reach to that case. We are honest that this is in flight.

## What Changes for Users

The product implications, in priority order:

1. **Passkey-first onboarding.** New users authenticate to a Port Daddy account by registering a passkey on their device. No password to set, no password to forget.
2. **Pair-by-QR for additional devices.** Enrolling a second laptop is a 30-second flow: open the existing device, scan a code on the new one, the master rewraps under the new device's pubkey. No copy-paste of secrets across machines.
3. **Mobile FleetBar as viewer.** A small companion app on iOS / Android that signs approvals over a viewer channel. It can approve a Float Plan, bump a budget, acknowledge a distress event --- but it cannot run the daemon. We ship the daemon where it belongs (your real machine).
4. **Per-account harbor gossip toggle.** You decide whether the laptop and the desktop should be gossiping harbor roots. Default is yes. Cross-account gossip with a teammate is opt-in and requires both sides to sign consent.
5. **Honest recovery copy.** The product explains, before you set a passphrase, that it is the second factor in your recovery story and what happens if you lose it. Shamir escrow is presented as a real option, not a hidden setting.

## What This Is Not

A few things this is *not*, because the line gets blurry:

- **Not single sign-on.** Port Daddy identity does not federate to your GitHub or Google account except where you explicitly link them. The KMS knows your account email and your passkey public keys; that is it.
- **Not a password manager.** We are not storing your credentials for other services. The KMS holds *your master keys for your daemons*, not your passwords for the rest of the internet.
- **Not a vendor lock-in.** The five KMS properties are public. Any operator can run their own KMS, including a self-hosted one for organizations that need it. The default is convenient; it is not exclusive.

## What Comes Next

The pieces that are concrete and shipping:

- WebAuthn-backed device registration in the FleetBar onboarding flow.
- KMS witness for harbor roots, on the way to making [cross-machine audit](/blog/evidence-that-survives-machines) real.
- Mobile viewer scope and protocol --- design done, app pending.

The pieces that are still being designed:

- Shamir escrow UX. The mechanism is well-understood; the affordances for picking recovery contacts and threshold are not.
- Cross-organization harbor sharing. Within an org, gossip is fine; between orgs, you want explicit federation semantics that the v2 paper acknowledges as out of scope.

The headline: *identity is now portable across machines without becoming a password problem*. The Federated Sovereign is what makes that portability honest. The Merkle forest from the [companion post](/blog/evidence-that-survives-machines) is what makes the evidence portable too. Together they are why "single-node scope" is no longer the truthful description of the product.
