"""Background watchdog that keeps WebUI goal loops from dying silently.

The WebUI goal loop is a single chain: turn settle -> judge verdict ->
SSE ``goal_continue`` -> the browser queues the next round. When a link
breaks — a WebUI restart clearing the in-memory continuation record, a settle
that skips evaluation, a browser that never dispatches its queued round — the
goal stays ``active`` with ``last_verdict=continue`` and nothing running: a
zombie. Nothing ever restarts it (``/goal resume`` deliberately does not kick
off), which is how users lose multi-hour goals.

This watchdog scans the ambient state.db every minute for exactly that state
and re-issues the standard continuation prompt via
``api.routes._goal_continue_kick`` (the same code path ``/goal continue``
uses), so the loop self-repairs and the settle path resumes evaluating.

Deliberately NOT auto-continued:
- goals whose status is not ``active`` — a goal paused with reason
  "turn interrupted" was stopped by the USER and stays paused until an
  explicit ``/goal continue``;
- goals with a live pending-continuation record (#7855 keeps them across
  refreshes by design; the browser still owns that round);
- sessions with a running stream;
- goals inside the 90s grace window after their last turn (a browser may be
  mid-dispatch);
- sessions that failed the kick 3 times in a row (stop burning API calls on a
  broken session; ``/goal continue`` still works manually).
"""

import json
import logging
import os
import sqlite3
import threading
import time

logger = logging.getLogger(__name__)

_CHECK_INTERVAL_SECONDS = 60
_GRACE_SECONDS = 90
_MAX_CONSECUTIVE_FAILURES = 3
# #7855 keeps a pending continuation alive with no wall-clock expiry so a browser
# refresh can still send it. That is correct for seconds, but a tab that was closed
# (or a stream whose ``goal_continue`` event nobody dispatched) leaves the record
# waiting for ever — a fourth kind of zombie. After this window with no consumer we
# retire the record and take the round over ourselves.
_PENDING_STALE_SECONDS = 180

_failures: dict = {}
_pending_since: dict = {}
_started = False
_start_lock = threading.Lock()


def _ambient_state_db():
    try:
        from api.models import _active_state_db_path

        path = _active_state_db_path()
        return str(path) if path else None
    except Exception:
        return None


def _candidate_goals():
    """[(session_id, goal_dict)] for goals that look like stalled zombies."""
    db_path = _ambient_state_db()
    if not db_path or not os.path.exists(db_path):
        return []
    out = []
    try:
        con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        try:
            rows = con.execute(
                "SELECT key, value FROM state_meta WHERE key LIKE 'goal:%'"
            ).fetchall()
        finally:
            con.close()
    except Exception:
        logger.debug("goal watchdog scan failed", exc_info=True)
        return []
    now = time.time()
    for key, value in rows:
        sid = str(key or "")[len("goal:"):]
        if not sid:
            continue
        try:
            state = json.loads(value)
        except Exception:
            continue
        if not isinstance(state, dict) or str(state.get("status", "")) != "active":
            continue
        if str(state.get("last_verdict", "")) != "continue":
            continue
        try:
            max_turns = int(state.get("max_turns") or 0)
            turns_used = int(state.get("turns_used") or 0)
            if max_turns and turns_used >= max_turns:
                continue
        except (TypeError, ValueError):
            continue
        try:
            if now - float(state.get("last_turn_at") or 0) < _GRACE_SECONDS:
                continue
        except (TypeError, ValueError):
            continue
        if not str(state.get("goal", "") or "").strip():
            continue
        out.append((sid, state))
    return out


def _has_pending_continuation(session_id: str) -> bool:
    """True when the browser still owns a queued round (fail closed)."""
    try:
        from api.config import PENDING_GOAL_CONTINUATION_PROMPTS, PENDING_GOAL_CONTINUATION_LOCK

        with PENDING_GOAL_CONTINUATION_LOCK:
            return session_id in PENDING_GOAL_CONTINUATION_PROMPTS
    except Exception:
        return True


def _tick() -> None:
    from api.config import STREAMS, STREAMS_LOCK
    from api.models import get_session
    from api.routes import _goal_continue_kick

    for sid, state in _candidate_goals():
        if _failures.get(sid, 0) >= _MAX_CONSECUTIVE_FAILURES:
            continue
        if _has_pending_continuation(sid):
            # The browser owns the queued round — but only for a while. Measured
            # from first sighting (the record carries no timestamp), so a fresh
            # refresh still wins and a closed tab cannot pin the goal for ever.
            first_seen = _pending_since.setdefault(sid, time.time())
            if time.time() - first_seen < _PENDING_STALE_SECONDS:
                continue
            try:
                from api.goals import clear_pending_goal_continuation

                clear_pending_goal_continuation(sid)
                logger.warning(
                    "goal watchdog: retired stale pending continuation for %s (age %.0fs)",
                    sid,
                    time.time() - first_seen,
                )
            except Exception:
                continue
            _pending_since.pop(sid, None)
        else:
            _pending_since.pop(sid, None)
        try:
            session = get_session(sid)
        except Exception:
            _failures[sid] = _failures.get(sid, 0) + 1
            continue
        active_stream_id = getattr(session, "active_stream_id", None)
        if active_stream_id:
            with STREAMS_LOCK:
                if active_stream_id in STREAMS:
                    continue  # a round is running; the loop is alive
        try:
            ok, payload = _goal_continue_kick(session, None, state.get("goal"))
        except Exception:
            ok, payload = False, {"error": "exception"}
        if ok:
            _failures.pop(sid, None)
            logger.info(
                "goal watchdog: revived stalled goal for %s (turns_used=%s)",
                sid,
                state.get("turns_used"),
            )
        else:
            _failures[sid] = _failures.get(sid, 0) + 1
            logger.warning(
                "goal watchdog: kickoff failed for %s (%s/%s): %s",
                sid,
                _failures[sid],
                _MAX_CONSECUTIVE_FAILURES,
                payload.get("error") if isinstance(payload, dict) else payload,
            )


def _loop() -> None:
    while True:
        time.sleep(_CHECK_INTERVAL_SECONDS)
        try:
            _tick()
        except Exception:
            logger.debug("goal watchdog tick failed", exc_info=True)


def start_goal_watchdog() -> None:
    """Start the watchdog thread once per process (idempotent)."""
    global _started
    with _start_lock:
        if _started:
            return
        _started = True
        threading.Thread(target=_loop, daemon=True, name="goal-watchdog").start()
        logger.info("goal watchdog started (interval=%ss)", _CHECK_INTERVAL_SECONDS)
