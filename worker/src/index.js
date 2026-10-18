// SBIM Camp — versi Cloudflare Workers (gratis, tanpa kartu, 24/7).
// Satu Worker menyajikan halaman statis (public/) + REST + WebSocket realtime
// yang ditangani Durable Object per sesi (class Room).
import QRCode from "qrcode";
import * as R from "../../lib/rooms.js";

export { Room } from "./room.js";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "GET,POST,OPTIONS"
};
const j = (o, s = 200) => new Response(JSON.stringify(o), {
  status: s, headers: { "content-type": "application/json; charset=utf-8", ...CORS }
});
const stubFor = (env, code) => env.ROOMS.get(env.ROOMS.idFromName(code));
const baseDari = (url) => {
  const b = String(url.searchParams.get("base") || "").trim().replace(/\/+$/, "");
  return /^https?:\/\/[a-z0-9.\-]+(:\d+)?(\/[A-Za-z0-9._~\/\-]*)?$/i.test(b) ? b : url.origin;
};

async function api(req, env, url) {
  const p = url.pathname, m = req.method;

  if (m === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  // bikin sesi baru
  if (p === "/api/rooms" && m === "POST") {
    const body = await req.json().catch(() => ({}));
    const input = body.questions || body.question || "Apa pendapatmu?";
    const code = R.genCode();
    const stub = stubFor(env, code);
    const r = await stub.fetch("https://do/create", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, questions: input })
    });
    if (!r.ok) return j({ error: "Gagal membuat sesi" }, 500);
    const info = await r.json();
    const jalur = /workers\.dev$/i.test(new URL(baseDari(url)).host) ? "/room?code=" : "/room/?code=";
    const joinUrl = `${baseDari(url)}${jalur}${code}`;
    let qr = null;
    try {
      const svg = await QRCode.toString(joinUrl, { type: "svg", width: 320, margin: 1 });
      qr = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    } catch (e) { qr = null; }
    return j({ code, qTotal: info.qTotal, joinUrl, qr });
  }

  // QR sesi (dipakai layar presenter) — SVG supaya tetap tajam saat dibesarkan
  const mq = p.match(/^\/api\/rooms\/([A-Za-z0-9]{4,8})\/qr$/);
  if (mq && m === "GET") {
    const code = mq[1].toUpperCase();
    const lebar = Math.min(1000, Math.max(120, Number(url.searchParams.get("w")) || 320));
    const jalur = /workers\.dev$/i.test(new URL(baseDari(url)).host) ? "/room?code=" : "/room/?code=";
    const joinUrl = `${baseDari(url)}${jalur}${code}`;
    try {
      const svg = await QRCode.toString(joinUrl, { type: "svg", width: lebar, margin: 1 });
      return j({ joinUrl, qr: "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg) });
    } catch (e) { return j({ error: "QR gagal dibuat" }, 500); }
  }

  // sisanya diteruskan ke Durable Object sesi terkait
  const m2 = p.match(/^\/api\/rooms\/([A-Za-z0-9]{4,8})(?:\/(.*))?$/);
  if (!m2) return j({ error: "Not found" }, 404);
  const code = m2[1].toUpperCase();
  const aksi = (m2[2] || "state").replace(/\/+$/, "");
  const teks = m === "POST" ? await req.text() : null;
  const r = await stubFor(env, code).fetch(`https://do/${aksi}?code=${code}`, {
    method: m, headers: { "content-type": "application/json" }, body: teks
  });
  const out = await r.text();
  return new Response(out, {
    status: r.status,
    headers: { "content-type": r.headers.get("content-type") || "application/json; charset=utf-8", ...CORS }
  });
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const p = url.pathname;

    if (p === "/health") return j({ ok: true });

    // halaman ini & backend satu domain -> pakai origin sendiri, tanpa daftar kandidat
    if (p === "/config.js")
      return new Response('var SURGE_BACKENDS = [];\nvar SURGE_BACKEND = "";\n', {
        headers: { "content-type": "application/javascript; charset=utf-8", ...CORS }
      });

    if (p === "/ws") {
      const code = (url.searchParams.get("code") || "").toUpperCase();
      if (!/^[A-Z0-9]{4,8}$/.test(code)) return new Response("kode tidak valid", { status: 400 });
      return stubFor(env, code).fetch(new Request(url.toString(), req));
    }

    if (p.startsWith("/api/")) return api(req, env, url);

    // berkas statis (public/) — biarkan lapisan Assets menangani kanonikalisasi .html
    // (/room/ -> 307 -> /room -> room.html). Jangan rewrite sendiri: itu membuat loop.
    return env.ASSETS.fetch(new Request(new URL(p + url.search, url), req));
  }
};
