# Clean fixture for check-doc-citations

Every citation here is valid, exempt, or out of scope. The guard must pass this.

- A real repo path: `lib/sessions.ts`.
- The guard script itself: `scripts/check-doc-citations.mjs`.
- A proposed file is fine when marked: `lib/not-built-yet.ts` (designed-not-built).
- A template placeholder is out of scope: `skills/<name>/SKILL.md`.
- A site-absolute route is out of scope: [docs route](/docs/sessions).
- A working relative link points at this very file: [self](./clean.md).
