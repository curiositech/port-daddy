# PKI Option: Web-of-Trust / Cross-Certification / TOFU

**Load when**: WoT is a candidate (least likely for v0, but matters for the antagonist's argument).

## Summary

This is the option that says **don't add a CA at all**. Each daemon publishes its Ed25519 public key out-of-band. Two daemons "join the same harbor" by exchanging keys directly (QR code, copy-paste, signed git commit, SSH-style fingerprint comparison). Trust is peer-to-peer.

Think: SSH `known_hosts`, age-encryption recipient lists, Signal safety numbers, GPG WoT, Magic Wormhole pairing.

## What we'd actually build

Almost nothing new on the wire. The relay becomes a dumb pub/sub hub identified only by `harbor_fingerprint = SHA256(harbor_pub_key)`. To "join a harbor" you need to acquire that harbor's keypair from someone who already has it. Out-of-band exchange flows:

- Two devices, same user: copy `~/.port-daddy/master.key` (or a derivation thereof)
- Team join: existing member exports a *delegated* keypair via Phase 3 attenuation, transmits via Magic-Wormhole-style pairing
- Repo-level: harbor pub key committed to repo; harbor priv key in a team password manager (1Password, Bitwarden)

## Pros

- **Zero CA, zero IdP, zero protocol churn.** No ACME, no OIDC, no JWKS rotation.
- **Air-gap friendly.** Works without internet by definition.
- **Fully user-controlled identity.** No third-party dependency.
- **Aligns with the spirit of "the daemon is its own root."** Doesn't add a higher root.
- **Good for adversarial environments.** Nation-state actors can't compromise a CA you don't have.
- **Simple to formally model** (existing ProVerif coverage of key-exchange protocols transfers cleanly).

## Cons

- **UX cliff for team onboarding.** "Send me your fingerprint over a secure channel" is a known UX failure mode at scale (cf. PGP's history).
- **CI/CD requires committed keypairs or shared secret managers.** Significant operational burden.
- **No third-party attestation.** "I am Erich" is unprovable without out-of-band trust.
- **Revocation is hard.** Once Alice has Bob's key, only Bob can revoke; if Bob loses his keys, the harbor is poisoned.
- **Key continuity attacks (TOFU).** First-time pairing trusts whatever fingerprint you got first. Prior compromise wins.
- **Discovery problem.** "Is anyone in my org on PD?" requires a directory we don't have.

## When this is the right answer

- Solo developer with multiple devices (laptop + desktop + iPad).
- Two-person teams with high-trust pairing rituals.
- Air-gapped or highly-regulated environments (health, defense, classified).
- Adversarial-research deployments (red teams).

## When this is the wrong answer

- Open-source projects with rotating contributors.
- Companies with > ~5 engineers.
- Anything with CI runners.
- Any product that wants growth without onboarding friction.

## Hybrid roles for WoT

WoT can complement ACME/OIDC even if not the primary:

- **Disaster recovery**: if the relay is compromised, harbors with WoT-exchanged keys can re-establish a federation channel without trusting the relay.
- **Air-gap mode**: official support for "WoT-only" deployments where no external CA/IdP is touched.
- **Bootstrap**: ACME/OIDC give you a daemon identity; WoT gives you a *harbor membership*. These are different layers.

## Anti-patterns

- **TOFU-only with no fingerprint verification UX.** SSH gets away with this barely; we shouldn't repeat the mistake. If we ship WoT, we ship a fingerprint UX (QR codes, words list, Magic-Wormhole-style pairing).
- **Shared-secret long-lived keys.** Anyone who's ever held the harbor key forever has access unless we layer Phase 3 attenuation on every export.
- **No revocation story.** If we have WoT, we MUST have a way to nuke and re-key a harbor.

## Specific protocols worth borrowing

- **Magic Wormhole** (Brian Warner): SPAKE2-based PAKE for short-code pairing. Excellent UX. Library exists.
- **Signal's safety-number / ZRTP-style SAS**: short authentication strings derived from the channel, verified out-of-band by humans.
- **age-encryption recipient lists**: minimal, key-based, no PKI, deployed at scale.
- **SSH `known_hosts` + `KnownHostsCommand`**: TOFU with manual override, well-understood.

## Implementation effort estimate

- v0 WoT-only mode: **~1 week** (key import/export CLI, fingerprint display, basic pairing)
- v1 with Magic Wormhole pairing: **+1.5 weeks** (PAKE library + wormhole rendezvous server)
- v2 with revocation broadcast: **+1 week** (revocation distribution problem is genuinely hard without a CA)

## Decision criteria scoring

WoT tends to score: **highest on simplicity, air-gap, sovereignty; lowest on UX, CI ergonomics, revocation, growth.**

## My (the skill's) recommended composition

WoT is **rarely the primary choice for v0**, but it should be **a supported deployment mode** (`--auth-mode=wot`) so that:
- Users who reject CAs/IdPs have a path
- Air-gapped deployments are possible
- The system's identity model degrades gracefully if external dependencies fail

In other words: don't bet the relay on WoT, but don't preclude it. Architectural neutrality on the bootstrap is cheap and the antagonist will bring this up.

## Reading list

- **Magic Wormhole protocol** (warner.github.io/magic-wormhole)
- **age specification** (age-encryption.org/v1)
- **PGP's failure modes** — Moxie Marlinspike's "GPG and Me" essay
- **SSH StrictHostKeyChecking** — RFC 4251 §9, plus operational write-ups
- **SPAKE2** (RFC 9382) — PAKE we'd use for pairing
- **CONIKS** (Melara et al.) — key-transparency tries to solve the WoT discovery problem; worth knowing exists
