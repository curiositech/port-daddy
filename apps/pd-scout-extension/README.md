# Port Daddy Scout Chrome Extension

Port Daddy Scout is the browser-side visual task intake. It turns the web page
you are looking at into a Port Daddy visual task with a screenshot, optional
region rectangle, and DOM clues when the page allows them.

## Current status

Scout works today as an unpacked Manifest V3 Chrome extension against a local
Port Daddy daemon. It is not packaged for the Chrome Web Store yet.

The default daemon URL is:

```text
http://127.0.0.1:9876
```

## Branding assets

Scout ships with its own Chrome extension identity, built from the Port Daddy
mark plus region-selection brackets:

- `assets/icons/scout-icon.svg` source mark.
- `assets/icons/scout-icon-16.png`, `scout-icon-32.png`,
  `scout-icon-48.png`, and `scout-icon-128.png` for the manifest and toolbar.
- `assets/store/scout-store-icon-128.png` for the Chrome Web Store icon.
- `assets/store/scout-small-promo-440x280.png` and
  `assets/store/scout-marquee-promo-1400x560.png` for promotional tiles.
- `assets/store/scout-screenshot-1280x800.png` for the first store screenshot.

## Install

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Choose **Load unpacked**.
4. Select `apps/pd-scout-extension`.
5. Confirm the popup daemon field points at your running Port Daddy daemon.

If you do not already have a checkout:

```bash
git clone https://github.com/curiositech/port-daddy.git
cd port-daddy
pd setup
pd status
```

Then load this folder in Chrome:

```text
apps/pd-scout-extension
```

## Use

1. Open any ordinary web page.
2. Click the Port Daddy Scout extension.
3. Capture the visible tab or draw a region.
4. Write the brief.
5. Choose review queue, local spawn, or cloud fleet routing.
6. Open the issue.

Scout captures the active tab with `chrome.tabs.captureVisibleTab`, can inject a
temporary Shadow DOM region picker, samples DOM selectors/XPath/text/bounds, and
posts one envelope to the local daemon at `POST /visual-tasks`.

The daemon persists screenshots through `/blob`, publishes the payload to the
`visual-feedback` channel, optionally sends a target inbox message, and opens a
reviewable Port Daddy work item. The extension intentionally uses operator
vocabulary: issue, local spawn, cloud fleet, review queue.

## Limits

- Chrome blocks capture on browser-internal pages such as `chrome://`.
- DOM decomposition is strongest on project web apps; arbitrary third-party
  pages may only provide visible DOM hints, not source-code ownership.
- Cloud fleet routing depends on the configured Port Daddy backend. The local
  daemon path is the tested path in this checkout.
