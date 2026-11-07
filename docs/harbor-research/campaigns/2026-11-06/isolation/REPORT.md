# Proof guest boundary: fixed bootstrap profile passed

On 2026-11-06 Pacific time, three separate cold Linux guests named red, blue,
and white passed the fixed `proof-offline-v1` probe. Each VM had one vCPU,
256 MiB guest RAM, a read-only input disk, a fresh 8 MiB state disk, a serial
output pipe, and entropy. Host configuration and runtime observations both
reported zero network, directory-sharing, and socket devices.

This establishes a usable VM boundary for the recorded fixed proof processes.
It does **not** establish that the host-side research agents were isolated in
those VMs. No research agent, Python prover, Java runtime, model provider, or
Port Daddy runtime was launched in a guest. This is a reviewed `DEV_UNTRUSTED`
Swift/Python experiment, not a separately released Drydock controller.

## Evidence

- `verdict.json`: the latest three-team fixed-probe verdict.
- `configuration-receipts.json`: final configured/runtime device observations,
  process identities, source identities, and backing-file digests.
- `red-guest.log`, `blue-guest.log`, `white-guest.log`: guest testimony only.
- `transcript.jsonl`: append-only external command argv/cwd/stdout/stderr/exit,
  timeouts, tool versions, hashes, builds, failed probes, and verdicts.

| Gate | Result | Witness |
|---|---|---|
| PG-BOOT | All three guests booted and completed the fixed probe | Host start/stop plus guest markers |
| PG-NET | Configured and runtime NIC counts zero; guest saw loopback only and failed a connection to 192.0.2.1 | Host configuration/runtime; guest probe |
| PG-SHARE | Configured and runtime directory-sharing and socket counts zero | Host configuration/runtime |
| PG-READONLY | Own input readable; guest write rejected; host hash unchanged | Guest plus host hash |
| PG-STATE | Distinct 8 MiB writable backing files; guest marker read back by host | Host file identities/readback |
| PG-CROSSREAD | Extra block device and host paths absent; read of /dev/vdc failed | Host device inventory; guest probe |
| PG-STOP | Each guest stopped normally; each owned state disk removed | Host lifecycle and removal receipt |
| PG-LIMIT-FAULTS | Not run | Deadline/output ceilings are configured, fault enforcement unproven |
| PG-AGENT-PRIVACY | Not run | Research teams and agents remain outside this boundary |

The three team inputs and disks were all staged before any guest started. VM
execution was sequential, with no shared writable disk and no team-to-team
network. The controller supplied a clean explicit environment to the helper.
The guest received no host HOME, worktree, credentials, SSH agent, or service
socket. Guest output was never mounted, extracted, or executed on the host.

The final fixed guest script explicitly checks that its `timeout` and `wget`
tools exist before treating the network probe as an attempted denied request.
It attempts an actual extra-disk read in addition to checking path absence.
Neither guest denial is promoted into an independent host witness.

## Preserved failures and repair

The first three starts failed with `VZErrorDomain Code=1` before guest boot.
The official Alpine kernel was an EFI zboot gzip wrapper. The controller now
reads its explicit payload offset/size, applies a 64 MiB decompression ceiling,
and verifies the Linux ARM64 image magic. Original and normalized digests are
both retained.

The next three guests booted, wrote their disks, and stopped, but a Foundation
read requested a full 8 KiB and withheld the short serial output. Their result
remained `INCOMPLETE`. The fixed reader uses an 8 KiB `Darwin.read` and checks
the cumulative serial budget before enqueuing output. A three-guest pass then
established the markers, and the final three-guest pass added the explicit
extra-disk read. Earlier failed/incomplete verdicts remain in the transcript.

Independent tool-native source review found no blocker for this fixed probe.
It did not independently rerun the experiments. Root reviewed the original
source before execution; the red reviewer checked both the initial source and
the serial/kernel-reader changes. The last extra-disk read was a bounded guest
probe reviewed by its author. No source review constitutes certification of
arbitrary hostile workloads.

## Provenance and remaining gates

Host: macOS 26.1 (25B78), arm64. Compiler: Apple Swift 6.2.1. The helper carries
an ad hoc `com.apple.security.virtualization` entitlement. Alpine v3.22
netboot inputs came from the official HTTPS endpoint; upstream signatures were
not independently verified. These mutable URLs are provenance, while the
recorded SHA-256 values identify the exact artifacts used here.

The next research execution step is to stage a separately reviewed, digest-pinned
proof runtime and sealed team packet into read-only guest input, execute the
actual proof there, and retain bounded output. New runtime/image/input formats
need review. No inference about isolation of prior host runs is allowed.

Before arbitrary agent or adversarial-submission admission, additional work is
required: independently released controller, stronger input custody, crash-safe
admission/teardown, output and timeout fault tests, host resource high-water
accounting, concurrent lifecycle limits, quarantine/promotion review, and the
relevant agent/provider authority controls. The local Port Daddy halt remains
in force.

## Primary sources

- [Apple Virtualization](https://developer.apple.com/documentation/virtualization)
- [Apple network devices](https://developer.apple.com/documentation/virtualization/vzvirtualmachineconfiguration/networkdevices)
- [Apple directory-sharing devices](https://developer.apple.com/documentation/virtualization/vzvirtualmachineconfiguration/directorysharingdevices)
- [Apple Linux VM example](https://developer.apple.com/documentation/virtualization/running-linux-in-a-virtual-machine)
- [Linux EFI zboot header](https://github.com/torvalds/linux/blob/v6.12/drivers/firmware/efi/libstub/zboot-header.S)
- [Linux ARM64 boot contract](https://docs.kernel.org/arch/arm64/booting.html)
- [Alpine official netboot artifacts](https://dl-cdn.alpinelinux.org/alpine/v3.22/releases/aarch64/netboot/)
