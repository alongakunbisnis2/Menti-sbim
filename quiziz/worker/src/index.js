// SBIM Camp — Quiziz (Worker terpisah dari Menti).
// Halaman statis di public/ + REST + WebSocket (Durable Object per kode kuis) + Arsip.
import QRCode from "qrcode";
import * as Q from "../../../lib/quiziz.js";
import { cekPin, pinAktif } from "../../../lib/auth.js";

export { Quiz } from "./quiz.js";
export { Arsip } from "./arsip.js";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type,x-pin",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-max-age": "86400"
};
const j = (o, s = 200) => new Response(JSON.stringify(o), {
  status: s, headers: { "content-type": "application/json; charset=utf-8", ...CORS }
});
const HURUF = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const genCode = () => Array.from({ length: 6 }, () => HURUF[Math.floor(Math.random() * HURUF.length)]).join("");
const qStub = (env, code) => env.QUIZ.get(env.QUIZ.idFromName(code));
const aStub = (env) => env.ARSIP.get(env.ARSIP.idFromName("arsip"));

function baseDari(url) {
  const b = String(url.searchParams.get("base") || "").trim().replace(/\/+$/, "");
  return /^https?:\/\/[a-z0-9.\-]+(:\d+)?(\/[A-Za-z0-9._~\/\-]*)?$/i.test(b) ? b : url.origin;
}
function tautan(url, code) {
  const base = baseDari(url);
  const jalur = /workers\.dev$/i.test(new URL(base).host) ? "/room?code=" : "/room/?code=";
  return base + jalur + code;
}

async function api(req, env, url) {
  const p = url.pathname.replace(/\/+$/, "") || "/";
  const m = req.method;
  if (m === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  if (p === "/health") return j({ ok: true, app: "quiziz-sbim", pin: pinAktif(env), ts: Date.now() });
  if (p === "/api/config") return j({ pin: pinAktif(env), jedaKunci: Q.JEDA_KUNCI, poin: [Q.POIN_MAKS, Q.POIN_MIN] });
  if (p === "/api/pin") return j({ ok: cekPin(req, env), wajib: pinAktif(env) });

  // ---------- buat kuis ----------
  if (p === "/api/quiz" && m === "POST") {
    if (!cekPin(req, env)) return j({ error: "PIN salah" }, 401);
    const b = await req.json().catch(() => ({}));
    let hasil;
    if (Array.isArray(b.soal)) hasil = Q.parseList(b.soal, b.limit);
    else hasil = Q.parseBulk(b.teks, b.limit);
    if (hasil.error) return j({ error: hasil.error }, 400);
    if (!hasil.questions.length) return j({ error: "Belum ada soal." }, 400);
    const code = String(b.code || genCode()).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8) || genCode();
    const r = await qStub(env, code).fetch("https://do/create", {
      method: "POST", headers: { "content-type": "application/json", "x-pin": req.headers.get("x-pin") || "" },
      body: JSON.stringify({ code, judul: b.judul, questions: hasil.questions })
    });
    if (!r.ok) return j({ error: "Gagal membuat kuis: " + (await r.text()).slice(0, 300) }, 500);
    return j({ code, qTotal: hasil.questions.length, joinUrl: tautan(req.url ? new URL(req.url) : url, code), tvUrl: baseDari(url) + "/tv?code=" + code });
  }

  // ---------- per kuis ----------
  const bagi = p.split("/").filter(Boolean);            // ["api","quiz",code,...]
  if (bagi[0] === "api" && bagi[1] === "quiz" && bagi[2]) {
    const code = String(bagi[2]).toUpperCase();
    const aksi = bagi[3] || "";
    const stub = qStub(env, code);

    if (!aksi && m === "GET") {
      if (url.searchParams.get("view") === "host" && !cekPin(req, env)) return j({ error: "PIN salah" }, 401);
      const r = await stub.fetch("https://do/state?" + url.searchParams.toString(), {
        headers: { "x-pin": req.headers.get("x-pin") || url.searchParams.get("pin") || "" }
      });
      return new Response(r.body, { status: r.status, headers: { ...CORS, "content-type": "application/json; charset=utf-8" } });
    }

    if (aksi === "qr") {
      const lebar = Math.min(900, Math.max(120, Number(url.searchParams.get("w")) || 320));
      const joinUrl = tautan(new URL(req.url), code);
      const svg = await QRCode.toString(joinUrl, { type: "svg", width: lebar, margin: 1 });
      return j({ joinUrl, qr: "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg) });
    }

    if (aksi === "export.csv") {
      if (!cekPin(req, env)) return j({ error: "PIN salah" }, 401);
      const r = await stub.fetch("https://do/csv", { headers: { "x-pin": req.headers.get("x-pin") || "" } });
      return new Response(r.body, { status: r.status, headers: { ...CORS, "content-type": "text/csv; charset=utf-8", "content-disposition": r.headers.get("content-disposition") || 'attachment; filename="quiziz.csv"' } });
    }

    if (["start", "skip", "pause", "resume", "stop", "reset", "add"].includes(aksi) && m === "POST") {
      if (!cekPin(req, env)) return j({ error: "PIN salah" }, 401);
      const body = await req.json().catch(() => ({}));
      const r = await stub.fetch("https://do/" + aksi, {
        method: "POST", headers: { "content-type": "application/json", "x-pin": req.headers.get("x-pin") || "" },
        body: JSON.stringify(body)
      });
      return new Response(r.body, { status: r.status, headers: { ...CORS, "content-type": "application/json; charset=utf-8" } });
    }
  }

  // ---------- arsip ----------
  if (bagi[0] === "api" && bagi[1] === "arsip") {
    if (!cekPin(req, env)) return j({ error: "PIN salah" }, 401);
    const id = bagi[2];
    if (!id) {
      const r = await aStub(env).fetch("https://arsip/list?limit=" + (url.searchParams.get("limit") || 30));
      return new Response(r.body, { status: r.status, headers: { ...CORS, "content-type": "application/json; charset=utf-8" } });
    }
    if (bagi[3] === "hapus") {
      const r = await aStub(env).fetch("https://arsip/hapus", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: Number(id) })
      });
      return new Response(r.body, { status: r.status, headers: { ...CORS, "content-type": "application/json; charset=utf-8" } });
    }
    const r = await aStub(env).fetch("https://arsip/get?id=" + encodeURIComponent(id));
    return new Response(r.body, { status: r.status, headers: { ...CORS, "content-type": "application/json; charset=utf-8" } });
  }

  if (p === "/ws") {
    const code = String(url.searchParams.get("code") || "").toUpperCase();
    if (!/^[A-Z0-9]{4,10}$/.test(code)) return new Response("kode tidak valid", { status: 400 });
    return qStub(env, code).fetch(req);
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
