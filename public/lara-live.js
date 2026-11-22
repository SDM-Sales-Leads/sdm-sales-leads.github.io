/* Lara video call — Gemini Live voice + Lara's video clips (20 Nov 2026, docs/LARA-AVATAR-PLAN.md).
   Voice: the browser talks to Gemini Live with a one-use, locked token from our server (the Google key never comes here).
   Face: 9 pre-made clips of Lara (public/lara/*.mp4, ~0.6 MB), cross-faded live: talking while her voice plays (louder = a livelier
   clip), listening while the customer speaks, thinking while a tool runs, idle otherwise. Lips follow her voice, not word-perfect.
   Cost guards: max call length (server token expires too), 20 s silence -> "are you still there?", 12 s more -> end, tab hidden -> end. */
(function () {
  "use strict";
  var CV = "22";   // clip version: bump when the clips change, so no browser keeps playing old ones (21 Nov 2026)
  var CLIPS = ["idle", "listen"];   // 21 Nov 2026: talk1/2 = Gemini Pro videos of Lara, idle/listen = same portrait
  var cache = {}, loading = null;
  function preload(base) {
    if (loading) return loading;
    loading = Promise.all(CLIPS.map(function (n) {
      // warm the browser cache only: the <video> plays the normal web address (Safari plays blob: video late or not at all — 20 Nov 2026 test)
      cache[n] = base + n + ".mp4?v=" + CV;
      return fetch(cache[n]).then(function (r) { return r.ok ? r.blob() : null; }).catch(function () {});
    }));
    return loading;
  }

  // ---- the face: two <video> layers, cross-fade --------------------------------------------------------------------------------
  function Face(box, base, report) {
    var wrap = document.createElement("div"); wrap.className = "lv";
    var poster = document.createElement("img"); poster.className = "lvp"; poster.src = base + "poster.jpg?v=" + CV; poster.alt = "";
    var v = [0, 1].map(function () { var x = document.createElement("video"); x.muted = true; x.playsInline = true; x.setAttribute("playsinline", ""); x.setAttribute("muted", ""); x.loop = true; x.preload = "auto"; x.style.opacity = "0"; wrap.appendChild(x); return x; });
    wrap.insertBefore(poster, v[0]);
    box.appendChild(wrap);
    var cur = -1, clip = "", since = 0;
    function show(name, opt) {
      opt = opt || {};
      if (name === clip && !opt.force) return;
      var nx = cur === 0 ? 1 : 0, el = v[nx], src = cache[name] || (base + name + ".mp4?v=" + CV);
      clip = name; since = Date.now();
      (window.__laraClips = window.__laraClips || []).push([since, name]);   // for tests: how often her clip changes
      el.loop = !opt.once;
      var shown = false, me = clip;
      var stallT = setTimeout(function () { if (!shown && clip === me && report) report(name, 1500); }, 1500);
      var fade = function () {
        if (shown || clip !== me) return; shown = true; clearTimeout(stallT);
        // the new clip fades in ON TOP of the old one, which stays fully visible underneath -> never a dark/black moment
        // (21 Nov 2026: fading both at once showed the black background through both)
        var old = cur;
        el.style.zIndex = "2"; if (old >= 0 && old !== nx) v[old].style.zIndex = "1";
        el.style.opacity = "1"; cur = nx;
        setTimeout(function () {
          if (old >= 0 && old !== cur) { v[old].style.transition = "none"; v[old].style.opacity = "0"; v[old].offsetWidth; v[old].style.transition = ""; try { v[old].pause(); } catch (e) {} }
          poster.style.opacity = "0";
        }, 400);
      };
      var seek = function () { try { if (opt.start) el.currentTime = 0; else if (!el.__seen) el.currentTime = Math.random() * Math.max(0, (el.duration || 2) - 1.2); el.__seen = true; } catch (e) {} };
      el.playbackRate = 1; el.defaultPlaybackRate = 1;   // Gemini clips move naturally at real speed
      el.onplaying = fade;
      if (el.getAttribute("src") !== src) { el.__seen = false; el.onloadedmetadata = function () { el.onloadedmetadata = null; seek(); }; el.src = src; } else seek();
      // play at once (hidden); show it the moment frames really play — Safari only loads a video once play() is called
      var p = el.play(); if (p && p.then) p.then(function () { if (el.readyState >= 2) fade(); }).catch(function () {});
    }
    return { wrap: wrap, show: show, clip: function () { return clip; }, age: function () { return Date.now() - since; }, remove: function () {
      // release the video players at once (a removed but still-loaded <video> keeps one of the browser's few media connections,
      // and the next clip then never loads — 21 Nov 2026 test: talk clip stuck at readyState 0)
      v.forEach(function (x) { try { x.pause(); x.removeAttribute("src"); x.load(); } catch (e) {} });
      wrap.remove();
    } };
  }

  // ---- lip sync from her VOICE (22 Nov 2026) -------------------------------------------------------------------------------------
  // Each audio chunk from Gemini is analysed BEFORE it plays (40 ms frames: loudness, low "a/o/u" band, mid "i/e" band, hiss "s/sh"),
  // and the matching mouth shape (whole lower face rendered from her own photo, v3) is shown exactly when that frame is heard (audio clock).
  // Head stays on the calm clip (still + blinks); only the mouth area changes. No pre-made talking clip, so voice and lips stay locked.
  function fft(re, im) {
    var n = re.length, i, j, k, l, t;
    for (i = 1, j = 0; i < n; i++) { var bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    for (l = 2; l <= n; l <<= 1) {
      var a = -2 * Math.PI / l, wr = Math.cos(a), wi = Math.sin(a);
      for (i = 0; i < n; i += l) { var cr = 1, ci = 0; for (k = 0; k < l / 2; k++) { var xr = re[i + k + l / 2] * cr - im[i + k + l / 2] * ci, xi = re[i + k + l / 2] * ci + im[i + k + l / 2] * cr; re[i + k + l / 2] = re[i + k] - xr; im[i + k + l / 2] = im[i + k] - xi; re[i + k] += xr; im[i + k] += xi; t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } }
    }
  }
  // v5 (22 Nov 2026, owner: "the Arabic she's saying is not synced to her lips"). Measured in a live call: HeadAudio's lip shapes
  // (trained on English) matched her Arabic loudness only weakly (0.5) and often closed the lips on loud vowels. Now:
  //  • JAW opening follows the loudness of her voice exactly as it is heard (analyser after the speaker delay), every screen frame,
  //    smoothly between 6 openings — every syllable opens and closes the mouth;
  //  • HeadAudio only chooses the LIP STYLE: round (o/u), slightly wide (e/i/s) or normal, and closes the lips on m/b/p.
  // Images: 3 styles × 6 openings, each a whole-lower-face render of her own photo (LivePortrait, MIT).
  var VIS = ["viseme_aa", "viseme_E", "viseme_I", "viseme_O", "viseme_U", "viseme_PP", "viseme_SS", "viseme_TH", "viseme_DD", "viseme_FF", "viseme_kk", "viseme_nn", "viseme_RR", "viseme_CH", "viseme_sil"];
  var STYLE = { viseme_O: "r", viseme_U: "r", viseme_CH: "r", viseme_RR: "r", viseme_E: "w", viseme_I: "w", viseme_SS: "w", viseme_FF: "w" };
  var HA_DELAY = 0.045;                                      // her voice reaches the speaker 45 ms after the mouth reads it (jaw opening time)
  function Mouth(box, base) {
    var cv = document.createElement("canvas"); cv.className = "lvm"; cv.width = 960; cv.height = 540; box.appendChild(cv);
    var g = cv.getContext("2d"), imgs = {}, info = null, ready = false, activeAt = 0, drawn = "";
    var ha = null, haOn = false, vals = {}, lastT = 0, an = null, buf = null, env = 0, peak = 0.04, style = "n", styleCand = "n", styleSince = 0;
    fetch(base + "jaw.json?v=" + CV).then(function (r) { return r.json(); }).then(function (j) {
      info = j;
      return Promise.all(j.shapes.map(function (n) { return new Promise(function (res) { var im = new Image(); im.onload = function () { imgs[n] = im; res(); }; im.onerror = res; im.src = base + "jaw_" + n + "." + (j.ext || "webp") + "?v=" + CV; }); }));
    }).then(function () { ready = true; }).catch(function () {});
    function attach(ctx, src, heard) {
      // read her voice BEFORE the speaker delay: the jaw needs ~40 ms to open, so it now lands with the sound (measured 22 Nov)
      if (ctx && src) { an = ctx.createAnalyser(); an.fftSize = 1024; src.connect(an); } else an = heard || null;
      if (an) buf = new Float32Array(an.fftSize);
      if (!ctx || !ctx.audioWorklet || !window.Promise) return Promise.resolve(false);
      var root = new URL("vendor/headaudio/", location.href).href;
      return ctx.audioWorklet.addModule(root + "headworklet.min.mjs").then(function () { return import(root + "headaudio.min.mjs"); }).then(function (m) {
        ha = new m.HeadAudio(ctx, { visemeMinMs: 90, visemeRampMs: 70, parameterData: { vadMode: 1, vadGateActiveDb: -45, vadGateInactiveDb: -58, silMode: 0 } });
        ha.onvalue = function (k, v) { vals[k] = v; };
        return ha.loadModel(root + "model-en-mixed.bin").then(function () { src.connect(ha); haOn = true; return true; });
      }).catch(function () { haOn = false; return false; });
    }
    function img(st, k) { return k === 0 && st === "n" ? "sil" : st + k; }
    function put(name, alpha) { var im = imgs[name]; if (!im) return; g.globalAlpha = alpha; g.drawImage(im, info.x, info.y); }
    function render(ctx) {
      if (!ready || !ctx) return;
      var now = performance.now(), dt = lastT ? Math.min(100, now - lastT) : 16; lastT = now;
      // 1. loudness of what is heard right now
      var lv = 0;
      if (an) { an.getFloatTimeDomainData(buf); var s2 = 0; for (var i = 0; i < buf.length; i++) s2 += buf[i] * buf[i]; lv = Math.sqrt(s2 / buf.length); }
      var k1 = 1 - Math.exp(-dt / (lv > env ? 25 : 70));    // opens in ~25 ms, closes in ~70 ms (like a jaw)
      env += (lv - env) * k1;
      peak = Math.max(env, peak * Math.exp(-dt / 4000), 0.02);
      var open = Math.max(0, Math.min(1, (env / peak - 0.1) / 0.75)); open = Math.pow(open, 0.85);
      // 2. lip style from HeadAudio (round / wide / normal), m-b-p closes the lips
      var want = "n", pp = 0;
      if (haOn) {
        ha.update(dt);
        var best = 0, bk = "";
        for (var v = 0; v < VIS.length - 1; v++) { var x = vals[VIS[v]] || 0; if (x > best) { best = x; bk = VIS[v]; } }
        pp = vals.viseme_PP || 0;
        if (best > 0.2 && STYLE[bk]) want = STYLE[bk];
      }
      if (want !== styleCand) { styleCand = want; styleSince = now; }
      if (styleCand !== style && now - styleSince > 60) style = styleCand;
      if (pp > 0.45) open *= 0.2;
      // 3. draw: two neighbouring openings blended by the fraction -> smooth jaw movement
      var f = open * 5, k = Math.floor(f), fr = f - k; if (k >= 5) { k = 5; fr = 0; }
      if (open > 0.05) activeAt = Date.now();
      var A = img(style, k), B = fr > 0.08 ? img(style, k + 1) : "", key = A + B + Math.round(fr * 12);
      if (key === drawn) return; drawn = key;
      g.clearRect(info.x - 2, info.y - 2, info.w + 4, info.h + 4);
      put(A, 1); if (B) put(B, fr); g.globalAlpha = 1;
    }
    return { attach: attach, feed: function () {}, render: render, clear: function () { vals = {}; env = 0; }, active: function () { return Date.now() - activeAt < 400; }, ready: function () { return ready; }, mode: function () { return (haOn ? "headaudio" : "loudness") + "+jaw"; } };
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
    // ---- audit log (0032): every call's events go to Lara > Issues & audit; problems become issues automatically ----
    var AU = { id: (window.crypto && crypto.randomUUID ? crypto.randomUUID() : (Date.now().toString(16) + Math.random().toString(16).slice(2))), q: [], first: 0, desyncFrom: 0, desyncClip: "", spk: false };
    function ev(kind, data) { AU.q.push({ t: Date.now() - C.t0, kind: kind, data: data || {} }); if (AU.q.length >= 40) flushEv(); }
    function flushEv(final) {
      if (!AU.q.length) return;
      var batch = AU.q.splice(0, 80);
      try { fetch(o.api + "/chat/s/" + o.key + "/live/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ callId: AU.id, events: batch }), keepalive: !!final }).catch(function () {}); } catch (e) {}
    }
    var evTimer = setInterval(flushEv, 5000);
    var onErr = function (e) { ev("error", { message: String((e && (e.message || (e.reason && e.reason.message))) || e).slice(0, 300) }); };
    window.addEventListener("error", onErr); window.addEventListener("unhandledrejection", onErr);
    ev("start", { lang: o.lang, ua: navigator.userAgent.slice(0, 140) });
    var face = Face(o.stage, o.base, function (clip, ms) { ev("clip_stall", { clip: clip, ms: ms }); });
    var mouth = Mouth(face.wrap, o.base);
    var ctx, ws, node, stream, gain, an, nextT = 0, srcs = [], timer = null, raf = null;
    function post(p, b) { return fetch(o.api + "/chat/s/" + o.key + "/live/" + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b || {}) }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || ("Error " + r.status)); return j; }); }); }
    function state(s) { if (o.onState) o.onState(s); }
    function flush(dir) { var t = C.lines[dir].trim(); C.lines[dir] = ""; if (!t) return; if (o.onLine) o.onLine(dir, t, true); post("say", { dir: dir, text: t }).catch(function () {}); }
    function stopAudio() { srcs.forEach(function (s) { try { s.stop(); } catch (e) {} }); srcs = []; nextT = 0; C.outUntil = 0; mouth.clear(); }
    function play(b) {
      if (!ctx) return;
      var f = pcm24(b), buf = ctx.createBuffer(1, f.length, 24000); buf.copyToChannel ? buf.copyToChannel(f, 0) : buf.getChannelData(0).set(f);
      var s = ctx.createBufferSource(); s.buffer = buf; s.connect(gain);
      var at = Math.max(ctx.currentTime + 0.04, nextT); s.start(at); nextT = at + buf.duration; srcs.push(s);
      mouth.feed(f, at);
      s.onended = function () { srcs = srcs.filter(function (x) { return x !== s; }); };
      C.outUntil = Date.now() + (nextT - ctx.currentTime) * 1000;
      if (!AU.first) { AU.first = Date.now(); ev("first_audio", { ms: AU.first - C.t0 }); }
    }
    function send(m) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); }
    function end(reason) {
      if (C.ended) return; C.ended = true;
      flush("in"); flush("out");
      ev("end", { reason: reason || "end" }); clearInterval(evTimer); flushEv(true);
      window.removeEventListener("error", onErr); window.removeEventListener("unhandledrejection", onErr);
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
      // head: calm clip (still + blinks) also while she speaks — her mouth moves from her voice (Mouth); listening while the customer talks
      want = custom ? "listen" : "idle";
      if (want !== cur && face.age() > 1500) face.show(want);
      state(speaking ? "speaking" : C.toolBusy ? "thinking" : custom ? "listening" : "idle");
      var heard = now < C.outUntil && C.lvlOut > 0.04, faceTalks = mouth.active() || !mouth.ready();
      if (heard !== AU.spk) { AU.spk = heard; ev(heard ? "speak_start" : "speak_end", { clip: face.clip() }); }
      if (heard && !faceTalks) { if (!AU.desyncFrom) { AU.desyncFrom = now; AU.desyncClip = face.clip(); } }
      else if (AU.desyncFrom) { var dms = now - AU.desyncFrom; AU.desyncFrom = 0; if (dms >= 300) ev("desync", { ms: dms, clip: AU.desyncClip }); }
      // cost guards
      var secs = (now - C.t0) / 1000;
      if (!C.warned && secs > o.maxSec - 30) { C.warned = true; send({ realtimeInput: { text: "(System: 30 seconds left in this call. Wrap up politely and offer that the account manager follows up.)" } }); }
      if (secs > o.maxSec) return end("max");
      var quiet = now - Math.max(C.micAt, C.outUntil);
      if (C.muted) { C.asked = false; return; }              // muted on purpose: never ask "are you still there" or hang up for silence
      if (!C.asked && quiet > 20000 && !C.toolBusy) { C.asked = true; C.askedAt = now; send({ realtimeInput: { text: "(System: the customer has been silent for 20 seconds. Ask briefly if they are still there.)" } }); }
      if (C.asked && now - C.askedAt > 12000 && now - C.micAt > 12000 && now > C.outUntil + 2000) return end("silence");
      if (now - C.micAt < 1500) C.asked = false;
    }
    function meter() { if (C.ended) return; mouth.render(ctx); if (an) { var d = new Float32Array(an.fftSize); an.getFloatTimeDomainData(d); var s = 0; for (var i = 0; i < d.length; i++) s += d[i] * d[i]; C.lvlOut = Math.sqrt(s / d.length); if (o.onLevel) o.onLevel(C.lvlOut); } raf = requestAnimationFrame(meter); }

    function onMsg(m) {
      if (m.setupComplete) {
        ev("connected", {});
        send({ realtimeInput: { text: o.lang === "ar" ? "(System: the call is connected. Greet the customer now.)" : "(System: the call is connected. Greet the customer now.)" } });
        return;
      }
      if (m.toolCall && m.toolCall.functionCalls) {
        m.toolCall.functionCalls.forEach(function (fc) {
          if (fc.name === "end_call") { send({ toolResponse: { functionResponses: [{ id: fc.id, name: fc.name, response: { result: "OK" } }] } }); setTimeout(function () { var wait = Math.max(0, C.outUntil - Date.now()); setTimeout(function () { end("bye"); }, wait + 600); }, 1500); return; }
          C.toolBusy++; var t1 = Date.now();
          post("tool", { name: fc.name, args: fc.args || {}, lang: C.lang }).then(function (r) { ev("tool", { name: fc.name, ms: Date.now() - t1, answered: !/^NO_/.test(String(r.result || "")) }); return r.result; }).catch(function (e) { ev("tool_error", { name: fc.name, error: String(e && e.message || e).slice(0, 200) }); return "NO_ANSWER"; }).then(function (res) {
            C.toolBusy = Math.max(0, C.toolBusy - 1);
            send({ toolResponse: { functionResponses: [{ id: fc.id, name: fc.name, response: { result: res } }] } });
          });
        });
      }
      var sc = m.serverContent;
      if (!sc) { if (m.goAway) end("time"); return; }
      if (sc.interrupted) { ev("interrupted", {}); stopAudio(); flush("out"); }
      if (sc.modelTurn && sc.modelTurn.parts) sc.modelTurn.parts.forEach(function (p) { if (p.inlineData && p.inlineData.data) play(p.inlineData.data); });
      if (sc.inputTranscription && sc.inputTranscription.text) { if (C.lines.out) flush("out"); C.lines.in += sc.inputTranscription.text; if (/[a-z]{3,}/i.test(C.lines.in) || /[\u0600-\u06FF]/.test(C.lines.in)) { var nl = /[\u0600-\u06FF]/.test(C.lines.in) ? "ar" : "en"; if (nl !== C.lang) ev("lang", { lang: nl }); C.lang = nl; } if (o.onLine) o.onLine("in", C.lines.in, false); }
      if (sc.outputTranscription && sc.outputTranscription.text) { if (C.lines.in) flush("in"); C.lines.out += sc.outputTranscription.text; if (o.onLine) o.onLine("out", C.lines.out, false); }
      if (sc.turnComplete) { flush("in"); flush("out"); }
    }

    var ready = preload(o.base).then(function () { face.show("idle", { force: true }); });
    var go = post("start", { lang: o.lang }).then(function (t) {
      o.maxSec = Number(t.maxSec) || o.maxSec || 300;
      var AC = window.AudioContext || window.webkitAudioContext;
      // iPhone/iPad: the audio context must be created inside the tap (chat.html makes it there and passes o.ctx)
      ctx = o.ctx || new AC();
      ev("mic", { ctx: ctx.state, given: !!o.ctx });
      gain = ctx.createGain(); an = ctx.createAnalyser(); an.fftSize = 1024; var dl = ctx.createDelay(0.5); dl.delayTime.value = 0; gain.connect(dl); dl.connect(an); an.connect(ctx.destination);
      dl.delayTime.value = HA_DELAY;
      var haReady = mouth.attach(ctx, gain, an).then(function (ok) { ev("lipsync", { mode: ok ? "headaudio" : "bands" }); });
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
          ws.onclose = function (e) { ev("ws_close", { code: e && e.code, reason: String(e && e.reason || "").slice(0, 120), clean: C.ended }); if (!C.ended) end("closed"); };
          ws.onerror = function () { if (o.onNote) o.onNote("connection"); };
          timer = setInterval(tick, 100); meter();
          if (ctx.state === "suspended") ctx.resume();
        });
      });
    });
    var api = {
      ready: Promise.all([ready, go]),
      end: function () { end("user"); },
      mute: function (on) { C.muted = !!on; try { stream && stream.getAudioTracks().forEach(function (t) { t.enabled = !C.muted; }); } catch (e) {} ev(C.muted ? "mute" : "unmute", {}); if (!C.muted) C.micAt = Date.now(); },
      muted: function () { return C.muted; },
      lipsync: function () { return mouth.mode(); },
    };
    api.ready.catch(function (e) { ev("error", { message: "call did not start: " + String(e && e.message || e).slice(0, 250) }); ev("end", { reason: "failed" }); clearInterval(evTimer); flushEv(true); if (!C.ended) { C.ended = true; face.remove(); try { stream && stream.getTracks().forEach(function (t) { t.stop(); }); } catch (x) {} try { ctx && ctx.close(); } catch (x) {} post("end", {}).catch(function () {}); } if (o.onEnd) o.onEnd("failed", e); });
    document.addEventListener("visibilitychange", function hid() { if (document.visibilityState === "hidden" && !C.ended) { end("hidden"); document.removeEventListener("visibilitychange", hid); } });
    window.LaraLive.last = api;
    return api;
  }
  /* the real Lara for the chat page outside calls (replaces the old drawn face): face(box, base).show("idle" | "talk1".. | "listen") */
  function face(box, base) { preload(base); return Face(box, base); }
  window.LaraLive = { start: start, preload: preload, face: face };
})();
