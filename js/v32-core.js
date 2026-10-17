/* =====================================================================
   SIAKAD SISWA v3.2 — v32-core.js
   Menu tambahan (Mapel & Pertemuan, Jurnal Mengajar, Rating Guru), aksi baca baru,
   captcha penjumlahan di halaman login, dan panel Tampilan (tema warna + mode gelap).
   Menempel lewat titik sambung yang sudah ada — halaman lama tidak diubah.
   ===================================================================== */
'use strict';

// ---------------------------------------------------------------- Aksi baca baru (boleh dedupe & digabung batch)
(function () {
  var tambah = 'ptm\\.(ringkas|list|get|opsi|jurnal)|rating\\.(saya|guru|rekap)|captcha\\.baru';
  var dasar = window.READ_EXT ? READ_EXT.source.replace(/^\^/, '').replace(/\$$/, '') : '(?!)';
  READ_EXT = new RegExp('^(?:' + dasar + '|' + tambah + ')$');
})();

// Aksi tulis v3.2 → cache baca terkait di perangkat dibuang (data berikutnya selalu segar)
(Hooks.tulis = Hooks.tulis || []).push(function (action) {
  if (!window.LC) return;
  if (/^ptm\./.test(action)) LC.hapus(function (k) { return /^lc:ptm\./.test(k); });
  if (/^rating\./.test(action)) LC.hapus(function (k) { return /^lc:rating\./.test(k); });
});

// ---------------------------------------------------------------- Menu
(function () {
  function sisip(list, setelah, items) { var i = list.map(function (m) { return m.p; }).indexOf(setelah); if (i < 0) i = list.length - 1; Array.prototype.splice.apply(list, [i + 1, 0].concat(items)); }
  if (typeof MENU_DEF === 'undefined') return;
  sisip(MENU_DEF.guru, 'jadwal', [{ p: 'pertemuan', t: 'Mapel & Pertemuan', i: 'notebook-tabs' }, { p: 'jurnal', t: 'Jurnal Mengajar', i: 'notebook-pen' }]);
  sisip(MENU_DEF.guru, 'laporan', [{ p: 'ratingguru', t: 'Rating Guru', i: 'star' }]);
  sisip(MENU_DEF.siswa, 'materi', [{ p: 'mapel', t: 'Mata Pelajaran', i: 'notebook-tabs' }]);
  sisip(MENU_DEF.siswa, 'jadwal', [{ p: 'ratingguru', t: 'Rating Guru', i: 'star' }]);
})();

// ---------------------------------------------------------------- Captcha login (soal penjumlahan dari server)
var Captcha = {
  aktif: null, token: '', _n: 0,
  pasang: function (f) {
    if (!f || $('#capBox', f)) return;
    var box = h('<div class="field mt16 cap-box" id="capBox" hidden><label for="lgCap">Verifikasi keamanan</label>' +
      '<div class="cap-row"><span class="cap-soal" id="lgCapSoal" aria-live="polite"><span class="sk" style="width:90px;height:22px;display:inline-block"></span></span>' +
      '<input class="inp" id="lgCap" name="captcha" inputmode="numeric" pattern="-?[0-9]*" maxlength="4" autocomplete="off" placeholder="Jawaban" aria-describedby="capHint">' +
      '<button type="button" class="btn-ic" id="lgCapNew" title="Ganti soal" aria-label="Ganti soal">' + ic('rotate-cw') + '</button></div>' +
      '<div class="hint" id="capHint">Tulis hasil hitungan di atas untuk membuktikan Anda bukan robot.</div></div>');
    var err = $('#lgErr', f); err.parentNode.insertBefore(box, err);
    $('#lgCapNew', box).onclick = function () { Captcha.muat(true); $('#lgCap').focus(); };
    this.muat();
  },
  muat: async function (fokus) {
    var n = ++this._n, soal = $('#lgCapSoal');
    if (!soal) return;
    if (this.aktif) soal.innerHTML = '<span class="sk" style="width:90px;height:22px;display:inline-block"></span>';
    var r = await api('captcha.baru', { n: n });                  // n: kunci unik → tidak menumpang permintaan lain
    if (n !== this._n || !$('#capBox')) return;
    var box = $('#capBox');
    if (!r.success) {
      if (/tidak dikenal/i.test(r.message || '')) { this.aktif = false; box.hidden = true; return; }   // server lama (tanpa captcha)
      this.aktif = true; box.hidden = false; $('#lgCapSoal').innerHTML = '<span class="small red">Soal gagal dimuat — klik ' + ic('rotate-cw') + '</span>'; return;
    }
    if (!r.data || !r.data.aktif) { this.aktif = false; box.hidden = true; return; }
    this.aktif = true; this.token = r.data.token; box.hidden = false;
    $('#lgCapSoal').textContent = r.data.soal; $('#lgCap').value = '';
    if (fokus) $('#lgCap').focus();
  },
  isian: function () { return this.aktif ? { token: this.token, jawab: (($('#lgCap') || {}).value || '').trim() } : undefined; },
  kosong: function () { return this.aktif && !(($('#lgCap') || {}).value || '').trim(); }
};
Hooks.login.push(function (f) { Captcha.aktif = null; Captcha.pasang(f); });

// ---------------------------------------------------------------- Panel Tampilan (tema warna & mode gelap) — per perangkat
function tampilanPanel(box, ringkas) {
  if (!box || !window.Tema) return;
  function gambar() {
    var t = Tema.get(), mode = t.mode || 'terang', warna = t.warna || 'sekolah', brand = (window.Brand ? Brand.get().warna : '#1E3A5F');
    box.innerHTML = (ringkas ? '<h3>' + ic('palette') + ' Tampilan</h3><p class="small muted" style="margin:4px 0 14px">Mode & warna tema berlaku di perangkat ini.</p>' :
      '<div class="card"><div class="card-h"><div class="grow"><h3>' + ic('palette') + ' Tampilan Aplikasi</h3><p>Pilih mode terang/gelap dan warna tema. Tersimpan di perangkat ini — tiap pengguna bisa memilih sendiri.</p></div></div><div class="card-b">') +
      '<div class="xs b muted">MODE</div><div class="mode-pilih mt8" id="tmMode">' +
      [['terang', 'sun', 'Terang', 'Latar putih, nyaman di siang hari'], ['gelap', 'moon', 'Gelap', 'Latar gelap, hemat mata & baterai'], ['sistem', 'monitor-smartphone', 'Ikuti perangkat', 'Otomatis mengikuti setelan HP/laptop']].map(function (m) {
        return '<button type="button" data-mode="' + m[0] + '" class="' + (mode === m[0] ? 'on' : '') + '" aria-pressed="' + (mode === m[0]) + '"><span class="mp-ic">' + ic(m[1]) + '</span><b>' + m[2] + '</b><small>' + m[3] + '</small></button>';
      }).join('') + '</div>' +
      '<div class="xs b muted mt16">WARNA TEMA</div><div class="warna-pilih mt8" id="tmWarna">' +
      Object.keys(Tema.WARNA).map(function (k) {
        var w = Tema.WARNA[k], hex = w ? w[0] : brand, nama = w ? w[1] : 'Warna sekolah';
        return '<button type="button" data-warna="' + k + '" class="' + (warna === k ? 'on' : '') + '" aria-pressed="' + (warna === k) + '" title="' + esc(nama) + '"><span class="sw" style="background:' + esc(hex) + '">' + (warna === k ? ic('check') : '') + '</span><small>' + esc(nama) + '</small></button>';
      }).join('') + '</div>' +
      '<div class="tm-pratinjau mt16"><div class="tp-side"></div><div class="tp-main"><div class="tp-top"></div><div class="tp-card"><i></i><i></i><span class="tp-btn"></span></div></div></div>' +
      (ringkas ? '' : '<div class="note mt16">' + ic('info') + '<div>"Warna sekolah" mengikuti warna Branding yang diatur Super Admin. Pilihan Anda tidak mengubah tampilan pengguna lain.</div></div></div></div>');
    $$('#tmMode button', box).forEach(function (b) { b.onclick = function () { Tema.set({ mode: b.dataset.mode }); gambar(); }; });
    $$('#tmWarna button', box).forEach(function (b) { b.onclick = function () { Tema.set({ warna: b.dataset.warna }); gambar(); }; });
  }
  gambar();
}
(function () {
  var pg = Pages.guru && Pages.guru.pengaturan;
  if (pg) pg.t_tampilan = function (box) { tampilanPanel(box, false); };
})();

// ---------------------------------------------------------------- Bantuan bersama v3.2
function persenBar(p, cls) { p = Math.max(0, Math.min(100, Number(p) || 0)); return '<div class="pbar ' + (cls || '') + '" role="progressbar" aria-valuenow="' + p + '" aria-valuemin="0" aria-valuemax="100"><span style="width:' + p + '%"></span></div>'; }
function bintangHtml(n, besar) {
  n = Number(n) || 0; var out = '';
  for (var i = 1; i <= 5; i++) out += '<span class="bt ' + (n >= i - 0.25 ? 'penuh' : n >= i - 0.75 ? 'separuh' : '') + '">' + ic('star') + '</span>';
  return '<span class="bintang' + (besar ? ' besar' : '') + '" aria-label="' + fmtN(n) + ' dari 5 bintang">' + out + '</span>';
}
function hariTgl(t) { if (!t) return '-'; var d = new Date(String(t).substring(0, 10) + 'T12:00:00'); return isNaN(d) ? t : d.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); }
function kodeMapelPtm(kelas, mapel) { return kelas + '~' + mapel; }
function bacaKodeMapel(p) { var i = String(p || '').indexOf('~'); return i < 0 ? null : { kelas_id: p.substring(0, i), mata_pelajaran: p.substring(i + 1) }; }
/** Server lama (belum v3.2) → pesan yang jelas, bukan "Aksi tidak dikenal" */
function pesanV32(msg) { return /tidak dikenal/i.test(msg || '') ? 'Fitur ini membutuhkan backend v3.2: tempel Pertemuan.gs, RatingGuru.gs & Captcha.gs di Apps Script lalu Deploy → Manage deployments → Edit → New version.' : msg; }
