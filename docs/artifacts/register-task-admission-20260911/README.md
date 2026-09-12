# Register task-admission browser proof

These screenshots come from the opt-in browser acceptance in
`apps/relay/tests/work-register-grant-page.test.ts`. The fixture runs the real
server-rendered Register handlers, the full Relay migration chain, real session
crypto and SQLite-backed D1 behavior. Only the GitHub repository-access response
is stubbed. It does not contact the deployed Relay or start local Port Daddy.

The proof authorizes `codex:register-recovery`, returns to the board, verifies no
horizontal overflow, and captures light, dark and 390-pixel mobile views. The
one-use pairing code is deliberately absent from every board screenshot.

Regenerate from `apps/relay/` with:

```sh
REGISTER_TASK_PROOF_DIR="$PWD/../../docs/artifacts/register-task-admission-20260911" \
  npm exec vitest run tests/work-register-grant-page.test.ts
```
