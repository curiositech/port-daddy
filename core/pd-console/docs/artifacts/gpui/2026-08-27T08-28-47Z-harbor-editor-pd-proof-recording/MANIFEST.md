# pd-console Harbor Editor recording on pd-proof

Captured from exact `origin/main` at `86fc95709103545d47a3434dc42d6e0c24a9873a` with a fresh release `pd-console` binary (SHA-256 `d24b35f205904be3edf5bcd41f2383df9d5f9896e5f66a3f05224b7b86d62df3`).

`pd-console-window.mov` is a six-second exact-window recording of the native console running on `pd-proof`; it does not include the desktop or unrelated windows. SHA-256: `5a639a0887aeb72a514bf9e6ed5a34b7db9a00cb0b37133c0e2d05e0a46c7534`.

`pd-console-window-frame.png` is an inspected frame from the recording. It is non-blank, unclipped, and shows the JSON editor, syntax status, WRAP/BLAME controls, and distinct operator/agent authorship rows. SHA-256: `87d6bde7615c62a5645cd4463c6040d95825b610ea7862ac0003007f1237f346`.

The app used `PORT_DADDY_URL=http://127.0.0.1:65534`; canonical `:9876` was not used or changed. The recording is initial-state proof only. Complete runtime provenance is in `runtime-proof.json`.
