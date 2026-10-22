/* SBIM Camp — helper klien bersama (Quiziz & Penilaian).
   Tanpa dependensi. Protokol pesan: {e:"nama", d:{...}} */

const SB = (() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const rupiah = (n) => new Intl.NumberFormat('id-ID').format(n || 0);

  // ---- PIN panel (disimpan di perangkat) ----
  const PIN_KEY = 'sbim_pin_' + location.hostname + '_' + location.pathname.split('/')[1];
  const getPin = () => localStorage.getItem(PIN_KEY) || new URLSearchParams(location.search).get('pin') || '';
  const setPin = (v) => localStorage.setItem(PIN_KEY, v);
  const clearPin = () => localStorage.removeItem(PIN_KEY);

  // ---- HTTP ----
  async function api(path, opt = {}) {
    const headers = { 'content-type': 'application/json', ...(opt.headers || {}) };
    const pin = getPin();
    if (pin) headers['x-pin'] = pin;
    const r = await fetch(path, {
      method: opt.method || (opt.body ? 'POST' : 'GET'),
      headers,
      body: opt.body ? JSON.stringify(opt.body) : undefined,
      signal: opt.signal || AbortSignal.timeout(20000)
    });
    let d = null;
    try { d = await r.json(); } catch (e) { d = {}; }
    if (r.status === 401) { clearPin(); lock(false); throw new Error(d.error || 'PIN salah'); }
    if (!r.ok) throw new Error(d.error || ('Gagal (' + r.status + ')'));
    return d;
  }

  // ---- toast ----
  let toastBox;
  function toast(msg, bad) {
    if (!toastBox) { toastBox = document.createElement('div'); toastBox.id = 'toast'; document.body.appendChild(toastBox); }
    const el = document.createElement('div');
    el.className = 't' + (bad ? ' bad' : '');
    el.textContent = msg;
    toastBox.appendChild(el);
    setTimeout(() => el.remove(), 2600);
  }

  // ---- layar kunci PIN ----
  function lock(hideOnly) {
    const box = $('#lock');
    if (!box) return;
    if (hideOnly) { box.classList.add('hide'); return; }
    box.classList.remove('hide');
    const inp = $('#lockPin');
    if (inp) { inp.value = ''; setTimeout(() => inp.focus(), 60); }
  }

  // ---- WebSocket: auto-reconnect, pesan {e,d} ----
  function ws(code, role, extra = {}) {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const q = new URLSearchParams({ code, role, ...extra });
    const pin = getPin(); if (pin) q.set('pin', pin);
    const handlers = {};
    let sock = null, dead = false, tries = 0;

    function open() {
      sock = new WebSocket(`${proto}://${location.host}/ws?${q}`);
      sock.addEventListener('message', (ev) => {
        let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
        (handlers[m.e] || []).forEach((fn) => fn(m.d));
        (handlers['*'] || []).forEach((fn) => fn(m));
      });
      sock.addEventListener('open', () => { tries = 0; (handlers.__open || []).forEach((f) => f()); });
      sock.addEventListener('close', () => {
        (handlers.__close || []).forEach((f) => f());
        if (dead) return;
        const wait = Math.min(8000, 400 * Math.pow(1.7, tries++));
        setTimeout(open, wait);
      });
    }
    open();
    return {
      on: (ev, fn) => ((handlers[ev] = handlers[ev] || []).push(fn)),
      send: (e, d) => { try { if (sock && sock.readyState === 1) sock.send(JSON.stringify({ e, d })); } catch (err) {} },
      close: () => { dead = true; try { sock && sock.close(); } catch (e) {} },
      get open() { return !!sock && sock.readyState === 1; }
    };
  }

  // ---- hitungan waktu tuntas dari server (hindari jam HP meleset) ----
  function clock(deadline, serverNow) {
    const skew = Date.now() - (serverNow || Date.now());
    return {
      left: () => Math.max(0, Math.round((deadline - (Date.now() - skew)) / 1000)),
      ms: () => Math.max(0, deadline - (Date.now() - skew))
    };
  }

  // ---- ganti halaman dengan aman ----
  const go = (url) => { location.href = url; };

  return { $, $$, esc, rupiah, api, toast, lock, ws, clock, go, getPin, setPin, clearPin };
})();
