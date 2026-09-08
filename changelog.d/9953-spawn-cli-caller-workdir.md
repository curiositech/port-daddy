type: fixed

- **`pd spawn` now launches from the directory that invoked it.** Every CLI admission sends a `workdir`: an explicit `--workdir` is preserved byte-for-byte, while omitted input defaults to `process.cwd()` instead of letting the daemon silently substitute its own checkout.
