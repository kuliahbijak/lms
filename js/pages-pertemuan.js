/* =====================================================================
   SIAKAD SISWA v3.2 — pages-pertemuan.js
   Mapel & Pertemuan (guru/Super Admin) · Mata Pelajaran (siswa) · detail pertemuan
   (jurnal, absensi siswa & guru, materi & tugas) · Jurnal Mengajar (+ unduh PDF/Excel)
   ===================================================================== */
'use strict';

var PTM_STATUS = { H: 'Hadir', I: 'Izin', S: 'Sakit', A: 'Alpha' };
var PTM_GURU_ST = ['Hadir', 'Digantikan', 'Izin', 'Sakit', 'Dinas Luar', 'Kosong'];
function ptmRekapHtml(r, kecil) {
  r = r || {}; if (!r.n) return '<span class="xs muted">Absensi belum diisi</span>';
  return '<span class="rk-chips' + (kecil ? ' kecil' : '') + '"><span class="rk H" title="Hadir">H ' + (r.H || 0) + '</span><span class="rk I" title="Izin">I ' + (r.I || 0) + '</span><span class="rk S" title="Sakit">S ' + (r.S || 0) + '</span><span class="rk A" title="Alpha">A ' + (r.A || 0) + '</span></span>';
}
function ptmStatusBdg(st) { return st === 'terlaksana' ? '<span class="bdg ok">' + ic('circle-check') + 'Terlaksana</span>' : '<span class="bdg">' + ic('calendar-clock') + 'Rencana</span>'; }
function ptmJam(p) { return (p.jam_ke ? 'Jam ke-' + esc(p.jam_ke) : '') + (p.jam_mulai ? (p.jam_ke ? ' • ' : '') + esc(jam5(p.jam_mulai)) + (p.jam_selesai ? '–' + esc(jam5(p.jam_selesai)) : '') : ''); }
function ptmKartuMapel(p, siswa) {
  var w = mapelWarna(p.mata_pelajaran), kode = kodeMapelPtm(p.kelas_id, p.mata_pelajaran);
  var sub = siswa ? (p.guru || '-') : esc(p.nama_kelas) + (p.guru ? ' • ' + esc(p.guru) : '');
  return '<a class="card mp-card" href="#/' + (siswa ? 'mapel' : 'pertemuan') + '/' + encodeURIComponent(kode) + '" style="--mp:' + esc(w) + '"><div class="mp-strip"></div>' +
    '<div class="mp-b"><div class="row between gap8"><div class="grow" style="min-width:0"><b class="mp-t clamp2">' + esc(p.mata_pelajaran) + '</b><small class="ellipsis">' + (siswa ? esc(sub) : sub) + '</small></div>' +
    '<div class="mp-pct" title="Terlaksana">' + p.persen + '<small>%</small></div></div>' + persenBar(p.persen, p.persen >= 100 ? 'ok' : '') +
    '<div class="row between mt8 xs"><span><b>' + p.terlaksana + '</b> / ' + p.target + ' pertemuan</span><span class="muted">' + (p.terakhir ? 'Terakhir ' + esc(tglIndo(p.terakhir, true)) : 'Belum dimulai') + '</span></div>' +
    (siswa && p.hadir_saya && p.terlaksana ? '<div class="xs mt8 muted">' + ic('user-check') + ' Kehadiran saya: <b>' + (p.hadir_saya.H || 0) + '</b> dari ' + p.terlaksana + ' pertemuan' + (p.hadir_saya.A ? ' • <span class="red">Alpha ' + p.hadir_saya.A + '</span>' : '') + '</div>' : '') +
    (!siswa && p.rencana ? '<div class="xs mt8"><span class="bdg info">' + ic('calendar-clock') + p.rencana + ' rencana</span></div>' : '') + '</div></a>';
}

// =====================================================================
// HALAMAN DAFTAR MAPEL + DAFTAR PERTEMUAN (guru & siswa memakai pabrik yang sama)
// =====================================================================
function halamanMapel(peran) {
  var siswa = peran === 'siswa';
  return {
    title: siswa ? 'Mata Pelajaran' : 'Mapel & Pertemuan', alwaysRender: true,
    st: { mode: 'saya', kelas: '', q: '' },
    init: function (el) { el.innerHTML = '<div id="mpBox"></div>'; },
    render: function (el, param) {
      var kode = bacaKodeMapel(param);
      if (kode) return this.detail(el, kode);
      return this.daftar(el);
    },
    // ------------------------------------------------ daftar mapel
    daftar: function (el) {
      var self = this, st = this.st, box = $('#mpBox', el);
      box.innerHTML = pageHead(siswa ? 'Portal Siswa <span>/ Mata Pelajaran</span>' : (isSA() ? 'Super Admin' : 'Panel Guru') + ' <span>// Kurikulum & Pembelajaran</span>', siswa ? 'Mata Pelajaran' : 'Mapel & Pertemuan',
        siswa ? 'Lihat pertemuan setiap mata pelajaran beserta materi, tugas, dan kehadiranmu.' : 'Target pertemuan, persentase keterlaksanaan, jurnal mengajar, materi, tugas, serta absensi siswa & guru di setiap pertemuan.',
        siswa ? '' : '<a class="btn btn-outline" href="#/jurnal">' + ic('notebook-pen') + 'Jurnal Mengajar</a>' + (isSA() ? '<button class="btn btn-dark" id="mpTarget">' + ic('target') + 'Atur Target Mapel</button>' : '')) +
        (siswa ? '' : '<div class="card"><div class="toolbar"><div class="seg plain" id="mpMode"><button data-m="saya" class="' + (st.mode === 'saya' ? 'on' : '') + '">' + ic('user-round') + 'Mapel saya</button><button data-m="semua" class="' + (st.mode === 'semua' ? 'on' : '') + '">' + ic('school') + 'Semua kelas</button></div>' +
          '<div class="field" id="mpKelasF"' + (st.mode === 'semua' ? '' : ' hidden') + '><select class="sel" id="mpKelas">' + kelasOpts(st.kelas, 'Semua kelas') + '</select></div>' +
          '<div class="field search"><div class="inp-ic">' + ic('search') + '<input class="inp" id="mpQ" placeholder="Cari mapel, kelas, atau guru…" value="' + esc(st.q) + '"></div></div></div></div>') +
        '<div id="mpKpi" class="grid g4 mt16"></div><div id="mpGrid" class="mp-grid mt16"><div class="sk" style="height:160px"></div><div class="sk" style="height:160px"></div><div class="sk" style="height:160px"></div></div>';
      if (!siswa) {
        $$('#mpMode button', box).forEach(function (b) { b.onclick = function () { st.mode = b.dataset.m; self.daftar(el); }; });
        $('#mpKelas', box).onchange = function () { st.kelas = this.value; self.muatDaftar(el); };
        $('#mpQ', box).oninput = debounce(function () { st.q = this.value; self.gambarDaftar(el); }, 200);
        if ($('#mpTarget', box)) $('#mpTarget', box).onclick = function () { targetMapelModal(); };
      }
      this.muatDaftar(el);
    },
    muatDaftar: function (el) {
      var self = this, st = this.st, data = siswa ? {} : st.mode === 'semua' ? (st.kelas ? { kelas_id: st.kelas } : { semua: true }) : {};
      apiLR('ptm.ringkas', data, function (r) {
        if (!$('#mpGrid', el)) return;
        if (!r.success) { $('#mpGrid', el).innerHTML = errorBox(pesanV32(r.message)); return; }
        self.d = r.data; self.gambarDaftar(el);
      });
    },
    gambarDaftar: function (el) {
      var d = this.d, st = this.st; if (!d || !$('#mpGrid', el)) return;
      var q = (st.q || '').toLowerCase(), list = d.pasangan.filter(function (p) { return !q || (p.mata_pelajaran + ' ' + p.nama_kelas + ' ' + p.guru).toLowerCase().indexOf(q) > -1; });
      var t = 0, tgt = 0, ren = 0; d.pasangan.forEach(function (p) { t += p.terlaksana; tgt += p.target; ren += p.rencana; });
      var rata = d.pasangan.length ? Math.round(d.pasangan.reduce(function (a, p) { return a + p.persen; }, 0) / d.pasangan.length) : 0;
      $('#mpKpi', el).innerHTML = siswa ?
        kpiS('Mata Pelajaran', d.pasangan.length, 'Semester ' + esc(d.periode.sem) + ' ' + esc(d.periode.ta), 'notebook-tabs') + kpiS('Pertemuan Terlaksana', t, 'dari target ' + tgt + ' pertemuan', 'calendar-check-2') +
        kpiS('Rata-rata Keterlaksanaan', rata + '%', 'seluruh mata pelajaran', 'chart-no-axes-column') + kpiS('Kehadiran Saya', (function () { var h = 0, n = 0; d.pasangan.forEach(function (p) { if (p.hadir_saya) { h += p.hadir_saya.H || 0; n += p.terlaksana; } }); return n ? Math.round(h / n * 100) + '%' : '-'; })(), 'di pertemuan yang terlaksana', 'user-check') :
        kpi(st.mode === 'saya' ? 'Mapel Diampu' : 'Pasangan Kelas–Mapel', fmtN(d.pasangan.length), 'Semester ' + esc(d.periode.sem) + ' ' + esc(d.periode.ta), 'notebook-tabs') + kpi('Pertemuan Terlaksana', fmtN(t), 'dari target ' + fmtN(tgt), 'calendar-check-2') +
        kpi('Rata-rata Keterlaksanaan', rata + '%', ic('target') + ' Target bawaan ' + d.bawaan + ' pertemuan', 'chart-no-axes-column') + kpi('Rencana Pertemuan', fmtN(ren), 'belum ditandai terlaksana', 'calendar-clock');
      $('#mpGrid', el).innerHTML = list.length ? list.map(function (p) { return ptmKartuMapel(p, siswa); }).join('') :
        '<div class="card" style="grid-column:1/-1">' + emptyHtml(siswa ? 'Belum ada mata pelajaran' : st.mode === 'saya' ? 'Belum ada mapel yang Anda ampu' : 'Tidak ada data', siswa ? 'Jadwal kelasmu belum diatur sekolah.' : st.mode === 'saya' ? 'Mapel diambil dari Jadwal Pelajaran (guru pengampu). Pilih "Semua kelas" untuk mengisi sebagai guru pengganti.' : 'Coba kata kunci lain.', 'notebook-tabs') + '</div>';
    },
    // ------------------------------------------------ daftar pertemuan satu mapel
    detail: function (el, kode) {
      var self = this, box = $('#mpBox', el);
      box.innerHTML = '<a href="#/' + (siswa ? 'mapel' : 'pertemuan') + '" class="small b back-link">' + ic('arrow-left') + ' SEMUA MATA PELAJARAN</a><div id="mpHead" class="mt12"><div class="sk" style="height:150px"></div></div><div id="mpList" class="mt16"></div>';
      apiLR('ptm.list', kode, function (r) {
        if (!$('#mpHead', el)) return;
        if (!r.success) { $('#mpHead', el).innerHTML = errorBox(pesanV32(r.message)); return; }
        self.gambarDetail(el, r.data);
      });
    },
    gambarDetail: function (el, d) {
      var p = d.pasangan, w = mapelWarna(p.mata_pelajaran), kode = kodeMapelPtm(p.kelas_id, p.mata_pelajaran);
      var sumber = { kelas: 'khusus kelas ini', mapel: 'berlaku semua kelas', bawaan: 'target bawaan sekolah' }[p.target_sumber] || '';
      $('#mpHead', el).innerHTML = '<div class="card mp-head" style="--mp:' + esc(w) + '"><div class="mp-strip"></div><div class="card-b"><div class="row between wrap gap16">' +
        '<div class="grow" style="min-width:220px"><div class="eyebrow">' + esc(p.nama_kelas) + ' • Semester ' + esc(d.periode.sem) + ' ' + esc(d.periode.ta) + '</div><h1 class="mp-h1">' + esc(p.mata_pelajaran) + '</h1>' +
        '<div class="small muted mt4">' + ic('user-round') + ' ' + esc(p.guru || 'Guru belum diatur di jadwal') + '</div>' +
        (p.jadwal.length ? '<div class="row wrap gap4 mt8">' + p.jadwal.map(function (j) { return '<span class="bdg">' + ic('clock') + esc(j.hari) + ' ' + esc(jam5(j.jam_mulai)) + '–' + esc(jam5(j.jam_selesai)) + (j.ruang ? ' • ' + esc(j.ruang) : '') + '</span>'; }).join('') + '</div>' : '') + '</div>' +
        '<div class="mp-prog"><div class="mp-pct besar">' + p.persen + '<small>%</small></div><div class="small"><b>' + p.terlaksana + '</b> dari <b>' + p.target + '</b> pertemuan terlaksana</div>' + persenBar(p.persen, p.persen >= 100 ? 'ok' : '') +
        '<div class="xs muted mt4">' + ic('target') + ' Target ' + p.target + ' (' + sumber + ')' + (d.bolehAturTarget ? ' • <a href="#" id="mpUbahTarget">ubah</a>' : '') + (p.rencana ? ' • ' + p.rencana + ' rencana' : '') + '</div></div></div>' +
        (d.bolehTambah ? '<div class="row wrap gap8 mt16"><a class="btn btn-dark" href="#/ptm/' + encodeURIComponent('baru~' + kode) + '" id="mpBaru">' + ic('plus') + 'Pertemuan Baru</a><a class="btn btn-outline" href="#/jurnal">' + ic('notebook-pen') + 'Jurnal Mengajar</a></div>' : '') + '</div></div>';
      if ($('#mpUbahTarget', el)) $('#mpUbahTarget', el).onclick = function (e) { e.preventDefault(); targetKelasModal(p, d, function () { markAllDirty(true); }); };
      var list = d.pertemuan.slice().sort(function (a, b) { return b.ke - a.ke; });
      $('#mpList', el).innerHTML = list.length ? '<div class="card"><div class="card-h"><div class="grow"><h3>' + ic('list-ordered') + ' Daftar Pertemuan</h3><p>' + (siswa ? 'Klik pertemuan untuk melihat materi, tugas, dan kehadiranmu' : 'Klik pertemuan untuk mengisi jurnal, absensi, materi & tugas') + '</p></div></div><div class="ptm-list">' +
        list.map(function (x) {
          return '<a class="ptm-i ' + (x.status === 'terlaksana' ? 'ok' : 'renc') + '" href="#/ptm/' + encodeURIComponent(x.pertemuan_id) + '"><span class="ptm-no">' + x.ke + '</span><div class="grow" style="min-width:0">' +
            '<div class="xs muted">' + esc(hariTgl(x.tanggal)) + (ptmJam(x) ? ' • ' + ptmJam(x) : '') + '</div><b class="clamp2">' + esc(x.materi_pokok || 'Materi belum diisi') + '</b>' +
            (x.tujuan ? '<div class="small muted clamp2">' + esc(x.tujuan) + '</div>' : '') +
            '<div class="row wrap gap4 mt4">' + (x.n_materi ? '<span class="bdg">' + ic('book-open') + x.n_materi + ' materi</span>' : '') + (x.n_tugas ? '<span class="bdg">' + ic('clipboard-pen-line') + x.n_tugas + ' tugas</span>' : '') +
            (siswa ? (x.hadir_saya ? statusBadge(x.hadir_saya) : '') : (x.status === 'terlaksana' ? ptmRekapHtml(x.rekap, true) : '')) +
            (!siswa && x.guru_hadir && x.guru_hadir !== 'Hadir' ? '<span class="bdg warn">' + ic('user-round-x') + esc(x.guru_hadir) + (x.guru_pengganti ? ': ' + esc(x.guru_pengganti) : '') + '</span>' : '') + '</div></div>' +
            '<div class="ptm-st">' + ptmStatusBdg(x.status) + '</div></a>';
        }).join('') + '</div></div>' :
        '<div class="card">' + emptyHtml('Belum ada pertemuan', siswa ? 'Pertemuan akan tampil setelah guru mengisi jurnal.' : 'Klik "Pertemuan Baru" untuk mencatat pertemuan pertama.', 'calendar-plus') + '</div>';
    }
  };
}
registerPage('guru', 'pertemuan', halamanMapel('guru'));
registerPage('siswa', 'mapel', halamanMapel('siswa'));

/** Target mapel untuk semua kelas (Super Admin) */
function targetMapelModal() {
  var mapel = (B().mapel || []).map(function (m) { return m.nama; });
  var m = modal({ title: 'Atur Target Pertemuan', sub: 'Jumlah pertemuan per semester untuk setiap mata pelajaran (berlaku semua kelas)', size: 'md',
    body: '<div class="note mb12">' + ic('info') + '<div>Kosongkan untuk memakai target bawaan sekolah (' + esc(cfg('TARGET_PERTEMUAN', 16)) + '). Target khusus satu kelas diatur dari halaman mapel kelas tersebut.</div></div><div class="tgt-list" id="tgList"><div class="sk" style="height:200px"></div></div>',
    foot: '<button class="btn btn-outline" data-x>Tutup</button>' });
  api('ptm.ringkas', { semua: true }).then(function (r) {
    var per = {}; if (r.success) r.data.pasangan.forEach(function (p) { if (p.target_sumber === 'mapel') per[p.mata_pelajaran.toLowerCase()] = p.target; });
    $('#tgList', m.el).innerHTML = mapel.map(function (n) { return '<div class="row between gap8 tgt-i"><b class="grow">' + esc(n) + '</b><input class="inp" type="number" min="1" max="200" style="width:90px" data-tg="' + esc(n) + '" value="' + esc(per[n.toLowerCase()] || '') + '" placeholder="' + esc(cfg('TARGET_PERTEMUAN', 16)) + '"><button class="btn btn-soft btn-sm" data-sv="' + esc(n) + '">' + ic('save') + 'Simpan</button></div>'; }).join('');
    $$('[data-sv]', m.el).forEach(function (b) { b.onclick = async function () { var inp = $('[data-tg="' + CSS.escape(b.dataset.sv) + '"]', m.el); if (!inp.value) return toast('Isi jumlah pertemuan.', 'warn'); btnBusy(b, true); var x = await api('ptm.target.save', { mata_pelajaran: b.dataset.sv, kelas_id: '', jumlah: inp.value }); btnBusy(b, false); if (toastRes(x)) markAllDirty(false); }; });
  });
}
/** Target khusus satu kelas (Super Admin / guru pengampu) */
function targetKelasModal(p, d, cb) {
  var m = modal({ title: 'Target Pertemuan', sub: p.mata_pelajaran + ' • ' + p.nama_kelas, size: 'sm',
    body: '<div class="field"><label>Jumlah pertemuan semester ini</label><input class="inp" type="number" min="1" max="200" id="tkJ" value="' + esc(p.target_sumber === 'kelas' ? p.target : '') + '" placeholder="' + esc(p.target) + '"><div class="hint">Kosongkan lalu simpan untuk kembali ke target ' + (p.target_sumber === 'kelas' ? 'mapel/bawaan' : 'saat ini (' + p.target + ')') + '.</div></div>',
    foot: '<button class="btn btn-outline" data-x>Batal</button><button class="btn btn-primary" id="tkSv">' + ic('save') + 'Simpan</button>' });
  $('#tkSv', m.el).onclick = async function () {
    var v = $('#tkJ', m.el).value.trim(); if (!v && p.target_sumber !== 'kelas') { m.close(); return; }
    btnBusy(this, true); var r = await api('ptm.target.save', { mata_pelajaran: p.mata_pelajaran, kelas_id: p.kelas_id, jumlah: v }); btnBusy(this, false);
    if (toastRes(r)) { m.close(); cb && cb(); }
  };
}

// =====================================================================
// DETAIL / FORMULIR PERTEMUAN
// =====================================================================
function halamanPtm(peran) {
  var siswa = peran === 'siswa';
  return {
    title: 'Pertemuan', alwaysRender: true,
    init: function (el) { el.innerHTML = '<div id="ptBox"></div>'; },
    render: function (el, param) {
      var self = this, box = $('#ptBox', el), baru = /^baru~/.test(param || '');
      box.innerHTML = '<div class="sk" style="height:60px;max-width:420px"></div><div class="sk mt16" style="height:420px"></div>';
      self.kotor = false;
      if (baru) {
        if (siswa) return go('mapel');
        var k = bacaKodeMapel(param.substring(5));
        api('ptm.opsi', k).then(function (r) {
          if (!r.success) { box.innerHTML = errorBox(pesanV32(r.message)); return; }
          var o = r.data;
          self.form(el, { baru: true, kelas_id: o.kelas_id, nama_kelas: o.nama_kelas, mata_pelajaran: o.mata_pelajaran, pertemuan_ke: o.pertemuan_ke, tanggal: o.tanggal, jam_mulai: o.jam_mulai, jam_selesai: o.jam_selesai,
            elemen: o.elemen, capaian: o.capaian, tujuan: '', materi_pokok: '', kegiatan: '', refleksi: '', materi_ids: [], tugas_lms: [], catatan_tugas: '', status: 'rencana',
            guru_id: o.guru_id, guru: o.guru, guru_hadir: o.saya_pengampu ? 'Hadir' : 'Digantikan', guru_pengganti: o.saya_pengampu ? '' : o.nama_saya, siswa: o.siswa, hadirTersimpan: false,
            presensi_guru: o.presensi_guru, opsi: o.opsi, bolehUbah: true });
        });
        return;
      }
      apiLR('ptm.get', { pertemuan_id: param }, function (r) {
        if (!$('#ptBox', el) || (self.kotor && r.cached !== true)) return;
        if (!r.success) { box.innerHTML = errorBox(pesanV32(r.message)); return; }
        if (siswa || !r.data.bolehUbah) self.lihat(el, r.data); else self.form(el, r.data);
      });
    },
    kepala: function (p) {
      var kode = kodeMapelPtm(p.kelas_id, p.mata_pelajaran);
      return '<a href="#/' + (siswa ? 'mapel' : 'pertemuan') + '/' + encodeURIComponent(kode) + '" class="small b back-link">' + ic('arrow-left') + ' ' + esc(String(p.mata_pelajaran).toUpperCase()) + ' • ' + esc(p.nama_kelas) + '</a>' +
        '<div class="ph mt8"><div class="grow"><div class="eyebrow">' + (p.baru ? 'Pertemuan baru' : 'Pertemuan ke-' + p.pertemuan_ke) + ' <span>// ' + esc(p.mata_pelajaran) + '</span></div><h1>' + (p.baru ? 'Pertemuan ke-' + p.pertemuan_ke : esc(p.materi_pokok || 'Pertemuan ke-' + p.pertemuan_ke)) + '</h1>' +
        '<p>' + esc(hariTgl(p.tanggal)) + (ptmJam(p) ? ' • ' + ptmJam(p) : '') + (p.guru ? ' • ' + esc(p.guru) : '') + '</p></div><div class="acts">' + (p.baru ? '' : ptmStatusBdg(p.status)) + '</div></div>';
    },
    // ------------------------------------------------ tampilan baca (siswa / guru tanpa hak ubah)
    lihat: function (el, p) {
      var box = $('#ptBox', el);
      var hs = p.hadir_saya;
      box.innerHTML = this.kepala(p) + '<div class="grid g-main mt16"><div>' +
        (siswa ? '<div class="card card-p ptm-hadir-saya ' + (hs ? 'st-' + hs.status : '') + '">' + ic(hs ? (hs.status === 'Hadir' ? 'circle-check' : hs.status === 'Alpha' ? 'circle-x' : 'circle-alert') : 'circle-help') + '<div><div class="xs b muted">KEHADIRAN SAYA</div><b>' + (hs ? esc(hs.status) : (p.status === 'terlaksana' ? 'Belum tercatat' : 'Pertemuan belum dilaksanakan')) + '</b>' + (hs && hs.keterangan ? '<div class="small">' + esc(hs.keterangan) + '</div>' : '') + '</div></div>' : '') +
        '<div class="card' + (siswa ? ' mt16' : '') + '"><div class="card-h"><h3 class="grow">' + ic('notebook-text') + ' Ringkasan Pembelajaran</h3></div><div class="card-b"><dl class="kv-list jurnal-kv">' +
        (p.elemen ? '<dt>Elemen</dt><dd>' + esc(p.elemen) + '</dd>' : '') + (p.capaian ? '<dt>Capaian Pembelajaran</dt><dd>' + esc(p.capaian) + '</dd>' : '') + (p.tujuan ? '<dt>Tujuan Pembelajaran</dt><dd>' + esc(p.tujuan) + '</dd>' : '') +
        '<dt>Materi / Pokok Bahasan</dt><dd>' + esc(p.materi_pokok || '-') + '</dd>' + (p.kegiatan ? '<dt>Kegiatan</dt><dd class="pre">' + esc(p.kegiatan) + '</dd>' : '') +
        (!siswa && p.refleksi ? '<dt>Refleksi / Kendala</dt><dd class="pre">' + esc(p.refleksi) + '</dd>' : '') + (!siswa && p.rekap ? '<dt>Kehadiran Siswa</dt><dd>' + ptmRekapHtml(p.rekap) + '</dd>' : '') + '</dl></div></div></div>' +
        '<div>' + this.materiTugasBaca(p) + '</div></div>';
      this.ikatMateri(box);
    },
    materiTugasBaca: function (p) {
      return '<div class="card"><div class="card-h"><h3 class="grow">' + ic('book-open') + ' Materi</h3></div><div class="card-b">' + (p.materi.length ? p.materi.map(function (m) {
        return '<button type="button" class="ptm-res" data-mtr="' + esc(m.materi_id) + '"><span class="ic-box">' + ic(m.tipe === 'video' ? 'circle-play' : 'file-text') + '</span><div class="grow"><b class="clamp2">' + esc(m.judul) + '</b><small>' + (m.tipe === 'video' ? 'Video' : 'Dokumen') + ' • klik untuk membuka</small></div>' + ic('chevron-right') + '</button>'; }).join('') : '<div class="xs muted">Belum ada materi untuk pertemuan ini.</div>') + '</div></div>' +
        '<div class="card mt16"><div class="card-h"><h3 class="grow">' + ic('clipboard-pen-line') + ' Tugas</h3></div><div class="card-b">' + (p.tugas.length ? p.tugas.map(function (t) {
          return '<a class="ptm-res" href="#/aktivitas/' + encodeURIComponent(t.modul_id) + '"><span class="ic-box amber">' + ic(t.tipe === 'kuis' ? 'list-checks' : 'clipboard-pen-line') + '</span><div class="grow"><b class="clamp2">' + esc(t.judul) + '</b><small>' + esc(t.tipe_label) + ' • ' + esc(t.kursus) + (t.tutup ? ' • tenggat ' + esc(tglIndo(t.tutup, true)) : '') + '</small></div>' + ic('chevron-right') + '</a>'; }).join('') : '') +
        (p.catatan_tugas ? '<div class="note mt8">' + ic('pencil-line') + '<div><b>Catatan tugas / PR</b><div class="pre">' + esc(p.catatan_tugas) + '</div></div></div>' : '') + (!p.tugas.length && !p.catatan_tugas ? '<div class="xs muted">Tidak ada tugas.</div>' : '') + '</div></div>';
    },
    ikatMateri: function (box) {
      $$('[data-mtr]', box).forEach(function (b) { b.onclick = function () {
        var id = b.dataset.mtr, ada = (AppState.boot && AppState.boot.materi || []).some(function (m) { return m.materi_id === id; });
        if (ada) bukaMateri(id); else toast('Materi ini tidak tersedia untuk akun Anda.', 'warn');
      }; });
    },
    // ------------------------------------------------ formulir guru
    form: function (el, p) {
      var self = this, box = $('#ptBox', el), st = { tab: self._tab || 'jurnal', siswa: (p.siswa || []).map(function (s) { return Object.assign({}, s); }), materi: (p.materi_ids || []).slice(), tugas: (p.tugas_lms || []).slice() };
      self.p = p; self.st = st;
      var opsi = p.opsi || { materi: [], aktivitas: [] };
      var hadirInfo = p.hadirTersimpan ? 'Absensi pertemuan ini sudah tersimpan.' : (st.siswa.some(function (s) { return s.sumber === 'harian'; }) ? 'Terisi otomatis dari absensi harian (scan QR) tanggal ' + tglIndo(p.tanggal) + '. Periksa, ubah bila perlu, lalu simpan.' : (st.siswa.some(function (s) { return s.sumber === 'tanpa-catatan'; }) ? 'Terisi dari absensi harian — siswa tanpa catatan ditandai Alpha.' : 'Belum ada absensi harian tanggal ini — semua siswa ditandai Hadir. Ubah yang tidak hadir.'));
      box.innerHTML = this.kepala(p) +
        '<div class="tabs mt16" id="ptTabs"><button data-t="jurnal">' + ic('notebook-pen') + 'Jurnal</button><button data-t="absensi">' + ic('users') + 'Absensi Siswa <span class="bdg" id="ptNAbs"></span></button><button data-t="materi">' + ic('book-open') + 'Materi & Tugas <span class="bdg" id="ptNMt"></span></button></div>' +
        '<form id="ptF" novalidate>' +
        // ---- JURNAL
        '<div class="card mt16" data-tp="jurnal"><div class="card-b"><div class="grid-form">' +
        '<div class="field c2"><label>Pertemuan ke</label><input class="inp" type="number" min="1" max="300" name="pertemuan_ke" value="' + esc(p.pertemuan_ke) + '"></div>' +
        '<div class="field c4"><label>Hari & tanggal <span class="req">*</span></label><input class="inp" type="date" name="tanggal" value="' + esc(p.tanggal) + '" required><div class="hint" id="ptHari">' + esc(hariTgl(p.tanggal)) + '</div></div>' +
        '<div class="field c2"><label>Jam ke</label><input class="inp" name="jam_ke" value="' + esc(p.jam_ke || '') + '" placeholder="1–2" maxlength="20"></div>' +
        '<div class="field c2"><label>Mulai</label><input class="inp" type="time" name="jam_mulai" value="' + esc(jam5(p.jam_mulai)) + '"></div><div class="field c2"><label>Selesai</label><input class="inp" type="time" name="jam_selesai" value="' + esc(jam5(p.jam_selesai)) + '"></div>' +
        '<div class="field c12"><label>Elemen</label><input class="inp" name="elemen" value="' + esc(p.elemen || '') + '" placeholder="Contoh: Pemahaman Biologi" maxlength="500"></div>' +
        '<div class="field c6"><label>Capaian Pembelajaran (CP)</label><textarea class="inp" name="capaian" rows="3" maxlength="1500" placeholder="Capaian pembelajaran fase/kelas">' + esc(p.capaian || '') + '</textarea></div>' +
        '<div class="field c6"><label>Tujuan Pembelajaran (TP)</label><textarea class="inp" name="tujuan" rows="3" maxlength="1500" placeholder="Siswa mampu …">' + esc(p.tujuan || '') + '</textarea></div>' +
        '<div class="field c12"><label>Materi / Pokok Bahasan <span class="req">*</span></label><input class="inp" name="materi_pokok" value="' + esc(p.materi_pokok || '') + '" maxlength="500" placeholder="Contoh: Komponen darah dan fungsinya"></div>' +
        '<div class="field c12"><label>Ringkasan Kegiatan Pembelajaran <span class="req">*</span></label><textarea class="inp" name="kegiatan" rows="4" maxlength="3000" placeholder="Pendahuluan, kegiatan inti, penutup…">' + esc(p.kegiatan || '') + '</textarea></div>' +
        '<div class="field c12"><label>Rekap Kehadiran Siswa</label><div class="rk-box" id="ptRekap"></div></div>' +
        '<div class="field c12"><label>Catatan Refleksi / Kejadian Khusus / Kendala</label><textarea class="inp" name="refleksi" rows="3" maxlength="3000" placeholder="Tidak terlihat oleh siswa">' + esc(p.refleksi || '') + '</textarea></div>' +
        '</div></div><div class="card-b bt"><div class="xs b muted">KEHADIRAN GURU</div><div class="grid-form mt8">' +
        '<div class="field c4"><label>Status guru pengampu</label><select class="sel" name="guru_hadir">' + PTM_GURU_ST.map(function (s) { return '<option' + (s === (p.guru_hadir || 'Hadir') ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select></div>' +
        '<div class="field c4" id="ptPengF"><label>Guru pengganti</label><input class="inp" name="guru_pengganti" value="' + esc(p.guru_pengganti || '') + '" maxlength="80" placeholder="Nama guru pengganti"></div>' +
        '<div class="field c4"><label>Tercatat</label><div class="inp ro">' + (p.guru_jam ? ic('clock') + ' Mengajar pukul ' + esc(p.guru_jam) : '<span class="muted">Otomatis saat ditandai terlaksana</span>') + '</div></div>' +
        '<div class="field c12 xs muted">' + ic('user-round') + ' Pengampu: <b>' + esc(p.guru || '-') + '</b>' + (p.presensi_guru ? ' • Presensi harian: masuk ' + esc(p.presensi_guru.jam_masuk || '-') + (p.presensi_guru.jam_pulang ? ', pulang ' + esc(p.presensi_guru.jam_pulang) : '') : ' • Presensi harian guru belum tercatat pada tanggal ini') + '</div></div></div></div>' +
        // ---- ABSENSI
        '<div class="card mt16" data-tp="absensi" hidden><div class="card-h"><div class="grow"><h3>' + ic('users') + ' Absensi Siswa — ' + esc(p.nama_kelas) + '</h3><p id="ptAbsInfo">' + esc(hadirInfo) + '</p></div><button type="button" class="btn btn-soft btn-sm" id="ptSemuaH">' + ic('check-check') + 'Semua Hadir</button></div>' +
        '<div class="card-b"><div class="rk-box mb12" id="ptRekap2"></div><div class="abs-list" id="ptAbs"></div></div></div>' +
        // ---- MATERI & TUGAS
        '<div class="card mt16" data-tp="materi" hidden><div class="card-h"><div class="grow"><h3>' + ic('book-open') + ' Materi</h3><p>Pilih materi dari menu Materi (' + esc(p.mata_pelajaran) + ')</p></div><a class="btn btn-ghost btn-sm" href="#/materi">' + ic('upload') + 'Unggah materi baru</a></div><div class="card-b pilih-list" id="ptMtr">' +
        (opsi.materi.length ? opsi.materi.map(function (m) { return '<label class="pilih-i"><input type="checkbox" value="' + esc(m.materi_id) + '"' + (st.materi.indexOf(m.materi_id) > -1 ? ' checked' : '') + '><span class="ic-box">' + ic(m.tipe === 'video' ? 'circle-play' : 'file-text') + '</span><span class="grow"><b class="clamp2">' + esc(m.judul) + '</b><small>' + (m.tipe === 'video' ? 'Video' : 'Dokumen') + (m.tanggal ? ' • ' + esc(tglIndo(m.tanggal, true)) : '') + '</small></span></label>'; }).join('') : '<div class="xs muted">Belum ada materi ' + esc(p.mata_pelajaran) + ' untuk kelas ini di menu Materi.</div>') + '</div>' +
        '<div class="card-h bt"><div class="grow"><h3>' + ic('clipboard-pen-line') + ' Tugas dari Kursus (LMS)</h3><p>Siswa mengerjakan & mengumpulkan di kursus</p></div><a class="btn btn-ghost btn-sm" href="#/kursus">' + ic('graduation-cap') + 'Buka Kursus</a></div><div class="card-b pilih-list" id="ptTgs">' +
        (opsi.aktivitas.length ? opsi.aktivitas.map(function (a) { return '<label class="pilih-i"><input type="checkbox" value="' + esc(a.modul_id) + '"' + (st.tugas.indexOf(a.modul_id) > -1 ? ' checked' : '') + '><span class="ic-box amber">' + ic(a.tipe === 'kuis' ? 'list-checks' : a.tipe === 'forum' ? 'messages-square' : 'clipboard-pen-line') + '</span><span class="grow"><b class="clamp2">' + esc(a.judul) + '</b><small>' + esc(a.tipe_label) + ' • ' + esc(a.kursus) + (a.tutup ? ' • tenggat ' + esc(tglIndo(a.tutup, true)) : '') + (a.tampil === 'TIDAK' ? ' • tersembunyi' : '') + '</small></span></label>'; }).join('') : '<div class="xs muted">Belum ada kursus ' + esc(p.mata_pelajaran) + ' untuk kelas ini. Tugas tetap bisa ditulis di catatan di bawah.</div>') + '</div>' +
        '<div class="card-b bt"><div class="field"><label>Catatan tugas / PR</label><textarea class="inp" name="catatan_tugas" rows="3" maxlength="1500" placeholder="Contoh: Kerjakan latihan hlm. 87 no. 1–5, dikumpulkan pertemuan berikutnya.">' + esc(p.catatan_tugas || '') + '</textarea></div></div></div>' +
        // ---- bar simpan
        '<div class="sticky-bar ptm-bar"><span class="small muted grow" id="ptSt">' + (p.baru ? 'Pertemuan belum disimpan' : (p.status === 'terlaksana' ? 'Tercatat terlaksana' : 'Tersimpan sebagai rencana')) + '</span>' +
        (!p.baru ? '<button type="button" class="btn btn-ghost" id="ptDel" title="Hapus pertemuan">' + ic('trash-2') + '<span class="hide-m">Hapus</span></button>' : '') +
        '<button type="button" class="btn btn-outline" id="ptRenc">' + ic('calendar-clock') + (p.status === 'terlaksana' && !p.baru ? 'Jadikan Rencana' : '<span class="hide-m">Simpan </span>Rencana') + '</button>' +
        '<button type="button" class="btn btn-primary" id="ptOk">' + ic('circle-check') + (p.status === 'terlaksana' && !p.baru ? 'Simpan Perubahan' : '<span class="hide-m">Simpan & Tandai </span>Terlaksana') + '</button></div></form>';
      var f = $('#ptF', box);
      function tab(t) { st.tab = self._tab = t; $$('#ptTabs button', box).forEach(function (b) { b.classList.toggle('on', b.dataset.t === t); }); $$('[data-tp]', box).forEach(function (c) { c.hidden = c.dataset.tp !== t; }); }
      $$('#ptTabs button', box).forEach(function (b) { b.onclick = function () { tab(b.dataset.t); }; });
      tab(st.tab);
      function pengganti() { $('#ptPengF', box).hidden = f.guru_hadir.value !== 'Digantikan'; }
      f.guru_hadir.onchange = pengganti; pengganti();
      f.tanggal.onchange = function () { $('#ptHari', box).textContent = hariTgl(this.value); };
      f.addEventListener('input', function () { self.kotor = true; });
      function rekap() {
        var r = { H: 0, I: 0, S: 0, A: 0, n: st.siswa.length }; st.siswa.forEach(function (s) { r[s.status]++; });
        var html = ptmRekapHtml(r) + '<span class="xs muted"> dari ' + r.n + ' siswa</span>';
        $('#ptRekap', box).innerHTML = html + ' <a href="#" class="xs" data-ke-abs>ubah di tab Absensi</a>'; $('#ptRekap2', box).innerHTML = html;
        $('#ptNAbs', box).textContent = r.H + '/' + r.n;
        $('[data-ke-abs]', box).onclick = function (e) { e.preventDefault(); tab('absensi'); };
      }
      function nMt() { var n = st.materi.length + st.tugas.length + (f.catatan_tugas.value.trim() ? 1 : 0); $('#ptNMt', box).textContent = n || ''; $('#ptNMt', box).hidden = !n; }
      function gambarAbs() {
        $('#ptAbs', box).innerHTML = st.siswa.map(function (s, i) {
          return '<div class="abs-i st-' + s.status + '" data-i="' + i + '">' + avatar(s.nama, s.foto, 'sm') + '<div class="grow" style="min-width:0"><b class="ellipsis small">' + esc(s.nama) + '</b><small class="mono">' + esc(s.NIS) + (s.sumber === 'harian' ? ' • dari absensi harian' : '') + '</small></div>' +
            '<div class="hisa" role="radiogroup" aria-label="Status ' + esc(s.nama) + '">' + ['H', 'I', 'S', 'A'].map(function (k) { return '<button type="button" data-k="' + k + '" class="' + (s.status === k ? 'on' : '') + '" aria-pressed="' + (s.status === k) + '" title="' + PTM_STATUS[k] + '">' + k + '</button>'; }).join('') + '</div>' +
            '<input class="inp ket" placeholder="Keterangan" maxlength="120" value="' + esc(s.keterangan || '') + '"' + (s.status === 'H' ? ' hidden' : '') + '></div>';
        }).join('') || emptyHtml('Belum ada siswa aktif di kelas ini', '', 'users');
        rekap();
      }
      $('#ptAbs', box).onclick = function (e) {
        var b = e.target.closest('[data-k]'); if (!b) return;
        var row = b.closest('[data-i]'), s = st.siswa[Number(row.dataset.i)]; s.status = b.dataset.k; self.kotor = true;
        row.className = 'abs-i st-' + s.status; $$('[data-k]', row).forEach(function (x) { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); });
        var ket = $('.ket', row); ket.hidden = s.status === 'H'; if (!ket.hidden && !ket.value) ket.focus();
        rekap();
      };
      $('#ptAbs', box).oninput = function (e) { if (e.target.classList.contains('ket')) st.siswa[Number(e.target.closest('[data-i]').dataset.i)].keterangan = e.target.value; };
      $('#ptSemuaH', box).onclick = function () { st.siswa.forEach(function (s) { s.status = 'H'; }); self.kotor = true; gambarAbs(); };
      $('#ptMtr', box).onchange = function () { st.materi = $$('#ptMtr input:checked', box).map(function (x) { return x.value; }); nMt(); };
      $('#ptTgs', box).onchange = function () { st.tugas = $$('#ptTgs input:checked', box).map(function (x) { return x.value; }); nMt(); };
      f.catatan_tugas.oninput = nMt;
      gambarAbs(); nMt();
      async function simpan(status, btn) {
        var d = formData(f);
        if (status === 'terlaksana' && (!d.materi_pokok.trim() || !d.kegiatan.trim())) { tab('jurnal'); toast('Lengkapi Materi / Pokok Bahasan dan Ringkasan Kegiatan Pembelajaran.', 'warn'); (d.materi_pokok.trim() ? f.kegiatan : f.materi_pokok).focus(); return; }
        if (status === 'terlaksana' && d.tanggal > todayStr()) { toast('Pertemuan di tanggal yang akan datang belum bisa ditandai terlaksana. Simpan sebagai rencana.', 'warn'); return; }
        var data = Object.assign({}, d, { status: status, materi_ids: st.materi, tugas_lms: st.tugas, hadir: st.siswa.map(function (s) { return { NIS: s.NIS, status: s.status, keterangan: s.status === 'H' ? '' : (s.keterangan || '') }; }) });
        if (!p.baru) data.pertemuan_id = p.pertemuan_id; else { data.kelas_id = p.kelas_id; data.mata_pelajaran = p.mata_pelajaran; }
        btnBusy(btn, true); $('#ptSt', box).textContent = 'Menyimpan…';
        var r = await api('ptm.save', data); btnBusy(btn, false);
        if (!r.success) { $('#ptSt', box).textContent = 'Belum tersimpan'; toast(pesanV32(r.message), 'bad'); return; }
        toast(r.message, 'ok'); self.kotor = false;
        Pages[regRole()].pertemuan && (Pages[regRole()].pertemuan.dirty = true);
        if (Pages.guru.jurnal) Pages.guru.jurnal.dirty = true;
        if (p.baru) { history.replaceState(null, '', '#/ptm/' + encodeURIComponent(r.data.pertemuan.pertemuan_id)); self._param = r.data.pertemuan.pertemuan_id; }
        self.form(el, Object.assign(r.data.pertemuan, { opsi: r.data.pertemuan.opsi || opsi }));
      }
      $('#ptOk', box).onclick = function () { simpan('terlaksana', this); };
      $('#ptRenc', box).onclick = function () { simpan('rencana', this); };
      if ($('#ptDel', box)) $('#ptDel', box).onclick = async function () {
        if (!await confirmBox('Hapus pertemuan ke-' + p.pertemuan_ke + ' beserta jurnal & absensinya?', { danger: true, ok: 'Hapus' })) return;
        btnBusy(this, true); var r = await api('ptm.hapus', { pertemuan_id: p.pertemuan_id }); btnBusy(this, false);
        if (toastRes(r)) { Pages.guru.pertemuan.dirty = true; go('pertemuan', kodeMapelPtm(p.kelas_id, p.mata_pelajaran)); }
      };
    }
  };
}
registerPage('guru', 'ptm', halamanPtm('guru'));
registerPage('siswa', 'ptm', halamanPtm('siswa'));

// =====================================================================
// JURNAL MENGAJAR
// =====================================================================
registerPage('guru', 'jurnal', {
  title: 'Jurnal Mengajar',
  st: { guru: '', kelas: '', mapel: '', per: 'semester', dari: '', sampai: '' },
  init: function (el) {
    var self = this, st = this.st, bl = [], dt = new Date();
    for (var i = 0; i < 8; i++) { var t = new Date(dt.getFullYear(), dt.getMonth() - i, 1); bl.push([t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0'), BULAN[t.getMonth()] + ' ' + t.getFullYear()]); }
    el.innerHTML = pageHead((isSA() ? 'Super Admin' : 'Panel Guru') + ' <span>// Administrasi Guru</span>', 'Jurnal Mengajar', 'Rekam jejak pertemuan yang terlaksana: hari & jam, Elemen/CP/TP, materi, kegiatan, kehadiran siswa, dan refleksi.',
      '<button class="btn btn-outline" id="jrXl">' + ic('file-spreadsheet') + 'Unduh Excel</button><button class="btn btn-dark" id="jrPdf">' + ic('file-down') + 'Unduh PDF</button>') +
      '<div class="card"><div class="toolbar">' + (isSA() ? '<div class="field"><label class="lbl">Guru</label><select class="sel" id="jrGuru"><option value="">Pilih guru…</option></select></div>' : '') +
      '<div class="field"><label class="lbl">Kelas</label><select class="sel" id="jrKelas">' + kelasOpts(st.kelas, 'Semua kelas') + '</select></div>' +
      '<div class="field"><label class="lbl">Mata pelajaran</label><select class="sel" id="jrMapel"><option value="">Semua mapel</option>' + (B().mapel || []).map(function (m) { return '<option>' + esc(m.nama) + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label class="lbl">Periode</label><select class="sel" id="jrPer"><option value="semester">Semester berjalan</option>' + bl.map(function (b) { return '<option value="' + b[0] + '">' + b[1] + '</option>'; }).join('') + '<option value="rentang">Rentang tanggal…</option></select></div>' +
      '<div class="field" id="jrRg" hidden><label class="lbl">Dari – sampai</label><div class="row gap4"><input class="inp" type="date" id="jrDari"><input class="inp" type="date" id="jrSampai"></div></div></div></div>' +
      '<div id="jrBody" class="mt16"><div class="sk" style="height:300px"></div></div>';
    var u = function () { self.muat(el); };
    if ($('#jrGuru', el)) $('#jrGuru', el).onchange = function () { st.guru = this.value; u(); };
    $('#jrKelas', el).onchange = function () { st.kelas = this.value; u(); };
    $('#jrMapel', el).onchange = function () { st.mapel = this.value; u(); };
    $('#jrPer', el).onchange = function () { st.per = this.value; $('#jrRg', el).hidden = st.per !== 'rentang'; if (st.per !== 'rentang') u(); };
    $('#jrDari', el).onchange = $('#jrSampai', el).onchange = function () { st.dari = $('#jrDari', el).value; st.sampai = $('#jrSampai', el).value; if (st.dari && st.sampai) u(); };
    $('#jrPdf', el).onclick = function () { self.unduh(el, 'pdf', this); };
    $('#jrXl', el).onclick = function () { self.unduh(el, 'excel', this); };
  },
  render: function (el) { this.muat(el); },
  opsi: function () {
    var st = this.st, d = { kelas_id: st.kelas, mata_pelajaran: st.mapel }, per = st.per;
    if (isSA() && st.guru) d.guru_id = st.guru;
    if (per === 'rentang') { d.dari = st.dari; d.sampai = st.sampai; }
    else if (/^\d{4}-\d{2}$/.test(per)) { d.dari = per + '-01'; var ak = new Date(Number(per.substring(0, 4)), Number(per.substring(5, 7)), 0).getDate(); d.sampai = per + '-' + String(ak).padStart(2, '0'); }
    return d;
  },
  muat: function (el) {
    var self = this, body = $('#jrBody', el);
    if (isSA() && !this.st.guru && !akunInfo().terhubungGuru) {
      api('ptm.jurnal', { guru_id: '__daftar__' }).then(function (r) { if (r.success && r.data.guruList) self.isiGuru(el, r.data.guruList); });
      body.innerHTML = '<div class="card">' + emptyHtml('Pilih guru', 'Super Admin dapat melihat jurnal mengajar setiap guru.', 'notebook-pen') + '</div>'; return;
    }
    apiLR('ptm.jurnal', this.opsi(), function (r) {
      if (!$('#jrBody', el)) return;
      if (!r.success) { body.innerHTML = errorBox(pesanV32(r.message)); return; }
      self.d = r.data; if (r.data.guruList) self.isiGuru(el, r.data.guruList); self.gambar(el);
    });
  },
  isiGuru: function (el, list) {
    var sel = $('#jrGuru', el); if (!sel || sel.options.length > 1) return;
    sel.innerHTML = '<option value="">Pilih guru…</option>' + list.map(function (g) { return '<option value="' + esc(g.NUPTK) + '"' + (g.NUPTK === this.st.guru ? ' selected' : '') + '>' + esc(g.nama) + '</option>'; }, this).join('');
  },
  gambar: function (el) {
    var d = this.d, rows = d.jurnal, body = $('#jrBody', el);
    var tot = { H: 0, I: 0, S: 0, A: 0, n: 0 }; rows.forEach(function (x) { ['H', 'I', 'S', 'A', 'n'].forEach(function (k) { tot[k] += x.rekap[k] || 0; }); });
    body.innerHTML = '<div class="row wrap gap8 mb12"><span class="pill">' + ic('user-round') + esc(d.guru.nama) + '</span><span class="pill">' + ic('calendar') + esc(tglIndo(d.periode.dari)) + ' – ' + esc(tglIndo(d.periode.sampai)) + '</span><span class="pill">' + ic('notebook-pen') + rows.length + ' pertemuan</span>' + (tot.n ? '<span class="pill">' + ic('users') + 'Kehadiran siswa ' + Math.round(tot.H / tot.n * 100) + '%</span>' : '') + '</div>' +
      (rows.length ? '<div class="card"><div class="tbl-wrap"><table class="tbl jurnal-tbl"><thead><tr><th style="width:36px">No</th><th>Hari & Tanggal / Jam Ke</th><th>Elemen / CP / TP</th><th>Materi / Pokok Bahasan</th><th>Ringkasan Kegiatan Pembelajaran</th><th>Rekap Kehadiran Siswa</th><th>Catatan Refleksi / Kejadian Khusus / Kendala</th></tr></thead><tbody>' +
        rows.map(function (x, i) {
          return '<tr data-pt="' + esc(x.pertemuan_id) + '" class="click"><td class="tc">' + (i + 1) + '</td><td><b>' + esc(x.hari) + '</b>, ' + esc(tglIndo(x.tanggal, true)) + '<div class="xs muted">' + (x.jam_ke ? 'Jam ke-' + esc(x.jam_ke) : '') + (x.jam_mulai ? ' (' + esc(jam5(x.jam_mulai)) + '–' + esc(jam5(x.jam_selesai)) + ')' : '') + '</div><div class="xs mt4"><span class="bdg">' + esc(x.nama_kelas) + '</span> ' + esc(x.mata_pelajaran) + ' • ke-' + x.pertemuan_ke + '</div>' + (x.sebagai_pengganti ? '<div class="xs amber">Sebagai pengganti ' + esc(x.guru_pengampu) + '</div>' : x.guru_hadir && x.guru_hadir !== 'Hadir' ? '<div class="xs amber">' + esc(x.guru_hadir) + (x.guru_pengganti ? ': ' + esc(x.guru_pengganti) : '') + '</div>' : '') + '</td>' +
            '<td class="small">' + (x.elemen ? '<b>' + esc(x.elemen) + '</b>' : '') + (x.capaian ? '<div class="clamp3 muted">CP: ' + esc(x.capaian) + '</div>' : '') + (x.tujuan ? '<div class="clamp3">TP: ' + esc(x.tujuan) + '</div>' : '') + '</td>' +
            '<td class="small">' + esc(x.materi_pokok || '-') + '</td><td class="small"><div class="clamp4">' + esc(x.kegiatan || '-') + '</div></td><td>' + ptmRekapHtml(x.rekap, true) + '</td><td class="small"><div class="clamp4">' + esc(x.refleksi || '-') + '</div></td></tr>';
        }).join('') + '</tbody></table></div></div>' :
        '<div class="card">' + emptyHtml('Belum ada jurnal', 'Jurnal terisi otomatis saat pertemuan ditandai terlaksana di menu Mapel & Pertemuan.', 'notebook-pen') + '</div>');
    $$('[data-pt]', body).forEach(function (tr) { tr.onclick = function () { go('ptm', tr.dataset.pt); }; });
  },
  unduh: async function (el, format, btn) {
    var d = this.d;
    if (!d || !d.jurnal) return toast(isSA() ? 'Pilih guru terlebih dulu.' : 'Data jurnal belum dimuat.', 'warn');
    if (!d.jurnal.length) return toast('Tidak ada jurnal pada periode ini.', 'warn');
    btnBusy(btn, true);
    try { var n = format === 'pdf' ? await jurnalPdf(d) : await jurnalExcel(d); toast('Jurnal ' + (format === 'pdf' ? 'PDF (' + n + ' halaman)' : 'Excel') + ' diunduh.', 'ok'); }
    catch (e) { console.error(e); toast(e.message || 'Gagal membuat berkas.', 'bad'); }
    finally { btnBusy(btn, false); }
  }
});

// ---------------------------------------------------------------- Berkas jurnal (memakai pembuat laporan v3.1)
function jurnalDasar(d) {
  return { sekolah: Object.assign({ aplikasi: (window.Brand ? Brand.get().nama : 'SIAKAD SISWA') }, d.sekolah || {}), tahun_ajaran: d.periode.ta, semester: d.periode.sem, pembuat: AppState.nama, dibuat: new Date().toISOString() };
}
function jurnalNamaFile(d) { return lapNamaFile('Jurnal-Mengajar_' + d.guru.nama + '_' + d.periode.dari + '_sd_' + d.periode.sampai); }
async function jurnalPdf(d) {
  await loadLib(LAP_LIB.pdf); await loadLib(LAP_LIB.tabel);
  if (!window.jspdf || !window.jspdf.jsPDF || !window.jspdf.jsPDF.API.autoTable) throw new Error('Pustaka PDF gagal dimuat. Periksa koneksi internet.');
  var dd = jurnalDasar(d), sk = dd.sekolah, brand = window.Brand ? Brand.get() : {};
  var logo = await lapLogo(brand.logo || sk.logo || LOGO);
  var pdf = new LapPdf(dd, { landscapePertama: true, warna: brand.warna || '#1E3A5F', judulDok: 'Jurnal Mengajar ' + d.guru.nama, kepala: sk.kepala, nip: sk.nip_kepala, kota: sk.kota, tglTtd: todayStr() }, logo);
  var y = pdf.halaman(true);
  y = pdf.judul(y, 'JURNAL MENGAJAR GURU', [d.guru.nama + (d.guru.mata_pelajaran ? '  |  ' + d.guru.mata_pelajaran : '') + '  |  NUPTK ' + d.guru.NUPTK, 'Periode ' + tglIndo(d.periode.dari) + ' s.d. ' + tglIndo(d.periode.sampai) + '  |  ' + d.jurnal.length + ' pertemuan']);
  var body = d.jurnal.map(function (x, i) {
    var r = x.rekap || {};
    return [i + 1, x.hari + ', ' + tglIndo(x.tanggal, true) + '\n' + (x.jam_ke ? 'Jam ke-' + x.jam_ke : '') + (x.jam_mulai ? ' (' + jam5(x.jam_mulai) + '-' + jam5(x.jam_selesai) + ')' : '') + '\n' + x.nama_kelas + ' - ' + x.mata_pelajaran + ' (ke-' + x.pertemuan_ke + ')' + (x.sebagai_pengganti ? '\nPengganti ' + x.guru_pengampu : x.guru_hadir && x.guru_hadir !== 'Hadir' ? '\n' + x.guru_hadir + (x.guru_pengganti ? ': ' + x.guru_pengganti : '') : ''),
      [x.elemen ? 'Elemen: ' + x.elemen : '', x.capaian ? 'CP: ' + x.capaian : '', x.tujuan ? 'TP: ' + x.tujuan : ''].filter(Boolean).join('\n'), x.materi_pokok || '-', x.kegiatan || '-',
      r.n ? 'H ' + r.H + '\nI ' + r.I + '\nS ' + r.S + '\nA ' + r.A : '-', x.refleksi || '-'];
  });
  y = pdf.tabel(y, [['No', 'Hari & Tanggal / Jam Ke', 'Elemen / CP / TP', 'Materi / Pokok Bahasan', 'Ringkasan Kegiatan Pembelajaran', 'Kehadiran Siswa', 'Catatan Refleksi / Kejadian Khusus / Kendala']], body, { at: {
    styles: { fontSize: 7.8, cellPadding: 1.4, valign: 'top' },
    columnStyles: { 0: { halign: 'center', cellWidth: 9 }, 1: { cellWidth: 38 }, 2: { cellWidth: 54 }, 3: { cellWidth: 34 }, 4: { cellWidth: 60 }, 5: { halign: 'center', cellWidth: 18 }, 6: { cellWidth: 'auto' } } } });
  pdf.ttd(y, [{ atas: 'Mengetahui,', jabatan: 'Kepala Sekolah', nama: sk.kepala || '', nomor: sk.nip_kepala ? 'NIP. ' + sk.nip_kepala : '' }, { atas: (sk.kota || '') + ', ' + tglIndo(todayStr()), jabatan: 'Guru Mata Pelajaran', nama: d.guru.nama, nomor: 'NUPTK. ' + d.guru.NUPTK }]);
  pdf.kaki();
  pdf.doc.save(jurnalNamaFile(d) + '.pdf');
  return pdf.doc.getNumberOfPages();
}
async function jurnalExcel(d) {
  await loadLib(LAP_LIB.excel);
  if (!window.ExcelJS) throw new Error('Pustaka Excel gagal dimuat. Periksa koneksi internet.');
  var dd = jurnalDasar(d), X = LapXl, warna = window.Brand ? Brand.get().warna : '#1E3A5F', wb = new ExcelJS.Workbook();
  wb.creator = AppState.nama || 'SIAKAD SISWA'; wb.created = new Date(); wb.title = 'Jurnal Mengajar ' + d.guru.nama;
  var ws = X.sheet(wb, 'Jurnal Mengajar', true, dd), nc = 11;
  var h = X.judul(ws, dd, 'JURNAL MENGAJAR GURU', d.guru.nama + '  |  NUPTK ' + d.guru.NUPTK + '  |  Periode ' + tglIndo(d.periode.dari) + ' s.d. ' + tglIndo(d.periode.sampai), nc, warna);
  X.header(ws, h, ['No', 'Hari, Tanggal', 'Jam Ke', 'Kelas', 'Mata Pelajaran', 'Elemen / CP / TP', 'Materi / Pokok Bahasan', 'Ringkasan Kegiatan Pembelajaran', 'Kehadiran (H/I/S/A)', '% Hadir', 'Catatan Refleksi / Kejadian Khusus / Kendala'], warna, [5, 20, 10, 10, 18, 42, 26, 46, 14, 9, 36]);
  var b = h + 1;
  d.jurnal.forEach(function (x, i) {
    var r = x.rekap || {};
    var row = X.baris(ws, b, [i + 1, x.hari + ', ' + tglIndo(x.tanggal), (x.jam_ke || '') + (x.jam_mulai ? ' (' + jam5(x.jam_mulai) + '–' + jam5(x.jam_selesai) + ')' : ''), x.nama_kelas, x.mata_pelajaran + ' (ke-' + x.pertemuan_ke + ')',
      [x.elemen ? 'Elemen: ' + x.elemen : '', x.capaian ? 'CP: ' + x.capaian : '', x.tujuan ? 'TP: ' + x.tujuan : ''].filter(Boolean).join('\n'), x.materi_pokok || '-', x.kegiatan || '-',
      r.n ? 'H ' + r.H + ' / I ' + r.I + ' / S ' + r.S + ' / A ' + r.A : '-', r.n ? { formula: 'IFERROR(' + r.H + '/' + r.n + ',0)', result: r.H / r.n } : null, x.refleksi || '-'], { kiri: [1, 4, 5, 6, 7, 10], zebra: i % 2 === 1, format: { 9: '0%' } });
    row.alignment = { vertical: 'top', wrapText: true };
    b++;
  });
  X.akhiri(ws, h, b - 1, nc, 2);
  var buf = await wb.xlsx.writeBuffer();
  downloadBlob(jurnalNamaFile(d) + '.xlsx', new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  return 1;
}
