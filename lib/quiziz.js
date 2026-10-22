// Aturan main Quiziz (murni, tanpa I/O) — dipakai Worker & (nanti) server LAN.

const HURUF = ["A", "B", "C", "D", "E", "F"];
const LIMIT_BAWAAN = 20;      // detik per soal
const POIN_MAKS = 1000;       // benar di detik 0
const POIN_MIN = 500;         // benar di detik terakhir
const JEDA_KUNCI = 5;         // detik tampil kunci sebelum lanjut

const rapikan = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
const potong = (s, n) => rapikan(s).slice(0, n);

function batas(n, lo, hi, bawaan) {
  const v = Number(n);
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : bawaan;
}

// ---- pembaca soal massal ----
// Bentuk yang diterima:
//   1) Satu baris:  Soal? | Opsi A | Opsi B* | Opsi C        (* = kunci)
//   2) Blok:        Soal?
//                   Opsi A
//                   Opsi B *
//                   (baris kosong memisahkan soal)
//   3) Awalan "Q:" / "#" boleh dipakai, baris "//" diabaikan.
function parseBulk(teks, limit) {
  const baris = String(teks || "").replace(/\r/g, "").split("\n");
  const blok = [];
  let kini = [];
  const tutup = () => {
    const isi = kini.filter((b) => b.trim() && !b.trim().startsWith("//"));
    if (isi.length) blok.push(isi);
    kini = [];
  };
  for (const b of baris) {
    if (!b.trim()) { tutup(); continue; }
    kini.push(b);
  }
  tutup();

  if (!blok.length) return { error: "Soal masih kosong. Tulis minimal satu soal dengan dua pilihan." };

  const soal = [];
  for (let i = 0; i < blok.length; i++) {
    const b = blok[i];
    let tanya, opsi;
    if (b.length === 1 && b[0].includes("|")) {
      const sel = b[0].split("|").map((x) => x.trim());
      tanya = sel.shift(); opsi = sel;
    } else if (b.length === 1) {
      return { error: `Soal ${i + 1}: butuh minimal dua pilihan jawaban (pisahkan dengan | atau baris baru).` };
    } else {
      tanya = b[0]; opsi = b.slice(1);
    }
    tanya = rapikan(tanya.replace(/^(q|soal)\s*[:.]\s*/i, "").replace(/^#\s*/, ""));
    opsi = opsi.flatMap((x) => (x.includes("|") ? x.split("|") : [x])).map(rapikan).filter(Boolean);

    if (!tanya) return { error: `Soal ${i + 1}: teks soal kosong.` };
    if (opsi.length < 2) return { error: `Soal ${i + 1}: minimal dua pilihan.` };
    if (opsi.length > 6) return { error: `Soal ${i + 1}: maksimal enam pilihan.` };

    const bersih = [];
    let kunci = 0;
    opsi.forEach((o, j) => {
      let teksOpsi = o, benar = false;
      if (/\*\s*$/.test(teksOpsi)) { benar = true; teksOpsi = teksOpsi.replace(/\*\s*$/, "").trim(); }
      if (/^\[x\]\s*/i.test(teksOpsi)) { benar = true; teksOpsi = teksOpsi.replace(/^\[x\]\s*/i, ""); }
      if (!teksOpsi) return;
      if (benar) kunci++;
      bersih.push({ id: HURUF[j], text: potong(teksOpsi, 120), correct: benar });
    });
    if (bersih.length < 2) return { error: `Soal ${i + 1}: minimal dua pilihan berisi teks.` };
    if (kunci === 0) return { error: `Soal ${i + 1}: belum ada kunci jawaban — akhiri pilihan yang benar dengan tanda *` };
    if (kunci > 1) return { error: `Soal ${i + 1}: ada ${kunci} kunci jawaban — cukup satu.` };

    soal.push({ text: potong(tanya, 220), options: bersih, limit: batas(limit, 5, 120, LIMIT_BAWAAN) });
  }
  return { questions: soal.slice(0, 60) };
}

// ---- poin: benar & cepat = lebih besar (1000 -> 500 selama 20 dtk) ----
function poin(benar, elapsedMs, limitMs) {
  if (!benar) return 0;
  const lim = Math.max(1000, Number(limitMs) || LIMIT_BAWAAN * 1000);
  const t = Math.min(lim, Math.max(0, Number(elapsedMs) || 0));
  return Math.round(POIN_MAKS - (POIN_MAKS - POIN_MIN) * (t / lim));
}

// ---- peringkat dengan seri yang jujur (1,1,3) ----
function susun(rows) {
  const bersih = (rows || []).map((r) => ({
    pid: r.pid || "", name: potong(r.name, 24) || "Tanpa nama",
    score: Number(r.score) || 0, benar: Number(r.benar) || 0, jawab: Number(r.jawab) || 0
  }));
  bersih.sort((a, b) =>
    b.score - a.score || b.benar - a.benar || a.name.localeCompare(b.name, "id"));
  let rank = 0, sebelum = null;
  bersih.forEach((r, i) => {
    const kunci = r.score + "|" + r.benar;
    if (kunci !== sebelum) { rank = i + 1; sebelum = kunci; }
    r.rank = rank;
  });
  return bersih;
}

function potongDaftar(rows, n) { return (rows || []).slice(0, n || 20); }

module.exports = {
  HURUF, LIMIT_BAWAAN, POIN_MAKS, POIN_MIN, JEDA_KUNCI,
  parseBulk, parseList, poin, susun, potongDaftar, rapikan, potong, batas
};

// ---- pembaca soal dari JSON (panel) ----
function parseList(arr, limit) {
  if (!Array.isArray(arr) || !arr.length) return { error: "Belum ada soal." };
  const soal = [];
  for (let i = 0; i < arr.length && i < 60; i++) {
    const s = arr[i] || {};
    const tanya = rapikan(s.text || s.teks || s.soal || s.q || "");
    const opsi = Array.isArray(s.options) ? s.options : Array.isArray(s.opsi) ? s.opsi : Array.isArray(s.pilihan) ? s.pilihan : [];
    if (!tanya) return { error: `Soal ${i + 1}: teks soal kosong.` };
    if (opsi.length < 2) return { error: `Soal ${i + 1}: minimal dua pilihan.` };
    if (opsi.length > 6) return { error: `Soal ${i + 1}: maksimal enam pilihan.` };
    let kunci = rapikan(s.correct != null ? s.correct : s.kunci != null ? s.kunci : "").toUpperCase();
    const bersih = [];
    opsi.forEach((o, j) => {
      let teks = typeof o === "string" ? o : rapikan((o && (o.text || o.teks || o.label)) || "");
      let benar = typeof o === "object" && o ? !!(o.correct || o.benar) : false;
      if (/\*\s*$/.test(teks)) { benar = true; teks = teks.replace(/\*\s*$/, "").trim(); }
      teks = potong(teks, 120);
      if (!teks) return;
      bersih.push({ id: HURUF[bersih.length], text: teks, correct: benar });
    });
    if (kunci) {
      const pos = /^[A-F]$/.test(kunci) ? HURUF.indexOf(kunci) : (/^\d+$/.test(kunci) ? Number(kunci) - 1 : -1);
      if (pos >= 0 && pos < bersih.length) bersih.forEach((b, j) => { b.correct = j === pos; });
    }
    if (bersih.length < 2) return { error: `Soal ${i + 1}: minimal dua pilihan berisi teks.` };
    const n = bersih.filter((b) => b.correct).length;
    if (n !== 1) return { error: `Soal ${i + 1}: tandai tepat satu kunci jawaban (sekarang ${n}).` };
    soal.push({ text: potong(tanya, 220), options: bersih, limit: batas(s.limit, 5, 120, batas(limit, 5, 120, LIMIT_BAWAAN)) });
  }
  return { questions: soal };
}
