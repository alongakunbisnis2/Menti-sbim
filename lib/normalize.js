// Normalisasi teks Indonesia untuk clustering
const STOPWORDS = new Set([
  "yang","dan","di","ke","dari","untuk","dengan","pada","adalah","itu","ini",
  "saya","kami","kita","mereka","karena","jadi","sangat","sekali","aja","sih",
  "dong","ya","gak","nggak","tidak","kurang","lebih","bisa","harus","agar",
  "supaya","tentang","dalam","atau","juga","udah","sudah","belum","akan",
  "ada","the","a","an","of","to","in"
]);

function normalize(raw) {
  if (!raw) return "";
  let s = String(raw).toLowerCase().trim();
  s = s.replace(/https?:\/\/\S+/g, "");
  s = s.replace(/[^a-z0-9\u00C0-\u024F\u1E00-\u1EFF\s]/gi, " ");
  s = s.replace(/\s+/g, " ").trim();
  const words = s.split(" ").filter(w => w && !STOPWORDS.has(w) && w.length > 1);
  return words.join(" ");
}

function displayText(raw) {
  return String(raw || "").trim().replace(/\s+/g, " ").slice(0, 80);
}

module.exports = { normalize, displayText, STOPWORDS };
