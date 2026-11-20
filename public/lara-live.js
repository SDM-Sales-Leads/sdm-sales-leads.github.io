/* Lara video call — Gemini Live voice + Lara's video clips (20 Nov 2026, docs/LARA-AVATAR-PLAN.md).
   Voice: the browser talks to Gemini Live with a one-use, locked token from our server (the Google key never comes here).
   Face: 9 pre-made clips of Lara (public/lara/*.mp4, ~0.6 MB), cross-faded live: talking while her voice plays (louder = a livelier
   clip), listening while the customer speaks, thinking while a tool runs, idle otherwise. Lips follow her voice, not word-perfect.
   Cost guards: max call length (server token expires too), 20 s silence -> "are you still there?", 12 s more -> end, tab hidden -> end. */
(function () {
  "use strict";
  var CLIPS = ["idle", "listen", "talk1", "talk2"];   // 21 Nov 2026: talk1/2 = Gemini Pro videos of Lara, idle/listen = same portrait
  var cache = {}, loading = null;
  function preload(base) {
    if (loading) return loading;
    loading = Promise.all(CLIPS.map(function (n) {
      // warm the browser cache only: the <video> plays the normal web address (Safari plays blob: video late or not at all — 20 Nov 2026 test)
      cache[n] = base + n + ".mp4";
      return fetch(base + n + ".mp4").then(function (r) { return r.ok ? r.blob() : null; }).catch(function () {});
    }));
    return loading;
  }

  // ---- the face: two <video> layers, cross-fade --------------------------------------------------------------------------------
  function Face(box, base) {
    var wrap = document.createElement("div"); wrap.className = "lv";
    var poster = document.createElement("img"); poster.className = "lvp"; poster.src = base + "poster.jpg"; poster.alt = "";
    var v = [0, 1].map(function () { var x = document.createElement("video"); x.muted = true; x.playsInline = true; x.setAttribute("playsinline", ""); x.setAttribute("muted", ""); x.loop = true; x.preload = "auto"; x.style.opacity = "0"; wrap.appendChild(x); return x; });
    wrap.insertBefore(poster, v[0]);
    box.appendChild(wrap);
    var cur = -1, clip = "", since = 0;
    function show(name, opt) {
      opt = opt || {};
      if (name === clip && !opt.force) return;
      var nx = cur === 0 ? 1 : 0, el = v[nx], src = cache[name] || (base + name + ".mp4");
      clip = name; since = Date.now();
      (window.__laraClips = window.__laraClips || []).push([since, name]);   // for tests: how often her clip changes
      el.loop = !opt.once;
      var shown = false, me = clip;
      var fade = function () {
        if (shown || clip !== me) return; shown = true;
        el.style.opacity = "1"; if (cur >= 0 && cur !== nx) v[cur].style.opacity = "0";
        var old = cur; cur = nx; setTimeout(function () { if (old >= 0 && old !== cur) try { v[old].pause(); } catch (e) {} }, 300);
        poster.style.opacity = "0";
      };
      var seek = function () { try { if (opt.start) el.currentTime = 0; else if (!el.__seen) el.currentTime = Math.random() * Math.max(0, (el.duration || 2) - 1.2); el.__seen = true; } catch (e) {} };
      el.playbackRate = 1; el.defaultPlaybackRate = 1;   // Gemini clips move naturally at real speed
      el.onplaying = fade;
      if (el.getAttribute("src") !== src) { el.__seen = false; el.onloadedmetadata = function () { el.onloadedmetadata = null; seek(); }; el.src = src; } else seek();
      // play at once (hidden); show it the moment frames really play — Safari only loads a video once play() is called
      var p = el.play(); if (p && p.then) p.then(function () { if (el.readyState >= 2) fade(); }).catch(function () {});
    }
    return { show: show, clip: function () { return clip; }, age: function () { return Date.now() - since; }, remove: function () { wrap.remove(); } };
  }

  // ---- microphone -> 16 kHz PCM (AudioWorklet) ---------------------------------------------------------------------------------
  var WORKLET = "class P extends AudioWorkletProcessor{constructor(){super();this.r=sampleRate/16000;this.b=[];this.acc=0;}" +
    "process(i){var c=i[0]&&i[0][0];if(!c)return true;var s=0;for(var k=0;k<c.length;k++)s+=c[k]*c[k];this.port.postMessage({lvl:Math.sqrt(s/c.length)});" +
    "for(var j=0;j<c.length;j++){this.acc+=1;if(this.acc>=this.r){this.acc-=this.r;var x=Math.max(-1,Math.min(1,c[j]));this.b.push(x<0?x*32768:x*32767);}}" +
    "if(this.b.length>=1600){this.port.postMessage({pcm:Int16Array.from(this.b.splice(0,1600))});}return true;}}registerProcessor('lara-mic',P);";
  function b64(int16) { var u = new Uint8Array(int16.buffer), s = ""; for (var i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); }
  function pcm24(b) { var bin = atob(b), n = bin.length >> 1, f = new Float32Array(n); for (var i = 0; i < n; i++) { var x = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8); if (x >= 32768) x -= 65536; f[i] = x / 32768; } return f; }

  /* start(o): o = { api, key, lang ('ar'|'en'), stage (element), base ('lara/'), maxSec, onLine(dir, text, final), onState(s), onNote(t), onEnd(reason) } */
  function start(o) {
    var C = { lang: o.lang, ended: false, muted: false, t0: Date.now(), toolBusy: 0, outUntil: 0, micAt: Date.now(), lvlOut: 0, warned: false, asked: false, lines: { in: "", out: "" } };
    var face = Face(o.stage, o.base);
    var ctx, ws, node, stream, gain, an, nextT = 0, srcs = [], timer = null, raf = null;
    function post(p, b) { return fetch(o.api + "/chat/s/" + o.key + "/live/" + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b || {}) }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || ("Error " + r.status)); return j; }); }); }
    function state(s) { if (o.onState) o.onState(s); }
    function flush(dir) { var t = C.lines[dir].trim(); C.lines[dir] = ""; if (!t) return; if (o.onLine) o.onLine(dir, t, true); post("say", { dir: dir, text: t }).catch(function () {}); }
    function stopAudio() { srcs.forEach(function (s) { try { s.stop(); } catch (e) {} }); srcs = []; nextT = 0; C.outUntil = 0; }
    function play(b) {
      if (!ctx) return;
      var f = pcm24(b), buf = ctx.createBuffer(1, f.length, 24000); buf.copyToChannel ? buf.copyToChannel(f, 0) : buf.getChannelData(0).set(f);
      var s = ctx.createBufferSource(); s.buffer = buf; s.connect(gain);
      var at = Math.max(ctx.currentTime + 0.04, nextT); s.start(at); nextT = at + buf.duration; srcs.push(s);
      s.onended = function () { srcs = srcs.filter(function (x) { return x !== s; }); };
      C.outUntil = Date.now() + (nextT - ctx.currentTime) * 1000;
    }
    function send(m) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); }
    function end(reason) {
      if (C.ended) return; C.ended = true;
      flush("in"); flush("out");
      clearInterval(timer); cancelAnimationFrame(raf);
      try { ws && ws.close(); } catch (e) {}
      try { stream && stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
      face.show("idle", { force: true });
      setTimeout(function () { try { ctx && ctx.close(); } catch (e) {} face.remove(); }, 2600);
      post("end", {}).catch(function () {});
      if (o.onEnd) o.onEnd(reason || "end");
    }

    // the face follows the sound (10 times a second)
    function tick() {
      if (C.ended) return;
      var now = Date.now();
      // Lara "speaks" for as long as her audio is queued (+0.6 s), not while the sound level is high: pauses between words never break it
      var speaking = now < C.outUntil + 600;
      // the customer "speaks" only after half a second of voice, and never while Lara speaks (her own voice / echo does not count)
      if (!speaking && now - C.micAt < 400) { if (!C.custFrom) C.custFrom = now; } else if (now - C.micAt > 900) C.custFrom = 0;
      var custom = !speaking && C.custFrom && now - C.custFrom > 500;
      var cur = face.clip(), want;
      if (speaking) want = /^talk/.test(cur) ? cur : (Math.random() < 0.5 ? "talk1" : "talk2");
      else if (custom) want = "listen";
      else want = "idle";   // also while a tool runs: calm, no cartoon "thinking"
      if (/^talk/.test(want) && /^talk/.test(cur)) {
        if (face.age() > 9000) face.show(cur === "talk1" ? "talk2" : "talk1", { force: true });
      } else if (want !== cur) {
        // start talking at once; any other change only after 1.5 s in the current clip (no flicker)
        if (/^talk/.test(want) || face.age() > 1500) face.show(want);
      }
      state(speaking ? "speaking" : C.toolBusy ? "thinking" : custom ? "listening" : "idle");
      // cost guards
      var secs = (now - C.t0) / 1000;
      if (!C.warned && secs > o.maxSec - 30) { C.warned = true; send({ realtimeInput: { text: "(System: 30 seconds left in this call. Wrap up politely and offer that the account manager follows up.)" } }); }
      if (secs > o.maxSec) return end("max");
      var quiet = now - Math.max(C.micAt, C.outUntil);
      if (!C.asked && quiet > 20000 && !C.toolBusy) { C.asked = true; C.askedAt = now; send({ realtimeInput: { text: "(System: the customer has been silent for 20 seconds. Ask briefly if they are still there.)" } }); }
      if (C.asked && now - C.askedAt > 12000 && now - C.micAt > 12000 && now > C.outUntil + 2000) return end("silence");
      if (now - C.micAt < 1500) C.asked = false;
    }
    function meter() { if (C.ended) return; if (an) { var d = new Float32Array(an.fftSize); an.getFloatTimeDomainData(d); var s = 0; for (var i = 0; i < d.length; i++) s += d[i] * d[i]; C.lvlOut = Math.sqrt(s / d.length); if (o.onLevel) o.onLevel(C.lvlOut); } raf = requestAnimationFrame(meter); }

    function onMsg(m) {
      if (m.setupComplete) {
        send({ realtimeInput: { text: o.lang === "ar" ? "(System: the call is connected. Greet the customer now.)" : "(System: the call is connected. Greet the customer now.)" } });
        return;
      }
      if (m.toolCall && m.toolCall.functionCalls) {
        m.toolCall.functionCalls.forEach(function (fc) {
          if (fc.name === "end_call") { send({ toolResponse: { functionResponses: [{ id: fc.id, name: fc.name, response: { result: "OK" } }] } }); setTimeout(function () { var wait = Math.max(0, C.outUntil - Date.now()); setTimeout(function () { end("bye"); }, wait + 600); }, 1500); return; }
          C.toolBusy++;
          post("tool", { name: fc.name, args: fc.args || {}, lang: C.lang }).then(function (r) { return r.result; }).catch(function () { return "NO_ANSWER"; }).then(function (res) {
            C.toolBusy = Math.max(0, C.toolBusy - 1);
            send({ toolResponse: { functionResponses: [{ id: fc.id, name: fc.name, response: { result: res } }] } });
          });
        });
      }
      var sc = m.serverContent;
      if (!sc) { if (m.goAway) end("time"); return; }
      if (sc.interrupted) { stopAudio(); flush("out"); }
      if (sc.modelTurn && sc.modelTurn.parts) sc.modelTurn.parts.forEach(function (p) { if (p.inlineData && p.inlineData.data) play(p.inlineData.data); });
      if (sc.inputTranscription && sc.inputTranscription.text) { if (C.lines.out) flush("out"); C.lines.in += sc.inputTranscription.text; if (/[a-z]{3,}/i.test(C.lines.in) || /[\u0600-\u06FF]/.test(C.lines.in)) C.lang = /[\u0600-\u06FF]/.test(C.lines.in) ? "ar" : "en"; if (o.onLine) o.onLine("in", C.lines.in, false); }
      if (sc.outputTranscription && sc.outputTranscription.text) { if (C.lines.in) flush("in"); C.lines.out += sc.outputTranscription.text; if (o.onLine) o.onLine("out", C.lines.out, false); }
      if (sc.turnComplete) { flush("in"); flush("out"); }
    }

    var ready = preload(o.base).then(function () { face.show("idle", { force: true }); });
    var go = post("start", { lang: o.lang }).then(function (t) {
      o.maxSec = Number(t.maxSec) || o.maxSec || 300;
      var AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      gain = ctx.createGain(); an = ctx.createAnalyser(); an.fftSize = 1024; gain.connect(an); an.connect(ctx.destination);
      return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } }).then(function (st) {
        stream = st;
        var url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
        return ctx.audioWorklet.addModule(url).then(function () {
          node = new AudioWorkletNode(ctx, "lara-mic");
          ctx.createMediaStreamSource(st).connect(node);
          node.port.onmessage = function (e) {
            if (C.ended) return;
            if (e.data.lvl !== undefined) { if (!C.muted && e.data.lvl > 0.03) C.micAt = Date.now(); return; }
            if (e.data.pcm && !C.muted) send({ realtimeInput: { audio: { data: b64(e.data.pcm), mimeType: "audio/pcm;rate=16000" } } });
          };
          ws = new WebSocket(t.ws + "?access_token=" + encodeURIComponent(t.token));
          ws.onopen = function () { send({ setup: { model: "models/" + t.model } }); };
          ws.onmessage = function (ev) { (typeof ev.data === "string" ? Promise.resolve(ev.data) : ev.data.text()).then(function (s) { try { onMsg(JSON.parse(s)); } catch (e) {} }); };
          ws.onclose = function () { if (!C.ended) end("closed"); };
          ws.onerror = function () { if (o.onNote) o.onNote("connection"); };
          timer = setInterval(tick, 100); meter();
          if (ctx.state === "suspended") ctx.resume();
        });
      });
    });
    var api = {
      ready: Promise.all([ready, go]),
      end: function () { end("user"); },
      mute: function (on) { C.muted = !!on; },
      muted: function () { return C.muted; },
    };
    api.ready.catch(function (e) { if (!C.ended) { C.ended = true; face.remove(); try { stream && stream.getTracks().forEach(function (t) { t.stop(); }); } catch (x) {} try { ctx && ctx.close(); } catch (x) {} post("end", {}).catch(function () {}); } if (o.onEnd) o.onEnd("failed", e); });
    document.addEventListener("visibilitychange", function hid() { if (document.visibilityState === "hidden" && !C.ended) { end("hidden"); document.removeEventListener("visibilitychange", hid); } });
    return api;
  }
  /* the real Lara for the chat page outside calls (replaces the old drawn face): face(box, base).show("idle" | "talk1".. | "listen") */
  function face(box, base) { preload(base); return Face(box, base); }
  window.LaraLive = { start: start, preload: preload, face: face };
})();
