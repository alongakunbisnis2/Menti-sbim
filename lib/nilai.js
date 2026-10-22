// Aturan main Penilaian (murni, tanpa I/O).

const SESI = ["Materi", "Outbound", "Performance", "Konten"];
const POIN_MIN = -100000, POIN_MAKS = 100000;

const rapikan = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
const potong = (s, n) => rapikan(s).slice(0, n);

// Kunci pembanding nama: "Adi ", " adi", "ADI" -> "adi"; titik/koma dibuang.
function kunciNama(s) {
  return rapikan(s)
    .toLowerCase()
    .replace(/[.,'’`]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function namaTampil(s) {
  const n = potong(s, 40);
  // Judul kata: "adi saputra" -> "Adi Saputra" (biarkan huruf kapital dalam kata seperti "Mc" apa adanya)
  return n.replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

function sesiValid(s) {
  const v = rapikan(s);
  const k = SESI.find((x) => x.toLowerCase() === v.toLowerCase());
  return k || null;
}

function poinValid(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n === 0) return { error: "Poin harus angka dan tidak nol." };
  if (n < POIN_MIN || n > POIN_MAKS) return { error: "Poin di luar batas wajar." };
  return { poin: n };
}

// Tempel daftar: "Nama, Kelompok" per baris (koma / titik-koma / tab).
function parseDaftar(teks) {
  const baris = String(teks || "").replace(/\r/g, "").split("\n");
  const out = [], lewat = new Set();
  let baris1 = true;
  for (const b of baris) {
    const t = b.trim();
    if (!t) continue;
    const sel = t.split(/\s*[,;\t]\s*/).filter((x) => x !== "");
    const nama = sel[0] || "";
    if (!nama) continue;
    if (baris1 && /^(nama|name)$/i.test(nama) && (!sel[1] || /kelompok|grup|group/i.test(sel[1]))) { baris1 = false; continue; }
    baris1 = false;
    const nama2 = potong(nama, 40);
    const kunci = kunciNama(nama2);
    if (!kunci || lewat.has(kunci)) continue;
    lewat.add(kunci);
    out.push({ nama: namaTampil(nama2), kelompok: potong(sel.slice(1).join(" "), 30) || "" });
  }
  return out.slice(0, 1000);
}

module.exports = { SESI, parseDaftar, kunciNama, namaTampil, sesiValid, poinValid, rapikan, potong };
