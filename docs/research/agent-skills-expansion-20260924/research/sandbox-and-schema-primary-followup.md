# Sandbox and schema primary-source follow-up

Root inspected the following official documentation on 2026-09-24 during semantic review. This is documentation evidence, not a local runtime test. No sandbox, daemon or agent process was launched.

## Kernel boundary and inheritance

[Linux Landlock documentation](https://docs.kernel.org/userspace-api/landlock.html), August 2026 page: inspected rules, enforcement, ABI compatibility, inheritance and file-descriptor sections. Restrictions apply to the enforcing thread and future children; threading coverage depends on the interface and flags. Rules are layered, with only further restriction allowed after enforcement. Feature availability depends on the running ABI. Pre-opened descriptors need separate attention: descriptor access established before the sandbox is not equivalent to a newly checked path. Filesystem and network-port controls do not by themselves establish an application-level destination/method/data policy.

Application-specific inference: if an agent task requires a missing control, an undocumented degradation must not be presented as satisfying that requirement. Record the actual ABI/configuration and demonstrate allowed and denied cases on an authorized test host. Documentation alone cannot certify this machine or Port Daddy. Do not copy the documentation's compatibility fallback as universal task admission policy.

## Sandbox construction

[Bubblewrap maintained README](https://github.com/containers/bubblewrap/blob/main/README.md), inspected sandbox-security and usage sections: the tool constructs an environment; it does not supply a complete security policy. Its protection depends on the arguments chosen by the caller. A changed filesystem layout need not constitute a security boundary. The caller must define the security model and corresponding arguments.

Application-specific inference: labels such as strict/moderate are local configuration names. An example must enumerate controls and observed boundaries instead of inferring security from its label, data classification or resource size. No Bubblewrap configuration was tested here.

## Presence versus null

[JSON Schema object documentation](https://json-schema.org/understanding-json-schema/reference/object), inspected Required Properties and schema examples: listing a property under properties does not require it; required controls presence. A present property must still satisfy its declared schema. [JSON Schema null documentation](https://json-schema.org/understanding-json-schema/reference/null), inspected full type explanation: null is a value and is distinct from absence.

Constructed example: with properties.performance.type = ["object", "null"] and no required entry for performance, both omission and null are permitted. With type = "object", omission can be permitted while null is rejected. Pin the dialect and validator; neither form supplies evidence about a missing performance measurement.
