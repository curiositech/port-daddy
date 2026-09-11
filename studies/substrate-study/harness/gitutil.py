"""Thin subprocess wrapper around the `git` binary. No third-party deps."""
from __future__ import annotations

import subprocess
from dataclasses import dataclass


class GitError(RuntimeError):
    def __init__(self, args, returncode, stdout, stderr):
        self.args_ = args
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr
        super().__init__(
            f"git {' '.join(args)} failed ({returncode}): {stderr.strip()[:2000]}"
        )


@dataclass
class GitResult:
    returncode: int
    stdout: str
    stderr: str


def run(cwd: str, args: list[str], check: bool = True, input_text: str | None = None,
        timeout: float | None = 120) -> GitResult:
    proc = subprocess.run(
        ["git", *args],
        cwd=cwd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="surrogateescape",
        input=input_text,
        timeout=timeout,
    )
    if check and proc.returncode != 0:
        raise GitError(args, proc.returncode, proc.stdout, proc.stderr)
    return GitResult(proc.returncode, proc.stdout, proc.stderr)


def rev_parse(cwd: str, rev: str) -> str:
    return run(cwd, ["rev-parse", rev]).stdout.strip()
