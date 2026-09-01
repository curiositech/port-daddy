# Formal analysis registry

This directory contains machine-readable models that directly establish,
qualify, or refute claims made by the seven-volume corpus. It is not the visual
proof directory (`whitepaper/proof/`), and it is not a dumping ground for every
product test.

The method-specific roots are:

- `proverif/` for protocol secrecy, authenticity, replay, and attenuation;
- `tla/` for state-machine invariants and temporal behavior;
- `z3/` for arithmetic and satisfiability obligations; and
- `easycrypt/` for proof developments whose completion status is stated
  explicitly.

`whitepaper/corpus.json` is the authority for status, ownership, chapter
consumers, runners, and evidence policy. A model beside deployed product code
remains a product-runtime satellite even when a chapter cites it; the manifest
records that relationship without copying the source here.

Current checked-in result text and run logs are evidence snapshots. CI output
is a separate, per-run artifact. Never describe a checked-in snapshot as fresh
CI evidence, and never describe a model containing admits as discharged.
