type: fixed

- **Book release promotion now uses one conditional manifest pointer.** `scripts/publish-book-to-r2.mjs` verifies one immutable `book/archive/sha256/<sha256>.pdf` object and conditionally replaces `book/current.json`; it never writes `book/current.pdf`, rejects the undocumented REST transport, and preserves the existing manifest when stale or failed promotion cannot be proven safe. Public promotion remains gated on accepted Book artifacts and protected workflow approval.
