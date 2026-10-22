// Pembuat soal otomatis (Workers AI) — materi/topik -> soal pilihan ganda 4 opsi.
// Mengembalikan teks siap tempel untuk parser `parseBulk` (kunci ditandai *).
const MODELS = ["@cf/qwen/qwen3-30b-a3b-fp8", "@cf/meta/llama-3.1-8b-instruct-fp8", "@cf/meta/llama-3.3-70b-instruct-fp8-fast"];
const j = (o, s = 200) => new Response(JSON.stringify(o), {
  status: s, headers: { "content-type": "application/json; charset=utf-8" }
});
const rapikan = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
const potong = (s, n) => rapikan(s).slice(0, n);

function sistem(mode) {
  return `Kamu penyusun soal kuis berbahasa Indonesia untuk SBIM Camp (School of Business Innovation and Management, Universitas Surabaya).
Tugas: buat soal pilihan ganda dari ${mode === "topik" ? "TOPIK" : "MATERI"} yang diberikan pengguna.
Aturan wajib:
- Tepat 4 opsi per soal, hanya SATU yang benar.
- Soal menguji pemahaman; kalimat soal maksimal 140 karakter, opsi maksimal 60 karakter.
- Jangan memakai opsi "semua benar", "semua salah", atau "tidak ada jawaban".
- Sebarkan posisi kunci secara merata (A/B/C/D), jangan selalu A.
- Bahasa Indonesia sederhana, tanpa singkatan yang tidak dijelaskan.
- ${mode === "topik" ? "Gunakan pengetahuan umum yang benar dan relevan; jangan mengarang istilah." : "Jangan menambah fakta yang tidak ada di materi. Jika materi tipis, buat soal dari konsep yang tersirat."}
Balas HANYA baris-baris soal, satu soal per baris, tanpa penomoran dan tanpa kalimat pembuka:
pertanyaan||opsi A||opsi B||opsi C||opsi D||2
Angka terakhir = nomor opsi yang benar (1-4). Jangan memakai tanda || di dalam teks.`;
}

function ambilJson(s) {
  const t = String(s == null ? "" : s).replace(/```json/gi, "").replace(/```/g, "").trim();
  const a = t.indexOf("{");
  if (a < 0) return null;
  // pindai objek berimbang: abaikan kurung di dalam string, berhenti di objek pertama yang utuh
  let dalam = false, escape = false, level = 0;
  for (let i = a; i < t.length; i++) {
    const c = t[i];
    if (dalam) {
      if (escape) escape = false;
      else if (c === "\\") escape = true;
      else if (c === '"') dalam = false;
      continue;
    }
    if (c === '"') { dalam = true; continue; }
    if (c === "{") level++;
    else if (c === "}") {
      level--;
      if (level === 0) {
        try { return JSON.parse(t.slice(a, i + 1)); } catch (e) { return null; }
      }
    }
  }
  return null;
}

function bersihkan(arr, n) {
  const out = [], pakai = new Set(), tolak = [];
  for (const s of Array.isArray(arr) ? arr : []) {
    const teks = potong(s && s.teks, 220);
    const opsi = (Array.isArray(s && s.opsi) ? s.opsi : [])
      .map((x) => potong(String(x == null ? "" : x).replace(/^\s*[A-Da-d][.)]\s+/, ""), 120)).filter(Boolean);
    let kunci = s && s.kunci;
    if (typeof kunci === "string" && /^[A-Da-d]$/.test(kunci.trim())) kunci = "ABCD".indexOf(kunci.trim().toUpperCase());
    kunci = Number(kunci);
    if (!teks) { tolak.push("teks kosong"); continue; }
    if (opsi.length !== 4) { tolak.push("opsi " + opsi.length); continue; }
    if (!Number.isInteger(kunci) || kunci < 0 || kunci > 3) { tolak.push("kunci " + (s && s.kunci)); continue; }
    const unik = new Set(opsi.map((x) => x.toLowerCase()));
    if (unik.size !== 4) continue;
    const k = teks.toLowerCase();
    if (pakai.has(k)) continue;
    pakai.add(k);
    out.push({ teks, opsi, kunci, penjelasan: potong(s.penjelasan, 200) });
    if (out.length >= n) break;
  }
  return { soal: out, tolak };
}

function dariBaris(teks, n) {
  const soal = [];
  for (const baris of String(teks || "").replace(/\r/g, "").split("\n")) {
    const b = baris.trim().replace(/^[-*\d.\s]+/, "");
    if (!b.includes("||")) continue;
    const sel = b.split("||").map((x) => x.trim());
    if (sel.length < 6) continue;
    const kunci = Number(sel.pop()) - 1;
    const tanya = sel.shift();
    if (!tanya || sel.length !== 4 || !Number.isInteger(kunci) || kunci < 0 || kunci > 3) continue;
    soal.push({ teks: tanya, opsi: sel.map((x) => x.replace(/^\s*[A-Da-d][.)]\s+/, "").trim()), kunci, penjelasan: "" });
    if (soal.length >= n) break;
  }
  return soal;
}

function keTeks(soal) {
  return soal.map((s) => [s.teks, ...s.opsi.map((o, i) => o + (i === s.kunci ? " *" : ""))].join("\n")).join("\n\n");
}

export async function buatSoal(req, env, cekPin) {
  if (!cekPin(req, env)) return j({ error: "PIN salah" }, 401);
  if (!env.AI) return j({ error: "Fitur AI belum aktif di Worker ini (binding AI tidak ada)." }, 503);

  const b = await req.json().catch(() => ({}));
  const materi = String(b.materi || "").trim();
  const mode = b.mode === "topik" ? "topik" : "materi";
  const n = Math.max(3, Math.min(12, Number(b.jumlah) || 5));
  if (materi.length < 25) return j({ error: "Tulis materi/topik minimal 25 karakter." }, 400);
  if (materi.length > 8000) return j({ error: "Materi terlalu panjang (maks 8.000 karakter)." }, 400);

  const pesan = [
    { role: "system", content: sistem(mode) },
    { role: "user", content: `${mode === "topik" ? "TOPIK" : "MATERI"}:\n${materi}\n\nBuat ${n} soal sekarang.` }
  ];

  let terakhirErr = "", hasil = null, model = "", debug = "";
  for (const m of MODELS) {
    for (let coba = 0; coba < 2 && !hasil; coba++) {
      try {
        const r = await env.AI.run(m, {
          messages: pesan,
          max_tokens: 4096,
          temperature: coba === 0 ? 0.6 : 0.2
        });
        const mentah = r && (r.response || r.result || r);
        const teksMentah = typeof mentah === "string" ? mentah : JSON.stringify(mentah || "");
        if (!debug) debug = teksMentah.slice(0, 300) + " … " + teksMentah.slice(-200);
        let cek = { soal: dariBaris(teksMentah, n), tolak: [] };
        if (!cek.soal.length) {
          const data = ambilJson(teksMentah);
          cek = data ? bersihkan(data.soal, n) : { soal: [], tolak: [] };
        }
        const soal = bersihkan(cek.soal, n).soal;
        if (soal.length) { hasil = soal; model = m; break; }
        terakhirErr = "Bentuk soal tidak lengkap (" + ((cek.tolak || []).slice(0, 3).join("; ") || "tidak ada baris valid") + ").";
      } catch (e) {
        terakhirErr = String((e && e.message) || e).slice(0, 200);
      }
    }
    if (hasil) break;
  }

  if (!hasil) return j({ error: "Gagal membuat soal: " + (terakhirErr || "AI tidak merespons"), model, debug }, 502);

  // acak posisi opsi supaya kunci tidak selalu di A
  hasil = hasil.map((s) => {
    const idx = s.opsi.map((_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) {
      const k = Math.floor(Math.random() * (i + 1));
      [idx[i], idx[k]] = [idx[k], idx[i]];
    }
    return { ...s, opsi: idx.map((i) => s.opsi[i]), kunci: idx.indexOf(s.kunci) };
  });

  return j({
    ok: true, model, mode, jumlah: hasil.length,
    soal: hasil, teks: keTeks(hasil),
    catatan: hasil.length < n ? `AI menghasilkan ${hasil.length} dari ${n} soal yang diminta.` : ""
  });
}
