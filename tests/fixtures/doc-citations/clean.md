# Clean fixture for check-doc-citations

Every citation here is valid, exempt, or out of scope. The guard must pass this.

- A real repo path: `lib/sessions.ts`.
- The guard script itself: `scripts/check-doc-citations.mjs`.
- A proposed file is fine when marked: `lib/not-built-yet.ts` (designed-not-built).
- A template placeholder is out of scope: `skills/<name>/SKILL.md`.
- A brace-expansion pattern is out of scope, even though neither individual
  file it names is `lib/sessions.ts`: `lib/coordination-{crypto,acl}.ts`. The
  literal token (with the braces) is not a file on disk, so this line only
  passes because `{`/`}` are excluded — a real regression, not a vacuous case.
- A prospective artifact using the proof-estate's placeholder idiom is out of
  scope: Path: `proofs/economics/does-not-exist-yet.pv` (placeholder).
- A prospective artifact using the shipwright TODO idiom is out of scope:
  **Artifact target:** `analyses/does-not-exist-yet.md`.
- A site-absolute route is out of scope: [docs route](/docs/sessions).
- A working relative link points at this very file: [self](./clean.md).
