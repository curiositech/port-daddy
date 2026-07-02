# Port Daddy Scout Chrome Extension

Port Daddy Scout is the browser-side visual task intake. It is meant to be
loaded as an unpacked Chrome extension during development:

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Choose **Load unpacked**.
4. Select `apps/pd-scout-extension`.

Scout captures the active tab with `chrome.tabs.captureVisibleTab`, can inject a
temporary Shadow DOM region picker, samples DOM selectors/XPath/text/bounds, and
posts one envelope to the local daemon at `POST /visual-tasks`.

The daemon persists screenshots through `/blob`, publishes the payload to the
`visual-feedback` channel, optionally sends a target agent inbox message, and
opens a reviewable Port Daddy work item. The extension intentionally uses
operator vocabulary: issue, local agent, cloud fleet, review queue.
