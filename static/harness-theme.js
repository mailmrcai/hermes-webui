/* ─────────────────────────────────────────────────────────────────────────────
   Harness theme — conversation column resize.

   Adds the two drag strips the Harness puts either side of the reading column:
   dragging one widens/narrows the column symmetrically (the column stays
   centred, so the edge tracks the pointer), the width persists in
   localStorage, and a double-click resets it to the default.

   The visual affordance is styled in harness-theme.css (.hns-width-handle);
   this file only creates the elements and handles the drag. It touches no app
   state beyond one CSS custom property on <html>: delete this <script> tag
   (and the CSS block) to get the fixed-width column back.

   Drag idiom copied from boot.js initResize(): pointer capture with a
   document-level fallback, a single active pointer, and body.resizing so the
   cursor stays col-resize and text cannot be selected mid-drag.
   ───────────────────────────────────────────────────────────────────────── */
(function () {
  "use strict";

  var DEFAULT_W = 845;   // px — the Harness reading-column width
  var MIN_W = 560;       // px — below this, prose lines get too short to scan
  var MAX_W = 1600;      // px — hard cap; also clamped to the live column
  var KEY = "hermes-harness-chat-width";

  var root = document.documentElement;

  function stored() {
    var raw = NaN;
    try { raw = parseInt(localStorage.getItem(KEY), 10); } catch (_) {}
    return Number.isFinite(raw) ? clamp(raw, MIN_W, hardMax()) : DEFAULT_W;
  }

  function currentWidth() {
    var raw = parseInt(getComputedStyle(root).getPropertyValue("--hns-chat-width"), 10);
    return Number.isFinite(raw) ? raw : DEFAULT_W;
  }

  function hardMax() {
    var main = document.getElementById("mainChat");
    var avail = main ? main.getBoundingClientRect().width : window.innerWidth;
    // Leave the two 18px gutters plus a little breathing room for the handles.
    return Math.max(MIN_W, Math.min(MAX_W, Math.round(avail - 120)));
  }

  function clamp(value, lo, hi) {
    return Math.min(hi, Math.max(lo, value));
  }

  function setWidth(px, persist) {
    var w = Math.round(clamp(px, MIN_W, hardMax()));
    root.style.setProperty("--hns-chat-width", w + "px");
    if (persist) {
      try { localStorage.setItem(KEY, String(w)); } catch (_) {}
    }
    return w;
  }

  function mountHandle(host, side) {
    var handle = document.createElement("div");
    handle.className = "hns-width-handle";
    handle.dataset.side = side;
    handle.setAttribute("role", "separator");
    handle.setAttribute("aria-orientation", "vertical");
    handle.setAttribute("aria-label", "Resize conversation column");
    handle.title = "Drag to resize · double-click to reset";
    host.appendChild(handle);

    var startX = 0;
    var startW = 0;
    var activePointer = null;
    var fallbackDoc = false;

    function markPointerY(ev) {
      var top = handle.getBoundingClientRect().top;
      handle.style.setProperty("--hns-pointer-y", (ev.clientY - top) + "px");
    }

    function endResize() {
      if (activePointer === null) return;
      try { handle.releasePointerCapture(activePointer); } catch (_) {}
      activePointer = null;
      if (fallbackDoc) {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        document.removeEventListener("pointercancel", onCancel);
        fallbackDoc = false;
      }
      handle.removeAttribute("data-dragging");
      document.body.classList.remove("resizing");
    }

    function onMove(ev) {
      if (activePointer === null || ev.pointerId !== activePointer) return;
      ev.preventDefault();
      markPointerY(ev);
      // Symmetric growth: one edge moving out by d widens the centred column
      // by 2d, so the strip under the cursor stays under the cursor.
      var delta = side === "left" ? startX - ev.clientX : ev.clientX - startX;
      setWidth(startW + delta * 2, false);
    }

    function onUp(ev) {
      if (activePointer === null) return;
      if (ev.pointerId !== undefined && ev.pointerId !== activePointer) return;
      endResize();
      try { localStorage.setItem(KEY, String(currentWidth())); } catch (_) {}
    }

    function onCancel(ev) {
      if (activePointer === null) return;
      if (ev.pointerId !== undefined && ev.pointerId !== activePointer) return;
      endResize();
    }

    handle.addEventListener("pointermove", function (ev) {
      if (activePointer === null) markPointerY(ev);
    });

    handle.addEventListener("pointerdown", function (ev) {
      if (ev.pointerType === "touch") return;      // phones use the full column
      if (activePointer !== null) return;          // ignore a second pointer
      ev.preventDefault();
      activePointer = ev.pointerId;
      startX = ev.clientX;
      startW = currentWidth();
      markPointerY(ev);
      handle.setAttribute("data-dragging", "");
      document.body.classList.add("resizing");
      var captured = false;
      try { handle.setPointerCapture(ev.pointerId); captured = true; } catch (_) {}
      if (!captured) {
        fallbackDoc = true;
        document.addEventListener("pointermove", onMove);
        document.addEventListener("pointerup", onUp);
        document.addEventListener("pointercancel", onCancel);
      }
    });

    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onCancel);
    handle.addEventListener("lostpointercapture", onCancel);
    handle.addEventListener("dblclick", function (ev) {
      ev.preventDefault();
      setWidth(DEFAULT_W, true);
    });
    window.addEventListener("blur", endResize);
  }

  function mount() {
    var host = document.getElementById("mainChat");
    if (!host || host.querySelector(".hns-width-handle")) return;
    setWidth(stored(), false);
    mountHandle(host, "left");
    mountHandle(host, "right");
  }

  // Keep a stored width honest when the window shrinks below it.
  var resizeTimer = 0;
  window.addEventListener("resize", function () {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      if (currentWidth() > hardMax()) setWidth(hardMax(), false);
    }, 150);
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();

/* The Chat panel head now renders a single wide "New chat" button; give it the
   text label the icon-only button never had (i18n first, literal fallback). */
(function () {
  function label() {
    try {
      if (typeof window.t === "function") {
        var v = window.t("new_conversation");
        if (v && v !== "new_conversation") return v;
      }
    } catch (_e) { /* fall through */ }
    return "新建对话";
  }
  function decorate() {
    var btn = document.getElementById("btnNewChat");
    if (!btn || btn.querySelector(".hns-newchat-label")) return;
    var span = document.createElement("span");
    span.className = "hns-newchat-label";
    span.textContent = label();
    btn.appendChild(span);
  }
  function boot() {
    decorate();
    // i18n switches languages live; re-render the label when it does.
    document.addEventListener("hermes:language-changed", decorate);
    var retry = 0;
    var timer = setInterval(function () {
      decorate();
      if (++retry > 20 || (document.getElementById("btnNewChat") || {}).querySelector) clearInterval(timer);
    }, 400);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();

/* Workspace header controller — the Harness's project row affordances:
   a folder icon, a hover bubble that shows the absolute path and copies it when
   clicked, a display-only rename (the real path never changes), a per-workspace
   "+" and a highlight on whichever workspace owns the selected session. All of
   this lives in the skin: labels go to localStorage, nothing is written to
   session data. */
(function () {
  var PLUS =
    '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" ' +
    'stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><path d="M8 3.4v9.2"/>' +
    '<path d="M3.4 8h9.2"/></svg>';
  var LABEL_KEY = "hermes-harness-ws-labels";
  var COPY_LABEL = "复制";

  function labels() {
    try { return JSON.parse(localStorage.getItem(LABEL_KEY)) || {}; } catch (_) { return {}; }
  }
  function setLabel(path, name) {
    var m = labels();
    if (name && name !== path) m[path] = name; else delete m[path];
    try { localStorage.setItem(LABEL_KEY, JSON.stringify(m)); } catch (_) {}
  }
  function pathOf(hdr) {
    var cached = hdr.getAttribute("data-hns-path");
    if (cached !== null) return cached;
    var raw = hdr.getAttribute("title") || "";
    hdr.setAttribute("data-hns-path", raw);
    return raw;
  }
  function baseOf(path) {
    var p = String(path).replace(/\/+$/, "");
    var i = p.lastIndexOf("/");
    return i >= 0 ? p.slice(i + 1) : p;
  }
  function toast(msg) {
    if (typeof window.showToast === "function") window.showToast(msg, 2600);
  }

  /* Session timestamps are not on the rows (they show a relative "3h"), so the
     bubble joins `data-sid` against the sidebar payload it fetches itself. Bounded
     TTL + single in-flight request: hovering must not turn into a polling loop. */
  var STATS = null, statsAt = 0, statsBusy = false;
  function loadStats(whenReady) {
    if (statsBusy) return;
    if (statsAt && Date.now() - statsAt < 60000) { if (whenReady) whenReady(); return; }
    statsBusy = true;
    fetch("/api/sessions?exclude_hidden=1", { credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        var map = {};
        var arr = (d && d.sessions) || [];
        for (var i = 0; i < arr.length; i++) {
          var it = arr[i] || {};
          var id = String(it.session_id || "");
          if (!id) continue;
          map[id] = { created: toSeconds(it.created_at), updated: toSeconds(it.updated_at) };
        }
        STATS = map;
        statsAt = Date.now();
        if (whenReady) whenReady();
      })
      .catch(function () { /* the bubble still works, just without times */ })
      .then(function () { statsBusy = false; });
  }
  function toSeconds(v) {
    if (typeof v === "number") return v;
    if (typeof v === "string" && v) {
      var n = Number(v);
      if (!isNaN(n)) return n;
      var t = Date.parse(v);
      if (!isNaN(t)) return t / 1000;
    }
    return 0;
  }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function fmtTime(sec) {
    if (!sec) return "—";
    var d = new Date(sec * 1000);
    if (isNaN(d.getTime())) return "—";
    // the user's wording: 2026年10月28日 11:19
    return d.getFullYear() + "年" + (d.getMonth() + 1) + "月" + d.getDate() + "日 " +
      pad2(d.getHours()) + ":" + pad2(d.getMinutes());
  }
  function groupStats(hdr) {
    var group = hdr.parentElement;
    var rows = group ? group.querySelectorAll(".session-item") : [];
    var n = rows.length, first = 0, latest = 0;
    for (var i = 0; i < rows.length; i++) {
      var rec = STATS && STATS[String(rows[i].getAttribute("data-sid") || "")];
      if (!rec) continue;
      if (rec.created && (!first || rec.created < first)) first = rec.created;
      if (rec.updated > latest) latest = rec.updated;
    }
    return { count: n, first: first, latest: latest, ready: Boolean(STATS) };
  }
  function copyPath(path, onCopied) {
    if (!path) return;
    var done = function () {
      toast("已复制工作目录：" + path);
      if (typeof onCopied === "function") onCopied();
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(path).then(done, function () { legacyCopy(path, done); });
    } else {
      legacyCopy(path, done);
    }
  }
  function legacyCopy(text, done) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;left:-9999px;top:0";
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand("copy"); } catch (_) {}
    document.body.removeChild(ta);
    if (ok) done(); else toast("复制失败，路径：" + text);
  }

  // the label span carries no class of its own; claim it by class once, because
  // any sibling I add would steal the app's > span:last-of-type flex rule
  function labelSpan(hdr) {
    var known = hdr.querySelector(":scope > .hns-ws-label");
    if (known) return known;
    var spans = hdr.querySelectorAll(":scope > span");
    for (var i = 0; i < spans.length; i++) {
      if (spans[i].classList.contains("session-date-caret")) continue;
      if (spans[i].classList.contains("hns-ws-icon")) continue;
      spans[i].classList.add("hns-ws-label");
      return spans[i];
    }
    return null;
  }

  function paintLabel(hdr) {
    var label = labelSpan(hdr);
    if (!label) return;
    var path = pathOf(hdr);
    if (!label.hasAttribute("data-hns-default")) {
      label.setAttribute("data-hns-default", label.textContent);
    }
    var dflt = label.getAttribute("data-hns-default");
    var alias = labels()[path] || "";
    var text = alias || dflt;
    if (label.textContent !== text) label.textContent = text;
    // no marker after the name — the address (renamed or not) is the bubble's job
    // the address is shown by the hover bubble, so the OS tooltip must go —
    // data-hns-path already holds the path for every handler
    if (hdr.hasAttribute("title")) hdr.removeAttribute("title");
    hdr.setAttribute("aria-label", "工作区 " + path);
  }

  function startRename(hdr) {
    var label = labelSpan(hdr);
    var path = pathOf(hdr);
    if (!label || !path || hdr.querySelector(".hns-ws-rename-input")) return;
    var current = label.textContent;
    var dflt = label.getAttribute("data-hns-default") || baseOf(path);
    var input = document.createElement("input");
    input.type = "text";
    input.className = "hns-ws-rename-input";
    input.value = current;
    input.maxLength = 60;
    label.style.display = "none";
    hdr.insertBefore(input, label.nextSibling);
    input.focus();
    input.select();
    var finished = false;
    function commit() {
      if (finished) return;
      finished = true;
      var next = input.value.trim();
      // an empty name, or the app's own label, means "no alias"
      setLabel(path, next && next !== dflt ? next : "");
      cleanup();
      paintLabel(hdr);
      if (next && next !== current) toast("显示名已改为 " + (next || dflt) + "（路径不变）");
    }
    function cancel() {
      if (finished) return;
      finished = true;
      cleanup();
      paintLabel(hdr);
    }
    function cleanup() {
      if (input.parentNode) input.parentNode.removeChild(input);
      label.style.display = "";
      input.onkeydown = null;
    }
    input.onkeydown = function (ev) {
      if (ev.key === "Enter") { ev.preventDefault(); commit(); }
      else if (ev.key === "Escape") { ev.preventDefault(); cancel(); }
    };
    input.addEventListener("blur", commit);
    // the header's own click handler toggles the group; keep the edit alive
    input.addEventListener("click", function (ev) { ev.stopPropagation(); });
    input.addEventListener("dblclick", function (ev) { ev.stopPropagation(); });
  }

  function decorate(hdr) {
    var path = pathOf(hdr);
    if (!path) return;
    if (!hdr.querySelector(":scope > .hns-ws-icon")) {
      var icon = document.createElement("span");
      icon.className = "hns-ws-icon";
      icon.setAttribute("role", "button");
      icon.setAttribute("tabindex", "0");
      icon.setAttribute("aria-label", "复制工作目录绝对路径：" + path);
      icon.addEventListener("click", function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        copyPath(pathOf(hdr));
      });
      icon.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); copyPath(pathOf(hdr)); }
      });
      hdr.insertBefore(icon, hdr.firstChild);
      hdr.classList.add("hns-iconified");
    }
    if (!hdr.querySelector(":scope > .hns-ws-add")) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "hns-ws-add";
      btn.title = "在此工作区新建会话";
      btn.setAttribute("aria-label", "在此工作区新建会话");
      btn.innerHTML = PLUS;
      btn.addEventListener("click", function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        var ws = pathOf(hdr);
        if (!ws || typeof window.newSession !== "function") return;
        try {
          var pending = window.newSession(true, { workspace: ws });
          // The host validates the path against Settings → Workspaces; surface a
          // rejection instead of failing silently.
          if (pending && typeof pending.catch === "function") {
            pending.catch(function (err) { toast(String((err && err.message) || err)); });
          }
        } catch (err) {
          toast(String((err && err.message) || err));
        }
      });
      hdr.appendChild(btn);
    }
    paintLabel(hdr);
  }

  /* ---- the path bubble -----------------------------------------------------
     One shared element on <body> (the sidebar clips overflow), styled from the
     Harness tooltip spec. Hidden until the pointer rests on a workspace row, and
     clickable — clicking it is how you copy the path. */
  var tip = null, tipNameEl = null, tipPathEl = null, tipCountEl = null;
  var tipLatestEl = null, tipFirstEl = null, tipCopyEl = null, tipHintEl = null, tipFor = null;
  var showT = 0, hideT = 0, copiedT = 0;

  function markCopied() {
    if (!tip || !tipCopyEl) return;
    tip.classList.add("is-copied");
    tipCopyEl.textContent = "已复制";
    clearTimeout(copiedT);
    copiedT = setTimeout(function () {
      if (!tip || !tipCopyEl) return;
      tip.classList.remove("is-copied");
      tipCopyEl.textContent = COPY_LABEL;
    }, 1400);
  }

  function ensureTip() {
    if (tip) return tip;
    tip = document.createElement("div");
    tip.className = "hns-ws-tip";
    tip.setAttribute("role", "tooltip");
    /* Layout the user dictated:
         94.DNA_element (25 个会话)     ← name carries the weight
         /research/pipeline_RD/94.DNA_element
         首次会话 2026年10月28日 11:19
         最新会话 2026年10月28日 11:19
       then one dim copy line. */
    var head = document.createElement("div");
    head.className = "hns-ws-tip-head";
    tipNameEl = document.createElement("span");
    tipNameEl.className = "hns-ws-tip-name";
    tipCountEl = document.createElement("span");
    tipCountEl.className = "hns-ws-tip-count";
    head.appendChild(tipNameEl);
    head.appendChild(tipCountEl);
    tipPathEl = document.createElement("div");
    tipPathEl.className = "hns-ws-tip-path";
    var rows = document.createElement("div");
    rows.className = "hns-ws-tip-rows";
    function row(label) {
      var k = document.createElement("span");
      k.className = "hns-ws-tip-k";
      k.textContent = label;
      var v = document.createElement("span");
      v.className = "hns-ws-tip-v";
      rows.appendChild(k);
      rows.appendChild(v);
      return v;
    }
    tipFirstEl = row("首次会话");
    tipLatestEl = row("最新会话");
    var foot = document.createElement("div");
    foot.className = "hns-ws-tip-foot";
    tipHintEl = document.createElement("span");
    tipHintEl.className = "hns-ws-tip-hint";
    tipHintEl.textContent = "点击复制路径 · 双击名称改显示名";
    tipCopyEl = document.createElement("button");
    tipCopyEl.type = "button";
    tipCopyEl.className = "hns-ws-tip-copy";
    tipCopyEl.textContent = COPY_LABEL;
    foot.appendChild(tipHintEl);
    foot.appendChild(tipCopyEl);
    tip.appendChild(head);
    tip.appendChild(tipPathEl);
    tip.appendChild(rows);
    tip.appendChild(foot);
    tip.addEventListener("click", function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      copyPath(tip.getAttribute("data-path") || "", markCopied);
    });
    // crossing from the row into the bubble must not dismiss it
    tip.addEventListener("pointerenter", function () { clearTimeout(hideT); });
    tip.addEventListener("pointerleave", hideTip);
    document.body.appendChild(tip);
    return tip;
  }

  function placeTip(hdr) {
    var hb = hdr.getBoundingClientRect();
    var tw = tip.offsetWidth, th = tip.offsetHeight;
    var side = document.querySelector(".sidebar");
    var gutter = side ? side.getBoundingClientRect().right : hb.right;
    var left = gutter + 6;
    if (left + tw > window.innerWidth - 8) {
      // narrow window: drop it under the row instead of off-screen
      var x = Math.min(Math.max(8, hb.left), Math.max(8, window.innerWidth - tw - 8));
      var y = hb.bottom + 6;
      if (y + th > window.innerHeight - 8) y = Math.max(8, hb.top - th - 6);
      tip.style.left = Math.round(x) + "px";
      tip.style.top = Math.round(y) + "px";
      tip.classList.remove("is-flipped");
      return;
    }
    var top = hb.top + hb.height / 2 - th / 2;
    top = Math.min(Math.max(8, top), Math.max(8, window.innerHeight - th - 8));
    tip.style.left = Math.round(left) + "px";
    tip.style.top = Math.round(top) + "px";
    tip.classList.toggle("is-flipped", left < hb.left);
  }

  function fillTip(hdr) {
    var path = pathOf(hdr);
    var label = labelSpan(hdr);
    tip.setAttribute("data-path", path);
    tipNameEl.textContent = (label && label.textContent) || baseOf(path);
    // zero-width spaces after each "/" so a long path breaks at a separator
    // instead of mid-word; the copy still uses the clean data-path attribute
    tipPathEl.textContent = path.split("/").join("/\u200B");
    tipPathEl.title = path;
    var st = groupStats(hdr);
    tipCountEl.textContent = "(" + st.count + " 个会话)";
    tipFirstEl.textContent = st.ready ? fmtTime(st.first) : "载入中…";
    tipLatestEl.textContent = st.ready ? fmtTime(st.latest) : "载入中…";
    return st;
  }

  function showTip(hdr) {
    if (!pathOf(hdr)) return;
    ensureTip();
    var st = fillTip(hdr);
    tipFor = hdr;
    if (!st.ready) loadStats(function () { if (tipFor === hdr) fillTip(hdr); });
    // measure while invisible: display:none gives no box, and painting at 0,0
    // for a frame would flash the bubble in the corner
    tip.style.visibility = "hidden";
    tip.classList.add("is-visible");
    placeTip(hdr);
    tip.style.visibility = "";
  }

  function hideTip() {
    clearTimeout(showT); showT = 0;
    clearTimeout(hideT); hideT = 0;
    if (tip) tip.classList.remove("is-visible");
    tipFor = null;
  }

  function hoverIn(hdr) {
    clearTimeout(hideT); hideT = 0;
    clearTimeout(showT); showT = 0;
    if (tipFor === hdr && tip && tip.classList.contains("is-visible")) return;
    showT = setTimeout(function () { showT = 0; showTip(hdr); }, 220);
  }

  function hoverOut(ev) {
    // a cancelled pending show must stay cancellable-then-rearmable: leave the
    // handles zeroed, otherwise `if (showT) return` blocks ever re-arming again
    clearTimeout(showT); showT = 0;
    var to = ev && ev.relatedTarget;
    if (to && tip && tip.contains(to)) return;
    clearTimeout(hideT); hideT = 0;
    hideT = setTimeout(function () { hideT = 0; hideTip(); }, 160);
  }

  function markCurrentWorkspace(list) {
    var active = list.querySelector(".session-item.active");
    var group = active && active.closest(".session-date-group");
    var target = group && group.querySelector(":scope > .session-date-header");
    var heads = list.querySelectorAll(".session-date-header");
    for (var i = 0; i < heads.length; i++) {
      var want = heads[i] === target && pathOf(heads[i]);
      if (want !== heads[i].classList.contains("hns-ws-current")) {
        heads[i].classList.toggle("hns-ws-current", want);
      }
    }
  }

  function decorateAll() {
    var list = document.getElementById("sessionList");
    if (!list) return;
    if (tipFor && !tipFor.isConnected) hideTip();   // the list re-rendered under us
    var heads = list.querySelectorAll(".session-date-header.hns-ws-group");
    for (var i = 0; i < heads.length; i++) decorate(heads[i]);
    markCurrentWorkspace(list);
  }

  var wired = false;
  function wireGlobalListeners() {
    if (wired) return;
    wired = true;
    /* All handlers go on the document (capture), never on #sessionList: the app
       can replace that container, and a listener bound to the old node dies with
       it — silently losing the bubble and the rename gesture. */
    function wsHeaderUnder(ev) {
      return ev.target && ev.target.closest && ev.target.closest(".session-date-header.hns-ws-group");
    }
    // dblclick a workspace name to give it a display-only alias
    document.addEventListener("dblclick", function (ev) {
      var hdr = wsHeaderUnder(ev);
      if (!hdr) return;
      if (!ev.target.closest(".hns-ws-label") && !ev.target.closest(".hns-ws-icon")) return;
      ev.preventDefault();
      ev.stopPropagation();
      startRename(hdr);
    }, true);
    document.addEventListener("pointerover", function (ev) {
      var hdr = wsHeaderUnder(ev);
      if (!hdr) return;
      if (ev.relatedTarget && hdr.contains(ev.relatedTarget)) return;   // moving inside the row
      hoverIn(hdr);
    }, true);
    /* Re-arm on movement inside the row: the list is still rendering underneath the
       cursor when a user arrives, and that churn dispatches boundary pointerouts that
       would otherwise cancel the pending show and leave the bubble never appearing. */
    document.addEventListener("pointermove", function (ev) {
      var hdr = wsHeaderUnder(ev);
      if (!hdr) return;
      if (tipFor === hdr && tip && tip.classList.contains("is-visible")) return;
      if (showT) return;                     // already arming
      hoverIn(hdr);
    }, true);
    document.addEventListener("pointerout", function (ev) {
      var hdr = wsHeaderUnder(ev);
      if (!hdr) return;
      if (ev.relatedTarget && hdr.contains(ev.relatedTarget)) return;
      hoverOut(ev);
    }, true);
    // a click opens a session or toggles the group; the bubble already told you
    document.addEventListener("click", function (ev) {
      if (tip && tip.contains(ev.target)) return;      // the bubble handles its own click
      hideTip();
    }, true);
    // scrolling must NOT cancel a pending show (the list auto-scrolls to the active
    // session on load); once shown, just keep the bubble glued to its row
    document.addEventListener("scroll", function () {
      if (tipFor && tip && tip.classList.contains("is-visible")) placeTip(tipFor);
    }, true);
    window.addEventListener("resize", function () { hideTip(); });
    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") hideTip();
    });
  }

  function boot() {
    decorateAll();
    var list = document.getElementById("sessionList");
    if (!list) { setTimeout(boot, 500); return; }
    wireGlobalListeners();
    loadStats();          // warm the times so the first hover already has them

    // The app rebuilds the whole list (all groups removed and re-appended) on
    // collapse, rename, archive, poll… — so decoration must land in the SAME
    // mutation batch. A debounced pass left a ~600ms window where the folder
    // icons, the + button and the alias label were gone, which reads as a fast
    // flicker. MutationObserver callbacks run as microtasks, before paint, so a
    // synchronous pass closes the gap completely; the re-entrancy guard keeps my
    // own insertions from ping-ponging.
    var busy = false, queued = false, passes = 0;
    var MAX_PASSES = 4;
    function runPass() {
      if (busy) { queued = true; return; }
      busy = true;
      try { decorateAll(); } finally { busy = false; }
      if (queued && passes < MAX_PASSES) {
        queued = false; passes++;
        runPass();
      } else {
        queued = false; passes = 0;
      }
    }
    var obs = new MutationObserver(runPass);
    // class flips when the selected session moves; childList flips on re-render
    obs.observe(list, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();

/* Sidebar management module — the Harness section header the user pasted
   (bhn1Oq_sectionHeader: label + inline search slot + header action buttons),
   plus a profile switcher above the conversation list. Every action here calls
   a real app function (switchToProfile / switchPanel / openWorkspaceCreate) so
   the list repaints on its own; nothing is reimplemented. Deleting this IIFE
   and its CSS block returns the original composer chips and sidebar layout. */
(function () {
  var ICON_VIEW =
    '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" ' +
    'stroke-width="1" stroke-linecap="round" aria-hidden="true">' +
    '<path d="M2.3 5h5.85M12.05 5h1.65"/><circle cx="9.95" cy="5" r="1.45"/>' +
    '<path d="M2.3 11h1.65M7.85 11h5.85"/><circle cx="5.75" cy="11" r="1.45"/></svg>';
  var ICON_ADD =
    '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke-width="1" aria-hidden="true">' +
    '<path d="M5.54492 2.06738C5.91034 2.06754 6.26318 2.20149 6.53711 2.44336L7.94043 3.68164V4.7998' +
    'C7.71462 4.74105 7.50367 4.63139 7.32617 4.47461L5.87598 3.19238C5.78477 3.11185 5.66658 3.06754' +
    ' 5.54492 3.06738H2.94922C2.67322 3.06738 2.44946 3.29145 2.44922 3.56738V12.4326C2.44927 12.7087' +
    ' 2.67311 12.9326 2.94922 12.9326H12.9326C13.2086 12.9325 13.4326 12.7086 13.4326 12.4326V8.53613' +
    'H14.4326V12.4326C14.4326 13.2609 13.7609 13.9325 12.9326 13.9326H2.94922C2.12083 13.9326 1.44927' +
    ' 13.261 1.44922 12.4326V3.56738C1.44946 2.73916 2.12094 2.06738 2.94922 2.06738H5.54492Z" fill="currentColor"/>' +
    '<path d="M9.75977 4.50208H14.5509" stroke="currentColor"/><path d="M12.1492 6.89758L12.1492 2.10642" stroke="currentColor"/></svg>';

  function mk(tag, cls) { var e = document.createElement(tag); if (cls) e.className = cls; return e; }
  // "工作区" is the app's own zh string for tab_workspaces, so the label follows
  // a language switch instead of being pinned to Chinese
  function wsLabel() {
    try {
      if (typeof window.t === "function") {
        var v = window.t("tab_workspaces");
        if (v && v !== "tab_workspaces") return v;
      }
    } catch (_e) { /* fall through */ }
    return "工作区";
  }
  function panelView() {
    var list = document.getElementById("sessionList");
    return list && list.closest ? list.closest(".panel-view") : null;
  }
  function toast(msg) { if (typeof window.showToast === "function") window.showToast(msg, 3000); }

  // ── profile switcher ────────────────────────────────────────────────────────
  function profileRow(view) {
    var row = view.querySelector(":scope > .hns-profile-row");
    if (row) return row;
    row = mk("div", "hns-profile-row");
    row.setAttribute("role", "tablist");
    row.setAttribute("aria-label", "Agent profiles");
    var head = view.querySelector(":scope > .panel-head");
    if (head && head.nextSibling) view.insertBefore(row, head.nextSibling);
    else view.insertBefore(row, view.firstChild);
    return row;
  }

  function activeProfileName(data) {
    var st = window.S || {};
    if (st.activeProfile) return st.activeProfile;
    return (data && data.active) || "default";
  }

  // One name can arrive twice — upstream lists the base home as a "default"
  // row AND the profiles/default directory (see api/profiles.py's own comment).
  // Keep the row bound to profiles/<name>; otherwise the first one seen.
  function dedupeProfiles(list) {
    var byName = {}, out = [];
    for (var i = 0; i < list.length; i++) {
      var p = list[i], name = p.name;
      if (!Object.prototype.hasOwnProperty.call(byName, name)) {
        byName[name] = p;
        out.push(p);
        continue;
      }
      var kept = byName[name];
      var better = /\/profiles\/[A-Za-z0-9._-]+$/.test(String(p.path || ""));
      var worse = /\/profiles\/[A-Za-z0-9._-]+$/.test(String(kept.path || ""));
      if (better && !worse) {
        byName[name] = p;
        out[out.indexOf(kept)] = p;
      }
    }
    return out;
  }

  function paintProfiles(row, data) {
    data = data || {};
    var all = Array.isArray(data.profiles) ? data.profiles.filter(function (p) { return p && p.name; }) : [];
    var active = activeProfileName(data);
    all = dedupeProfiles(all);
    var shown = all.filter(function (p) { return p.visible !== false || p.name === active; });
    row.textContent = "";
    // one profile only (or single-profile mode) is not a choice worth a row of chrome
    if (data.single_profile_mode || shown.length < 2) { row.hidden = true; return; }
    row.hidden = false;
    for (var i = 0; i < shown.length; i++) {
      (function (p) {
        var btn = mk("button", "hns-profile-btn");
        btn.type = "button";
        btn.setAttribute("role", "tab");
        btn.dataset.profile = p.name;
        btn.setAttribute("aria-selected", p.name === active ? "true" : "false");
        if (p.name === active) btn.classList.add("is-active");
        if (p.gateway_running) {
          var dot = mk("span", "hns-profile-dot" + (p.gateway_running ? " running" : ""));
          dot.title = "Gateway 运行中";
          btn.appendChild(dot);
        }
        btn.appendChild(mk("span", "hns-profile-name"));
        btn.lastChild.textContent = p.name;
        var bits = [];
        if (p.model) bits.push(String(p.model).split("/").pop());
        if (bits.length) btn.title = p.name + " · " + bits.join(" · ");
        btn.addEventListener("click", function (ev) {
          ev.preventDefault();
          ev.stopPropagation();
          if (p.name === activeProfileName(data)) return;
          if (typeof window.switchToProfile !== "function") { toast("这个版本没有 switchToProfile，无法切换 profile"); return; }
          btn.classList.add("is-busy");
          Promise.resolve()
            .then(function () { return window.switchToProfile(p.name); })
            .then(function () { loadProfiles(); }, function (err) {
              toast("切换 profile 失败：" + String((err && err.message) || err));
              loadProfiles();
            });
        });
        row.appendChild(btn);
      })(shown[i]);
    }
  }

  var inflight = null;
  function loadProfiles() {
    var row = null;
    var view = panelView();
    if (view) row = profileRow(view);
    if (inflight) return inflight;
    inflight = fetch("/api/profiles", { credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        inflight = null;
        var v = panelView();
        if (!v) return;
        paintProfiles(profileRow(v), data);
      })
      .catch(function () { inflight = null; });
    return inflight;
  }

  // The titlebar label is the app's own record of the resolved profile; when it
  // changes (boot, dropdown switch, Spaces panel) resync so this row never lies.
  function watchTitlebar() {
    var lbl = document.getElementById("titlebarProfileLabel");
    if (!lbl || lbl._hnsWatched) return;
    lbl._hnsWatched = true;
    new MutationObserver(function () { loadProfiles(); })
      .observe(lbl, { childList: true, characterData: true, subtree: true });
  }

  // ── workspace section header ────────────────────────────────────────────────
  function secHeader(view) {
    var existing = view.querySelector(":scope > .hns-sec-header");
    if (existing) return existing;
    var hdr = mk("div", "hns-sec-header");
    var label = mk("span", "hns-sec-label");
    label.textContent = wsLabel();
    label.title = "会话按工作目录分组";
    var slot = mk("div", "hns-sec-search");
    var actions = mk("div", "hns-sec-actions");

    var manage = mk("button", "hns-sec-btn hns-sec-view");
    manage.type = "button";
    manage.setAttribute("aria-label", "视图选项");
    manage.setAttribute("aria-haspopup", "menu");
    manage.title = "视图选项（分组方式 / 排序方式 / 筛选会话）";
    manage.innerHTML = ICON_VIEW;
    manage.addEventListener("click", function (ev) {
      ev.preventDefault(); ev.stopPropagation();
      if (typeof window.switchPanel === "function") window.switchPanel("workspaces");
      else toast("这个版本没有 switchPanel");
    });

    var add = mk("button", "hns-sec-btn hns-sec-add");
    add.type = "button";
    add.setAttribute("aria-label", "添加工作区");
    add.setAttribute("aria-haspopup", "dialog");
    add.title = "添加工作区";
    add.innerHTML = ICON_ADD;
    add.addEventListener("click", function (ev) {
      ev.preventDefault(); ev.stopPropagation();
      if (typeof window.openWorkspaceCreate === "function") window.openWorkspaceCreate();
      else toast("这个版本没有 openWorkspaceCreate");
    });

    actions.appendChild(manage);
    actions.appendChild(add);
    hdr.appendChild(label);
    hdr.appendChild(slot);
    hdr.appendChild(actions);

    var search = view.querySelector(":scope > .session-search");
    if (search) view.insertBefore(hdr, search);
    else {
      var list = view.querySelector(":scope > .session-list");
      if (list) view.insertBefore(hdr, list); else view.appendChild(hdr);
    }
    return hdr;
  }

  // the app's own search box (static in index.html, inline oninput handler) is
  // relocated into the slot; moving a node keeps its listeners
  function adoptSearch(view) {
    var hdr = secHeader(view);
    var slot = hdr.querySelector(".hns-sec-search");
    var inside = slot.querySelector(".session-search");
    var orphan = view.querySelector(":scope > .session-search");
    if (inside && !orphan) return;
    if (orphan) slot.appendChild(orphan);
  }

  // "Show N from other profiles" / "Show N archived" are anonymous inline-styled
  // divs appended straight to #sessionList, so they can only be found by text.
  // The profile row above replaces the cross-profile one; archived history is
  // still reachable by clearing this rule.
  var TOGGLE_RE = /^(Show \d+ from other profiles|Show active profile only|Show \d+ archived|Hide archived)$/;
  function hideListToggles() {
    var list = document.getElementById("sessionList");
    if (!list) return;
    var kids = list.children;
    for (var i = 0; i < kids.length; i++) {
      var d = kids[i];
      if (d.tagName !== "DIV" || d.className) continue;
      if (!TOGGLE_RE.test((d.textContent || "").trim())) continue;
      if (!d.hidden) { d.hidden = true; d.setAttribute("aria-hidden", "true"); }
    }
  }

  function build() {
    var view = panelView();
    hideListToggles();
    if (!view) return;
    adoptSearch(view);
    watchTitlebar();
    loadProfiles();
    var hdr = view.querySelector(".hns-sec-header .hns-sec-label");
    if (hdr && hdr.textContent !== wsLabel()) hdr.textContent = wsLabel();
  }

  function boot() {
    build();
    // the app can rebuild the panel shell on a profile switch; re-adopt if so
    var tries = 0;
    var t = setInterval(function () {
      var v = panelView();
      if (v && (!v.querySelector(".hns-sec-header") || !v.querySelector(".hns-profile-btn"))) build();
      if (++tries > 30) clearInterval(t);
    }, 500);
    window.addEventListener("focus", function () { loadProfiles(); });
    document.addEventListener("hermes:language-changed", build);
    // the list re-renders on every operation and re-appends those toggles
    var list = document.getElementById("sessionList");
    if (list) new MutationObserver(hideListToggles).observe(list, { childList: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();

/* The two Harness header actions, with their real behaviour (read out of the
   dsh-client-ui-workspace bundle, not guessed):

   视图选项  → a menu with three radio sections — 分组方式 (按工作区 / 按时间 /
              单列表), 排序方式 (最近更新 / 创建时间 / 名称), 筛选会话 (隐藏已归档 /
              全部对话 / 仅显示已归档). State lives in sessions.js
              (window._hnsApplyViewOptions) because that is where the render
              paths read it; Harness has 手动排序, which we cannot offer — the
              WebUI has no per-user session order store — so 创建时间/名称 fill the
              slot with sorting that actually exists.

   添加工作区 → a popover anchored under the button: type a path or pick one from
              /api/workspaces/suggest (the same trusted-root browser the Spaces
              form uses). Picking adds it via /api/workspaces/add and immediately
              starts a session in it, which is exactly Harness's
              onPick → startSession(workspaceId). */
(function () {
  var MENU = [
    { kind: "label", text: "分组方式" },
    { kind: "item", group: "groupBy", id: "workspace", text: "按工作区" },
    { kind: "item", group: "groupBy", id: "date", text: "按时间" },
    { kind: "item", group: "groupBy", id: "flat", text: "单列表" },
    { kind: "sep" },
    { kind: "label", text: "排序方式" },
    { kind: "item", group: "orderBy", id: "updated", text: "最近更新" },
    { kind: "item", group: "orderBy", id: "created", text: "创建时间" },
    { kind: "item", group: "orderBy", id: "title", text: "名称" },
    { kind: "sep" },
    { kind: "label", text: "筛选会话" },
    { kind: "item", group: "archived", id: "hide", text: "隐藏已归档" },
    { kind: "item", group: "archived", id: "show", text: "全部对话（显示已归档）" },
    { kind: "item", group: "archived", id: "only", text: "仅显示已归档" },
  ];
  var CHECK = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<polyline points="20 6 9 17 4 12"/></svg>';

  function mk(tag, cls) { var e = document.createElement(tag); if (cls) e.className = cls; return e; }
  function currentOptions() {
    if (typeof window._hnsGetViewOptions === "function") {
      try { return window._hnsGetViewOptions(); } catch (_e) { /* fall through */ }
    }
    return { groupBy: "workspace", orderBy: "updated", archived: "hide" };
  }
  // Surfaces are built per open and destroyed on close: keeping a hidden one
  // around means the next open stacks a second copy, and a click then lands on
  // the OLDEST copy whose captured option state is stale — it sees "value
  // unchanged" and silently does nothing.
  function closeAll() {
    var stale = document.querySelectorAll(".hns-menu, .hns-picker");
    for (var i = 0; i < stale.length; i++) stale[i].remove();
  }

  // ── one floating surface, positioned under an anchor, clamped to the viewport ──
  function place(el, anchor, align) {
    var ab = anchor.getBoundingClientRect();
    el.style.visibility = "hidden";
    el.classList.add("is-open");
    var w = el.offsetWidth || 240, h = el.offsetHeight || 200;
    var left = align === "right" ? ab.right - w : ab.left;
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    var top = ab.bottom + 6;
    if (top + h > window.innerHeight - 8) top = Math.max(8, ab.top - h - 6);
    el.style.left = Math.round(left) + "px";
    el.style.top = Math.round(top) + "px";
    el.style.visibility = "";
  }

  // ── 视图选项 ────────────────────────────────────────────────────────────────
  function buildMenu(anchor) {
    var menu = mk("div", "hns-menu");
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", "视图选项");
    var opts = currentOptions();
    MENU.forEach(function (row) {
      if (row.kind === "label") {
        var lab = mk("div", "hns-menu-label");
        lab.textContent = row.text;
        menu.appendChild(lab);
        return;
      }
      if (row.kind === "sep") { menu.appendChild(mk("div", "hns-menu-sep")); return; }
      var item = mk("button", "hns-menu-item");
      item.type = "button";
      item.setAttribute("role", "menuitemradio");
      item.setAttribute("aria-checked", opts[row.group] === row.id ? "true" : "false");
      var text = mk("span", "hns-menu-text");
      text.textContent = row.text;
      var mark = mk("span", "hns-menu-check");
      if (opts[row.group] === row.id) mark.innerHTML = CHECK;
      item.appendChild(text);
      item.appendChild(mark);
      item.addEventListener("click", function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        if (opts[row.group] === row.id) { closeAll(); return; }
        var patchObj = {};
        patchObj[row.group] = row.id;
        if (typeof window._hnsApplyViewOptions !== "function") {
          if (typeof window.showToast === "function") window.showToast("这个版本没有视图选项接口", 3000);
          return;
        }
        window._hnsApplyViewOptions(patchObj);
        closeAll();
      });
      menu.appendChild(item);
    });
    document.body.appendChild(menu);
    place(menu, anchor, "right");
    return menu;
  }

  // ── 添加工作区 ──────────────────────────────────────────────────────────────
  function addWorkspace(path) {
    var body = JSON.stringify({ path: path });
    if (typeof window.api === "function") return Promise.resolve(window.api("/api/workspaces/add", { method: "POST", body: body }));
    return fetch("/api/workspaces/add", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: body }).then(function (r) { return r.json(); });
  }

  // Drill-down browsing over the real filesystem (/api/fs/list, read-only). It
  // is NOT limited to trusted roots, which is the whole point: /research lives
  // outside them and the old /api/workspaces/browse answered outside_trusted_roots.
  function browseDir(path) {
    var url = "/api/fs/list?path=" + encodeURIComponent(path || "~");
    var call = (typeof window.api === "function") ? window.api(url) : fetch(url, { credentials: "same-origin" }).then(function (r) { return r.json(); });
    return Promise.resolve(call).then(function (d) { return d || {}; },
      function (err) { return { error: String((err && (err.message || err.error)) || "unreachable") }; });
  }

  function renderBrowse(picker, data, opts) {
    opts = opts || {};
    var list = picker.querySelector(".hns-picker-list");
    var crumb = picker.querySelector(".hns-picker-crumb");
    var status = picker.querySelector(".hns-picker-status");
    var chooseBtn = picker.querySelector(".hns-picker-choose");
    var cwd = picker._cwd = data.path || "";
    if (chooseBtn) chooseBtn.disabled = !cwd || Boolean(data.error);
    // The input is the user's typing buffer and is NEVER rewritten here. Writing
    // the server's normalized path back into it is what used to eat the trailing
    // "/" the instant /research/ was typed (the response path is /research).
    if (crumb) {
      crumb.textContent = cwd ? "当前目录：" + cwd : "";
      crumb.title = cwd || "";
      crumb.hidden = !cwd;
    }
    list.textContent = "";
    picker._children = (data.entries || []).slice();
    picker._filter = opts.filter != null ? opts.filter : "";

    if (data.error) {
      var msg = (data.error === "path not found" || data.error === "not_a_directory")
        ? "目录不存在：" + cwd
        : (data.error === "not a directory" ? "这是一个文件，不是目录：" + cwd
        : (data.error === "permission denied" ? "没有权限读取：" + cwd
        : "无法读取：" + cwd));
      var err = mk("div", "hns-picker-empty");
      err.textContent = msg;
      list.appendChild(err);
      if (status) status.textContent = "";
      return;
    }

    if (data.parent) {
      var up = mk("button", "hns-picker-item hns-picker-up");
      up.type = "button";
      up.title = data.parent;
      var upName = mk("span", "hns-picker-name");
      upName.textContent = "..";
      var upPath = mk("span", "hns-picker-path");
      upPath.textContent = "上一级";
      up.appendChild(upName);
      up.appendChild(upPath);
      up.addEventListener("click", function (ev) { ev.preventDefault(); ev.stopPropagation(); navigatePicker(picker, data.parent, { setInput: true }); });
      list.appendChild(up);
    }

    if (!picker._children.length) {
      var empty = mk("div", "hns-picker-empty");
      empty.textContent = "此目录是空的";
      list.appendChild(empty);
    }
    var dirCount = 0, fileCount = 0;
    picker._children.forEach(function (entry) {
      var isDir = entry.is_dir !== false && !entry.is_file;
      if (isDir) {
        dirCount++;
        var row = mk("button", "hns-picker-item hns-picker-dir");
        row.type = "button";
        row.dataset.path = entry.path;
        row.dataset.name = entry.name;
        row.title = entry.path;
        var name = mk("span", "hns-picker-name");
        name.textContent = entry.name + "/";
        row.appendChild(name);
        // an explicit click may move the path box; only TYPING must never be
        // rewritten (that was the trailing-slash bug)
        row.addEventListener("click", function (ev) { ev.preventDefault(); ev.stopPropagation(); navigatePicker(picker, entry.path, { setInput: true }); });
        list.appendChild(row);
      } else {
        fileCount++;
        var frow = mk("div", "hns-picker-item hns-picker-file");
        frow.dataset.name = entry.name;
        frow.title = entry.path + "（文件，不能作为工作区）";
        var fname = mk("span", "hns-picker-name");
        fname.textContent = entry.name;
        frow.appendChild(fname);
        list.appendChild(frow);
      }
    });
    applyFilter(picker);
    if (status) status.textContent = dirCount + " 个目录 · " + fileCount + " 个文件";
  }

  function applyFilter(picker) {
    var q = (picker._filter || "").toLowerCase();
    var list = picker.querySelector(".hns-picker-list");
    var rows = list.querySelectorAll(".hns-picker-item:not(.hns-picker-up)");
    for (var i = 0; i < rows.length; i++) {
      var name = (rows[i].getAttribute("data-name") || "").toLowerCase();
      rows[i].hidden = Boolean(q) && name.indexOf(q) < 0;
    }
  }

  var navSeq = 0;
  function navigatePicker(picker, path, opts) {
    opts = opts || {};
    var seq = ++navSeq;
    var status = picker.querySelector(".hns-picker-status");
    if (status) status.textContent = "读取 " + path + " …";
    if (opts.setInput) {
      var box = picker.querySelector(".hns-picker-input");
      if (box) {
        var next = String(path || "");
        if (next && next.slice(-1) !== "/") next += "/";
        box.value = next;
      }
    }
    browseDir(path).then(function (data) {
      if (!picker.isConnected || seq !== navSeq) return;
      if (data && !data.error) { renderBrowse(picker, data, opts); return; }
      // not a directory (or not there yet): list the parent and filter by the
      // fragment the user is still typing, so partial paths behave like a browser
      var v = String(path || "");
      var cut = v.lastIndexOf("/");
      var parentPath = cut > 0 ? v.slice(0, cut) : (cut === 0 ? "/" : "~");
      var frag = cut >= 0 ? v.slice(cut + 1) : v;
      browseDir(parentPath).then(function (pd) {
        if (!picker.isConnected || seq !== navSeq) return;
        if (pd && !pd.error) { renderBrowse(picker, pd, { filter: frag }); return; }
        renderBrowse(picker, data, opts || {});
      });
    });
  }

  function baseOf(path) {
    var p = String(path || "").replace(/\/+$/, "");
    var i = p.lastIndexOf("/");
    return i >= 0 ? p.slice(i + 1) || "/" : p;
  }


  function pick(path, picker) {
    if (picker._busy) return;
    picker._busy = true;
    var status = picker.querySelector(".hns-picker-status");
    if (status) status.textContent = "正在添加 " + path + " …";
    // adding an existing workspace answers with an error; the path is usable
    // either way, so only a missing session helper should stop the flow
    Promise.resolve()
      .then(function () { return addWorkspace(path).catch(function () { return null; }); })
      .then(function () { return startSessionIn(path, picker); })
      .then(function () { picker._busy = false; }, function () { picker._busy = false; });
  }

  // Add + open a session in one go, the way Harness's onPick → startSession(ws)
  // does. newSession() and switchToWorkspace() both consult the client's cached
  // workspace list, so a just-added directory made them return without doing
  // anything; POST /api/session/new is what the app itself uses for a
  // system-minted session, and loadSession()/renderSessionList() adopt the result.
  function startSessionIn(path, picker) {
    closeAll();
    var status = picker && picker.querySelector ? picker.querySelector(".hns-picker-status") : null;
    if (status) status.textContent = "正在打开会话…";
    var create = function () {
      if (typeof window.api !== "function") return Promise.resolve(null);
      return Promise.resolve(window.api("/api/session/new", {
        method: "POST",
        body: JSON.stringify({ workspace: path, worktree: false }),
      }));
    };
    return create().then(function (r) {
      var sid = r && r.session && r.session.session_id;
      if (!sid) {
        if (typeof window.showToast === "function") window.showToast("已添加工作区，但没能新建会话");
        return null;
      }
      var open = (typeof window.loadSession === "function")
        ? Promise.resolve(window.loadSession(sid))
        : Promise.resolve(null);
      return open.then(function () {
        if (typeof window.renderSessionList === "function") return window.renderSessionList();
        return null;
      }).then(function () {
        if (typeof window.showToast === "function") window.showToast("已在该工作区新建会话：" + path, 2200);
      });
    }).then(null, function (err) {
      if (typeof window.showToast === "function") window.showToast("打开会话失败：" + String((err && err.message) || err));
    });
  }

  function buildPicker(anchor) {
    var picker = mk("div", "hns-picker");
    picker.setAttribute("role", "dialog");
    picker.setAttribute("aria-label", "添加工作区");

    var input = mk("input", "hns-picker-input");
    input.type = "text";
    input.placeholder = "输入目录路径后回车";
    input.spellcheck = false;
    var list = mk("div", "hns-picker-list");
    var foot = mk("div", "hns-picker-foot");
    var choose = mk("button", "hns-picker-choose");
    choose.type = "button";
    choose.textContent = "在此目录新建会话";
    choose.addEventListener("click", function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      if (picker._cwd) pick(picker._cwd, picker);
    });
    var manage = mk("button", "hns-picker-manage");
    manage.type = "button";
    manage.textContent = "Spaces 面板…";
    manage.addEventListener("click", function (ev) {
      ev.preventDefault();
      closeAll();
      if (typeof window.openWorkspaceCreate === "function") window.openWorkspaceCreate();
    });
    var status = mk("span", "hns-picker-status");
    foot.appendChild(choose);
    foot.appendChild(status);
    foot.appendChild(manage);
    var crumb = mk("div", "hns-picker-crumb");
    crumb.hidden = true;
    picker.appendChild(input);
    picker.appendChild(crumb);
    picker.appendChild(list);
    picker.appendChild(foot);
    document.body.appendChild(picker);
    place(picker, anchor, "right");

    // Open on the home directory so the panel is usable straight away; the add
    // action still needs an explicit click, so nothing is registered by accident.
    picker._cwd = "";
    choose.disabled = true;
    navigatePicker(picker, "~");

    var deb = 0;
    input.addEventListener("input", function () {
      var typed = (input.value || "");
      // instant local feedback on the fragment the user is on…
      picker._filter = typed.split("/").pop() || "";
      applyFilter(picker);
      // …then resolve the whole path: "/research" IS a directory, so it gets
      // listed; "/resea" is not, so its parent is listed and filtered.
      if (deb) clearTimeout(deb);
      deb = setTimeout(function () {
        deb = 0;
        if (!picker.isConnected) return;
        navigatePicker(picker, typed.trim() || "~");
      }, 260);
    });
    input.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter") {
        ev.preventDefault();
        var path = (input.value || "").trim();
        if (deb) { clearTimeout(deb); deb = 0; }
        navigatePicker(picker, path || "~");
      } else if (ev.key === "Escape") {
        ev.preventDefault();
        closeAll();
      }
    });
    setTimeout(function () { input.focus(); input.select(); }, 0);
    return picker;
  }

  // ── wiring ──────────────────────────────────────────────────────────────────
  function toggleSurface(sel, buildFn, anchor) {
    var open = document.querySelector(sel);
    closeAll();
    if (open) return;      // second click on the same button closes it
    buildFn(anchor);
  }

  // Delegation on the document, not per-button listeners: the panel shell (and
  // with it my section header) is rebuilt whenever the sidebar panel switches,
  // so a listener bound to one header dies with it and the button silently stops
  // responding — which is exactly what a per-element wiring did after a panel
  // switch. Identity comes from aria-label because the button ORDER is not a
  // contract.
  function onActionClick(ev) {
    var btn = ev.target && ev.target.closest ? ev.target.closest(".hns-sec-btn") : null;
    if (!btn) return;
    ev.preventDefault();
    ev.stopPropagation();
    var label = btn.getAttribute("aria-label") || "";
    if (label === "视图选项" || btn.classList.contains("hns-sec-view")) {
      toggleSurface(".hns-menu", buildMenu, btn);
    } else if (label === "添加工作区") {
      toggleSurface(".hns-picker", buildPicker, btn);
    }
  }

  document.addEventListener("pointerdown", function (ev) {
    if (ev.target && ev.target.closest && ev.target.closest(".hns-menu, .hns-picker, .hns-sec-btn")) return;
    closeAll();
  }, true);
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape") closeAll();
  }, true);

  function boot() {
    document.addEventListener("click", onActionClick, true);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();


/* ── 思考正文 / 工具参数默认收起 ───────────────────────────────────────────────
   The app re-applies `.open` on every render (and while streaming), so the reasoning
   body and the tool argument rows come back expanded no matter what CSS says. This
   pass strips `.open` after each mutation, but remembers the cards the user opened
   by hand (keyed by the row's data-* id, falling back to a text hash) so a re-render
   never slams a card the user is reading. */
(function(){
  if (window.__hnsCollapseDetails) return;
  window.__hnsSkinRev = 'r12';   // 皮肤版本标记：便于确认页面加载的是哪一版

  window.__hnsCollapseDetails = true;
  var userOpen = new Set();
  function keyOf(card){
    var row = card.closest('.agent-activity-thinking,[data-anchor-scene-row="1"],.tool-card-row,.transparent-event-row');
    var k = row && (row.getAttribute('data-thinking-key') || row.getAttribute('data-anchor-row-id') ||
                    row.getAttribute('data-tool-call-id') || row.getAttribute('data-row-id'));
    if (k) return 'k:' + k;
    var body = card.querySelector('pre,.tool-card-args,.thinking-card-body');
    return 'h:' + String((body && body.textContent) || '').slice(0, 120);
  }
  var intentEls = new Map();   // 用户刚点过的卡片 -> key，等下一轮按实际状态采纳
  var busy = false;
  function collapse(){
    if (busy) return;
    busy = true;
    try {
      // ① 消费点击意图（通常 0~1 个）
      intentEls.forEach(function(k, el){
        if (!el.isConnected) { intentEls.delete(el); return; }
        if (el.classList.contains('open')) userOpen.add(k); else userOpen.delete(k);
        intentEls.delete(el);
      });
      // ② 只扫描"已展开"的卡片，避免在 900+ 思考块的会话上每次变动都全量遍历
      var open = document.querySelectorAll('.messages-inner .thinking-card.open, .messages-inner .tool-card.open');
      for (var i = 0; i < open.length; i++) {
        if (!userOpen.has(keyOf(open[i]))) open[i].classList.remove('open');
      }
    } finally {
      setTimeout(function(){ busy = false; }, 0);
    }
  }
  document.addEventListener('click', function(ev){
    var t = ev.target;
    if (!t || !t.closest) return;
    if (t.closest('.thinking-copy-btn')) return;   // 复制按钮自带 stopPropagation，别记成展开意图
    var head = t.closest('.thinking-card-header,.tool-card-header');
    if (!head) return;
    var card = head.closest('.thinking-card,.tool-card');
    if (!card) return;
    // 只记账不判定方向：应用在自己的处理器里翻转 class，收起逻辑随后按实际状态
    // 采纳（观察者是微任务，早于这里的定时器，不能靠事件顺序猜意图）。
    intentEls.set(card, keyOf(card));
  }, true);
  function start(){
    collapse();
    var root = document.querySelector('.messages-inner');
    if (!root) { setTimeout(start, 400); return; }
    new MutationObserver(collapse).observe(root, {childList:true, subtree:true, attributes:true, attributeFilter:['class']});
    try { document.addEventListener('hermes:session-loaded', collapse); } catch(e) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();


/* ── 会话行悬浮：显示该会话的 /status 快照 ─────────────────────────────────────
   Hovering a conversation title asks /api/session/status for that sid and shows the
   same fields the /status slash command prints (model, profile, workspace, message
   counts, tokens, cost, running state). Cached per sid, fetched only after a short
   dwell, and never blocking the row's own click behaviour. */
(function(){
  if (window.__hnsSessionStatusTip) return;
  window.__hnsSessionStatusTip = true;
  var TTL = 15000;
  var DWELL = 320;
  var cache = new Map();      // sid -> {at, data}
  var inflight = new Map();   // sid -> Promise
  var tip = null;
  var showT = null;
  var hideT = null;
  var curSid = null;
  var curRow = null;
  var el = {};

  function num(v){ return (v === null || v === undefined || v === '') ? '—' : Number(v).toLocaleString('en-US'); }
  function money(v){ return (v === null || v === undefined || v === '') ? '—' : '$' + Number(v).toFixed(4); }
  function when(ts){
    if (!ts) return '—';
    var d = new Date(Number(ts) * 1000);
    if (isNaN(d.getTime())) return '—';
    var p = function(n){ return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth()+1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function ensureTip(){
    if (tip && tip.isConnected) return tip;
    tip = document.createElement('div');
    tip.className = 'hns-ws-tip hns-sess-tip';
    tip.setAttribute('role', 'tooltip');

    var head = document.createElement('div');
    head.className = 'hns-ws-tip-head';
    el.title = document.createElement('span');
    el.title.className = 'hns-ws-tip-name';
    el.state = document.createElement('span');
    el.state.className = 'hns-ws-tip-count hns-sess-state';
    head.appendChild(el.title);
    head.appendChild(el.state);

    el.path = document.createElement('div');
    el.path.className = 'hns-ws-tip-path';

    var rows = document.createElement('div');
    rows.className = 'hns-ws-tip-rows hns-sess-rows';
    function row(label){
      var k = document.createElement('span');
      k.className = 'hns-ws-tip-k';
      k.textContent = label;
      var v = document.createElement('span');
      v.className = 'hns-ws-tip-v';
      rows.appendChild(k);
      rows.appendChild(v);
      return v;
    }
    el.sid = row('会话 ID');
    el.sid.classList.add('hns-sess-id');
    el.model = row('模型');
    el.profile = row('Profile');
    el.messages = row('消息');
    el.tokens = row('Tokens');
    el.cost = row('预估成本');
    el.updated = row('更新');

    var foot = document.createElement('div');
    foot.className = 'hns-ws-tip-foot';
    var hint = document.createElement('span');
    hint.className = 'hns-ws-tip-hint';
    hint.textContent = '点击打开会话';
    foot.appendChild(hint);

    tip.appendChild(head);
    tip.appendChild(el.path);
    tip.appendChild(rows);
    tip.appendChild(foot);
    tip.addEventListener('pointerenter', function(){ clearTimeout(hideT); });
    tip.addEventListener('pointerleave', hide);
    document.body.appendChild(tip);
    return tip;
  }

  function place(row){
    var t = ensureTip();
    t.classList.add('is-visible');
    var r = row.getBoundingClientRect();
    var w = t.offsetWidth;
    var h = t.offsetHeight;
    var left = r.right + 10;
    t.classList.remove('is-flipped');
    if (left + w > window.innerWidth - 8) { left = r.left - w - 10; t.classList.add('is-flipped'); }
    if (left < 8) left = 8;
    var top = r.top;
    if (top + h > window.innerHeight - 8) top = Math.max(8, window.innerHeight - h - 8);
    t.style.left = Math.round(left) + 'px';
    t.style.top = Math.round(top) + 'px';
  }

  function paint(d, row){
    ensureTip();
    var running = !!d.agent_running;
    el.sid.textContent = d.session_id || '—';
    el.title.textContent = d.title || '(未命名会话)';
    el.state.textContent = running ? '运行中' : '空闲';
    el.state.classList.toggle('is-running', running);
    el.path.textContent = d.workspace || '—';
    el.model.textContent = d.model || '—';
    el.profile.textContent = d.profile || 'default';
    el.messages.textContent = num(d.visible_message_count != null ? d.visible_message_count : d.message_count) +
      (d.message_count && d.visible_message_count != null && d.message_count !== d.visible_message_count
        ? ' / ' + num(d.message_count) : '');
    el.tokens.textContent = num(d.input_tokens) + ' in · ' + num(d.output_tokens) + ' out · ' + num(d.total_tokens);
    el.cost.textContent = money(d.estimated_cost);
    el.updated.textContent = when(d.updated_at);
    place(row);
  }

  function status(sid){
    var hit = cache.get(sid);
    if (hit && Date.now() - hit.at < TTL) return Promise.resolve(hit.data);
    if (inflight.has(sid)) return inflight.get(sid);
    var p = fetch('/api/session/status?session_id=' + encodeURIComponent(sid), { credentials: 'same-origin' })
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(d){ if (d) cache.set(sid, { at: Date.now(), data: d }); return d; })
      .catch(function(){ return null; })
      .then(function(d){ inflight.delete(sid); return d; });
    inflight.set(sid, p);
    return p;
  }

  function hide(ev){
    if (ev && ev.relatedTarget && tip && tip.contains(ev.relatedTarget)) return;
    clearTimeout(hideT);
    hideT = setTimeout(function(){
      if (tip) tip.classList.remove('is-visible');
      curSid = null;
      curRow = null;
    }, 120);
  }

  document.addEventListener('mouseover', function(ev){
    var t = ev.target;
    if (!t || !t.closest) return;
    if (tip && tip.contains(t)) { clearTimeout(hideT); return; }
    var title = t.closest('.session-title, .session-title-row .session-name');
    if (!title) return;
    var row = title.closest('.session-item[data-sid], .session-child-session[data-sid], [data-sid]');
    if (!row) return;
    var sid = row.getAttribute('data-sid');
    if (!sid || sid === curSid) { clearTimeout(hideT); return; }
    clearTimeout(showT);
    clearTimeout(hideT);
    curSid = sid;
    curRow = row;
    showT = setTimeout(function(){
      if (curSid !== sid) return;
      status(sid).then(function(d){
        if (!d || curSid !== sid || !curRow) return;
        paint(d, curRow);
      });
    }, DWELL);
  }, true);

  document.addEventListener('mouseout', function(ev){
    var t = ev.target;
    if (!t || !t.closest) return;
    if (!t.closest('.session-item[data-sid], .session-child-session[data-sid]')) return;
    if (tip && tip.contains(ev.relatedTarget)) return;
    hide(ev);
  }, true);

  window.addEventListener('scroll', function(){ clearTimeout(showT); if (tip) tip.classList.remove('is-visible'); }, true);
  document.addEventListener('click', function(){ if (tip) tip.classList.remove('is-visible'); }, true);
})();
