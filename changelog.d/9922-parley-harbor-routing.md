type: fixed

- **Parley operations now preserve their configured harbor.** `pd parley show`, response, read-receipt, and resolve paths forward `--harbor` through the CLI and daemon route instead of silently falling back to `fleet`, with non-default-harbor regression coverage for visibility and mutation selection.
