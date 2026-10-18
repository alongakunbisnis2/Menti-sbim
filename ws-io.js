// Shim socket.io -> WebSocket asli (untuk Cloudflare Workers/Durable Objects,
// yang tidak mendukung protokol socket.io). API yang dipakai halaman:
//   const s = io(BACKEND); s.on('room:update', cb); s.emit('admin:goto-question', {...})
// Kode sesi diambil otomatis dari ?code= pada URL (halaman room & presenter).
(function () {
  function dariURL() {
    const Q = new URLSearchParams(location.search);
    return {
      code: (Q.get('code') || '').toUpperCase(),
      name: (typeof myName === 'function' && myName()) || Q.get('name') || '',
      pid: (typeof pid !== 'undefined' && pid) || Q.get('pid') || ''
    };
  }
  function io(url, opts) {
    const o = opts || {};
    const q = Object.assign(dariURL(), o.query || {});
    const base = String(url || location.origin).replace(/^http/, 'ws').replace(/\/+$/, '');
    const sock = { connected: false, id: Math.random().toString(36).slice(2, 10), _h: {}, _closed: false };
    let ws = null, tries = 0, antre = [];

    sock.on = (evt, cb) => { (sock._h[evt] = sock._h[evt] || []).push(cb); return sock; };
    sock.off = (evt) => { delete sock._h[evt]; return sock; };
    const fire = (evt, d) => (sock._h[evt] || []).forEach(f => { try { f(d); } catch (e) {} });

    sock.emit = (evt, d) => {
      const msg = JSON.stringify({ e: evt, d: d === undefined ? {} : d });
      if (ws && ws.readyState === 1) { try { ws.send(msg); } catch (e) { antre.push(msg); } }
      else antre.push(msg);
      return sock;
    };
    sock.close = () => { sock._closed = true; try { ws && ws.close(); } catch (e) {} };

    function buka() {
      if (sock._closed) return;
      const p = new URLSearchParams({ code: q.code, pid: q.pid || sock.id, name: q.name || '' });
      try { ws = new WebSocket(base + '/ws?' + p.toString()); }
      catch (e) { return lagi(); }
      ws.onopen = () => {
        sock.connected = true; tries = 0;
        fire('connect');
        const kirim = antre.splice(0);
        kirim.forEach(m => { try { ws.send(m); } catch (e) {} });
      };
      ws.onmessage = (ev) => { let m; try { m = JSON.parse(ev.data); } catch (e) { return; } if (m && m.e) fire(m.e, m.d); };
      ws.onerror = () => { try { ws.close(); } catch (e) {} };
      ws.onclose = () => { sock.connected = false; fire('disconnect'); lagi(); };
    }
    function lagi() { if (sock._closed) return; tries++; setTimeout(buka, Math.min(600 * tries, 4000)); }

    buka();
    return sock;
  }
  window.io = io;
})();
