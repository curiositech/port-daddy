type: fixed

- **Whitepaper Book (`coordination-papers-mega-volume.pdf`) editorial pass: margin captions, 5 new figures, 12 glossed terms, humanized prose.** Figure/table captions across 8 chapters now live in the margin column via a new `\pdmargincaption` macro; 5 previously prose-only mechanism walls got new TikZ figures; 12 house terms are glossed at first use; chirpy/aphorism-stacked prose was cut. Fixes a merge-surfaced bug where margin-moved captions' `\label`/`\ref` pairs resolved to `\caption@xref` (permanently undefined) in the combined Book edition.
