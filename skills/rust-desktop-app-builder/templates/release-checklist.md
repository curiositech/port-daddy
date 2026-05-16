# Desktop Release Checklist

## Build

- [ ] `cargo fmt --check`
- [ ] `cargo clippy --all-targets --all-features -- -D warnings`
- [ ] `cargo test --all-features`
- [ ] Framework-specific production build
- [ ] Installer/package build per target OS

## Visual And UX

- [ ] macOS screenshots
- [ ] Windows screenshots
- [ ] Linux screenshots
- [ ] Light/dark/high-contrast where supported
- [ ] Keyboard-only primary workflow
- [ ] Resize/snap/tile/full-screen behavior
- [ ] Empty/loading/error/offline/update states

## Security And Privacy

- [ ] Permission/capability inventory
- [ ] IPC command inventory
- [ ] Local file scope verified
- [ ] Secrets absent from renderer/logs
- [ ] Telemetry consent and redaction checked
- [ ] Remote content policy checked

## Signing And Distribution

- [ ] macOS signing identity documented
- [ ] macOS notarization proof or explicit unsigned disclaimer
- [ ] Windows signing proof or explicit SmartScreen risk disclaimer
- [ ] Linux package metadata, desktop entry, icons, and dependencies checked
- [ ] Checksums generated
- [ ] Update artifacts signed
- [ ] Update from previous version tested
- [ ] Uninstall tested

## Handoff

- [ ] Known limitations listed
- [ ] Rollback path documented
- [ ] Support/log locations documented
- [ ] Release notes written
