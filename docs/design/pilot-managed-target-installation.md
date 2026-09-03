# Pilot managed-target installation

This explanation defines the bounded successor to the source-provenance work in
PR #10031. The **Pilot renderer** ([source](../../lib/pilot-agent-render.ts)) turns
one captured agent definition into five runtime-specific files. Source validation
is necessary before installation, but does not prove ownership of an existing
destination.

## Preservation contract

A filename, Pilot ID substring, symlink or match to newly rendered content is not
overwrite permission. Only a verified prior installation record for the exact
target can authorize replacement, stale-file cleanup or uninstall. An unmanaged
target remains untouched, including one identical to the desired output.
Historical targets without trustworthy records are not automatically adopted.

The **target executor** (`lib/pilot-agent-targets.ts`, introduced by this slice)
shares one preview, apply and recovery contract across all mutation paths. Its
local receipts and operation journals record installation provenance; they are
not another actor registry or roadmap authority, and cannot defend against a
malicious process running as the same OS user.

## Preview and apply

Preview lists all active destinations and stale removal candidates, observed
absence or exact type and byte hashes, parent identity, source hashes, proposed
actions and preservation conflicts. Preview and invalid-source handling write
nothing: no target directories, locks, receipts or backups.

Apply binds the reviewed preview digest, checks the source before filesystem
mutation, and revalidates the target/parent observations. A narrow installation
lock serializes cooperating installers. Special files, unreadable paths,
redirected parents, broken links and changed previews produce explicit refusals.
No generic force or adoption option exists.

## Interrupted work

Before a replacement, preserve previous bytes and mode in a private create-only
operation journal. Stage and verify new output before replacing a managed file.
Retire a working predecessor only after its replacement is verified. Each target
operation has a durable witness; five independent file replacements are not a
single filesystem transaction.

An interruption reports the exact completed steps and a recovery handle. Recovery
checks recorded before/after identities and refuses to overwrite later user edits.
It does not delete an unfamiliar lock or journal. Creating a backup without an
executable recovery path is not sufficient.

## Caller and release boundaries

Standalone, setup and MCP callers must distinguish blocked, partial, unchanged
and complete outcomes. They cannot announce a complete installation after a
Pilot error or infer success by matching error prose.

Tests use synthetic sources and target roots under owned scratch directories;
all new filesystem mutation entrypoints need boundary coverage. This source slice
does not install anything into the operator's home, modify hooks or skill links,
or prove that an interactive harness loaded the resulting agent. Those later
actions require their own exact preview and observable execution evidence.
