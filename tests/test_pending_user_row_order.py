"""Regression gate: the active turn's user row must never be appended AFTER its own reply.

Context
-------
A mid-stream session reload (sidebar refresh, tab switch back, idle reconcile)
re-merges the persisted transcript with the in-flight tail. When the server has
already eager-checkpointed this turn's assistant/tool rows, the strict tail scan
in ``_currentTailUserMessage`` stops at that settled assistant row, so
``_hasCurrentTailUserDuplicate`` reports "no current user row" and
``_mergePendingSessionMessage`` pushed the materialized pending row to the END of
the transcript. The browser then paints: assistant reply → user bubble → live
turn, i.e. the user's own message below the answer it belongs to, with the same
opening paragraph visible twice.

The merge now distinguishes two states that differ only in row position:

* the active turn's user row is already there  → do not add a second copy;
* the trailing assistant/tool rows are a PREVIOUS turn's (older than
  ``pending_started_at``) → append, so a repeated prompt ("继续" twice) still
  renders as its own turn.

These tests run the REAL functions extracted from ``static/sessions.js`` under
node, with ``getPendingSessionMessage`` stubbed to its identity-failed shape
(a materialized pending row), which is the condition that used to reorder.
"""
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SESSIONS_JS = ROOT / "static" / "sessions.js"
NODE = shutil.which("node")

T0 = 1793951902.3043032

JS_PRELUDE = r"""
const _PENDING_ACTIVE_TURN_TS_EPSILON = 1e-6;
function _messageTimestampSeconds(msg){
  const raw = msg && (msg._ts !== null && msg._ts !== undefined ? msg._ts : msg.timestamp);
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}
let __pendingUserMessage = null;
function getPendingSessionMessage(){ return __pendingUserMessage; }
"""

JS_CASES = r"""
const results = [];
function run(name, session, messages, pending){
  __pendingUserMessage = pending;
  const returned = _mergePendingSessionMessage(session, messages);
  results.push({
    name,
    returned,
    roles: messages.map(m => m.role),
    contents: messages.map(m => String(m.content || '').slice(0, 12)),
  });
}
const T0 = %(t0)r;
const QUERY = 'QUERY_TEXT';

// 1. Drifted pending_started_at, this turn's assistant row already persisted.
run('active-turn-output-present-drift',
    {pending_started_at: T0 + 0.7},
    [{role:'user', content:QUERY, timestamp:T0},
     {role:'assistant', content:'ANSWER', timestamp:T0 + 60}],
    {role:'user', content:QUERY, _pending:true});

// 2. Same state, several persisted tool/assistant rows (multi-step turn).
run('active-turn-output-present-multi-row',
    {pending_started_at: T0 + 0.7},
    [{role:'user', content:QUERY, timestamp:T0},
     {role:'assistant', content:'INTRO', timestamp:T0 + 30},
     {role:'tool', content:'tool out', tool_name:'web_search', timestamp:T0 + 31},
     {role:'assistant', content:'MORE', timestamp:T0 + 40}],
    {role:'user', content:QUERY, _pending:true});

// 3. A genuinely NEW turn that repeats the previous prompt verbatim: the trailing
//    answer predates pending_started_at, so it must stay after it (two user rows).
run('repeat-prompt-new-turn',
    {pending_started_at: T0},
    [{role:'user', content:QUERY, timestamp:T0 - 120},
     {role:'assistant', content:'PREVIOUS', timestamp:T0 - 90}],
    {role:'user', content:QUERY, _pending:true});

// 4. Brand-new session: nothing to anchor to, still appended.
run('empty-transcript',
    {pending_started_at: T0},
    [],
    {role:'user', content:QUERY, _pending:true});

// 5. Untimestamped trailing rows cannot be proven to belong to the active turn,
//    so they are treated as a previous turn (conservative append).
run('untimestamped-trailing-answer',
    {pending_started_at: T0},
    [{role:'user', content:'OLD', timestamp:T0 - 200},
     {role:'assistant', content:'UNKNOWN AGE'}],
    {role:'user', content:QUERY, _pending:true});

// 6. Active-turn output present but the last user row carries different text:
//    the pending row is inserted AHEAD of that output, never after it.
run('active-turn-output-present-other-row',
    {pending_started_at: T0},
    [{role:'user', content:'EARLIER', timestamp:T0 - 300},
     {role:'assistant', content:'ANSWER', timestamp:T0 + 5}],
    {role:'user', content:QUERY, _pending:true});

// 7. THE reported shape: switch away mid-reply, switch back. The server keeps the
//    current prompt in pending_user_message (so it is NOT in the transcript) while
//    this turn's partial assistant row IS. A previous turn's answer sits in
//    between, which the old "rows after the last user row" rule could not see
//    through — the prompt was appended last and rendered BELOW its own reply.
run('switch-back-current-turn-output-without-user-row',
    {pending_started_at: T0},
    [{role:'user', content:'PREV_PROMPT', timestamp:T0 - 300},
     {role:'assistant', content:'PREV_ANSWER', timestamp:T0 - 280},
     {role:'assistant', content:'CURRENT_PARTIAL', timestamp:T0 + 5}],
    {role:'user', content:QUERY, _pending:true});

// 8. Same shape, several persisted rows for the current turn (tool steps).
run('switch-back-current-turn-tool-rows-without-user-row',
    {pending_started_at: T0},
    [{role:'user', content:'PREV_PROMPT', timestamp:T0 - 300},
     {role:'assistant', content:'PREV_ANSWER', timestamp:T0 - 280},
     {role:'assistant', content:'INTRO', timestamp:T0 + 5},
     {role:'tool', content:'tool out', tool_name:'web_search', timestamp:T0 + 6}],
    {role:'user', content:QUERY, _pending:true});

console.log(JSON.stringify(results));
"""


def _extract_function(source: str, name: str) -> str:
    start = source.find(f"function {name}(")
    assert start != -1, f"could not find function {name} in static/sessions.js"
    brace = source.find("{", start)
    depth = 0
    for idx in range(brace, len(source)):
        ch = source[idx]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return source[start:idx + 1]
    pytest.fail(f"unbalanced braces while extracting {name}")


def _run_node(script: str) -> list:
    if NODE is None:
        pytest.skip("node is not on PATH")
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False, encoding="utf-8") as handle:
        handle.write(script)
        path = handle.name
    try:
        proc = subprocess.run([NODE, path], capture_output=True, text=True, timeout=60)
    finally:
        Path(path).unlink(missing_ok=True)
    assert proc.returncode == 0, proc.stderr
    return json.loads(proc.stdout.strip().splitlines()[-1])


@pytest.fixture(scope="module")
def results():
    source = SESSIONS_JS.read_text(encoding="utf-8")
    parts = [JS_PRELUDE]
    for name in (
        "_messageComparableText",
        "_stripAttachedFilesMarker",
        "_stripForcedSkillEnvelope",
        "_normalizeUserTranscriptText",
        "_sameTranscriptMessage",
        "_currentTailUserMessage",
        "_hasCurrentTailUserDuplicate",
        "_mergePendingSessionMessage",
    ):
        parts.append(_extract_function(source, name))
    parts.append(JS_CASES % {"t0": T0})
    out = _run_node("\n".join(parts))
    return {row["name"]: row for row in out}


def test_active_turn_row_is_not_duplicated_below_its_reply(results):
    row = results["active-turn-output-present-drift"]
    assert row["roles"] == ["user", "assistant"], row
    assert row["returned"] is False, row


def test_multi_row_turn_keeps_a_single_user_row(results):
    row = results["active-turn-output-present-multi-row"]
    assert row["roles"] == ["user", "assistant", "tool", "assistant"], row


def test_repeated_prompt_still_appends_a_new_turn(results):
    row = results["repeat-prompt-new-turn"]
    assert row["roles"] == ["user", "assistant", "user"], row
    assert row["returned"] is True, row


def test_empty_transcript_still_appends(results):
    row = results["empty-transcript"]
    assert row["roles"] == ["user"], row


def test_untimestamped_previous_answer_is_not_swallowed(results):
    row = results["untimestamped-trailing-answer"]
    assert row["roles"] == ["user", "assistant", "user"], row


def test_pending_row_is_never_placed_after_active_turn_output(results):
    row = results["active-turn-output-present-other-row"]
    assert row["roles"] == ["user", "user", "assistant"], row
    assert row["contents"][1].startswith("QUERY"), row


def test_switch_back_puts_the_prompt_above_its_own_reply(results):
    """The reported flow: switch away mid-reply, switch back."""
    row = results["switch-back-current-turn-output-without-user-row"]
    assert row["roles"] == ["user", "assistant", "user", "assistant"], row
    assert row["contents"] == ["PREV_PROMPT", "PREV_ANSWER", "QUERY_TEXT", "CURRENT_PART"], row


def test_switch_back_with_tool_rows_keeps_the_prompt_above_every_row(results):
    row = results["switch-back-current-turn-tool-rows-without-user-row"]
    assert row["roles"] == ["user", "assistant", "user", "assistant", "tool"], row
    assert row["contents"][2].startswith("QUERY"), row


def test_live_turn_suppression_hook_stays_wired():
    """The render-layer收口: the live turn hides its transcript duplicate only when it
    already shows that text (never blank the answer, #5390)."""
    ui = (ROOT / "static" / "ui.js").read_text(encoding="utf-8")
    sessions = SESSIONS_JS.read_text(encoding="utf-8")
    assert "function _suppressTranscriptRowsOwnedByLiveTurn(sid)" in ui
    assert "_suppressTranscriptRowsOwnedByLiveTurn(sid);" in ui, "renderMessages must call the hook"
    assert "_suppressTranscriptRowsOwnedByLiveTurn(sid);" in sessions, "loadSession must call the hook"
    assert "liveText.length<12" in ui, "hook must require real live text before hiding"
    assert "data-suppressed-by-live-turn" in ui
