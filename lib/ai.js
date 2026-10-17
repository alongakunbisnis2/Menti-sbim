// Lapis 2 AI: ringkasan on-demand. Prioritas Ollama lokal, fallback heuristik (tanpa key).
async function summarizeRoom(st, opts = {}) {
  const clusters = ((st.result && st.result.clusters) || st.clusters || []).slice(0, 20);
  const total = (st.result && st.result.total) ?? st.total ?? 0;
  if (!clusters.length) return { summary: "Belum ada jawaban masuk." };
  const lines = clusters.map((c, i) => `${i+1}. "${c.text}" x${c.count}`).join("\n");

  // Coba Ollama lokal (tidak wajib)
  const ollamaUrl = process.env.OLLAMA_URL || "http://localhost:11434";
  const model = process.env.OLLAMA_MODEL || "qwen2.5:3b";
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    const res = await fetch(`${ollamaUrl}/api/generate`, {
      method: "POST", signal: ctrl.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model, stream: false,
        prompt: `Ringkas jawaban polling berikut dalam 3 bullet Bahasa Indonesia santai. Data:\n${lines}\n\nFokus: tema dominan, 1 insight menarik, 1 saran tindak lanjut. Maks 80 kata.`
      })
    });
    clearTimeout(t);
    if (res.ok) {
      const j = await res.json();
      if (j.response) return { summary: j.response.trim(), source: `ollama:${model}` };
    }
  } catch (e) { /* fallback di bawah */ }

  // Fallback heuristik: selalu jalan tanpa API key
  const top = clusters.slice(0, 3).map(c => `"${c.text}" (${c.count} suara)`).join(", ");
  return {
    summary: `Top jawaban: ${top}. Total ${total} suara. Tema dominan: "${clusters[0].text}".`,
    source: "heuristic"
  };
}
module.exports = { summarizeRoom };
