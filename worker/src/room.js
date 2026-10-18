// Durable Object "Room": satu instance = satu sesi SBIM Camp.
// Memakai ulang logika lib/rooms.js (Map internal di-seed dengan room milik DO ini),
// jadi aturan main (jenis soal, klaster, upvote, skor) sama persis dengan versi Node.
import * as R from "../../lib/rooms.js";
import { summarizeRoom } from "../../lib/ai.js";

const j = (o, s = 200) => new Response(JSON.stringify(o), {
  status: s, headers: { "content-type": "application/json; charset=utf-8" }
});
// Set tidak selamat lewat JSON biasa -> ditandai lalu dipulihkan
const ser = (room) => JSON.stringify(room, (k, v) => (v instanceof Set ? { __set: [...v] } : v));
const des = (str) => JSON.parse(str, (k, v) => (v && v.__set ? new Set(v.__set) : v));

export class Room {
  constructor(ctx, env) {
    this.ctx = ctx; this.env = env;
    this.code = null; this.people = new Map(); this._t = null;
  }

  // ---- penyimpanan ----
  async boot(code, questions) {
    if (this.code === code && R.getRoom(code)) return;
    this.code = code;
    const simpan = await this.ctx.storage.get("room");
    if (simpan) R.rooms.set(code, des(simpan));
    else if (questions != null) {
      const room = R.createRoom(questions);
      room.code = code;
      R.rooms.set(code, room);
      await this.save();
    }
    const ppl = await this.ctx.storage.get("people");
    this.people = new Map(ppl ? JSON.parse(ppl) : []);
  }
  async save() {
    const room = R.getRoom(this.code);
    if (room) await this.ctx.storage.put("room", ser(room));
    await this.ctx.storage.put("people", JSON.stringify([...this.people]));
  }
  remember(pid, name) {
    if (!name) return;
    this.people.set(pid || "x", String(name).slice(0, 24));
  }
  names() { return [...new Set([...this.people.values()])]; }

  // ---- siaran ----
  sockets() { return this.ctx.getWebSockets(); }
  kirim(ws, evt, d) { try { ws.send(JSON.stringify({ e: evt, d })); } catch (e) {} }
  siar(evt, d) {
    const msg = JSON.stringify({ e: evt, d });
    for (const ws of this.sockets()) { try { ws.send(msg); } catch (e) {} }
  }
  state() {
    const s = R.roomState(this.code);
    if (s) { s.participants = this.sockets().length; s.names = this.names(); }
    return s;
  }
  emit() { const s = this.state(); if (s) this.siar("room:update", s); return s; }
  // batch 120 ms: menahan badai join/jawaban (50+ peserta) jadi 1 kiriman
  broadcast() {
    if (this._t) return;
    this._t = setTimeout(() => { this._t = null; this.emit(); }, 120);
  }

  // ---- HTTP ----
  async fetch(req) {
    const url = new URL(req.url);
    const p = url.pathname, m = req.method;
    const code = (url.searchParams.get("code") || this.code || "").toUpperCase();

    if (p === "/ws") {
      if ((req.headers.get("Upgrade") || "").toLowerCase() !== "websocket")
        return new Response("butuh websocket", { status: 426 });
      const pasangan = new WebSocketPair();
      const client = pasangan[0], server = pasangan[1];
      await this.boot(code, null);
      const nama = url.searchParams.get("name") || "", pid = url.searchParams.get("pid") || "";
      this.remember(pid, nama);
      this.ctx.acceptWebSocket(server);              // API hibernasi: tanpa biaya durasi saat diam
      const s0 = this.state();
      if (s0) this.kirim(server, "room:update", s0);
      this.broadcast();
      return new Response(null, { status: 101, webSocket: client });
    }

    const aksi = p.replace(/^\/+|\/+$/g, "").split("/").pop();
    const body = (m === "POST" || m === "PUT") ? await req.json().catch(() => ({})) : {};

    if (aksi === "create") {                       // {code, questions}
      await this.boot((body.code || code).toUpperCase(), body.questions);
      const st = this.state();
      return j({ code: this.code, qTotal: st ? st.questions.length : 0 });
    }
    await this.boot(code, null);
    if (!R.getRoom(this.code)) return j({ error: "Kode tidak ditemukan" }, 404);

    switch (aksi) {
      case "state": { const s = this.state(); return s ? j(s) : j({ error: "Not found" }, 404); }

      case "export": {
        const room = R.getRoom(this.code);
        const esc = v => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
        const rows = [["soal_no", "tipe", "pertanyaan", "nama", "jawaban", "skor_upvote"].map(esc).join(",")];
        room.questions.forEach((q, qi) => {
          (q.answers || []).forEach(a => {
            let ans = a.raw != null ? a.raw : "";
            if (q.kind === "choice" || q.kind === "quiz") { const o = (q.options || []).find(x => x.id === a.optionId); ans = o ? o.text : a.optionId; }
            if (q.kind === "hundred") ans = Object.entries(a.alloc || {}).map(([k, v]) => k + ":" + v).join(" ");
            const extra = q.kind === "qa" ? (a.up || []).length : (a.score || 0);
            rows.push([qi + 1, q.kind, q.text, a.name || a.pid || "", ans, extra].map(esc).join(","));
          });
        });
        return new Response("\uFEFF" + rows.join("\n"), {
          headers: {
            "content-type": "text/csv; charset=utf-8",
            "content-disposition": `attachment; filename="sbim-${room.code}.csv"`
          }
        });
      }

      case "summarize": {
        const s = R.roomState(this.code);
        if (!s) return j({ error: "Not found" }, 404);
        const sum = await summarizeRoom(s).catch(() => null);
        return j(sum || { summary: "Ringkasan tidak tersedia." });
      }

      case "questions": { const r = R.addQuestion(this.code, body); if (r.error) return j({ error: r.error }, 400); return j(this.emit()); }
      case "goto": { const r = R.gotoQuestion(this.code, body.index); if (r.error) return j({ error: r.error }, 400); return j(this.emit()); }
      case "show-results": { const r = R.setShowResults(this.code, body.show !== false); if (r.error) return j({ error: r.error }, 400); return j(this.emit()); }
      case "reveal": { const r = R.setReveal(this.code, body.reveal !== false); if (r.error) return j({ error: r.error }, 400); return j(this.emit()); }
      case "answers": {
        const room = R.getRoom(this.code);
        const kind = room.questions[room.qIndex].kind;
        const r = R.submitText(this.code, body.text, body.pid || "rest", kind === "qa" ? "qa" : "cloud");
        if (r.error) return j({ error: r.error }, 429);
        return j(this.emit());
      }
      case "vote": {
        const r = R.voteChoice(this.code, { optionId: body.optionId, pid: body.pid || "rest", name: body.name });
        if (r.error) return j({ error: r.error }, 400);
        return j({ ...this.emit(), myScore: r.score });
      }
      case "upvote": { const r = R.upvote(this.code, body.itemId, body.pid || "rest"); if (r.error) return j({ error: r.error }, 400); return j(this.emit()); }
      case "scale": { const r = R.submitScale(this.code, body || {}); return j(r.error ? { error: r.error } : this.emit()); }
      case "rank": { const r = R.submitRank(this.code, body || {}); return j(r.error ? { error: r.error } : this.emit()); }
      case "guess": { const r = R.submitGuess(this.code, body || {}); if (r.error) return j({ error: r.error }); return j({ ...this.emit(), myScore: r.score }); }
      case "hundred": { const r = R.submitHundred(this.code, { alloc: body.alloc, pid: body.pid || "rest", name: body.name }); if (r.error) return j({ error: r.error }, 400); return j(this.emit()); }
      default: return j({ error: "Aksi tidak dikenal: " + aksi }, 404);
    }
  }

  // ---- pesan WebSocket (padanan socket.on(...) di server.js) ----
  async webSocketMessage(ws, pesan) {
    let msg; try { msg = JSON.parse(typeof pesan === "string" ? pesan : new TextDecoder().decode(pesan)); } catch (e) { return; }
    const b = msg.d || {}, ev = msg.e;
    const pid = b.pid || ("ws-" + (ws.deserializeAttachment?.()?.pid || "x"));
    if (b.code) this.code = String(b.code).toUpperCase();
    if (b.name) this.remember(pid, b.name);
    const balas = (e, d) => this.kirim(ws, e, d);
    let r;

    switch (ev) {
      case "join-room": {
        const c = String((b && b.code) || b || "").toUpperCase();
        if (c) this.code = c;
        try { ws.serializeAttachment({ pid, name: b.name || "" }); } catch (e) {}
        if (b.name) { this.remember(pid, b.name); await this.save(); }
        const s = this.state();
        if (s) balas("room:update", s);
        this.broadcast();
        return;
      }
      case "participant:answer": {
        const room = R.getRoom(this.code);
        if (!room) return balas("answer:error", "Kode tidak ditemukan");
        const kind = room.questions[room.qIndex].kind;
        r = R.submitText(this.code, b.text, pid, kind === "qa" ? "qa" : "cloud");
        if (r.error) return balas("answer:error", r.error);
        await this.save(); this.emit(); return;
      }
      case "participant:vote": {
        r = R.voteChoice(this.code, { optionId: b.optionId, pid, name: b.name });
        if (r.error) return balas("answer:error", r.error);
        balas("vote:scored", { score: r.score });
        await this.save(); this.emit(); return;
      }
      case "participant:upvote": {
        r = R.upvote(this.code, b.itemId, pid);
        if (r.error) return balas("answer:error", r.error);
        await this.save(); this.emit(); return;
      }
      case "participant:scale": {
        r = R.submitScale(this.code, b);
        balas("answer:ack", r.error ? { error: r.error } : { ok: true });
        if (!r.error) { await this.save(); this.broadcast(); }
        return;
      }
      case "participant:rank": {
        r = R.submitRank(this.code, b);
        balas("answer:ack", r.error ? { error: r.error } : { ok: true });
        if (!r.error) { await this.save(); this.broadcast(); }
        return;
      }
      case "participant:guess": {
        r = R.submitGuess(this.code, b);
        if (r.error) return balas("answer:error", r.error);
        await this.save(); this.broadcast();
        balas("vote:scored", { score: r.score });
        return;
      }
      case "participant:hundred": {
        r = R.submitHundred(this.code, { alloc: b.alloc, pid, name: b.name });
        if (r.error) return balas("answer:error", r.error);
        await this.save(); this.emit(); return;
      }
      case "admin:show-results": { r = R.setShowResults(this.code, b.show); if (!r.error) { await this.save(); this.emit(); } return; }
      case "admin:update-question": { r = R.setQuestionText(this.code, b.question); if (!r.error) { await this.save(); this.emit(); } return; }
      case "admin:add-question": { r = R.addQuestion(this.code, b.q || {}); if (!r.error) { await this.save(); this.emit(); } return; }
      case "admin:goto-question": { r = R.gotoQuestion(this.code, b.index); if (!r.error) { await this.save(); this.emit(); } return; }
      case "admin:reveal": { r = R.setReveal(this.code, b.reveal); if (!r.error) { await this.save(); this.emit(); } return; }
      case "admin:toggle-lock": {
        const room = R.getRoom(this.code); if (!room) return;
        room.locked = !!b.locked; await this.save(); this.emit(); return;
      }
      case "admin:clear": {
        const room = R.getRoom(this.code); if (!room) return;
        R.clearCurrent(room.code); await this.save(); this.emit(); return;
      }
      case "admin:hide": {
        const room = R.getRoom(this.code); if (!room) return;
        const q = room.questions[room.qIndex];
        q.hidden.has(b.text) ? q.hidden.delete(b.text) : q.hidden.add(b.text);
        await this.save(); this.emit(); return;
      }
      default: return;
    }
  }

  async webSocketClose(ws) {
    try { ws.close(); } catch (e) {}
    this.broadcast();
  }
  async webSocketError() { this.broadcast(); }
}
