# Fixed proof guest experiment

This is a small `DEV_UNTRUSTED` research adapter for three offline proof processes.
It is not a Port Daddy runtime, native agent launcher, or released Drydock controller.
The source must be reviewed before its build or fixed guest probe is executed.

`run.py build` downloads the Alpine aarch64 virt kernel and initramfs from the
recorded official HTTPS URLs, records their SHA-256 digests, builds the Swift
adapter, and applies an ad hoc virtualization entitlement. No upstream package
signature or independent controller release signature is claimed.

`run.py run` stages three separate team inputs and state disks, then starts one
cold VM at a time. Each guest has:

- One vCPU, 256 MiB guest RAM, and a 60-second host deadline; an outer controller
  kills the helper process group at 70 seconds if necessary.
- Zero network, directory-sharing, and socket devices; no graphics or audio.
- One read-only input block device and one fresh 8 MiB writable block device.
- A kernel/initramfs containing the fixed reviewed `proof-init.sh` probe.
- One serial output pipe, limited to 256 KiB, with its bytes base64-encoded in
  host JSON records. There is no serial input or interactive guest shell.
- A virtual entropy device. No HOME, credential, SSH-agent, repository, or host
  service socket is mounted in the guest.

The probe tests positive boot, its own input read, read-only input rejection,
state write, absence of an extra team disk and known host paths plus a rejected extra-disk read, loopback-only
network inventory, and a failed connection to the reserved documentation IP
192.0.2.1. The failed connection is guest testimony; empty host-configured and
runtime device inventories are the network boundary evidence. The controller
also checks the unchanged input hash and state disk contents on the host.

The controller removes only its own fixed disposable state disks after process
exit. It never mounts, extracts, executes, or imports guest-authored files.
All external commands issued by the controller record argv, cwd, stdout, stderr,
exit, timeout, elapsed time, and tool versions in the campaign transcript.
Pre-implementation source inspection is outside that experiment transcript.

## Review scope and residuals

Apple Virtualization.framework and the host kernel/hypervisor remain trusted.
This helper and Python controller run under the operator's host identity. They
are reviewed development tools, not a separately released, hardened Rust TCB.
They must not execute arbitrary submitted host code or launch agents/providers.
The launch profile is fixed; adding a command, device, channel, image, runtime,
or input format requires new review and evidence.

The tests do not establish hypervisor exploit resistance, multi-tenant side
channel resistance, concurrent worker admission, provider-spend custody,
agent lifecycle accounting, or crash recovery. Sequential VMs prove distinct
writable storage and absent cross-team devices only for the recorded runs.
A PASS, if obtained, applies only to this fixed bootstrap/probe profile.

The guest memory ceiling is a VZ guest allocation, not a measured bound on all
host VMM overhead. Host CPU-time accounting and high-water memory measurements
are not implemented. The serial byte limit and deadlines are configured; their
adversarial overflow/timeout fault tests are a separate incomplete gate.

## Sources

- [Apple Virtualization overview](https://developer.apple.com/documentation/virtualization)
- [Apple Linux VM example](https://developer.apple.com/documentation/virtualization/running-linux-in-a-virtual-machine)
- [Apple network device configuration](https://developer.apple.com/documentation/virtualization/vzvirtualmachineconfiguration/networkdevices)
- [Apple directory-sharing configuration](https://developer.apple.com/documentation/virtualization/vzvirtualmachineconfiguration/directorysharingdevices)
- [Apple virtualization entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.virtualization)
- [Alpine v3.22 aarch64 netboot artifacts](https://dl-cdn.alpinelinux.org/alpine/v3.22/releases/aarch64/netboot/)

The Alpine kernel uses an EFI zboot gzip wrapper. The controller decodes its
explicit payload offset and size under a 64 MiB output ceiling, then verifies
the Linux ARM64 image magic before staging. The original download and normalized
image digests are both recorded. See the [Linux zboot header](https://github.com/torvalds/linux/blob/v6.12/drivers/firmware/efi/libstub/zboot-header.S)
and [ARM64 boot contract](https://docs.kernel.org/arch/arm64/booting.html).
