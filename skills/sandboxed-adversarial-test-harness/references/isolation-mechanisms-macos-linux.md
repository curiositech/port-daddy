# Isolation Mechanisms — macOS And Linux

Use this when choosing which layer enforces a Drydock claim. Name the mechanism,
the adversary it resists, the external witness, and the residual. A list of tools is
not a trust argument.

## Boundary selection

| Subject | Minimum honest boundary | Why |
|---|---|---|
| Inert data or a total pure function | tightly scoped process, if no parser/native-code risk is admitted | The claim excludes arbitrary execution |
| Package install, build hooks, test config, shell, native module | disposable VM or microVM | The submission controls executable behavior before or around the named test |
| Daemon or coding agent with tools | disposable VM or microVM plus typed effect broker | Arbitrary subprocess, filesystem, and network behavior is in scope |
| Multiple hostile tenants | one workload/tenant per VM process plus host isolation | A shared same-UID process boundary permits cross-run influence |

Containers, namespaces, Landlock, seccomp, cgroups, Seatbelt, Endpoint Security,
packet filters, path checks, and process wrappers add layers. They do not make the
host controller independent from arbitrary same-identity code.

## macOS: Virtualization.framework baseline

For the first Mac-native lane, use the Rust controller with a tiny signed,
out-of-process Swift 6 helper over Apple's Virtualization framework. The helper
mechanically applies a fixed profile; it does not decide policy, hold credentials,
write receipts, or issue verdicts. Configure from absence:

- `networkDevices = []`;
- `directorySharingDevices = []`;
- no shared clipboard, graphics, audio, USB, or host integration unless a scenario
  names and tests it;
- immutable boot and input storage plus a bounded disposable output disk; and
- one explicitly configured socket device only if it is the typed broker transport.

Keep the guest entropy device enabled. Deterministic scenarios replace time and
randomness inside their fixture instead of weakening VM entropy. Test cooperative
stop and externally forced termination as separate paths, and never reuse writable
state after forced termination. Virtualization.framework save/restore is a boot
optimization, not deterministic replay; defer it until cold-boot isolation,
identity reseeding, socket teardown, and snapshot custody are proven.

Apple documents `networkDevices` as the devices exposed to the guest and says its
default value is an empty array. Network access is added by configuring a device;
absence is therefore a host-verifiable configuration fact, not a guest probe.
Directory sharing and socket devices are separate device classes and must be
enumerated separately.

Primary sources:

- [Apple `VZVirtualMachineConfiguration`](https://developer.apple.com/documentation/virtualization/vzvirtualmachineconfiguration)
- [Apple `networkDevices`](https://developer.apple.com/documentation/virtualization/vzvirtualmachineconfiguration/networkdevices)
- [Apple Linux VM guide](https://developer.apple.com/documentation/virtualization/creating-and-running-a-linux-virtual-machine)
- [Apple directory-sharing devices](https://developer.apple.com/documentation/virtualization/vzvirtualmachineconfiguration/directorysharingdevices)

Do not make these inference errors:

- Guest `127.0.0.1` is guest loopback, not host loopback.
- “No NAT adapter” does not prove “no host channel”; socket and shared-directory
  devices are independent.
- A failed in-guest connection is `GUEST_ASSERTED`; the host configuration is the
  isolation witness.
- A Lima profile can prototype orchestration, but permissive mount defaults or
  generated configuration are not the security proof.

Seatbelt, Endpoint Security, Network Extension, and `pf` may harden the controller
or provide observability. Do not describe the deprecated `sandbox-exec` CLI or an
undocumented profile as the sound primary boundary for hostile arbitrary code.

## Linux: Firecracker high-assurance lane

Firecracker is a Linux/KVM option, not a macOS-native substitute. Production
guidance requires more than starting the VMM:

- use the Jailer or equally restrictive constraints;
- keep every jailer input and parent directory outside unprivileged write access;
- assign unique unprivileged UID/GID ownership per microVM where practical;
- retain the default restrictive seccomp profile;
- set explicit resource controls rather than inheriting permissive defaults;
- use an external overwatcher for wall-clock and controller failure; and
- configure host packet filtering because Firecracker does not filter guest
  traffic before forwarding it to the TAP device.

The initial profile has no virtual NIC at all. Use one bounded per-run vsock
endpoint for the typed broker protocol, verify cgroup v2 membership after launch,
and keep one run globally until teardown and accounting invariants survive hostile
tests. Drydock orchestrates a pinned upstream Firecracker/Jailer pair; it does not
fork or reimplement the VMM. Firecracker snapshots remain deferred because they
contain sensitive, version-coupled runtime state and do not provide deterministic
replay.

Primary sources:

- [Firecracker production host setup](https://github.com/firecracker-microvm/firecracker/blob/main/docs/prod-host-setup.md)
- [Firecracker Jailer](https://github.com/firecracker-microvm/firecracker/blob/main/docs/jailer.md)
- [Firecracker design](https://github.com/firecracker-microvm/firecracker/blob/main/docs/design.md)

### Vsock is a capability surface

Firecracker maps guest vsock ports to host Unix sockets. Treat each backing path,
port, listener, framing protocol, and file ownership rule as part of the TCB. Use a
per-run path; reject collisions; expose only the broker; limit frames and peers;
and remove listeners before considering a lease revoked.

Primary source: [Firecracker virtio-vsock design](https://github.com/firecracker-microvm/firecracker/blob/main/docs/vsock.md).

## Linux defense in depth inside or around the VM

| Mechanism | Honest claim | Required check |
|---|---|---|
| cgroups v2 | Bounds aggregate CPU, memory, PIDs, and I/O for an attached hierarchy | Controller reads effective `cpu.max`, `memory.max`, `pids.max`, and `io.max`; external watchdog still owns wall time |
| seccomp BPF | Reduces the host-kernel syscall surface | Confirm filter attachment and architecture; deny execution when required policy cannot attach; do not call it a complete sandbox |
| Landlock | Adds unprivileged, stackable restrictions to a process and descendants | Probe the supported ABI/kernel configuration; fail closed if a required access right is unavailable |
| namespaces and mount policy | Isolate process, mount, user, PID, and network views | Record namespace identities and complete mount/network manifests externally |

Kernel documentation explicitly says seccomp filtering is not a sandbox; it is a
mechanism for reducing exposed kernel surface. Landlock only adds restrictions and
depends on kernel/ABI support. Cgroup defaults are often unlimited, and soft/high
limits are not hard maxima; use hard controls and an external watchdog.

Primary sources:

- [Linux seccomp filter documentation](https://docs.kernel.org/userspace-api/seccomp_filter.html)
- [Linux Landlock userspace API](https://docs.kernel.org/userspace-api/landlock.html)
- [Linux cgroup v2 documentation](https://docs.kernel.org/admin-guide/cgroup-v2.html)

## Mount and artifact rules

- Never mount the developer home, source worktree, credential store, canonical
  socket, service manager, or production checkout.
- Treat the canonical checkout of the default branch as a protected read-only
  projection, not a source, cache, staging area, output target, or worksite. It
  must equal a live independently witnessed `origin/main` tree with a clean
  index/worktree and no untracked files; a stale clean checkout still fails.
- Fetch exact remote objects into a dedicated bare source vault. Create a fresh
  detached linked worktree beneath the approved worktree root, seal its identity,
  then stage source and tests as a digest-pinned read-only image or archive. Never
  export from a developer or canonical checkout and never let Git discover a
  parent repository by walking upward.
- The guest may author only in a guest-local worktree backed by a guest-local
  repository copy. Return a bounded patch or bundle to quarantine. Promotion may
  apply it only to a newly created host linked review worktree on a non-default
  branch after path, common-directory, base, remote, and clean-state verification.
- Reject canonical/default-branch targets before artifact extraction. Also reject
  symlink aliases, ancestor traversal, inherited descriptors, caller-selected
  `GIT_DIR`/`GIT_WORK_TREE`, and unexpected Git common directories.
- A stale or dirty canonical checkout blocks admission but is never reset, stashed,
  deleted, restored, or auto-cleaned by the harness. Preserve it for its owner and
  require a separately authorized projection-replacement receipt.
- Give the guest one bounded disposable output filesystem. Enforce byte, inode,
  file-count, path-depth, and archive-expansion ceilings outside the guest.
- Quarantine output. Reject absolute paths, traversal, symlink or hardlink escape,
  sockets, devices, setuid bits, secret material, undeclared paths, and digest
  disagreement before a human-visible promotion step.
- Destroy the writable overlay after receipt collection. Revocation must remove
  host listeners and capabilities before teardown asks the guest to cooperate.

## Required host evidence

A containment receipt includes controller-observed:

- exact controller, image, source, test, scenario, policy, and price digests;
- configured and runtime device lists;
- mount table and backing-object identities;
- namespace or VM identity, guest PID or VMM PID, and resource hierarchy;
- effective hard resource ceilings and measured high-water marks;
- broker listener identity and absence of undeclared listeners or routes;
- lifecycle transitions, revocation, kill, overlay destruction, and orphan scan;
- output inventory and quarantine decision; and
- source-vault remote witness, source/review worktree identities, and before/after
  proof that the canonical checkout path, HEAD, index, worktree, untracked count,
  object store, and refs did not change; and
- all known residuals, including host-kernel, hypervisor, and controller compromise.

Guest logs may accompany this receipt but cannot fill a missing host field.
The hypervisor cannot constrain an operator or root process acting outside the
harness; record that host-authority residual explicitly.
