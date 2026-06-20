# Operator Runbook: The Privileged TCB Phases — separate-UID broker, forced egress, VM isolation

**Status:** Operator-only design + runbook. Not CI-testable, not agent-provisionable — by construction (see below).

**Scope.** This runbook covers the three **privileged phases** of the Trusted Computing
Base (TCB) broker — the phases that an agent **cannot** build, test, or provision for
itself, because doing so would mean the agent holds exactly the authority the phase is
supposed to take away from it. They are the kernel-boundary phases of Port Daddy's
out-of-band enforcement model:

| Runbook phase | What it establishes | Maps to ADR design |
|---|---|---|
| **Phase 5** | A dedicated `pd-broker` macOS account that holds the push/API credentials, whose process memory and signals the agent UID cannot reach | ADR-0053 Layer 3 (credential out of the agent's UID) + ADR-0050 phase 4 |
| **Phase 6** | `pf`/`pfctl` anchor rules that force the agent's egress through the broker and make "use the token directly" *unreachable*, not merely *refused* | ADR-0053 Layer 3 forced egress (pf) + ADR-0050 phase 4 |
| **Phase 8** | The `Virtualization.framework` guest-VM variant, and the decision rule for when its cost is worth paying over a separate UID | ADR-0053 Layer 3 (VM alternative) |

> **Sources of record.** The architectural decision is
> [`docs/adr/0053-out-of-band-enforcement.md`](../adr/0053-out-of-band-enforcement.md)
> (the three-layer out-of-band model; Layer 3 is the kernel boundary these phases
> implement) and [`docs/adr/0050-coast-guard.md`](../adr/0050-coast-guard.md) (the
> Coast Guard sandbox + secret-broker + metering plane, whose phase 4 *is* this
> separate-UID/VM work). The dedicated **operator runbook ADR**,
> `docs/adr/0087-trusted-computing-base-broker.md` (proposed — not yet written), is
> where the phase numbering used here (5/6/8) is intended to live; until it lands,
> this runbook is the operating document and ADR-0053 Layer 3 is the design canon.
> <!-- cite-exempt: ADR-0087 is the proposed home doc for these phases; not yet on disk -->

---

## Why these phases are NOT blind-buildable (read first)

Every other phase of the enforcement stack is buildable and CI-testable by an agent:
the macaroon discharge gate, the null credential helper, the egress meter, the MITM
proxy. Those run **in-band**, as the agent's own UID, and a test harness can assert
their behavior because the test process holds the same authority the production process
does.

The three phases in this runbook are different. Each one's correctness *is* the property
"the agent UID cannot do X." An agent that could provision the boundary could also relax
it; a test that runs as the agent and "confirms the agent is locked out" is testing
nothing, because the test inherits the agent's authority. Concretely:

- **Phase 5** creates an account and re-owns files so the agent UID **cannot read the
  broker's memory or signal its process**. The agent literally cannot run
  `sysadminctl -addUser` (needs admin) or `chown pd-broker` (needs root). If it could,
  it could equally `chown` the credential back to itself.
- **Phase 6** installs `pf` anchors at boot via a root-owned `launchd` job. `pfctl`
  requires root. An agent with the authority to load a firewall ruleset has the
  authority to flush it (`pfctl -F all`), which is the whole attack.
- **Phase 8** boots a hypervisor guest and partitions the host filesystem from it.
  Provisioning the VM means controlling the host side of the boundary — again, the
  thing the boundary exists to deny the guest.

**Therefore the deliverable for these phases is this runbook, executed by the operator
as an administrator**, plus the verification steps that let the operator *confirm the
boundary holds*. There is no "ship the code and let CI prove it." The proof is the
operator running the verification commands below and seeing the agent UID denied.

A small, honest exception: the **management glue** is testable — the `launchd` plist
templates, the `pf` anchor *file syntax* (`pfctl -nf` parses without loading), and the
runbook's own command transcripts. Those can live in the repo and be linted. What cannot
be CI-tested is the *effect* — that this machine's `pd-broker` UID is unreachable from
this machine's agent UID — because that is a property of the live host, established by
the operator, verified by the operator.

---

## Threat model recap (what each phase removes)

The in-band layers (ADR-0053 Layers 1–2) gate and audit but do not confine: a same-UID
agent can read the ambient `gh` keyring token, call `gh`/`git` directly, originate its
own TLS, or copy a credential it legitimately holds for one TTL. The boundary sits inside
the agent's process, so it is advisory by construction.

These phases move the boundary to the **kernel**:

- **Phase 5** removes the credential from the agent's UID. The agent can no longer
  `cat ~/.config/gh/hosts.yml`, `gh auth token`, or `ptrace`/`vmmap` the broker to scrape
  it out of memory — the kernel denies cross-UID reads and `task_for_pid`.
- **Phase 6** removes the *network path* around the broker. Even if the agent somehow
  held a token, `pf` redirects (or drops) its egress so a direct `git push` /
  `curl api.anthropic.com` cannot reach the upstream — the firewall, not an env var,
  decides where packets go. `unset HTTPS_PROXY` changes nothing.
- **Phase 8** is the stronger form of Phase 5+6: the agent runs in a guest VM where the
  **hypervisor** denies reads of the host's `~/.ssh`, `.env.local`, keychain, and broker
  socket, and the host-side `pf` shapes the VM's NAT egress. Worth it only when the
  separate-UID boundary is insufficient (see Phase 8's decision rule).

**Not Seatbelt.** Per ADR-0053, `sandbox-exec` (Seatbelt) is explicitly rejected as the
wall: it is deprecated by Apple, runs the agent at the **same UID** (escapable), and a
raw-terminal agent simply declines to launch under it. It is at best a defense-in-depth
speed bump, never the structural boundary. The structural boundary is the separate UID
(Phases 5–6) or the VM (Phase 8), where the **kernel** owns the decision.

---

# Phase 5 — The `pd-broker` Unix account (credential out of the agent's UID)

**Goal.** A dedicated, non-login service account `pd-broker` owns the push/API
credentials and runs the broker process. The agent's account (`pd-agent`, or the
operator's own user when running interactive sorties) **cannot read `pd-broker`'s memory,
cannot signal its process, and cannot read its credential files**. The agent talks to the
broker only through a Unix-domain socket whose group/permissions are set so the agent can
*connect* but not *own*.

All commands run as an **administrator** (the human operator). They cannot be run by the
agent. Where elevation is needed it is called out.

> **Naming.** This runbook uses `pd-broker` for the *credential-holding broker* account
> and `pd-agent` for the *confined agent* account. ADR-0050 phase 4 / ADR-0053 Layer 3
> refer to the confined account as `pd-agent`; the broker account is new here. Keep both;
> they are different UIDs with different jobs.

## 5.1 Create the broker service account

macOS has two supported paths. Prefer `sysadminctl` on modern macOS (12+); the `dscl`
recipe is the fallback and the one that lets you pin a specific UID and mark the account
non-login.

### Option A — `sysadminctl` (preferred)

```bash
# Run as an admin user. Creates a standard (non-admin) user with no admin rights.
sudo sysadminctl -addUser pd-broker \
  -fullName "Port Daddy Credential Broker" \
  -password - \
  -home /var/pd-broker \
  -shell /usr/bin/false
# `-password -` reads the password from stdin; pipe empty input only if you intend a
# password-less account. For a service account, immediately disable interactive login
# (5.2) regardless of the password set here.
```

### Option B — `dscl` (explicit UID, fully scripted)

Pick a UID outside the human range. macOS hands human accounts UIDs ≥ 501; service
accounts conventionally sit in 200–400. Verify the UID is free first.

```bash
# 1. Find a free UID in the service range.
for uid in $(seq 440 460); do
  if ! dscl . -search /Users UniqueID "$uid" | grep -q .; then echo "free: $uid"; break; fi
done
# Suppose 451 is free. Use it below.

BROKER_UID=451
BROKER_GID=451

# 2. Create the group and user records (all require root).
sudo dscl . -create /Groups/pd-broker
sudo dscl . -create /Groups/pd-broker PrimaryGroupID "$BROKER_GID"

sudo dscl . -create /Users/pd-broker
sudo dscl . -create /Users/pd-broker UserShell /usr/bin/false
sudo dscl . -create /Users/pd-broker RealName "Port Daddy Credential Broker"
sudo dscl . -create /Users/pd-broker UniqueID "$BROKER_UID"
sudo dscl . -create /Users/pd-broker PrimaryGroupID "$BROKER_GID"
sudo dscl . -create /Users/pd-broker NFSHomeDirectory /var/pd-broker

# 3. Create the home, owned by the broker, mode 700 (no other UID may traverse).
sudo mkdir -p /var/pd-broker
sudo chown "${BROKER_UID}:${BROKER_GID}" /var/pd-broker
sudo chmod 700 /var/pd-broker
```

## 5.2 Make it a non-login, non-admin, hidden account

A service account must not be loginable, must not appear at the login window, and must not
be in the `admin` group.

```bash
# Not a member of admin (verify; do NOT add).
dscl . -read /Groups/admin GroupMembership   # pd-broker MUST NOT appear

# Hide from the login window.
sudo dscl . -create /Users/pd-broker IsHidden 1

# Deny interactive + SSH login by shell (/usr/bin/false set above) AND by
# authentication-authority: mark the account as disabled for interactive auth.
sudo dscl . -append /Users/pd-broker AuthenticationAuthority ";DisabledUser;"

# Belt-and-suspenders: deny SSH explicitly if sshd is enabled on this box.
# (Add to /etc/ssh/sshd_config, then `sudo launchctl kickstart -k system/com.openssh.sshd`.)
#   DenyUsers pd-broker
```

## 5.3 Drop the agent UID's ability to read broker memory or signal it

This is the crux of Phase 5. On macOS the relevant kernel guarantees, **given two distinct
non-root UIDs**, are:

- **Cross-UID process memory is not readable.** `task_for_pid()` (the Mach call behind
  `vmmap`, `lldb`, `gcore`) for another UID's process is denied unless the caller is root
  or holds the `com.apple.security.cs.debugger` entitlement under SIP. A non-root,
  non-entitled `pd-agent` calling `vmmap <broker-pid>` gets `Operation not permitted`.
- **Cross-UID signals are denied.** `kill(2)` from `pd-agent` to a `pd-broker` process
  returns `EPERM`; the kernel checks real/effective UID match (or root).
- **File reads obey mode/ownership.** Credential files mode `600` owned by `pd-broker`
  are unreadable by `pd-agent`.

You do not "configure" these — they are kernel behavior for distinct UIDs. Phase 5's job
is to **not accidentally defeat them**: never run the broker as the agent, never `chmod`
the credential group-readable to a group the agent is in, never add `pd-agent` to a group
that owns the credential.

```bash
# Credential store: broker-owned, broker-only, mode 600. Tokens/keys live here,
# NEVER in the agent's home, NEVER in a shared keychain the agent can unlock.
sudo install -d -o pd-broker -g pd-broker -m 700 /var/pd-broker/cred
sudo -u pd-broker sh -c 'umask 077; printf "%s" "$BROKER_PUSH_TOKEN" > /var/pd-broker/cred/push.token'
sudo chmod 600 /var/pd-broker/cred/push.token
sudo chown pd-broker:pd-broker /var/pd-broker/cred/push.token

# Verify NO group/other read bits leaked.
stat -f '%Sp %Su:%Sg %N' /var/pd-broker/cred/push.token
# Expect: -rw-------  pd-broker:pd-broker  /var/pd-broker/cred/push.token
```

## 5.4 The broker IPC socket — agent connects, agent does not own

The agent reaches the broker over a Unix-domain socket. The socket file lives in a
broker-owned directory; the **socket node** is group-accessible to a dedicated
`pd-bridge` group that both the broker (owner) and the agent (member) belong to — so the
agent may `connect()` but cannot `unlink`/replace the socket or read the directory's other
contents.

```bash
# A bridge group whose ONLY purpose is "may connect to the broker socket".
sudo dscl . -create /Groups/pd-bridge
sudo dscl . -create /Groups/pd-bridge PrimaryGroupID 452
sudo dscl . -append /Groups/pd-bridge GroupMembership pd-broker
sudo dscl . -append /Groups/pd-bridge GroupMembership pd-agent   # the agent account

# Socket directory: broker owns it, group pd-bridge, mode 0750 — agent can traverse
# to connect() the socket but cannot list/read the directory body.
sudo install -d -o pd-broker -g pd-bridge -m 750 /var/pd-broker/run
# The broker creates the socket at /var/pd-broker/run/broker.sock with umask 0117 so
# the node is srwxrwx--- (owner+group rw, no other). Agent connects; cannot replace it
# because the *directory* is not group-writable (0750, no `w` for group).
```

Why the directory is `0750` and not `0770`: a group-writable directory would let the agent
`unlink` the broker's socket and bind its own at the same path — a confused-deputy /
socket-hijack. With `0750`, only the broker (owner) can create/replace the node.

## 5.5 Run the broker under `launchd` as `pd-broker`

The broker must be launched by the system (root) but **drop to `pd-broker`**, never run as
the agent. Use a system `LaunchDaemon` with `UserName`/`GroupName`.

```xml
<!-- /Library/LaunchDaemons/dev.portdaddy.broker.plist — root:wheel, mode 644 -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>dev.portdaddy.broker</string>
  <key>UserName</key><string>pd-broker</string>
  <key>GroupName</key><string>pd-broker</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/opt/port-daddy/bin/pd</string>
    <string>broker</string>
    <string>--socket</string><string>/var/pd-broker/run/broker.sock</string>
    <string>--cred-dir</string><string>/var/pd-broker/cred</string>
  </array>
  <key>KeepAlive</key><true/>
  <key>StandardErrorPath</key><string>/var/pd-broker/broker.err.log</string>
  <key>StandardOutPath</key><string>/var/pd-broker/broker.out.log</string>
</dict></plist>
```

```bash
sudo chown root:wheel /Library/LaunchDaemons/dev.portdaddy.broker.plist
sudo chmod 644 /Library/LaunchDaemons/dev.portdaddy.broker.plist
sudo launchctl bootstrap system /Library/LaunchDaemons/dev.portdaddy.broker.plist
sudo launchctl print system/dev.portdaddy.broker | grep -E 'state|pid'
```

> The `pd broker` subcommand is the Phase-5 management surface and is **not yet built**
> in the repo — `pd push` / the daemon's broker role exist as designed-not-built rows in
> ADR-0053's Implementation Matrix. Until that ships, run the credential-holding process
> as whatever you have today (e.g. a `pd-broker`-owned `gh`/push helper), but the account,
> ownership, and socket boundary above are the part that is operator-installed *now*.
> <!-- cite-exempt: `pd broker` subcommand is a designed-not-built management surface -->

## 5.6 Verification — confirm the agent UID is walled out

Run each as the **agent** account. Every one MUST fail (deny). If any succeeds, the
boundary is broken — stop and fix before trusting the host.

```bash
# Become the agent for the duration of the checks.
sudo -u pd-agent -i

# (a) Cannot read the credential file.
cat /var/pd-broker/cred/push.token            # expect: Permission denied
# (b) Cannot list the cred directory.
ls /var/pd-broker/cred                         # expect: Permission denied
# (c) Cannot read broker process memory.
BROKER_PID=$(pgrep -u pd-broker -n -f 'pd broker')
vmmap "$BROKER_PID"                            # expect: Operation not permitted
lldb -p "$BROKER_PID"                          # expect: attach fails (not permitted)
# (d) Cannot signal the broker.
kill -TERM "$BROKER_PID"                        # expect: Operation not permitted (EPERM)
# (e) CAN connect to the socket (this one MUST succeed — it's the legitimate path).
nc -U /var/pd-broker/run/broker.sock < /dev/null && echo "connect OK"
# (f) Cannot replace the socket (hijack attempt).
rm /var/pd-broker/run/broker.sock              # expect: Permission denied
```

Expected matrix:

| Check | Expected for a sound boundary |
|---|---|
| (a) read token | **Permission denied** |
| (b) list cred dir | **Permission denied** |
| (c) read broker memory (`vmmap`/`lldb`) | **Operation not permitted** |
| (d) `kill` broker | **Operation not permitted** |
| (e) `connect()` socket | **OK** (the only allowed interaction) |
| (f) `unlink` socket | **Permission denied** |

If (c) or (d) *succeed*, the most likely cause is that the broker is running as the agent
UID (or as root with the agent able to `sudo`). Re-check `ps -o user= -p "$BROKER_PID"` —
it must print `pd-broker`, not the agent and not `root`.

---

# Phase 6 — `pf` forced egress (make "use the token directly" unreachable)

**Goal.** Even granting the worst case — the agent somehow holds a usable push token or
API key — its packets to the upstream (`github.com`, `api.anthropic.com`, …) must not be
able to leave the host **except through the broker**. The macOS packet filter `pf`
(`pfctl`) enforces this at the kernel, so `unset HTTPS_PROXY`, a hand-rolled TLS client, or
an absolute-path `git` all hit the same wall: the firewall decides where packets go.

This phase requires **root** to load anchors (`pfctl -f`/`-a`). An agent cannot install or
flush it.

## 6.1 The enforcement shape

Two viable shapes; pick per your tolerance for transparency vs. simplicity:

1. **Redirect (transparent proxy).** `pf` `rdr` rules transparently redirect the agent
   UID's outbound 443 to the broker's local MITM/metering proxy. The agent need not set a
   proxy; it cannot avoid one. The broker terminates TLS (its CA, ADR-0050 phase 2),
   injects the real credential, meters, and re-originates upstream.
2. **Drop + allow-list.** `pf` *drops* all egress from the agent UID except to the broker's
   loopback proxy port. Simpler to reason about ("agent has no direct internet"), but
   breaks any agent traffic that legitimately needs the network and isn't broker-routed —
   so it suits low-trust sorties, not interactive use.

Both rely on **per-UID filtering**: `pf` can match `user pd-agent` on outbound rules, so
the broker's own egress (as `pd-broker`) is unaffected while the agent's is forced.

## 6.2 The anchor file

Anchors keep the Port Daddy rules isolated from the system ruleset (`/etc/pf.conf`), so you
never clobber Apple's defaults. Write the anchor, validate it offline, then load it.

```
# /etc/pf.anchors/dev.portdaddy.egress
# Force pd-agent egress through the broker proxy; deny direct upstream.
# Broker proxy listens on 127.0.0.1:8443 (loopback only).

# 1. Redirect the agent's outbound TLS to the local broker proxy (transparent path).
rdr pass on lo0 proto tcp from any to any port 443 -> 127.0.0.1 port 8443

# 2. Default-deny the agent UID's direct egress to anything but loopback...
block drop out proto tcp from any to ! 127.0.0.0/8 user pd-agent

# 3. ...except packets the BROKER originates (pd-broker UID) — it is the only UID
#    allowed to talk to the real upstreams.
pass out proto tcp from any to any user pd-broker keep state

# 4. Allow the agent->broker loopback hop explicitly.
pass out proto tcp from any to 127.0.0.1 port 8443 user pd-agent keep state
```

> **Rule-ordering note.** `pf` is last-match-wins (without `quick`). Order the `block` and
> the `pass` so the broker `pass` and the loopback `pass` follow the agent `block`, or use
> `quick` on the allow rules. Always validate ordering with `-nf` (6.3) and re-derive the
> effective decision with `pfctl -a ... -sr` after loading.

## 6.3 Validate offline, then load (root)

```bash
# Parse-only: catches syntax/ordering mistakes WITHOUT touching the live ruleset.
# This is the one part of Phase 6 that IS lint-able / CI-able as text.
sudo pfctl -nf /etc/pf.anchors/dev.portdaddy.egress && echo "anchor parses"

# Reference the anchor from the main pf.conf (add these two lines, once):
#   anchor "dev.portdaddy.egress"
#   load anchor "dev.portdaddy.egress" from "/etc/pf.anchors/dev.portdaddy.egress"
sudoedit /etc/pf.conf

# Enable pf and (re)load the ruleset.
sudo pfctl -E                      # enable; prints a token (note it for -X to disable)
sudo pfctl -f /etc/pf.conf         # load main conf incl. the anchor
sudo pfctl -a dev.portdaddy.egress -sr   # show the loaded anchor rules
```

## 6.4 Make it survive reboot (root-owned launchd, not the agent)

`pf` anchors do not persist a custom anchor across reboot unless a boot-time job reloads
them. Install a `LaunchDaemon` (root) that reloads on boot. The agent cannot edit this
file (root:wheel, 644) and cannot flush `pf` (`pfctl -F` needs root).

```xml
<!-- /Library/LaunchDaemons/dev.portdaddy.pf.plist -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>dev.portdaddy.pf</string>
  <key>ProgramArguments</key>
  <array>
    <string>/sbin/pfctl</string><string>-E</string>
    <string>-f</string><string>/etc/pf.conf</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><false/>
</dict></plist>
```

```bash
sudo chown root:wheel /Library/LaunchDaemons/dev.portdaddy.pf.plist
sudo chmod 644 /Library/LaunchDaemons/dev.portdaddy.pf.plist
sudo launchctl bootstrap system /Library/LaunchDaemons/dev.portdaddy.pf.plist
```

## 6.5 The disclosed tension — this breaks "the agent edits your live tree"

State this to the operator plainly; do not hide it. Forced egress is **incompatible with
the native sortie experience** in two ways, and the second is the painful one:

1. **General connectivity.** If you choose the drop+allow-list shape (6.1 #2), the agent
   has no direct internet. Anything it does that needs the network — `npm install`,
   `pip install`, `git clone` of a third-party repo, fetching a docs page — fails unless it
   routes through the broker proxy or you add explicit `pass` rules. For a low-trust
   sortie that is the point; for an operator's interactive session it is hostile.

2. **"The agent edits your live tree" assumes same-UID, same-host, ambient credentials.**
   The thing that makes sorties feel native is that the agent runs *as you*, in *your*
   checkout, with *your* `gh` token, pushing *your* branches with no ceremony. Phase 6
   (with Phase 5) deliberately destroys the "with your token" half: the token is
   `pd-broker`'s, the agent's direct egress is blocked, and every push must go through
   `pd push` → broker. If your live-tree workflow ever does a bare `git push` or
   `gh pr create` out of habit, it now **fails** instead of silently succeeding. That is
   the enforcement working as designed — and it is exactly why this is **opt-in per
   project**, never a global default.

**Therefore: Phase 6 is per-project / per-fleet opt-in, low-trust sorties first,
interactive operator sessions last (if ever).** ADR-0053 Layer 3a
(`adr-0053-layer-3a-per-fleet-adoption`) is the adoption gate: surface the
live-tree-tension disclosure in `pd status` / fleet config before enabling, and never
enable it under an operator who is mid-flight on a live checkout without their explicit go.
The honest framing: *this phase trades the native feel for a real wall, and you only want
that trade for code you don't trust.*

## 6.6 Verification — confirm direct egress is unreachable

Run as the **agent** UID. The first two MUST fail (no direct path); the third MUST succeed
(through the broker).

```bash
sudo -u pd-agent -i

# (a) Direct push must NOT reach github.com (token or no token).
git push https://github.com/curiositech/port-daddy.git HEAD:scratch  # expect: hang/timeout or refused, never success
# (b) Direct API call must NOT reach the provider.
curl -sS --max-time 8 https://api.anthropic.com/v1/messages -o /dev/null
echo "exit=$?"   # expect: non-zero (timeout/blocked), NOT 0
# (c) Setting/unsetting a proxy env var must change NOTHING.
HTTPS_PROXY= curl -sS --max-time 8 https://api.anthropic.com -o /dev/null; echo "exit=$?"  # still blocked
# (d) The broker-routed path MUST work.
pd push --branch scratch        # expect: succeeds via broker (once `pd push` ships)
```

Cross-check from root that `pf` is actually loaded and matching:

```bash
sudo pfctl -a dev.portdaddy.egress -sr                 # rules present
sudo pfctl -s state | grep -c '127.0.0.1:8443'         # agent traffic landing on the broker proxy
sudo pfctl -s info | grep -E 'Status|Debug'            # Status: Enabled
```

If (a) or (b) **succeed**, the agent has a direct path: most often `pf` is disabled
(`pfctl -s info` shows `Status: Disabled`), the anchor failed to load (`-sr` empty), or the
`block` rule was overridden by a later `pass` (re-check ordering, prefer `quick`). The
`launchd` job (6.4) is the usual culprit after a reboot — confirm it ran:
`log show --predicate 'process == "pfctl"' --last 1h | tail`.

---

# Phase 8 — The `Virtualization.framework` variant (and when it's worth it)

**Goal.** Run the agent inside a guest VM via Apple's `Virtualization.framework` (the
hypervisor API behind `vz`-class guests), so the **hypervisor** — not a cooperating host
process, not even a host UID boundary — denies the agent any view of the host's `~/.ssh`,
`.env.local`, keychain, broker socket, and credentials. Host-side `pf` shapes the guest's
NAT egress, the same forced-egress property as Phase 6 but applied at the VM's virtual
interface.

This is the strongest variant of the kernel boundary. It is also the most expensive, and
it widens the same "breaks the live tree" tension Phase 6 disclosed. **It is not the
default; it is the answer to a specific failure of the separate-UID boundary.**

## 8.1 When the separate UID (Phases 5–6) is NOT enough

Adopt Phase 8 only when one of these holds. Otherwise Phases 5–6 are the right boundary at
lower cost.

| Trigger | Why same-UID-separation fails; why the VM helps |
|---|---|
| **Local privilege-escalation in the agent's toolchain.** | A separate UID is a kernel boundary *for that kernel*. A local-privesc CVE (a kext bug, a setuid binary, a SIP bypass) lets a compromised agent become root and erase Phases 5–6 entirely. A VM guest that gets root gets root *of the guest*; the host kernel and credentials remain out of reach. |
| **Untrusted/third-party agent code or models you cannot audit.** | When you run an agent you did not write, on input you do not control, "another UID on my box" still shares one kernel, one filesystem namespace, one keychain surface. The VM gives a separate kernel and a filesystem the host curates explicitly (only shared directories are visible). |
| **You need a clean, disposable, reproducible agent environment.** | Snapshot/restore a VM image per task; a compromised run is discarded by deleting the guest. UID-separation leaves persistent state on the host. |
| **Strong egress isolation with no per-UID `pf` brittleness.** | The guest has exactly one virtual NIC; shaping its NAT is simpler and less bypass-prone than per-UID host rules an agent might race. |

## 8.2 When it is NOT worth it (stay on Phases 5–6)

- **The threat model is "me."** For the operator's own interactive sessions, the agent is
  you; a VM buys little and costs the live-tree experience the most. ADR-0053 says
  interactive sessions adopt Layer 3 **last, if ever**.
- **Tight inner-loop latency.** VM boot, file-share round-trips, and the loss of in-place
  editing slow the develop/test loop materially. For trusted, high-frequency sorties the
  separate UID is the better trade.
- **Heavy host-resource sharing is required.** If the agent legitimately needs broad,
  fast access to the host filesystem (large monorepo, big build caches), the VM's curated
  file-share is a constant tax. Phases 5–6 keep host-speed file access while still removing
  the credential.

**Rule of thumb:** *Separate UID for trusted-but-fallible agents (the common case); VM for
untrusted code, unaudited models, or hosts that cannot tolerate a local-privesc erasing the
boundary.*

## 8.3 The host/guest boundary to establish

When you do run Phase 8, the host side must establish — and the operator must verify —
that:

1. **Filesystem is curated, not shared by default.** `Virtualization.framework`'s directory
   share (`VZVirtioFileSystemDeviceConfiguration` / `VZSharedDirectory`) exposes **only the
   directories you explicitly add** — typically a single read-only mount of the working tree
   the agent is allowed to edit (or a writable scratch worktree the broker mints), and
   nothing else. The host's `~/.ssh`, `~/.config/gh`, `~/Library/Keychains`, and
   `/var/pd-broker` are **never** added to the share set.
2. **The broker stays on the host.** The credential-holding broker (Phase 5) runs on the
   **host**, as `pd-broker`; the guest reaches it only through a network socket over the
   VM's NAT (or a vsock), gated by host-side `pf` exactly as in Phase 6. The guest never
   holds the credential; it holds, at most, a discharged macaroon for one TTL.
3. **Egress is shaped at the host NAT.** The guest's single virtual NIC NATs through the
   host; host `pf` forces that NAT's 443 egress through the broker proxy and drops the
   rest — the Phase 6 property, now trivially per-interface instead of per-UID.
4. **The writable surface is broker-issued.** The "read-only real tree + daemon-issued
   writable worktree" mechanism (ADR-0053 Layer 3) rides on this: the only writable path
   the guest sees is one the broker mints, so `git worktree add` elsewhere fails and
   `pd worktree claim` is the single door.

> **Maturity.** No `Virtualization.framework` harness exists in this repo today — this is
> ADR-0053 Layer 3's VM option, a designed-not-built phase. This runbook specifies the
> boundary the harness must establish and the checks that confirm it; building the harness
> (a signed helper app with the `com.apple.security.virtualization` entitlement, image
> management, share configuration) is its own slice.
> <!-- cite-exempt: Virtualization.framework harness is a designed-not-built Layer 3 option -->

## 8.4 Verification — confirm the guest cannot see host secrets

Run **inside the guest**. Each MUST fail; the credential and host secrets must be invisible.

```bash
# (a) Host SSH keys / gh creds / keychain are NOT in the share set.
ls ~/.ssh 2>&1                       # expect: empty or No such file (not the host's keys)
gh auth token 2>&1                   # expect: not logged in / no token
cat ~/.config/gh/hosts.yml 2>&1      # expect: No such file
# (b) The broker credential store is unreachable (it's on the host, not shared).
ls /var/pd-broker/cred 2>&1          # expect: No such file or directory
# (c) Direct upstream egress is blocked by host pf (same as Phase 6).
curl -sS --max-time 8 https://api.anthropic.com -o /dev/null; echo "exit=$?"  # non-zero
# (d) Only the explicitly-shared working tree is writable; nothing else.
mount | grep -i virtiofs             # expect: exactly the share(s) you configured
touch /etc/pd-escape-test 2>&1       # expect: Read-only file system / Permission denied
# (e) The broker-routed push DOES work (the one allowed path).
pd push --branch scratch             # expect: succeeds via host broker
```

From the **host**, confirm the share set and egress shaping:

```bash
# The VM helper must list ONLY the directories you intended to share.
# (Inspect your VM helper's share configuration / logs — never assume defaults.)
# And confirm pf is shaping the guest NAT egress:
sudo pfctl -s nat
sudo pfctl -s state | grep -c '127.0.0.1:8443'   # guest TLS landing on the broker proxy
```

If (a)/(b) reveal host secrets, the share set is too broad — the single most common Phase 8
mistake is sharing the home directory or a parent that contains `.ssh`/`.config`. Re-derive
the share set to the minimum: the working tree only.

---

## Combined acceptance — the operator's "is the wall up?" checklist

Run top-to-bottom. The boundary is sound only when every row reads as expected.

| # | As UID | Command (abbrev.) | Sound boundary |
|---|---|---|---|
| 1 | pd-agent | `cat /var/pd-broker/cred/push.token` | Permission denied |
| 2 | pd-agent | `vmmap $(pgrep -u pd-broker -n)` | Operation not permitted |
| 3 | pd-agent | `kill $(pgrep -u pd-broker -n)` | Operation not permitted |
| 4 | pd-agent | `nc -U /var/pd-broker/run/broker.sock` | **Connects** (allowed path) |
| 5 | pd-agent | `git push https://github.com/... HEAD:scratch` | Blocked (no direct egress) |
| 6 | pd-agent | `HTTPS_PROXY= curl https://api.anthropic.com` | Blocked (env var irrelevant) |
| 7 | pd-agent | `pd push --branch scratch` | Succeeds (via broker) |
| 8 | root | `pfctl -s info` | `Status: Enabled` |
| 9 | guest (P8) | `cat ~/.config/gh/hosts.yml` | No such file (host secret invisible) |
| 10 | guest (P8) | `ls /var/pd-broker/cred` | No such file (broker store unshared) |

**Any deviation is a broken boundary — do not run untrusted agents on this host until the
failing row is green.** The most common root causes, in order: the broker running as the
wrong UID (rows 2–3 succeed), `pf` disabled or anchor unloaded after reboot (rows 5–6
succeed), and an over-broad VM share set (rows 9–10 leak).

---

## Why this is a runbook and not code, restated for the record

The repo can hold the *templates* (the `launchd` plists, the `pf` anchor file, this
transcript) and lint their syntax. It cannot hold a passing test that proves *this host's*
agent UID is locked out of *this host's* broker, because the only process that could assert
that truthfully is one the operator runs as an administrator — and an administrator is
exactly the authority these phases deny the agent. The verification sections above are the
substitute for CI: the operator executes them and observes the denials. That manual,
privileged confirmation **is** the test, and there is no honest way to automate it away
without handing the agent the keys the whole design exists to keep from it.

## Composes with

- [`docs/adr/0053-out-of-band-enforcement.md`](../adr/0053-out-of-band-enforcement.md) —
  Layer 3 (separate-UID/VM + pf forced egress) is the design these phases implement;
  Layer 3a is the per-fleet adoption gate for the disclosed live-tree tension.
- [`docs/adr/0050-coast-guard.md`](../adr/0050-coast-guard.md) — phase 4 *is* this
  separate-UID/VM work; phase 1 (`scrubRawSecretsFromEnv`, in
  [`lib/coast-guard.ts`](../../lib/coast-guard.ts)) removes raw secrets from the agent env
  the credential store here replaces; the metering proxy
  ([`lib/coast-guard/egress-meter.ts`](../../lib/coast-guard/egress-meter.ts)) is the
  upstream side of the Phase 6 forced egress.
- [`docs/adr/0049-relay-architecture.md`](../adr/0049-relay-architecture.md) — the Relay
  verifies the rent-paid macaroon discharge the broker presents upstream.
- [`docs/operations/daemon-and-supervision.md`](daemon-and-supervision.md) — the live
  daemon/supervisor topology these `launchd` jobs sit alongside (two `pd` installs,
  `homebrew.mxcl.port-daddy`, `com.portdaddy.bosun`).
- The in-band tripwire — [`cli/utils/git-shim.ts`](../../cli/utils/git-shim.ts) and
  [`cli/commands/guard.ts`](../../cli/commands/guard.ts) — is retained as the audit
  surface; these phases are the wall it was never able to be.
