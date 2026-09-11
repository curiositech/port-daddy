"""Discrete-event simulation over simulated seconds, seeded RNG.

One call to `run_cell` is one (corpus, substrate, N, temperament, seed) cell:
it replays the corpus's fixed task sequence through N scripted agents under
one substrate's rules, using real git operations for every landing attempt.
"""
from __future__ import annotations

import heapq
import itertools
import random
from collections import deque
from dataclasses import dataclass

from . import agents as A
from .substrates import GitWorkspace, FileClaimTable, RangeClaimTable, claim_ranges_for_task

# Substrate codes. PROTOCOL.md S2.4 says "substrate (6 levels)" but S2.2's
# table defines U, B(p) for p in {0, 0.05, 0.2}, C, D, CR = 7 distinct
# substrate/p combinations. This is a real arithmetic inconsistency in the
# pre-registered text (logged in CHANGELOG.md); the minimal deviation is to
# keep every substrate/p combination S2.2 names rather than silently drop one.
SUBSTRATES = ("U", "B0", "B005", "B02", "C", "D", "CR")

_BYPASS_P = {"B0": 0.0, "B005": 0.05, "B02": 0.2}


def is_bypass_substrate(substrate: str) -> bool:
    return substrate in _BYPASS_P


@dataclass
class InFlight:
    task_id: int
    started_at: float
    work_done_at: float | None = None
    bypass: bool | None = None       # decided at start, for B(p)
    d_retries: int = 0


@dataclass
class CellResult:
    n_tasks: int
    landed: list          # list of (task_id, land_time)
    abandoned: set
    wasted_lines: int
    refusal_count: int
    merge_conflict_count: int
    torn_count: int
    landed_with_record: set
    time_to_land: dict    # task_id -> seconds from work-complete to land
    final_time: float
    events: list           # per-task event log rows (dict)


def run_cell(base_dir: str, tasks: list, substrate: str, n_agents: int,
             temperament: str, seed: int, run_dir: str, bare_repo: str) -> CellResult:
    if substrate not in SUBSTRATES:
        raise ValueError(f"unknown substrate {substrate!r}")
    n_tasks = len(tasks)
    rng = random.Random(seed)

    needs_worktrees = substrate == "D"
    base_sha = tasks[0].parent_sha
    ws = GitWorkspace(run_dir, bare_repo, base_sha, n_agents, needs_worktrees)
    ws.setup()
    try:
        file_claims = FileClaimTable() if substrate in ("C",) or is_bypass_substrate(substrate) else None
        range_claims = RangeClaimTable() if substrate == "CR" else None

        pending = deque(range(n_tasks))
        in_flight: dict[int, InFlight] = {}
        landed: list = []
        landed_set: set = set()
        abandoned: set = set()
        landed_with_record: set = set()
        refusal_count = 0
        merge_conflict_count = 0
        torn_count = 0
        time_to_land: dict[int, float] = {}
        events: list = []

        counter = itertools.count()
        heap: list = []

        def schedule(t, kind, agent_id):
            heapq.heappush(heap, (t, next(counter), kind, agent_id))

        def log(t, event, agent_id, task_id, note=""):
            events.append({
                "time": round(t, 3), "event": event, "agent_id": agent_id,
                "task_id": task_id, "note": note,
            })

        # Per-task (not per-agent-lifetime) retry counters for the
        # cooperative-retry safety valve: only one agent ever works a given
        # task_id at a time, so keying by task_id is race-free.
        retry_counts: dict[int, int] = {}

        def mechanical_torn_check(t, agent_id, task) -> None:
            """PROTOCOL.md S2.2's mechanical torn-tree self-check, run after
            every landing. Tearing means the tree silently lost content: a
            file a landed task wrote got overwritten without any
            coordination noticing. That is exactly what U's and B(p)'s
            bypass path can do (checked in _overwrite_and_land, which
            tracks it directly against the actual write history). C, CR,
            and D never take that code path at all: every one of their
            landings is an all-or-nothing `git apply --3way` or `git
            rebase` that either integrates cleanly or is refused/aborted
            with the tree left exactly as it was — so nothing they land can
            ever contain an unresolved merge. That is verified here, for
            real, on the actual files this landing just touched (not a
            speculative peek at some other task), so a real regression in
            substrates.py would be caught rather than asserted away."""
            nonlocal torn_count
            if ws.files_contain_conflict_markers(task.files):
                torn_count += 1
                log(t, "torn", agent_id, task.task_id,
                    "unresolved conflict markers survived a landing")

        def start_task(t, agent_id, task_id):
            task = tasks[task_id]
            fl = InFlight(task_id=task_id, started_at=t)

            if substrate == "U":
                fl.bypass = True
                in_flight[agent_id] = fl
                dur = A.work_duration(task.lines_changed, rng)
                fl.work_done_at = t + dur
                log(t, "start", agent_id, task_id)
                schedule(fl.work_done_at, "work_done", agent_id)
                return

            if is_bypass_substrate(substrate):
                bypass = A.rolls_bypass(rng, _BYPASS_P[substrate])
                fl.bypass = bypass
                if bypass:
                    in_flight[agent_id] = fl
                    dur = A.work_duration(task.lines_changed, rng)
                    fl.work_done_at = t + dur
                    log(t, "start-bypass", agent_id, task_id)
                    schedule(fl.work_done_at, "work_done", agent_id)
                    return
                # falls through to claim-gated path below

            if substrate in ("C",) or (is_bypass_substrate(substrate) and fl.bypass is False):
                claim_files = task.files
                if file_claims.try_claim(agent_id, task_id, claim_files):
                    in_flight[agent_id] = fl
                    dur = A.work_duration(task.lines_changed, rng)
                    fl.work_done_at = t + dur
                    log(t, "start", agent_id, task_id)
                    schedule(fl.work_done_at, "work_done", agent_id)
                else:
                    handle_refusal(t, agent_id, task_id, at_start=True)
                return

            if substrate == "CR":
                cr = claim_ranges_for_task(task)
                if range_claims.try_claim(agent_id, task_id, cr):
                    in_flight[agent_id] = fl
                    dur = A.work_duration(task.lines_changed, rng)
                    fl.work_done_at = t + dur
                    log(t, "start", agent_id, task_id)
                    schedule(fl.work_done_at, "work_done", agent_id)
                else:
                    handle_refusal(t, agent_id, task_id, at_start=True)
                return

            if substrate == "D":
                in_flight[agent_id] = fl
                dur = A.work_duration(task.lines_changed, rng)
                fl.work_done_at = t + dur
                log(t, "start", agent_id, task_id)
                schedule(fl.work_done_at, "work_done", agent_id)
                return

            raise AssertionError("unreachable")

        def release_claims(agent_id, task_id):
            task = tasks[task_id]
            if file_claims is not None:
                file_claims.release(agent_id, task_id, task.files)
            if range_claims is not None:
                range_claims.release(agent_id, task_id, claim_ranges_for_task(task))

        def handle_refusal(t, agent_id, task_id, at_start: bool):
            nonlocal refusal_count
            refusal_count += 1
            log(t, "refuse", agent_id, task_id)
            if temperament == A.IMPATIENT:
                abandon(t, agent_id, task_id)
            else:
                retry_counts[task_id] = retry_counts.get(task_id, 0) + 1
                if retry_counts[task_id] > A.COOPERATIVE_RETRY_CAP:
                    abandon(t, agent_id, task_id)
                else:
                    schedule(t + A.CLAIM_RETRY_BACKOFF, "retry_start", agent_id)
                    _pending_retry[agent_id] = task_id

        def abandon(t, agent_id, task_id):
            abandoned.add(task_id)
            wasted_lines_add(tasks[task_id].lines_changed)
            log(t, "abandon", agent_id, task_id)
            in_flight.pop(agent_id, None)
            retry_counts.pop(task_id, None)
            schedule(t, "dequeue", agent_id)

        _wasted_total = [0]

        def wasted_lines_add(n):
            _wasted_total[0] += n

        _pending_retry: dict[int, int] = {}

        def try_dequeue(t, agent_id):
            if pending:
                task_id = pending.popleft()
                start_task(t, agent_id, task_id)
            # else: nothing left; agent stays idle, simulation ends when queue
            # is empty and nothing is in flight (checked by the driver loop).

        def on_work_done(t, agent_id):
            fl = in_flight.get(agent_id)
            if fl is None:
                return
            task = tasks[fl.task_id]

            if substrate == "U" or (fl.bypass is True):
                _overwrite_and_land(t, agent_id, fl, task)
                return

            if substrate in ("C", "CR") or (is_bypass_substrate(substrate) and fl.bypass is False):
                ok = ws.try_apply(task)
                if ok:
                    release_claims(agent_id, fl.task_id)
                    land(t, agent_id, fl, task, had_record=True)
                else:
                    nonlocal_refusal_at_land(t, agent_id, fl, task)
                return

            if substrate == "D":
                ok = ws.d_try_land(agent_id, task)
                if ok:
                    land(t, agent_id, fl, task, had_record=True)
                else:
                    d_conflict(t, agent_id, fl, task)
                return

        def nonlocal_refusal_at_land(t, agent_id, fl, task):
            nonlocal refusal_count
            refusal_count += 1
            release_claims(agent_id, fl.task_id)
            log(t, "conflict-at-land", agent_id, fl.task_id)
            if temperament == A.IMPATIENT:
                in_flight.pop(agent_id, None)
                abandon(t, agent_id, fl.task_id)
            else:
                task_id = fl.task_id
                retry_counts[task_id] = retry_counts.get(task_id, 0) + 1
                if retry_counts[task_id] > A.COOPERATIVE_RETRY_CAP:
                    in_flight.pop(agent_id, None)
                    abandon(t, agent_id, task_id)
                else:
                    schedule(t + A.CLAIM_RETRY_BACKOFF, "retry_start", agent_id)
                    _pending_retry[agent_id] = task_id
                    in_flight.pop(agent_id, None)

        def d_conflict(t, agent_id, fl, task):
            nonlocal merge_conflict_count
            merge_conflict_count += 1
            log(t, "merge-conflict", agent_id, fl.task_id)
            if temperament == A.IMPATIENT:
                in_flight.pop(agent_id, None)
                abandon(t, agent_id, fl.task_id)
                return
            fl.d_retries += 1
            if fl.d_retries > A.D_MAX_RETRIES:
                in_flight.pop(agent_id, None)
                abandon(t, agent_id, fl.task_id)
            else:
                schedule(t + A.D_RETRY_BACKOFF, "d_retry_land", agent_id)

        _last_writer: dict[str, int] = {}
        _already_torn_waste: set = set()

        def _overwrite_and_land(t, agent_id, fl, task):
            nonlocal torn_count
            ws.overwrite_files(task)
            for f in task.files:
                prev = _last_writer.get(f)
                if (prev is not None and prev != task.task_id and
                        prev in landed_set and prev not in _already_torn_waste):
                    _already_torn_waste.add(prev)
                    wasted_lines_add(tasks[prev].lines_changed)
                    torn_count += 1
                    log(t, "torn", agent_id, prev,
                        f"task {task.task_id}'s last-writer-wins overwrite of "
                        f"{f} silently discarded task {prev}'s landed edit")
                _last_writer[f] = task.task_id
            land(t, agent_id, fl, task, had_record=False)

        def land(t, agent_id, fl, task, had_record: bool):
            landed.append((task.task_id, t))
            landed_set.add(task.task_id)
            if had_record:
                landed_with_record.add(task.task_id)
            time_to_land[task.task_id] = t - fl.work_done_at
            retry_counts.pop(task.task_id, None)
            log(t, "land", agent_id, task.task_id)
            in_flight.pop(agent_id, None)
            mechanical_torn_check(t, agent_id, task)
            schedule(t, "dequeue", agent_id)

        # ---- initial dispatch ----
        for i in range(n_agents):
            schedule(0.0, "dequeue", i)

        # ---- event loop ----
        while heap:
            t, _, kind, agent_id = heapq.heappop(heap)
            if kind == "dequeue":
                try_dequeue(t, agent_id)
            elif kind == "work_done":
                on_work_done(t, agent_id)
            elif kind == "retry_start":
                task_id = _pending_retry.pop(agent_id, None)
                if task_id is not None and task_id not in landed_set and task_id not in abandoned:
                    start_task(t, agent_id, task_id)
            elif kind == "d_retry_land":
                fl = in_flight.get(agent_id)
                if fl is not None:
                    task = tasks[fl.task_id]
                    ok = ws.d_try_land(agent_id, task)
                    if ok:
                        land(t, agent_id, fl, task, had_record=True)
                    else:
                        d_conflict(t, agent_id, fl, task)

        # Every path that leaves an agent idle while `pending` is non-empty
        # schedules a fresh event for it before returning: try_dequeue always
        # either starts work (schedules work_done) or refuses into
        # handle_refusal, which itself always schedules retry_start or
        # abandon()'s immediate re-dequeue. So the heap cannot run dry while
        # tasks are still waiting; assert that invariant rather than silently
        # patching around a violation of it.
        assert not pending, (
            f"{len(pending)} task(s) still queued after the event heap drained "
            f"— a code path left an agent idle without rescheduling it"
        )

        final_time = max((e["time"] for e in events), default=0.0)
        return CellResult(
            n_tasks=n_tasks, landed=landed, abandoned=abandoned,
            wasted_lines=_wasted_total[0], refusal_count=refusal_count,
            merge_conflict_count=merge_conflict_count, torn_count=torn_count,
            landed_with_record=landed_with_record, time_to_land=time_to_land,
            final_time=final_time, events=events,
        )
    finally:
        ws.cleanup()
