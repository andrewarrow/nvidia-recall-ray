(() => {
  "use strict";

  const FIRST_EXAMPLE = "I told Sarah I'd send her the article tonight. And Mike said he'd send me the numbers tomorrow.";
  const FOLLOWUP_EXAMPLE = "Oh, I sent Sarah that article. Mike still hasn't gotten back to me.";
  const state = { version: "0.0.1", mode: "nemotron", conversations: [], loops: [], events: [] };
  let selectedConversationId = null;
  let submitting = false;

  const el = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const formatTime = (seconds, includeDate = false) => {
    const date = new Date(Number(seconds) * 1000);
    if (!Number.isFinite(date.getTime())) return "Time unavailable";
    const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
    if (!includeDate) return time;
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    if (sameDay(date, today)) return `Today · ${time}`;
    if (sameDay(date, yesterday)) return `Yesterday · ${time}`;
    return `${new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date)} · ${time}`;
  };
  const shortDate = (seconds) => {
    const date = new Date(Number(seconds) * 1000);
    if (!Number.isFinite(date.getTime())) return "Time unavailable";
    const today = new Date();
    if (date.toDateString() === today.toDateString()) return "Today";
    const yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
    return new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric" }).format(date);
  };
  const icon = (name) => {
    const paths = {
      clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
      hourglass: '<path d="M6 3h12M6 21h12M7 3c0 5 5 5 5 9s-5 4-5 9m10-18c0 5-5 5-5 9s5 4 5 9"/>',
      check: '<circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/>',
      chat: '<path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H6l-3 2v-9.5A7.5 7.5 0 0 1 10.5 4h2A7.5 7.5 0 0 1 20 11.5Z"/>',
      note: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 12h7M9 16h7"/>',
      spark: '<path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3ZM19 16l.9 2.1L22 19l-2.1.9L19 22l-.9-2.1L16 19l2.1-.9L19 16Z"/>'
    };
    return `<svg class="line-icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.note}</svg>`;
  };
  const conversationById = (id) => state.conversations.find((item) => Number(item.id) === Number(id));
  const loopById = (id) => state.loops.find((item) => Number(item.id) === Number(id));

  function renderSidebar() {
    const query = el("conversation-search").value.trim().toLocaleLowerCase();
    const filtered = state.conversations
      .filter((item) => !query || String(item.transcript || "").toLocaleLowerCase().includes(query))
      .sort((a, b) => Number(b.created_at) - Number(a.created_at));
    el("conversation-total").textContent = `${state.conversations.length} ${state.conversations.length === 1 ? "conversation" : "conversations"}`;
    if (!filtered.length) {
      el("conversation-list").innerHTML = `<p class="sidebar-empty">${query ? "No matching conversations." : "Your saved conversations will appear here."}</p>`;
      return;
    }
    let lastGroup = "";
    el("conversation-list").innerHTML = filtered.map((item) => {
      const group = shortDate(item.created_at);
      const heading = group !== lastGroup ? `<h3 class="date-heading">${esc(group)}</h3>` : "";
      lastGroup = group;
      const active = Number(item.id) === Number(selectedConversationId);
      return `${heading}<button class="conversation-row${active ? " is-active" : ""}" type="button" data-conversation-id="${esc(item.id)}" aria-current="${active ? "page" : "false"}">
        <span class="conversation-icon">${icon("chat")}</span><span class="conversation-time">${esc(formatTime(item.created_at))}</span><span class="row-chevron" aria-hidden="true">›</span>
      </button>`;
    }).join("");
  }

  function renderLoopGroups() {
    const groups = [
      { key: "open", title: "Open", description: "Things you still need to do.", icon: "clock" },
      { key: "waiting", title: "Waiting", description: "Things you're waiting on from others.", icon: "hourglass" },
      { key: "resolved", title: "Resolved", description: "Completed and closed loops.", icon: "check" }
    ];
    el("loop-groups").innerHTML = groups.map((group) => {
      const items = state.loops.filter((loop) => loop.state === group.key).sort((a, b) => Number(b.created_at) - Number(a.created_at));
      const list = items.length ? `<div class="loop-list">${items.map((loop) => `<button type="button" class="loop-row ${esc(group.key)}" data-loop-id="${esc(loop.id)}">
        <span class="loop-row-icon">${icon(group.icon)}</span><span class="loop-row-title">${esc(loop.title)}</span><span class="row-chevron" aria-hidden="true">›</span>
      </button>`).join("")}</div>` : `<p class="group-empty">${group.key === "resolved" ? "Nothing completed yet." : "Nothing here yet."}</p>`;
      return `<section class="loop-group ${esc(group.key)}" aria-label="${esc(group.title)} loops">
        <div class="group-summary"><span class="group-icon">${icon(group.icon)}</span><div class="group-copy"><h3>${esc(group.title)}</h3><p class="group-count">${items.length}</p><p class="group-description">${esc(group.description)}</p></div></div>
        ${list}
      </section>`;
    }).join("");
  }

  function renderEmpty() {
    return `<div class="empty-state">
      <div class="empty-illustration" aria-hidden="true"><span class="orbit orbit-one"></span><span class="orbit orbit-two"></span><span class="orbit orbit-three"></span><span class="chat-illustration"><i></i><i></i><i></i></span></div>
      <h1>Your conversations already<br class="desktop-break"> contain your to-do list.</h1>
      <p class="empty-subtitle">Save a conversation to keep track of what still needs to happen.</p>
      <button class="button button-primary empty-cta" id="empty-add" type="button">Listen or add a conversation</button>
      <div class="feature-list">
        <div class="feature-row"><span class="feature-icon">${icon("note")}</span><div><h3>Find open commitments</h3><p>Surface what you said you'd do, so nothing slips.</p></div></div>
        <div class="feature-row"><span class="feature-icon" aria-hidden="true"><svg class="line-icon" viewBox="0 0 24 24"><circle cx="9" cy="8" r="3"/><path d="M3.5 19v-1.2A4.8 4.8 0 0 1 8.3 13h1.4a4.8 4.8 0 0 1 4.8 4.8V19zM16 5.5a3 3 0 0 1 0 5.8M17 13.2a4.5 4.5 0 0 1 3.5 4.4V19"/></svg></span><div><h3>Track what others owe you</h3><p>Keep visibility on requests, follow-ups, and handoffs.</p></div></div>
        <div class="feature-row"><span class="feature-icon">${icon("clock")}</span><div><h3>Keep context over time</h3><p>See evidence and updates alongside each conversation.</p></div></div>
      </div>
    </div>`;
  }

  function eventPresentation(event) {
    if (event.kind === "updated") return { label: "COMMITMENT UPDATED", state: loopById(event.loop_id)?.state || "open", note: "Updated from new evidence." };
    if (event.kind === "resolved") return { label: "RESOLVED FROM NEW EVIDENCE", state: "resolved", note: "Matched to an earlier commitment." };
    if (event.kind === "kept") { const waiting = loopById(event.loop_id)?.state === "waiting"; return { label: waiting ? "STILL WAITING" : "STILL OPEN", state: waiting ? "waiting" : "open", note: "This loop remains outstanding." }; }
    const loop = loopById(event.loop_id);
    if (loop?.state === "waiting") return { label: "WAITING", state: "waiting", note: "Waiting on another person." };
    return { label: "COMMITMENT ADDED", state: "open", note: "Added from this conversation." };
  }

  function renderTimeline(events) {
    if (!events.length) return "";
    const resolvedLoopIds = new Set(events.filter((event) => event.kind === "resolved").map((event) => Number(event.loop_id)));
    const history = resolvedLoopIds.size
      ? state.events.filter((event) => resolvedLoopIds.has(Number(event.loop_id)))
      : events;
    const ordered = [...new Map(history.map((event) => [Number(event.id), event])).values()].sort((a, b) => Number(a.id) - Number(b.id));
    return `<section class="memory-section" aria-labelledby="memory-heading"><h2 id="memory-heading">${icon("clock")}<span>Memory timeline</span></h2><ol class="memory-timeline">${ordered.map((event) => {
      const loop = loopById(event.loop_id);
      const title = loop ? loop.title : "Commitment";
      const presentation = eventPresentation(event);
      const label = event.kind === "created" ? "Commitment added" : event.kind === "resolved" ? "Marked resolved" : "Follow-up noted";
      return `<li class="memory-event ${esc(presentation.state)}"><span class="memory-mark">${event.kind === "resolved" ? icon("check") : icon("note")}</span><span class="memory-copy"><strong>${esc(label)}</strong><span>${esc(title)}</span><time>${esc(formatTime(event.created_at, true))}</time></span></li>`;
    }).join("")}</ol></section>`;
  }

  function renderConversation(conversation) {
    const events = state.events.filter((event) => Number(event.conversation_id) === Number(conversation.id)).sort((a, b) => Number(a.id) - Number(b.id));
    const relatedLoops = [...new Map(events.map((event) => [Number(event.loop_id), loopById(event.loop_id)]).filter(([, loop]) => loop).map(([id, loop]) => [id, loop])).values()];
    const cards = events.map((event) => {
      const loop = loopById(event.loop_id);
      const presentation = eventPresentation(event);
      const title = loop?.title || "Commitment details unavailable";
      const owner = loop?.owner ? `Owner: ${loop.owner}` : "Owner not specified";
      return `<button class="commitment-card ${esc(presentation.state)}" type="button" data-loop-id="${esc(event.loop_id)}">
        <span class="commitment-symbol">${icon(presentation.state === "resolved" ? "check" : presentation.state === "waiting" ? "hourglass" : "note")}</span>
        <span class="commitment-content"><span class="commitment-status">${esc(presentation.label)}</span><strong>${esc(title)}</strong><span class="commitment-meta">${esc(owner)}</span><span class="evidence">Evidence: “${esc(event.evidence)}”</span><span class="commitment-note">${esc(presentation.note)}</span></span>
        <span class="row-chevron" aria-hidden="true">›</span>
      </button>`;
    }).join("");
    const relatedStatus = relatedLoops.length ? `${relatedLoops.length} ${relatedLoops.length === 1 ? "related loop" : "related loops"}` : "No related loops";
    return `<div class="conversation-detail">
      <div class="conversation-title-row"><div><h1>Current Conversation</h1><p class="conversation-date">Saved ${esc(formatTime(conversation.created_at, true))}</p></div><span class="text-preview-badge"><span class="status-dot"></span>Nemotron · Nebius</span></div>
      <section class="transcript-section" aria-labelledby="transcript-heading"><div class="section-title-row"><h2 id="transcript-heading">Transcript</h2></div><p class="transcript-text">${esc(conversation.transcript)}</p></section>
      <section class="commitments-section" aria-labelledby="commitments-heading"><div class="section-title-row"><h2 id="commitments-heading">${events.some((event) => event.kind === "resolved") ? "State changes detected" : "Detected commitments"}</h2><span class="section-count">${events.length}</span></div>
      ${events.length ? `<div class="commitment-list">${cards}</div>` : `<p class="no-commitments">No new commitments detected.</p>`}
      </section>
      ${renderTimeline(events)}
      <p class="conversation-footnote"><span class="footnote-check" aria-hidden="true">i</span>${esc(relatedStatus)} · Evidence and events are stored with this conversation.</p>
    </div>`;
  }

  function renderPane() {
    const conversation = conversationById(selectedConversationId);
    el("conversation-pane").innerHTML = conversation ? renderConversation(conversation) : renderEmpty();
  }

  function renderAll() {
    renderSidebar();
    renderPane();
    renderLoopGroups();
  }

  function openComposer() {
    if (submitting || transcribing) return;
    closeSidebar();
    el("record-status").textContent = recordedBlob ? "Recording ready for retry." : "Microphone audio is transcribed locally.";
    el("composer-error").hidden = true;
    el("composer-error").textContent = "";
    el("composer-dialog").showModal();
    requestAnimationFrame(() => el("transcript-input").focus());
  }

  function openLoop(loopId) {
    const loop = loopById(loopId);
    if (!loop) return;
    const events = state.events.filter((event) => Number(event.loop_id) === Number(loop.id)).sort((a, b) => Number(a.id) - Number(b.id));
    const status = loop.state === "resolved" ? "Resolved" : loop.state === "waiting" ? "Waiting" : "Open";
    const conversation = conversationById(loop.conversation_id);
    const latestEvent = events[events.length - 1];
    el("loop-detail-content").innerHTML = `<div class="dialog-heading"><div><p class="dialog-kicker">${esc(status.toUpperCase())} LOOP</p><h2 id="loop-dialog-title">${esc(loop.title)}</h2></div><button class="icon-button dialog-close" type="button" data-close-dialog aria-label="Close dialog">×</button></div>
      <div class="loop-detail-meta"><span>Owner</span><strong>${esc(loop.owner || "Not specified")}</strong><span>Added</span><strong>${esc(formatTime(loop.created_at, true))}</strong>${loop.resolved_at ? `<span>Resolved</span><strong>${esc(formatTime(loop.resolved_at, true))}</strong>` : ""}</div>
      <section class="loop-evidence"><h3>Evidence</h3><blockquote>“${esc(latestEvent?.evidence || loop.evidence || "No evidence text available.") }”</blockquote></section>
      ${conversation ? `<p class="loop-source">From conversation saved ${esc(formatTime(conversation.created_at, true))}</p>` : ""}
      ${events.length ? `<section class="loop-history"><h3>Events</h3><ol>${events.map((event) => `<li><span class="history-dot ${esc(event.kind)}"></span><span><strong>${event.kind === "created" ? "Added" : event.kind === "resolved" ? "Resolved" : "Follow-up noted"}</strong><time>${esc(formatTime(event.created_at, true))}</time><span class="history-evidence">“${esc(event.evidence)}”</span></span></li>`).join("")}</ol></section>` : ""}
      <section id="help-result" class="help-result" aria-live="polite"></section>
      <div class="dialog-actions">${loop.state === "open" ? `<button class="button button-secondary" id="help-finish" type="button">Help me finish</button>` : ""}<button class="button button-primary" type="button" data-close-dialog>Done</button></div>`;
    el("loop-dialog").showModal();
    el("help-finish")?.addEventListener("click", () => helpFinish(loop.id));
    fetch(`/api/loops/${loop.id}/help`).then(response => response.json()).then(runs => {
      if (Array.isArray(runs) && runs.length && el("loop-dialog").open && el("loop-dialog-title").textContent === loop.title) renderHelp(runs[0]);
    }).catch(() => {});
  }

  async function loadState() {
    try {
      const response = await fetch("/api/state", { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error("Your local workspace couldn't be loaded. Refresh to try again.");
      const data = await response.json();
      Object.assign(state, data, { conversations: Array.isArray(data.conversations) ? data.conversations : [], loops: Array.isArray(data.loops) ? data.loops : [], events: Array.isArray(data.events) ? data.events : [] });
      if (state.conversations.length) {
        const mostRecent = [...state.conversations].sort((a, b) => Number(b.created_at) - Number(a.created_at))[0];
        selectedConversationId = Number(mostRecent.id);
      }
      renderAll();
    } catch (error) {
      el("conversation-pane").innerHTML = `<div class="load-error"><span class="error-mark">!</span><h1>Workspace unavailable</h1><p>${esc(error.message || "Check that RecallRay is running, then refresh the page.")}</p><button class="button button-secondary" id="retry-load" type="button">Try again</button></div>`;
      el("conversation-list").innerHTML = '<p class="sidebar-empty">Conversations are unavailable.</p>';
      el("loop-groups").innerHTML = '<p class="sidebar-empty">Loop data is unavailable.</p>';
      el("retry-load")?.addEventListener("click", loadState);
    }
  }

  async function saveConversation(event) {
    event.preventDefault();
    if (submitting || recorder?.state === "recording" || transcribing) return;
    const input = el("transcript-input");
    const transcript = input.value.trim();
    const errorNode = el("composer-error");
    if (!transcript) {
      errorNode.textContent = "Add some conversation text before saving.";
      errorNode.hidden = false;
      input.focus();
      return;
    }
    submitting = true;
    const button = el("save-conversation");
    button.disabled = true;
    input.disabled = true;
    document.querySelectorAll("[data-example]").forEach(button => { button.disabled = true; });
    el("record-toggle").disabled = true;
    button.innerHTML = '<span class="button-spinner" aria-hidden="true"></span>Reasoning with Nemotron…';
    errorNode.hidden = true;
    try {
      const response = await fetch("/api/conversations", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ transcript }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "We couldn't save this conversation. Please try again.");
      Object.assign(state, data, { conversations: Array.isArray(data.conversations) ? data.conversations : [], loops: Array.isArray(data.loops) ? data.loops : [], events: Array.isArray(data.events) ? data.events : [] });
      selectedConversationId = Number(data.conversation_id);
      input.value = "";
      el("character-count").textContent = "0";
      el("composer-dialog").close();
      renderAll();
      closeSidebar();
    } catch (error) {
      errorNode.textContent = error.message || "We couldn't save this conversation. Please try again.";
      errorNode.hidden = false;
      input.focus();
    } finally {
      submitting = false;
      button.disabled = false;
      input.disabled = false;
      document.querySelectorAll("[data-example]").forEach(button => { button.disabled = false; });
      el("record-toggle").disabled = false;
      button.textContent = "Find commitments";
    }
  }


  let recorder = null;
  let stream = null;
  let transcribing = false;
  let recordedBlob = null;
  let recordingTimer = null;
  let recordingCancelled = false;

  function recordError(message) {
    el("composer-error").textContent = message;
    el("composer-error").hidden = false;
  }
  function releaseMicrophone() {
    clearTimeout(recordingTimer);
    stream?.getTracks().forEach(track => track.stop());
    stream = null;
    el("record-toggle").textContent = "Listen";
    el("record-toggle").classList.remove("is-recording");
  }
  async function transcribeRecording() {
    if (!recordedBlob || transcribing) return;
    transcribing = true;
    el("record-toggle").disabled = true;
    el("save-conversation").disabled = true;
    el("transcript-input").disabled = true;
    document.querySelectorAll("[data-example]").forEach(button => { button.disabled = true; });
    el("record-retry").hidden = true;
    el("record-status").textContent = "Transcribing locally with Whisper…";
    el("composer-error").hidden = true;
    try {
      const response = await fetch("/api/recordings", {method: "POST", headers: {"Content-Type": recordedBlob.type || "application/octet-stream"}, body: recordedBlob});
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Transcription failed. Try again.");
      el("transcript-input").value = [el("transcript-input").value.trim(), data.transcript].filter(Boolean).join("\n");
      el("character-count").textContent = el("transcript-input").value.length;
      el("record-status").textContent = "Transcript ready. Review it, then find commitments.";
      recordedBlob = null;
    } catch (error) {
      recordError(error.message);
      el("record-status").textContent = "Recording kept in this browser for retry.";
      el("record-retry").hidden = false;
    } finally {
      transcribing = false;
      el("record-toggle").disabled = false;
      el("save-conversation").disabled = false;
      el("transcript-input").disabled = false;
      document.querySelectorAll("[data-example]").forEach(button => { button.disabled = false; });
    }
  }
  async function toggleRecording() {
    if (recorder?.state === "recording") { recorder.stop(); releaseMicrophone(); return; }
    if (submitting || transcribing || el("record-toggle").disabled) return;
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { recordError("This browser does not support microphone recording. You can paste text instead."); return; }
    el("record-toggle").disabled = true;
    el("composer-error").hidden = true;
    el("record-status").textContent = "Requesting microphone…";
    try {
      stream = await navigator.mediaDevices.getUserMedia({audio: true});
      if (!el("composer-dialog").open) { releaseMicrophone(); return; }
      const type = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find(t => MediaRecorder.isTypeSupported(t));
      recorder = new MediaRecorder(stream, type ? {mimeType: type} : {});
      const chunks = [];
      recordingCancelled = false;
      recorder.addEventListener("dataavailable", event => { if (event.data.size) chunks.push(event.data); });
      recorder.addEventListener("stop", () => {
        releaseMicrophone();
        el("save-conversation").disabled = false;
        if (recordingCancelled) return;
        recordedBlob = new Blob(chunks, {type: recorder.mimeType});
        transcribeRecording();
      }, {once: true});
      recorder.addEventListener("error", () => { recordingCancelled = true; releaseMicrophone(); el("save-conversation").disabled = false; recordError("Recording failed. Please try again."); });
      recorder.start();
      el("record-toggle").textContent = "Stop listening";
      el("record-toggle").classList.add("is-recording");
      el("save-conversation").disabled = true;
      el("record-status").textContent = "Listening… Stop when you're done (up to 2 minutes).";
      recordingTimer = setTimeout(() => { if (recorder?.state === "recording") { recorder.stop(); releaseMicrophone(); } }, 120000);
    } catch (error) {
      releaseMicrophone();
      recordError(error.name === "NotAllowedError" ? "Allow microphone access in your browser, or paste conversation text." : "The microphone could not be opened. Check your input device.");
      el("record-status").textContent = "Microphone unavailable.";
    } finally { el("record-toggle").disabled = false; }
  }
  el("listen-start").addEventListener("click", () => { openComposer(); toggleRecording(); });
  el("record-toggle").addEventListener("click", toggleRecording);
  el("record-retry").addEventListener("click", transcribeRecording);
  el("composer-dialog").addEventListener("close", () => {
    recordingCancelled = true;
    if (recorder?.state === "recording") recorder.stop();
    releaseMicrophone();
  });
  window.addEventListener("pagehide", releaseMicrophone);

  function renderHelp(data) {
    const node = el("help-result");
    if (!node) return;
    const sources = Array.isArray(data.results) ? data.results.filter(item => /^https?:\/\//i.test(item.url)) : [];
    node.innerHTML = `<h3>${data.needs_search ? "Current information → Tavily search" : "Ready-to-send draft"}</h3>${data.query ? `<p>${esc(data.query)}</p>` : ""}<p class="help-draft">${esc(data.draft)}</p>${sources.length ? `<ul>${sources.map(item => `<li><a href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">${esc(item.title || item.url)}</a></li>`).join("")}</ul>` : ""}<p>Draft only. Your commitment stays open until conversation confirms it is done.</p>`;
  }
  async function helpFinish(id) {
    const button = el("help-finish");
    const node = el("help-result");
    button.disabled = true;
    button.textContent = "Helping…";
    node.innerHTML = '<p role="status">Nemotron is deciding whether current information is needed…</p>';
    try {
      const response = await fetch(`/api/loops/${id}/help`, {method: "POST"});
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Assistance failed. Try again.");
      if (el("help-result") === node) renderHelp(data);
    } catch (error) {
      node.innerHTML = `<p class="form-error" role="alert">${esc(error.message)}</p>`;
    } finally { button.disabled = false; button.textContent = "Help me finish"; }
  }

  function closeSidebar() {
    document.body.classList.remove("sidebar-open");
    el("sidebar-toggle").setAttribute("aria-expanded", "false");
    syncSidebarAccessibility();
    if (window.matchMedia("(max-width: 800px)").matches) el("sidebar-toggle").focus();
  }

  function syncSidebarAccessibility() {
    const mobile = window.matchMedia("(max-width: 800px)").matches;
    const open = mobile && document.body.classList.contains("sidebar-open");
    el("sidebar").inert = mobile && !open;
    el("sidebar").setAttribute("aria-hidden", String(mobile && !open));
    el("sidebar-scrim").inert = !open;
    el("sidebar-scrim").setAttribute("aria-hidden", String(!open));
    if (!mobile) {
      document.body.classList.remove("sidebar-open");
      el("sidebar-toggle").setAttribute("aria-expanded", "false");
    }
  }

  el("conversation-add").addEventListener("click", openComposer);
  el("conversation-pane").addEventListener("click", (event) => {
    if (event.target.closest("#empty-add")) openComposer();
    const loopButton = event.target.closest("[data-loop-id]");
    if (loopButton) openLoop(loopButton.dataset.loopId);
  });
  el("conversation-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-conversation-id]");
    if (!button) return;
    selectedConversationId = Number(button.dataset.conversationId);
    renderAll();
    closeSidebar();
  });
  el("loop-groups").addEventListener("click", (event) => {
    const button = event.target.closest("[data-loop-id]");
    if (button) openLoop(button.dataset.loopId);
  });
  el("settings-open").addEventListener("click", () => el("settings-dialog").showModal());
  el("composer-form").addEventListener("submit", saveConversation);
  el("transcript-input").addEventListener("input", () => { el("character-count").textContent = el("transcript-input").value.length.toLocaleString(); });
  document.querySelectorAll("[data-example]").forEach((button) => button.addEventListener("click", () => {
    el("transcript-input").value = button.dataset.example === "first" ? FIRST_EXAMPLE : FOLLOWUP_EXAMPLE;
    el("transcript-input").dispatchEvent(new Event("input", { bubbles: true }));
    el("composer-error").hidden = true;
    el("transcript-input").focus();
  }));
  document.addEventListener("click", (event) => {
    const closeButton = event.target.closest("[data-close-dialog]");
    if (closeButton) closeButton.closest("dialog")?.close();
  });
  document.querySelectorAll("dialog").forEach((dialog) => dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); }));
  el("search-toggle").addEventListener("click", () => {
    const wrap = el("search-wrap");
    const opening = wrap.hidden;
    wrap.hidden = !opening;
    el("search-toggle").setAttribute("aria-expanded", String(opening));
    if (opening) el("conversation-search").focus();
    else { el("conversation-search").value = ""; renderSidebar(); }
  });
  el("conversation-search").addEventListener("input", renderSidebar);
  el("search-clear").addEventListener("click", () => { el("conversation-search").value = ""; renderSidebar(); el("conversation-search").focus(); });
  el("sidebar-toggle").addEventListener("click", () => {
    const opening = !document.body.classList.contains("sidebar-open");
    document.body.classList.toggle("sidebar-open", opening);
    el("sidebar-toggle").setAttribute("aria-expanded", String(opening));
    syncSidebarAccessibility();
    if (opening) el("search-toggle").focus();
  });
  el("sidebar-scrim").addEventListener("click", closeSidebar);
  document.querySelector(".brand").addEventListener("click", (event) => {
    event.preventDefault();
    selectedConversationId = null;
    renderAll();
    closeSidebar();
    history.replaceState(null, "", "#home");
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && document.body.classList.contains("sidebar-open")) closeSidebar();
  });
  window.matchMedia("(max-width: 800px)").addEventListener("change", syncSidebarAccessibility);
  syncSidebarAccessibility();
  loadState();
})();
