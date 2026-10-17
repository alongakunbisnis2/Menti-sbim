# SbimLive — Mentimeter ala Sbim Camp

Word cloud realtime + AI clustering. Frontend: `public/` | Backend: `server.js` (Node + Socket.io).

## Kenapa server tidak bisa di Surge?
Surge hanya hosting file **statis**. Server Node.js/Socket.io butuh proses yang jalan terus.
Solusi: frontend di Surge (demo) + backend di host Node.js.

## A. Jalan lokal + auto-restart (aktif ✅)
```bash
bash start.sh        # start backend :3000
bash keepalive.sh & # auto-restart tiap 20 dtk kalau mati
```
Cek: `curl localhost:3000/health` | Log: `server.log`, `keepalive.log`

## B. Backend permanen di cloud (untuk Surge live penuh)
Pilih satu (file sudah siap: `railway.json`, `render.yaml`, `Procfile`, `Dockerfile`):
1. **Railway** (termudah): `railway up` → dapat URL `https://xxx.up.railway.app`
2. **Render**: New Web Service → repo ini → start `node server.js`
3. Lalu sambungkan Surge:
```bash
echo 'var SURGE_BACKEND = "https://URL-BACKEND-KAMU";' > surge/config.js
cp public/*.html surge/   # lalu inject script config.js lagi
surge ./surge sbim-live.surge.sh
```

## C. Struktur
- `lib/rooms.js` — room 6-digit + anti-spam + filter
- `lib/normalize.js`, `lib/cluster.js` — AI heuristik (Jaccard+Levenshtein)
- `lib/ai.js` — ringkasan via Ollama (opsional) / fallback heuristik
- `surge/` — build statis (mode demo bila backend mati)
