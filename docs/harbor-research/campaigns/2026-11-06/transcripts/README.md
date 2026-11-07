# Recorded visible campaign interactions

[manifest.json](manifest.json) inventories the authorized root chat and descendants
born on November 6, 2026 in `America/Los_Angeles`. Parentage is established from
first-line session metadata before any descendant body is read. Unrelated chat
bodies are never opened. Root events before `2026-11-06T19:00:00Z` are excluded.

Each `*.visible.jsonl.gz` contains visible user messages, assistant commentary and
final messages, tool arguments and results, and inter-agent messages. Each record
has its original source line index, byte offset, byte length, and SHA-256. Allowed
field values are preserved after JSON decoding; serialization and the provenance
envelope are normalized. These files are projections, not raw log copies.

Each matching `*.exclusions.jsonl.gz` records omitted source lines by index,
offset, length, hash, and reason, plus removed internal field names on retained
records. It contains no omitted message text. Hidden reasoning, system/developer
messages, session metadata, turn context, account metadata, unsupported content,
and detected credentials are excluded. Nested transcript inspection and exporter
preparation are excluded to prevent hidden prompt disclosure and recursive log
copies. When one side of a tool exchange is excluded, the other side is omitted
as well. Pattern filtering is conservative and cannot establish detection of
all possible secret encodings.

The manifest binds every archive hash to a recorded complete-line source prefix
and reports all exclusion and sanitization counts. Source logs are never modified.
An incomplete trailing line is outside the captured prefix. The capture covers
**visible events exported from the recorded prefixes**, not all future events or
an assertion that every agent has finished. Re-run after active agents finish to
capture their final visible interactions.

The exporter is `scripts/harbor-research/export_campaign_transcripts.py`. Pass
`--root-log`, `--root-id`, `--child-dir`, `--child-day 2026-11-06`,
`--child-timezone America/Los_Angeles`, `--root-cutoff 2026-11-06T19:00:00Z`, and
`--output` naming this directory. The root ID is
`01a0e15a-bf65-75a0-8c95-dc632a9fe7d5`; the source basename and all descendant IDs
are in the manifest. The command prints only aggregate counts. Run its focused
synthetic tests with Python unittest discovery for
`test_export_campaign_transcripts.py`; tests write temporary fixtures inside the
verified worktree and require no Port Daddy runtime.

## Publication boundary

The compressed visible-interaction and exclusion archives are retained privately on the operator machine with mode 0600 and ignored by Git. The public manifest records their hashes and capture scope; it does not make their bodies downloadable. Curated team reports and reviewed proof-command outputs are separately publishable. Saving interactions does not authorize disclosing unrelated personal context embedded in a long-running chat.
