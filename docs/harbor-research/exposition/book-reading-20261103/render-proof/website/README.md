# Research and Book navigation evidence

[Play the browser recording](research-book-navigation.webm) (11.64 seconds, VP8, 1440 × 1000).

The recording follows actual browser actions: switch the Research tabs, scroll the paper list, follow **Read the Book instead**, open the first chapter overview, and return. It is a Playwright browser capture, not a static-image animation or a Porthole recording.

- [Research, desktop](research-desktop.png)
- [Book, desktop](book-desktop.png)
- [Research, mobile](research-mobile.png)
- [Book, mobile](book-mobile.png)
- [Source and artifact hashes, actions, and capture limitations](receipt.json)

Captured from source commit `fed32d9a01a288cf3b2f6f0cdf807f62a12dd0d1` in an isolated local Vite preview. No website UI files were edited for the capture. External requests were blocked and no browser page errors occurred. The local Port Daddy runtime remained halted.

This is regression evidence for the actual `/research` and `/whitepaper` consumers. The changed research-program JSON fields have no production component import, and the changed textbook epigraph fields are not rendered by the current production components. The capture therefore does **not** show those hidden data corrections. Their verification is source-based. At capture time, the published Book metadata described 836 pages and the local review candidate had 837 pages. These are capture-time facts; the final print candidate is identified in the parent acceptance receipt. The website capture is not print-layout evidence.

The mobile Research page uses a scrollable panel; its screenshot records the viewport, not all panel contents. All artifact links are relative to this directory; the worktree and loopback address in the receipt are capture provenance, not requirements for viewing these files.
