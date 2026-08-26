type: fixed

- **Named daemons no longer share the canonical registry, and packaged startup no longer scans a production database twice.** Profile launches now pin the database, socket, IPC, PID, port, and heartbeat paths to their own runtime directory instead of relying on partial prefix inference. A current content-bound out-of-process integrity proof now suppresses the redundant in-process `PRAGMA integrity_check`, closing the startup path that repeatedly crashed Bun against a 1.1 GB registry before port 9876 could bind.
