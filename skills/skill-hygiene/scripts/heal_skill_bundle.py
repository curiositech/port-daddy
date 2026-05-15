#!/usr/bin/env python3
"""Heal a drifted skill bundle by dispatching to claude-haiku or claude-sonnet.

Reads the current state of a bundle (SKILL.md, every non-trivial subdirectory,
audit findings) and asks Claude to emit a set of file writes that make every
orphaned asset reachable from SKILL.md, plus rename proposals for files with
illegal characters.

Writes the result back to disk, then runs the auditor to verify.

Usage:
    python3 heal_skill_bundle.py <skill_root> [--model haiku|sonnet] [--apply]

By default, prints proposed changes without writing. Use --apply to mutate.

Uses the `claude` CLI in -p (print) mode. OAuth or keychain auth is honored.

NOT for healing skills with mis-paired content (frontmatter says X, content
is about Y). Those need human review.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

MODELS = {
    "haiku": "claude-haiku-4-5",
    "sonnet": "claude-sonnet-4-6",
}

DEFAULT_TIMEOUT_SEC = 240
SKIP_FILES = {"CHANGELOG.md", "README.md", "SKILL.md", "provenance.json",
              "_book_identity.json", "_raw_response.md", "affordance-scorecard.json",
              "architecture.html"}
SKIP_DIRS = {".git", "__pycache__", "output", "node_modules", ".venv"}


def fail(message: str) -> None:
    print(f"ERROR: {message}", file=sys.stderr)
    sys.exit(2)


def extract_h1(text: str) -> str:
    for line in text.splitlines():
        line = line.strip()
        if line.startswith("# ") or line.startswith("## "):
            return line.lstrip("# ").strip()
    return ""


def truncate(text: str, limit: int = 800) -> str:
    if len(text) <= limit:
        return text
    return text[:limit] + "\n... [truncated]"


def collect_subdir(skill_root: Path, subdir: Path) -> list[dict]:
    files = []
    for p in sorted(subdir.rglob("*")):
        if not p.is_file():
            continue
        if p.name in SKIP_FILES or p.name.startswith("."):
            continue
        if any(part in SKIP_DIRS for part in p.parts):
            continue
        rel = p.relative_to(skill_root).as_posix()
        try:
            text = p.read_text(encoding="utf-8", errors="replace")
            is_text = True
        except Exception:
            text = ""
            is_text = False
        entry = {
            "path": rel,
            "is_index": p.name == "INDEX.md",
            "has_illegal_chars": any(c in p.name for c in ":?*|<>"),
        }
        if is_text and p.suffix.lower() in {".md", ".json", ".yaml", ".yml", ".sh", ".py", ".ts", ".js", ".txt"}:
            entry["h1"] = extract_h1(text)
            entry["excerpt"] = truncate(text)
        else:
            entry["asset"] = True
        files.append(entry)
    return files


def collect_bundle_context(skill_root: Path) -> dict:
    skill_md = (skill_root / "SKILL.md").read_text(encoding="utf-8")
    subdirs: dict[str, list[dict]] = {}
    for sd in sorted(p for p in skill_root.iterdir()
                     if p.is_dir() and p.name not in SKIP_DIRS):
        files = collect_subdir(skill_root, sd)
        if files:
            subdirs[sd.name] = files
    return {
        "skill_root": str(skill_root),
        "skill_name": skill_root.name,
        "skill_md": skill_md,
        "subdirs": subdirs,
    }


def run_audit(skill_root: Path, auditor_path: Path) -> dict:
    result = subprocess.run(
        ["python3", str(auditor_path), str(skill_root), "--json"],
        capture_output=True, text=True,
    )
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError:
        return {"ok": False, "stdout": result.stdout, "stderr": result.stderr}


PROMPT_TEMPLATE = """You are healing a Claude Code skill bundle that has drift.
Your job: make every bundled file reachable from SKILL.md.

SKILL NAME: {skill_name}

--- CURRENT SKILL.md ---
{skill_md}
--- END SKILL.md ---

--- BUNDLED SUBDIRECTORIES ---
{subdirs_block}
--- END SUBDIRECTORIES ---

--- AUDIT FINDINGS (what's currently broken) ---
{audit_block}
--- END AUDIT FINDINGS ---

YOUR TASK:

Emit a JSON object (nothing else; no preamble, no markdown fence) with these keys:

{{
  "writes": [
    {{ "path": "<bundle-relative path>", "content": "<full new file content>" }},
    ...
  ],
  "renames": [
    {{ "from": "<old bundle-relative path>", "to": "<new bundle-relative path>" }}
  ],
  "notes": "<one short paragraph: what you changed and why>"
}}

RULES:

1. Preserve the YAML frontmatter (between --- markers) of SKILL.md byte-for-byte.
2. Preserve all useful prose from the existing SKILL.md. You are integrating
   orphaned content, not replacing the skill.
3. For each subdirectory that has more than one doc file and no working
   INDEX.md, emit a new INDEX.md as a `writes` entry. Use a pipe-table:
   `| File | When to load |` with each row's trigger written in the agent's
   voice — observable ("you need X" / "you're about to Y"), not abstract.
4. Add a "## Bundled Assets" section to SKILL.md that points at each
   subdirectory's `INDEX.md` (or directly at the file if there's only one).
5. Where natural, weave specific callouts into existing prose (e.g.
   "see `references/foo.md` for the formal model"). Don't force it.
6. If a filename has an illegal character (`:`, `?`, `*`, `|`, `<`, `>`),
   propose a clean rename in `renames`. Keep any leading number prefix.
7. NEVER invent content. Use only what's present in the supplied excerpts.
8. Keep SKILL.md tight: progressive disclosure is the goal, not encyclopedia.
9. Only emit `writes` for files you are CHANGING or CREATING. Don't echo
   files you're not modifying.

Return ONLY the JSON object."""


def build_prompt(ctx: dict, audit: dict) -> str:
    subdirs = ctx["subdirs"]
    if subdirs:
        blocks = []
        for name, entries in subdirs.items():
            entry_lines = []
            for e in entries:
                if e.get("asset"):
                    entry_lines.append(f"  - {e['path']} (asset, not a doc)")
                elif e.get("is_index"):
                    entry_lines.append(
                        f"  - {e['path']} (existing INDEX.md):\n    H1: {e.get('h1', '')}\n    excerpt:\n      {e.get('excerpt', '').replace(chr(10), chr(10) + '      ')}"
                    )
                else:
                    illegal = " [ILLEGAL CHARS]" if e.get("has_illegal_chars") else ""
                    entry_lines.append(
                        f"  - {e['path']}{illegal}\n    H1: {e.get('h1', '')}\n    excerpt:\n      {e.get('excerpt', '').replace(chr(10), chr(10) + '      ')}"
                    )
            blocks.append(f"SUBDIRECTORY: {name}/\n" + "\n".join(entry_lines))
        subdirs_block = "\n\n".join(blocks)
    else:
        subdirs_block = "(no bundled subdirectories)"

    audit_summary = {
        k: v for k, v in audit.items()
        if k in ("orphans", "drift", "broken_links", "missing_indexes_failure", "missing_indexes_warning")
    }
    audit_block = json.dumps(audit_summary, indent=2)

    return PROMPT_TEMPLATE.format(
        skill_name=ctx["skill_name"],
        skill_md=ctx["skill_md"],
        subdirs_block=subdirs_block,
        audit_block=audit_block,
    )


def call_claude(prompt: str, model: str, timeout: int = DEFAULT_TIMEOUT_SEC) -> str:
    cmd = ["claude", "-p", "--model", model, prompt]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    if result.returncode != 0:
        raise RuntimeError(f"claude CLI failed (exit {result.returncode}): {result.stderr[:500]}")
    return result.stdout.strip()


def parse_response(raw: str) -> dict:
    text = raw.strip()
    # Strategy 1: parse as-is.
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    # Strategy 2: strip outer markdown fence if present.
    fenced = re.search(r"```(?:json)?\s*\n(.*?)\n```", text, re.DOTALL)
    if fenced:
        try:
            return json.loads(fenced.group(1))
        except json.JSONDecodeError:
            pass
    # Strategy 3: brace-balanced extraction starting from first `{`.
    start = text.find("{")
    if start >= 0:
        depth = 0
        in_string = False
        escape = False
        for i, ch in enumerate(text[start:], start):
            if escape:
                escape = False
                continue
            if ch == "\\" and in_string:
                escape = True
                continue
            if ch == '"':
                in_string = not in_string
                continue
            if in_string:
                continue
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    candidate = text[start:i + 1]
                    try:
                        return json.loads(candidate)
                    except json.JSONDecodeError:
                        break
    raise RuntimeError(f"model output not valid JSON; raw head: {text[:300]}")


def apply_changes(skill_root: Path, response: dict, dry_run: bool) -> list[str]:
    log: list[str] = []
    for w in response.get("writes") or []:
        rel = w["path"]
        content = w["content"]
        target = skill_root / rel
        if not target.resolve().is_relative_to(skill_root):
            log.append(f"REFUSED write outside bundle: {rel}")
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        if dry_run:
            log.append(f"would write {rel} ({len(content)} chars)")
        else:
            target.write_text(content, encoding="utf-8")
            log.append(f"wrote {rel}")

    for r in response.get("renames") or []:
        src = skill_root / r["from"]
        dst = skill_root / r["to"]
        if not src.exists():
            log.append(f"skip rename {r['from']} -> {r['to']}: source missing")
            continue
        if dst.exists():
            log.append(f"skip rename {r['from']} -> {r['to']}: dest exists")
            continue
        if not dst.resolve().is_relative_to(skill_root):
            log.append(f"REFUSED rename outside bundle: {r['to']}")
            continue
        if dry_run:
            log.append(f"would rename {r['from']} -> {r['to']}")
        else:
            dst.parent.mkdir(parents=True, exist_ok=True)
            src.rename(dst)
            log.append(f"renamed {r['from']} -> {r['to']}")

    return log


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("skill_root", help="path to the skill bundle to heal")
    parser.add_argument("--model", choices=list(MODELS.keys()), default="sonnet")
    parser.add_argument("--apply", action="store_true",
                        help="write changes to disk (default: dry-run)")
    parser.add_argument("--auditor", default="skills/skill-hygiene/scripts/audit_skill_bundle.py")
    parser.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT_SEC)
    parser.add_argument("--save-response", default=None)
    args = parser.parse_args()

    skill_root = Path(args.skill_root).resolve()
    if not (skill_root / "SKILL.md").exists():
        fail(f"no SKILL.md at {skill_root}")

    auditor = Path(args.auditor).resolve()
    pre_audit = run_audit(skill_root, auditor) if auditor.exists() else {"ok": True}

    if pre_audit.get("ok"):
        print(f"  {skill_root.name}: already clean, skipping", file=sys.stderr)
        return 0

    print(f"Healing {skill_root.name} with {args.model}...", file=sys.stderr)
    ctx = collect_bundle_context(skill_root)
    prompt = build_prompt(ctx, pre_audit)
    model_id = MODELS[args.model]

    raw = call_claude(prompt, model_id, timeout=args.timeout)

    if args.save_response:
        Path(args.save_response).write_text(raw, encoding="utf-8")

    try:
        response = parse_response(raw)
    except RuntimeError as e:
        print(f"  ERROR: {e}", file=sys.stderr)
        return 3

    notes = response.get("notes", "(no notes)")
    print(f"  notes: {notes}", file=sys.stderr)

    log = apply_changes(skill_root, response, dry_run=not args.apply)
    for line in log:
        print(f"  {line}", file=sys.stderr)

    if args.apply and auditor.exists():
        post = run_audit(skill_root, auditor)
        ok = post.get("ok")
        print(f"  post-heal audit: {'OK' if ok else 'STILL FAILING'}", file=sys.stderr)
        if not ok:
            counts = {
                "orphans": len(post.get("orphans", [])),
                "drift": len(post.get("drift", [])),
                "broken_links": len(post.get("broken_links", [])),
                "missing_indexes_failure": len(post.get("missing_indexes_failure", [])),
            }
            print(f"  remaining: {counts}", file=sys.stderr)
        return 0 if ok else 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
