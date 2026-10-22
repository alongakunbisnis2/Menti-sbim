// Durable Object "Ledger": buku besar poin Penilaian (satu instance global).
import * as N from "../../../lib/nilai.js";

const j = (o, s = 200) => new Response(JSON.stringify(o), {
  status: s, headers: { "content-type": "application/json; charset=utf-8" }
});
const SESI = N.SESI;

export class Ledger {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; this.siap = false; }

  sql() { return this.ctx.storage.sql; }
  skema() {
    if (this.siap) return;
    const s = this.sql();
    s.exec("CREATE TABLE IF NOT EXISTS peserta(id INTEGER PRIMARY KEY AUTOINCREMENT, nama TEXT, key TEXT UNIQUE, kelompok TEXT, at INTEGER)");
    s.exec("CREATE TABLE IF NOT EXISTS entri(id INTEGER PRIMARY KEY AUTOINCREMENT, pid INTEGER, sesi TEXT, kegiatan TEXT, poin INTEGER, catatan TEXT, oleh TEXT, at INTEGER)");
    s.exec("CREATE TABLE IF NOT EXISTS kegiatan(id INTEGER PRIMARY KEY AUTOINCREMENT, sesi TEXT, nama TEXT, urut INTEGER)");
    s.exec("CREATE UNIQUE INDEX IF NOT EXISTS kegiatan_uniq ON kegiatan(sesi,nama)");
    s.exec("CREATE INDEX IF NOT EXISTS entri_pid ON entri(pid)");
    this.siap = true;
  }

  // ---------- baca ----------
  peringkat() {
    const rows = this.sql().exec(
      `SELECT p.id id, p.nama nama, p.kelompok kelompok,
              COALESCE(SUM(e.poin),0) total, COUNT(e.id) entri,
              COALESCE(SUM(CASE WHEN e.sesi='Materi' THEN e.poin END),0) s_materi,
              COALESCE(SUM(CASE WHEN e.sesi='Outbound' THEN e.poin END),0) s_outbound,
              COALESCE(SUM(CASE WHEN e.sesi='Performance' THEN e.poin END),0) s_performance,
              COALESCE(SUM(CASE WHEN e.sesi='Konten' THEN e.poin END),0) s_konten
       FROM peserta p LEFT JOIN entri e ON e.pid=p.id
       GROUP BY p.id ORDER BY total DESC, p.nama COLLATE NOCASE ASC`).toArray();
    const out = rows.map((r) => ({
      id: r.id, name: r.nama || "", kelompok: r.kelompok || "", score: Number(r.total) || 0,
      entri: Number(r.entri) || 0,
      sesi: { Materi: Number(r.s_materi) || 0, Outbound: Number(r.s_outbound) || 0,
        Performance: Number(r.s_performance) || 0, Konten: Number(r.s_konten) || 0 }
    }));
    let rank = 0, sebelum = null;
    out.forEach((r, i) => {
      if (r.score !== sebelum) { rank = i + 1; sebelum = r.score; }
      r.rank = rank;
    });
    return out;
  }
  lcd() {
    const p = this.peringkat();
    const t = this.sql().exec("SELECT COUNT(*) n FROM peserta").toArray()[0].n;
    const e = this.sql().exec(
      `SELECT e.id id, e.poin poin, e.sesi sesi, e.kegiatan kegiatan, e.at at, p.nama nama
       FROM entri e LEFT JOIN peserta p ON p.id=e.pid ORDER BY e.id DESC LIMIT 1`).toArray()[0];
    return {
      top: p.slice(0, 8), peserta: Number(t) || 0,
      totalPoin: p.reduce((a, r) => a + r.score, 0),
      terakhir: e ? { id: e.id, nama: e.nama || "", poin: Number(e.poin) || 0, sesi: e.sesi, kegiatan: e.kegiatan, at: e.at } : null,
      at: Date.now()
    };
  }
  state() {
    const p = this.peringkat();
    const entri = this.sql().exec(
      `SELECT e.id id, e.poin poin, e.sesi sesi, e.kegiatan kegiatan, e.catatan catatan, e.oleh oleh, e.at at,
              p.nama nama, p.kelompok kelompok
       FROM entri e LEFT JOIN peserta p ON p.id=e.pid ORDER BY e.id DESC LIMIT 30`).toArray();
    const keg = this.sql().exec("SELECT sesi,nama FROM kegiatan ORDER BY sesi, urut, nama").toArray();
    return {
      peserta: p.length, totalPoin: p.reduce((a, r) => a + r.score, 0),
      top: p.slice(0, 25), semua: p,
      entri: entri.map((r) => ({ id: r.id, nama: r.nama || "", kelompok: r.kelompok || "", poin: r.poin,
        sesi: r.sesi, kegiatan: r.kegiatan, catatan: r.catatan || "", oleh: r.oleh || "", at: r.at })),
      kegiatan: keg, at: Date.now()
    };
  }
  siar() {
    const d = this.lcd();
    const s = JSON.stringify({ e: "nilai:update", d });
    for (const ws of this.ctx.getWebSockets()) { try { ws.send(s); } catch (e) {} }
  }

  // ---------- tulis ----------
  pesertaDari(nama, kelompok) {
    const tampil = N.namaTampil(nama);
    const key = N.kunciNama(tampil);
    if (!key) return null;
    const ada = this.sql().exec("SELECT id,nama,kelompok FROM peserta WHERE key=?", key).toArray()[0];
    if (ada) {
      if (kelompok && !ada.kelompok) this.sql().exec("UPDATE peserta SET kelompok=? WHERE id=?", kelompok, ada.id);
      return { id: ada.id, nama: ada.nama };
    }
    this.sql().exec("INSERT INTO peserta(nama,key,kelompok,at) VALUES(?,?,?,?)", tampil, key, kelompok || "", Date.now());
    const id = this.sql().exec("SELECT last_insert_rowid() id").toArray()[0].id;
    return { id, nama: tampil };
  }

  async fetch(req) {
    const u = new URL(req.url), p = u.pathname.replace(/\/+$/, "") || "/", m = req.method;
    this.skema();
    const body = m === "POST" ? await req.json().catch(() => ({})) : {};

    if (p === "/ws") {
      if ((req.headers.get("Upgrade") || "").toLowerCase() !== "websocket") return new Response("butuh websocket", { status: 426 });
      const pasangan = new WebSocketPair();
      const client = pasangan[0], server = pasangan[1];
      this.ctx.acceptWebSocket(server);
      try { server.serializeAttachment({ role: u.searchParams.get("role") || "tv" }); } catch (e) {}
      this.kirim(server, "nilai:update", this.lcd());
      return new Response(null, { status: 101, webSocket: client });
    }

    if (p === "/lcd") return j(this.lcd());
    if (p === "/state") return j(this.state());

    if (p === "/tambah" && m === "POST") {
      const nama = N.rapikan(body.nama);
      if (!nama) return j({ error: "Nama wajib diisi." }, 400);
      const sesi = N.sesiValid(body.sesi) || SESI[0];
      const pv = N.poinValid(body.poin);
      if (pv.error) return j({ error: pv.error }, 400);
      const orang = this.pesertaDari(nama, N.potong(body.kelompok, 30));
      if (!orang) return j({ error: "Nama tidak valid." }, 400);
      const keg = N.potong(body.kegiatan, 60) || "Umum";
      this.sql().exec("INSERT INTO kegiatan(sesi,nama,urut) VALUES(?,?,?)", sesi, keg, 999);
      this.sql().exec("INSERT INTO entri(pid,sesi,kegiatan,poin,catatan,oleh,at) VALUES(?,?,?,?,?,?,?)",
        orang.id, sesi, keg, pv.poin, N.potong(body.catatan, 120), N.potong(body.oleh, 24) || "panitia", Date.now());
      const id = this.sql().exec("SELECT last_insert_rowid() id").toArray()[0].id;
      this.siar();
      return j({ ok: true, id, nama: orang.nama, poin: pv.poin, lcd: this.lcd() });
    }

    if (p === "/hapus" && m === "POST") {
      const id = Number(body.id);
      if (!id) return j({ error: "id kosong" }, 400);
      const e = this.sql().exec("SELECT id,pid,poin,sesi,kegiatan FROM entri WHERE id=?", id).toArray()[0];
      if (!e) return j({ error: "Entri tidak ditemukan" }, 404);
      this.sql().exec("DELETE FROM entri WHERE id=?", id);
      // peserta tanpa entri & tanpa kelompok dibiarkan (daftar tetap utuh)
      this.siar();
      return j({ ok: true, dihapus: { id: e.id, poin: e.poin, sesi: e.sesi, kegiatan: e.kegiatan } });
    }

    if (p === "/import" && m === "POST") {
      const daftar = N.parseDaftar(body.teks || "");
      if (!daftar.length) return j({ error: "Tidak ada baris yang bisa dibaca. Format: Nama, Kelompok" }, 400);
      let baru = 0;
      for (const d of daftar) {
        const key = N.kunciNama(d.nama);
        if (!key) continue;
        const ada = this.sql().exec("SELECT id FROM peserta WHERE key=?", key).toArray()[0];
        if (ada) {
          if (d.kelompok) this.sql().exec("UPDATE peserta SET kelompok=? WHERE id=?", d.kelompok, ada.id);
        } else {
          this.sql().exec("INSERT INTO peserta(nama,key,kelompok,at) VALUES(?,?,?,?)", d.nama, key, d.kelompok, Date.now());
          baru++;
        }
      }
      this.siar();
      return j({ ok: true, baru, total: daftar.length, peserta: this.sql().exec("SELECT COUNT(*) n FROM peserta").toArray()[0].n });
    }

    if (p === "/kegiatan" && m === "POST") {
      const sesi = N.sesiValid(body.sesi);
      const nama = N.potong(body.nama, 60);
      if (!sesi || !nama) return j({ error: "Sesi dan nama kegiatan wajib." }, 400);
      this.sql().exec("INSERT OR IGNORE INTO kegiatan(sesi,nama,urut) VALUES(?,?,?)", sesi, nama, 999);
      this.siar();
      return j({ ok: true });
    }

    if (p === "/reset" && m === "POST") {
      if (String(body.konfirmasi || "") !== "HAPUS SEMUA") return j({ error: "Tulis konfirmasi: HAPUS SEMUA" }, 400);
      this.sql().exec("DELETE FROM entri"); this.sql().exec("DELETE FROM peserta"); this.sql().exec("DELETE FROM kegiatan");
      this.siar();
      return j({ ok: true });
    }

    if (p === "/csv") {
      const p2 = this.peringkat();
      const baris = [["nama", "kelompok", "materi", "outbound", "performance", "konten", "total", "jumlah_entri"]];
      for (const r of p2) baris.push([r.name, r.kelompok, r.sesi.Materi, r.sesi.Outbound, r.sesi.Performance, r.sesi.Konten, r.score, r.entri]);
      const csv = "\uFEFF" + baris.map((b) => b.map((x) => {
        const s = String(x == null ? "" : x);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(",")).join("\r\n");
      return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="penilaian-sbim.csv"' } });
    }

    return j({ error: "tidak dikenal" }, 404);
  }

  kirim(ws, e, d) { try { ws.send(JSON.stringify({ e, d })); } catch (err) {} }
  async webSocketMessage(ws, pesan) {
    let m; try { m = JSON.parse(typeof pesan === "string" ? pesan : new TextDecoder().decode(pesan)); } catch (e) { return; }
    if (m.e === "nilai:sync") this.kirim(ws, "nilai:update", this.lcd());
  }
  async webSocketClose(ws) { try { ws.close(); } catch (e) {} }
}
