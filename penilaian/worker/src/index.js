// SBIM Camp — Penilaian (Worker terpisah).
// Halaman statis di public/ + REST + WebSocket siaran nilai (Durable Object Ledger).
import { cekPin, pinAktif } from "../../../lib/auth.js";
import * as N from "../../../lib/nilai.js";
import { rekap } from "./rekap.js";

export { Ledger } from "./ledger.js";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type,x-pin",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-max-age": "86400"
};
const j = (o, s = 200) => new Response(JSON.stringify(o), {
  status: s, headers: { "content-type": "application/json; charset=utf-8", ...CORS }
});
const stub = (env) => env.LEDGER.get(env.LEDGER.idFromName("ledger"));
const terus = async (r) => new Response(r.body, {
  status: r.status, headers: { ...CORS, "content-type": "application/json; charset=utf-8" }
});

async function api(req, env, url) {
  const p = url.pathname.replace(/\/+$/, "") || "/";
  const m = req.method;
  if (m === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  if (p === "/health") return j({ ok: true, app: "penilaian-sbim", pin: pinAktif(env), ts: Date.now() });
  if (p === "/api/config") return j({ pin: pinAktif(env), sesi: N.SESI });
  if (p === "/api/pin") return j({ ok: cekPin(req, env), wajib: pinAktif(env) });
  if (p === "/api/lcd") return terus(await stub(env).fetch("https://do/lcd"));

  if (p === "/ws") {
    if ((req.headers.get("Upgrade") || "").toLowerCase() !== "websocket") return new Response("butuh websocket", { status: 426 });
    return stub(env).fetch(req);
  }

  // mulai dari sini butuh PIN
  if (!cekPin(req, env)) return j({ error: "PIN salah" }, 401);
  const pin = req.headers.get("x-pin") || url.searchParams.get("pin") || "";

  if (p === "/api/state") return terus(await stub(env).fetch("https://do/state"));

  if (p === "/api/entri" && m === "POST") {
    const b = await req.json().catch(() => ({}));
    return terus(await stub(env).fetch("https://do/tambah", {
      method: "POST", headers: { "content-type": "application/json", "x-pin": pin }, body: JSON.stringify(b)
    }));
  }

  const bagi = p.split("/").filter(Boolean); // api/entri/:id/hapus
  if (bagi[0] === "api" && bagi[1] === "entri" && bagi[2] && bagi[3] === "hapus" && m === "POST") {
    return terus(await stub(env).fetch("https://do/hapus", {
      method: "POST", headers: { "content-type": "application/json", "x-pin": pin },
      body: JSON.stringify({ id: Number(bagi[2]) })
    }));
  }

  if (p === "/api/import" && m === "POST") {
    const b = await req.json().catch(() => ({}));
    return terus(await stub(env).fetch("https://do/import", {
      method: "POST", headers: { "content-type": "application/json", "x-pin": pin }, body: JSON.stringify(b)
    }));
  }

  if (p === "/api/kegiatan" && m === "POST") {
    const b = await req.json().catch(() => ({}));
    return terus(await stub(env).fetch("https://do/kegiatan", {
      method: "POST", headers: { "content-type": "application/json", "x-pin": pin }, body: JSON.stringify(b)
    }));
  }

  if (p === "/api/bersih" && m === "POST") return terus(await stub(env).fetch("https://do/bersih", {
    method: "POST", headers: { "content-type": "application/json", "x-pin": pin }, body: "{}"
  }));

  if (p === "/api/reset" && m === "POST") {
    const b = await req.json().catch(() => ({}));
    return terus(await stub(env).fetch("https://do/reset", {
      method: "POST", headers: { "content-type": "application/json", "x-pin": pin }, body: JSON.stringify(b)
    }));
  }

  if (p === "/api/rekap" && m === "POST") {
    const r = await stub(env).fetch("https://do/state");
    const st = await r.json();
    return j(await rekap(env, st));
  }

  if (p === "/api/export.csv") {
    const r = await stub(env).fetch("https://do/csv", { headers: { "x-pin": pin } });
    return new Response(r.body, {
      status: r.status,
      headers: { ...CORS, "content-type": "text/csv; charset=utf-8",
        "content-disposition": r.headers.get("content-disposition") || 'attachment; filename="penilaian-sbim.csv"' }
    });
  }

  return j({ error: "tidak ditemukan" }, 404);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/") || url.pathname === "/health" || url.pathname === "/ws") {
      try { return await api(req, env, url); }
      catch (e) { return j({ error: String((e && e.message) || e) }, 500); }
    }
    return env.ASSETS.fetch(req);
  }
};
