/* =====================================================================
   SIAKAD SISWA v3.0 — pages-kursus.js : Manajemen Kursus & Pengajaran
   Daftar kursus, halaman kursus (format Topik / Mingguan / Sosial), editor
   aktivitas & sumber belajar, syarat buka, penyelesaian, peserta & grup,
   laporan penyelesaian, pengaturan & kriteria kelulusan kursus.
   ===================================================================== */
'use strict';

var LmsOpsi = {};
function lmsOpsi(kid, segar) {
  var k = kid || '_';
  if (LmsOpsi[k] && !segar) return Promise.resolve(LmsOpsi[k]);
  return api('lms.opsi', { kursus_id: kid || '' }).then(function (r) { if (r.success) LmsOpsi[k] = r.data; return r.success ? r.data : null; });
}
var FORMAT_LBL = { topik: 'Format Topik', mingguan: 'Format Mingguan', sosial: 'Format Sosial' };
var SELESAI_LBL = { tidak: 'Tidak dilacak', manual: 'Siswa menandai sendiri', lihat: 'Saat dibuka/dilihat', kirim: 'Saat mengirim/berpartisipasi', nilai: 'Saat mendapat nilai', lulus: 'Saat lulus nilai minimal' };

function kursusKartu(k) {
  var siswa = isSiswa();
  return '<a class="card kursus-card" href="#/kursus/' + esc(k.kursus_id) + '" style="--kc:' + esc(k.warna || '#1E3A5F') + '"><div class="kc-band"><span class="kc-format">' + esc(FORMAT_LBL[k.format] || k.format) + '</span>' +
    (k.status !== 'Aktif' ? '<span class="bdg ' + (k.status === 'Draf' ? 'amber' : '') + '">' + esc(k.status) + '</span>' : '') + (k.lulus ? '<span class="bdg ok">' + ic('award') + 'Lulus</span>' : '') + '</div>' +
    '<div class="kc-b"><div class="xs muted b">' + esc(k.kode || k.mapel || 'KURSUS') + '</div><h3 class="clamp2">' + esc(k.nama) + '</h3><div class="small muted clamp2">' + esc(k.ringkasan || '') + '</div>' +
    '<div class="kc-meta">' + ic('user-round') + '<span class="ellipsis">' + esc((k.pengajar || []).map(function (p) { return p.nama; }).join(', ') || '-') + '</span></div>' +
    (siswa ? '<div class="mt8">' + barProgres(k.progres, k.lulus ? 'ok' : '') + '<div class="xs muted mt4">' + (k.progres || 0) + '% selesai • ' + k.jml_aktivitas + ' materi & aktivitas</div></div>'
      : '<div class="kc-stat"><span>' + ic('users') + (k.jml_siswa || 0) + ' siswa</span><span>' + ic('layers') + (k.jml_aktivitas || 0) + ' modul</span>' + (k.peran === 'admin' && !k.mengajar ? '<span class="bdg navy">Admin</span>' : '') + '</div>') +
    '</div></a>';
}

daftarHalaman(['guru', 'siswa'], 'kursus', function (peran) { return {
  title: 'Kursus', _keepScroll: false,
  render: function (el, param) { if (param) this.detail(el, param); else this.daftar(el); },
  // ------------------------------------------------------------ DAFTAR KURSUS
  daftar: function (el) {
    var self = this;
    el.innerHTML = pageHead(isSiswa() ? 'E-Learning <span>/ Kursus</span>' : 'E-Learning <span>/ Kursus</span>', isSiswa() ? 'Kursus Saya' : 'Kursus & Pengajaran',
      isSiswa() ? 'Materi, kuis, tugas, dan diskusi dari guru Anda. Selesaikan aktivitas wajib untuk lulus kursus.' : 'Kelola kursus daring: aktivitas interaktif, sumber belajar, grup, penyelesaian bersyarat, dan penilaian.',
      isSiswa() ? '' : '<button class="btn btn-dark" id="ksBaru" hidden>' + ic('plus') + 'Buat Kursus</button>') +
      (isSiswa() ? '' : '<div class="tabs" id="ksTab"><button data-f="Aktif" class="on">Aktif</button><button data-f="Draf">Draf</button><button data-f="Arsip">Arsip</button><button data-f="">Semua</button></div>') +
      '<div class="grid g3 mt16" id="ksList"><div class="sk" style="height:220px"></div><div class="sk" style="height:220px"></div><div class="sk" style="height:220px"></div></div>';
    var filter = 'Aktif', data = null;
    function draw() {
      var list = (data.kursus || []).filter(function (k) { return isSiswa() || !filter || k.status === filter; });
      $('#ksList', el).innerHTML = list.length ? list.map(kursusKartu).join('') : '<div class="card card-p" style="grid-column:1/-1">' + emptyHtml(isSiswa() ? 'Belum ada kursus untuk kelas Anda' : 'Belum ada kursus ' + (filter ? filter.toLowerCase() : ''), isSiswa() ? 'Kursus muncul setelah guru mengaktifkannya.' : 'Klik "Buat Kursus" untuk memulai.', 'graduation-cap') + '</div>';
    }
    if ($('#ksTab', el)) $$('#ksTab button', el).forEach(function (b) { b.onclick = function () { filter = b.dataset.f; $$('#ksTab button', el).forEach(function (x) { x.classList.toggle('on', x === b); }); if (data) draw(); }; });
    if ($('#ksBaru', el)) $('#ksBaru', el).onclick = function () { formKursus(null, function (id) { go('kursus', id); }); };
    swr('lms:kursus', 'lms.kursus.list', {}, function (d) { data = d; if ($('#ksBaru', el)) $('#ksBaru', el).hidden = !d.bolehBuat; draw(); }, { fresh: 20000, onError: function (r) { $('#ksList', el).innerHTML = errorBox(r.message); } });
  },
  // ------------------------------------------------------------ DETAIL KURSUS
  detail: function (el, kid, segar) {
    var self = this;
    if (!segar || !el.querySelector('.kursus-head')) el.innerHTML = '<div class="sk" style="height:140px"></div><div class="sk mt16" style="height:320px"></div>';
    swr('lms:k:' + kid, 'lms.kursus.get', { kursus_id: kid }, function (d) { self.k = d; self.gambar(el); }, { fresh: segar ? 0 : 15000, force: !!segar, onError: function (r) { el.innerHTML = errorBox(r.message) + '<div class="mt16"><a class="btn btn-outline" href="#/kursus">' + ic('arrow-left') + 'Kembali ke daftar kursus</a></div>'; } });
  },
  segarkan: function (el) { Store.del(userKey('lms:kursus')); this.detail(el, this.k.kursus.kursus_id, true); },
  gambar: function (el) {
    var self = this, d = this.k, k = d.kursus, kelola = k.kelola;
    self.tab = self.tab && (kelola || /^(materi|nilai)$/.test(self.tab)) ? self.tab : 'materi';
    var tabs = kelola ? [['materi', 'Materi & Aktivitas', 'layers'], ['peserta', 'Peserta & Grup', 'users'], ['laporan', 'Laporan', 'chart-column'], ['atur', 'Pengaturan', 'settings']] : [['materi', 'Materi & Aktivitas', 'layers'], ['nilai', 'Nilai Saya', 'award']];
    var pg = d.progres || {};
    el.innerHTML = '<div class="kursus-head" style="--kc:' + esc(k.warna || '#1E3A5F') + '"><div class="kh-top"><a href="#/kursus" class="kh-back">' + ic('arrow-left') + 'Semua kursus</a><span class="kc-format">' + esc(FORMAT_LBL[k.format] || '') + '</span>' + (k.status !== 'Aktif' ? '<span class="bdg amber">' + esc(k.status) + '</span>' : '') + '</div>' +
      '<h1>' + esc(k.nama) + '</h1><div class="kh-sub">' + ic('user-round') + esc((k.pengajar || []).map(function (p) { return p.nama; }).join(', ')) + (k.mapel ? ' • ' + esc(k.mapel) : '') + (kelola ? ' • ' + d.jml_siswa + ' siswa • ' + d.lulus + ' lulus' : '') + '</div>' +
      (!kelola ? '<div class="kh-prog"><div class="grow">' + barProgres(pg.persen, d.lulus ? 'ok' : '') + '</div><b>' + (pg.persen || 0) + '%</b><span class="small">' + (pg.beres || 0) + '/' + (pg.wajib || 0) + ' aktivitas wajib' + (pg.nilai_min ? ' • nilai min ' + pg.nilai_min : '') + '</span>' + (d.lulus ? '<span class="bdg ok">' + ic('award') + 'Kursus lulus</span>' : '') + '</div>' : '') +
      '</div>' +
      '<div class="tabs mt16" id="khTab">' + tabs.map(function (t) { return '<button data-t="' + t[0] + '" class="' + (t[0] === self.tab ? 'on' : '') + '">' + ic(t[2]) + t[1] + '</button>'; }).join('') + '</div><div id="khBody" class="mt16"></div>';
    $$('#khTab button', el).forEach(function (b) { b.onclick = function () { self.tab = b.dataset.t; $$('#khTab button', el).forEach(function (x) { x.classList.toggle('on', x === b); }); self.isiTab(el); }; });
    if (k.ringkasan && self.tab === 'materi') { /* ringkasan tampil di seksi Umum */ }
    self.isiTab(el);
  },
  isiTab: function (el) {
    var body = $('#khBody', el), t = this.tab;
    if (t === 'materi') this.tabMateri(el, body);
    else if (t === 'peserta') this.tabPeserta(el, body);
    else if (t === 'laporan') this.tabLaporan(el, body);
    else if (t === 'atur') this.tabAtur(el, body);
    else if (t === 'nilai') this.tabNilai(el, body);
  },
  // ------------------------------------------------------------ TAB MATERI
  tabMateri: function (el, body) {
    var self = this, d = this.k, k = d.kursus, kelola = k.kelola, now = Date.now();
    var pekanIni = -1;
    if (k.format === 'mingguan' && k.tgl_mulai) pekanIni = Math.floor((now - msDari(k.tgl_mulai + 'T00:00')) / (7 * 864e5)) + 1;
    var html = d.seksi.map(function (s) {
      var mods = d.modul.filter(function (m) { return m.seksi_id === s.seksi_id; }).sort(function (a, b) { return a.urutan - b.urutan; });
      var kini = k.format === 'mingguan' && s.no === pekanIni;
      if (!kelola && !mods.length && s.no > 0 && !s.ringkasan) return '';
      return '<section class="card seksi' + (kini ? ' kini' : '') + (s.tampil === 'TIDAK' ? ' tersembunyi' : '') + (s.terkunci ? ' terkunci' : '') + '" data-seksi="' + esc(s.seksi_id) + '">' +
        '<div class="seksi-h"><div class="grow"><h3>' + (s.terkunci ? ic('lock') : '') + esc(s.judul) + (kini ? ' <span class="bdg info">Pekan ini</span>' : '') + (s.tampil === 'TIDAK' ? ' <span class="bdg">Disembunyikan</span>' : '') + '</h3>' +
        (s.no === 0 && k.ringkasan ? md(k.ringkasan) : '') + (s.ringkasan ? md(s.ringkasan) : '') +
        (s.terkunci ? '<div class="note warn mt8">' + ic('lock') + '<div><b>Terkunci.</b> ' + esc((s.alasan || []).join(' • ')) + '</div></div>' : '') +
        (kelola && s.syarat && s.syarat.aturan && s.syarat.aturan.length ? '<div class="syarat-ring">' + ic('lock') + syaratTeks(s.syarat, d) + '</div>' : '') + '</div>' +
        (kelola ? '<div class="seksi-act"><button class="btn-ic" data-sk="edit" title="Ubah seksi">' + ic('pencil') + '</button><button class="btn-ic" data-sk="tampil" title="' + (s.tampil === 'TIDAK' ? 'Tampilkan' : 'Sembunyikan') + '">' + ic(s.tampil === 'TIDAK' ? 'eye-off' : 'eye') + '</button>' + (s.no > 0 ? '<button class="btn-ic" data-sk="hapus" title="Hapus seksi">' + ic('trash-2') + '</button>' : '') + '</div>' : '') + '</div>' +
        '<div class="mod-list">' + (mods.length ? mods.map(function (m, i) { return modBaris(m, kelola, i, mods.length); }).join('') : '<div class="muted small mod-kosong">' + (kelola ? 'Belum ada aktivitas. Tambahkan materi, kuis, tugas, forum…' : 'Belum ada materi.') + '</div>') + '</div>' +
        (kelola ? '<button class="btn btn-soft btn-sm mt12" data-tambah="' + esc(s.seksi_id) + '">' + ic('plus') + 'Tambah aktivitas / sumber belajar</button>' : '') + '</section>';
    }).join('');
    body.innerHTML = (kelola ? '<div class="row wrap gap8 mb12"><button class="btn btn-outline btn-sm" id="kmSeksi">' + ic('list-plus') + 'Tambah ' + (k.format === 'mingguan' ? 'Pekan' : 'Seksi') + '</button><a class="btn btn-outline btn-sm" href="#/bukunilai/' + esc(k.kursus_id) + '">' + ic('table-2') + 'Buku Nilai</a><a class="btn btn-outline btn-sm" href="#/banksoal/' + esc(k.kursus_id) + '">' + ic('list-checks') + 'Bank Soal</a><span class="sp"></span><span class="xs muted">' + ic('info') + ' Klik judul untuk membuka. Gunakan ↑ ↓ untuk mengurutkan.</span></div>' : '') +
      (html || '<div class="card card-p">' + emptyHtml('Kursus masih kosong', '', 'layers') + '</div>');
    body.onclick = async function (e) {
      var b = e.target.closest('button'); if (!b) return;
      var sek = b.closest('[data-seksi]'), sid = sek && sek.dataset.seksi;
      if (b.dataset.tambah) return pilihTipeModul(function (tipe) { editorModul(self.k, { tipe: tipe, seksi_id: b.dataset.tambah }, function () { self.segarkan(el); }); });
      if (b.dataset.sk) return self.aksiSeksi(el, b.dataset.sk, sid);
      var row = b.closest('[data-mod]'); if (!row) return;
      var mid = row.dataset.mod, m = self.k.modul.filter(function (x) { return x.modul_id === mid; })[0];
      if (b.dataset.m === 'edit') return editorModul(self.k, { modul: m }, function () { self.segarkan(el); });
      if (b.dataset.m === 'manual') { btnBusy(b, true); var r0 = await api('lms.selesai.manual', { modul_id: mid, selesai: m.status !== 'selesai' }); btnBusy(b, false); if (toastRes(r0)) self.segarkan(el); return; }
      if (b.dataset.m === 'hapus') { if (!await confirmBox('Hapus "' + m.judul + '"? Semua kiriman, nilai, dan data siswa di aktivitas ini ikut terhapus.', { danger: true, ok: 'Hapus' })) return; var r1 = await api('lms.modul.hapus', { modul_id: mid }); if (toastRes(r1)) self.segarkan(el); return; }
      if (b.dataset.m === 'tampil') { var r2 = await api('lms.modul.urut', { kursus_id: self.k.kursus.kursus_id, tampil: { modul_id: mid, nilai: m.tampil === 'TIDAK' ? 'YA' : 'TIDAK' } }); if (toastRes(r2)) self.segarkan(el); return; }
      if (b.dataset.m === 'naik' || b.dataset.m === 'turun') {
        var list = self.k.modul.filter(function (x) { return x.seksi_id === m.seksi_id; }).sort(function (a, c) { return a.urutan - c.urutan; }), i = list.indexOf(m), j = b.dataset.m === 'naik' ? i - 1 : i + 1;
        if (j < 0 || j >= list.length) return;
        var t = list[i]; list[i] = list[j]; list[j] = t;
        var r3 = await api('lms.modul.urut', { kursus_id: self.k.kursus.kursus_id, urutan: list.map(function (x) { return { modul_id: x.modul_id, seksi_id: x.seksi_id }; }) });
        if (toastRes(r3, 'Urutan disimpan.')) self.segarkan(el);
      }
    };
    if ($('#kmSeksi', el)) $('#kmSeksi', el).onclick = async function () { var r = await api('lms.seksi.save', { kursus_id: k.kursus_id }); if (toastRes(r)) self.segarkan(el); };
  },
  aksiSeksi: async function (el, aksi, sid) {
    var self = this, s = this.k.seksi.filter(function (x) { return x.seksi_id === sid; })[0], kid = this.k.kursus.kursus_id;
    if (aksi === 'tampil') { var r = await api('lms.seksi.save', { kursus_id: kid, seksi_id: sid, tampil: s.tampil === 'TIDAK' ? 'YA' : 'TIDAK' }); if (toastRes(r)) self.segarkan(el); return; }
    if (aksi === 'hapus') {
      var isi = this.k.modul.filter(function (m) { return m.seksi_id === sid; }).length;
      if (!await confirmBox('Hapus seksi "' + s.judul + '"' + (isi ? ' beserta ' + isi + ' aktivitas di dalamnya' : '') + '?', { danger: true, ok: 'Hapus' })) return;
      var r2 = await api('lms.seksi.hapus', { kursus_id: kid, seksi_id: sid, hapusIsi: true }); if (toastRes(r2)) self.segarkan(el); return;
    }
    var m = modal({ title: 'Ubah Seksi', size: 'lg', body: '<div class="field"><label>Judul</label><input class="inp" name="judul" value="' + esc(s.judul) + '"></div><div class="field mt12"><label>Ringkasan (mendukung **tebal**, daftar, tautan)</label><textarea class="inp" name="ringkasan" rows="4">' + esc(s.ringkasan || '') + '</textarea></div>' +
      '<div class="mt16"><div class="xs b muted">SYARAT MEMBUKA SEKSI</div><div id="skSyarat" class="mt8"></div></div>',
      foot: '<button class="btn btn-outline" data-x>Batal</button><button class="btn btn-primary" id="skSimpan">Simpan</button>' });
    var syarat = editorSyarat($('#skSyarat', m.el), s.syarat, self.k, null);
    $('#skSimpan', m.el).onclick = async function () { var f = formData(m.el); btnBusy(this, true); var r = await api('lms.seksi.save', { kursus_id: kid, seksi_id: sid, judul: f.judul, ringkasan: f.ringkasan, syarat: syarat.baca() }); btnBusy(this, false); if (toastRes(r)) { m.close(); self.segarkan(el); } };
  },
  // ------------------------------------------------------------ TAB PESERTA & GRUP
  tabPeserta: function (el, body) {
    var self = this, kid = this.k.kursus.kursus_id;
    body.innerHTML = '<div class="sk" style="height:260px"></div>';
    api('lms.peserta.list', { kursus_id: kid }).then(function (r) {
      if (!r.success) { body.innerHTML = errorBox(r.message); return; }
      var d = r.data, gNama = {}; d.grup.forEach(function (g) { gNama[g.grup_id] = g.nama; });
      body.innerHTML = '<div class="grid g-main"><div class="card"><div class="card-h"><div class="grow"><h3>' + ic('users') + ' Peserta (' + d.siswa.length + ' siswa)</h3><p>Otomatis dari kelas kursus + tambahan manual</p></div><button class="btn btn-outline btn-sm" id="psTambah">' + ic('user-plus') + 'Tambah peserta</button></div>' +
        '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Nama</th><th>Kelas</th><th>Grup</th><th style="min-width:130px">Progres</th><th class="hide-m">Login terakhir</th></tr></thead><tbody>' +
        d.siswa.map(function (s) { return '<tr><td><div class="row gap8">' + avatar(s.nama, '', 'sm') + '<div><b>' + esc(s.nama) + '</b>' + (s.online ? ' <span class="online-dot" title="Online"></span>' : '') + (s.sumber === 'manual' ? '<div class="xs muted">ditambahkan manual <a href="#" data-keluar="' + esc(s.uid) + '">keluarkan</a></div>' : '') + '</div></div></td><td>' + esc(s.kelas) + '</td><td class="small">' + esc(s.grup.map(function (g) { return gNama[g]; }).join(', ') || '-') + '</td><td>' + barProgres(s.progres, s.lulus ? 'ok' : '') + '<div class="xs muted">' + s.beres + '/' + s.wajib + (s.lulus ? ' • <b class="ok-t">Lulus</b>' : '') + '</div></td><td class="hide-m small muted">' + esc(s.last_login ? relTime(s.last_login) : '-') + '</td></tr>'; }).join('') +
        '</tbody></table></div><div class="card-b"><div class="xs b muted">PENGAJAR</div><div class="chips mt8">' + d.pengajar.map(function (p) { return '<span class="chip">' + ic('user-round') + esc(p.nama) + (p.sumber === 'manual' ? ' <a href="#" data-keluar="' + esc(p.uid) + '">×</a>' : '') + '</span>'; }).join('') + '</div></div></div>' +
        '<div class="stack"><div class="card"><div class="card-h"><div class="grow"><h3>' + ic('users-round') + ' Grup (' + d.grup.length + ')</h3><p>Untuk tugas kelompok, wiki & forum terpisah, atau pembatasan akses</p></div></div><div class="card-b">' +
        '<div class="row wrap gap8"><button class="btn btn-primary btn-sm" id="grBaru">' + ic('plus') + 'Grup baru</button><button class="btn btn-outline btn-sm" id="grAuto">' + ic('shuffle') + 'Bagi otomatis</button></div>' +
        '<div class="mt12">' + (d.grup.length ? d.grup.map(function (g) { return '<div class="grup-i"><div class="row"><b class="grow">' + esc(g.nama) + '</b><span class="xs muted">' + g.anggota.length + ' anggota</span><button class="btn-ic" data-gr="' + esc(g.grup_id) + '" title="Ubah">' + ic('pencil') + '</button><button class="btn-ic" data-grh="' + esc(g.grup_id) + '" title="Hapus">' + ic('trash-2') + '</button></div><div class="xs muted mt4">' + esc(g.anggota.map(function (u) { var s = d.siswa.filter(function (x) { return x.uid === u; })[0]; return s ? s.nama : u; }).join(', ') || '—') + '</div></div>'; }).join('') : '<div class="muted small">Belum ada grup.</div>') + '</div></div></div>' +
        '<div class="card"><div class="card-h"><div class="grow"><h3>' + ic('boxes') + ' Pengelompokan (Groupings)</h3><p>Kumpulan grup untuk membatasi aktivitas tertentu</p></div><button class="btn btn-outline btn-sm" id="ggBaru">' + ic('plus') + 'Baru</button></div><div class="card-b">' +
        (d.grouping.length ? d.grouping.map(function (g) { return '<div class="grup-i row"><div class="grow"><b>' + esc(g.nama) + '</b><div class="xs muted">' + esc(g.grup_ids.map(function (x) { return gNama[x] || x; }).join(', ') || '—') + '</div></div><button class="btn-ic" data-gg="' + esc(g.grouping_id) + '">' + ic('pencil') + '</button><button class="btn-ic" data-ggh="' + esc(g.grouping_id) + '">' + ic('trash-2') + '</button></div>'; }).join('') : '<div class="muted small">Belum ada pengelompokan.</div>') + '</div></div></div></div>';
      function formGrup(g) {
        var m = modal({ title: g ? 'Ubah Grup' : 'Grup Baru', size: 'md', body: '<div class="field"><label>Nama grup</label><input class="inp" name="nama" value="' + esc(g ? g.nama : 'Kelompok ' + (d.grup.length + 1)) + '"></div><div class="field mt12"><label>Anggota</label><input class="inp" id="grCari" placeholder="Cari nama…"><div class="cek-list mt8" id="grAng">' +
          d.siswa.map(function (s) { var di = d.grup.filter(function (x) { return x.anggota.indexOf(s.uid) > -1 && (!g || x.grup_id !== g.grup_id); }).map(function (x) { return x.nama; }); return '<label class="chk" data-n="' + esc(s.nama.toLowerCase()) + '"><input type="checkbox" value="' + esc(s.uid) + '"' + (g && g.anggota.indexOf(s.uid) > -1 ? ' checked' : '') + '> ' + esc(s.nama) + (di.length ? ' <span class="xs muted">(' + esc(di.join(', ')) + ')</span>' : '') + '</label>'; }).join('') + '</div></div>',
          foot: '<button class="btn btn-outline" data-x>Batal</button><button class="btn btn-primary" id="grSave">Simpan</button>' });
        $('#grCari', m.el).oninput = function () { var q = this.value.toLowerCase(); $$('#grAng label', m.el).forEach(function (l) { l.hidden = l.dataset.n.indexOf(q) === -1; }); };
        $('#grSave', m.el).onclick = async function () { btnBusy(this, true); var r = await api('lms.grup.save', { kursus_id: kid, grup_id: g ? g.grup_id : '', nama: $('[name=nama]', m.el).value, anggota: $$('#grAng input:checked', m.el).map(function (x) { return x.value; }) }); btnBusy(this, false); if (toastRes(r)) { m.close(); self.tabPeserta(el, body); } };
      }
      function formGrouping(g) {
        var m = modal({ title: g ? 'Ubah Pengelompokan' : 'Pengelompokan Baru', size: 'sm', body: '<div class="field"><label>Nama</label><input class="inp" name="nama" value="' + esc(g ? g.nama : '') + '"></div><div class="field mt12"><label>Grup</label><div class="cek-list">' + d.grup.map(function (x) { return '<label class="chk"><input type="checkbox" value="' + esc(x.grup_id) + '"' + (g && g.grup_ids.indexOf(x.grup_id) > -1 ? ' checked' : '') + '> ' + esc(x.nama) + '</label>'; }).join('') + '</div></div>',
          foot: '<button class="btn btn-outline" data-x>Batal</button><button class="btn btn-primary" id="ggSave">Simpan</button>' });
        $('#ggSave', m.el).onclick = async function () { var r = await api('lms.grouping.save', { kursus_id: kid, grouping_id: g ? g.grouping_id : '', nama: $('[name=nama]', m.el).value, grup_ids: $$('.cek-list input:checked', m.el).map(function (x) { return x.value; }) }); if (toastRes(r)) { m.close(); self.tabPeserta(el, body); } };
      }
      body.onclick = async function (e) {
        var a = e.target.closest('[data-keluar]');
        if (a) { e.preventDefault(); if (!await confirmBox('Keluarkan peserta ini dari kursus?')) return; var r = await api('lms.peserta.simpan', { kursus_id: kid, hapus: [a.dataset.keluar] }); if (toastRes(r)) self.tabPeserta(el, body); return; }
        var b = e.target.closest('button'); if (!b) return;
        if (b.id === 'grBaru') return formGrup(null);
        if (b.dataset.gr) return formGrup(d.grup.filter(function (g) { return g.grup_id === b.dataset.gr; })[0]);
        if (b.dataset.grh) { if (!await confirmBox('Hapus grup ini?', { danger: true })) return; var r1 = await api('lms.grup.hapus', { kursus_id: kid, grup_id: b.dataset.grh }); if (toastRes(r1)) self.tabPeserta(el, body); return; }
        if (b.id === 'ggBaru') return formGrouping(null);
        if (b.dataset.gg) return formGrouping(d.grouping.filter(function (g) { return g.grouping_id === b.dataset.gg; })[0]);
        if (b.dataset.ggh) { var r2 = await api('lms.grouping.hapus', { kursus_id: kid, grouping_id: b.dataset.ggh }); if (toastRes(r2)) self.tabPeserta(el, body); return; }
        if (b.id === 'grAuto') {
          var m = modal({ title: 'Bagi Grup Otomatis', size: 'sm', body: '<div class="grid g2"><div class="field"><label>Berdasarkan</label><select class="sel" name="mode"><option value="jumlah">Jumlah grup</option><option value="perGrup">Anggota per grup</option></select></div><div class="field"><label>Angka</label><input class="inp" type="number" name="n" min="1" value="4"></div></div>' +
            '<div class="field mt12"><label>Cara</label><select class="sel" name="cara"><option value="acak">Acak</option><option value="abjad">Urut abjad</option></select></div><div class="field mt12"><label>Awalan nama</label><input class="inp" name="awalan" value="Kelompok"></div>' +
            '<div class="field mt12"><label>Buat pengelompokan (opsional)</label><input class="inp" name="grouping" placeholder="mis. Kelompok Proyek"></div><label class="chk mt12"><input type="checkbox" name="ganti"> Hapus grup lama</label>',
            foot: '<button class="btn btn-outline" data-x>Batal</button><button class="btn btn-primary" id="gaGo">Bagi</button>' });
          $('#gaGo', m.el).onclick = async function () { var f = formData(m.el), p = { kursus_id: kid, cara: f.cara, awalan: f.awalan, grouping: f.grouping, ganti: f.ganti }; p[f.mode] = Number(f.n); var r = await api('lms.grup.otomatis', p); if (toastRes(r)) { m.close(); self.tabPeserta(el, body); } };
          return;
        }
        if (b.id === 'psTambah') {
          var op = await lmsOpsi(kid), ada = {}; d.siswa.concat(d.pengajar).forEach(function (s) { ada[s.uid] = 1; });
          var m2 = modal({ title: 'Tambah Peserta Manual', sub: 'Siswa dari kelas lain atau guru pendamping', size: 'md', body: '<div class="seg" id="ptSeg"><button class="on" data-v="siswa">Siswa</button><button data-v="pengajar">Guru pengajar</button></div><input class="inp mt12" id="ptCari" placeholder="Cari nama atau kelas…"><div class="cek-list mt8" id="ptList"></div>',
            foot: '<button class="btn btn-outline" data-x>Batal</button><button class="btn btn-primary" id="ptGo">Tambahkan</button>' });
          var jenis = 'siswa';
          function isi() { var q = $('#ptCari', m2.el).value.toLowerCase(), src = jenis === 'siswa' ? op.siswa : op.guru; $('#ptList', m2.el).innerHTML = src.filter(function (s) { return !ada[s.uid] && (s.nama + ' ' + (s.kelas || '')).toLowerCase().indexOf(q) > -1; }).slice(0, 120).map(function (s) { return '<label class="chk"><input type="checkbox" value="' + esc(s.uid) + '"> ' + esc(s.nama) + ' <span class="xs muted">' + esc(s.kelas || peranLabel(s.peran)) + '</span></label>'; }).join('') || '<div class="muted small">Tidak ada.</div>'; }
          $$('#ptSeg button', m2.el).forEach(function (x) { x.onclick = function () { jenis = x.dataset.v; $$('#ptSeg button', m2.el).forEach(function (y) { y.classList.toggle('on', y === x); }); isi(); }; });
          $('#ptCari', m2.el).oninput = isi; isi();
          $('#ptGo', m2.el).onclick = async function () { var t = $$('#ptList input:checked', m2.el).map(function (x) { return { user_id: x.value, peran: jenis }; }); if (!t.length) return toast('Pilih minimal satu.', 'warn'); var r = await api('lms.peserta.simpan', { kursus_id: kid, tambah: t }); if (toastRes(r)) { m2.close(); self.tabPeserta(el, body); } };
        }
      };
    });
  },
  // ------------------------------------------------------------ TAB LAPORAN PENYELESAIAN
  tabLaporan: function (el, body) {
    var kid = this.k.kursus.kursus_id;
    body.innerHTML = '<div class="sk" style="height:260px"></div>';
    api('lms.laporan.selesai', { kursus_id: kid }).then(function (r) {
      if (!r.success) { body.innerHTML = errorBox(r.message); return; }
      var d = r.data, simbol = { selesai: ['circle-check', 'ok-t', 'Selesai'], lulus: ['circle-check-big', 'ok-t', 'Lulus'], gagal: ['circle-x', 'bad-t', 'Belum lulus'] };
      body.innerHTML = '<div class="card"><div class="card-h"><div class="grow"><h3>' + ic('chart-column') + ' Laporan Penyelesaian</h3><p>' + d.baris.filter(function (b) { return b.lulus; }).length + ' dari ' + d.baris.length + ' siswa lulus kursus</p></div><button class="btn btn-outline btn-sm" id="lpCsv">' + ic('download') + 'CSV</button></div>' +
        '<div class="tbl-wrap"><table class="tbl matriks"><thead><tr><th class="stick">Siswa</th>' + d.modul.map(function (m) { return '<th class="tc" title="' + esc(m.judul + ' — ' + SELESAI_LBL[m.mode]) + '">' + tipeIkon(m.tipe, 'kecil') + '<div class="xs ellipsis" style="max-width:90px">' + esc(m.judul) + '</div></th>'; }).join('') + '<th class="tc">Progres</th><th class="tc">Nilai</th><th class="tc">Kursus</th></tr></thead><tbody>' +
        d.baris.map(function (b) { return '<tr><td class="stick"><b class="small">' + esc(b.nama) + '</b></td>' + d.modul.map(function (m) { var c = b.sel[m.modul_id], s = c && simbol[c.s]; return '<td class="tc">' + (s ? '<span class="' + s[1] + '" title="' + s[2] + ' • ' + esc(tglJam(c.w, true)) + '">' + ic(s[0]) + '</span>' : '<span class="muted">·</span>') + '</td>'; }).join('') +
          '<td class="tc small">' + b.progres + '%</td><td class="tc small">' + (b.total === null ? '-' : fmtN(b.total)) + '</td><td class="tc">' + (b.lulus ? '<span class="bdg ok">Lulus</span>' : '<span class="bdg">Belum</span>') + '</td></tr>'; }).join('') + '</tbody></table></div></div>';
      $('#lpCsv', body).onclick = function () { downloadCSV('penyelesaian-' + kid + '.csv', ['Siswa'].concat(d.modul.map(function (m) { return m.judul; })).concat(['Progres %', 'Nilai', 'Lulus']), d.baris.map(function (b) { return [b.nama].concat(d.modul.map(function (m) { var c = b.sel[m.modul_id]; return c ? c.s : ''; })).concat([b.progres, b.total === null ? '' : b.total, b.lulus ? 'YA' : 'TIDAK']); })); };
    });
  },
  // ------------------------------------------------------------ TAB PENGATURAN
  tabAtur: function (el, body) {
    var self = this, d = this.k, k = d.kursus;
    body.innerHTML = '<div class="grid g2"><div class="card card-p" id="atForm"></div><div class="stack"><div class="card card-p"><h3>' + ic('award') + ' Kriteria Kelulusan Kursus</h3><p class="small muted">Siswa lulus bila semua aktivitas terpilih selesai' + ' dan (opsional) total nilai mencapai batas.</p><div class="cek-list mt12" id="atWajib">' +
      d.modul.filter(function (m) { return m.penyelesaian.mode !== 'tidak' && m.tampil !== 'TIDAK'; }).map(function (m) { var pilih = (k.syarat_lulus.modul_ids || []); return '<label class="chk"><input type="checkbox" value="' + esc(m.modul_id) + '"' + (!pilih.length || pilih.indexOf(m.modul_id) > -1 ? ' checked' : '') + '> ' + tipeIkon(m.tipe, 'kecil') + esc(m.judul) + ' <span class="xs muted">(' + esc(SELESAI_LBL[m.penyelesaian.mode]) + ')</span></label>'; }).join('') +
      '</div><div class="field mt12"><label>Total nilai minimal (kosong = tidak disyaratkan)</label><input class="inp" type="number" min="0" max="100" id="atNmin" value="' + esc(k.syarat_lulus.nilai_min || '') + '"></div><button class="btn btn-primary mt12" id="atLulus">' + ic('save') + 'Simpan kriteria</button></div>' +
      '<div class="card card-p danger-zone"><h3>' + ic('triangle-alert', 'bad-t') + ' Hapus Kursus</h3><p class="small muted">Menghapus seluruh seksi, aktivitas, kiriman, nilai, dan grup kursus ini. Tidak dapat dibatalkan.</p><button class="btn btn-danger mt8" id="atHapus">' + ic('trash-2') + 'Hapus kursus…</button></div></div></div>';
    formKursus(d, function () { self.segarkan(el); }, $('#atForm', body));
    $('#atLulus', body).onclick = async function () {
      var semua = $$('#atWajib input', body), pilih = semua.filter(function (x) { return x.checked; }).map(function (x) { return x.value; });
      btnBusy(this, true);
      var r = await api('lms.kursus.save', { data: Object.assign(dataKursusDari(k), { syarat_lulus: { modul_ids: pilih.length === semua.length ? [] : pilih, nilai_min: $('#atNmin', body).value ? Number($('#atNmin', body).value) : '' } }) });
      btnBusy(this, false); if (toastRes(r, 'Kriteria kelulusan disimpan.')) self.segarkan(el);
    };
    $('#atHapus', body).onclick = async function () {
      var v = await promptBox('Hapus kursus', 'Ketik nama kursus persis untuk konfirmasi: "' + k.nama + '"', '');
      if (!v) return;
      var r = await api('lms.kursus.hapus', { kursus_id: k.kursus_id, konfirmasi: v });
      if (toastRes(r)) { Store.del(userKey('lms:kursus')); go('kursus'); }
    };
  },
  // ------------------------------------------------------------ TAB NILAI SAYA (siswa)
  tabNilai: function (el, body) {
    var kid = this.k.kursus.kursus_id;
    body.innerHTML = '<div class="sk" style="height:220px"></div>';
    api('nilai.saya', { kursus_id: kid }).then(function (r) {
      if (!r.success) { body.innerHTML = errorBox(r.message); return; }
      var d = r.data;
      if (d.disembunyikan) { body.innerHTML = '<div class="card card-p">' + emptyHtml('Nilai kursus belum dibagikan guru', '', 'eye-off') + '</div>'; return; }
      body.innerHTML = '<div class="grid g-main"><div class="card"><div class="card-h"><h3>' + ic('award') + ' Rincian Nilai</h3></div><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Item</th><th>Kategori</th><th class="tr">Nilai</th><th class="tr">%</th></tr></thead><tbody>' +
        d.items.map(function (it) { var kat = d.kategori.filter(function (c) { return c.kategori_id === it.kategori_id; })[0]; return '<tr><td>' + (it.otomatis ? '<a href="#/aktivitas/' + esc(it.ref) + '">' + tipeIkon(it.tipe, 'kecil') + esc(it.nama) + '</a>' : tipeIkon('label', 'kecil') + esc(it.nama)) + (it.catatan ? '<div class="xs muted">' + esc(it.catatan) + '</div>' : '') + '</td><td class="small">' + esc(kat ? kat.nama : 'Lainnya') + '</td><td class="tr">' + (it.nilai === null ? '<span class="muted">-</span>' : '<b>' + fmtN(it.nilai) + '</b><span class="xs muted"> / ' + it.maks + '</span>') + '</td><td class="tr">' + (it.persen === null ? '-' : fmtN(it.persen)) + '</td></tr>'; }).join('') +
        '</tbody></table></div></div><div class="stack"><div class="card card-p tc"><div class="xs b muted">NILAI KURSUS</div><div class="big-num">' + (d.total === null ? '-' : fmtN(d.total)) + '</div>' + (d.skala ? '<span class="bdg ' + (d.total >= d.kkm ? 'ok' : 'warn') + '">' + esc(d.skala.huruf + ' — ' + d.skala.predikat) + '</span>' : '') + '<div class="small muted mt8">KKM ' + d.kkm + '</div></div>' +
        '<div class="card card-p"><div class="xs b muted">PER KATEGORI</div>' + d.kategori.map(function (c) { return '<div class="row between mt8"><span>' + esc(c.nama) + ' <span class="xs muted">(' + c.bobot + '%)</span></span><b>' + (c.nilai === null || c.nilai === undefined ? '-' : fmtN(c.nilai)) + '</b></div>'; }).join('') + '</div></div></div>';
    });
  }
}; });

// ---------------------------------------------------------------- Baris modul
function modBaris(m, kelola, i, n) {
  var stat = '';
  if (m.tipe === 'label') {
    return '<div class="mod mod-label' + (m.tampil === 'TIDAK' ? ' tersembunyi' : '') + '" data-mod="' + esc(m.modul_id) + '"><div class="grow label-isi gaya-' + esc(m.konten.gaya || '') + '">' + md(m.konten.isi || '') + '</div>' + (kelola ? modKontrol(m, i, n) : '') + '</div>';
  }
  if (!kelola) {
    var mode = m.penyelesaian.mode;
    if (m.terkunci) stat = '<span class="mod-st kunci" title="Terkunci">' + ic('lock') + '</span>';
    else if (mode === 'manual') stat = '<button class="mod-st manual ' + (m.status === 'selesai' ? 'on' : '') + '" data-m="manual" title="' + (m.status === 'selesai' ? 'Batalkan tanda selesai' : 'Tandai selesai') + '">' + ic(m.status === 'selesai' ? 'square-check-big' : 'square') + '</button>';
    else if (mode !== 'tidak') stat = '<span class="mod-st ' + (m.status === 'gagal' ? 'gagal' : m.status ? 'on' : '') + '" title="' + esc(m.status === 'gagal' ? 'Belum mencapai nilai minimal' : m.status ? 'Selesai' : SELESAI_LBL[mode]) + '">' + ic(m.status === 'gagal' ? 'circle-x' : m.status ? 'circle-check-big' : 'circle') + '</span>';
  }
  var meta = [tipeLabel(m.tipe)];
  if (m.tutup) meta.push((Date.now() > msDari(m.tutup) ? 'Ditutup ' : 'Tenggat ') + tglJam(m.tutup, true));
  if (m.tipe === 'kelasvirtual' && m.konten.mulai) meta.push(ic('calendar-clock') + tglJam(m.konten.mulai, true));
  if (!kelola && m.nilai !== null && m.nilai !== undefined) meta.push('<b>Nilai ' + fmtN(m.nilai) + '</b>');
  if (kelola && m.nilai_maks) meta.push('Maks ' + m.nilai_maks);
  if (kelola && m.syarat && m.syarat.aturan && m.syarat.aturan.length) meta.push(ic('lock') + 'bersyarat');
  if (kelola && m.grouping_id) meta.push(ic('boxes') + 'grup terbatas');
  return '<div class="mod' + (m.terkunci ? ' terkunci' : '') + (m.tampil === 'TIDAK' ? ' tersembunyi' : '') + '" data-mod="' + esc(m.modul_id) + '">' + tipeIkon(m.tipe) +
    '<div class="grow"><a class="mod-t" href="#/aktivitas/' + esc(m.modul_id) + '">' + esc(m.judul) + '</a><div class="mod-meta">' + meta.join(' • ') + (m.tampil === 'TIDAK' ? ' • <span class="bdg">Disembunyikan</span>' : '') + '</div>' +
    (m.terkunci && m.alasan && m.alasan.length ? '<div class="xs amber mt4">' + ic('lock') + esc(m.alasan.join(' • ')) + '</div>' : '') + '</div>' +
    (kelola ? (m.perlu_dinilai ? '<span class="bdg amber" title="Perlu dinilai">' + ic('pen-line') + m.perlu_dinilai + '</span>' : '') + (m.penyelesaian.mode !== 'tidak' ? '<span class="xs muted nowrap hide-m" title="Siswa selesai">' + ic('circle-check') + m.jml_selesai + '</span>' : '') + modKontrol(m, i, n) : stat) + '</div>';
}
function modKontrol(m, i, n) {
  return '<div class="mod-ctl"><button class="btn-ic" data-m="naik" title="Naikkan"' + (i === 0 ? ' disabled' : '') + '>' + ic('arrow-up') + '</button><button class="btn-ic" data-m="turun" title="Turunkan"' + (i === n - 1 ? ' disabled' : '') + '>' + ic('arrow-down') + '</button>' +
    '<button class="btn-ic" data-m="edit" title="Ubah">' + ic('pencil') + '</button><button class="btn-ic hide-m" data-m="tampil" title="' + (m.tampil === 'TIDAK' ? 'Tampilkan' : 'Sembunyikan') + '">' + ic(m.tampil === 'TIDAK' ? 'eye-off' : 'eye') + '</button><button class="btn-ic" data-m="hapus" title="Hapus">' + ic('trash-2') + '</button></div>';
}
function syaratTeks(s, d) {
  var judul = function (id) { var m = (d.modul || []).filter(function (x) { return x.modul_id === id; })[0]; return m ? '"' + m.judul + '"' : 'aktivitas'; };
  var grup = function (id) { var g = (d.grup || []).filter(function (x) { return x.grup_id === id; })[0]; return g ? g.nama : id; };
  return esc((s.aturan || []).map(function (a) {
    return { selesai: 'selesai ' + judul(a.modul_id), nilai_min: 'nilai ≥ ' + a.nilai + ' di ' + judul(a.modul_id), tanggal_mulai: 'mulai ' + tglJam(a.tgl, true), tanggal_sampai: 'sampai ' + tglJam(a.tgl, true), grup: 'grup ' + grup(a.grup_id), grouping: 'pengelompokan' }[a.tipe] || a.tipe;
  }).join(s.op === 'salah_satu' ? ' ATAU ' : ' DAN ')) + (s.sembunyi ? ' (disembunyikan bila belum terpenuhi)' : '');
}

// ---------------------------------------------------------------- Form kursus (baru / ubah)
function dataKursusDari(k) { return { kursus_id: k.kursus_id, nama: k.nama, kode: k.kode, ringkasan: k.ringkasan, mapel: k.mapel, kelas_ids: k.kelas_ids, format: k.format, tgl_mulai: k.tgl_mulai, jml_seksi: k.jml_seksi, warna: k.warna, status: k.status, mode_grup: k.mode_grup, tampil_nilai: k.tampil_nilai }; }
async function formKursus(d, selesai, wadah) {
  var k = d ? d.kursus : { format: 'topik', status: 'Aktif', warna: '#0F766E', jml_seksi: 6, mode_grup: 'tanpa', tampil_nilai: 'YA', tgl_mulai: todayStr() };
  var op = await lmsOpsi(d ? k.kursus_id : '');
  if (!op) return toast('Gagal memuat opsi.', 'bad');
  var kelas = String(k.kelas_ids || '').split(',').filter(String), peng = (k.pengajar || []).map(function (p) { return p.uid; });
  var html = '<div class="grid-form"><div class="field c8"><label>Nama kursus *</label><input class="inp" name="nama" value="' + esc(k.nama || '') + '" placeholder="mis. Biologi XII — Sistem Peredaran Darah"></div><div class="field c4"><label>Kode</label><input class="inp" name="kode" value="' + esc(k.kode || '') + '" placeholder="BIO-XII-3"></div>' +
    '<div class="field c12"><label>Ringkasan</label><textarea class="inp" name="ringkasan" rows="3">' + esc(k.ringkasan || '') + '</textarea></div>' +
    '<div class="field c6"><label>Mata pelajaran</label><select class="sel" name="mapel"><option value="">— Umum —</option>' + op.mapel.map(function (m) { return '<option' + (m.nama === k.mapel ? ' selected' : '') + '>' + esc(m.nama) + '</option>'; }).join('') + '</select></div>' +
    '<div class="field c6"><label>Format kursus</label><select class="sel" name="format">' + selOpts([['topik', 'Topik — dikelompokkan per bab/topik'], ['mingguan', 'Mingguan — satu seksi per pekan'], ['sosial', 'Sosial — berpusat pada forum diskusi']], k.format) + '</select></div>' +
    '<div class="field c4"><label>Tanggal mulai</label><input class="inp" type="date" name="tgl_mulai" value="' + esc(k.tgl_mulai || '') + '"></div><div class="field c4"><label>Jumlah topik / pekan</label><input class="inp" type="number" min="1" max="52" name="jml_seksi" value="' + esc(k.jml_seksi || 6) + '"></div>' +
    '<div class="field c4"><label>Warna</label><input class="inp" type="color" name="warna" value="' + esc(k.warna || '#0F766E') + '" style="height:40px;padding:4px"></div>' +
    '<div class="field c12"><label>Kelas peserta (siswa otomatis terdaftar)</label><div class="chips-pilih">' + op.kelas.map(function (x) { return '<label class="chk"><input type="checkbox" name="kelas_ids" value="' + esc(x.kelas_id) + '"' + (kelas.indexOf(x.kelas_id) > -1 ? ' checked' : '') + '> ' + esc(x.nama_kelas) + '</label>'; }).join('') + '</div></div>' +
    '<div class="field c12"><label>Pengajar</label><div class="chips-pilih">' + op.guru.map(function (g) { return '<label class="chk"><input type="checkbox" name="pengajar" value="' + esc(g.uid) + '"' + (peng.indexOf(g.uid) > -1 || (!d && g.uid === (akunInfo().uid || '')) ? ' checked' : '') + '> ' + esc(g.nama) + '</label>'; }).join('') + '</div><div class="hint">Anda otomatis menjadi pengajar kursus yang Anda buat.</div></div>' +
    '<div class="field c4"><label>Status</label><select class="sel" name="status">' + selOpts([['Draf', 'Draf (belum terlihat siswa)'], ['Aktif', 'Aktif'], ['Arsip', 'Arsip']], k.status) + '</select></div>' +
    '<div class="field c4"><label>Mode grup kursus</label><select class="sel" name="mode_grup">' + selOpts([['tanpa', 'Tanpa grup'], ['terpisah', 'Grup terpisah'], ['terlihat', 'Grup terlihat']], k.mode_grup) + '</select></div>' +
    '<div class="field c4"><label>Nilai untuk siswa</label><select class="sel" name="tampil_nilai">' + selOpts([['YA', 'Tampilkan'], ['TIDAK', 'Sembunyikan']], k.tampil_nilai) + '</select></div></div>';
  function baca(root) {
    var f = formData(root);
    f.kelas_ids = $$('[name=kelas_ids]:checked', root).map(function (x) { return x.value; }).join(',');
    f.pengajar = $$('[name=pengajar]:checked', root).map(function (x) { return x.value; });
    if (d) { f.kursus_id = k.kursus_id; f.judulUlang = f.format === 'mingguan' && f.tgl_mulai !== k.tgl_mulai; }
    return f;
  }
  if (wadah) {
    wadah.innerHTML = '<h3>' + ic('settings') + ' Pengaturan Kursus</h3><div class="mt12">' + html + '</div><button class="btn btn-primary mt16" id="kfSave">' + ic('save') + 'Simpan pengaturan</button>';
    $('#kfSave', wadah).onclick = async function () { btnBusy(this, true); var r = await api('lms.kursus.save', { data: baca(wadah) }); btnBusy(this, false); if (toastRes(r)) { Store.del(userKey('lms:kursus')); selesai && selesai(r.data.kursus_id); } };
    return;
  }
  var m = modal({ title: 'Buat Kursus Baru', size: 'lg', body: html, foot: '<button class="btn btn-outline" data-x>Batal</button><button class="btn btn-primary" id="kfSave">' + ic('check') + 'Buat kursus</button>' });
  $('#kfSave', m.el).onclick = async function () { btnBusy(this, true); var r = await api('lms.kursus.save', { data: baca(m.el) }); btnBusy(this, false); if (toastRes(r)) { m.close(); Store.del(userKey('lms:kursus')); selesai && selesai(r.data.kursus_id); } };
}

// ---------------------------------------------------------------- Pilih tipe modul
function pilihTipeModul(cb) {
  var akt = ['kuis', 'tugas', 'forum', 'pelajaran', 'wiki', 'glosarium', 'workshop', 'umpanbalik', 'kelasvirtual'], sbr = ['berkas', 'folder', 'halaman', 'label', 'url', 'web'];
  var ket = { kuis: '7 tipe soal, acak, batas waktu, nilai otomatis', tugas: 'Kirim teks/berkas, rubrik, tugas kelompok', forum: 'Diskusi, tanya-jawab, lampiran, dinilai', pelajaran: 'Halaman bercabang dengan pertanyaan', wiki: 'Catatan kolaboratif berversi', glosarium: 'Kamus istilah kelas',
    workshop: 'Penilaian sejawat (peer assessment)', umpanbalik: 'Kuesioner, survei kepuasan, evaluasi', kelasvirtual: 'Meet, Zoom, BigBlueButton, Teams', berkas: 'PDF, dokumen, presentasi', folder: 'Kumpulan beberapa berkas', halaman: 'Halaman teks/bacaan', label: 'Teks/pemisah di halaman kursus', url: 'Tautan ke situs/video', web: 'Sematkan halaman web eksternal' };
  function kartu(t) { return '<button class="tipe-pilih" data-t="' + t + '">' + tipeIkon(t) + '<div><b>' + esc(tipeLabel(t)) + '</b><small>' + esc(ket[t]) + '</small></div></button>'; }
  var m = modal({ title: 'Tambah ke Kursus', size: 'lg', body: '<div class="xs b muted">AKTIVITAS PEMBELAJARAN</div><div class="tipe-grid mt8">' + akt.map(kartu).join('') + '</div><div class="xs b muted mt16">SUMBER BELAJAR</div><div class="tipe-grid mt8">' + sbr.map(kartu).join('') + '</div>' });
  m.el.addEventListener('click', function (e) { var b = e.target.closest('[data-t]'); if (b) { m.close(); cb(b.dataset.t); } });
}

// ---------------------------------------------------------------- Editor syarat buka
function editorSyarat(wadah, syarat, d, kecualiId) {
  syarat = syarat || { op: 'semua', aturan: [], sembunyi: false };
  var aturan = (syarat.aturan || []).slice();
  var mods = (d.modul || []).filter(function (m) { return m.modul_id !== kecualiId && m.tipe !== 'label'; });
  function opsiMod(v, dinilai) { return mods.filter(function (m) { return !dinilai || m.nilai_maks; }).map(function (m) { return '<option value="' + esc(m.modul_id) + '"' + (m.modul_id === v ? ' selected' : '') + '>' + esc(m.judul) + '</option>'; }).join(''); }
  function gambar() {
    wadah.innerHTML = '<div class="row wrap gap8"><select class="sel" data-op style="max-width:220px">' + selOpts([['semua', 'Semua syarat terpenuhi'], ['salah_satu', 'Salah satu syarat terpenuhi']], syarat.op) + '</select><label class="chk"><input type="checkbox" data-sembunyi' + (syarat.sembunyi ? ' checked' : '') + '> Sembunyikan bila belum terpenuhi</label></div>' +
      '<div class="syarat-list mt8">' + aturan.map(function (a, i) {
        var nilai = '';
        if (a.tipe === 'selesai') nilai = '<select class="sel" data-f="modul_id">' + opsiMod(a.modul_id) + '</select>';
        else if (a.tipe === 'nilai_min') nilai = '<select class="sel" data-f="modul_id">' + opsiMod(a.modul_id, true) + '</select><input class="inp" type="number" data-f="nilai" min="0" max="100" value="' + esc(a.nilai || 60) + '" style="width:90px" title="Nilai minimal (%)">';
        else if (a.tipe === 'tanggal_mulai' || a.tipe === 'tanggal_sampai') nilai = '<input class="inp" type="datetime-local" data-f="tgl" value="' + esc(a.tgl || '') + '">';
        else if (a.tipe === 'grup') nilai = '<select class="sel" data-f="grup_id">' + (d.grup || []).map(function (g) { return '<option value="' + esc(g.grup_id) + '"' + (g.grup_id === a.grup_id ? ' selected' : '') + '>' + esc(g.nama) + '</option>'; }).join('') + '</select>';
        else if (a.tipe === 'grouping') nilai = '<select class="sel" data-f="grouping_id">' + (d.grouping || []).map(function (g) { return '<option value="' + esc(g.grouping_id) + '"' + (g.grouping_id === a.grouping_id ? ' selected' : '') + '>' + esc(g.nama) + '</option>'; }).join('') + '</select>';
        return '<div class="syarat-i" data-i="' + i + '"><select class="sel" data-f="tipe" style="max-width:200px">' + selOpts([['selesai', 'Aktivitas selesai'], ['nilai_min', 'Nilai minimal'], ['tanggal_mulai', 'Mulai tanggal'], ['tanggal_sampai', 'Sampai tanggal'], ['grup', 'Anggota grup'], ['grouping', 'Anggota pengelompokan']], a.tipe) + '</select>' + nilai + '<button class="btn-ic" data-del title="Hapus syarat">' + ic('x') + '</button></div>';
      }).join('') + '</div><button class="btn btn-ghost btn-sm mt8" data-add type="button">' + ic('plus') + 'Tambah syarat</button>';
  }
  function sinkron() {
    syarat.op = $('[data-op]', wadah).value; syarat.sembunyi = $('[data-sembunyi]', wadah).checked;
    $$('.syarat-i', wadah).forEach(function (row) { var a = aturan[Number(row.dataset.i)]; $$('[data-f]', row).forEach(function (x) { a[x.dataset.f] = x.type === 'number' ? Number(x.value) : x.value; }); });
  }
  wadah.addEventListener('change', function (e) { sinkron(); if (e.target.dataset.f === 'tipe') { var a = aturan[Number(e.target.closest('.syarat-i').dataset.i)]; Object.keys(a).forEach(function (k) { if (k !== 'tipe') delete a[k]; }); gambar(); } });
  wadah.addEventListener('click', function (e) {
    if (e.target.closest('[data-add]')) { sinkron(); aturan.push({ tipe: mods.length ? 'selesai' : 'tanggal_mulai', modul_id: mods[0] && mods[0].modul_id }); gambar(); }
    var del = e.target.closest('[data-del]'); if (del) { sinkron(); aturan.splice(Number(del.closest('.syarat-i').dataset.i), 1); gambar(); }
  });
  gambar();
  return { baca: function () { sinkron(); aturan.forEach(function (a) { if (a.tipe !== 'selesai' && a.tipe !== 'nilai_min') delete a.modul_id; }); return { op: syarat.op, sembunyi: syarat.sembunyi, aturan: aturan.filter(function (a) { return a.modul_id || a.tgl || a.grup_id || a.grouping_id; }) }; } };
}

// ---------------------------------------------------------------- Editor modul (aktivitas & sumber belajar)
async function editorModul(d, o, selesai) {
  var m0 = o.modul, tipe = m0 ? m0.tipe : o.tipe, k = m0 ? m0.konten : {}, kid = d.kursus.kursus_id;
  var op = await lmsOpsi(kid, true); if (!op) return toast('Gagal memuat opsi.', 'bad');
  var dinilai = /^(kuis|tugas|forum|workshop|pelajaran)$/.test(tipe);
  var tabs = [['umum', 'Umum'], ['konten', 'Konten']].concat(dinilai ? [['nilai', 'Penilaian']] : []).concat(tipe !== 'label' ? [['selesai', 'Penyelesaian'], ['akses', 'Akses & Syarat']] : []);
  var m = modal({ title: (m0 ? 'Ubah ' : 'Tambah ') + tipeLabel(tipe), sub: d.kursus.nama, size: 'xl',
    body: '<div class="tabs" id="emTab">' + tabs.map(function (t, i) { return '<button data-t="' + t[0] + '" class="' + (i ? '' : 'on') + '">' + t[1] + '</button>'; }).join('') + '</div>' +
      '<div class="em-pane" data-p="umum"><div class="grid-form mt16"><div class="field c8"><label>Judul' + (tipe === 'label' ? '' : ' *') + '</label><input class="inp" name="judul" value="' + esc(m0 ? m0.judul : '') + '"></div>' +
      '<div class="field c4"><label>Seksi</label><select class="sel" name="seksi_id">' + d.seksi.map(function (s) { return '<option value="' + esc(s.seksi_id) + '"' + (s.seksi_id === (m0 ? m0.seksi_id : o.seksi_id) ? ' selected' : '') + '>' + esc(s.judul) + '</option>'; }).join('') + '</select></div>' +
      (tipe !== 'label' ? '<div class="field c12"><label>Deskripsi / petunjuk singkat</label><textarea class="inp" name="deskripsi" rows="3">' + esc(m0 ? m0.deskripsi : '') + '</textarea></div>' : '') +
      '<div class="field c4"><label>Visibilitas</label><select class="sel" name="tampil">' + selOpts([['YA', 'Tampil untuk siswa'], ['TIDAK', 'Disembunyikan']], m0 ? m0.tampil : 'YA') + '</select></div>' +
      (/^(kuis|tugas|umpanbalik)$/.test(tipe) ? '<div class="field c4"><label>' + (tipe === 'tugas' ? 'Dibuka mulai' : 'Dibuka') + '</label><input class="inp" type="datetime-local" name="buka" value="' + esc(m0 ? m0.buka : '') + '"></div><div class="field c4"><label>' + (tipe === 'tugas' ? 'Batas pengumpulan' : 'Ditutup') + '</label><input class="inp" type="datetime-local" name="tutup" value="' + esc(m0 ? m0.tutup : '') + '"></div>' : '') +
      '</div></div><div class="em-pane" data-p="konten" hidden><div class="mt16" id="emKonten"></div></div>' +
      (dinilai ? '<div class="em-pane" data-p="nilai" hidden><div class="grid-form mt16"><div class="field c4"><label>Nilai maksimal</label><input class="inp" type="number" min="1" max="1000" name="nilai_maks" value="' + esc(m0 && m0.nilai_maks ? m0.nilai_maks : (tipe === 'forum' ? 10 : 100)) + '"></div>' +
        '<div class="field c4"><label>Kategori buku nilai</label><select class="sel" name="kategori_id"><option value="">Lainnya (tanpa kategori)</option>' + (op.kategori || []).map(function (c) { return '<option value="' + esc(c.kategori_id) + '"' + (m0 && m0.kategori_id === c.kategori_id ? ' selected' : '') + '>' + esc(c.nama) + ' (' + c.bobot + '%)</option>'; }).join('') + '</select></div>' +
        '<div class="field c4"><label>Bobot di kategori</label><input class="inp" type="number" min="0" step="0.5" name="bobot" value="' + esc(m0 ? m0.bobot : 1) + '"></div>' + (tipe === 'forum' ? '<div class="note c12">' + ic('info') + '<div>Nilai forum dihitung hanya bila "Postingan dinilai guru" dicentang di tab Konten.</div></div>' : '') + '</div></div>' : '') +
      (tipe !== 'label' ? '<div class="em-pane" data-p="selesai" hidden><div class="grid-form mt16"><div class="field c8"><label>Aktivitas dianggap selesai…</label><select class="sel" name="pen_mode">' +
        selOpts(Object.keys(SELESAI_LBL).filter(function (x) { return (x !== 'nilai' && x !== 'lulus') || dinilai; }).filter(function (x) { return x !== 'kirim' || isAktivitas(tipe); }).map(function (x) { return [x, SELESAI_LBL[x]]; }), m0 ? m0.penyelesaian.mode : '') + '</select></div>' +
        '<div class="field c4"><label>Nilai minimal (untuk "lulus")</label><input class="inp" type="number" min="0" max="100" name="pen_min" value="' + esc(m0 && m0.penyelesaian.nilai_min !== undefined ? m0.penyelesaian.nilai_min : cfg('KKM', 70)) + '"></div></div><div class="note mt8">' + ic('info') + '<div>Penyelesaian dipakai untuk progres siswa, syarat membuka aktivitas lain, dan kriteria kelulusan kursus.</div></div></div>' +
        '<div class="em-pane" data-p="akses" hidden><div class="grid-form mt16"><div class="field c6"><label>Batasi untuk pengelompokan</label><select class="sel" name="grouping_id"><option value="">— Semua peserta —</option>' + (d.grouping || []).map(function (g) { return '<option value="' + esc(g.grouping_id) + '"' + (m0 && m0.grouping_id === g.grouping_id ? ' selected' : '') + '>' + esc(g.nama) + '</option>'; }).join('') + '</select></div>' +
        (/^(forum|wiki|tugas)$/.test(tipe) ? '<div class="field c6"><label>Mode grup aktivitas</label><select class="sel" name="mode_grup">' + selOpts([['', 'Ikuti pengaturan kursus'], ['tanpa', 'Tanpa grup'], ['terpisah', 'Grup terpisah (hanya lihat grup sendiri)'], ['terlihat', 'Grup terlihat']], m0 ? m0.mode_grup : '') + '</select></div>' : '') +
        '</div><div class="xs b muted mt16">SYARAT MEMBUKA</div><div id="emSyarat" class="mt8"></div></div>' : ''),
    foot: '<button class="btn btn-outline" data-x>Batal</button><button class="btn btn-primary" id="emSave">' + ic('save') + 'Simpan</button>' });
  $$('#emTab button', m.el).forEach(function (b) { b.onclick = function () { $$('#emTab button', m.el).forEach(function (x) { x.classList.toggle('on', x === b); }); $$('.em-pane', m.el).forEach(function (p) { p.hidden = p.dataset.p !== b.dataset.t; }); }; });
  var form = FORM_KONTEN[tipe]($('#emKonten', m.el), k, { op: op, d: d, m0: m0 });
  var syarat = tipe !== 'label' ? editorSyarat($('#emSyarat', m.el), m0 && m0.syarat, d, m0 && m0.modul_id) : null;
  $('#emSave', m.el).onclick = async function () {
    var f = formData(m.el), x = form.baca(); if (x === false) return;
    var data = { kursus_id: kid, modul_id: m0 ? m0.modul_id : '', tipe: tipe, judul: f.judul, seksi_id: f.seksi_id, deskripsi: f.deskripsi || '', tampil: f.tampil, buka: f.buka || '', tutup: f.tutup || '', konten: x.konten,
      nilai_maks: f.nilai_maks, kategori_id: f.kategori_id || '', bobot: f.bobot, penyelesaian: { mode: f.pen_mode, nilai_min: Number(f.pen_min) }, grouping_id: f.grouping_id || '', mode_grup: f.mode_grup || '', syarat: syarat ? syarat.baca() : null };
    btnBusy(this, true);
    var r = await api('lms.modul.save', Object.assign({ data: data }, x.extra || {}));
    btnBusy(this, false);
    if (toastRes(r)) { m.close(); selesai && selesai(r.data); }
  };
}
/** Form konten per tipe: (wadah, konten, ctx) → { baca() → {konten, extra} | false } */
var FORM_KONTEN = {
  berkas: function (w, k) {
    var unggah = null;
    w.innerHTML = '<div class="field"><label>Berkas (PDF, dokumen, presentasi, gambar)</label><div class="row gap8"><button class="btn btn-outline" type="button" id="fbPilih">' + ic('upload') + 'Pilih berkas</button><span id="fbNama" class="small">' + (k.berkas ? esc(k.berkas.nama) + ' <span class="muted">(tersimpan)</span>' : '<span class="muted">Belum ada berkas</span>') + '</span></div></div>' +
      '<div class="field mt12"><label>Tampilan</label><select class="sel" id="fbTampil">' + selOpts([['sematkan', 'Tampilkan di halaman (pratinjau)'], ['unduh', 'Tombol unduh saja']], k.tampil) + '</select></div>';
    $('#fbPilih', w).onclick = async function () { var f = await pilihBerkas({ accept: '.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.odt,.odp,.png,.jpg,.jpeg,.txt' }); if (f[0]) { unggah = f[0]; $('#fbNama', w).innerHTML = esc(unggah.name) + ' <span class="muted">(' + fmtSize(unggah.size) + ', akan diunggah)</span>'; } };
    return { baca: function () { if (!unggah && !k.berkas) { toast('Pilih berkas terlebih dulu.', 'warn'); return false; } return { konten: { tampil: $('#fbTampil', w).value }, extra: unggah ? { unggah: { name: unggah.name, mime: unggah.mime, data: unggah.data } } : {} }; } };
  },
  folder: function (w, k) {
    var baru = [];
    w.innerHTML = '<div class="field"><label>Berkas di folder</label>' + daftarBerkas(k.berkas || [], { hapus: true }) + '<button class="btn btn-outline mt8" type="button" id="ffPilih">' + ic('upload') + 'Tambah berkas…</button><div id="ffBaru" class="small mt8"></div></div>';
    $('#ffPilih', w).onclick = async function () { var f = await pilihBerkas({ multiple: true }); baru = baru.concat(f); $('#ffBaru', w).innerHTML = baru.map(function (x) { return '• ' + esc(x.name) + ' <span class="muted">(akan diunggah)</span>'; }).join('<br>'); };
    return { baca: function () { return { konten: {}, extra: { unggahBanyak: baru.map(function (x) { return { name: x.name, mime: x.mime, data: x.data }; }), hapusBerkas: $$('[data-hapus-berkas]:checked', w).map(function (x) { return x.dataset.hapusBerkas; }) } }; } };
  },
  halaman: function (w, k) { return formTeksMd(w, k.isi, 'Isi halaman', 14, function (v) { return { isi: v }; }); },
  label: function (w, k) {
    var f = formTeksMd(w, k.isi, 'Teks label (tampil langsung di halaman kursus)', 4, function (v) { return { isi: v, gaya: $('#flGaya', w).value }; });
    w.insertAdjacentHTML('beforeend', '<div class="field mt12"><label>Gaya</label><select class="sel" id="flGaya">' + selOpts([['', 'Biasa'], ['info', 'Info (biru)'], ['peringatan', 'Peringatan (kuning)'], ['sukses', 'Sukses (hijau)']], k.gaya) + '</select></div>');
    return f;
  },
  url: function (w, k) {
    w.innerHTML = '<div class="field"><label>Alamat URL *</label><input class="inp" id="fuUrl" value="' + esc(k.url || '') + '" placeholder="https://…"></div><div class="field mt12"><label>Cara membuka</label><select class="sel" id="fuBuka">' + selOpts([['tab', 'Tab baru'], ['sematkan', 'Sematkan di halaman (jika situs mengizinkan)']], k.buka) + '</select></div>';
    return { baca: function () { return { konten: { url: $('#fuUrl', w).value.trim(), buka: $('#fuBuka', w).value } }; } };
  },
  web: function (w, k) {
    w.innerHTML = '<div class="field"><label>Alamat halaman web *</label><input class="inp" id="fwUrl" value="' + esc(k.url || '') + '" placeholder="https://…"></div><div class="field mt12"><label>Tinggi bingkai (px)</label><input class="inp" type="number" id="fwT" min="300" max="1600" value="' + esc(k.tinggi || 640) + '"></div><div class="note mt12">' + ic('info') + '<div>Beberapa situs (mis. Google, YouTube halaman utama) menolak disematkan. Gunakan tautan "embed" bila tersedia.</div></div>';
    return { baca: function () { return { konten: { url: $('#fwUrl', w).value.trim(), tinggi: Number($('#fwT', w).value) } }; } };
  },
  kuis: function (w, k, c) {
    var pilih = {}; (k.soal || []).forEach(function (s) { pilih[s.soal_id] = s.skor; });
    w.innerHTML = '<div class="grid-form"><div class="field c3"><label>Waktu (menit, 0 = bebas)</label><input class="inp" type="number" min="0" id="fkW" value="' + esc(k.waktu_menit || 0) + '"></div><div class="field c3"><label>Kesempatan (0 = tak terbatas)</label><input class="inp" type="number" min="0" id="fkP" value="' + esc(k.percobaan_maks === undefined ? 1 : k.percobaan_maks) + '"></div>' +
      '<div class="field c3"><label>Metode nilai</label><select class="sel" id="fkM">' + selOpts([['tertinggi', 'Nilai tertinggi'], ['terakhir', 'Percobaan terakhir'], ['rata', 'Rata-rata'], ['pertama', 'Percobaan pertama']], k.metode_nilai) + '</select></div><div class="field c3"><label>KKM kuis</label><input class="inp" type="number" id="fkL" value="' + esc(k.nilai_lulus || cfg('KKM', 70)) + '"></div>' +
      '<div class="field c4"><label>Tampilkan jawaban benar</label><select class="sel" id="fkT">' + selOpts([['langsung', 'Langsung setelah kirim'], ['setelah_tutup', 'Setelah kuis ditutup'], ['tidak', 'Tidak pernah (nilai saja)']], k.tampil_jawaban) + '</select></div>' +
      '<div class="field c4"><label>Ambil acak N soal (0 = semua)</label><input class="inp" type="number" min="0" id="fkA" value="' + esc(k.ambil_acak || 0) + '"></div><div class="field c4"><label>&nbsp;</label><label class="chk"><input type="checkbox" id="fkAs"' + (k.acak_soal ? ' checked' : '') + '> Acak urutan soal</label><label class="chk"><input type="checkbox" id="fkAo"' + (k.acak_opsi !== false ? ' checked' : '') + '> Acak pilihan jawaban</label></div>' +
      '<div class="field c12"><label>Petunjuk</label><textarea class="inp" id="fkPt" rows="2">' + esc(k.petunjuk || '') + '</textarea></div></div>' +
      '<div class="row mt16"><div class="xs b muted grow">SOAL DARI BANK SOAL <span id="fkJml"></span></div><a class="btn btn-ghost btn-sm" href="#/banksoal/' + esc(c.d.kursus.kursus_id) + '" target="_blank">' + ic('external-link') + 'Kelola bank soal</a></div><input class="inp mt8" id="fkCari" placeholder="Cari soal / kategori…"><div class="soal-pilih mt8" id="fkList"><div class="sk" style="height:120px"></div></div>';
    var semua = [];
    function hitung() { var n = Object.keys(pilih).length, tot = Object.keys(pilih).reduce(function (s, id) { return s + Number(pilih[id] || 0); }, 0); $('#fkJml', w).textContent = '— ' + n + ' dipilih, total skor ' + tot; }
    function draw() {
      var q = $('#fkCari', w).value.toLowerCase();
      $('#fkList', w).innerHTML = semua.filter(function (s) { return !q || (s.teks + ' ' + s.kategori).toLowerCase().indexOf(q) > -1; }).map(function (s) {
        return '<label class="soal-i' + (pilih[s.soal_id] !== undefined ? ' on' : '') + '"><input type="checkbox" value="' + esc(s.soal_id) + '"' + (pilih[s.soal_id] !== undefined ? ' checked' : '') + '><span class="bdg">' + esc(SOAL_LBL[s.tipe] || s.tipe) + '</span><span class="grow clamp2">' + esc(s.teks) + '</span><span class="xs muted">' + esc(s.kategori || '') + '</span><input class="inp" type="number" min="0.5" step="0.5" data-skor="' + esc(s.soal_id) + '" value="' + esc(pilih[s.soal_id] !== undefined ? pilih[s.soal_id] : s.skor) + '" title="Skor" style="width:64px"></label>';
      }).join('') || emptyHtml('Bank soal kosong', 'Buat soal di menu Bank Soal terlebih dulu.', 'list-checks');
      hitung();
    }
    api('soal.list', { kursus_id: c.d.kursus.kursus_id }).then(function (r) { semua = r.success ? r.data.soal : []; draw(); });
    $('#fkCari', w).oninput = draw;
    $('#fkList', w).addEventListener('change', function (e) {
      if (e.target.type === 'checkbox') { var id = e.target.value; if (e.target.checked) pilih[id] = Number($('[data-skor="' + id + '"]', w).value) || 1; else delete pilih[id]; e.target.closest('.soal-i').classList.toggle('on', e.target.checked); hitung(); }
      if (e.target.dataset.skor && pilih[e.target.dataset.skor] !== undefined) { pilih[e.target.dataset.skor] = Number(e.target.value) || 1; hitung(); }
    });
    return { baca: function () {
      var urut = (k.soal || []).map(function (s) { return s.soal_id; }).filter(function (id) { return pilih[id] !== undefined; }).concat(Object.keys(pilih).filter(function (id) { return !(k.soal || []).some(function (s) { return s.soal_id === id; }); }));
      if (!urut.length) { toast('Pilih minimal 1 soal untuk kuis.', 'warn'); return false; }
      return { konten: { soal: urut.map(function (id) { return { soal_id: id, skor: pilih[id] }; }), waktu_menit: Number($('#fkW', w).value), percobaan_maks: Number($('#fkP', w).value), metode_nilai: $('#fkM', w).value, nilai_lulus: Number($('#fkL', w).value),
        tampil_jawaban: $('#fkT', w).value, ambil_acak: Number($('#fkA', w).value), acak_soal: $('#fkAs', w).checked, acak_opsi: $('#fkAo', w).checked, petunjuk: $('#fkPt', w).value } };
    } };
  },
  tugas: function (w, k, c) {
    w.innerHTML = '<div class="grid-form"><div class="field c4"><label>Bentuk pengumpulan</label><select class="sel" id="ftT">' + selOpts([['keduanya', 'Teks dan/atau berkas'], ['teks', 'Teks daring saja'], ['berkas', 'Berkas saja']], k.tipe_kirim) + '</select></div><div class="field c4"><label>Maks. berkas</label><input class="inp" type="number" min="1" max="10" id="ftM" value="' + esc(k.maks_berkas || 3) + '"></div>' +
      '<div class="field c4"><label>Rubrik / panduan penilaian</label><select class="sel" id="ftR"><option value="">— Nilai angka biasa —</option>' + (c.op.rubrik || []).map(function (r) { return '<option value="' + esc(r.rubrik_id) + '"' + (r.rubrik_id === k.rubrik_id ? ' selected' : '') + '>' + esc(r.nama) + ' (' + (r.jenis === 'panduan' ? 'panduan' : 'rubrik') + ')</option>'; }).join('') + '</select></div>' +
      '<div class="field c12"><label class="chk"><input type="checkbox" id="ftL"' + (k.terlambat_boleh !== false ? ' checked' : '') + '> Izinkan pengumpulan terlambat (ditandai "terlambat")</label><label class="chk"><input type="checkbox" id="ftK"' + (k.kelompok ? ' checked' : '') + '> Tugas kelompok — satu kiriman per grup, nilai berlaku untuk semua anggota</label></div></div><div id="ftP" class="mt12"></div>';
    var p = formTeksMd($('#ftP', w), k.petunjuk, 'Petunjuk tugas', 6, function (v) { return v; });
    return { baca: function () { return { konten: { tipe_kirim: $('#ftT', w).value, maks_berkas: Number($('#ftM', w).value), rubrik_id: $('#ftR', w).value, terlambat_boleh: $('#ftL', w).checked, kelompok: $('#ftK', w).checked, petunjuk: p.baca().konten } }; } };
  },
  forum: function (w, k) {
    w.innerHTML = '<div class="grid-form"><div class="field c6"><label>Jenis forum</label><select class="sel" id="foJ">' + selOpts([['umum', 'Diskusi umum — semua boleh membuat topik'], ['tanya_jawab', 'Tanya-jawab — siswa harus menjawab sebelum melihat jawaban teman'], ['satu', 'Satu diskusi sederhana'], ['berita', 'Pengumuman — hanya pengajar']], k.jenis) + '</select></div>' +
      '<div class="field c6"><label>Agregasi nilai</label><select class="sel" id="foA">' + selOpts([['rata', 'Rata-rata nilai postingan'], ['maks', 'Nilai tertinggi'], ['jumlah', 'Jumlah (dibatasi maks)']], k.agregasi) + '</select></div>' +
      '<div class="field c12"><label class="chk"><input type="checkbox" id="foD"' + (k.dinilai ? ' checked' : '') + '> Postingan dinilai guru (masuk buku nilai)</label><label class="chk"><input type="checkbox" id="foL"' + (k.lampiran !== false ? ' checked' : '') + '> Izinkan lampiran berkas</label></div></div><div id="foP" class="mt12"></div>';
    var p = formTeksMd($('#foP', w), k.petunjuk, 'Petunjuk diskusi (opsional)', 3, function (v) { return v; });
    return { baca: function () { return { konten: { jenis: $('#foJ', w).value, agregasi: $('#foA', w).value, dinilai: $('#foD', w).checked, lampiran: $('#foL', w).checked, petunjuk: p.baca().konten } }; } };
  },
  wiki: function (w, k) {
    w.innerHTML = '<div class="grid-form"><div class="field c6"><label>Mode wiki</label><select class="sel" id="fwM">' + selOpts([['kolaboratif', 'Kolaboratif — satu wiki bersama (per grup bila mode grup aktif)'], ['individu', 'Individu — setiap siswa punya wiki sendiri']], k.mode) + '</select></div><div class="field c6"><label>Judul halaman awal</label><input class="inp" id="fwH" value="' + esc(k.halaman_awal || 'Beranda') + '"></div></div><div class="note mt12">' + ic('info') + '<div>Tautkan halaman lain dengan [[Judul Halaman]]. Setiap perubahan tersimpan sebagai versi & bisa dipulihkan.</div></div>';
    return { baca: function () { return { konten: { mode: $('#fwM', w).value, halaman_awal: $('#fwH', w).value } }; } };
  },
  glosarium: function (w, k) {
    w.innerHTML = '<label class="chk"><input type="checkbox" id="fgS"' + (k.siswa_boleh !== false ? ' checked' : '') + '> Siswa boleh menambah istilah</label><label class="chk"><input type="checkbox" id="fgP"' + (k.persetujuan ? ' checked' : '') + '> Entri siswa perlu persetujuan guru</label>';
    return { baca: function () { return { konten: { siswa_boleh: $('#fgS', w).checked, persetujuan: $('#fgP', w).checked } }; } };
  },
  workshop: function (w, k) {
    var kr = (k.kriteria && k.kriteria.length ? k.kriteria : [{ deskripsi: 'Gagasan utama jelas', maks: 10 }, { deskripsi: 'Argumen didukung fakta', maks: 10 }]).slice();
    function draw() { $('#fwsK', w).innerHTML = kr.map(function (x, i) { return '<div class="row gap8 mt8" data-i="' + i + '"><input class="inp grow" data-f="deskripsi" value="' + esc(x.deskripsi) + '" placeholder="Kriteria penilaian"><input class="inp" type="number" data-f="maks" min="1" value="' + esc(x.maks) + '" style="width:80px" title="Skor maksimal"><button class="btn-ic" data-del type="button">' + ic('x') + '</button></div>'; }).join(''); }
    function sinkron() { $$('#fwsK [data-i]', w).forEach(function (r) { var x = kr[Number(r.dataset.i)]; x.deskripsi = $('[data-f=deskripsi]', r).value; x.maks = Number($('[data-f=maks]', r).value) || 1; }); }
    w.innerHTML = '<div class="grid-form"><div class="field c4"><label>Penilai per karya</label><input class="inp" type="number" min="1" max="5" id="fwsN" value="' + esc(k.jml_penilai || 2) + '"></div><div class="field c4"><label>Bobot nilai karya (%)</label><input class="inp" type="number" min="0" max="100" id="fwsB" value="' + esc(k.bobot_kirim || 80) + '"></div><div class="field c4"><label>Bobot akurasi menilai</label><input class="inp" id="fwsB2" disabled value="' + (100 - (k.bobot_kirim || 80)) + '%"></div></div>' +
      '<div class="xs b muted mt16">KRITERIA PENILAIAN SEJAWAT</div><div id="fwsK"></div><button class="btn btn-ghost btn-sm mt8" type="button" id="fwsAdd">' + ic('plus') + 'Kriteria</button>' +
      '<div class="field mt12"><label>Petunjuk pengiriman</label><textarea class="inp" id="fwsPk" rows="2">' + esc(k.petunjuk_kirim || '') + '</textarea></div><div class="field mt12"><label>Petunjuk menilai</label><textarea class="inp" id="fwsPn" rows="2">' + esc(k.petunjuk_nilai || '') + '</textarea></div>';
    draw();
    $('#fwsB', w).oninput = function () { $('#fwsB2', w).value = (100 - Number(this.value || 0)) + '%'; };
    $('#fwsAdd', w).onclick = function () { sinkron(); kr.push({ deskripsi: '', maks: 10 }); draw(); };
    $('#fwsK', w).onclick = function (e) { if (e.target.closest('[data-del]')) { sinkron(); kr.splice(Number(e.target.closest('[data-i]').dataset.i), 1); draw(); } };
    return { baca: function () { sinkron(); return { konten: { kriteria: kr.map(function (x, i) { return { id: x.id || 'K' + (i + 1), deskripsi: x.deskripsi, maks: x.maks }; }), jml_penilai: Number($('#fwsN', w).value), bobot_kirim: Number($('#fwsB', w).value), petunjuk_kirim: $('#fwsPk', w).value, petunjuk_nilai: $('#fwsPn', w).value } }; } };
  },
  pelajaran: function (w, k) {
    var hal = JSON.parse(JSON.stringify(k.halaman && k.halaman.length ? k.halaman : [{ id: 'H1', judul: 'Pengantar', tipe: 'konten', isi: '', opsi: [], tombol: [{ label: 'Lanjut', ke: 'lanjut' }] }]));
    function idBaru() { var n = 1; while (hal.some(function (h) { return h.id === 'H' + n; })) n++; return 'H' + n; }
    function tujuan(v, sel) { return '<select class="sel" data-f="' + sel + '" style="max-width:150px">' + selOpts([['lanjut', '→ Halaman berikut'], ['ulang', '↺ Ulangi halaman'], ['sebelum', '← Sebelumnya'], ['akhir', '■ Selesai']].concat(hal.map(function (h) { return [h.id, h.id + ': ' + (h.judul || '').slice(0, 18)]; })), v || 'lanjut') + '</select>'; }
    function draw() {
      $('#fpH', w).innerHTML = hal.map(function (h, i) {
        return '<div class="pel-ed card" data-i="' + i + '"><div class="row gap8"><span class="bdg navy">' + esc(h.id) + '</span><input class="inp grow" data-f="judul" value="' + esc(h.judul) + '" placeholder="Judul halaman"><select class="sel" data-f="tipe" style="max-width:150px">' + selOpts([['konten', 'Halaman konten'], ['soal', 'Halaman pertanyaan']], h.tipe) + '</select>' +
          '<button class="btn-ic" data-up type="button" title="Naik">' + ic('arrow-up') + '</button><button class="btn-ic" data-del type="button" title="Hapus">' + ic('trash-2') + '</button></div>' +
          '<textarea class="inp mt8" data-f="isi" rows="3" placeholder="' + (h.tipe === 'soal' ? 'Pertanyaan' : 'Isi halaman (mendukung **tebal**, daftar)') + '">' + esc(h.isi) + '</textarea>' +
          (h.tipe === 'soal' ? '<div class="xs b muted mt8">PILIHAN JAWABAN → TUJUAN</div>' + (h.opsi || []).map(function (o, j) { return '<div class="row gap8 mt8 wrap" data-o="' + j + '"><label class="chk" title="Jawaban benar"><input type="checkbox" data-of="benar"' + (o.benar ? ' checked' : '') + '>Benar</label><input class="inp grow" data-of="teks" value="' + esc(o.teks) + '" placeholder="Teks pilihan">' + tujuan(o.lompat, 'lompat').replace('data-f=', 'data-of=') + '<input class="inp grow" data-of="umpan" value="' + esc(o.umpan || '') + '" placeholder="Umpan balik"><button class="btn-ic" data-odel type="button">' + ic('x') + '</button></div>'; }).join('') + '<button class="btn btn-ghost btn-xs mt8" data-oadd type="button">' + ic('plus') + 'Pilihan</button>'
            : '<div class="xs b muted mt8">TOMBOL NAVIGASI</div>' + (h.tombol || []).map(function (t, j) { return '<div class="row gap8 mt8" data-t="' + j + '"><input class="inp grow" data-tf="label" value="' + esc(t.label) + '" placeholder="Label tombol">' + tujuan(t.ke, 'ke').replace('data-f=', 'data-tf=') + '<button class="btn-ic" data-tdel type="button">' + ic('x') + '</button></div>'; }).join('') + '<button class="btn btn-ghost btn-xs mt8" data-tadd type="button">' + ic('plus') + 'Tombol</button>') + '</div>';
      }).join('');
    }
    function sinkron() {
      $$('.pel-ed', w).forEach(function (el) {
        var h = hal[Number(el.dataset.i)];
        $$('[data-f]', el).forEach(function (x) { if (x.closest('[data-o]') || x.closest('[data-t]')) return; h[x.dataset.f] = x.value; });
        h.opsi = $$('[data-o]', el).map(function (r) { return { benar: $('[data-of=benar]', r).checked, teks: $('[data-of=teks]', r).value, lompat: $('[data-of=lompat]', r).value, umpan: $('[data-of=umpan]', r).value }; });
        h.tombol = $$('[data-t]', el).map(function (r) { return { label: $('[data-tf=label]', r).value, ke: $('[data-tf=ke]', r).value }; });
      });
    }
    w.innerHTML = '<div class="grid-form"><div class="field c6"><label>Nilai minimal lulus (%)</label><input class="inp" type="number" min="0" max="100" id="fpN" value="' + esc(k.nilai_min || 70) + '"></div><div class="field c6"><label>Kesempatan mengulang (0 = bebas)</label><input class="inp" type="number" min="0" id="fpP" value="' + esc(k.percobaan_maks || 0) + '"></div></div>' +
      '<div class="note mt8">' + ic('route') + '<div>Pertanyaan dinilai di server. Jawaban salah dapat diarahkan ke halaman penguatan, jawaban benar melompat ke halaman lanjut. Nilai = jawaban benar ÷ jawaban yang diberikan.</div></div><div id="fpH" class="mt12"></div><button class="btn btn-outline btn-sm mt8" type="button" id="fpAdd">' + ic('plus') + 'Tambah halaman</button>';
    draw();
    $('#fpAdd', w).onclick = function () { sinkron(); hal.push({ id: idBaru(), judul: '', tipe: 'konten', isi: '', opsi: [], tombol: [{ label: 'Lanjut', ke: 'lanjut' }] }); draw(); };
    $('#fpH', w).addEventListener('change', function (e) { if (e.target.dataset.f === 'tipe') { sinkron(); var h = hal[Number(e.target.closest('.pel-ed').dataset.i)]; if (h.tipe === 'soal' && !h.opsi.length) h.opsi = [{ teks: '', benar: true, lompat: 'lanjut' }, { teks: '', benar: false, lompat: 'ulang' }]; draw(); } });
    $('#fpH', w).addEventListener('click', function (e) {
      var el = e.target.closest('.pel-ed'); if (!el) return; var i = Number(el.dataset.i);
      if (e.target.closest('[data-del]')) { sinkron(); if (hal.length > 1) hal.splice(i, 1); draw(); }
      else if (e.target.closest('[data-up]')) { sinkron(); if (i > 0) { var t = hal[i - 1]; hal[i - 1] = hal[i]; hal[i] = t; } draw(); }
      else if (e.target.closest('[data-oadd]')) { sinkron(); hal[i].opsi.push({ teks: '', benar: false, lompat: 'lanjut' }); draw(); }
      else if (e.target.closest('[data-odel]')) { sinkron(); hal[i].opsi.splice(Number(e.target.closest('[data-o]').dataset.o), 1); draw(); }
      else if (e.target.closest('[data-tadd]')) { sinkron(); hal[i].tombol.push({ label: 'Lanjut', ke: 'lanjut' }); draw(); }
      else if (e.target.closest('[data-tdel]')) { sinkron(); hal[i].tombol.splice(Number(e.target.closest('[data-t]').dataset.t), 1); draw(); }
    });
    return { baca: function () { sinkron(); if (hal.some(function (h) { return h.tipe === 'soal' && !h.opsi.some(function (o) { return o.benar; }); })) { toast('Setiap halaman pertanyaan perlu minimal 1 jawaban benar.', 'warn'); return false; } return { konten: { halaman: hal, nilai_min: Number($('#fpN', w).value), percobaan_maks: Number($('#fpP', w).value) } }; } };
  },
  umpanbalik: function (w, k) {
    var q = JSON.parse(JSON.stringify(k.pertanyaan || []));
    var TEMPLAT = {
      kepuasan: [{ tipe: 'skala', teks: 'Secara keseluruhan saya puas dengan pembelajaran ini', wajib: true }, { tipe: 'skala', teks: 'Materi relevan dengan tujuan pembelajaran', wajib: true }, { tipe: 'skala', teks: 'Tingkat kesulitan sesuai kemampuan saya', wajib: true }, { tipe: 'pilihan', teks: 'Media yang paling membantu', opsi: ['Video', 'Modul PDF', 'Kuis', 'Diskusi', 'Kelas virtual'], wajib: false }, { tipe: 'teks', teks: 'Saran perbaikan', wajib: false }],
      pengajaran: [{ tipe: 'skala', teks: 'Guru menjelaskan materi dengan jelas', wajib: true }, { tipe: 'skala', teks: 'Guru memberi kesempatan bertanya', wajib: true }, { tipe: 'skala', teks: 'Umpan balik tugas bermanfaat', wajib: true }, { tipe: 'skala', teks: 'Penilaian adil & transparan', wajib: true }, { tipe: 'pilihanganda', teks: 'Hal yang perlu ditingkatkan', opsi: ['Kecepatan menjelaskan', 'Contoh soal', 'Interaksi', 'Media pembelajaran'], wajib: false }, { tipe: 'teks', teks: 'Pesan untuk guru', wajib: false }]
    };
    function draw() { $('#fuQ', w).innerHTML = q.map(function (x, i) { return '<div class="ub-ed" data-i="' + i + '"><div class="row gap8"><span class="xs b muted">' + (i + 1) + '.</span><select class="sel" data-f="tipe" style="max-width:170px">' + selOpts([['skala', 'Skala 1–5'], ['pilihan', 'Pilihan tunggal'], ['pilihanganda', 'Pilihan ganda'], ['teks', 'Jawaban teks']], x.tipe) + '</select><input class="inp grow" data-f="teks" value="' + esc(x.teks) + '" placeholder="Pertanyaan"><label class="chk xs"><input type="checkbox" data-f="wajib"' + (x.wajib ? ' checked' : '') + '>wajib</label><button class="btn-ic" data-del type="button">' + ic('x') + '</button></div>' + (/pilihan/.test(x.tipe) ? '<input class="inp mt8" data-f="opsi" value="' + esc((x.opsi || []).join('; ')) + '" placeholder="Pilihan dipisah titik koma: A; B; C">' : '') + '</div>'; }).join('') || '<div class="muted small">Belum ada pertanyaan. Pakai templat atau tambah manual.</div>'; }
    function sinkron() { $$('.ub-ed', w).forEach(function (el) { var x = q[Number(el.dataset.i)]; x.tipe = $('[data-f=tipe]', el).value; x.teks = $('[data-f=teks]', el).value; x.wajib = $('[data-f=wajib]', el).checked; var o = $('[data-f=opsi]', el); if (o) x.opsi = o.value.split(';').map(function (s) { return s.trim(); }).filter(String); }); }
    w.innerHTML = '<div class="row wrap gap8"><span class="xs b muted">TEMPLAT:</span><button class="btn btn-soft btn-xs" type="button" data-tpl="kepuasan">Survei kepuasan</button><button class="btn btn-soft btn-xs" type="button" data-tpl="pengajaran">Evaluasi pengajaran</button></div>' +
      '<div class="field mt12"><label>Pengantar</label><textarea class="inp" id="fuPg" rows="2">' + esc(k.pengantar || '') + '</textarea></div><div id="fuQ" class="mt12"></div><button class="btn btn-ghost btn-sm mt8" type="button" id="fuAdd">' + ic('plus') + 'Pertanyaan</button>' +
      '<div class="mt12"><label class="chk"><input type="checkbox" id="fuA"' + (k.anonim ? ' checked' : '') + '> Anonim (nama responden tidak disimpan)</label><label class="chk"><input type="checkbox" id="fuH"' + (k.tampil_hasil ? ' checked' : '') + '> Tampilkan rekap hasil ke siswa setelah mengisi</label></div>';
    draw();
    w.addEventListener('click', function (e) {
      var t = e.target.closest('[data-tpl]'); if (t) { sinkron(); q = q.concat(JSON.parse(JSON.stringify(TEMPLAT[t.dataset.tpl]))); draw(); }
      if (e.target.closest('#fuAdd')) { sinkron(); q.push({ tipe: 'skala', teks: '', wajib: false }); draw(); }
      var del = e.target.closest('[data-del]'); if (del) { sinkron(); q.splice(Number(del.closest('.ub-ed').dataset.i), 1); draw(); }
    });
    w.addEventListener('change', function (e) { if (e.target.dataset.f === 'tipe') { sinkron(); draw(); } });
    return { baca: function () { sinkron(); return { konten: { pertanyaan: q.map(function (x, i) { return Object.assign({ id: x.id || 'Q' + (i + 1) }, x); }), anonim: $('#fuA', w).checked, tampil_hasil: $('#fuH', w).checked, pengantar: $('#fuPg', w).value } }; } };
  },
  kelasvirtual: function (w, k, c) {
    var siap = c.op.platform || {};
    w.innerHTML = '<div class="grid-form"><div class="field c6"><label>Platform</label><select class="sel" id="fvP">' + selOpts([['meet', 'Google Meet'], ['zoom', 'Zoom' + (siap.zoom ? ' ✓ terhubung' : '')], ['bbb', 'BigBlueButton' + (siap.bbb ? ' ✓ terhubung' : '')], ['teams', 'Microsoft Teams (tautan)'], ['lain', 'Lainnya (tautan)']], k.platform) + '</select></div>' +
      '<div class="field c6"><label>Mulai</label><input class="inp" type="datetime-local" id="fvM" value="' + esc(k.mulai || '') + '"></div><div class="field c4"><label>Durasi (menit)</label><input class="inp" type="number" min="5" id="fvD" value="' + esc(k.durasi || 60) + '"></div>' +
      '<div class="field c8" id="fvLw"><label>Tautan rapat</label><input class="inp" id="fvL" value="' + esc(k.link || '') + '" placeholder="https://meet.google.com/… / https://zoom.us/j/… / https://teams.microsoft.com/…"></div>' +
      '<div class="field c12" id="fvOw"><label class="chk"><input type="checkbox" id="fvO"> Buat rapat otomatis</label><div class="hint" id="fvHint"></div></div>' +
      '<div class="field c6"><label>Rekaman (opsional)</label><input class="inp" id="fvR" value="' + esc(k.rekaman || '') + '" placeholder="https://…"></div><div class="field c6"><label>Kode sandi rapat (opsional)</label><input class="inp" id="fvS" value="' + esc(k.kata_sandi || '') + '"></div><div class="field c12"><label>Catatan</label><input class="inp" id="fvC" value="' + esc(k.catatan || '') + '"></div></div>';
    function upd() {
      var p = $('#fvP', w).value, auto = p === 'meet' || (p === 'zoom' && siap.zoom) || (p === 'bbb' && siap.bbb);
      $('#fvOw', w).hidden = !(p === 'meet' || p === 'zoom' || p === 'bbb');
      $('#fvO', w).disabled = !auto;
      $('#fvHint', w).textContent = p === 'meet' ? 'Google Meet dibuat di Kalender akun pemilik Apps Script (butuh izin kalender saat setupV30).' : p === 'zoom' ? (siap.zoom ? 'Rapat Zoom dibuat via Server-to-Server OAuth.' : 'Hubungkan Zoom di menu Keamanan (Super Admin) untuk membuat otomatis.') : p === 'bbb' ? (siap.bbb ? 'Ruang BBB dibuat & tautan masuk ditandatangani otomatis.' : 'Isi URL & secret BBB di menu Keamanan.') : '';
      $('#fvLw', w).hidden = p === 'bbb';
      if (p === 'bbb' && siap.bbb) $('#fvO', w).checked = true;
    }
    $('#fvP', w).onchange = upd; upd();
    return { baca: function () { return { konten: { platform: $('#fvP', w).value, mulai: $('#fvM', w).value, durasi: Number($('#fvD', w).value), link: $('#fvL', w).value.trim(), rekaman: $('#fvR', w).value.trim(), kata_sandi: $('#fvS', w).value, catatan: $('#fvC', w).value }, extra: $('#fvO', w).checked ? { buatOtomatis: true } : {} }; } };
  }
};
var SOAL_LBL = { pg: 'Pilihan ganda', pgk: 'PG kompleks', bs: 'Benar/Salah', cocok: 'Mencocokkan', singkat: 'Jawaban singkat', esai: 'Esai', dragdrop: 'Seret & lepas' };
/** Textarea markdown + pratinjau */
function formTeksMd(w, nilai, label, baris, bungkus) {
  var id = 'md' + Math.random().toString(36).slice(2, 8);
  w.innerHTML = (w.innerHTML || '') + '<div class="field"><div class="row"><label class="grow" for="' + id + '">' + esc(label) + '</label><button type="button" class="btn btn-ghost btn-xs" data-prev="' + id + '">' + ic('eye') + 'Pratinjau</button></div><textarea class="inp mono-ish" id="' + id + '" rows="' + baris + '">' + esc(nilai || '') + '</textarea><div class="md-prev card card-p" id="' + id + 'p" hidden></div><div class="hint">Format: # Judul, **tebal**, *miring*, - daftar, 1. bernomor, [teks](https://tautan)</div></div>';
  $('[data-prev="' + id + '"]', w).onclick = function () { var p = $('#' + id + 'p', w), t = $('#' + id, w); p.hidden = !p.hidden; t.hidden = !p.hidden ? true : false; if (!p.hidden) p.innerHTML = md(t.value); this.innerHTML = ic(p.hidden ? 'eye' : 'pencil') + (p.hidden ? 'Pratinjau' : 'Ubah'); };
  return { baca: function () { return { konten: bungkus($('#' + id, w).value) }; } };
}
