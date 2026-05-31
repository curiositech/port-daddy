# Söhne Trial Font Slot

This directory is reserved for Klim Type Foundry's official Söhne test fonts.

Do not commit licensed production font files here. The website token layer uses
the trial families only when these local files are present, then falls back to
generic system sans or monospace families.

Expected local trial filenames:

- `TestSohne-Buch.woff2` for weight `400`
- `TestSohne-Kraftig.woff2` for weight `500`
- `TestSohne-Halbfett.woff2` for weight `700`
- `TestSohneMono-Buch.woff2` for optional monospace weight `400`
- `TestSohneMono-Kraftig.woff2` for optional monospace weight `500`
- `TestSohneMono-Halbfett.woff2` for optional monospace weight `700`

The current Söhne-only preview intentionally points `--font-mono` at the base
`Test Söhne` family too. The mono files are installed for comparison, but code
and terminal surfaces do not use them while evaluating the stricter one-face
direction.

Install from Klim's downloaded test-font zip or extracted test-font folder with:

```bash
bash scripts/install-soehne-trial.sh /path/to/klim-test-fonts.zip-or-folder
```

Klim test fonts are for internal evaluation and mockups, not production use.
Before publishing Söhne publicly, replace this trial slot with properly licensed
production webfont files and update the license notes.

Do not copy or hotlink the Söhne font files served from Klim's own website
assets. Those files are there for Klim's site; they are not a reusable Port
Daddy font package. Use the official test-font download or licensed production
webfonts.
