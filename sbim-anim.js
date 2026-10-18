/* ============================================================
   SBIM — animasi otomatis (index / room / presenter)
   Tidak mengubah logika halaman: hanya "menghidupkan" elemen
   yang muncul/berubah. Semua efek sekali jalan per elemen
   supaya tidak berkedip walau layar diperbarui tiap 120 ms.
   Global yang disediakan: window.SBIM (gembira, emosi, getar, cap, hitung)
   ============================================================ */
(function () {
  const KURANG = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const WARNA = ['#C62A2A', '#E9A73C', '#5F7A3F', '#4296C6', '#96C6D2', '#A2AE7E'];
  const $ = s => document.querySelector(s);
  const acak = (a, b) => a + Math.random() * (b - a);
  const SBIM = {};

  /* ---------- pernak-pernik sekali pakai ---------- */
  SBIM.gembira = function (x, y, n) {
    if (KURANG) return;
    n = Math.min(n || 34, 70);
    x = x == null ? innerWidth / 2 : x;
    y = y == null ? innerHeight * 0.3 : y;
    for (let i = 0; i < n; i++) {
      const d = document.createElement('div');
      d.className = 'sbim-confetti';
      d.style.left = (x - acak(-90, 90)) + 'px';
      d.style.top = y + 'px';
      d.style.background = WARNA[i % WARNA.length];
      d.style.setProperty('--dx', acak(-170, 170).toFixed(0) + 'px');
      d.style.setProperty('--dy', acak(200, 430).toFixed(0) + 'px');
      d.style.setProperty('--rot', acak(-520, 520).toFixed(0) + 'deg');
      d.style.animationDelay = (i * 12) + 'ms';
      document.body.appendChild(d);
      setTimeout(() => d.remove(), 2000 + i * 12);
    }
  };

  SBIM.emosi = function (ikon, n) {
    if (KURANG) return;
    ikon = ikon || ['✓', '★', '🎉', '▲'];
    n = n || 9;
    for (let i = 0; i < n; i++) {
      const d = document.createElement('div');
      d.className = 'sbim-emosi';
      d.textContent = ikon[i % ikon.length];
      d.style.left = acak(innerWidth * 0.12, innerWidth * 0.88).toFixed(0) + 'px';
      d.style.top = (innerHeight - acak(40, 120)).toFixed(0) + 'px';
      d.style.setProperty('--dx', acak(-60, 60).toFixed(0) + 'px');
      d.style.setProperty('--dy', (-acak(180, 340)).toFixed(0) + 'px');
      d.style.animationDelay = (i * 70) + 'ms';
      document.body.appendChild(d);
      setTimeout(() => d.remove(), 1800 + i * 70);
    }
  };

  SBIM.getar = function (el) {
    if (!el || KURANG) return;
    el.classList.remove('sbim-getar'); void el.offsetWidth; el.classList.add('sbim-getar');
  };

  SBIM.cap = function (teks, x, y) {
    if (KURANG) return;
    const d = document.createElement('div');
    d.className = 'sbim-cap';
    d.textContent = teks;
    d.style.left = ((x == null ? innerWidth / 2 : x) - 80) + 'px';
    d.style.top = ((y == null ? innerHeight * 0.4 : y) - 26) + 'px';
    document.body.appendChild(d);
    setTimeout(() => d.remove(), 1100);
  };

  /* angka menghitung naik (mempertahankan teks di belakangnya) */
  SBIM.hitung = function (el, durasi) {
    if (!el || KURANG) return;
    const m = (el.textContent || '').match(/-?\d+/);
    if (!m) return;
    const target = +m[0];
    if (el._sbimKe === target) return;
    const dari = el._sbimDari == null ? 0 : el._sbimDari;
    const pola = (el.textContent || '').replace(m[0], '\u0000');
    el._sbimKe = target;
    if (target > dari) {
      el.style.display = 'inline-block';
      el.classList.remove('sbim-denyut'); void el.offsetWidth; el.classList.add('sbim-denyut');
    }
    if (el._sbimJalan) return;                 // sedang menghitung: target saja yang diperbarui
    el._sbimJalan = true;
    const t0 = performance.now(), dur = durasi || 450;
    const langkah = t => {
      const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      const kini = +(((el.textContent || '').match(/-?\d+/) || [0])[0]);
      const v = Math.round(kini + (el._sbimKe - kini) * e);
      el.textContent = pola.replace('\u0000', v);
      el._sbimDari = v;
      if (p < 1) requestAnimationFrame(langkah); else el._sbimJalan = false;
    };
    requestAnimationFrame(langkah);
  };

  /* kode sesi muncul huruf demi huruf */
  SBIM.kode = function (el) {
    if (!el) return;
    const t = (el.textContent || '').trim();
    if (!t || el.dataset.sbimKode) return;
    el.dataset.sbimKode = '1';
    if (KURANG) return;
    el.innerHTML = [...t].map((ch, i) =>
      `<span style="display:inline-block;animation:sbim-masuk .5s cubic-bezier(.2,1.3,.4,1) both;animation-delay:${i * 65}ms">${ch === ' ' ? '&nbsp;' : ch}</span>`).join('');
    SBIM.gembira(innerWidth / 2, innerHeight * 0.34, 40);
  };

  /* ---------- "hidupkan" elemen baru/berubah di dalam wadah ---------- */
  function pantau(wadah, opsi) {
    const w = typeof wadah === 'string' ? $(wadah) : wadah;
    if (!w) return;
    const anak = opsi.anak, kls = opsi.kelas || 'sbim-masuk', jeda = opsi.jeda == null ? 45 : opsi.jeda;
    const kunci = opsi.kunci || (el => (el.textContent || '').trim().slice(0, 42));
    const memori = new Map();
    const jalankan = () => {
      let baru = 0;
      for (const el of w.querySelectorAll(anak)) {
        const k = kunci(el), teks = (el.textContent || '').trim();
        const dulu = memori.get(k);
        if (dulu === undefined) {
          memori.set(k, teks);
          if (!KURANG) { el.classList.add(kls); if (jeda) el.style.animationDelay = Math.min(baru++, 14) * jeda + 'ms'; }
        } else if (dulu !== teks) {
          memori.set(k, teks);
          if (!KURANG && opsi.ubah) { el.classList.remove(opsi.ubah); void el.offsetWidth; el.classList.add(opsi.ubah); }
        }
      }
      titik(w);
    };
    jalankan();
    new MutationObserver(() => requestAnimationFrame(jalankan)).observe(w, { childList: true, subtree: true, characterData: true });
  }

  /* keadaan "menunggu…" diberi titik berdenyut supaya tidak mati */
  function titik(w) {
    if (KURANG || !w) return;
    for (const el of w.querySelectorAll('div,div>span'))
      if (/^(\s*)(Menunggu|Belum ada|Jadilah|Memuat)/.test(el.textContent || '') && !el.querySelector('.sbim-titik') && el.children.length === 0)
        el.insertAdjacentHTML('beforeend', '<span class="sbim-titik"><i></i><i></i><i></i></span>');
  }

  /* perhatikan perubahan teks sebuah elemen (pertanyaan, tombol reveal, dsb) */
  function saat_berubah(el, fn) {
    if (!el) return;
    let teks = el.textContent;
    fn(teks, teks);
    new MutationObserver(() => { const n = el.textContent; if (n !== teks) { const l = teks; teks = n; fn(n, l); } })
      .observe(el, { childList: true, subtree: true, characterData: true });
  }

  const siap = () => {
    /* ================= PAPAN PRESENTER ================= */
    if ($('#stage')) {
      pantau('#stage', { anak: '.w', kelas: 'sbim-kata', kunci: el => el.textContent.trim().toLowerCase(), ubah: 'sbim-menyala', jeda: 38 });
      pantau('#stage', { anak: '.bar-fill', kelas: 'sbim-tumbuh', kunci: el => ((el.closest('.bar-row') || el.parentElement || el).textContent || '').trim().slice(0, 42), jeda: 30 });
      pantau('#stage', { anak: '.bar-row, .prow, .qarow, .bigletter', kelas: 'sbim-seret', jeda: 35 });
      pantau('#bars', { anak: '.bar-row', kelas: 'sbim-seret', jeda: 35 });
      pantau('#bars', { anak: '.bar-fill', kelas: 'sbim-tumbuh', jeda: 30 });
      pantau('#board', { anak: '.bar-row', kelas: 'sbim-seret', jeda: 40 });

      ['#total', '#parts'].forEach(sel => {
        const el = $(sel);
        if (!el) return;
        saat_berubah(el, () => SBIM.hitung(el));
      });

      saat_berubah($('#q'), (kini, dulu) => {
        if (kini === dulu) return;            // jangan berbunyi saat halaman pertama dimuat
        const st = $('#stage');
        if (st) { st.classList.remove('sbim-seret'); void st.offsetWidth; st.classList.add('sbim-seret'); }
        SBIM.gembira(innerWidth * 0.5, innerHeight * 0.22, 14);
      });

      saat_berubah($('#btnReveal'), (kini, dulu) => {
        if (/TERBUKA/.test(kini) && !/TERBUKA/.test(dulu)) SBIM.gembira(innerWidth / 2, innerHeight * 0.36, 48);
      });

      if (!document.querySelector('.sbim-ticker-live')) {
        const tips = ['PANTAU LAYAR INI', 'JAWABAN MIRIP DIGABUNG OTOMATIS', 'KETUK KATA DI LAYAR UNTUK MENYEMBUNYIKAN', 'TEKAN REVEAL UNTUK MEMBUKA JAWABAN', 'PESERTA: SCAN QR DI LAYAR', '#RAISINGTHEAINNOVATOR'];
        const isi = '&nbsp;' + tips.join('  •  ') + '  •  ' + tips.join('  •  ') + '  •&nbsp;';
        const d = document.createElement('div');
        d.className = 'sbim-ticker-live mono';
        d.innerHTML = '<div>' + isi + '</div>';
        document.body.appendChild(d);
      }
    }

    /* ================= HALAMAN PESERTA ================= */
    if ($('#ans')) {
      const msg = $('#msg');
      if (msg) {
        new MutationObserver(() => {
          const first = msg.firstElementChild;
          if (!first) return;
          if (first.classList.contains('ok')) {
            SBIM.cap('TERKIRIM ✓', innerWidth / 2, innerHeight * 0.4);
            SBIM.emosi();
            SBIM.gembira(innerWidth / 2, innerHeight * 0.34, 16);
          } else if (first.classList.contains('gagal')) SBIM.getar(first);
        }).observe(msg, { childList: true });
      }
      const qq = $('#qq');
      if (qq) saat_berubah(qq, () => { const a = $('#ans'); if (a) { a.classList.remove('sbim-seret'); void a.offsetWidth; a.classList.add('sbim-seret'); } });
      const cnt = $('#count');
      if (cnt) saat_berubah(cnt, () => SBIM.hitung(cnt));
      if (msg) titik(msg);
      titik($('#ans'));
      titik($('#top'));
    }

    /* ================= HALAMAN DEPAN ================= */
    if ($('#out')) {
      const io = ('IntersectionObserver' in window) ? new IntersectionObserver(es => es.forEach(e => {
        if (e.isIntersecting) { e.target.classList.add('sbim-lihat'); io.unobserve(e.target); }
      }), { threshold: .12 }) : null;
      document.querySelectorAll('.card, header, .tick, footer').forEach(el => {
        el.classList.add('sbim-muncul');
        if (io) io.observe(el); else el.classList.add('sbim-lihat');
      });
      new MutationObserver(() => {
        const out = $('#out');
        if (out && /KODE SESI/.test(out.textContent)) SBIM.kode(out.querySelector('.disp'));
      }).observe($('#out'), { childList: true });
      const q = $('#q'), b = $('#btnBuat');
      if (q && b) {
        const periksa = () => b.classList.toggle('sbim-terapung', q.value.trim().length > 0);
        q.addEventListener('input', periksa); periksa();
      }
    }
  };

  window.SBIM = SBIM;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', siap);
  else siap();
})();
