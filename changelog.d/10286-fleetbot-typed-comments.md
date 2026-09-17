type: added

- **Fleetbot can post its first attributable pull-request comment through the protected workload.** An enrolled, grant-bounded GitHub Actions identity binds the exact PR state, comment bytes, responsible agent, session, purpose, and roadmap scope into a signed request; Relay performs the write with a repository-scoped GitHub App token, reads it back, and returns a signed receipt without exposing the operator's GitHub credential or the App key.
