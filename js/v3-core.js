/* =====================================================================
   SIAKAD SISWA v3.0 — v3-core.js
   Menempel ke aplikasi lewat titik sambung (Hooks) tanpa mengubah halaman lama:
   menu LMS, branding white-label, pelacakan aktivitas (durasi halaman),
   tombol & lencana pesan, login Google OAuth Super Admin, utilitas bersama LMS.
   ===================================================================== */
'use strict';

/** Aksi baca modul v3 (diperlakukan seperti baca: boleh dedupe & diulang otomatis) */
var READ_EXT = /^(lms\.(kursus\.(list|get)|opsi|modul\.get|peserta\.list|laporan\.selesai)|soal\.list|kuis\.(info|percobaan|ulasan|simpan|mulai)|tugas\.(get|list)|forum\.(list|diskusi)|wiki\.(get|riwayat)|glos\.list|ws\.get|ub\.(get|hasil)|kv\.hadir|nilai\.(buku|saya|raport\.pratinjau)|rubrik\.list|pesan\.(daftar|buka|poll|kontak)|track\.kirim|log\.aktivitas|keamanan\.get|brand\.get)$/;

// ---------------------------------------------------------------- Menu tambahan (disisipkan, menu lama tetap)
(function () {
  function sisip(list, setelah, items) { var i = list.map(function (m) { return m.p; }).indexOf(setelah); if (i < 0) i = list.length - 1; Array.prototype.splice.apply(list, [i + 1, 0].concat(items)); }
  if (typeof MENU_DEF === 'undefined') return;
  sisip(MENU_DEF.guru, 'keamanan', [{ p: 'keamanan2', t: 'Keamanan Lanjutan', i: 'shield-alert', sa: true }, { p: 'logaktivitas', t: 'Log Aktivitas', i: 'activity', sa: true }, { p: 'branding', t: 'Branding Aplikasi', i: 'palette', sa: true }]);
  sisip(MENU_DEF.guru, 'laporan', [{ sec: 'E-Learning (LMS)' }, { p: 'kursus', t: 'Kursus', i: 'graduation-cap' }, { p: 'bukunilai', t: 'Buku Nilai', i: 'table-2' }, { p: 'banksoal', t: 'Bank Soal', i: 'list-checks' }, { p: 'rubrik', t: 'Rubrik Penilaian', i: 'grid-3x3' }, { p: 'pesan', t: 'Pesan', i: 'messages-square' }]);
  sisip(MENU_DEF.siswa, 'materi', [{ p: 'kursus', t: 'Kursus Saya', i: 'graduation-cap' }]);
  sisip(MENU_DEF.siswa, 'jadwal', [{ p: 'pesan', t: 'Pesan', i: 'messages-square' }]);
})();

// ---------------------------------------------------------------- Branding white-label
function warnaGelap(hex, f) {
  var n = parseInt(String(hex).slice(1), 16); if (isNaN(n)) return hex;
  var r = Math.round(((n >> 16) & 255) * (1 - f)), g = Math.round(((n >> 8) & 255) * (1 - f)), b = Math.round((n & 255) * (1 - f));
  return '#' + [r, g, b].map(function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
}
var Brand = {
  bawaan: { nama: 'SIAKAD SISWA', tagline: 'Sistem Informasi Akademik Siswa', logo: '', warna: '#1E3A5F', footer: '' },
  data: (function () { try { return Store.get('brand', null); } catch (e) { return null; } })(),
  get: function () { var d = this.data || {}, b = Object.assign({}, this.bawaan); Object.keys(d).forEach(function (k) { if (d[k]) b[k] = d[k]; }); return b; },
  set: function (b) {
    if (!b) return;
    var baru = { nama: b.nama || '', tagline: b.tagline || '', logo: b.logo || '', warna: b.warna || '', footer: b.footer || '' };
    if (JSON.stringify(baru) === JSON.stringify(this.data)) return;
    this.data = baru; Store.set('brand', baru); this.apply();
  },
  dariCfg: function (c) { if (c && c.APP_NAMA) this.set({ nama: c.APP_NAMA, tagline: c.APP_TAGLINE, logo: c.APP_LOGO, warna: c.APP_WARNA, footer: c.APP_FOOTER }); },
  logo: function () { return this.get().logo || LOGO; },
  apply: function () {
    var b = this.get(), st = document.documentElement.style, def = b.warna.toLowerCase() === '#1e3a5f';
    if (!def && /^#[0-9a-f]{6}$/i.test(b.warna)) { st.setProperty('--navy', b.warna); st.setProperty('--navy-2', warnaGelap(b.warna, 0.2)); st.setProperty('--navy-3', warnaGelap(b.warna, 0.35)); st.setProperty('--info-ink', b.warna); }
    else ['--navy', '--navy-2', '--navy-3', '--info-ink'].forEach(function (k) { st.removeProperty(k); });
    var meta = $('meta[name="theme-color"]'); if (meta) meta.content = b.warna;
    var fav = $('link[rel="icon"]'); if (fav) { fav.href = b.logo || 'assets/logo.svg'; if (b.logo) fav.removeAttribute('type'); }
    if (b.logo) $$('img.logo, #loginLogo').forEach(function (img) { if (img.getAttribute('src') !== b.logo) img.src = b.logo; });
    var ls = $('#loginSchool'); if (ls) ls.textContent = b.nama;
    var sub = $('.login-sub'); if (sub) sub.textContent = b.tagline + ' – Login Akses';
    var foot = $('.login-foot'); if (foot && foot.firstChild && foot.firstChild.nodeType === 3) foot.firstChild.textContent = b.footer || ('© ' + new Date().getFullYear() + ' ' + b.nama + ' | All Rights Reserved');
    var sb = $('.side-brand b'); if (sb) { sb.textContent = b.nama; sb.title = b.nama; }
    if (!AppState.token) document.title = b.nama + ' — ' + b.tagline;
    else document.title = document.title.replace(/ — .*$/, ' — ' + b.nama);
  }
};
function brandNama() { return Brand.get().nama; }

// ---------------------------------------------------------------- Login Google (Super Admin)
var GoogleSA = {
  tampil: function (p) {
    var f = $('#loginForm'); if (!f) return;
    var box = $('#gsaBox');
    if (!p || !p.googleSa || !p.googleClientId) { if (box) box.remove(); return; }
    if (!box) {
      box = h('<div id="gsaBox" class="gsa-box"><div class="gsa-or"><span>atau</span></div><div class="gsa-lbl">' + ic('shield-check') + ' Super Admin' + (p.saLoginMode === 'google' ? ' (wajib Google)' : '') + '</div><div id="gsaBtn" class="gsa-btn"><div class="sk" style="height:40px;width:260px"></div></div><div id="gsaErr" class="note bad mt8" hidden></div></div>');
      $('#lgBtn', f).insertAdjacentElement('afterend', box);
    }
    loadLib('https://accounts.google.com/gsi/client').then(function () {
      if (!window.google || !google.accounts || !google.accounts.id) throw new Error('GIS');
      google.accounts.id.initialize({ client_id: p.googleClientId, callback: GoogleSA.callback, ux_mode: 'popup', auto_select: false, cancel_on_tap_outside: true });
      var el = $('#gsaBtn'); if (!el) return; el.innerHTML = '';
      google.accounts.id.renderButton(el, { theme: 'outline', size: 'large', text: 'signin_with', shape: 'pill', locale: 'id', width: 280 });
    }).catch(function () { var el = $('#gsaBtn'); if (el) el.innerHTML = '<div class="note warn small">' + ic('wifi-off') + '<div>Layanan login Google tidak dapat dimuat.</div></div>'; });
  },
  callback: async function (resp) {
    var err = $('#gsaErr'); if (err) err.hidden = true;
    var res = await api('login.google', { credential: resp && resp.credential, appUrl: DEMO ? '' : location.origin + location.pathname });
    if (!res.success) { if (err) { err.hidden = false; err.innerHTML = ic('circle-alert') + '<div>' + esc(res.message) + '</div>'; } return; }
    var d = res.data;
    Object.assign(AppState, { token: d.token, role: d.role, email: d.email, nama: d.nama, ref: d.ref, hak: d.hak || '', exp: d.exp, boot: d.boot });
    saveSession();
    Store.set(userKey('boot'), { t: Date.now(), h: hashStr(JSON.stringify(d.boot)), data: d.boot });
    location.hash = '#/monitoring';
    showApp();
    toast(res.message, 'ok');
  }
};

// ---------------------------------------------------------------- Pelacakan aktivitas (durasi halaman)
var Track = {
  cur: null, jeda: null, buf: {},
  kunci: function (name, param) { return name + (param && /^(kursus|aktivitas)$/.test(name) ? ':' + String(param).slice(0, 40) : ''); },
  halaman: function (name, param) { if (!AppState.token) return; this.tutup(); this.cur = { p: this.kunci(name, param), t: Date.now() }; },
  tutup: function () {
    if (!this.cur) return;
    var akhir = Math.min(Date.now(), (Activity.at || Date.now()) + 120000), d = Math.round((akhir - this.cur.t) / 1000);
    if (d >= 3) { var b = this.buf[this.cur.p] = this.buf[this.cur.p] || { p: this.cur.p, d: 0, n: 0 }; b.d += Math.min(d, 1800); b.n++; }
    this.cur = null;
  },
  kirim: function (beacon) {
    var ev = Object.keys(this.buf).map(function (k) { return Track.buf[k]; }); this.buf = {};
    if (!ev.length || !AppState.token) return;
    var body = { action: 'track.kirim', token: AppState.token, data: { ev: ev.slice(0, 40) }, dev: Device.id() };
    if (beacon && !DEMO && GAS_URL && navigator.sendBeacon) { try { navigator.sendBeacon(GAS_URL, JSON.stringify(body)); return; } catch (e) {} }
    api('track.kirim', body.data);
  }
};
setInterval(function () { if (AppState.token && Track.cur && !document.hidden) { var p = Track.cur.p; Track.tutup(); Track.cur = { p: p, t: Date.now() }; Track.kirim(); } }, 90000);
document.addEventListener('visibilitychange', function () {
  if (document.hidden) { if (Track.cur) { Track.jeda = Track.cur.p; Track.tutup(); } Track.kirim(true); }
  else if (Track.jeda && AppState.token) { Track.cur = { p: Track.jeda, t: Date.now() }; Track.jeda = null; }
});

// ---------------------------------------------------------------- Tombol & lencana pesan di topbar
var ChatBadge = {
  v: '', n: 0, sibuk: false,
  pasang: function () {
    var bell = $('#btnBell'); if (!bell || $('#btnChat')) return;
    var b = h('<button class="btn-ic bell" id="btnChat" title="Pesan" aria-label="Pesan">' + ic('messages-square') + '<span class="dot" id="chatDot" hidden>0</span></button>');
    bell.insertAdjacentElement('beforebegin', b);
    b.onclick = function () { go('pesan'); };
    this.v = ''; this.set(0); this.tick();
  },
  set: function (n) { this.n = n || 0; var d = $('#chatDot'); if (d) { d.hidden = !this.n; d.textContent = this.n > 9 ? '9+' : this.n; } },
  tick: async function () {
    if (!AppState.token || this.sibuk) return;
    this.sibuk = true;
    try {
      var r = await api('pesan.poll', { v: this.v });
      if (r.success) { this.v = r.data.v; if (!r.data.sama) { this.set(r.data.belum); window.dispatchEvent(new CustomEvent('pesan-baru', { detail: r.data })); } }
    } finally { this.sibuk = false; }
  }
};
setInterval(function () { if (AppState.token && $('#btnChat') && Activity.due('chat', 30000, 120000)) ChatBadge.tick(); }, 5000);

// ---------------------------------------------------------------- Pemasangan hooks
Hooks.login.push(function () { Brand.apply(); });
Hooks.publik.push(function (p) { if (p && p.brand) Brand.set(p.brand); Brand.apply(); GoogleSA.tampil(p); });
Hooks.shell.push(function () { Brand.dariCfg(AppState.boot && AppState.boot.cfg); Brand.apply(); ChatBadge.pasang(); });
Hooks.meta.push(function () { Brand.dariCfg(AppState.boot && AppState.boot.cfg); });
Hooks.route.push(function (name, param) { Track.halaman(name, param); });
document.addEventListener('DOMContentLoaded', function () { Brand.apply(); });

// =====================================================================
// UTILITAS BERSAMA LMS
// =====================================================================
var LMS_TIPE = {
  kuis: ['Kuis', 'list-checks', '#1D4ED8'], tugas: ['Tugas', 'clipboard-pen-line', '#B45309'], forum: ['Forum Diskusi', 'messages-square', '#0F766E'], wiki: ['Wiki', 'notebook-pen', '#7C3AED'],
  workshop: ['Workshop', 'users-round', '#9D174D'], glosarium: ['Glosarium', 'book-a', '#374151'], pelajaran: ['Pelajaran Interaktif', 'route', '#0E7490'], umpanbalik: ['Survei', 'smile-plus', '#A16207'],
  kelasvirtual: ['Kelas Virtual', 'video', '#DC2626'], berkas: ['Berkas', 'file-text', '#475569'], folder: ['Folder', 'folder-open', '#475569'], halaman: ['Halaman', 'file-type', '#475569'],
  label: ['Label', 'tag', '#475569'], url: ['Tautan URL', 'link', '#475569'], web: ['Web Eksternal', 'globe', '#475569']
};
function tipeLabel(t) { return (LMS_TIPE[t] || [t])[0]; }
function tipeIkon(t, cls) { var x = LMS_TIPE[t] || ['', 'circle', '#475569']; return '<span class="tipe-ic' + (cls ? ' ' + cls : '') + '" style="--tc:' + x[2] + '">' + ic(x[1]) + '</span>'; }
function isAktivitas(t) { return /^(kuis|tugas|forum|wiki|workshop|glosarium|pelajaran|umpanbalik|kelasvirtual)$/.test(t); }

/** Markdown ringan yang AMAN (semua teks di-escape lebih dulu) */
function md(src, opt) {
  opt = opt || {};
  var lines = String(src == null ? '' : src).replace(/\r/g, '').split('\n'), out = [], list = null, para = [];
  function inline(t) {
    t = esc(t);
    t = t.replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/(^|[\s(])\*([^*\s][^*]*)\*(?=[\s).,!?:;]|$)/g, '$1<i>$2</i>')
      .replace(/(^|[\s(])_([^_\s][^_]*)_(?=[\s).,!?:;]|$)/g, '$1<i>$2</i>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
      .replace(/\[\[([^\]]{1,100})\]\]/g, opt.wiki ? '<a href="#" class="wiki-link" data-wiki="$1">$1</a>' : '<b>$1</b>');
    return t.replace(/(^|\s)(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
  }
  function tutupPara() { if (para.length) { out.push('<p>' + para.map(inline).join('<br>') + '</p>'); para = []; } }
  function tutupList() { if (list) { out.push('</' + list + '>'); list = null; } }
  lines.forEach(function (ln) {
    var m;
    if (!ln.trim()) { tutupPara(); tutupList(); return; }
    if ((m = ln.match(/^(#{1,3})\s+(.*)$/))) { tutupPara(); tutupList(); var lv = Math.min(4, m[1].length + 2); out.push('<h' + lv + '>' + inline(m[2]) + '</h' + lv + '>'); return; }
    if ((m = ln.match(/^\s*[-*•]\s+(.*)$/))) { tutupPara(); if (list !== 'ul') { tutupList(); out.push('<ul>'); list = 'ul'; } out.push('<li>' + inline(m[1]) + '</li>'); return; }
    if ((m = ln.match(/^\s*\d+[.)]\s+(.*)$/))) { tutupPara(); if (list !== 'ol') { tutupList(); out.push('<ol>'); list = 'ol'; } out.push('<li>' + inline(m[1]) + '</li>'); return; }
    if ((m = ln.match(/^>\s?(.*)$/))) { tutupPara(); tutupList(); out.push('<blockquote>' + inline(m[1]) + '</blockquote>'); return; }
    tutupList(); para.push(ln);
  });
  tutupPara(); tutupList();
  return '<div class="mdx">' + out.join('') + '</div>';
}
function tglJam(iso, pendek) {
  if (!iso) return '-';
  var d = new Date(String(iso).length === 16 ? iso + ':00+07:00' : iso); if (isNaN(d)) return iso;
  return d.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short', year: pendek ? undefined : 'numeric', hour: '2-digit', minute: '2-digit' });
}
function msDari(t) { return t ? new Date(String(t).length === 16 ? t + ':00+07:00' : t).getTime() : 0; }
function durasi(det) {
  det = Math.max(0, Math.round(Number(det) || 0));
  if (det < 60) return det + ' dtk';
  var j = Math.floor(det / 3600), m = Math.floor((det % 3600) / 60), s = det % 60;
  return j ? j + ' jam ' + m + ' mnt' : m + ' mnt' + (s && m < 10 ? ' ' + s + ' dtk' : '');
}
function sisaWaktu(ms) {
  if (ms <= 0) return 'lewat';
  var h = Math.floor(ms / 864e5), j = Math.floor((ms % 864e5) / 36e5), m = Math.floor((ms % 36e5) / 6e4);
  return h ? h + ' hari ' + j + ' jam' : j ? j + ' jam ' + m + ' mnt' : m + ' mnt';
}
function jamDetik(ms) { ms = Math.max(0, ms); var t = Math.floor(ms / 1000), j = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60; return (j ? j + ':' + ('0' + m).slice(-2) : m) + ':' + ('0' + s).slice(-2); }
/** URL berkas: demo lokal / tautan langsung / Google Drive */
function berkasUrl(b) { if (!b) return '#'; if (b.url) return b.url; if (DEMO) { var u = DemoServer.fileUrl(b.id); if (u) return u; } return 'https://drive.google.com/file/d/' + b.id + '/view'; }
function berkasPratinjau(b) { if (!b) return ''; if (b.url) return b.url; if (DEMO) return DemoServer.fileUrl(b.id) || ''; return 'https://drive.google.com/file/d/' + b.id + '/preview'; }
function berkasIkon(nama) { var e = String(nama || '').split('.').pop().toLowerCase(); return /pdf/.test(e) ? 'file-text' : /png|jpe?g|gif|webp|svg/.test(e) ? 'image' : /docx?|odt|rtf/.test(e) ? 'file-type' : /xlsx?|csv|ods/.test(e) ? 'file-spreadsheet' : /pptx?|odp/.test(e) ? 'presentation' : /zip|rar|7z/.test(e) ? 'file-archive' : 'file'; }
function daftarBerkas(list, opt) {
  opt = opt || {};
  if (!list || !list.length) return opt.kosong === false ? '' : '<div class="muted small">Tidak ada berkas.</div>';
  return '<div class="berkas-list">' + list.map(function (b) {
    return '<div class="berkas-i">' + ic(berkasIkon(b.nama)) + '<a href="' + esc(berkasUrl(b)) + '" target="_blank" rel="noopener" class="grow ellipsis" ' + (DEMO && !b.url ? 'download="' + esc(b.nama) + '"' : '') + '>' + esc(b.nama) + '</a><span class="xs muted">' + esc(fmtSize(b.ukuran)) + '</span>' +
      (opt.hapus ? '<label class="chk xs"><input type="checkbox" data-hapus-berkas="' + esc(b.id) + '"> hapus</label>' : '') + '</div>';
  }).join('') + '</div>';
}
/** Pilih berkas dari perangkat → [{name, mime, data(base64), size}] */
function pilihBerkas(opt) {
  opt = opt || {};
  return new Promise(function (res) {
    var inp = document.createElement('input'); inp.type = 'file'; if (opt.multiple) inp.multiple = true; if (opt.accept) inp.accept = opt.accept;
    inp.onchange = async function () {
      var maks = (opt.maksMB || Number(cfg('LMS_MAKS_MB', 10)) || 10) * 1048576, out = [];
      for (var i = 0; i < inp.files.length; i++) {
        var f = inp.files[i];
        if (f.size > maks) { toast('"' + f.name + '" melebihi ' + Math.round(maks / 1048576) + ' MB.', 'bad'); continue; }
        out.push(await readFileB64(f));
      }
      res(out);
    };
    inp.click();
  });
}
function barProgres(p, cls) { p = Math.max(0, Math.min(100, Number(p) || 0)); return '<div class="pbar ' + (cls || '') + '"><span style="width:' + p + '%"></span></div>'; }
function selOpts(opts, val) { return opts.map(function (o) { var v = Array.isArray(o) ? o[0] : o, t = Array.isArray(o) ? o[1] : o; return '<option value="' + esc(v) + '"' + (String(v) === String(val) ? ' selected' : '') + '>' + esc(t) + '</option>'; }).join(''); }
function peranLabel(r) { return { superadmin: 'Super Admin', guru: 'Guru', siswa: 'Siswa', admin: 'Super Admin', pengajar: 'Pengajar' }[r] || r; }
function salinTeks(t) { if (navigator.clipboard) navigator.clipboard.writeText(t).then(function () { toast('Disalin.', 'ok'); }, function () { toast('Gagal menyalin.', 'bad'); }); }
/** Daftarkan halaman untuk satu/lebih peran memakai pabrik definisi (state terpisah per peran) */
function daftarHalaman(peran, nama, pabrik) { peran.forEach(function (r) { registerPage(r, nama, pabrik(r)); }); }

// =====================================================================
// v3.1 — TURBO LMS (gas-scale-turbo §4): tampil seketika dari cache perangkat,
// segarkan di latar (beberapa baca di tik yang sama = 1 eksekusi batch),
// render ulang hanya bila data berubah DAN pengguna belum mulai berinteraksi.
// =====================================================================
var Interaksi = { n: 0 };
['pointerdown', 'keydown'].forEach(function (ev) { addEventListener(ev, function () { Interaksi.n++; }, { capture: true, passive: true }); });
/** Ada isian yang sedang diketik / dialog terbuka → jangan ganti tampilan diam-diam */
function adaIsian() {
  if ($('.overlay')) return true;
  var a = document.activeElement;
  return !!(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.closest('#content'));
}
var LC = {
  MAKS: 150, UMUR: 30 * 60000, mem: {},
  kunci: function (a, d) { return 'lc:' + a + '|' + JSON.stringify(d || {}); },
  idx: function () { return Store.get(userKey('lc:idx'), []); },
  get: function (k) { var uk = userKey(k); if (this.mem[uk]) return this.mem[uk]; var v = Store.get(uk, null); if (v) this.mem[uk] = v; return v; },
  set: function (k, data) {
    var uk = userKey(k), v = { t: Date.now(), h: hashStr(JSON.stringify(data)), data: data };
    this.mem[uk] = v; Store.set(uk, v);
    var ix = this.idx().filter(function (x) { return x !== k; }); ix.push(k);
    while (ix.length > this.MAKS) { var b = ix.shift(); delete this.mem[userKey(b)]; Store.del(userKey(b)); }
    Store.set(userKey('lc:idx'), ix);
    return v;
  },
  hapus: function (fn) {
    var self = this, sisa = [];
    this.idx().forEach(function (k) { if (fn(k)) { delete self.mem[userKey(k)]; Store.del(userKey(k)); } else sisa.push(k); });
    Store.set(userKey('lc:idx'), sisa);
  }
};
/**
 * Baca cache-dulu: cb dipanggil SEKETIKA dengan data cache (bila ada), lalu sekali lagi
 * dengan data server bila berubah. Pengganti pola api(aksi, data).then(cb).
 */
function apiLR(action, data, cb) {
  var cari = data && (data.cari || data.q), k = LC.kunci(action, data), c = cari ? null : LC.get(k);
  var rute = location.hash, n0 = Interaksi.n, tampil = false;
  if (c && Date.now() - c.t < LC.UMUR) {
    tampil = true;
    try { cb({ success: true, data: c.data, cached: true }); } catch (e) { console.error(e); }
    if (Date.now() - c.t < 4000) return;                         // baru saja segar → tidak perlu ke server
  }
  apiQ(action, data).then(function (r) {
    if (r.success && !cari) {
      var h = hashStr(JSON.stringify(r.data)); LC.set(k, r.data);
      if (c && c.h === h && tampil) return;                       // sama → tidak render ulang
    }
    if (location.hash !== rute) return;                            // sudah pindah halaman
    if (tampil && (!r.success || Interaksi.n !== n0 || adaIsian())) return;
    cb(r);
  });
}
// Aksi tulis LMS → cache baca yang memuat ID terkait dibuang (tanpa ID → semua cache LMS dibuang)
(Hooks.tulis = Hooks.tulis || []).push(function (action, data) {
  if (!/^(lms|kuis|tugas|forum|wiki|glos|ws|pel|ub|kv|nilai|soal|rubrik)\./.test(action)) return;
  var ids = [];
  Object.keys(data || {}).forEach(function (f) { var v = data[f]; if (typeof v === 'string' && /^[A-Z]{2,6}\d{3,}$/.test(v)) ids.push(v); });
  LC.hapus(function (k) { return !ids.length || ids.some(function (id) { return k.indexOf(id) > -1; }); });
});

/** Indeks modul dari data kursus yang sudah dibuka → halaman aktivitas tampil tanpa menunggu server */
var LmsIdx = {
  m: {},
  isi: function (d) {
    if (!d || !d.kursus) return;
    var k = d.kursus;
    (d.modul || []).forEach(function (m) { LmsIdx.m[m.modul_id] = Object.assign({}, m, { kursus_id: k.kursus_id, kursus_nama: k.nama, peran: k.peran, kelola: !!k.kelola, _sementara: true }); });
  }
};
/** Prefetch saat idle setelah masuk: daftar kursus & pesan (digabung 1 batch) */
Hooks.shell.push(function () {
  (window.requestIdleCallback || function (f) { setTimeout(f, 1200); })(function () {
    if (!AppState.token) return;
    function ambil(kunci, aksi) {                                  // semua di tik yang sama → 1 eksekusi batch
      var c = Store.get(userKey(kunci), null);
      if (!c || Date.now() - c.t > 60000) apiQ(aksi, {}).then(function (r) { if (r && r.success) Store.set(userKey(kunci), { t: Date.now(), h: hashStr(JSON.stringify(r.data)), data: r.data }); });
    }
    ambil('lms:kursus', 'lms.kursus.list');
    ambil('lc:pesan.daftar|{}', 'pesan.daftar');
    if (isSiswa()) ambil('billing.mine', 'billing.mine');
  }, { timeout: 3000 });
});
/** Prefetch detail kursus (dipanggil halaman daftar kursus) — hanya yang belum ada/lebih dari 2 menit */
function prefetchKursus(ids) {
  (window.requestIdleCallback || function (f) { setTimeout(f, 800); })(function () {
    (ids || []).slice(0, 6).forEach(function (kid, i) {
      var c = Store.get(userKey('lms:k:' + kid), null);
      if (c && Date.now() - c.t < 120000) return;
      setTimeout(function () {
        api('lms.kursus.get', { kursus_id: kid }).then(function (r) { if (r && r.success) { Store.set(userKey('lms:k:' + kid), { t: Date.now(), h: hashStr(JSON.stringify(r.data)), data: r.data }); LmsIdx.isi(r.data); } });
      }, i * 250);
    });
  }, { timeout: 2500 });
}
/** Saat kursus dibuka: isi aktivitas yang kemungkinan dibuka berikutnya diambil di latar
    (maks 6, digabung 1 batch, hanya aksi baca tanpa efek samping). Membuka aktivitas jadi seketika. */
var PREFETCH_AKT = {
  siswa: { kuis: 'kuis.info', forum: 'forum.list', glosarium: 'glos.list', workshop: 'ws.get', umpanbalik: 'ub.get' },
  guru: { kuis: 'kuis.info', forum: 'forum.list', glosarium: 'glos.list', workshop: 'ws.get', umpanbalik: 'ub.get', tugas: 'tugas.list' }
};
function prefetchAktivitas(d) {
  if (!d || !d.kursus || !d.modul) return;
  (window.requestIdleCallback || function (f) { setTimeout(f, 900); })(function () {
    var kelola = !!d.kursus.kelola, peta = PREFETCH_AKT[kelola ? 'guru' : 'siswa'], n = 0;
    d.modul.filter(function (m) { return peta[m.tipe] && (kelola || (!m.terkunci && m.tampil !== 'TIDAK')); })
      .sort(function (a, b) { return (a.status ? 1 : 0) - (b.status ? 1 : 0); })          // yang belum selesai dulu
      .forEach(function (m) {
        if (n >= 6) return;
        var aksi = peta[m.tipe], data = m.tipe === 'glosarium' ? { modul_id: m.modul_id, cari: '', huruf: '' } : { modul_id: m.modul_id };
        var k = LC.kunci(aksi, data), c = LC.get(k);
        if (c && Date.now() - c.t < 120000) return;
        n++; apiQ(aksi, data).then(function (r) { if (r && r.success) LC.set(k, r.data); });
      });
  }, { timeout: 2500 });
}
/** Ganti akun di perangkat yang sama → cache memori milik akun sebelumnya dibuang */
Hooks.login.push(function () {
  LmsIdx.m = {}; LC.mem = {};
  if (typeof LmsOpsi !== 'undefined') Object.keys(LmsOpsi).forEach(function (k) { delete LmsOpsi[k]; });
});
