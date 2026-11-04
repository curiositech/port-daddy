# Book download text-size repair

The Book intro and download controls reflow when computed text size leaves too
little reading width. The browser guard measures actual word rectangles, so
within-word fragmentation fails even when target size and horizontal overflow pass.

[Browser results](browser-report.json) cover 16 Chromium layouts in both themes,
including 320, 390, 768 and 844 pixel widths at 200% root-font text. The
[scoped QA receipt](qa-summary.json) records measurements and limitations.
[Download negative control](before-download-readability.json) and
[title negative control](before-title-readability.json) reproduce the production
defects. The PDF action was 713 pixels tall; the corrected phone action preserves
whole words in two or three lines. Ordinary phone and desktop geometry is retained.

[Light recording](book-phone-390-light-text200.webm) and
[dark recording](book-phone-390-dark-text200.webm) show actual root-font enlargement,
Tab focus through PDF, facing, source and chapter links, chapter navigation and Back.
[Recording receipt](recording-receipt.json) includes decoded-frame checks and hashes.
This is a 16-to-32 pixel root-font simulation, not browser zoom or a physical device.
No site or Relay responses were mocked. Book readiness uses its heading, fonts and
decoded cover; an unrelated pending Relay authentication request cannot hold it up.

Rendered views: [original defect](before-phone-text200.png),
[390px light downloads](390x844-light-text200-downloads-viewport.png),
[320px dark downloads](320x740-dark-text200-downloads-viewport.png),
[320px title](320x740-light-text200-viewport.png),
[ordinary phone](390x844-light-viewport.png),
[ordinary desktop](1440x1000-dark-viewport.png),
[enlarged tablet](768x900-light-text200-viewport.png), and
[enlarged landscape](844x390-dark-text200-downloads-viewport.png).

This is acceptance of the Book intro and download reflow. Existing shared-header
crowding and the floating type-theme control remain visible at enlarged text sizes;
whole-site accessibility approval is not claimed. The automated contrast check also
leaves decorative arrow glyphs unassessed; the separate text-contrast audit passes.
