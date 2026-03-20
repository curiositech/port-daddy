# 0017. DB File Protection & Insider Threat Model

## Status

Draft — Under Security Review

## Context

The Port Daddy daemon stores all state (port assignments, sessions, locks, Harbor Cards) in a SQLite database (`port-registry.db` by default). The database file resides in the user's home directory or project root with standard user permissions.

**The Threat**: Any process running as the same Unix user as the daemon can:
1. Delete the database file (`rm port-registry.db`)
2. Corrupt the database (write garbage to the file)
3. Move/rename the database
4. Modify the database directly (bypassing the daemon)

This is an **insider threat** — not a compromised external attacker, but a malicious or buggy agent running with the same UID as the developer.

## Current State

```typescript
// lib/db.ts — Current behavior
export function resolveDbPath(overridePath?: string): string {
  if (overridePath) return overridePath;
  if (process.env.PORT_DADDY_DB) return process.env.PORT_DADDY_DB;
  return join(__dirname, '..', 'port-registry.db');  // Project root, user-owned
}
```

The database file is created with default umask permissions (typically `644` or `664`), meaning:
- Same user: read/write
- Same group: read (or read/write)
- Others: read

## Threat Scenarios

### Scenario A: The Disgruntled Agent
Agent spawned with broad permissions decides to "clean up":
```bash
# Agent has access to project directory
rm ~/.portdaddy/port-registry.db
# Daemon continues running in memory but loses persistence
# Next daemon restart: all state is gone
```

### Scenario B: The Overzealous "Cleaner"
A utility agent misinterprets its instructions:
```javascript
// Agent's (flawed) reasoning:
// "The user asked me to free up disk space. 
//  This .db file is large and looks temporary..."
await fs.unlink('./port-registry.db');
```

### Scenario C: The Ransomware Simulation
An agent with file access encrypts the DB as a "test":
```python
# Agent's reasoning:
# "I'll test the backup/restore system by encrypting the DB"
encrypt_file('port-registry.db', key)
```

### Scenario D: Direct DB Manipulation
Agent bypasses the daemon API and writes directly:
```javascript
// Agent opens DB directly (SQLite is file-based)
const db = require('better-sqlite3')('./port-registry.db');
db.exec("DELETE FROM services WHERE 1=1;");  // Clear all port assignments
```

## Analysis

### Why This Isn't Currently Mitigated

1. **Single-User Assumption**: Port Daddy currently assumes all agents are "friendly" and operated by the same human developer.

2. **SQLite Architecture**: SQLite is a file-based database. Without OS-level file permissions or encryption, the file is just... a file.

3. **No Daemon Monitoring**: The daemon doesn't detect if its DB file is deleted or modified underneath it.

4. **Same-User Problem**: Unix permissions can't distinguish between "daemon" and "agent" if both run as the same UID.

## Proposed Mitigations

### 1. Immutable Backup Strategy (Short-term)

The daemon maintains a write-ahead log of mutations that can reconstruct state:

```typescript
// lib/activity.ts extension
interface ImmutableLog {
  sequence: number;      // Strictly increasing
  timestamp: number;
  operation: string;
  payload: unknown;
  hash: string;          // Chain: hash(prev_hash + current)
}
```

- Append-only log file with `append` permission but no `write`
- Signed entries using daemon's private key
- Separate from the SQLite DB (different file, different directory)

### 2. File Permission Hardening

```typescript
// lib/db.ts enhancement
import { chmod } from 'fs/promises';

export async function hardenDbFile(dbPath: string): Promise<void> {
  // Set permissions to 0600: owner read/write only
  await chmod(dbPath, 0o600);
  
  // Also set immutable flag on supported systems (Linux chattr +i)
  // Requires root, so optional
  try {
    await execAsync(`chattr +i ${dbPath}`);
  } catch {
    // Immutable flag requires root; skip if not available
  }
}
```

**Limitation**: Same-user agents can still `chmod` it back or use `sudo`.

### 3. Daemon File Monitoring

Use `fs.watch` or `chokidar` to detect tampering:

```typescript
// lib/db-guardian.ts
export function watchDbIntegrity(dbPath: string): void {
  const watcher = watch(dbPath, (eventType) => {
    if (eventType === 'rename') {
      // File was moved or deleted
      logger.critical('DB_FILE_DELETED', { path: dbPath });
      // Trigger emergency shutdown or recovery
      daemon.emergencyHalt('DB_FILE_DELETED');
    }
  });
  
  // Periodic integrity checks
  setInterval(() => {
    const hash = computeDbHash(dbPath);
    if (hash !== expectedHash) {
      logger.critical('DB_FILE_MODIFIED', { path: dbPath });
      daemon.emergencyHalt('DB_INTEGRITY_FAILURE');
    }
  }, 5000);
}
```

### 4. Encrypted Database (Medium-term)

Use SQLCipher or similar for encrypted SQLite:

```typescript
// Requires: npm install better-sqlite3-sqlcipher
const db = new Database(dbPath, {
  key: deriveKeyFromDaemonIdentity()
});
```

**Key question**: Where to store the encryption key?
- Option A: OS keychain (Keychain on macOS, Secret Service on Linux)
- Option B: Hardware-backed when available (TPM, Secure Enclave)
- Option C: Prompt user on daemon start (high friction)

### 5. Capability-Based File Access (Long-term)

Use OS-level capabilities or sandboxing:

**macOS**: App Sandbox with entitlements
```xml
<key>com.apple.security.files.user-selected.read-write</key>
<true/>
```

**Linux**: Landlock or seccomp-bpf to restrict file operations
```c
// Landlock: Allow only specific file operations
landlock_create_ruleset(...);
landlock_add_rule(...);  // Only allow writes to specific DB path
prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0);
landlock_restrict_self(...);
```

**Challenge**: Node.js doesn't have mature Landlock bindings.

### 6. The "Dead Man's Switch"

If DB integrity fails, trigger **Flag O (Brig Isolation)**:

```typescript
// In daemon integrity check
if (dbIntegrityFailed) {
  // Immediate actions:
  // 1. Stop accepting new agent registrations
  // 2. Revoke all active Harbor Cards
  // 3. Kill all spawned agent processes
  // 4. Enter "salvage mode" — read-only state recovery
  await harbor.triggerFlagO({
    reason: 'DB_INTEGRITY_FAILURE',
    timestamp: Date.now(),
    lastKnownGoodBackup: findLatestBackup()
  });
}
```

## Decision

**Immediate (v3.8.0)**:
1. Implement file permission hardening (`chmod 0600`)
2. Add DB file monitoring with emergency halt on deletion
3. Create immutable activity log (append-only, separate file)
4. Document the threat in security guide

**Short-term (v4.0)**:
1. Implement SQLCipher encryption with OS keychain integration
2. Add automatic backup to remote Lighthouse (if configured)
3. Implement Flag O (Brig Isolation) protocol

**Long-term (v4.x)**:
1. Research OS-level sandboxing (Landlock, Seatbelt)
2. Consider separate "daemon user" for multi-user systems
3. Hardware-backed key storage (Secure Enclave, TPM)

## Consequences

### Positive
- Clear threat model documentation
- Defense in depth (multiple layers)
- Recovery path via immutable log

### Negative
- Performance overhead (hash checks, encryption)
- User friction (keychain prompts)
- Complexity increase

### Neutral
- Acknowledges that "same-user" security is fundamentally limited
- Positions Port Daddy for enterprise multi-user scenarios

## Related

- [ADR-0013: Unified Harbor Model](./0013-unified-harbor-model.md)
- [ADR-0014: The Anchor Protocol](./0014-the-anchor-protocol.md)
- [Security & Soundness](../SECURITY_SOUNDNESS.md)

---

**Discussion**: The fundamental issue is that Unix permissions are UID-based. If the daemon and agents run as the same user, the OS cannot distinguish them. True isolation requires either:
1. Different UIDs (daemon runs as `portdaddy` user)
2. OS sandboxing (macOS Seatbelt, Linux Landlock)
3. Hardware-backed attestation

All three are on the roadmap but represent significant complexity increases.
