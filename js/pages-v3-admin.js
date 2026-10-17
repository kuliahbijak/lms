/* =====================================================================
   SIAKAD SISWA v3.0 — pages-v3-admin.js : Halaman Super Admin v3
   Log Aktivitas (login, halaman & durasi, durasi kuis/tugas), Keamanan
   Lanjutan (login Google OAuth, batas IP via proxy, sesi idle, anti-spam),
   Branding white-label (nama, tagline, logo, warna).
   ===================================================================== */
'use strict';

var JENIS_LOG = { login: ['Login', 'ok'], login_gagal: ['Login gagal', 'bad'], login_ditolak: ['Login ditolak', 'bad'], halaman: ['Halaman', 'info'], aksi: ['Aksi', 'navy'], spam: ['Spam diblokir', 'warn'], keamanan: ['Keamanan', 'warn'] };

// =====================================================================
// LOG AKTIVITAS
// =====================================================================
registerPage('guru', 'logaktivitas', {
  title: 'Log Aktivitas', sa: true,
  render: function (el) {
    var self = this, t = todayStr();
    self.f = { dari: t, sampai: t, peran: '', jenis: '', uid: '', q: '' }; self.tab = 'ringkas';
    el.innerHTML = pageHead('Super Admin <span>/ Log Aktivitas</span>', 'Pelacakan & Log Aktivitas', 'Riwayat login, halaman yang diakses beserta durasinya, aksi penting, dan durasi pengerjaan kuis/tugas.',
      '<button class="btn btn-outline" id="laCsv">' + ic('download') + 'CSV</button><button class="btn btn-outline" id="laSeg">' + ic('refresh-cw') + 'Segarkan</button>') +
      '<div class="card card-p"><div class="row wrap gap8"><label class="small">Dari <input class="inp" type="date" id="laDari" value="' + t + '"></label><label class="small">Sampai <input class="inp" type="date" id="laSampai" value="' + t + '"></label>' +
      '<select class="sel" id="laPeran" style="max-width:150px"><option value="">Semua peran</option><option value="siswa">Siswa</option><option value="guru">Guru</option><option value="superadmin">Super Admin</option></select>' +
      '<select class="sel" id="laJenis" style="max-width:170px"><option value="">Semua jenis</option>' + Object.keys(JENIS_LOG).map(function (k) { return '<option value="' + k + '">' + JENIS_LOG[k][0] + '</option>'; }).join('') + '</select>' +
      '<div class="inp-ic grow">' + ic('search') + '<input class="inp" id="laQ" placeholder="Cari nama…"></div></div><div id="laUid" class="mt8"></div></div><div id="laBody" class="mt16"><div class="sk" style="height:300px"></div></div>';
    ['laDari', 'laSampai', 'laPeran', 'laJenis'].forEach(function (id) { $('#' + id, el).onchange = function () { self.f.dari = $('#laDari', el).value; self.f.sampai = $('#laSampai', el).value; self.f.peran = $('#laPeran', el).value; self.f.jenis = $('#laJenis', el).value; self.muat(el); }; });
    $('#laQ', el).oninput = debounce(function () { self.f.q = this.value.toLowerCase(); self.gambar(el); }, 250);
    $('#laSeg', el).onclick = function () { self.muat(el, true); };
    $('#laCsv', el).onclick = function () { if (!self.d) return; downloadCSV('log-aktivitas-' + self.f.dari + '_' + self.f.sampai + '.csv', ['Waktu', 'Nama', 'Peran', 'Jenis', 'Halaman', 'Objek', 'Durasi (detik)', 'Kunjungan', 'IP', 'Perangkat', 'Detail'], self.d.baris.map(function (r) { return [r.waktu, r.nama, r.peran, r.jenis, r.halaman, r.objek, r.durasi_detik, r.kunjungan, r.ip, r.perangkat, r.detail]; })); };
    self.muat(el);
  },
  muat: function (el, segar) {
    var self = this, p = { dari: this.f.dari, sampai: this.f.sampai, peran: this.f.peran, jenis: this.f.jenis, uid: this.f.uid };
    if (segar) p._fresh = true;
    $('#laUid', el).innerHTML = this.f.uid ? '<span class="chip">' + ic('user-round') + 'Pengguna: ' + esc(this.f.uidNama || this.f.uid) + ' <a href="#" id="laUidX">×</a></span>' : '';
    if ($('#laUidX', el)) $('#laUidX', el).onclick = function (e) { e.preventDefault(); self.f.uid = ''; self.muat(el); };
    api('log.aktivitas', p).then(function (r) { if (!r.success) { $('#laBody', el).innerHTML = errorBox(r.message); return; } self.d = r.data; self.gambar(el); });
  },
  gambar: function (el) {
    var self = this, d = this.d, q = this.f.q, ring = d.ringkas.filter(function (x) { return !q || String(x.nama).toLowerCase().indexOf(q) > -1; });
    var totDur = d.ringkas.reduce(function (s, x) { return s + x.durasi; }, 0);
    $('#laBody', el).innerHTML = '<div class="grid g4">' + kpi('Pengguna aktif', d.ringkas.length, d.ringkas.filter(function (x) { return x.online; }).length + ' sedang online', 'users', 'info') + kpi('Login', d.jenis.login || 0, (d.jenis.login_gagal || 0) + ' gagal • ' + (d.jenis.login_ditolak || 0) + ' ditolak', 'log-in', (d.jenis.login_gagal || 0) > 5 ? 'bad' : 'ok') +
      kpi('Waktu belajar', durasi(totDur), 'total durasi halaman', 'timer') + kpi('Kejadian', d.total, (d.jenis.spam || 0) + ' spam diblokir', 'activity', d.jenis.spam ? 'amber' : '') + '</div>' +
      '<div class="tabs mt16" id="laTab"><button data-t="ringkas" class="' + (self.tab === 'ringkas' ? 'on' : '') + '">' + ic('users') + 'Per pengguna</button><button data-t="durasi" class="' + (self.tab === 'durasi' ? 'on' : '') + '">' + ic('timer') + 'Durasi kuis & tugas</button><button data-t="semua" class="' + (self.tab === 'semua' ? 'on' : '') + '">' + ic('list') + 'Semua kejadian</button></div><div class="card mt12" id="laIsi"></div>';
    var box = $('#laIsi', el);
    if (self.tab === 'ringkas') box.innerHTML = '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Pengguna</th><th class="tc">Login</th><th class="tr">Durasi</th><th class="hide-m">Halaman teratas</th><th>Terakhir aktif</th><th></th></tr></thead><tbody>' +
      (ring.length ? ring.map(function (x) { return '<tr><td><div class="row gap8">' + avatar(x.nama, '', 'sm') + '<div><b>' + esc(x.nama) + '</b>' + (x.online ? ' <span class="online-dot" title="Online"></span>' : '') + '<div class="xs muted">' + esc(peranLabel(x.peran)) + (x.last_login ? ' • login terakhir ' + esc(relTime(x.last_login)) : '') + '</div></div></div></td><td class="tc">' + x.login + (x.gagal ? ' <span class="bdg bad">' + x.gagal + ' gagal</span>' : '') + '</td><td class="tr"><b>' + durasi(x.durasi) + '</b><div class="xs muted">' + x.kunjungan + ' kunjungan • ' + x.aksi + ' aksi</div></td><td class="hide-m small">' + esc(x.teratas.join(', ') || '-') + '</td><td class="small">' + esc(relTime(x.terakhir)) + '</td><td class="tr nowrap"><button class="btn btn-ghost btn-xs" data-uid="' + esc(x.uid) + '" data-nama="' + esc(x.nama) + '">' + ic('list') + 'Riwayat</button><button class="btn-ic" data-keluar="' + esc(x.uid) + '" title="Akhiri semua sesi">' + ic('log-out') + '</button></td></tr>'; }).join('') : '<tr><td colspan="6">' + emptyHtml('Tidak ada aktivitas', 'Ubah rentang tanggal atau filter.', 'activity') + '</td></tr>') + '</tbody></table></div>';
    else if (self.tab === 'durasi') box.innerHTML = '<div class="card-h"><div class="grow"><h3>Durasi pengerjaan</h3><p>Dari mulai hingga kirim (kuis) / dari pertama dibuka hingga dikumpulkan (tugas)</p></div></div><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Waktu</th><th>Siswa</th><th>Jenis</th><th>Aktivitas</th><th class="tr">Durasi</th><th class="tr">Nilai</th></tr></thead><tbody>' +
      (d.durasiTugas.length ? d.durasiTugas.map(function (x) { return '<tr><td class="small">' + esc(tglJam(x.waktu, true)) + '</td><td>' + esc(x.nama) + '</td><td><span class="bdg ' + (x.jenis === 'Kuis' ? 'info' : 'amber') + '">' + esc(x.jenis) + '</span></td><td class="small">' + esc(x.judul) + '</td><td class="tr"><b>' + durasi(x.durasi_detik) + '</b></td><td class="tr">' + (x.nilai === null ? '-' : fmtN(x.nilai)) + '</td></tr>'; }).join('') : '<tr><td colspan="6">' + emptyHtml('Belum ada kuis/tugas dikirim pada rentang ini', '', 'timer') + '</td></tr>') + '</tbody></table></div>';
    else box.innerHTML = '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Waktu</th><th>Pengguna</th><th>Jenis</th><th>Halaman / aksi</th><th class="tr">Durasi</th><th class="hide-m">IP / perangkat</th><th class="hide-m">Detail</th></tr></thead><tbody>' +
      d.baris.filter(function (x) { return !q || String(x.nama).toLowerCase().indexOf(q) > -1; }).slice(0, 600).map(function (x) { var j = JENIS_LOG[x.jenis] || [x.jenis, '']; return '<tr><td class="small nowrap">' + esc(tglJam(x.waktu, true)) + '</td><td class="small">' + esc(x.nama || '—') + '</td><td><span class="bdg ' + j[1] + '">' + esc(j[0]) + '</span></td><td class="small">' + esc(x.halaman) + (x.objek ? ' <span class="muted">' + esc(x.objek) + '</span>' : '') + '</td><td class="tr small">' + (Number(x.durasi_detik) ? durasi(x.durasi_detik) + (Number(x.kunjungan) > 1 ? ' <span class="xs muted">×' + x.kunjungan + '</span>' : '') : '') + '</td><td class="hide-m xs muted">' + esc([x.ip, x.perangkat].filter(String).join(' • ')) + '</td><td class="hide-m xs">' + esc(x.detail) + '</td></tr>'; }).join('') + '</tbody></table></div>';
    $$('#laTab button', el).forEach(function (b) { b.onclick = function () { self.tab = b.dataset.t; self.gambar(el); }; });
    box.onclick = async function (e) {
      var u = e.target.closest('[data-uid]'); if (u) { self.f.uid = u.dataset.uid; self.f.uidNama = u.dataset.nama; self.tab = 'semua'; self.muat(el); return; }
      var k = e.target.closest('[data-keluar]'); if (k) { if (!await confirmBox('Akhiri semua sesi login pengguna ini? Ia harus login ulang di semua perangkat.', { ok: 'Akhiri sesi' })) return; var r = await api('keamanan.keluarkan', { uid: k.dataset.keluar }); toastRes(r); }
    };
  }
});

// =====================================================================
// KEAMANAN LANJUTAN
// =====================================================================
var WORKER_SKRIP = [
  '// Cloudflare Worker — proxy IP bertanda tangan untuk SIAKAD SISWA (Apps Script)',
  '// Settings → Variables: GAS_URL = URL /exec Apps Script, PROXY_SECRET = sama dengan IP_PROXY_SECRET',
  'export default {',
  '  async fetch(request, env) {',
  "    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };",
  "    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });",
  '    const tujuan = new URL(env.GAS_URL), masuk = new URL(request.url);',
  "    masuk.searchParams.forEach((v, k) => { if (!k.startsWith('__')) tujuan.searchParams.set(k, v); });",
  "    const ip = request.headers.get('CF-Connecting-IP') || '';",
  "    const body = request.method === 'POST' ? await request.text() : '';",
  '    const ts = String(Date.now()), enc = new TextEncoder();',
  "    const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');",
  "    const hashIsi = hex(await crypto.subtle.digest('SHA-256', enc.encode(body)));",
  "    const kunci = await crypto.subtle.importKey('raw', enc.encode(env.PROXY_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);",
  "    const sig = hex(await crypto.subtle.sign('HMAC', kunci, enc.encode(ip + '|' + ts + '|' + hashIsi)));",
  "    tujuan.searchParams.set('__ip', ip); tujuan.searchParams.set('__ts', ts); tujuan.searchParams.set('__sig', sig);",
  "    const res = await fetch(tujuan.toString(), { method: request.method, body: request.method === 'POST' ? body : undefined,",
  "      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, redirect: 'follow' });",
  '    const keluar = new Response(res.body, res);',
  '    Object.entries(cors).forEach(([k, v]) => keluar.headers.set(k, v));',
  '    return keluar;',
  '  }',
  '};'].join('\n');
function secretAcak(n) { var a = new Uint8Array(n || 36); crypto.getRandomValues(a); return btoa(String.fromCharCode.apply(null, a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
registerPage('guru', 'keamanan2', {
  title: 'Keamanan Lanjutan', sa: true,
  render: function (el) {
    var self = this;
    el.innerHTML = pageHead('Super Admin <span>/ Keamanan Lanjutan</span>', 'Keamanan Tingkat Tinggi', 'Login Google untuk Super Admin, pembatasan IP, sesi aman, dan anti-spam. Kebijakan disimpan di Script Properties.') + '<div id="k2Body"><div class="sk" style="height:320px"></div></div>';
    api('keamanan.get', {}).then(function (r) { if (!r.success) { $('#k2Body', el).innerHTML = errorBox(r.message); return; } self.gambar(el, r.data); });
  },
  gambar: function (el, d) {
    var self = this, p = d.kebijakan, s = d.statistik24j;
    $('#k2Body', el).innerHTML = '<div class="grid g4">' + kpi('Login 24 jam', s.login, '', 'log-in', 'ok') + kpi('Login gagal 24 jam', s.gagal, 'termasuk ditolak', 'shield-x', s.gagal > 5 ? 'bad' : '') + kpi('Spam diblokir', s.spam, '24 jam terakhir', 'ban', s.spam ? 'amber' : '') + kpi('Batas laju terpicu', s.batasLaju, '', 'gauge', s.batasLaju ? 'amber' : '') + '</div>' +
      '<div class="grid g2 mt16"><div class="card card-p"><h3>' + ic('key-round') + ' Login Super Admin dengan Google (OAuth 2.0)</h3>' +
      '<div class="row gap8 mt12"><span class="small">Client ID:</span>' + (d.googleClientId ? '<span class="bdg ok">' + ic('check') + 'tersimpan di Script Properties</span>' : '<span class="bdg amber">belum diisi</span> <a href="#/keamanan" class="small">isi di menu Keamanan →</a>') + '</div>' +
      '<div class="field mt12"><label>Cara Super Admin masuk</label><select class="sel" id="k2Mode"' + (d.googleClientId ? '' : ' disabled') + '>' + selOpts([['sandi', 'Email & sandi saja'], ['keduanya', 'Sandi ATAU Google'], ['google', 'WAJIB Google (sandi Super Admin ditolak)']], p.saLoginMode) + '</select><div class="hint">Mode "wajib Google" baru bisa dipilih setelah Anda berhasil login sekali dengan Google. ' + (d.saGoogleSaya ? '<b class="ok-t">✓ Anda sudah pernah login Google.</b>' : '') + '</div></div>' +
      '<div class="xs b muted mt12">AKUN SUPER ADMIN</div>' + d.superadmin.map(function (x) { return '<div class="list-i small"><span class="grow">' + esc(x.nama) + ' <span class="muted">' + esc(x.email) + '</span></span>' + (x.google ? '<span class="bdg ok">Google ✓</span>' : '<span class="bdg">belum Google</span>') + '</div>'; }).join('') +
      '<details class="mt12"><summary class="small b">Cara membuat Client ID Google</summary><ol class="small langkah"><li>Buka <b>console.cloud.google.com</b> → buat/pilih proyek.</li><li><b>APIs & Services → OAuth consent screen</b>: tipe <i>External</i> (atau Internal untuk Workspace), isi nama aplikasi.</li><li><b>Credentials → Create credentials → OAuth client ID</b> → tipe <i>Web application</i>.</li><li><b>Authorized JavaScript origins</b>: isi alamat aplikasi, mis. <span class="kbd">https://nama.github.io</span> (tanpa garis miring di akhir).</li><li>Salin <b>Client ID</b> (…apps.googleusercontent.com) → menu <b>Keamanan</b> → GOOGLE_CLIENT_ID → Simpan.</li><li>Pilih mode "Sandi ATAU Google", keluar, lalu coba tombol Google di halaman login.</li></ol><div class="note mt8">' + ic('life-buoy') + '<div>Bila terkunci, jalankan <span class="kbd">resetSuperAdmin()</span> di editor Apps Script — login sandi & akses IP dibuka kembali otomatis.</div></div></details></div>' +
      '<div class="card card-p"><h3>' + ic('network') + ' Pembatasan Akses Berbasis IP</h3><div class="small mt8">Proxy: ' + (d.proxySecret ? '<span class="bdg ok">secret tersimpan</span>' : '<span class="bdg amber">belum dipasang</span>') + ' • IP Anda sekarang: ' + (d.ipSekarang.sah ? '<b class="mono">' + esc(d.ipSekarang.ip) + '</b> <span class="bdg ok">terverifikasi</span>' : '<span class="muted">tidak terbaca (tidak lewat proxy)</span>') + '</div>' +
      '<div class="note mt12">' + ic('info') + '<div>Apps Script tidak dapat melihat IP pengunjung. IP asli diteruskan oleh <b>Cloudflare Worker</b> (gratis) yang menandatanganinya dengan secret — tanpa proxy, fitur ini tidak aktif.</div></div>' +
      '<div class="grid-form mt12"><div class="field c12"><label>Batasi</label><select class="sel" id="k2Ip"' + (d.proxySecret ? '' : ' disabled') + '>' + selOpts([['mati', 'Tidak dibatasi'], ['sa', 'Hanya Super Admin'], ['staf', 'Super Admin & guru'], ['semua', 'Semua pengguna']], p.ipMode) + '</select></div>' +
      '<div class="field c12"><label>Daftar IP / rentang yang diizinkan (satu per baris)</label><textarea class="inp mono" id="k2IpL" rows="3" placeholder="203.0.113.0/24&#10;198.51.100.7&#10;2001:db8::/32">' + esc((p.ipDaftar || []).join('\n')) + '</textarea></div>' +
      '<div class="field c12"><label class="chk"><input type="checkbox" id="k2Wp"' + (p.ipWajibProxy ? ' checked' : '') + '> Tolak akses yang tidak lewat proxy (direkomendasikan)</label></div></div>' +
      '<details class="mt8"><summary class="small b">Pasang proxy Cloudflare Worker (±10 menit)</summary><ol class="small langkah"><li>Buat akun gratis di <b>dash.cloudflare.com</b> → <b>Workers & Pages → Create → Worker</b>.</li><li>Ganti kode dengan skrip di bawah → <b>Deploy</b>.</li><li><b>Settings → Variables</b>: tambah <span class="kbd">GAS_URL</span> = URL /exec Apps Script, dan <span class="kbd">PROXY_SECRET</span> (tipe <i>Secret</i>) = secret di bawah.</li><li>Menu <b>Keamanan</b> → IP_PROXY_SECRET → tempel secret yang sama → Simpan.</li><li>Ubah <span class="kbd">GAS_URL</span> di <span class="kbd">js/config.js</span> menjadi alamat Worker (…workers.dev) → git push.</li><li>Buka aplikasi lagi, pastikan "IP Anda sekarang" terverifikasi, baru aktifkan pembatasan.</li></ol>' +
      '<div class="row gap8 mt8"><input class="inp mono grow" id="k2Sec" readonly placeholder="Klik Bangkitkan"><button class="btn btn-outline btn-sm" id="k2Gen">' + ic('dices') + 'Bangkitkan</button><button class="btn btn-ghost btn-sm" id="k2SecC">' + ic('copy') + '</button></div><div class="hint">Secret dibuat di browser Anda dan tidak dikirim ke server — salin ke Cloudflare & menu Keamanan.</div>' +
      '<div class="row mt8"><b class="small grow">Skrip Worker</b><button class="btn btn-ghost btn-xs" id="k2SkC">' + ic('copy') + 'Salin skrip</button></div><pre class="kode">' + esc(WORKER_SKRIP) + '</pre></details></div></div>' +
      '<div class="grid g2 mt16"><div class="card card-p"><h3>' + ic('timer-reset') + ' Sesi Aman</h3><dl class="kv-list mt8"><dt>Masa sesi</dt><dd>' + d.sesiJam + ' jam (Super Admin maks ' + d.saSesiJam + ' jam)</dd><dt>Token</dt><dd>HMAC-SHA256, dicek ulang tiap permintaan (akun aktif & peran)</dd><dt>Enkripsi pesan</dt><dd>' + (d.enkripsi ? '<span class="bdg ok">aktif</span> aliran kunci HMAC-SHA256 + MAC, kunci di Script Properties' : '<span class="bdg amber">belum — jalankan setupV30()</span>') + '</dd><dt>Transport</dt><dd>HTTPS (Apps Script & GitHub Pages)</dd></dl>' +
      '<div class="field mt12"><label>Keluar otomatis bila tidak aktif (menit, 0 = nonaktif)</label><input class="inp" type="number" min="0" max="360" id="k2Idle" value="' + esc(p.idleMenit) + '" style="max-width:140px"></div>' +
      '<div class="field mt12"><label>Batas permintaan per pengguna per menit</label><input class="inp" type="number" min="30" max="1000" id="k2Rate" value="' + esc(p.rateMenit) + '" style="max-width:140px"></div>' +
      '<label class="chk mt12"><input type="checkbox" id="k2Lacak"' + (p.lacakHalaman ? ' checked' : '') + '> Catat halaman yang diakses & durasinya</label>' +
      '<label class="chk mt12"><input type="checkbox" id="k2Cap"' + (cfg('CAPTCHA_LOGIN', 'YA') !== 'TIDAK' ? ' checked' : '') + '> Wajib captcha penjumlahan saat login (cegah bot & tebak sandi)</label></div>' +
      '<div class="card card-p"><h3>' + ic('shield-ban') + ' Proteksi Spam</h3><div class="grid-form mt8"><div class="field c4"><label>Postingan/menit (siswa)</label><input class="inp" type="number" min="1" id="k2Sp" value="' + esc(p.spamMenit) + '"></div><div class="field c4"><label>Pesan/menit (siswa)</label><input class="inp" type="number" min="1" id="k2Ps" value="' + esc(p.pesanMenit) + '"></div><div class="field c4"><label>Maks tautan/postingan</label><input class="inp" type="number" min="0" id="k2Ln" value="' + esc(p.spamLink) + '"></div>' +
      '<div class="field c12"><label>Kata terlarang (satu per baris)</label><textarea class="inp" id="k2Kt" rows="4" placeholder="kata kasar…">' + esc((p.kataTerlarang || []).join('\n')) + '</textarea></div></div><div class="xs muted">Konten duplikat dalam 10 menit juga otomatis ditolak.</div></div></div>' +
      '<div class="sticky-bar mt16"><span class="grow small muted">Perubahan berlaku segera untuk semua pengguna.</span><button class="btn btn-primary" id="k2Save">' + ic('save') + 'Simpan kebijakan</button></div>' +
      (d.gagalTerakhir.length ? '<div class="card mt16"><div class="card-h"><h3>' + ic('shield-alert') + ' Login gagal / ditolak terbaru</h3></div><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Waktu</th><th>Akun</th><th>Detail</th><th>IP</th></tr></thead><tbody>' + d.gagalTerakhir.map(function (x) { return '<tr><td class="small">' + esc(tglJam(x.waktu, true)) + '</td><td class="small">' + esc(x.nama || '—') + '</td><td class="small">' + esc(x.detail) + '</td><td class="mono xs">' + esc(x.ip || '-') + '</td></tr>'; }).join('') + '</tbody></table></div></div>' : '');
    $('#k2Gen', el).onclick = function () { $('#k2Sec', el).value = secretAcak(36); };
    $('#k2SecC', el).onclick = function () { if ($('#k2Sec', el).value) salinTeks($('#k2Sec', el).value); };
    $('#k2SkC', el).onclick = function () { salinTeks(WORKER_SKRIP); };
    if ($('#k2Cap', el)) $('#k2Cap', el).onchange = async function () {          // v3.2: captcha login
      var cb = this, on = cb.checked; cb.disabled = true;
      var r = await api('captcha.atur', { aktif: on ? 'YA' : 'TIDAK' }); cb.disabled = false;
      if (toastRes(r)) { if (AppState.boot && AppState.boot.cfg) AppState.boot.cfg.CAPTCHA_LOGIN = on ? 'YA' : 'TIDAK'; } else cb.checked = !on;
    };
    $('#k2Save', el).onclick = async function () {
      var k = { idleMenit: Number($('#k2Idle', el).value), rateMenit: Number($('#k2Rate', el).value), lacakHalaman: $('#k2Lacak', el).checked, spamMenit: Number($('#k2Sp', el).value), pesanMenit: Number($('#k2Ps', el).value), spamLink: Number($('#k2Ln', el).value), kataTerlarang: $('#k2Kt', el).value, ipWajibProxy: $('#k2Wp', el).checked, ipDaftar: $('#k2IpL', el).value };
      if (!$('#k2Mode', el).disabled) k.saLoginMode = $('#k2Mode', el).value;
      if (!$('#k2Ip', el).disabled) k.ipMode = $('#k2Ip', el).value;
      btnBusy(this, true); var r = await api('keamanan.simpan', { kebijakan: k }); btnBusy(this, false);
      if (toastRes(r)) self.render(el);
    };
  }
});

// =====================================================================
// BRANDING WHITE-LABEL
// =====================================================================
function kecilkanLogo(b, maks) {
  return new Promise(function (res) {
    if (/svg/.test(b.mime)) return res(b);
    var img = new Image();
    img.onload = function () {
      var s = Math.min(1, (maks || 256) / Math.max(img.width, img.height)), c = document.createElement('canvas');
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      var url = c.toDataURL('image/png');
      res({ name: b.name.replace(/\.\w+$/, '') + '.png', mime: 'image/png', data: url.split(',')[1], size: Math.round(url.length * 0.75) });
    };
    img.onerror = function () { res(b); };
    img.src = 'data:' + b.mime + ';base64,' + b.data;
  });
}
registerPage('guru', 'branding', {
  title: 'Branding Aplikasi', sa: true,
  render: function (el) {
    var b = Brand.get(), logoBaru = null, hapusLogo = false;
    var preset = ['#1E3A5F', '#0F766E', '#7C3AED', '#9D174D', '#B45309', '#1D4ED8', '#166534', '#374151'];
    el.innerHTML = pageHead('Super Admin <span>/ Branding</span>', 'Branding Aplikasi (White-Label)', 'Ubah nama aplikasi, tagline, logo, dan warna utama. Tampilan baru berlaku untuk semua pengguna.') +
      '<div class="grid g2"><div class="card card-p"><div class="field"><label>Nama aplikasi *</label><input class="inp" id="brN" maxlength="40" value="' + esc(b.nama) + '"></div><div class="field mt12"><label>Tagline</label><input class="inp" id="brT" maxlength="90" value="' + esc(b.tagline) + '"></div>' +
      '<div class="field mt12"><label>Logo</label><div class="row gap12"><div class="br-logo"><img id="brImg" src="' + esc(b.logo || LOGO) + '" alt="Logo"></div><div class="stack" style="--g:8px"><button class="btn btn-outline btn-sm" id="brPilih">' + ic('image-up') + 'Unggah logo</button><button class="btn btn-ghost btn-sm" id="brHapus"' + (b.logo ? '' : ' hidden') + '>' + ic('x') + 'Pakai logo bawaan</button></div></div><div class="hint">PNG/JPG/WEBP/SVG, otomatis diperkecil ke 256 px. Disarankan logo persegi berlatar transparan.</div></div>' +
      '<div class="field mt12"><label>Warna utama</label><div class="row gap8 wrap"><input type="color" id="brW" value="' + esc(b.warna) + '" style="width:52px;height:40px;padding:2px;border-radius:8px;border:1px solid var(--line)">' + preset.map(function (c) { return '<button class="br-swatch" data-w="' + c + '" style="background:' + c + '" title="' + c + '"></button>'; }).join('') + '</div></div>' +
      '<div class="field mt12"><label>Teks kaki halaman login (opsional)</label><input class="inp" id="brF" maxlength="120" value="' + esc(b.footer) + '" placeholder="© 2026 Nama Sekolah"></div>' +
      '<div class="row wrap gap8 mt16"><button class="btn btn-primary" id="brSave">' + ic('save') + 'Simpan branding</button><button class="btn btn-ghost" id="brReset">' + ic('rotate-ccw') + 'Kembali ke bawaan</button></div></div>' +
      '<div class="card card-p"><div class="xs b muted">PRATINJAU</div><div class="br-prev mt12" id="brPrev"></div></div></div>';
    function nilai() { return { nama: $('#brN', el).value.trim() || 'SIAKAD SISWA', tagline: $('#brT', el).value.trim(), warna: $('#brW', el).value, footer: $('#brF', el).value.trim(), logo: hapusLogo ? '' : (logoBaru ? 'data:' + logoBaru.mime + ';base64,' + logoBaru.data : b.logo) }; }
    function pratinjau() {
      var v = nilai(), lg = v.logo || LOGO;
      $('#brImg', el).src = lg;
      $('#brPrev', el).innerHTML = '<div class="bp-side" style="background:' + esc(v.warna) + '"><img src="' + esc(lg) + '" alt=""><b>' + esc(v.nama) + '</b></div><div class="bp-login"><img src="' + esc(lg) + '" alt=""><h3 style="color:' + esc(v.warna) + '">' + esc(v.nama) + '</h3><div class="small muted">' + esc(v.tagline) + '</div><div class="bp-btn" style="background:' + esc(warnaGelap(v.warna, 0.35)) + '">MASUK KE SISTEM</div><div class="xs muted mt8">' + esc(v.footer || '© ' + new Date().getFullYear() + ' ' + v.nama) + '</div></div>';
    }
    ['brN', 'brT', 'brW', 'brF'].forEach(function (id) { $('#' + id, el).oninput = pratinjau; });
    el.querySelectorAll('.br-swatch').forEach(function (s) { s.onclick = function () { $('#brW', el).value = s.dataset.w; pratinjau(); }; });
    $('#brPilih', el).onclick = async function () { var f = await pilihBerkas({ accept: 'image/png,image/jpeg,image/webp,image/svg+xml', maksMB: 5 }); if (!f[0]) return; logoBaru = await kecilkanLogo(f[0], 256); hapusLogo = false; $('#brHapus', el).hidden = false; pratinjau(); };
    $('#brHapus', el).onclick = function () { hapusLogo = true; logoBaru = null; this.hidden = true; pratinjau(); };
    $('#brReset', el).onclick = function () { $('#brN', el).value = 'SIAKAD SISWA'; $('#brT', el).value = 'Sistem Informasi Akademik Siswa'; $('#brW', el).value = '#1E3A5F'; $('#brF', el).value = ''; hapusLogo = true; logoBaru = null; pratinjau(); };
    $('#brSave', el).onclick = async function () {
      var v = nilai(), p = { nama: v.nama, tagline: v.tagline, warna: v.warna, footer: v.footer };
      if (hapusLogo) p.hapusLogo = true; else if (logoBaru) p.logo = { name: logoBaru.name, mime: logoBaru.mime, data: logoBaru.data };
      btnBusy(this, true); var r = await api('brand.simpan', p); btnBusy(this, false);
      if (toastRes(r)) { Brand.set(r.data); Brand.apply(); b = Brand.get(); logoBaru = null; hapusLogo = false; Store.del('public'); refreshBoot(true); }
    };
    pratinjau();
  }
});
