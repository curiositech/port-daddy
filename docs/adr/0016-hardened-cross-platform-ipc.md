# 0016. Hardened Cross-Platform IPC

## Status

Accepted (Deep Engineering Revision)

## Context

Port Daddy V4 requires secure, high-performance Inter-Process Communication (IPC) across macOS, Linux, and Windows. 
- **Unix (macOS/Linux)**: Uses Unix Domain Sockets (UDS). Security is handled via filesystem permissions (`chmod 600`).
- **Windows**: Named Pipes are the standard for high-performance IPC. However, they are globally accessible by default, creating a security risk where a malicious local process can "pipe-squat" or sniff agent credentials.

## Decision

Implement a **Hardened IPC Abstraction** that ensures uniform security invariants across all platforms.

### 1. Unix Domain Sockets (Unix)
- **Permissions**: Explicitly set to `0600` (Owner Read/Write only).
- **Socket Path**: `/tmp/port-daddy.sock` (primary) and `.portdaddy/daemon.sock` (project-local).

### 2. Hardened Named Pipes (Windows)
- **Path**: `\\.\pipe\portdaddy-kernel`
- **Security Descriptors (DACLs)**: The daemon must explicitly define a Security Descriptor when creating the pipe using the **Security Descriptor Definition Language (SDDL)**.
    - **SDDL String**: `D:(A;;GA;;;OW)(A;;GA;;;SY)(A;;GA;;;BA)`
    - **Logic**: 
        - `(A;;GA;;;OW)`: Allow Owner (`OW`) Generic All (`GA`) access.
        - `(A;;GA;;;SY)`: Allow Local System (`SY`) access.
        - `(A;;GA;;;BA)`: Allow Built-in Administrators (`BA`) access.
    - **Result**: Any other user account on the same machine attempting to connect to the pipe will receive an **Access Denied** error at the kernel level.
- **Pipe Flags**: 
    - `PIPE_REJECT_REMOTE_CLIENTS`: Prevents NTLM relay or remote sniffing attacks.
    - `FILE_FLAG_FIRST_PIPE_INSTANCE`: Ensures the daemon is the true creator of the pipe and not a squatter.

### 3. IPC Library Abstraction
- Create `lib/ipc.ts` to detect `process.platform` and switch between UDS and Named Pipes.
- Use **MessagePack** serialization to reduce parsing overhead compared to JSON.

## Rationale

Port Daddy acts as a security harbor for agents. If the IPC mechanism is "loose," the entire cryptographic foundation (Harbor Tokens, Anchor Protocol) is compromised by local sniffing. By enforcing strict DACLs on Windows and filesystem permissions on Unix, we ensure that Port Daddy is a **Multi-Tenant Secure Kernel**.

## Consequences

### Positive
- **Security**: Prevents local cross-user data sniffing or command injection.
- **Performance**: High throughput with zero TCP stack overhead.
- **Robustness**: `FILE_FLAG_FIRST_PIPE_INSTANCE` prevents "Shadow Daemons" from intercepting traffic.

### Negative
- **Implementation**: Requires Windows-specific FFI (using `windows-sys` in Rust or `node-ffi` in Bun) to apply Security Descriptors.
- **Debugging**: Inspecting binary MessagePack streams in a raw socket is harder than inspecting JSON.

### Neutral
- **Unified Client**: The CLI and SDK use the same `ipc.ts` abstraction, making platform differences invisible to the end-user.
