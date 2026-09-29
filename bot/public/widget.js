(function () {
  "use strict";
  if (window.__chatWidgetLoaded) return;
  window.__chatWidgetLoaded = true;

  var script = document.currentScript;
  var BASE = script && script.src ? new URL(script.src).origin : window.location.origin;
  var TITLE = (script && script.getAttribute("data-title")) || "Chat with us";
  var GREETING =
    (script && script.getAttribute("data-greeting")) ||
    "Hi! Ask me anything — we usually reply instantly.";

  var sid = sessionStorage.getItem("chatWidgetSid");
  if (!sid) {
    sid =
      window.crypto && crypto.randomUUID
        ? crypto.randomUUID().replace(/-/g, "")
        : "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
    sessionStorage.setItem("chatWidgetSid", sid);
  }

  var style = document.createElement("style");
  style.textContent = [
    ":host{all:initial}",
    "*{box-sizing:border-box;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}",
    ".fab{position:fixed;right:20px;bottom:calc(20px + env(safe-area-inset-bottom,0px));width:56px;height:56px;",
    "border-radius:50%;border:0;cursor:pointer;background:linear-gradient(135deg,#4f6ef7,#7c5cf0);color:#fff;",
    "box-shadow:0 8px 24px rgba(15,18,32,.35);z-index:2147483000;display:flex;align-items:center;",
    "justify-content:center;transition:transform .15s ease,opacity .15s ease}",
    ".fab:hover{transform:scale(1.06)}",
    ".fab svg{width:26px;height:26px;fill:currentColor}",
    ".panel{position:fixed;right:20px;bottom:calc(88px + env(safe-area-inset-bottom,0px));",
    "width:min(380px,calc(100vw - 32px));height:min(560px,calc(100vh - 130px));",
    "height:min(560px,calc(100dvh - 130px));background:#12152b;",
    "border:1px solid #2a2f4d;border-radius:18px;box-shadow:0 24px 70px rgba(0,0,0,.5);",
    "z-index:2147483001;display:none;flex-direction:column;overflow:hidden;color:#e8eaf6;",
    "opacity:0;transform:translateY(8px);transition:opacity .18s ease,transform .18s ease}",
    ".panel.open{display:flex;opacity:1;transform:translateY(0)}",
    ".head{padding:14px 16px;background:linear-gradient(135deg,#4f6ef7,#7c5cf0);display:flex;",
    "align-items:center;justify-content:space-between;gap:8px}",
    ".head b{font-size:15px;font-weight:600}",
    ".head small{display:block;font-weight:400;opacity:.88;font-size:11.5px}",
    ".close{background:rgba(255,255,255,.18);border:0;color:#fff;width:30px;height:30px;border-radius:50%;",
    "cursor:pointer;font-size:18px;line-height:1}",
    ".log{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:9px;",
    "-webkit-overflow-scrolling:touch}",
    ".m{max-width:86%;padding:9px 13px;border-radius:14px;font-size:14.5px;line-height:1.45;",
    "white-space:pre-wrap;overflow-wrap:break-word}",
    ".u{align-self:flex-end;background:#4f6ef7;color:#fff;border-bottom-right-radius:4px}",
    ".b{align-self:flex-start;background:#232846;border-bottom-left-radius:4px}",
    ".b a{color:#8fa8ff;word-break:break-all}",
    ".sys{align-self:center;background:transparent;color:#e06a6a;font-size:12.5px;text-align:center}",
    ".typing{align-self:flex-start;color:#8b90b8;font-size:13px;padding:4px 10px}",
    ".typing i{animation:pp 1.2s infinite;display:inline-block;font-style:normal;opacity:.3}",
    ".typing i:nth-child(2){animation-delay:.2s}",
    ".typing i:nth-child(3){animation-delay:.4s}",
    "@keyframes pp{0%,60%,100%{opacity:.3}30%{opacity:1}}",
    "form{display:flex;gap:8px;padding:10px;border-top:1px solid #2a2f4d;background:#151833}",
    "input{flex:1;min-width:0;background:#1d2140;border:1px solid #333a63;border-radius:10px;color:#e8eaf6;",
    "padding:11px 13px;font-size:16px;outline:none}",
    "input:focus{border-color:#4f6ef7}",
    "button.send{background:#4f6ef7;border:0;color:#fff;border-radius:10px;width:44px;height:44px;",
    "cursor:pointer;display:flex;align-items:center;justify-content:center;flex:0 0 auto}",
    "button.send:disabled{opacity:.45;cursor:default}",
    "button.send svg{width:18px;height:18px;fill:currentColor}",
    "@media (max-width:480px){",
    ".panel{right:8px;left:8px;width:auto;bottom:calc(76px + env(safe-area-inset-bottom,0px));",
    "height:min(70dvh,560px)}",
    ".fab{right:16px;bottom:calc(16px + env(safe-area-inset-bottom,0px))}}",
  ].join("");

  var host = document.createElement("div");
  host.setAttribute("data-chat-widget", "");
  var root = host.attachShadow({ mode: "open" });
  root.appendChild(style);

  var fab = document.createElement("button");
  fab.className = "fab";
  fab.type = "button";
  fab.setAttribute("aria-label", "Open chat");
  fab.innerHTML =
    '<svg viewBox="0 0 24 24"><path d="M12 3C6.99 3 3 6.58 3 11c0 2.4 1.2 4.53 3.1 5.96-.1.84-.42 2-1.22 3.04-.16.2 0 .5.26.46 1.86-.28 3.24-1 4.1-1.66.87.2 1.79.3 2.76.3 5.01 0 9-3.58 9-8s-3.99-8-9-8z"/></svg>';

  var panel = document.createElement("div");
  panel.className = "panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", TITLE + " chat");
  panel.innerHTML =
    '<div class="head"><div><b></b><small>We usually reply instantly</small></div>' +
    '<button class="close" type="button" aria-label="Close chat">&times;</button></div>' +
    '<div class="log" role="log"></div>' +
    '<form><input maxlength="4000" placeholder="Type a message..." aria-label="Message" autocomplete="off">' +
    '<button class="send" type="submit" aria-label="Send">' +
    '<svg viewBox="0 0 24 24"><path d="M2.01 21 23 12 2.01 3 2 10l15 2-15 2z"/></svg></button></form>';

  root.appendChild(fab);
  root.appendChild(panel);
  panel.querySelector("b").textContent = TITLE;

  var log = panel.querySelector(".log");
  var form = panel.querySelector("form");
  var input = panel.querySelector("input");
  var sendBtn = panel.querySelector("button.send");
  var typingEl = null;
  var waiting = false;

  function linkify(el, text) {
    var parts = text.split(/(https?:\/\/[^\s]+)/g);
    for (var i = 0; i < parts.length; i++) {
      if (/^https?:\/\//.test(parts[i])) {
        var a = document.createElement("a");
        a.href = parts[i];
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = parts[i];
        el.appendChild(a);
      } else if (parts[i]) {
        el.appendChild(document.createTextNode(parts[i]));
      }
    }
  }

  function add(text, who) {
    var d = document.createElement("div");
    d.className = "m " + (who === "u" ? "u" : "b");
    if (who === "u") d.textContent = text;
    else linkify(d, text);
    log.appendChild(d);
    log.scrollTop = log.scrollHeight;
    return d;
  }

  function system(text) {
    var d = document.createElement("div");
    d.className = "m sys";
    d.textContent = text;
    log.appendChild(d);
    log.scrollTop = log.scrollHeight;
  }

  function showTyping() {
    if (typingEl) return;
    typingEl = document.createElement("div");
    typingEl.className = "typing";
    typingEl.innerHTML = "typing<i>.</i><i>.</i><i>.</i>";
    log.appendChild(typingEl);
    log.scrollTop = log.scrollHeight;
  }

  function hideTyping() {
    if (typingEl) {
      typingEl.remove();
      typingEl = null;
    }
  }

  add(GREETING, "b");

  function setOpen(open) {
    panel.classList.toggle("open", open);
    fab.setAttribute("aria-label", open ? "Close chat" : "Open chat");
    if (open) setTimeout(function () { input.focus(); }, 60);
  }

  fab.addEventListener("click", function () {
    setOpen(!panel.classList.contains("open"));
  });
  panel.querySelector(".close").addEventListener("click", function () { setOpen(false); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && panel.classList.contains("open")) setOpen(false);
  });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var msg = input.value.trim();
    if (!msg || waiting) return;

    add(msg, "u");
    input.value = "";
    waiting = true;
    sendBtn.disabled = true;
    showTyping();

    fetch(BASE + "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: sid, message: msg }),
    })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (d) {
          return { ok: r.ok, data: d };
        });
      })
      .then(function (res) {
        hideTyping();
        if (res.data && res.data.reply) add(res.data.reply, "b");
        else system(res.data && res.data.error ? res.data.error : "Sorry, something went wrong.");
      })
      .catch(function () {
        hideTyping();
        system("Connection problem. Please try again.");
      })
      .then(function () {
        waiting = false;
        sendBtn.disabled = false;
        input.focus();
      });
  });

  function mount() {
    (document.body || document.documentElement).appendChild(host);
  }
  if (document.body) mount();
  else document.addEventListener("DOMContentLoaded", mount);
})();
