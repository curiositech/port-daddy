### Fixed

- Managed Codex workers keep skill discovery dynamic by disabling eager skill instructions on fresh and resumed runs. Workers use Codex external-confinement mode only when Coast Guard establishes OS confinement, avoiding nested macOS sandbox failures; explicitly disabled Coast Guard retains Codex sandboxing.
