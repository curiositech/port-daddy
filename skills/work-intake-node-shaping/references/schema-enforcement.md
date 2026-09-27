# Schema enforcement dependency

`scripts/node_shaping_audit.mjs` compiles
`schemas/work-intake-spec.schema.json` with Ajv 8's Draft 2020 constructor at
its API entry, before any domain access. A portable consumer supplies Ajv 8
with the Draft 2020 module (`ajv/dist/2020`) through its normal dependency
resolution; this bundle neither installs a dependency nor embeds a host path.

The schema rejects malformed nested objects, invalid enums, non-boolean gates,
and empty evidence suffixes while allowing declared extra properties. The
script then checks cross-field policy. `pass` and `declarationValid` only say
that the supplied intake is coherent; `eligibleToAdmit` separately requires
any required approval plus authority and resources. The CLI exits nonzero unless `eligibleToAdmit` is true. It is not runtime proof.
