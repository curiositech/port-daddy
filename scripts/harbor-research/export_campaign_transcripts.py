#!/usr/bin/env python3
"""Export a bounded, sanitized projection of one authorized Codex chat family.

Never copies session metadata, turn context, reasoning or internal state. Source
files remain immutable. Discovery reads only the first line of candidate files;
only proven descendants are subsequently read. No source text is printed.
"""
from __future__ import annotations

import argparse
from collections import Counter
from contextlib import contextmanager
from datetime import datetime, timezone
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import stat
from zoneinfo import ZoneInfo

SCHEMA = "harbor-visible-transcript/v1"
TOOL_TYPES = {"function_call", "function_call_output", "custom_tool_call", "custom_tool_call_output"}
FIELDS = {
    "message": {"type", "id", "role", "phase", "channel", "status", "content"},
    "agent_message": {"type", "id", "author", "recipient", "content"},
    "function_call": {"type", "id", "name", "namespace", "arguments", "call_id", "status"},
    "function_call_output": {"type", "id", "call_id", "output"},
    "custom_tool_call": {"type", "id", "name", "input", "call_id", "status"},
    "custom_tool_call_output": {"type", "id", "call_id", "output"},
}
# Conservative, whole-event omissions. A matched tool exchange is omitted in
# both directions; secret-bearing text is never replaced with invented text.
SENSITIVE = re.compile(
    r"(?i)(?:\bBearer\s+[A-Za-z0-9._~+/-]{8,}|\b(?:pdr_|pdu_|ghp_|github_pat_|sk-(?:proj-)?)[A-Za-z0-9_-]{8,}|"
    r"\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|pairing[_ -]?code)"
    r"\s*[\"']?\s*[:=]\s*[\"']?[A-Za-z0-9_+/.=-]{6,}|"
    r"\b(?:token|secret)\s*[\"']?\s*[:=]\s*[\"']?[A-Za-z0-9_+/.=-]{12,}|"
    r"\bpairing[_ -]?code\s+(?:is\s+)?[A-Z0-9-]{6,}|"
    r"\bAKIA[A-Z0-9]{16}\b|\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|"
    r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)"
)
PROTECTED = re.compile(
    r"(?i)(?:base_instructions|internal_chat_message_metadata_passthrough|encrypted_content|creator_account_id|creator_user_id|"
    r"<\|(?:system|developer|analysis)\|>|\"role\"\s*:\s*\"(?:system|developer)\"|"
    r"\"(?:type|channel|phase)\"\s*:\s*\"(?:reasoning|analysis|turn_context|session_meta)\")"
)
RECURSIVE = re.compile(
    r"(?i)(?:\.codex/sessions|rollout-\d{4}-\d{2}-\d{2}|export_campaign_transcripts|"
    r"test_export_campaign_transcripts|session_meta|base_instructions|"
    r"campaigns/2026-11-06/transcripts)"
)


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def encode(value) -> bytes:
    return (json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True) + "\n").encode("utf-8")


def timestamp(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("timestamp must have an explicit timezone")
    return parsed.astimezone(timezone.utc)


def metadata(path: Path) -> dict:
    # No other line may be read until parentage is established.
    with path.open("rb") as handle:
        first = json.loads(handle.readline())
    if first.get("type") != "session_meta":
        raise ValueError("missing first-line session metadata")
    payload = first["payload"]
    source = payload.get("source", {})
    parent = None
    if isinstance(source, dict):
        parent = source.get("subagent", {}).get("thread_spawn", {}).get("parent_thread_id")
    if not re.fullmatch(r"[A-Za-z0-9_-]+", payload["id"]):
        raise ValueError("unsafe session identifier")
    return {"id": payload["id"], "parent_id": parent, "born": payload.get("timestamp", first.get("timestamp"))}


def discover(root_log: Path, root_id: str, child_dir: Path, child_day: str, child_timezone: str = "America/Los_Angeles") -> list[dict]:
    root = metadata(root_log)
    if root["id"] != root_id:
        raise ValueError("root session identity mismatch")
    candidates = []
    for path in sorted(child_dir.glob("*.jsonl")):
        try:
            item = metadata(path)
            if timestamp(item["born"]).astimezone(ZoneInfo(child_timezone)).date().isoformat() == child_day:
                candidates.append({**item, "path": path})
        except (ValueError, KeyError, TypeError, AttributeError):
            continue
    selected = [{**root, "path": root_log}]
    allowed = {root_id}
    while True:
        children = [item for item in candidates if item["parent_id"] in allowed and item["id"] not in allowed]
        if not children:
            break
        if len({item["id"] for item in children}) != len(children):
            raise ValueError("duplicate authorized session id")
        selected.extend(children)
        allowed.update(item["id"] for item in children)
    return selected


def snapshot(path: Path) -> tuple[bytes, int]:
    with path.open("rb") as handle:
        size = path.stat().st_size
        captured = handle.read(size)
    complete = captured.rfind(b"\n") + 1
    return captured[:complete], len(captured) - complete


INTERNAL_KEYS = {
    "base_instructions", "internal_chat_message_metadata_passthrough",
    "encrypted_content", "creator_account_id", "creator_user_id",
    "creator_account", "creator_user", "system_prompt", "developer_prompt",
    "reasoning", "analysis", "turn_context", "session_meta",
}
HIDDEN_KINDS = {"reasoning", "analysis", "turn_context", "session_meta"}


def omission_reason(value, *, tool: bool) -> str:
    """Inspect structured fields and decoded JSON strings without retaining them."""
    pending = [(value, 0)]
    visited = 0
    while pending:
        item, depth = pending.pop()
        visited += 1
        if depth > 64 or visited > 100000:
            return "unsupported_nested_content"
        if isinstance(item, dict):
            for key, child in item.items():
                if not isinstance(key, str):
                    return "unsupported_nested_content"
                lower = key.lower()
                if (lower in INTERNAL_KEYS
                        or (lower == "role" and isinstance(child, str)
                            and child.lower() in {"system", "developer"})
                        or (lower in {"type", "channel", "phase"}
                            and isinstance(child, str) and child.lower() in HIDDEN_KINDS)):
                    return "protected_prompt_or_internal_state"
            # Credential patterns require the key/value relationship; scanning
            # just string values loses that context for structured tool outputs.
            try:
                serialized = json.dumps(item, ensure_ascii=False)
            except (TypeError, ValueError, RecursionError):
                return "unsupported_nested_content"
            if SENSITIVE.search(serialized):
                return "credential_pattern"
            pending.extend((child, depth + 1) for child in item.values())
        elif isinstance(item, list):
            pending.extend((child, depth + 1) for child in item)
        elif isinstance(item, str):
            if SENSITIVE.search(item):
                return "credential_pattern"
            if PROTECTED.search(item):
                return "protected_prompt_or_internal_state"
            if tool and RECURSIVE.search(item):
                return "transcript_inspection_or_export_preparation"
            try:
                decoded = json.loads(item)
            except (ValueError, TypeError):
                continue
            except RecursionError:
                return "unsupported_nested_content"
            if isinstance(decoded, (dict, list, str)):
                pending.append((decoded, depth + 1))
    return ""


def project(record: dict) -> tuple[dict | None, str, list[str]]:
    if record.get("type") != "response_item":
        return None, "non_response_record", []
    payload = record.get("payload")
    if not isinstance(payload, dict):
        return None, "invalid_payload", []
    kind = payload.get("type")
    if kind not in FIELDS:
        return None, "hidden_or_unsupported_item", []
    if kind == "message":
        if payload.get("role") not in {"user", "assistant"}:
            return None, "non_visible_role", []
        if payload.get("role") == "assistant" and payload.get("phase", payload.get("channel")) not in {"commentary", "final"}:
            return None, "assistant_phase_not_explicitly_visible", []
        if payload.get("channel") == "analysis" or payload.get("phase") == "analysis":
            return None, "hidden_analysis", []
    clean = {key: value for key, value in payload.items() if key in FIELDS[kind]}
    dropped = ["payload." + key for key in payload if key not in FIELDS[kind]]
    if kind in {"message", "agent_message"}:
        content = payload.get("content")
        if not isinstance(content, list):
            return None, "unsupported_content_shape", []
        blocks = []
        for index, block in enumerate(content):
            if not isinstance(block, dict) or block.get("type") not in {"input_text", "output_text", "text"} or not isinstance(block.get("text"), str):
                return None, "unsupported_nontext_content", []
            blocks.append({"type": block["type"], "text": block["text"]})
            dropped.extend(f"payload.content[{index}].{key}" for key in block if key not in {"type", "text"})
        clean["content"] = blocks
    reason = omission_reason(clean, tool=kind in TOOL_TYPES)
    if reason:
        return None, reason, []
    return {"timestamp": record.get("timestamp"), "type": "response_item", "payload": clean}, "", sorted(dropped)


def export_source(source: dict, cutoff: str | None) -> tuple[list[dict], list[dict], dict]:
    prefix, partial = snapshot(source["path"])
    rows = []
    excluded_calls = set()
    offset = 0
    cutoff_time = timestamp(cutoff) if cutoff else None
    for index, raw in enumerate(prefix.splitlines(keepends=True), 1):
        provenance = {"source_line": index, "source_byte_offset": offset, "source_bytes": len(raw), "source_sha256": digest(raw)}
        offset += len(raw)
        try:
            record = json.loads(raw)
            if cutoff_time and timestamp(record["timestamp"]) < cutoff_time:
                projected, reason, dropped = None, "before_root_cutoff", []
            else:
                projected, reason, dropped = project(record)
            call_id = record.get("payload", {}).get("call_id")
            if reason and record.get("payload", {}).get("type") in TOOL_TYPES and call_id:
                excluded_calls.add(call_id)
        except (ValueError, KeyError, TypeError, AttributeError, RecursionError):
            projected, reason, dropped, call_id = None, "invalid_record", [], None
        rows.append((provenance, projected, reason, dropped, call_id))
    events, omissions = [], []
    for provenance, projected, reason, dropped, call_id in rows:
        if not reason and call_id in excluded_calls:
            reason = "paired_with_excluded_tool_event"
        if reason:
            omissions.append({**provenance, "reason": reason})
        else:
            events.append({**provenance, "event": projected})
            if dropped:
                omissions.append({**provenance, "reason": "internal_fields_removed", "removed_fields": dropped})
    manifest = {
        "session_id": source["id"], "parent_session_id": source["parent_id"],
        "source_basename": source["path"].name, "source_prefix_bytes": len(prefix),
        "source_prefix_sha256": digest(prefix), "source_prefix_lines": len(rows),
        "incomplete_trailing_bytes_not_exported": partial, "root_cutoff_inclusive": cutoff,
        "exported_events": len(events), "excluded_events": sum(1 for row in omissions if row["reason"] != "internal_fields_removed"),
        "sanitized_events": sum(1 for row in omissions if row["reason"] == "internal_fields_removed"),
        "exclusion_and_sanitization_counts": dict(sorted(Counter(row["reason"] for row in omissions).items())),
    }
    return events, omissions, manifest


@contextmanager
def private_directory(path: Path, *, create: bool = False):
    """Open each directory component without following symlinks (POSIX)."""
    path = Path(path).absolute()
    if ".." in path.parts:
        raise ValueError("output path traversal refused")
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    descriptor = os.open(path.anchor, flags)
    try:
        for part in path.parts[1:]:
            if create:
                try:
                    os.mkdir(part, mode=0o700, dir_fd=descriptor)
                except FileExistsError:
                    pass
            next_descriptor = os.open(part, flags, dir_fd=descriptor)
            os.close(descriptor)
            descriptor = next_descriptor
        yield descriptor
    finally:
        os.close(descriptor)


def private_write(path: Path, data: bytes) -> None:
    """Publish complete mode-0600 bytes atomically, without following links."""
    path = Path(path)
    with private_directory(path.parent) as directory:
        try:
            existing = os.stat(path.name, dir_fd=directory, follow_symlinks=False)
        except FileNotFoundError:
            existing = None
        if existing is not None and (not stat.S_ISREG(existing.st_mode) or existing.st_nlink != 1):
            raise ValueError("output must be a regular single-link file")
        temporary = f".{path.name}.{secrets.token_hex(12)}.pending"
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                             0o600, dir_fd=directory)
        try:
            with os.fdopen(descriptor, "wb") as stream:
                os.fchmod(stream.fileno(), 0o600)
                stream.write(data)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, path.name, src_dir_fd=directory, dst_dir_fd=directory)
            os.fsync(directory)
        finally:
            try:
                os.unlink(temporary, dir_fd=directory)
            except FileNotFoundError:
                pass


def archive(path: Path, rows: list[dict]) -> dict:
    data = b"".join(encode(row) for row in rows)
    compressed = gzip.compress(data, mtime=0)
    private_write(path, compressed)
    return {"file": path.name, "sha256": digest(compressed), "uncompressed_sha256": digest(data), "bytes": len(compressed), "records": len(rows)}


def run(root_log: Path, root_id: str, child_dir: Path, child_day: str, cutoff: str, output: Path, child_timezone: str = "America/Los_Angeles") -> dict:
    sources = discover(root_log, root_id, child_dir, child_day, child_timezone)
    with private_directory(output, create=True):
        pass
    manifests = []
    for source in sources:
        events, exclusions, manifest = export_source(source, cutoff if source["id"] == root_id else None)
        manifest["visible_archive"] = archive(output / f"{source['id']}.visible.jsonl.gz", events)
        manifest["exclusions_archive"] = archive(output / f"{source['id']}.exclusions.jsonl.gz", exclusions)
        manifests.append(manifest)
    result = {
        "schema": SCHEMA, "root_session_id": root_id, "child_birth_date": child_day, "child_birth_timezone": child_timezone,
        "scope": "Visible events exported from each recorded complete-line source prefix; not all future events.",
        "authorization": "Only named root and first-line-parentage-proven descendants born on the selected date in the declared timezone.",
        "projection": "Allowed visible field values are preserved exactly after JSON decoding; JSON serialization and envelopes are normalized. This is not a raw source-log copy.",
        "exclusions": "Hidden reasoning, system/developer messages, session metadata, turn context, internal fields, unsupported content, credential-pattern events, nested source-log inspection/export preparation, and both sides of affected tool exchanges.",
        "secret_filter_limit": "Conservative pattern-based omissions are not proof that every possible secret encoding is detectable. Review before wider publication.",
        "sources": manifests,
    }
    private_write(output / "manifest.json", encode(result))
    return {"sessions": len(manifests), "visible_events": sum(row["exported_events"] for row in manifests), "excluded_events": sum(row["excluded_events"] for row in manifests), "sanitized_events": sum(row["sanitized_events"] for row in manifests)}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root-log", required=True, type=Path)
    parser.add_argument("--root-id", required=True)
    parser.add_argument("--child-dir", required=True, type=Path)
    parser.add_argument("--child-day", required=True)
    parser.add_argument("--child-timezone", default="America/Los_Angeles")
    parser.add_argument("--root-cutoff", required=True)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    print(json.dumps(run(args.root_log, args.root_id, args.child_dir, args.child_day, args.root_cutoff, args.output, args.child_timezone), sort_keys=True))


if __name__ == "__main__":
    main()
