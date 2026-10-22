// Durable Object "Arsip": satu instance untuk semua riwayat kuis (indeks + isi).
const j = (o, s = 200) => new Response(JSON.stringify(o), {
  status: s, headers: { "content-type": "application/json; charset=utf-8" }
});

export class Arsip {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; this.siap = false; }
  sql() { return this.ctx.storage.sql; }
  skema() {
    if (this.siap) return;
    const s = this.sql();
    s.exec("CREATE TABLE IF NOT EXISTS riwayat(id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT, judul TEXT, dibuat INTEGER, selesai INTEGER, peserta INTEGER, soal INTEGER)");
    s.exec("CREATE TABLE IF NOT EXISTS isi(id INTEGER PRIMARY KEY, json TEXT)");
    this.siap = true;
  }

  async fetch(req) {
    const u = new URL(req.url), p = u.pathname.replace(/\/+$/, "") || "/";
    const m = req.method;
    this.skema();
    const s = this.sql();

    if (p === "/add" && m === "POST") {
      const b = await req.json().catch(() => null);
      if (!b || !b.code) return j({ error: "data kosong" }, 400);
      s.exec("INSERT INTO riwayat(code,judul,dibuat,selesai,peserta,soal) VALUES(?,?,?,?,?,?)",
        String(b.code), String(b.judul || "Quiziz"), Number(b.dibuat) || Date.now(),
        Number(b.selesai) || Date.now(), Number(b.peserta) || 0, Number(b.soal) || 0);
      const id = s.exec("SELECT last_insert_rowid() id").toArray()[0].id;
      s.exec("INSERT INTO isi(id,json) VALUES(?,?)", id, JSON.stringify({ ...b, id }));
      return j({ ok: true, id });
    }

    if (p === "/list") {
      const n = Math.min(100, Math.max(1, Number(u.searchParams.get("limit")) || 30));
      const rows = s.exec("SELECT id,code,judul,dibuat,selesai,peserta,soal FROM riwayat ORDER BY id DESC LIMIT ?", n).toArray();
      return j({ daftar: rows });
    }

    if (p === "/get") {
      const id = Number(u.searchParams.get("id"));
      const r = s.exec("SELECT json FROM isi WHERE id=?", id).toArray()[0];
      if (!r) return j({ error: "tidak ditemukan" }, 404);
      return j(JSON.parse(r.json));
    }

    if (p === "/hapus" && (m === "POST" || m === "DELETE")) {
      const b = m === "DELETE" ? { id: Number(u.searchParams.get("id")) } : await req.json().catch(() => ({}));
      const id = Number(b.id);
      if (!id) return j({ error: "id kosong" }, 400);
      s.exec("DELETE FROM isi WHERE id=?", id);
      s.exec("DELETE FROM riwayat WHERE id=?", id);
      return j({ ok: true });
    }

    return j({ error: "tidak dikenal" }, 404);
  }
}
