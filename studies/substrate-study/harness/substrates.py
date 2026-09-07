"""U, B(p), C, D, CR exactly as PROTOCOL.md S2.2 defines them, over real git
working trees. Landing uses `git apply --3way`; D uses real `git rebase`.
Claim tables are file-level (C, B) or line-range (CR).
"""
from __future__ import annotations

import os
import shutil
import tempfile

from . import gitutil

FULL_FILE_SENTINEL = (0, 10 ** 9)

# Fixed author/committer identity and clock so every commit this harness makes
# is byte-for-byte reproducible and never depends on the ambient environment.
_SIM_ENV_EXTRA = {
    "GIT_AUTHOR_NAME": "s2-sim",
    "GIT_AUTHOR_EMAIL": "s2-sim@substrate-study.invalid",
    "GIT_COMMITTER_NAME": "s2-sim",
    "GIT_COMMITTER_EMAIL": "s2-sim@substrate-study.invalid",
    "GIT_AUTHOR_DATE": "2026-01-01T00:00:00+00:00",
    "GIT_COMMITTER_DATE": "2026-01-01T00:00:00+00:00",
}


def _run(cwd, args, check=True, timeout=60):
    import subprocess
    env = dict(**_env_base(), **_SIM_ENV_EXTRA)
    # A bridging diff (see corpus.py) can sweep a binary file's content into
    # `git show`/`git diff` output (e.g. overwrite_files reading a binary
    # blob via `git show sha:path`); decode leniently so that never crashes
    # the harness instead of being handled as ordinary (if not human
    # readable) file content.
    proc = subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True,
                           encoding="utf-8", errors="surrogateescape",
                           env=env, timeout=timeout)
    if check and proc.returncode != 0:
        raise gitutil.GitError(args, proc.returncode, proc.stdout, proc.stderr)
    return proc


def _env_base():
    env = dict(os.environ)
    return env


class FileClaimTable:
    """C, and B(p)'s non-bypassed path: one claim per file, whole file."""

    def __init__(self):
        self.active: dict[str, tuple] = {}

    def try_claim(self, agent_id: int, task_id: int, files) -> bool:
        for f in files:
            holder = self.active.get(f)
            if holder is not None and holder[0] != agent_id:
                return False
        for f in files:
            self.active[f] = (agent_id, task_id)
        return True

    def release(self, agent_id: int, task_id: int, files) -> None:
        for f in files:
            holder = self.active.get(f)
            if holder == (agent_id, task_id):
                del self.active[f]


class RangeClaimTable:
    """CR: claims on line ranges within a file, not the whole file."""

    def __init__(self):
        self.active: dict[str, list] = {}

    @staticmethod
    def _overlaps(a, b):
        return a[0] <= b[1] and b[0] <= a[1]

    def try_claim(self, agent_id: int, task_id: int, file_ranges: dict) -> bool:
        for path, ranges in file_ranges.items():
            for (s, e, aid, tid) in self.active.get(path, []):
                if aid == agent_id:
                    continue
                for r in ranges:
                    if self._overlaps((s, e), tuple(r)):
                        return False
        for path, ranges in file_ranges.items():
            lst = self.active.setdefault(path, [])
            for r in ranges:
                lst.append((r[0], r[1], agent_id, task_id))
        return True

    def release(self, agent_id: int, task_id: int, file_ranges: dict) -> None:
        for path in file_ranges:
            lst = self.active.get(path, [])
            self.active[path] = [t for t in lst if not (t[2] == agent_id and t[3] == task_id)]


def claim_ranges_for_task(task) -> dict:
    """file -> list[(start,end)], falling back to a whole-file sentinel range
    for any touched file the unified diff produced no hunk ranges for."""
    out = {}
    for f in task.files:
        rs = task.file_ranges.get(f)
        out[f] = [tuple(r) for r in rs] if rs else [FULL_FILE_SENTINEL]
    return out


class GitWorkspace:
    """Owns one throwaway clone of the corpus's bare repo for the duration of
    a single run. `main_dir` is the one shared working tree used by U, B(p),
    C, and CR. `agent_dirs[i]` are real `git worktree` checkouts used only by
    D. Everything under `run_dir` is deleted on cleanup()."""

    def __init__(self, run_dir: str, bare_repo: str, base_sha: str, n_agents: int,
                 needs_agent_worktrees: bool):
        self.run_dir = run_dir
        self.bare_repo = bare_repo
        self.base_sha = base_sha
        self.n_agents = n_agents
        self.needs_agent_worktrees = needs_agent_worktrees
        self.main_dir = os.path.join(run_dir, "main")
        self.agent_dirs = [os.path.join(run_dir, f"agent-{i}") for i in range(n_agents)]
        self.queue_head_sha = base_sha
        self._d_local_commit: dict[int, tuple] = {}

    def _quiet_local_config(self, d: str) -> None:
        """These are throwaway, never-pushed simulation working trees (one
        per run, deleted on cleanup()): disable commit signing and fsync/gc
        overhead locally so a machine with `commit.gpgsign=true` in its
        global config (which forks a signing subprocess on every commit)
        doesn't make every landing attempt pay a signing cost. This never
        touches how the harness's own deliverable commits are made."""
        _run(d, ["config", "commit.gpgsign", "false"])
        _run(d, ["config", "tag.gpgsign", "false"])
        _run(d, ["config", "core.fsync", "none"])
        _run(d, ["config", "gc.auto", "0"])

    def setup(self) -> None:
        os.makedirs(self.run_dir, exist_ok=True)
        _run(self.run_dir, ["clone", "--quiet", "--no-checkout", "--shared",
                             self.bare_repo, self.main_dir])
        self._quiet_local_config(self.main_dir)
        _run(self.main_dir, ["checkout", "-B", "main", self.base_sha])
        if self.needs_agent_worktrees:
            # Worktrees share the repository config with main_dir (same .git
            # common dir), so _quiet_local_config(main_dir) above already
            # covers every worktree created below.
            for i, d in enumerate(self.agent_dirs):
                _run(self.main_dir, ["worktree", "add", "--quiet", "-B", f"agent-{i}",
                                      d, self.base_sha])

    def cleanup(self) -> None:
        shutil.rmtree(self.run_dir, ignore_errors=True)

    # ---- shared-tree substrates: U, B(p), C, CR ----------------------------

    def overwrite_files(self, task) -> None:
        """U's mechanics, and B(p)'s bypass path: last writer wins at the file
        level. Writes the commit's post-image directly, ignoring whatever the
        current tree looks like."""
        for path in task.files:
            show = _run(self.main_dir, ["show", f"{task.sha}:{path}"], check=False)
            full_path = os.path.join(self.main_dir, path)
            if show.returncode != 0:
                # file did not exist post-image -> this commit deleted it
                if os.path.exists(full_path):
                    os.remove(full_path)
                continue
            os.makedirs(os.path.dirname(full_path) or self.main_dir, exist_ok=True)
            with open(full_path, "w", encoding="utf-8", errors="surrogateescape") as f:
                f.write(show.stdout)
        _run(self.main_dir, ["add", "-A"])
        _run(self.main_dir, ["commit", "--quiet", "--allow-empty",
                              "-m", f"U-task-{task.task_id}"])

    def try_apply(self, task) -> bool:
        """C, CR, and B(p)'s non-bypassed path: real `git apply --3way`
        against the shared tree. All-or-nothing: on failure the tree is left
        exactly as it was."""
        fd, tmp = tempfile.mkstemp(prefix="task-", suffix=".patch", dir=self.run_dir)
        try:
            with os.fdopen(fd, "w", encoding="utf-8", errors="surrogateescape") as f:
                f.write(task.patch)
            res = _run(self.main_dir, ["apply", "--3way", tmp], check=False)
            if res.returncode != 0:
                _run(self.main_dir, ["reset", "--hard", "HEAD"], check=False)
                _run(self.main_dir, ["clean", "-fd"], check=False)
                return False
            _run(self.main_dir, ["add", "-A"])
            _run(self.main_dir, ["commit", "--quiet", "--allow-empty",
                                  "-m", f"task-{task.task_id}"])
            return True
        finally:
            if os.path.exists(tmp):
                os.remove(tmp)

    # Both the open and close markers, not "=======" alone: a bare run of
    # seven equals signs is a completely ordinary RST/Markdown section
    # underline and appears constantly in real prose (this was caught
    # empirically as a false positive on requests's own docs). Git's own
    # conflict blocks always open with "<<<<<<< " and close with ">>>>>>> ",
    # so requiring both is specific to an actual unresolved conflict.
    _CONFLICT_OPEN = b"<<<<<<< "
    _CONFLICT_CLOSE = b">>>>>>> "

    def files_contain_conflict_markers(self, files) -> bool:
        """Mechanical torn-tree self-check, run against the actual files a
        landing just touched: does any of them contain an unresolved git
        merge-conflict marker? A correct `git apply --3way`/`git rebase`
        landing (used by C, CR, and D) is always committed only after it
        fully succeeds with no conflicts, so this should never fire for
        them; U's and B(p)'s bypass path never invokes a merge at all, so it
        cannot produce markers either (their tearing is silent overwrite,
        tracked separately by the caller). This exists as a real,
        cheap, always-should-pass post-condition on this specific landing —
        not a speculative peek at some unrelated task — so a genuine
        regression in the apply/rebase code would be caught here."""
        for path in files:
            full = os.path.join(self.main_dir, path)
            if not os.path.isfile(full):
                continue
            try:
                with open(full, "rb") as f:
                    data = f.read()
            except OSError:
                continue
            if self._CONFLICT_OPEN in data and self._CONFLICT_CLOSE in data:
                return True
        return False

    # ---- D: worktree per agent, merge queue, real rebase -------------------

    def _d_prepare(self, agent_idx: int, task) -> bool:
        """Build the task's one local commit on its real historical parent.
        Cached per (agent, task) so a cooperative agent's retries reuse the
        same local commit instead of re-deriving it from scratch every time
        `git rebase --abort` already restores the branch to this commit."""
        cached = self._d_local_commit.get(agent_idx)
        if cached is not None and cached[0] == task.task_id:
            return True
        d = self.agent_dirs[agent_idx]
        branch = f"agent-{agent_idx}"
        _run(d, ["checkout", "-B", branch, task.parent_sha])
        fd, tmp = tempfile.mkstemp(prefix="task-", suffix=".patch", dir=self.run_dir)
        try:
            with os.fdopen(fd, "w", encoding="utf-8", errors="surrogateescape") as f:
                f.write(task.patch)
            apply_res = _run(d, ["apply", "--3way", tmp], check=False)
            if apply_res.returncode != 0:
                # the stored patch is parent_sha->sha verbatim; this should not
                # happen, but fail safe rather than raise mid-simulation.
                _run(d, ["reset", "--hard", "HEAD"], check=False)
                _run(d, ["clean", "-fd"], check=False)
                return False
            _run(d, ["add", "-A"])
            _run(d, ["commit", "--quiet", "--allow-empty", "-m", f"task-{task.task_id}"])
        finally:
            if os.path.exists(tmp):
                os.remove(tmp)
        local_sha = gitutil.rev_parse(d, branch)
        self._d_local_commit[agent_idx] = (task.task_id, local_sha)
        return True

    def d_try_land(self, agent_idx: int, task) -> bool:
        """Rebase the agent's one local commit onto the current queue head
        (real `git rebase`, apply-based for speed on a single-commit branch).
        Fast-forwards the queue head on success; leaves everything untouched
        (rebase --abort) on failure."""
        d = self.agent_dirs[agent_idx]
        branch = f"agent-{agent_idx}"
        if not self._d_prepare(agent_idx, task):
            return False

        target = self.queue_head_sha
        rebase_res = _run(d, ["rebase", "--quiet", "--apply", target], check=False)
        if rebase_res.returncode != 0:
            _run(d, ["rebase", "--abort"], check=False)
            return False
        new_sha = gitutil.rev_parse(d, branch)
        self.queue_head_sha = new_sha
        self._d_local_commit.pop(agent_idx, None)
        # Keep main_dir in sync with the queue head so the mechanical
        # torn-tree self-check (which always reads main_dir) sees D's real
        # current tree rather than the frozen base checkout.
        _run(self.main_dir, ["reset", "--hard", new_sha])
        return True
