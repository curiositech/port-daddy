# Schema enforcement dependency

`scripts/parley_checkpoint_audit.mjs` compiles
`schemas/parley-checkpoint.schema.json` with Ajv 8's Draft 2020 constructor at
its API entry, before any domain traversal. A portable consumer supplies Ajv 8
with the Draft 2020 module (`ajv/dist/2020`) through its normal dependency
resolution; this bundle neither installs a dependency nor embeds a host path.

The schema checks payload shape, types, required nested fields, nonempty
identifiers, and declared enums. The script then checks cross-record graph
semantics. `pass` and `declarationValid` mean the supplied declaration is
consistent. `eligibleToAdmit` also requires approval, authority, resources, and
no unresolved high/unknown risk. A valid-but-blocked declaration is never an
admission result; the CLI exits nonzero unless `eligibleToAdmit` is true.

A reported partial, failed, missing, or untrusted outcome is still an outcome record. If it is in `justFinished`, the local checkpoint policy holds admission for recovery review even when the next proposed branch is independent. This alone does not make the declaration malformed. A claimed successful descendant with an absent or failed prerequisite remains inconsistent, and a proposed next wave whose prerequisites are not successful remains invalid.
