# Fixed Python research checker ran inside the offline guest

The sealed `scout_claim_counterexamples.py` payload completed inside the existing
`proof-offline-v1` Linux VM with exit code 0. Its exact JSON matched the host's
expected D14/D8/D29 results. An intentional `assert False` control emitted the
expected `AssertionError` sentinel and exit code 1. The guest then stopped cleanly;
the controller removed its private 8 MiB state disk.

| Check | Observed result |
|---|---|
| D14 lineage | 2,168 bounded positive cases; conserved balance 9/5; split payoff 9/5 versus unsplit payoff 1 |
| D8 digest | Four worlds, two cells; zero opening loss; guessing risk 1/2 versus full-observation risk 0 |
| D29 composition | Six legal schedules, four violations; two atomic orders checked |
| Positive process | Exit 0; exact JSON accepted |
| Negative process | Exit 1; intentional assertion sentinel present |
| Python runtime | Version 3.12.16 and executable hash matched the staged manifest |
| Host device inventory | Configured and runtime NIC/share/socket counts all zero |
| Host input/state | Read-only input hash unchanged; private state write read back; state disk removed |

These are finite mathematical checker results, not measurements of research agents
or a novelty claim. The negative control tests that a real Python assertion failure
is reported; it does not prove that every possible research bug would be detected.

## Boundary change

The Swift VM helper binary, devices, one-vCPU/256-MiB profile, 60-second deadline,
70-second external deadline, and 256-KiB serial ceiling are identical to the
three-guest baseline in `../isolation/`. That baseline evidence was preserved.

The changed guest image adds Python 3.12.16-r0 and 17 dependency packages from the
Alpine v3.22 aarch64 main repository. The guest runtime overlay contains 756 files
and 39,668,425 uncompressed bytes including the fixed init script. Package contents
are parsed into cpio bytes on the host, with compressed, expansion, member, and
aggregate size limits. They are never extracted into the host filesystem. Package
install hooks and metadata are skipped and never executed.

The payload, intentional negative control, and manifest are placed in the
read-only input block image. The fixed guest init copies those three files into
guest RAM, checks their SHA-256 values, and runs Python with `-I -B`. The positive
process has a 35-second guest timeout and the negative control a 5-second timeout.
Neither process receives a model provider, host mount, credential, SSH agent,
interactive shell, or network device.

Root reviewed the full new controller, guest block, 18-package lock, and staged
manifest before the first Python VM launch. Its requested exact-result, version,
executable-hash, and source-manifest checks were included before execution. The
original unlaunched manifest was retained, and its unused state disk was removed
before the reviewed restaging. The first actual Python guest launch passed.

## Evidence and provenance

- `manifest.json`: payload, negative control, Python executable, controller, guest
  block, helper, kernel, initramfs, and input hashes; exact commands and expected exits.
- `runtime-lock.json`: all 18 package names, versions, official URLs, sizes, observed
  SHA-256 values, dependencies, and package-index metadata.
- `verdict.json`: exact research output, every boolean gate, host device/lifecycle
  observations, and manifest identity.
- `guest-1794024180897422000.log`: complete guest serial output, including version,
  executable hash, research JSON, negative-control traceback, and exit markers.
- `transcript.jsonl`: external command stdout/stderr/exit, downloads, preparation,
  review/restaging, VM output, and teardown. No hidden reasoning is included.
- `seal.json`: final evidence file identities.

Official HTTPS transport supplied the package bytes. The observed SHA-256 values
pin those bytes; they are not independent upstream authentication. Upstream APK
signatures and APKINDEX checksums were not verified. The lock retains APKINDEX's
checksum field as metadata only. This provenance gap remains explicit.

The host configuration/lifecycle records are `HOST_OBSERVED`; Python output,
version, executable hash, and exit markers transported by serial are
`GUEST_ASSERTED`. The controller independently compares them against the sealed
inputs and expected results. Serial output is evidence from the fixed guest,
not an attestation that arbitrary guest-authored claims must be true.

This remains a reviewed `DEV_UNTRUSTED` fixed-workload experiment. It does not
establish general hostile-code admission, isolation of the host-side research
agents, a concurrent team service, crash-safe recovery, or readiness of Rust,
TLC, or ProVerif. Their runtime and payload gates remain separate. No local
Port Daddy process was started.

## Sources

- [Alpine Python 3.12.16-r0 package](https://pkgs.alpinelinux.org/package/v3.22/main/aarch64/python3)
- [Alpine v3.22 aarch64 package repository](https://dl-cdn.alpinelinux.org/alpine/v3.22/main/aarch64/)
- [Apple VM network devices](https://developer.apple.com/documentation/virtualization/vzvirtualmachineconfiguration/networkdevices)
- [Apple VM directory-sharing devices](https://developer.apple.com/documentation/virtualization/vzvirtualmachineconfiguration/directorysharingdevices)
