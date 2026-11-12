/* Gotcha Shootout 3v3 — the phone's line to the server (API-3V3.md §0, §3, §4): which server (?api=), phone storage, the device id, the clock
   offset, HTTP calls and a small reconnecting WebSocket. The server decides every result; this file only carries messages. */
"use strict";
const Net = (() => {
  const BASES = { live: "https://gotcha-shootout-3v3.long-fog-ae60.workers.dev", staging: "https://gotcha-shootout-3v3-staging.long-fog-ae60.workers.dev",
    local: "http://localhost:8787", fake: "fake" };
  let mode = null;
  try { mode = new URLSearchParams(location.search).get("api"); } catch (e) { mode = null; }
  try { if (mode && BASES[mode]) sessionStorage.setItem("s3v3:api", mode); else mode = sessionStorage.getItem("s3v3:api"); } catch (e) { /* no session storage */ }
  if (!BASES[mode]) mode = (location.protocol === "file:" || /^(localhost|127\.0\.0\.1)$/.test(location.hostname)) ? "staging" : "live";
  const base = BASES[mode];
  // phone storage is kept apart per server, so a staging test never leaves a ghost result on the live game
  const NS = "s3v3:" + (mode === "live" ? "" : mode === "staging" ? "stg:" : mode + ":");

  /* storage: private mode / blocked storage → memory only */
  const Store = { mem: {},
    get(k){ try { const v = localStorage.getItem(k); return v == null ? (k in this.mem ? this.mem[k] : null) : JSON.parse(v); } catch (e) { return k in this.mem ? this.mem[k] : null; } },
    set(k, v){ this.mem[k] = v; try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* memory only */ } },
    del(k){ delete this.mem[k]; try { localStorage.removeItem(k); } catch (e) { /* memory only */ } } };
  function randomId(n){
    const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_", b = new Uint8Array(n), out = [];
    (window.crypto || window.msCrypto).getRandomValues(b); for (let i = 0; i < n; i++) out.push(abc[b[i] & 63]); return out.join("");
  }
  let dev = Store.get(NS + "dev");
  if (typeof dev !== "string" || !/^[A-Za-z0-9_-]{16,32}$/.test(dev)){ dev = randomId(22); Store.set(NS + "dev", dev); }

  /* clock: server − phone, from the ping with the shortest round trip (least 4G noise); rtt smoothed for drawing the ball ahead */
  const clock = { offset: 0, rtt: 150, have: false, samples: [],
    pong(c, s){
      const now = Date.now(), rtt = now - c; if (!(rtt >= 0 && rtt < 10000) || typeof s !== "number") return;
      this.samples.push({ rtt, off: s - (c + rtt / 2) }); if (this.samples.length > 8) this.samples.shift();
      this.offset = this.samples.reduce((a, b) => b.rtt < a.rtt ? b : a).off;
      this.rtt = this.have ? this.rtt * 0.7 + rtt * 0.3 : rtt; this.have = true;
    },
    hint(serverNow){ if (!this.have && typeof serverNow === "number") this.offset = serverNow - Date.now(); },   // before the first pong
    now(){ return Date.now() + this.offset; },
    rttMin(){ return this.samples.length ? this.samples.reduce((a, b) => b.rtt < a ? b.rtt : a, Infinity) : this.rtt; } };   // the line's best round trip

  /* HTTP: POST JSON with a timeout; the fake server answers in the page */
  async function post(path, body, ms){
    if (mode === "fake") return Fake.post(path, body);
    const ctl = window.AbortController ? new AbortController() : null, timer = setTimeout(() => ctl && ctl.abort(), ms || 6000);
    try {
      const res = await fetch(base + path, { method: path === "/" ? "GET" : "POST", headers: path === "/" ? undefined : { "Content-Type": "application/json" },
        body: path === "/" ? undefined : JSON.stringify(body || {}), signal: ctl ? ctl.signal : undefined, cache: "no-store", credentials: "omit" });
      let out = null; try { out = await res.json(); } catch (e) { out = null; }
      if (!out || typeof out !== "object") return { ok: false, e: "network", status: res.status };
      out.status = res.status; return out;
    } catch (e) { return { ok: false, e: e && e.name === "AbortError" ? "timeout" : "network" }; }
    finally { clearTimeout(timer); }
  }
  const health = () => post("/", null, 5000);

  /* the reconnecting socket. Backoff 300 ms → 3 s. Nothing is ever queued: an old finger move replayed after a 4G drop is worse than none.
     The server restores a match seat by dev, so a reconnect only reopens; game.js decides what (if anything) to say after it opens. */
  function Socket(h){   // h: { open(), msg(m), down(wasUp, fails) }
    let ws = null, up = false, want = false, tries = 0, fails = 0, timer = 0, openTimer = 0, last = 0, local = false;
    const url = () => base.replace(/^http/, "ws") + "/ws?role=player&dev=" + encodeURIComponent(dev);
    function open(){
      clearTimeout(timer); if (!want || ws) return;
      let s; try { s = (mode === "fake" || local) ? Fake.socket(dev) : new WebSocket(url()); } catch (e) { fails++; h.down(false, fails); return retry(); }
      ws = s; openTimer = setTimeout(() => kill(s), 6000);   // a 4G black hole never says "open" nor "closed"
      s.onopen = () => { if (ws !== s) return; clearTimeout(openTimer); up = true; tries = 0; fails = 0; last = Date.now(); ping(); h.open(); };
      s.onmessage = e => { if (ws !== s) return; last = Date.now(); let m; try { m = JSON.parse(e.data); } catch (x) { return; }
        if (m && m.t === "pong") clock.pong(m.c, m.s); else if (m) h.msg(m); };
      s.onclose = () => kill(s); s.onerror = () => {};   // close always follows an error
    }
    function kill(s){
      if (!s || ws !== s) return; ws = null; clearTimeout(openTimer); try { s.close(); } catch (e) { /* gone */ }
      const was = up; up = false; if (!was) fails++; h.down(was, fails); retry();
    }
    function retry(){ clearTimeout(timer); if (!want) return; const d = Math.min(3000, L3.backoff(tries++) * (0.8 + Math.random() * 0.4)); timer = setTimeout(open, d); }
    function send(o){ if (!up || !ws || ws.readyState !== 1) return false; try { ws.send(JSON.stringify(o)); return true; } catch (e) { return false; } }
    function ping(){ send({ t: "ping", c: Date.now() }); }
    setInterval(() => { if (!up) return; ping(); if (Date.now() - last > 6500) kill(ws); }, 2000);   // a silent socket (phone slept, 4G gone) is reopened
    return {
      start(useLocal){ local = !!useLocal; want = true; if (!ws){ tries = 0; open(); } },
      stop(){ want = false; clearTimeout(timer); clearTimeout(openTimer); if (ws){ const s = ws; ws = null; up = false; try { s.close(); } catch (e) { /* gone */ } } },
      send, up: () => up, wanted: () => want, fails: () => fails, isLocal: () => local,
      nudge(){ if (!want) return; if (!ws){ tries = 0; open(); } else if (up && Date.now() - last > 3000) kill(ws); },   // page visible again
      drop(){ if (ws) kill(ws); }
    };
  }
  return { mode, base, NS, dev, Store, clock, now: () => clock.now(), post, health, Socket, test: mode !== "live" };
})();
