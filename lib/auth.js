// Pemeriksaan PIN panel (dipakai Quiziz & Penilaian).
// PIN disimpan sebagai secret Worker: ADMIN_PIN. Jika belum diset, panel terbuka
// (hanya untuk pengembangan) dan pemanggil bisa menampilkan peringatan.

function sama(a, b) {
  const x = String(a || ""), y = String(b || "");
  if (!x || x.length !== y.length) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return d === 0;
}

function pinDari(req) {
  try {
    const h = req.headers.get("x-pin");
    if (h) return h;
    return new URL(req.url).searchParams.get("pin") || "";
  } catch (e) { return ""; }
}

// true = boleh menulis
function cekPin(req, env) {
  const mau = String((env && env.ADMIN_PIN) || "").trim();
  if (!mau) return true;
  return sama(mau, pinDari(req));
}

function pinAktif(env) { return !!String((env && env.ADMIN_PIN) || "").trim(); }

module.exports = { cekPin, pinAktif, pinDari };
