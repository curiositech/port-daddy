# Port Daddy Scout

Port Daddy Scout is the browser-side visual task intake. It turns the web page
you are looking at into a Port Daddy visual task with a screenshot, optional
region rectangle, and DOM clues when the page allows them.

Scout is in preview. It talks to the exact local endpoint published by the
running Port Daddy daemon. It does not assume a port or scan loopback ports.
The unpacked preview currently stores an explicitly connected endpoint in
extension-local storage and fails closed when that endpoint is missing or stale.
The Web Store release must replace that preview handoff with the signed native
connector before it is promoted as a one-click operator flow.

The customer install should be the Chrome Web Store, not a manual Developer Mode
walkthrough. The preview package in this checkout is a Web Store-shaped ZIP plus
checksum; local Chrome still loads the unpacked directory while the Store listing
is pending.

## Preview install

With Port Daddy running, load Scout in Chrome from the checkout:

1. Open `chrome://extensions`.
2. Turn on Developer mode.
3. Click **Load unpacked**.
4. Choose this folder: `apps/pd-scout-extension`.
5. Open any ordinary web page and click the Scout toolbar icon.
6. During the unpacked preview, connect the published local endpoint shown by
   Port Daddy. Scout deliberately has no guessed fallback.

Chrome blocks extension capture on browser-internal pages such as `chrome://`.
Use a normal page when you test capture or region selection.

To build the preview package:

```bash
npm run package:scout-extension
```

The package lands at:

```text
website-v2/public/downloads/pd-scout-chrome-0.1.0.zip
website-v2/public/downloads/pd-scout-chrome-0.1.0.zip.sha256
website-v2/public/downloads/pd-scout-chrome-preview-manifest.json
```

That ZIP is for Chrome Web Store upload and preview download. To test it
locally, unzip it and use **Load unpacked** on the extracted folder.

## Real release path

The public install should come from the Chrome Web Store:

1. Package only the runtime extension files into a ZIP with `manifest.json` at
   the root.

   ```bash
   npm run package:scout-extension
   ```

2. Upload `website-v2/public/downloads/pd-scout-chrome-0.1.0.zip` in the Chrome
   Web Store Developer Dashboard.
3. Fill out the Store Listing, Privacy, Distribution, and Test instructions.
4. Submit for review. Use trusted testers first, then move to public or unlisted
   distribution when the local path has enough proof.
5. For updates, bump `manifest.json` `version`, upload a fresh ZIP with all
   extension files, and submit that version for review.

Before public listing, the store page needs final copy, privacy declarations for
the screenshot/URL/DOM-context capture, at least one real 1280 x 800 screenshot,
and the promo tiles already checked into `assets/store`.

## Brand assets

Scout ships with its own Chrome extension identity, built from the Port Daddy
mark plus region-selection brackets:

- `assets/icons/scout-icon.svg` source mark.
- `assets/icons/scout-icon-16.png`, `scout-icon-32.png`,
  `scout-icon-48.png`, and `scout-icon-128.png` for the manifest and toolbar.
- `assets/store/scout-store-icon-128.png` for the Chrome Web Store icon.
- `assets/store/scout-small-promo-440x280.png` and
  `assets/store/scout-marquee-promo-1400x560.png` for promotional tiles.
- `assets/store/scout-screenshot-1280x800.png` for the first store screenshot.

## Use

1. Open any ordinary web page.
2. Click the Port Daddy Scout extension.
3. Capture the visible tab or draw a region. After a region capture, Scout
   briefly marks the selected rectangle on the page and reopens the composer.
4. Write the brief.
5. Choose where to file it: review queue only, local spawn target, or cloud
   fleet queue.
6. Open the issue.

Scout captures the active tab with `chrome.tabs.captureVisibleTab`, can inject a
temporary Shadow DOM region picker, samples DOM selectors/XPath/text/bounds, and
shows the screenshot, selected rectangle, and DOM sample before submission.
Project choices are loaded from the daemon's `GET /projects` route, with manual
entry as a fallback.

Before opening the visual task, Scout uploads the screenshot to `/blob` and sends
`POST /visual-tasks` a compact envelope with the blob URL, rectangle, viewport,
brief, routing choice, and DOM decomposition. The daemon publishes the payload to
the `visual-feedback` channel and opens a reviewable Port Daddy work item.

The **Spawn work now** checkbox is separate from the filing choice. Off means
"open the issue only." On asks Port Daddy to start work immediately when the
configured backend supports it.

## Repro test

Use the Playwright repro when changing the popup, background service worker, region
picker, or visual-task payload:

```bash
node apps/pd-scout-extension/tests/scout-region-repro.mjs
node apps/pd-scout-extension/tests/daemon-endpoint.selftest.mjs
```

The script uses Playwright's bundled Chromium, serves a fixture web app, draws a
rectangle, checks the on-page captured highlight, verifies the reopened composer,
submits to a mock daemon, and asserts the payload contains blob-backed screenshot
evidence, the selected region, daemon project selection, and DOM decomposition.

For automation only, the script copies the extension to a temporary directory and
adds `<all_urls>` to that temp manifest because Playwright cannot click Chrome's
toolbar action to grant `activeTab`. The checked-in manifest stays narrower.

## Limits

- Chrome blocks capture on browser-internal pages such as `chrome://`.
- DOM decomposition is strongest on project web apps; arbitrary third-party
  pages may only provide visible DOM hints, not source-code ownership.
- Cloud fleet routing depends on the configured Port Daddy backend. The local
  daemon path is the tested path in this checkout.
