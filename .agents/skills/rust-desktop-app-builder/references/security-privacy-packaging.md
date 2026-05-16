# Security, Privacy, And Packaging

Desktop apps are trusted with the user's machine. Treat that trust as the product.

## Threat Model

Document:
- What local files can be read or written.
- What network endpoints are used.
- Whether remote content can render inside the app.
- Whether scripts, plugins, extensions, or sidecars run.
- What secrets exist and where they live.
- What telemetry is collected and how users opt out.
- What updater channel can execute new code.

## Tauri Capability Discipline

For Tauri 2:
- Capabilities define which permissions are granted to which windows or webviews.
- Use capability files in `src-tauri/capabilities/`.
- Keep windows and webviews narrowly labeled.
- Avoid merging high-privilege and untrusted content boundaries.
- Validate Rust command scope even when a capability looks restrictive.
- Do not put secrets in frontend state.
- Treat all IPC payloads as untrusted input.

Minimum packet:
- `default.json` or named capability per window.
- Permission list with comments in the decision record.
- Path scope for filesystem access.
- CSP.
- Remote-content policy.
- Command inventory.
- Security test cases for denied paths/actions.

## WebView-Specific Risks

- XSS becomes local app risk when IPC is exposed.
- Remote content can inherit dangerous affordances if boundaries are blurred.
- Custom protocol handlers need strict path normalization.
- Drag/drop files can be a data exfiltration route.
- DevTools must be controlled for release builds.

## Native Stack Risks

- Native GUI does not remove supply-chain risk.
- Unsafe Rust, FFI, plugins, and sidecars need review.
- File parsers and importers need fuzzing or at least adversarial tests.
- Logs can leak local paths, document names, tokens, and user content.

## Privacy

Require:
- Data inventory.
- Essential versus optional telemetry split.
- Local-first behavior when promised.
- Redaction rules for logs/crash reports.
- Consent and deletion path.
- No screenshot/session recording without explicit consent.

## Signing And Installer Trust

macOS:
- Public distribution outside the App Store needs Developer ID signing and notarization.
- Ad-hoc signing can help development but does not create user trust.
- Test quarantine behavior from a downloaded artifact, not only local build output.

Windows:
- Signing reduces SmartScreen and installation trust friction.
- EV certificates can establish reputation faster than OV paths, but cost and workflow differ.
- Test installer, uninstall, upgrade, and per-user/per-machine install choices.

Linux:
- Decide AppImage, deb, rpm, Flatpak, package manager, or tarball intentionally.
- Test desktop entries, icons, MIME associations, sandbox permissions, Wayland/X11 behavior, and distro dependencies.

## Updaters

An updater is code execution. It requires:
- Signed update artifacts.
- Private key storage plan.
- Rollback policy.
- Staged rollout or channel strategy.
- Failure UI and retry behavior.
- SemVer/version comparison policy.
- TLS-only production endpoint unless explicitly justified.

## Release Evidence

Do not claim release readiness without:
- Checksums.
- Signing/notarization proof or explicit unsigned disclaimer.
- Installer smoke on each target OS.
- Update smoke from previous version.
- Uninstall smoke.
- Crash/log location documentation.
- Known limitations.
