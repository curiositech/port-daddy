"""
context_pressure_estimator.py — Heuristics for sensing LLM context pressure.

Provides:
  - VelocityTracker: sliding-window token-rate estimation
  - AttentionProbe: lightweight canary queries to detect context coherence loss
  - CompactionWatcher: detect when auto-compaction happened (token count drop)
  - PressureSummary: combined signal for Port Daddy telemetry endpoint

Port Daddy integration:
  POST /context/report accepts PressureSummary.to_dict()
  The daemon fires context:pressure:{advisory|warning|critical} events.
"""

from __future__ import annotations
import math
import time
from collections import deque
from dataclasses import asdict, dataclass, field
from typing import Deque, List, Optional, Tuple


# ---------------------------------------------------------------------------
# 1. Velocity Tracker
# ---------------------------------------------------------------------------

@dataclass
class TokenSnapshot:
    timestamp: float
    tokens_used: int
    context_id: str


class VelocityTracker:
    """
    Sliding-window token velocity estimator.
    Uses exponential smoothing over the raw differential to reduce noise.
    """

    def __init__(self, window_sec: float = 300.0, alpha: float = 0.3):
        self.window_sec = window_sec
        self.alpha = alpha           # EMA smoothing factor
        self._history: Deque[TokenSnapshot] = deque()
        self._ema_velocity: float = 0.0

    def record(self, tokens_used: int, context_id: str = "default") -> None:
        now = time.time()
        snap = TokenSnapshot(timestamp=now, tokens_used=tokens_used,
                             context_id=context_id)
        self._history.append(snap)

        # Expire old snapshots
        cutoff = now - self.window_sec
        while self._history and self._history[0].timestamp < cutoff:
            self._history.popleft()

        # Update EMA
        raw_v = self._raw_velocity()
        if self._ema_velocity == 0.0:
            self._ema_velocity = raw_v
        else:
            self._ema_velocity = self.alpha * raw_v + (1 - self.alpha) * self._ema_velocity

    def _raw_velocity(self) -> float:
        if len(self._history) < 2:
            return 0.0
        t0, v0 = self._history[0].timestamp, self._history[0].tokens_used
        t1, v1 = self._history[-1].timestamp, self._history[-1].tokens_used
        dt = t1 - t0
        if dt < 1.0:
            return 0.0
        return max(0.0, (v1 - v0) / dt)

    @property
    def velocity(self) -> float:
        """Tokens per second (EMA-smoothed)."""
        return self._ema_velocity

    def time_to_threshold(self, current_tokens: int, threshold_fraction: float,
                           window_size: int) -> float:
        """Seconds until current_tokens reaches window_size * threshold_fraction."""
        target = window_size * threshold_fraction
        if current_tokens >= target:
            return 0.0
        if self.velocity <= 0:
            return float('inf')
        return (target - current_tokens) / self.velocity

    def project_tokens_at(self, current_tokens: int, future_sec: float) -> int:
        """Estimated tokens used after future_sec seconds at current velocity."""
        return current_tokens + int(self.velocity * future_sec)


# ---------------------------------------------------------------------------
# 2. Compaction Watcher
# ---------------------------------------------------------------------------

class CompactionWatcher:
    """
    Detects auto-compaction events by watching for token count drops.

    When a model auto-compacts, the visible token count drops by typically
    40-80% of the pre-compaction value. We distinguish this from a legitimate
    session restart by checking that:
      (a) the drop is large (> DROP_FRACTION of peak)
      (b) the drop happens without a new session being declared

    Post-compaction, we emit a CompactionEvent with an estimate of how many
    tokens were lost to summarization overhead.
    """

    DROP_FRACTION = 0.30  # if tokens drop by >30% of peak in one step → compaction

    def __init__(self):
        self.peak_tokens = 0
        self.compaction_count = 0
        self.last_compaction_at: Optional[float] = None
        self.tokens_lost_to_compaction = 0

    def observe(self, tokens_used: int) -> Optional[dict]:
        """
        Call with the current token count after each turn.
        Returns a compaction event dict if compaction was detected, else None.
        """
        if tokens_used > self.peak_tokens:
            self.peak_tokens = tokens_used
            return None

        drop = self.peak_tokens - tokens_used
        if drop > self.peak_tokens * self.DROP_FRACTION:
            self.compaction_count += 1
            self.last_compaction_at = time.time()
            self.tokens_lost_to_compaction += drop
            self.peak_tokens = tokens_used  # reset baseline

            return {
                "event": "context:compaction",
                "tokens_before": self.peak_tokens + drop,
                "tokens_after": tokens_used,
                "tokens_lost": drop,
                "compaction_count": self.compaction_count,
            }

        return None


# ---------------------------------------------------------------------------
# 3. Attention Probe (canary pattern)
# ---------------------------------------------------------------------------

@dataclass
class ProbeResult:
    passed: bool
    coherence_score: float   # 0.0–1.0, higher = better
    probe_type: str
    detail: str


class AttentionProbe:
    """
    Lightweight canary queries to detect context coherence degradation.

    In production, these would be injected as tool calls or system nudges.
    Here we provide the specification and scoring logic; the actual LLM call
    is handled by the caller.

    Probe types:
      'recent_recall'   — ask the model to recall something from N turns ago
      'constraint_hold' — ask if a previously stated constraint is still active
      'task_state'      — ask for a one-sentence summary of current task

    Coherence scoring: compare response to a known-good baseline using
    simple token overlap (Jaccard similarity). In production, use an
    embedding similarity.
    """

    COHERENCE_THRESHOLD = 0.60  # below this → suspect context degradation

    def score_response(
        self,
        response: str,
        expected_keywords: List[str],
        probe_type: str,
    ) -> ProbeResult:
        """
        Scores a probe response by keyword overlap.

        In production, replace keyword matching with embedding cosine similarity
        between response and a known-good golden answer.
        """
        response_lower = response.lower()
        matched = sum(1 for kw in expected_keywords if kw.lower() in response_lower)
        score = matched / max(len(expected_keywords), 1)
        passed = score >= self.COHERENCE_THRESHOLD
        return ProbeResult(
            passed=passed,
            coherence_score=score,
            probe_type=probe_type,
            detail=f"{matched}/{len(expected_keywords)} keywords matched"
        )

    def generate_probe_prompt(self, probe_type: str, **kwargs) -> str:
        """Generate a canary probe prompt to inject into the next agent turn."""
        if probe_type == 'recent_recall':
            target = kwargs.get('target', 'the main task objective')
            return (f"[PROBE] In one sentence, what is {target}? "
                    "Answer from your context, do not ask me.")
        if probe_type == 'constraint_hold':
            constraint = kwargs.get('constraint', 'the primary technical constraint')
            return (f"[PROBE] Is the following constraint still active: {constraint}? "
                    "Answer yes/no and briefly why.")
        if probe_type == 'task_state':
            return ("[PROBE] Complete this sentence: 'The current state of this task is: ...' "
                    "in under 20 words.")
        return f"[PROBE] What are you currently working on? One sentence."


# ---------------------------------------------------------------------------
# 4. Combined Pressure Summary (Port Daddy telemetry payload)
# ---------------------------------------------------------------------------

@dataclass
class PressureSummary:
    """
    The structured payload posted to POST /context/report on the Port Daddy daemon.
    The daemon uses this to emit context:pressure:* events and trigger spawning.
    """
    agent_id: str
    session_id: str
    backend: str                  # 'claude' | 'gemini' | 'groq' | 'local'
    tokens_used: int
    token_window: int
    velocity_tok_per_sec: float
    compaction_count: int
    time_to_warning_sec: float    # seconds until 85% threshold at current velocity
    time_to_critical_sec: float   # seconds until 95% threshold
    coherence_score: float        # 0.0–1.0 from AttentionProbe (1.0 if no probe run)
    pressure_level: str           # 'ok' | 'advisory' | 'warning' | 'critical'
    recommended_action: str       # 'continue' | 'compact' | 'spawn' | 'dump'
    timestamp: float = field(default_factory=time.time)

    @property
    def pressure_fraction(self) -> float:
        return self.tokens_used / max(self.token_window, 1)

    def to_dict(self) -> dict:
        return asdict(self)

    @staticmethod
    def compute(
        agent_id: str,
        session_id: str,
        backend: str,
        tokens_used: int,
        token_window: int,
        velocity_tracker: VelocityTracker,
        compaction_watcher: CompactionWatcher,
        coherence_score: float = 1.0,
    ) -> 'PressureSummary':
        fraction = tokens_used / max(token_window, 1)
        v = velocity_tracker.velocity

        ttw = velocity_tracker.time_to_threshold(tokens_used, 0.85, token_window)
        ttc = velocity_tracker.time_to_threshold(tokens_used, 0.95, token_window)

        if fraction >= 0.95:
            level = 'critical'
            action = 'spawn' if ttc <= 60 else 'compact'
        elif fraction >= 0.85:
            level = 'warning'
            action = 'dump' if ttw <= 120 else 'compact'
        elif fraction >= 0.70:
            level = 'advisory'
            action = 'continue'
        else:
            level = 'ok'
            action = 'continue'

        if coherence_score < 0.60:
            level = max(level, 'warning', key=['ok','advisory','warning','critical'].index)
            action = 'spawn'

        return PressureSummary(
            agent_id=agent_id,
            session_id=session_id,
            backend=backend,
            tokens_used=tokens_used,
            token_window=token_window,
            velocity_tok_per_sec=v,
            compaction_count=compaction_watcher.compaction_count,
            time_to_warning_sec=ttw,
            time_to_critical_sec=ttc,
            coherence_score=coherence_score,
            pressure_level=level,
            recommended_action=action,
        )


# ---------------------------------------------------------------------------
# Demo
# ---------------------------------------------------------------------------

if __name__ == '__main__':
    vt = VelocityTracker(window_sec=60.0)
    cw = CompactionWatcher()

    samples = [10000, 25000, 45000, 70000, 95000, 40000, 60000, 85000]
    for i, tok in enumerate(samples):
        vt.record(tok)
        evt = cw.observe(tok)
        summary = PressureSummary.compute(
            agent_id="demo-agent-1",
            session_id="sess-001",
            backend="claude",
            tokens_used=tok,
            token_window=100_000,
            velocity_tracker=vt,
            compaction_watcher=cw,
        )
        compacted = " ← COMPACTION DETECTED" if evt else ""
        print(f"  Step {i+1}: {tok:>6,} tok | {summary.pressure_level:8s} | "
              f"v={vt.velocity:.0f} tok/s | action={summary.recommended_action}{compacted}")
