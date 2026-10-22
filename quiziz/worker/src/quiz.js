// Durable Object "Quiz": satu instance = satu sesi Quiziz (satu kode).
// Data disimpan di SQLite DO (bukan JSON blob) supaya aman untuk 400 peserta × banyak soal.
import * as Q from "../../../lib/quiziz.js";
import { cekPin } from "../../../lib/auth.js";

const j = (o, s = 200) => new Response(JSON.stringify(o), {
  status: s, headers: { "content-type": "application/json; charset=utf-8" }
});

export class Quiz {
  constructor(ctx, env) {
    this.ctx = ctx; this.env = env;
    this.q = null;                 // { code, judul, status, qIndex, deadline, questions[] }
    this.cur = new Map();          // pid -> { opt, at, benar, poin } untuk soal berjalan
    this.orang = new Map();        // pid -> nama
    this.skor = new Map();         // pid -> total poin
    this.siap = false;
    this.kotor = false;
    this.flushTerakhir = 0;
  }

  // ---------- skema & muat ----------
  sql() { return this.ctx.storage.sql; }
  skema() {
    if (this.siap) return;
    const s = this.sql();
    s.exec("CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT)");
    s.exec("CREATE TABLE IF NOT EXISTS soal(idx INTEGER PRIMARY KEY, teks TEXT, opsi TEXT, limit_s INTEGER, buka INTEGER DEFAULT 0)");
    s.exec("CREATE TABLE IF NOT EXISTS orang(pid TEXT PRIMARY KEY, nama TEXT, gabung INTEGER)");
    s.exec("CREATE TABLE IF NOT EXISTS jawab(q INTEGER, pid TEXT, opt TEXT, at INTEGER, benar INTEGER, poin INTEGER, PRIMARY KEY(q,pid))");
    this.siap = true;
  }
  meta() {
    const out = {};
    for (const r of this.sql().exec("SELECT k,v FROM meta").toArray()) out[r.k] = r.v;
    return out;
  }
  async boot() {
    if (this.q) return this.q;
    this.skema();
    const m = this.meta();
    if (!m.code) { this.q = null; return null; }
    const soal = this.sql().exec("SELECT idx,teks,opsi,limit_s FROM soal ORDER BY idx").toArray()
      .map((r) => ({ text: r.teks, options: JSON.parse(r.opsi), limit: Number(r.limit_s) || 20 }));
    this.q = {
      code: m.code, judul: m.judul || "Quiziz", status: m.status || "idle",
      qIndex: Number(m.qIndex) || 0, openedAt: Number(m.openedAt) || 0,
      deadline: Number(m.deadline) || 0, dibuat: Number(m.dibuat) || Date.now(),
      sisaJeda: Number(m.sisaJeda) || 0, run: Number(m.run) || 0, questions: soal
    };
    for (const r of this.sql().exec("SELECT pid,nama FROM orang").toArray()) this.orang.set(r.pid, r.nama);
    for (const r of this.sql().exec("SELECT pid,SUM(poin) s FROM jawab GROUP BY pid").toArray()) this.skor.set(r.pid, Number(r.s) || 0);
    if (this.q.status === "question" || this.q.status === "reveal") {
      for (const r of this.sql().exec("SELECT pid,opt,at,benar,poin FROM jawab WHERE q=?", this.q.qIndex).toArray())
        this.cur.set(r.pid, { opt: r.opt, at: r.at, benar: !!r.benar, poin: r.poin });
    }
    return this.q;
  }
  simpanMeta() {
    const m = this.q;
    const put = (k, v) => this.sql().exec("INSERT INTO meta(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", k, String(v));
    put("code", m.code); put("judul", m.judul); put("status", m.status);
    put("qIndex", m.qIndex); put("openedAt", m.openedAt); put("deadline", m.deadline);
    put("dibuat", m.dibuat); put("sisaJeda", m.sisaJeda || 0); put("run", m.run || 0);
  }
  simpanJawab() {
    this.skema();
    const q = this.q.qIndex;
    for (const [pid, a] of this.cur.entries()) {
      this.sql().exec(
        "INSERT INTO jawab(q,pid,opt,at,benar,poin) VALUES(?,?,?,?,?,?) ON CONFLICT(q,pid) DO UPDATE SET opt=excluded.opt,at=excluded.at,benar=excluded.benar,poin=excluded.poin",
        q, pid, a.opt, a.at, a.benar ? 1 : 0, a.poin);
    }
    this.kotor = false; this.flushTerakhir = Date.now();
  }
  mungkinSimpan() {
    if (this.kotor && Date.now() - this.flushTerakhir > 4000) this.simpanJawab();
  }
  async setNext(jenis, ms) {
    const at = Date.now() + ms;
    await this.ctx.storage.put("next", { jenis, at });
    await this.ctx.storage.setAlarm(at);
  }

  // ---------- state untuk layar ----------
  jawabPerOpsi() {
    const c = {};
    for (const a of this.cur.values()) c[a.opt] = (c[a.opt] || 0) + 1;
    return c;
  }
  statePlayer() {
    const m = this.q, hitung = this.jawabPerOpsi();
    const dasar = { code: m.code, judul: m.judul, status: m.status, qIndex: m.qIndex, run: m.run || 0,
      qTotal: m.questions.length, serverNow: Date.now(), peserta: this.orang.size, sudah: this.cur.size };
    if (m.status === "question") {
      const q = m.questions[m.qIndex] || { text: "", options: [], limit: 20 };
      dasar.question = { text: q.text, options: q.options.map((o) => ({ id: o.id, text: o.text })) };
      dasar.limit = q.limit; dasar.deadline = m.deadline;
      return dasar;
    }
    if (m.status === "reveal" || m.status === "finished") {
      const q = m.questions[m.qIndex] || { text: "", options: [] };
      dasar.question = {
        text: q.text,
        options: q.options.map((o) => ({ id: o.id, text: o.text, count: hitung[o.id] || 0, correct: !!o.correct }))
      };
      dasar.kunci = (q.options.find((o) => o.correct) || {}).id || null;
      dasar.deadline = m.deadline;
    }
    if (m.status === "finished") {
      const p = this.peringkat();
      dasar.top = Q.potongDaftar(p, 20);
      dasar.podium = Q.potongDaftar(p, 3);
    }
    return dasar;
  }
  stateHost() {
    const m = this.q, hitung = this.jawabPerOpsi();
    const p = this.peringkat();
    return {
      ...this.statePlayer(), role: "host",
      questions: m.questions.map((q, i) => ({ no: i + 1, text: q.text, limit: q.limit,
        options: q.options.map((o) => ({ id: o.id, text: o.text, correct: !!o.correct })) })),
      hitung, sudah: this.cur.size, peserta: this.orang.size,
      top: Q.potongDaftar(p, 10), peringkat: p, sisaJeda: m.sisaJeda || 0,
      mata: this.ctx.storage.sql.exec("SELECT COUNT(*) n FROM jawab").toArray()[0].n
    };
  }
  peringkat() {
    const rows = this.sql().exec(
      `SELECT j.pid pid, COALESCE(o.nama,'') nama, SUM(j.poin) skor, SUM(j.benar) benar, COUNT(*) jawab
       FROM jawab j LEFT JOIN orang o ON o.pid=j.pid GROUP BY j.pid`).toArray()
      .map((r) => ({ pid: r.pid, name: r.nama, score: Number(r.skor) || 0, benar: Number(r.benar) || 0, jawab: Number(r.jawab) || 0 }));
    return Q.susun(rows);
  }
  detailSoal() {
    return this.q.questions.map((q, i) => {
      const rows = this.sql().exec("SELECT opt,COUNT(*) n,SUM(benar) b FROM jawab WHERE q=? GROUP BY opt", i).toArray();
      const benarOpt = (q.options.find((o) => o.correct) || {}).id;
      let benar = 0, salah = 0;
      for (const r of rows) { if (r.opt === benarOpt) benar += Number(r.n); else salah += Number(r.n); }
      return { no: i + 1, teks: q.text, kunci: benarOpt,
        kunciTeks: (q.options.find((o) => o.correct) || {}).text || "", benar, salah,
        jawab: benar + salah, sebaran: rows.map((r) => ({ opt: r.opt, n: Number(r.n) })) };
    });
  }

  // ---------- siaran ----------
  sockets() { return this.ctx.getWebSockets(); }
  kirim(ws, e, d) { try { ws.send(JSON.stringify({ e, d })); } catch (err) {} }
  siar(e, d) { const s = JSON.stringify({ e, d }); for (const ws of this.sockets()) { try { ws.send(s); } catch (err) {} } }
  emit() {
    if (!this.q) return;
    const pemain = JSON.stringify({ e: "quiz:state", d: this.statePlayer() });
    const host = JSON.stringify({ e: "quiz:state", d: this.stateHost() });
    for (const ws of this.sockets()) {
      const att = (() => { try { return ws.deserializeAttachment?.() || {}; } catch (e) { return {}; } })();
      try { ws.send(att.role === "host" || att.role === "tv" ? host : pemain); } catch (e) {}
    }
  }
  kirimAku() {
    const p = this.peringkat();
    for (const ws of this.sockets()) {
      const att = (() => { try { return ws.deserializeAttachment?.() || {}; } catch (e) { return {}; } })();
      if (!att.pid || att.role === "host" || att.role === "tv") continue;
      const aku = p.find((r) => r.pid === att.pid);
      this.kirim(ws, "quiz:aku", aku ? { rank: aku.rank, score: aku.score, benar: aku.benar, total: p.length } : { rank: null, score: 0, benar: 0, total: p.length });
    }
  }

  // ---------- alur waktu ----------
  async alarm() {
    await this.boot();
    if (!this.q) return;
    const n = await this.ctx.storage.get("next");
    await this.ctx.storage.delete("next");
    if (!n) return;
    if (n.jenis === "tutup") await this.tutup(true);
    else if (n.jenis === "lanjut") await this.lanjut();
  }
  async tutup(otomatis) {
    if (this.q.status !== "question") return;
    this.simpanJawab();
    this.q.status = "reveal";
    this.q.deadline = Date.now() + Q.JEDA_KUNCI * 1000;   // hitung mundur kunci 5 dtk
    this.simpanMeta();
    this.emit();
    if (otomatis !== false) await this.setNext("lanjut", Q.JEDA_KUNCI * 1000);
  }
  async lanjut() {
    if (this.q.status !== "reveal") return;
    const berikut = this.q.qIndex + 1;
    if (berikut < this.q.questions.length) {
      this.q.qIndex = berikut;
      this.cur.clear();
      this.q.status = "question";
      this.q.openedAt = Date.now();
      this.sql().exec("UPDATE soal SET buka=? WHERE idx=?", this.q.openedAt, berikut);
      this.q.deadline = Date.now() + (this.q.questions[berikut].limit || 20) * 1000;
      this.simpanMeta();
      this.emit();
      await this.setNext("tutup", (this.q.questions[berikut].limit || 20) * 1000);
    } else {
      await this.selesai();
    }
  }
  async selesai() {
    this.simpanJawab();
    this.q.status = "finished";
    this.q.deadline = 0;
    this.simpanMeta();
    try { await this.ctx.storage.deleteAlarm(); } catch (e) {}
    const p = this.peringkat();
    try {
      const arsip = this.env.ARSIP.get(this.env.ARSIP.idFromName("arsip"));
      await arsip.fetch("https://arsip/add", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code: this.q.code, judul: this.q.judul, dibuat: this.q.dibuat, selesai: Date.now(),
          peserta: this.orang.size, soal: this.q.questions.length,
          ranking: p, detail: this.detailSoal()
        })
      });
    } catch (e) {}
    this.emit();
    this.kirimAku();
  }

  // ---------- WebSocket ----------
  // dipakai WS maupun HTTP (mode lambat bila websocket terhalang)
  async gabung(pid, nama) {
    this.orang.set(pid, nama);
    this.sql().exec("INSERT INTO orang(pid,nama,gabung) VALUES(?,?,?) ON CONFLICT(pid) DO UPDATE SET nama=excluded.nama",
      pid, nama, Date.now());
    return { ...this.statePlayer(), aku: { nama, total: this.skor.get(pid) || 0, sudah: this.cur.has(pid) } };
  }
  async jawab(pid, optionId) {
    if (!this.q || this.q.status !== "question") return { error: "Soal sudah ditutup." };
    if (this.cur.has(pid)) return { error: "Jawabanmu sudah terkirim — tidak bisa diubah." };
    if (Date.now() > this.q.deadline + 400) return { error: "Waktu habis." };
    const q = this.q.questions[this.q.qIndex];
    const opt = (q.options || []).find((o) => o.id === optionId);
    if (!opt) return { error: "Pilihan tidak dikenal." };
    const at = Date.now();
    const poin = Q.poin(!!opt.correct, at - this.q.openedAt, (q.limit || 20) * 1000);
    this.cur.set(pid, { opt: opt.id, at, benar: !!opt.correct, poin });
    this.skor.set(pid, (this.skor.get(pid) || 0) + poin);
    this.kotor = true; this.mungkinSimpan();
    return { ok: true, total: this.skor.get(pid) || 0, poin, benar: !!opt.correct, waktu: at - this.q.openedAt };
  }

  async webSocketMessage(ws, pesan) {
    let m; try { m = JSON.parse(typeof pesan === "string" ? pesan : new TextDecoder().decode(pesan)); } catch (e) { return; }
    await this.boot();
    const d = m.d || {}, e = m.e;
    const att0 = (() => { try { return ws.deserializeAttachment?.() || {}; } catch (err) { return {}; } })();

    if (e === "quiz:join") {
      const nama = Q.potong(d.nama, 24);
      const pid = String(d.pid || "").trim();
      if (!nama || !pid) return this.kirim(ws, "quiz:error", "Nama dan ID peserta wajib ada.");
      try { ws.serializeAttachment({ ...att0, pid, nama, role: "player" }); } catch (err) {}
      this.kirim(ws, "quiz:hai", await this.gabung(pid, nama));
      return;
    }

    const pid = String(att0.pid || d.pid || "").trim();
    if (!pid) return this.kirim(ws, "quiz:error", "Sesi peserta belum siap — muat ulang halaman.");

    if (e === "quiz:answer") {
      const r = await this.jawab(pid, d.optionId);
      this.kirim(ws, r.error ? "quiz:error" : "quiz:ack", r.error || r);
      return;
    }

    if (e === "quiz:sync") {
      this.kirim(ws, "quiz:hai", { ...this.statePlayer(), aku: { nama: att0.nama || "", total: this.skor.get(pid) || 0, sudah: this.cur.has(pid) } });
      return;
    }
  }
  async webSocketClose(ws) { try { ws.close(); } catch (e) {} }

  // ---------- HTTP ----------
  async fetch(req) {
    const u = new URL(req.url), p = u.pathname.replace(/\/+$/, "") || "/";
    const m = req.method;
    const body = m === "POST" ? await req.json().catch(() => ({})) : {};
    await this.boot();

    if (p === "/ws") {
      if ((req.headers.get("Upgrade") || "").toLowerCase() !== "websocket") return new Response("butuh websocket", { status: 426 });
      const role = (u.searchParams.get("role") || "player").toLowerCase();
      if (role === "host" && !cekPin(req, this.env)) return new Response("PIN salah", { status: 401 });
      if (!this.q) return new Response("Kuis tidak ditemukan", { status: 404 });
      const pasangan = new WebSocketPair();
      const client = pasangan[0], server = pasangan[1];
      const nama = Q.potong(u.searchParams.get("name"), 24);
      const pid = (u.searchParams.get("pid") || "").trim();
      this.ctx.acceptWebSocket(server);
      try { server.serializeAttachment({ role, pid, nama }); } catch (e) {}
      if (role === "host" || role === "tv") this.kirim(server, "quiz:state", this.stateHost());
      else this.kirim(server, "quiz:hai", { ...this.statePlayer(), aku: { nama: this.orang.get(pid) || nama, total: this.skor.get(pid) || 0, sudah: this.cur.has(pid) } });
      return new Response(null, { status: 101, webSocket: client });
    }

    const terbuka = (p === "/state" && (u.searchParams.get("view") || "") !== "host") || p === "/gabung" || p === "/jawab";
    if (!terbuka && !cekPin(req, this.env)) return j({ error: "PIN salah" }, 401);

    if (p === "/create") {
      const soal = Array.isArray(body.questions) ? body.questions : [];
      const s = this.sql();
      s.exec("DELETE FROM jawab"); s.exec("DELETE FROM orang"); s.exec("DELETE FROM soal"); s.exec("DELETE FROM meta");
      const ins = "INSERT INTO soal(idx,teks,opsi,limit_s,buka) VALUES(?,?,?,?,0)";
      soal.forEach((q, i) => s.exec(ins, i, q.text, JSON.stringify(q.options), q.limit || 20));
      this.q = { code: String(body.code || "").toUpperCase(), judul: Q.potong(body.judul, 60) || "Quiziz SBIM",
        status: "idle", qIndex: 0, openedAt: 0, deadline: 0, dibuat: Date.now(), sisaJeda: 0, run: 0, questions: soal };
      this.cur.clear(); this.orang.clear(); this.skor.clear();
      this.simpanMeta();
      return j({ code: this.q.code, qTotal: soal.length });
    }

    if (!this.q) return j({ error: "Kuis tidak ditemukan" }, 404);

    if (p === "/state") {
      const v = u.searchParams.get("view") || "";
      if (v === "host") return j(this.stateHost());
      if (v === "tv") { const d = this.stateHost(); delete d.questions; delete d.peringkat; return j(d); }
      return j(this.statePlayer());
    }

    if (p === "/start") {
      if (this.q.status === "finished" || this.q.status === "idle") {
        if (this.q.status === "finished") { this.sql().exec("DELETE FROM jawab"); this.skor.clear(); }
        this.q.run = (this.q.run || 0) + 1;
        this.q.qIndex = 0; this.cur.clear();
        this.q.status = "question";
        this.q.openedAt = Date.now();
        this.sql().exec("UPDATE soal SET buka=? WHERE idx=0", this.q.openedAt);
        this.q.deadline = Date.now() + (this.q.questions[0].limit || 20) * 1000;
        this.simpanMeta(); this.emit();
        await this.setNext("tutup", (this.q.questions[0].limit || 20) * 1000);
        return j({ ok: true, status: this.q.status });
      }
      return j({ error: "Kuis sedang berjalan." }, 409);
    }

    if (p === "/skip") {
      if (this.q.status === "question") { await this.tutup(true); return j({ ok: true, status: this.q.status }); }
      if (this.q.status === "reveal") { await this.lanjut(); return j({ ok: true, status: this.q.status }); }
      return j({ error: "Tidak ada soal berjalan." }, 409);
    }

    if (p === "/pause") {
      if (this.q.status !== "question") return j({ error: "Hanya saat soal berjalan." }, 409);
      this.q.sisaJeda = Math.max(2000, this.q.deadline - Date.now());
      this.q.status = "paused"; this.simpanMeta();
      try { await this.ctx.storage.deleteAlarm(); } catch (e) {}
      await this.ctx.storage.delete("next");
      this.emit();
      return j({ ok: true, sisa: this.q.sisaJeda });
    }

    if (p === "/resume") {
      if (this.q.status !== "paused") return j({ error: "Tidak sedang dijeda." }, 409);
      const sisa = this.q.sisaJeda || 5000;
      this.q.status = "question";
      this.q.deadline = Date.now() + sisa;
      this.q.openedAt = Date.now() - Math.max(0, (this.q.questions[this.q.qIndex].limit || 20) * 1000 - sisa);
      this.simpanMeta(); this.emit();
      await this.setNext("tutup", sisa);
      return j({ ok: true, sisa });
    }

    if (p === "/stop") { await this.selesai(); return j({ ok: true, status: this.q.status }); }

    if (p === "/reset") {
      this.sql().exec("DELETE FROM jawab"); this.skor.clear(); this.cur.clear();
      this.q.status = "idle"; this.q.qIndex = 0; this.q.deadline = 0; this.q.sisaJeda = 0;
      this.simpanMeta();
      try { await this.ctx.storage.deleteAlarm(); } catch (e) {}
      await this.ctx.storage.delete("next");
      this.emit();
      return j({ ok: true });
    }

    if (p === "/add") {
      const hasil = Q.parseBulk(body.teks || "", body.limit);
      if (hasil.error) return j({ error: hasil.error }, 400);
      const mulai = this.q.questions.length;
      const ins = "INSERT INTO soal(idx,teks,opsi,limit_s,buka) VALUES(?,?,?,?,0)";
      hasil.questions.forEach((q, i) => {
        this.sql().exec(ins, mulai + i, q.text, JSON.stringify(q.options), q.limit || 20);
        this.q.questions.push(q);
      });
      this.simpanMeta(); this.emit();
      return j({ ok: true, qTotal: this.q.questions.length, tambah: hasil.questions.length });
    }

    if (p === "/gabung" && m === "POST") {
      const pid = String(body.pid || "").trim(), nama = Q.potong(body.nama, 24);
      if (!pid || !nama) return j({ error: "Nama dan ID peserta wajib ada." }, 400);
      return j(await this.gabung(pid, nama));
    }

    if (p === "/jawab" && m === "POST") {
      const pid = String(body.pid || "").trim();
      if (!pid) return j({ error: "ID peserta kosong." }, 400);
      const r = await this.jawab(pid, body.optionId);
      return j(r, r.error ? 409 : 200);
    }

    if (p === "/csv") {
      if (this.kotor) this.simpanJawab();
      const baris = [["soal_no", "soal", "nama", "jawaban", "benar", "poin", "waktu_ms"]];
      const rows = this.sql().exec(
        `SELECT j.q q, j.pid pid, j.opt opt, j.at at, j.benar benar, j.poin poin, COALESCE(o.nama,'') nama, COALESCE(s.buka,0) buka
         FROM jawab j LEFT JOIN orang o ON o.pid=j.pid LEFT JOIN soal s ON s.idx=j.q ORDER BY j.q, j.poin DESC`).toArray();
      for (const r of rows) {
        const qq = this.q.questions[r.q] || { text: "", options: [] };
        const opt = (qq.options || []).find((o) => o.id === r.opt) || { text: "" };
        baris.push([r.q + 1, qq.text, r.nama, opt.id + ". " + opt.text, r.benar ? "ya" : "tidak", r.poin, Math.max(0, r.at - (r.buka || this.q.openedAt))]);
      }
      const csv = "\uFEFF" + baris.map((b) => b.map((x) => {
        const s = String(x == null ? "" : x);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(",")).join("\r\n");
      return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="quiziz-' + this.q.code + '.csv"' } });
    }

    return j({ error: "Aksi tidak dikenal" }, 404);
  }
}
