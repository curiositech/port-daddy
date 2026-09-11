type: security

- **Begin JSON output no longer prints the actor credential.** `pd begin --json` persists admission credentials privately, then omits the credential field from its public result while retaining session and identity metadata. Explicit `PD_EMIT_EXPORTS=1` shell export behavior remains intentional and separate; JSON takes precedence when both modes are selected.
