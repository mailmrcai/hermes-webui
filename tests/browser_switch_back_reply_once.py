#!/usr/bin/env python3
"""Real browser gate: switching away mid-reply and back must show the reply ONCE, below the prompt.

Flow (real client code; only /api/session and /api/chat/start are fixtured):

  loadSession(A)   history turn [user1, assistant1]
  send()           real send path, live stream via a fixture EventSource
  loadSession(B)   switch away while the reply is streaming
  loadSession(A)   switch back; the server transcript now carries this turn's
                   PARTIAL assistant row while the prompt still lives in
                   pending_user_message

Asserts, after the switch-back:

  1. the prompt row renders ABOVE this turn's reply (`message1 → message2 → reply`),
  2. the reply's text is visible exactly ONCE (no persisted-row + live-turn double
     paint),
  3. no uncaught page error.

Run: .venv/bin/python tests/browser_switch_back_reply_once.py
"""
import json
import os
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from browser_conversation_lifecycle import _start_webui_server, _terminate_process  # noqa: E402

ROOT = Path(os.environ.get('WEBUI_TEST_ROOT', Path(__file__).resolve().parent.parent))
U1 = 'USER_ONE previous question'
A1 = 'ANSWER_ONE previous reply'
U2 = 'USER_TWO the question of this turn'
A2 = 'ANSWER_TWO the reply being streamed right now'

INIT = """
if(window===window.top && 'serviceWorker' in navigator){
  navigator.serviceWorker.register=()=>Promise.reject(new Error('disabled in switch-back gate'));
}
window.fixtureSources=[];
class FixtureEventSource {
  static OPEN=1; static CONNECTING=0; static CLOSED=2;
  constructor(url){this.url=String(url);this.readyState=1;this.listeners={};window.fixtureSources.push(this);}
  addEventListener(name,fn){(this.listeners[name]||=[]).push(fn);}
  removeEventListener(){}
  close(){this.readyState=2;}
  emit(name,data,id){for(const fn of this.listeners[name]||[])fn({data:JSON.stringify(data),lastEventId:id||''});}
}
window.EventSource=FixtureEventSource;
"""

OBSERVE = """
() => {
  const inner = document.getElementById('msgInner');
  const visible = (el) => {
    if (!el) return false;
    if (el.hidden) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    return el.getBoundingClientRect().height > 0;
  };
  // Structural duplicate check (no ancestor-visibility guessing): a transcript
  // assistant row for this turn AND a visible live-turn row both carrying the text.
  const shown = (el) => {
    if (!el || el.hidden) return false;
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden';
  };
  const marker = 'ANSWER_TWO';
  const transcriptCopies = [...inner.querySelectorAll('.assistant-turn')]
    .filter(t => t.id !== 'liveAssistantTurn' && shown(t) && (t.textContent || '').includes(marker)).length;
  const liveRow = document.getElementById('liveAssistantTurn');
  const liveCopies = liveRow
    ? [...liveRow.querySelectorAll('[data-anchor-scene-row="1"],[data-live-assistant="1"],.assistant-segment')]
        .filter(el => shown(el) && (el.textContent || '').includes(marker)).length
    : 0;
  const owners = [];
  const ownerOf = (needle) => {
    const nodes = [...inner.querySelectorAll('*')];
    return nodes.find(x => (x.textContent || '').includes(needle) &&
      ![...x.children].some(c => (c.textContent || '').includes(needle)));
  };
  const u = ownerOf('USER_TWO'), a = ownerOf('ANSWER_TWO');
  const order = (u && a)
    ? ((u.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING) ? 'prompt-first' : 'reply-first')
    : 'missing';
  return {
    order,
    visibleReplyOwners: transcriptCopies + liveCopies,
    transcriptCopies, liveCopies,
    ownerRows: owners.map(el => (el.className || '').toString().slice(0, 40) + '|' + (el.id || '')),
    rows: [...inner.children].map(el => ({
      cls: (el.className || '').toString().slice(0, 44),
      id: el.id || '',
      text: (el.textContent || '').replace(/\\s+/g, ' ').slice(0, 56),
    })),
    roles: (S.messages || []).map(m => m.role + (m._live ? ':live' : '') + (m._pending ? ':pending' : '') + (m._tools ? '+tools' : '')),
    liveDetail: (() => {
      const live = document.getElementById('liveAssistantTurn');
      if (!live) return null;
      return [...live.querySelectorAll('[data-live-assistant="1"],[data-anchor-scene-row="1"],.transparent-event-row,.assistant-segment')]
        .slice(0, 12).map(el => ({
          cls: (el.className || '').toString().slice(0, 46),
          sceneRow: el.getAttribute('data-anchor-scene-row') || '',
          live: el.getAttribute('data-live-assistant') || '',
          vis: visible(el),
          text: (el.textContent || '').replace(/\s+/g, ' ').slice(0, 40),
        }));
    })(),
  };
}
"""


def run(pw, base):
    browser = pw.chromium.launch(headless=True, args=['--no-sandbox', '--disable-dev-shm-usage'])
    context = browser.new_context(viewport={'width': 1280, 'height': 900}, bypass_csp=True)
    context.add_init_script(INIT)
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))

    t0 = 1793951902.30
    t2 = t0 + 300
    hist = [{'role': 'user', 'content': U1, 'timestamp': t0},
            {'role': 'assistant', 'content': A1, 'timestamp': t0 + 20}]
    sessions = {
        'sess-A': dict(session_id='sess-A', title='A', model='', workspace=base, messages=hist,
                       message_count=2, tool_calls=[], active_stream_id=None,
                       pending_user_message=None, pending_started_at=None),
        'sess-B': dict(session_id='sess-B', title='B', model='', workspace=base,
                       messages=[{'role': 'user', 'content': 'USER_B other session', 'timestamp': t0 + 1},
                                 {'role': 'assistant', 'content': 'ANSWER_B other reply', 'timestamp': t0 + 2}],
                       message_count=2, tool_calls=[], active_stream_id=None,
                       pending_user_message=None, pending_started_at=None),
        # Switch-back payload: this turn's partial assistant row is persisted, the
        # prompt is still pending (so it is NOT in `messages`).
        'sess-A-back': dict(session_id='sess-A', title='A', model='', workspace=base,
                            messages=hist + [
                                {'role': 'assistant', 'content': A2, 'timestamp': t2 + 40},
                                {'role': 'tool', 'content': 'search results', 'tool_name': 'web_search',
                                 'timestamp': t2 + 41}],
                            message_count=4, tool_calls=[], active_stream_id='run-A',
                            pending_user_message=U2, pending_started_at=t2),
    }
    fixture = {'a': 'sess-A'}

    def serve_session(r):
        from urllib.parse import parse_qs, urlsplit
        q = parse_qs(urlsplit(r.request.url).query)
        sid = q.get('session_id', [''])[0]
        payload = sessions[fixture['a']] if sid == 'sess-A' else sessions.get(sid, sessions['sess-B'])
        r.fulfill(json={'session': payload})

    page.route('**/api/settings', lambda r: r.fulfill(json=dict(
        theme='dark', skin='default', chat_activity_display_mode='compact_worklog',
        virtualize_transcript=False, show_token_usage=False)))
    page.route('**/api/session?*', serve_session)
    page.route('**/api/chat/stream/status?*', lambda r: r.fulfill(json={'active': True}))
    page.route('**/api/chat/start', lambda r: r.fulfill(json={
        'stream_id': 'run-A', 'session_id': 'sess-A', 'pending_started_at': t2}))

    page.goto(base, wait_until='load')
    deadline = time.monotonic() + 30
    while not page.evaluate("typeof loadSession==='function' && S._bootReady === true"):
        assert time.monotonic() < deadline, ('boot timeout', errors)
        page.wait_for_timeout(50)

    page.evaluate("async sid=>{await loadSession(sid);}", 'sess-A')
    page.evaluate("t=>{document.getElementById('msg').value=t;}", U2)
    page.evaluate("()=>{send();}")
    deadline = time.monotonic() + 20
    while not page.evaluate("fixtureSources.some(s=>s.url.includes('api/chat/stream?')&&s.readyState===1)"):
        assert time.monotonic() < deadline, ('stream never attached', errors)
        page.wait_for_timeout(50)
    page.evaluate(f"""()=>{{
      const src=fixtureSources.findLast(s=>s.url.includes('api/chat/stream?')&&s.readyState===1);
      src.emit('token',{{text:'{A2} '}});
    }}""")
    page.wait_for_timeout(250)
    page.evaluate("""()=>{
      const src=fixtureSources.findLast(s=>s.url.includes('api/chat/stream?')&&s.readyState===1);
      src.emit('tool',{name:'web_search',tid:'sw-1',args:{query:'x'},preview:'x'});
      src.emit('tool_complete',{name:'web_search',tid:'sw-1',preview:'ok',duration:1});
    }""")
    page.wait_for_timeout(400)
    # The gateway/journal turn renders its prose through the anchor scene: that is
    # what the user sees while streaming (the inline segment is hidden). Supply the
    # same scene shape the run journal carries.
    page.evaluate("""answer=>{
      const scene={version:'activity_scene_v1',
        identity:{session_id:'sess-A',stream_id:'run-A',run_id:'run-A'},
        final_answer:'',
        activity_rows:[{row_id:'prose:1',role:'prose',kind:'process_prose',
          source_event_type:'settled_message',order_index:0,message_index:0,
          text:answer,payload:{text:answer}}]};
      window._renderLiveAnchorActivitySceneSnapshotForStream('run-A',scene,'sess-A');
    }""", A2)
    page.wait_for_timeout(500)

    page.evaluate("async sid=>{await loadSession(sid);}", 'sess-B')
    page.wait_for_timeout(300)
    fixture['a'] = 'sess-A-back'
    page.evaluate("async sid=>{await loadSession(sid);}", 'sess-A')
    page.wait_for_timeout(900)

    observed = page.evaluate(OBSERVE)
    browser.close()
    failures = []
    if observed['order'] != 'prompt-first':
        failures.append(f"order is {observed['order']!r}, expected 'prompt-first'")
    if observed['visibleReplyOwners'] != 1:
        failures.append(
            "reply is visible {0} times (transcript row: {1}, live turn: {2}), expected 1".format(
                observed['visibleReplyOwners'], observed['transcriptCopies'], observed['liveCopies']))
    if errors:
        failures.append(f'page errors: {errors[:3]}')
    return observed, failures


def main() -> int:
    from playwright.sync_api import sync_playwright
    with tempfile.TemporaryDirectory(prefix='webui-switch-back-') as temp:
        state = Path(temp)
        env = {k: os.environ[k] for k in ('PATH', 'TMPDIR') if k in os.environ}
        env.update(HOME=temp, HERMES_HOME=temp, HERMES_BASE_HOME=temp,
                   HERMES_WEBUI_STATE_DIR=str(state / 'webui'),
                   HERMES_CONFIG_PATH=str(state / 'config.yaml'),
                   HERMES_WEBUI_HOST='127.0.0.1', HERMES_WEBUI_SKIP_ONBOARDING='1',
                   HERMES_WEBUI_AGENT_DIR=str(state / 'no-agent'))
        proc, log, _, base = _start_webui_server(ROOT, env, state)
        try:
            with sync_playwright() as pw:
                observed, failures = run(pw, base)
        finally:
            _terminate_process(proc)
            log.close()
    print('observed:', json.dumps({k: observed[k] for k in ('order', 'visibleReplyOwners', 'transcriptCopies', 'liveCopies', 'roles')}))
    print('live detail:')
    for row in observed.get('liveDetail') or []:
        print('   ', row)
    for row in observed['rows']:
        print('  row:', row['cls'], '|', row['id'], '|', row['text'])
    if failures:
        for f in failures:
            print('FAIL:', f)
        print('SWITCH-BACK GATE: FAILED')
        return 1
    print('SWITCH-BACK GATE: PASS')
    return 0


if __name__ == '__main__':
    sys.exit(main())
