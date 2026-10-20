// In-memory room store. 1 sesi = banyak pertanyaan multi-tipe (ala Menti).
// kind: cloud | choice | quiz | qa | hundred
const { normalize } = require("./normalize");
const { clusterAnswers } = require("./cluster");

const rooms = new Map();
const rateMap = new Map();

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function genCode(len = 6) {
  let c = "";
  for (let i = 0; i < len; i++) c += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return rooms.has(c) ? genCode(len) : c;
}
const OPTIDS = ["A","B","C","D","E","F"];
function makeQ(input, id) {
  let text = "", kind = "cloud", options = [], config = {};
  if (typeof input === "string") text = input;
  else if (input && typeof input === "object") {
    text = input.text || ""; kind = input.kind || "cloud";
    (input.options || []).forEach((o, i) => {
      const t = typeof o === "string" ? o : o.text;
      if (t) options.push({ id: OPTIDS[i] || ("O"+i), text: String(t).slice(0,120), correct: !!(o && o.correct) });
    });
    const c = input.config || {};
    const ansNum = Number(c.answer);
    config = { timer: Math.min(120, Math.max(0, Number(c.timer) || 0)),
               points: Math.min(5000, Math.max(100, Number(c.points) || 1000)),
               max: Math.min(10, Math.max(2, Number(c.max) || 5)),
               low: String(c.low || "").trim().slice(0,40),
               high: String(c.high || "").trim().slice(0,40),
               answer: Number.isFinite(ansNum) && c.answer !== null && c.answer !== "" && c.answer !== undefined ? ansNum : null,
               tolerance: Math.max(0, Number(c.tolerance) || 0) };
  }
  if (!["cloud","choice","quiz","qa","hundred","scale","rank","guess"].includes(kind)) kind = "cloud";
  if ((kind === "choice" || kind === "quiz" || kind === "hundred" || kind === "rank") && options.length < 2) kind = "cloud";
  if (kind === "guess" && config.answer === null) kind = "cloud";
  return { id, text: String(text).trim().slice(0,200) || "Tanpa judul", kind, options, config,
           answers: [], hidden: new Set(), openedAt: Date.now(), reveal: false };
}
function toList(input) {
  let raw = [];
  if (Array.isArray(input)) raw = input;
  else if (input && typeof input === "object" && Array.isArray(input.questions)) raw = input.questions;
  else if (typeof input === "string") raw = input.split("\n");
  else if (input && typeof input === "object" && input.question) raw = [input.question];
  else raw = [String(input || "Apa pendapatmu?")];
  raw = raw.map(x => (typeof x === "string" ? x.trim() : x)).filter(x => (typeof x === "string" ? x : x && x.text));
  if (!raw.length) raw = ["Apa pendapatmu?"];
  return raw;
}
function createRoom(input) {
  const code = genCode();
  const list = toList(input);
  rooms.set(code, { code, questions: list.map((q, i) => makeQ(q, i)),
    qIndex: 0, createdAt: Date.now(), locked: false, showResults: false });
  return rooms.get(code);
}
function getRoom(code) { return rooms.get(String(code || "").toUpperCase().trim()); }
function cur(room) { return room.questions[room.qIndex]; }
function checkRate(key, ms = 3000) {
  const now = Date.now(), last = rateMap.get(key) || 0;
  if (now - last < ms) return false;
  rateMap.set(key, now); return true;
}
const BANNED = ["anjing","bangsat","tolol","goblok","babi","kontol","memek","ngentot"];
const hasBanned = s => BANNED.some(w => s.toLowerCase().includes(w));
const uid = p => (p || "") + "-" + Date.now().toString(36) + Math.floor(Math.random()*999);

// ---- admin ----
function addQuestion(code, qobj) {
  const room = getRoom(code);
  if (!room) return { error: "Kode tidak ditemukan" };
  const q = makeQ(qobj, room.questions.length);
  if (!q.text) return { error: "Soal kosong" };
  room.questions.push(q);
  return { ok: true, room };
}
function gotoQuestion(code, index) {
  const room = getRoom(code);
  if (!room) return { error: "Kode tidak ditemukan" };
  room.qIndex = Math.max(0, Math.min(room.questions.length - 1, Number(index) || 0));
  cur(room).openedAt = Date.now();
  return { ok: true, room };
}
function setQuestionText(code, text) {
  const room = getRoom(code);
  if (!room) return { error: "Kode tidak ditemukan" };
  text = String(text || "").trim().slice(0, 200);
  if (!text) return { error: "Soal kosong" };
  cur(room).text = text;
  return { ok: true, room };
}
function setReveal(code, reveal) {
  const room = getRoom(code);
  if (!room) return { error: "Kode tidak ditemukan" };
  cur(room).reveal = reveal !== false;
  return { ok: true, room };
}
function setShowResults(code, show) {
  const room = getRoom(code);
  if (!room) return { error: "Kode tidak ditemukan" };
  room.showResults = show !== false;
  return { ok: true, room };
}
function clearCurrent(code) {
  const room = getRoom(code);
  if (!room) return;
  const q = cur(room);
  q.answers = []; q.hidden.clear(); q.reveal = false; q.openedAt = Date.now();
}

// ---- answers ----
function submitText(code, raw, pid, kind /* cloud|qa */, name) {
  const room = getRoom(code);
  if (!room) return { error: "Kode tidak ditemukan" };
  if (room.locked) return { error: "Sesi dikunci presenter" };
  const q = cur(room);
  if (q.kind !== kind) return { error: "Soal sudah berganti" };
  raw = String(raw || "").trim().slice(0, 140);
  if (!raw) return { error: "Jawaban kosong" };
  if (hasBanned(raw)) return { error: "Jawaban ditolak filter" };
  if (!checkRate(pid + code + q.id)) return { error: "Tunggu 3 detik ya..." };
  const norm = normalize(raw);
  if (!norm) return { error: "Terlalu pendek" };
  if (kind === "qa" && q.answers.some(a => a.normalized === norm)) return { error: "Sudah ada yang bertanya itu — upvote saja" };
  q.answers.push({ id: uid("m"), raw, normalized: norm, ts: Date.now(), pid,
    name: String(name || "").slice(0, 24), up: [] });
  if (q.answers.length > 2000) q.answers.splice(0, q.answers.length - 2000);
  return { ok: true, room };
}
function upvote(code, itemId, pid) {
  const room = getRoom(code);
  if (!room) return { error: "Kode tidak ditemukan" };
  const q = cur(room);
  if (q.kind !== "qa") return { error: "Bukan sesi tanya-jawab" };
  const it = q.answers.find(a => a.id === itemId);
  if (!it) return { error: "Pertanyaan tidak ada" };
  it.up = it.up || [];
  const i = it.up.indexOf(pid);
  if (i >= 0) it.up.splice(i, 1); else it.up.push(pid);
  return { ok: true, room };
}
function voteChoice(code, { optionId, pid, name }) {
  const room = getRoom(code);
  if (!room) return { error: "Kode tidak ditemukan" };
  if (room.locked) return { error: "Sesi dikunci presenter" };
  const q = cur(room);
  if (q.kind !== "choice" && q.kind !== "quiz") return { error: "Soal sudah berganti" };
  const opt = q.options.find(o => o.id === optionId);
  if (!opt) return { error: "Opsi tidak valid" };
  const elapsed = Date.now() - q.openedAt;
  let score = 0;
  if (q.kind === "quiz" && opt.correct) {
    const base = q.config.points || 1000, t = (q.config.timer || 0) * 1000;
    const bonus = t > 0 ? Math.round(base * Math.max(0, 1 - elapsed / t)) : 0;
    score = base + bonus;
  }
  q.answers = q.answers.filter(a => a.pid !== pid);
  q.answers.push({ pid, name: String(name || "Anonim").slice(0, 24), optionId, ts: Date.now(), score });
  return { ok: true, room, score };
}
function submitHundred(code, { alloc, pid, name }) {
  const room = getRoom(code);
  if (!room) return { error: "Kode tidak ditemukan" };
  if (room.locked) return { error: "Sesi dikunci presenter" };
  const q = cur(room);
  if (q.kind !== "hundred") return { error: "Soal sudah berganti" };
  const ids = q.options.map(o => o.id);
  let sum = 0;
  for (const id of ids) {
    const v = Math.max(0, Math.min(100, Number((alloc || {})[id]) || 0));
    alloc[id] = v; sum += v;
  }
  if (sum !== 100) return { error: "Total harus pas 100 (sekarang " + sum + ")" };
  q.answers = q.answers.filter(a => a.pid !== pid);
  q.answers.push({ pid, name: String(name || "Anonim").slice(0, 24), alloc: { ...alloc }, ts: Date.now() });
  return { ok: true, room };
}

const tolOf = q => q.config.tolerance || Math.max(1, Math.abs(q.config.answer) * 0.1);
const cleanName = n => String(n || "Anonim").slice(0, 24);

function submitScale(code, { value, pid, name }) {
  const room = getRoom(code);
  if (!room) return { error: "Kode tidak ditemukan" };
  if (room.locked) return { error: "Sesi dikunci presenter" };
  const q = cur(room);
  if (q.kind !== "scale") return { error: "Soal sudah berganti" };
  const v = Math.round(Number(value));
  if (!(v >= 1 && v <= q.config.max)) return { error: "Nilai di luar skala 1-" + q.config.max };
  q.answers = q.answers.filter(a => a.pid !== pid);
  q.answers.push({ pid, name: cleanName(name), value: v, ts: Date.now() });
  return { ok: true, room };
}

function submitRank(code, { order, pid, name }) {
  const room = getRoom(code);
  if (!room) return { error: "Kode tidak ditemukan" };
  if (room.locked) return { error: "Sesi dikunci presenter" };
  const q = cur(room);
  if (q.kind !== "rank") return { error: "Soal sudah berganti" };
  const ids = q.options.map(o => o.id);
  const list = (Array.isArray(order) ? order : []).filter(x => ids.includes(x));
  ids.forEach(id => { if (!list.includes(id)) list.push(id); });
  q.answers = q.answers.filter(a => a.pid !== pid);
  q.answers.push({ pid, name: cleanName(name), order: list, ts: Date.now() });
  return { ok: true, room };
}

function submitGuess(code, { value, pid, name }) {
  const room = getRoom(code);
  if (!room) return { error: "Kode tidak ditemukan" };
  if (room.locked) return { error: "Sesi dikunci presenter" };
  const q = cur(room);
  if (q.kind !== "guess") return { error: "Soal sudah berganti" };
  const g = Number(String(value).replace(/[^0-9.,-]/g, "").replace(",", "."));
  if (!Number.isFinite(g)) return { error: "Masukkan angka" };
  const base = q.config.points || 1000;
  const diff = Math.abs(g - q.config.answer);
  const score = Math.max(0, Math.round(base * Math.max(0, 1 - diff / (tolOf(q) * 3))));
  q.answers = q.answers.filter(a => a.pid !== pid);
  q.answers.push({ pid, name: cleanName(name), value: g, diff, score, ts: Date.now() });
  return { ok: true, room, score };
}

// ---- results ----
function results(q) {
  if (q.kind === "cloud") {
    const vis = q.answers.filter(a => ![...q.hidden].includes(a.raw));
    return { clusters: clusterAnswers(vis).filter(c => !q.hidden.has(c.text)).slice(0, 80), total: vis.length };
  }
  if (q.kind === "choice" || q.kind === "quiz") {
    const tally = q.options.map(o => ({ ...o, count: 0, correct: q.reveal ? o.correct : undefined }));
    q.answers.forEach(a => { const t = tally.find(t => t.id === a.optionId); if (t) t.count++; });
    const total = q.answers.length;
    tally.forEach(t => t.pct = total ? Math.round(t.count / total * 100) : 0);
    return { tally, total, revealed: q.reveal };
  }
  if (q.kind === "qa") {
    const items = q.answers
      .filter(a => ![...q.hidden].includes(a.raw))
      .map(a => ({ id: a.id, text: a.raw, votes: (a.up || []).length, voters: a.up || [] }))
      .sort((x, y) => y.votes - x.votes).slice(0, 100);
    return { items, total: items.length };
  }
  if (q.kind === "hundred") {
    const n = q.answers.length;
    const avg = q.options.map(o => ({
      ...o, avg: n ? Math.round(q.answers.reduce((s, a) => s + (a.alloc[o.id] || 0), 0) / n) : 0
    }));
    return { avg, total: n };
  }
  if (q.kind === "scale") {
    const max = q.config.max, n = q.answers.length;
    const dist = Array.from({ length: max }, (_, i) => ({ value: i + 1, count: 0 }));
    q.answers.forEach(a => { const d = dist[a.value - 1]; if (d) d.count++; });
    dist.forEach(d => d.pct = n ? Math.round(d.count / n * 100) : 0);
    const avg = n ? q.answers.reduce((s, a) => s + a.value, 0) / n : 0;
    return { dist, total: n, avg: Math.round(avg * 10) / 10, max, low: q.config.low, high: q.config.high };
  }
  if (q.kind === "rank") {
    const n = q.answers.length, k = q.options.length;
    const rows = q.options.map(o => ({ id: o.id, text: o.text, score: 0, sumPos: 0, firsts: 0 }));
    q.answers.forEach(a => a.order.forEach((id, pos) => {
      const r = rows.find(r => r.id === id); if (!r) return;
      r.score += (k - pos); r.sumPos += (pos + 1); if (pos === 0) r.firsts++;
    }));
    rows.forEach(r => { r.avgPos = n ? Math.round(r.sumPos / n * 10) / 10 : 0; r.pct = Math.round(r.score / (n ? n * k : 1) * 100); });
    rows.sort((a, b) => b.score - a.score);
    return { rows, total: n };
  }
  if (q.kind === "guess") {
    const n = q.answers.length;
    const arr = [...q.answers].sort((a, b) => a.diff - b.diff);
    const vals = q.answers.map(a => a.value);
    const target = Number.isFinite(q.config.answer) ? q.config.answer : 0;
    const avg = n ? Math.round(vals.reduce((s, v) => s + v, 0) / n * 10) / 10 : 0;
    const lo = vals.length ? Math.min(...vals, target) : 0;
    const hi = vals.length ? Math.max(...vals, target) : 1;
    const buckets = 12, span = Math.max(1, hi - lo);
    const dist = Array.from({ length: buckets }, (_, i) => ({ from: Math.round((lo + span * i / buckets) * 10) / 10, count: 0 }));
    vals.forEach(v => { let i = Math.floor((v - lo) / span * buckets); if (i < 0) i = 0; if (i >= buckets) i = buckets - 1; dist[i].count++; });
    const winners = q.answers.filter(a => a.diff <= tolOf(q)).map(a => ({ name: a.name, value: a.value, score: a.score })).slice(0, 12);
    const nearest = arr.slice(0, 5).map(a => ({ name: a.name, value: a.value, diff: a.diff }));
    return { dist, total: n, avg, tol: tolOf(q), winners, nearest, revealed: !!q.reveal,
             answer: q.reveal ? target : undefined, min: lo, max: hi };
  }
  return {};
}
function leaderboard(room) {
  const map = new Map();
  room.questions.forEach(q => {
    if (q.kind !== "quiz" && q.kind !== "guess") return;
    q.answers.forEach(a => {
      if (!a.score) return;
      const e = map.get(a.pid) || { name: a.name, score: 0 };
      e.score += a.score; e.name = a.name; map.set(a.pid, e);
    });
  });
  return [...map.values()].sort((a, b) => b.score - a.score).slice(0, 10);
}
function roomState(code) {
  const room = getRoom(code);
  if (!room) return null;
  const q = cur(room);
  const opts = q.options.map(o => ({ id: o.id, text: o.text, correct: q.reveal ? !!o.correct : undefined }));
  const cfg = { ...q.config };
  if (q.kind === "guess" && !q.reveal) { cfg.answer = null; }
  return {
    code: room.code, question: q.text, kind: q.kind, options: opts, config: cfg,
    reveal: q.reveal, openedAt: q.openedAt, qIndex: room.qIndex, qTotal: room.questions.length,
    questions: room.questions.map(x => ({ text: x.text, kind: x.kind })),
    locked: room.locked, showResults: !!room.showResults, result: results(q), board: leaderboard(room),
  };
}

module.exports = { rooms, createRoom, getRoom, addQuestion, gotoQuestion, setQuestionText, setReveal,
  clearCurrent, setShowResults, submitText, upvote, voteChoice, submitHundred, roomState, genCode,
  submitScale, submitRank, submitGuess };
