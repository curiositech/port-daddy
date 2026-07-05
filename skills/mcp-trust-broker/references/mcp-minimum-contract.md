# The MCP Minimum Contract

Use this when deciding whether an MCP server's install card is complete enough
to review at all — before touching the quarantine-exit gate.

Source: Agent Harbor technical binder, `13-platform-plays-and-runtime-surface-review.md`
(Platform Play #1, "MCP Port Authority") and `product-surface-reality-review.md`
("Minimum MCP contract").

## What "MCP Port Authority" means

Port Daddy is not another list of MCP servers — the official MCP Registry
already does discovery. The value Port Daddy adds is admission control: normalize
metadata, verify source/package/signature, produce a permission manifest, run a
sandbox smoke test, then present an install card with plain-language permissions,
a security/cost risk label, and team policy (allowed / needs approval / blocked).

```
Registry -> Normalize -> Verify -> Manifest -> Smoke test -> Install card -> Grant -> Runtime health/usage -> pd doctor
```

## The six required fields

Every MCP server admitted anywhere in the fleet needs all six, unconditionally —
these are not optional even for a server still sitting in quarantine:

1. **Manifest** — `server.manifestPresent`. Describes the server, its tools, and
   each tool's side effects. Nothing else in this contract can be trusted
   without one; `no-manifest` is the one finding that blocks review outright.
2. **Provenance** — `server.provenance` (`signed`/`unsigned`/`unknown`) plus
   `server.signatureVerified`. A claim of "signed" that has not actually been
   checked against a trusted key is not provenance, it's a label. See
   `quarantine-and-provenance-verification.md` for the exact bar.
3. **Permission label** — `server.permissionScope`
   (`least-privilege`/`broad`/`undeclared`). What the user sees as
   "GitHub MCP wants repo metadata, PR comments, and issue writes."
4. **Health check** — `server.healthCheck`. Runtime health surfaced through
   `pd doctor`, e.g. "used by 4 agents today, 2 failures, last healthy 3 minutes
   ago" or "disabled because its binary changed since approval."
5. **Disable/repair/uninstall** — `server.hasDisableRepairUninstall`. All three
   lifecycle affordances, not just install. A server nobody can turn off is not
   admitted, it's stuck.
6. **Usage trace** — `server.usageTrace`. Invocation and failure history, not
   invisible stderr. MCP failures must become transcript/support events.

## Team policy is a separate, mandatory gate

`teamPolicy` (`allow`/`approve`/`block`/`none`) governs who can admit a server
at all, independent of the six fields above. `none` is not a permissive
default — it means nobody has decided, which is the same as ungoverned. A
server can have a perfect manifest and signed provenance and still be
unreviewable if no team policy has ever been set for it.

`block` is absolute: if `teamPolicy` is `block`, quarantine exit must never be
requested regardless of how clean the rest of the admission record looks. The
auditor's `team-policy-blocks-exit` finding treats this as critical, not as a
"note and proceed."

## Write tools always route through daemon policy

Regardless of quarantine status, every write-capable tool an MCP server
exposes must route through daemon policy rather than executing directly
against the host. This is unconditional in the product-surface-reality-review
contract ("Let MCP servers bypass daemon policy" is listed explicitly as a
thing the MCP surface must not do) and is checked independently of the
quarantine-exit gate by `write-tool-bypasses-daemon-policy`.
