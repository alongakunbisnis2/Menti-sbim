// Rekap naratif Penilaian dengan Workers AI.
// Data mentah -> ringkas jadi teks siap dibacakan MC / dilampirkan ke laporan.
const MODEL = [
  "@cf/qwen/qwen3-30b-a3b-fp8",
  "@cf/meta/llama-3.1-8b-instruct-fp8",
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast"
];

const rupiah = (n) => Number(n || 0).toLocaleString("id-ID");

function bahan(st) {
  const semua = (st.top || []).length ? st.top : [];
  const baris = semua.slice(0, 15).map((r) =>
    `${r.rank}. ${r.name} (${r.kelompok || "tanpa kelompok"}) — ${rupiah(r.score)} poin ` +
    `[Materi ${rupiah(r.sesi && r.sesi.Materi)}, Outbound ${rupiah(r.sesi && r.sesi.Outbound)}, ` +
    `Performance ${rupiah(r.sesi && r.sesi.Performance)}, Konten ${rupiah(r.sesi && r.sesi.Konten)}]`
  ).join("\n");
  const entri = (st.entri || []).slice(0, 12).map((e) =>
    `- ${e.nama} (${e.sesi}/${e.kegiatan}) ${e.poin > 0 ? "+" : ""}${rupiah(e.poin)}`
  ).join("\n");
  return { baris, entri, jumlah: st.peserta || 0, total: st.totalPoin || 0 };
}

export async function rekap(env, st) {
  if (!env || !env.AI) return { error: "Binding AI belum aktif di Worker ini." };
  const b = bahan(st || {});
  if (!b.baris) return { error: "Belum ada peserta/poin untuk direkap." };

  const prompt = `Kamu sekretaris panitia SBIM Camp. Tulis rekap penilaian dalam bahasa Indonesia, nada rapi dan netral, untuk dibacakan MC sebelum pembagian hadiah.

DATA (jangan menambah angka atau nama di luar data ini):
Peserta tercatat: ${b.jumlah}. Total poin seluruh peserta: ${rupiah(b.total)}.
Peringkat (sudah final):
${b.baris}

Entri terakhir:
${b.entri || "-"}

Tulis tepat empat bagian, tanpa tabel, tanpa markdown tebal:
1) Ringkasan — 2 kalimat: jumlah peserta dan total poin.
2) Delapan besar — sebutkan juara 1 sampai 8 dengan poin dan kelompok, satu baris per orang, urut.
3) Sorotan sesi — 2-3 kalimat tentang sesi (Materi/Outbound/Performance/Konten) mana yang paling menyumbang poin, hanya berdasarkan angka di atas.
4) Catatan panitia — 2 kalimat: hal yang perlu dicek (mis. peserta tanpa kelompok, poin mencolok) bila ada; kalau tidak ada, tulis "Tidak ada anomali data."

Maksimal 240 kata. Jangan mengarang kegiatan yang tidak ada di data.`;

  let terakhir = "";
  for (const model of MODEL) {
    try {
      const r = await env.AI.run(model, { messages: [{ role: "user", content: prompt }], max_tokens: 1024, temperature: 0.35 });
      const teks = (r && (r.response || r.result || r.text)) || "";
      if (String(teks).trim().length > 40) return { ok: true, model, teks: String(teks).trim() };
      terakhir = "Balasan kosong dari " + model;
    } catch (e) {
      terakhir = (e && e.message) || String(e);
    }
  }
  return { error: "AI sedang sibuk. Coba lagi sebentar. (" + terakhir + ")" };
}
