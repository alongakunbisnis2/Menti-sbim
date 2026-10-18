const express = require("express");
const http = require("http");
const path = require("path");
const QRCode = require("qrcode");
const cors = require("cors");
const { Server } = require("socket.io");
const R = require("./lib/rooms");
const { summarizeRoom } = require("./lib/ai");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
// Halaman yang disajikan server ini memakai origin-nya sendiri sebagai backend
// (jadi URL tunnel / IP LAN / localhost otomatis benar tanpa daftar kandidat).
app.get("/config.js", (req, res) => {
  res.type("application/javascript").send('var SURGE_BACKENDS = [];\nvar SURGE_BACKEND = "";\n');
});
app.use(express.static(path.join(__dirname, "public")));
// URL rapi tanpa .html (dipakai juga oleh build Surge)
app.get(["/room", "/room/"], (req, res) => res.sendFile(path.join(__dirname, "public", "room.html")));
app.get(["/presenter", "/presenter/"], (req, res) => res.sendFile(path.join(__dirname, "public", "presenter.html")));

const fs = require("fs");
function publicUrlFromFile() {
  try { return fs.readFileSync(path.join(__dirname, ".public_url"), "utf8").trim(); } catch { return ""; }
}
// Aturan alamat join: pakai cara client menjangkau kita (Host header) — kecuali
// client datang dari localhost/127.0.0.1, di situ URL publik (tunnel) yang dipakai
// supaya QR tetap bisa diakses peserta dari luar.
const LOKAL = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?$/i;
const baseUrl = (req) => {
  const host = String(req.get("host") || "");
  const xf = String(req.get("x-forwarded-proto") || "").split(",")[0].trim();
  const proto = xf || req.protocol || "http";
  if (host && !LOKAL.test(host)) return `${proto}://${host}`;
  return process.env.PUBLIC_URL || publicUrlFromFile() || `${proto}://${host || "localhost:3000"}`;
};
const people = new Map(); // code -> Map(pid -> nama)
const rememberName = (code, pid, name) => {
  if (!code || !name) return;
  code = String(code).toUpperCase();
  if (!people.has(code)) people.set(code, new Map());
  people.get(code).set(pid || "x", String(name).slice(0, 24));
};
const nameList = (code) => [...new Set([...((people.get(String(code || "").toUpperCase()) || new Map()).values())])];
const countIn = (code) => { const set = io.sockets.adapter.rooms.get(String(code || "").toUpperCase()); return set ? set.size : 0; };
const _pending = new Map(); // code -> timer (batch siaran)
const broadcast = (code) => {
  const c = String(code || "").toUpperCase();
  if (_pending.has(c)) return;
  _pending.set(c, setTimeout(() => {
    _pending.delete(c);
    const s = stateWithCount(c);
    if (s) io.to(c).emit("room:update", s);
  }, 120));
};
const stateWithCount = (code) => { const s = R.roomState(code); if (s) { s.participants = countIn(s.code); s.names = nameList(s.code); } return s; };
const emit = (code) => { const s = stateWithCount(code); if (s) io.to(s.code).emit("room:update", s); return s; };
const baseFromReq = (req) => {
  const b = String((req.body && req.body.base) || "").trim().replace(/\/+$/, "");
  // base boleh menyertakan sub-path (mis. GitHub Pages: https://user.github.io/Menti-sbim)
  return /^https?:\/\/[a-z0-9.\-]+(:\d+)?(\/[A-Za-z0-9._~\/\-]*)?$/i.test(b) ? b : baseUrl(req);
};
const pidOf = (req, b) => (b && b.pid) || req.ip || "rest";

// --- REST ---
app.post("/api/rooms", async (req, res) => {
  const input = req.body.questions || req.body.question || "Apa pendapatmu?";
  const room = R.createRoom(input);
  const joinUrl = `${baseFromReq(req)}/room/?code=${room.code}`;
  let qr = null;
  try { qr = await QRCode.toDataURL(joinUrl, { width: 300 }); } catch {}
  res.json({ code: room.code, qTotal: room.questions.length, joinUrl, qr });
});
app.get("/api/rooms/:code", (req, res) => {
  const s = stateWithCount(req.params.code);
  if (!s) return res.status(404).json({ error: "Not found" });
  res.json(s);
});
app.get("/api/rooms/:code/qr", async (req, res) => {
  const room = R.getRoom(req.params.code);
  if (!room) return res.status(404).json({ error: "Not found" });
  const joinUrl = `${baseFromReq(req)}/room/?code=${room.code}`;
  res.json({ joinUrl, qr: await QRCode.toDataURL(joinUrl, { width: 300 }) });
});
app.post("/api/rooms/:code/summarize", async (req, res) => {
  const s = R.roomState(req.params.code);
  if (!s) return res.status(404).json({ error: "Not found" });
  res.json(await summarizeRoom(s));
});
app.get("/api/rooms/:code/export", (req, res) => {
  const room = R.getRoom(req.params.code);
  if (!room) return res.status(404).json({ error: "Not found" });
  const esc = v => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
  const rows = [["soal_no","tipe","pertanyaan","nama","jawaban","skor_upvote"].map(esc).join(",")];
  room.questions.forEach((q, qi) => {
    (q.answers || []).forEach(a => {
      let ans = a.raw != null ? a.raw : "";
      if (q.kind === "choice" || q.kind === "quiz") { const o = (q.options || []).find(o => o.id === a.optionId); ans = o ? o.text : a.optionId; }
      if (q.kind === "hundred") ans = Object.entries(a.alloc || {}).map(([k, v]) => k + ":" + v).join(" ");
      const extra = q.kind === "qa" ? (a.up || []).length : (a.score || 0);
      rows.push([qi + 1, q.kind, q.text, a.name || a.pid || "", ans, extra].map(esc).join(","));
    });
  });
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="sbim-${room.code}.csv"`);
  res.send("\uFEFF" + rows.join("\n"));
});
app.get("/health", (_, res) => res.json({ ok: true }));
app.post("/api/rooms/:code/questions", (req, res) => {
  const r = R.addQuestion(req.params.code, req.body);
  if (r.error) return res.status(400).json({ error: r.error });
  res.json(emit(r.room.code));
});
app.post("/api/rooms/:code/goto", (req, res) => {
  const r = R.gotoQuestion(req.params.code, req.body.index);
  if (r.error) return res.status(400).json({ error: r.error });
  res.json(emit(r.room.code));
});
app.post("/api/rooms/:code/show-results", (req, res) => {
  const r = R.setShowResults(req.params.code, req.body.show !== false);
  if (r.error) return res.status(400).json({ error: r.error });
  res.json(emit(r.room.code));
});
app.post("/api/rooms/:code/reveal", (req, res) => {
  const r = R.setReveal(req.params.code, req.body.reveal !== false);
  if (r.error) return res.status(400).json({ error: r.error });
  res.json(emit(r.room.code));
});
app.post("/api/rooms/:code/answers", (req, res) => {
  const room = R.getRoom(req.params.code);
  if (!room) return res.status(404).json({ error: "Not found" });
  const kind = room.questions[room.qIndex].kind;
  const r = (kind === "qa")
    ? R.submitText(req.params.code, req.body.text, pidOf(req, req.body), "qa")
    : R.submitText(req.params.code, req.body.text, pidOf(req, req.body), "cloud");
  if (r.error) return res.status(429).json({ error: r.error });
  res.json(emit(r.room.code));
});
app.post("/api/rooms/:code/vote", (req, res) => {
  const r = R.voteChoice(req.params.code, { optionId: req.body.optionId, pid: pidOf(req, req.body), name: req.body.name });
  if (r.error) return res.status(400).json({ error: r.error });
  res.json({ ...emit(r.room.code), myScore: r.score });
});
app.post("/api/rooms/:code/upvote", (req, res) => {
  const r = R.upvote(req.params.code, req.body.itemId, pidOf(req, req.body));
  if (r.error) return res.status(400).json({ error: r.error });
  res.json(emit(r.room.code));
});
app.post("/api/rooms/:code/scale", (req, res) => {
  const r = R.submitScale(req.params.code, req.body || {});
  res.json(r.error ? { error: r.error } : stateWithCount(req.params.code));
});
app.post("/api/rooms/:code/rank", (req, res) => {
  const r = R.submitRank(req.params.code, req.body || {});
  res.json(r.error ? { error: r.error } : stateWithCount(req.params.code));
});
app.post("/api/rooms/:code/guess", (req, res) => {
  const r = R.submitGuess(req.params.code, req.body || {});
  if (r.error) return res.json({ error: r.error });
  res.json({ ...stateWithCount(req.params.code), myScore: r.score });
});
app.post("/api/rooms/:code/hundred", (req, res) => {
  const r = R.submitHundred(req.params.code, { alloc: req.body.alloc, pid: pidOf(req, req.body), name: req.body.name });
  if (r.error) return res.status(400).json({ error: r.error });
  res.json(emit(r.room.code));
});

// --- Socket ---
io.on("connection", (socket) => {
  const spid = (b) => (b && b.pid) || (socket.handshake.address + socket.id.slice(0, 4));
  socket.on("join-room", (payload) => {
    const code = String((payload && payload.code) || payload || "").toUpperCase();
    const name = payload && payload.name;
    socket.join(code);
    socket.data.room = code;
    if (name) { socket.data.name = name; rememberName(code, socket.data.pid || socket.id.slice(0, 6), name); }
    const s = stateWithCount(code);
    if (s) socket.emit("room:update", s);   // yang baru gabung langsung dapat state
    broadcast(code);                        // yang lain lewat batch (anti-badai join)
  });
  socket.on("admin:show-results", ({ code, show }) => {
    const r = R.setShowResults(code, show);
    if (!r.error) emit(r.room.code);
  });
  socket.on("disconnect", () => {
    const c = socket.data.room;
    if (c) broadcast(c);   // banyak yang keluar sekaligus -> lewat batch
  });
  socket.on("participant:answer", (b = {}) => {
    rememberName(b.code, b.pid, b.name);
    const room = R.getRoom(b.code);
    if (!room) return socket.emit("answer:error", "Kode tidak ditemukan");
    const kind = room.questions[room.qIndex].kind;
    const r = R.submitText(b.code, b.text, spid(b), kind === "qa" ? "qa" : "cloud");
    if (r.error) return socket.emit("answer:error", r.error);
    emit(r.room.code);
  });
  socket.on("participant:vote", (b = {}) => {
    rememberName(b.code, b.pid, b.name);
    const r = R.voteChoice(b.code, { optionId: b.optionId, pid: spid(b), name: b.name });
    if (r.error) return socket.emit("answer:error", r.error);
    socket.emit("vote:scored", { score: r.score });
    emit(r.room.code);
  });
  socket.on("participant:upvote", (b = {}) => {
    rememberName(b.code, b.pid, b.name);
    const r = R.upvote(b.code, b.itemId, spid(b));
    if (r.error) return socket.emit("answer:error", r.error);
    emit(r.room.code);
  });
  socket.on("participant:scale", (b = {}) => {
    rememberName(b.code, b.pid, b.name);
    const r = R.submitScale(b.code, b);
    socket.emit("answer:ack", r.error ? { error: r.error } : { ok: true });
    if (!r.error) broadcast(b.code);
  });
  socket.on("participant:rank", (b = {}) => {
    rememberName(b.code, b.pid, b.name);
    const r = R.submitRank(b.code, b);
    socket.emit("answer:ack", r.error ? { error: r.error } : { ok: true });
    if (!r.error) broadcast(b.code);
  });
  socket.on("participant:guess", (b = {}) => {
    rememberName(b.code, b.pid, b.name);
    const r = R.submitGuess(b.code, b);
    if (r.error) return socket.emit("answer:error", r.error);
    broadcast(b.code);
    socket.emit("vote:scored", { score: r.score });
  });
  socket.on("participant:hundred", (b = {}) => {
    rememberName(b.code, b.pid, b.name);
    const r = R.submitHundred(b.code, { alloc: b.alloc, pid: spid(b), name: b.name });
    if (r.error) return socket.emit("answer:error", r.error);
    emit(r.room.code);
  });
  socket.on("admin:update-question", ({ code, question }) => {
    const r = R.setQuestionText(code, question);
    if (!r.error) emit(r.room.code);
  });
  socket.on("admin:add-question", ({ code, q }) => {
    const r = R.addQuestion(code, q || {});
    if (!r.error) emit(r.room.code);
  });
  socket.on("admin:goto-question", ({ code, index }) => {
    const r = R.gotoQuestion(code, index);
    if (!r.error) emit(r.room.code);
  });
  socket.on("admin:reveal", ({ code, reveal }) => {
    const r = R.setReveal(code, reveal);
    if (!r.error) emit(r.room.code);
  });
  socket.on("admin:toggle-lock", ({ code, locked }) => {
    const room = R.getRoom(code);
    if (!room) return;
    room.locked = !!locked;
    emit(room.code);
  });
  socket.on("admin:clear", ({ code }) => {
    const room = R.getRoom(code);
    if (!room) return;
    R.clearCurrent(room.code);
    emit(room.code);
  });
  socket.on("admin:hide", ({ code, text }) => {
    const room = R.getRoom(code);
    if (!room) return;
    const q = room.questions[room.qIndex];
    q.hidden.has(text) ? q.hidden.delete(text) : q.hidden.add(text);
    emit(room.code);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  try { fs.writeFileSync(path.join(__dirname, ".server.pid"), String(process.pid)); } catch {}
  console.log(`menti-sbim live di http://localhost:${PORT} (pid ${process.pid})`);
});
