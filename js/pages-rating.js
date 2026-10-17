/* =====================================================================
   SIAKAD SISWA v3.2 — pages-rating.js : Rating guru oleh siswa (anonim)
   Siswa: menilai guru kelasnya (4 aspek + komentar) · Guru: rating sendiri ·
   Super Admin: rekap semua guru + buka/tutup periode penilaian.
   ===================================================================== */
'use strict';

registerPage('siswa', 'ratingguru', {
  title: 'Rating Guru',
  init: function (el) {
    el.innerHTML = pageHead('Portal Siswa <span>/ Rating Guru</span>', 'Rating Guru', 'Beri penilaian untuk guru yang mengajar di kelasmu agar pembelajaran semakin baik.') +
      '<div class="note ok">' + ic('shield-check') + '<div><b>Penilaianmu anonim.</b> Guru dan sekolah hanya melihat rata-rata nilai dan komentar tanpa nama. Kamu bisa mengubah penilaian selama periode dibuka.</div></div>' +
      '<div id="rtBody" class="mt16"><div class="sk" style="height:220px"></div></div>';
  },
  render: function (el) {
    var self = this;
    apiLR('rating.saya', {}, function (r) {
      if (!$('#rtBody', el)) return;
      if (!r.success) { $('#rtBody', el).innerHTML = errorBox(pesanV32(r.message)); return; }
      self.d = r.data; self.gambar(el);
    });
  },
  gambar: function (el) {
    var d = this.d, self = this, sudah = d.guru.filter(function (g) { return g.sudah; }).length;
    $('#rtBody', el).innerHTML = (!d.aktif ? '<div class="note warn mb12">' + ic('lock') + '<div>Periode penilaian guru sedang <b>ditutup</b> oleh sekolah. Kamu tetap bisa melihat penilaian yang sudah kamu berikan.</div></div>' : '') +
      '<div class="row between wrap gap8 mb12"><span class="pill">' + ic('calendar') + 'Semester ' + esc(d.periode.sem) + ' ' + esc(d.periode.ta) + '</span><span class="small muted">' + sudah + ' dari ' + d.guru.length + ' guru sudah kamu nilai</span></div>' +
      (d.guru.length ? '<div class="rt-grid">' + d.guru.map(function (g, i) {
        return '<div class="card rt-card"><div class="row gap12">' + avatar(g.nama, g.foto, 'md') + '<div class="grow" style="min-width:0"><b class="clamp2">' + esc(g.nama) + '</b><small class="muted">' + esc(g.mata_pelajaran) + '</small></div></div>' +
          '<div class="row between wrap gap8 mt12">' + (g.sudah ? '<div>' + bintangHtml(g.nilai) + '<div class="xs muted">Nilaimu ' + fmtN(g.nilai) + ' / 5</div></div>' : '<span class="xs muted">' + ic('star') + ' Belum dinilai</span>') +
          (d.aktif ? '<button class="btn ' + (g.sudah ? 'btn-outline' : 'btn-primary') + ' btn-sm" data-rt="' + i + '">' + ic(g.sudah ? 'pencil' : 'star') + (g.sudah ? 'Ubah' : 'Beri Penilaian') + '</button>' : '') + '</div></div>';
      }).join('') + '</div>' : '<div class="card">' + emptyHtml('Belum ada guru', 'Jadwal kelasmu belum diatur sekolah.', 'users') + '</div>');
    $$('[data-rt]', el).forEach(function (b) { b.onclick = function () { self.form(el, d.guru[Number(b.dataset.rt)]); }; });
  },
  form: function (el, g) {
    var self = this, d = this.d, a = (g.a || [0, 0, 0, 0]).slice();
    var m = modal({ title: 'Nilai ' + g.nama, sub: g.mata_pelajaran + ' • anonim', size: 'md',
      body: d.aspek.map(function (lab, i) {
        return '<div class="rt-aspek" data-as="' + i + '"><div class="small b">' + esc(lab) + '</div><div class="rt-pilih" role="radiogroup" aria-label="' + esc(lab) + '">' +
          [1, 2, 3, 4, 5].map(function (n) { return '<button type="button" data-n="' + n + '" aria-label="' + n + ' bintang" class="' + (a[i] >= n ? 'on' : '') + '">' + ic('star') + '</button>'; }).join('') + '<span class="xs muted rt-ket">' + (a[i] ? ['', 'Kurang sekali', 'Kurang', 'Cukup', 'Baik', 'Sangat baik'][a[i]] : 'Pilih bintang') + '</span></div></div>';
      }).join('') +
      '<div class="field mt16"><label>Saran / komentar <span class="muted xs">(opsional, sopan & membangun)</span></label><textarea class="inp" id="rtKom" rows="3" maxlength="300" placeholder="Contoh: Penjelasannya jelas, semoga lebih banyak praktik.">' + esc(g.komentar || '') + '</textarea><div class="hint" id="rtCnt"></div></div>',
      foot: '<button class="btn btn-outline" data-x>Batal</button><button class="btn btn-primary" id="rtKirim">' + ic('send') + 'Kirim Penilaian</button>' });
    var KET = ['', 'Kurang sekali', 'Kurang', 'Cukup', 'Baik', 'Sangat baik'];
    $$('.rt-aspek', m.el).forEach(function (row) {
      var i = Number(row.dataset.as);
      row.onclick = function (e) { var b = e.target.closest('[data-n]'); if (!b) return; a[i] = Number(b.dataset.n); $$('[data-n]', row).forEach(function (x) { x.classList.toggle('on', Number(x.dataset.n) <= a[i]); }); $('.rt-ket', row).textContent = KET[a[i]]; };
    });
    var cnt = function () { $('#rtCnt', m.el).textContent = $('#rtKom', m.el).value.length + ' / 300'; }; $('#rtKom', m.el).oninput = cnt; cnt();
    $('#rtKirim', m.el).onclick = async function () {
      if (a.some(function (x) { return !x; })) return toast('Beri bintang untuk keempat aspek.', 'warn');
      btnBusy(this, true);
      var r = await api('rating.kirim', { guru_id: g.guru_id, mata_pelajaran: g.mata_pelajaran, a: a, komentar: $('#rtKom', m.el).value });
      btnBusy(this, false);
      if (!toastRes(r)) return;
      m.close(); g.sudah = true; g.a = a; g.nilai = r.data.nilai; g.komentar = $('#rtKom', m.el).value.trim(); self.gambar(el);
    };
  }
});

// ---------------------------------------------------------------- Guru & Super Admin
function ratingDetailHtml(d) {
  var maks = Math.max(1, d.sebaran[1], d.sebaran[2], d.sebaran[3], d.sebaran[4], d.sebaran[5]);
  return '<div class="grid g-main-r rt-det"><div class="card card-p rt-skor"><div class="xs b muted">RATA-RATA PENILAIAN</div><div class="rt-besar">' + (d.n ? fmtN(d.rata) : '–') + '<small>/5</small></div>' + bintangHtml(d.rata, true) +
    '<div class="small muted mt8">' + d.n + ' siswa menilai • Semester ' + esc(d.periode.sem) + ' ' + esc(d.periode.ta) + '</div>' +
    '<div class="rt-sebar mt16">' + [5, 4, 3, 2, 1].map(function (b) { return '<div class="row gap8 xs"><span style="width:26px">' + b + ic('star', 'amber') + '</span><div class="grow pbar"><span style="width:' + (d.sebaran[b] / maks * 100) + '%"></span></div><span style="width:22px" class="tr">' + d.sebaran[b] + '</span></div>'; }).join('') + '</div></div>' +
    '<div class="card"><div class="card-h"><h3 class="grow">' + ic('chart-no-axes-column') + ' Nilai per Aspek</h3></div><div class="card-b">' +
    d.aspekLabel.map(function (lab, i) { var v = d.aspek[i] || 0; return '<div class="mb12"><div class="row between small"><span>' + esc(lab) + '</span><b>' + (d.n ? fmtN(v) : '–') + '</b></div>' + persenBar(v / 5 * 100) + '</div>'; }).join('') +
    (d.rincian.length ? '<div class="xs b muted mt16">PER KELAS & MAPEL</div><div class="tbl-wrap mt8"><table class="tbl"><thead><tr><th>Kelas</th><th>Mapel</th><th class="tc">Penilai</th><th class="tc">Rata-rata</th></tr></thead><tbody>' + d.rincian.map(function (r) { return '<tr><td>' + esc(r.kelas) + '</td><td>' + esc(r.mata_pelajaran || '-') + '</td><td class="tc">' + r.n + '</td><td class="tc b">' + fmtN(r.rata) + '</td></tr>'; }).join('') + '</tbody></table></div>' : '') + '</div></div></div>' +
    '<div class="card mt16"><div class="card-h"><div class="grow"><h3>' + ic('message-square-quote') + ' Komentar Siswa</h3><p>Ditampilkan tanpa nama & kelas</p></div></div><div class="card-b">' +
    (!d.komentarTampil ? '<div class="note">' + ic('shield') + '<div>Komentar tampil setelah minimal ' + d.minAnonim + ' siswa menilai, agar identitas penilai tetap terlindungi.</div></div>' :
      d.komentar.length ? '<div class="rt-kom">' + d.komentar.map(function (k) { return '<div class="rt-kom-i"><div class="row between">' + bintangHtml(k.nilai) + '<span class="xs muted">' + esc(k.bulan ? BULAN[Number(k.bulan.substring(5, 7)) - 1] + ' ' + k.bulan.substring(0, 4) : '') + '</span></div><p>' + esc(k.teks) + '</p></div>'; }).join('') + '</div>' : emptyHtml('Belum ada komentar', '', 'message-square')) + '</div></div>';
}
registerPage('guru', 'ratingguru', {
  title: 'Rating Guru',
  st: { per: '', guru: '' },
  init: function (el) {
    el.innerHTML = pageHead((isSA() ? 'Super Admin' : 'Panel Guru') + ' <span>// Umpan Balik Siswa</span>', isSA() ? 'Rating Guru' : 'Rating Saya', isSA() ? 'Rekap penilaian guru oleh siswa (anonim). Buka atau tutup periode penilaian kapan saja.' : 'Penilaian anonim dari siswa yang Anda ajar — gunakan sebagai bahan refleksi.',
      isSA() ? '<button class="btn btn-outline" id="rtAtur">' + ic('lock') + 'Periode Penilaian</button>' : '') + '<div id="rgBody"><div class="sk" style="height:260px"></div></div>';
    var self = this;
    if ($('#rtAtur', el)) $('#rtAtur', el).onclick = function () { self.atur(el); };
  },
  render: function (el) { if (isSA() && !this.st.guru) this.rekap(el); else this.detail(el, this.st.guru); },
  rekap: function (el) {
    var self = this;
    apiLR('rating.rekap', {}, function (r) {
      if (!$('#rgBody', el)) return;
      if (!r.success) { $('#rgBody', el).innerHTML = errorBox(pesanV32(r.message)); return; }
      var d = r.data; self.aktif = d.aktif;
      $('#rgBody', el).innerHTML = '<div class="grid g4">' + kpi('Status Penilaian', d.aktif ? 'Dibuka' : 'Ditutup', d.aktif ? 'siswa dapat menilai' : 'siswa tidak dapat menilai', d.aktif ? 'lock-open' : 'lock', d.aktif ? 'ok' : 'warn') +
        kpi('Total Penilaian', fmtN(d.total), 'Semester ' + esc(d.periode.sem) + ' ' + esc(d.periode.ta), 'star') + kpi('Rata-rata Sekolah', d.total ? fmtN(d.rata) + '<small>/5</small>' : '–', 'seluruh guru', 'chart-no-axes-column') + kpi('Guru Dinilai', fmtN(d.dinilai) + '<small>/' + d.guru.length + '</small>', 'memiliki minimal 1 penilaian', 'users') + '</div>' +
        '<div class="card mt16"><div class="card-h"><div class="grow"><h3>' + ic('list-ordered') + ' Peringkat Guru</h3><p>Klik guru untuk melihat rincian aspek & komentar</p></div></div><div class="tbl-wrap"><table class="tbl"><thead><tr><th style="width:44px">#</th><th>Guru</th><th class="hide-m">Mapel</th><th class="tc">Penilai</th><th class="tc">Rata-rata</th>' +
        d.aspekLabel.map(function (a) { return '<th class="tc hide-m" title="' + esc(a) + '">' + esc(a.split(' ')[0]) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        d.guru.map(function (g, i) { return '<tr class="click" data-g="' + esc(g.guru_id) + '"><td class="tc">' + (g.n ? i + 1 : '-') + '</td><td><div class="who">' + avatar(g.nama, g.foto, 'sm') + '<b class="small">' + esc(g.nama) + '</b></div></td><td class="hide-m small">' + esc(g.mapel) + '</td><td class="tc">' + g.n + '</td><td class="tc">' + (g.n ? '<b>' + fmtN(g.rata) + '</b> ' + bintangHtml(g.rata) : '<span class="muted">–</span>') + '</td>' +
          g.aspek.map(function (v) { return '<td class="tc hide-m">' + (g.n ? fmtN(v) : '–') + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div></div>';
      $$('[data-g]', el).forEach(function (tr) { tr.onclick = function () { self.st.guru = tr.dataset.g; self.detail(el, tr.dataset.g); }; });
    });
  },
  detail: function (el, gid) {
    var self = this, body = $('#rgBody', el);
    body.innerHTML = '<div class="sk" style="height:260px"></div>';
    var per = this.st.per ? this.st.per.split('|') : null;
    apiLR('rating.guru', Object.assign(gid ? { guru_id: gid } : {}, per ? { tahun_ajaran: per[0], semester: per[1] } : {}), function (r) {
      if (!$('#rgBody', el)) return;
      if (!r.success) { body.innerHTML = (isSA() ? '<a href="#" class="small b back-link" id="rgBack">' + ic('arrow-left') + ' SEMUA GURU</a>' : '') + errorBox(pesanV32(r.message)); if ($('#rgBack', el)) $('#rgBack', el).onclick = function (e) { e.preventDefault(); self.st.guru = ''; self.st.per = ''; self.rekap(el); }; return; }
      var d = r.data;
      body.innerHTML = (isSA() ? '<a href="#" class="small b back-link" id="rgBack">' + ic('arrow-left') + ' SEMUA GURU</a>' : '') +
        '<div class="row gap12 mt8 mb12">' + avatar(d.guru.nama, d.guru.foto, 'lg') + '<div><h3 style="font-size:18px">' + esc(d.guru.nama) + '</h3><div class="small muted">' + esc(d.guru.mata_pelajaran || '') + '</div></div>' +
        (d.periodeList.length > 1 ? '<div class="sp"></div><select class="sel" id="rgPer" style="width:auto">' + d.periodeList.map(function (p) { var v = p.ta + '|' + p.sem; return '<option value="' + esc(v) + '"' + (p.ta === d.periode.ta && p.sem === d.periode.sem ? ' selected' : '') + '>' + esc(p.sem + ' ' + p.ta) + '</option>'; }).join('') + '</select>' : '') + '</div>' +
        (!d.aktif && !isSA() ? '<div class="note mb12">' + ic('lock') + '<div>Periode penilaian sedang ditutup oleh sekolah.</div></div>' : '') + ratingDetailHtml(d);
      if ($('#rgBack', el)) $('#rgBack', el).onclick = function (e) { e.preventDefault(); self.st.guru = ''; self.st.per = ''; self.rekap(el); };
      if ($('#rgPer', el)) $('#rgPer', el).onchange = function () { self.st.per = this.value; self.detail(el, gid); };
    });
  },
  atur: function (el) {
    var self = this, aktif = this.aktif !== false;
    var m = modal({ title: 'Periode Penilaian Guru', sub: 'Atur apakah siswa dapat memberi rating guru', size: 'sm',
      body: '<div class="mode-pilih" id="raPilih" style="grid-template-columns:1fr 1fr"><button type="button" data-v="YA" class="' + (aktif ? 'on' : '') + '"><span class="mp-ic">' + ic('lock-open') + '</span><b>Dibuka</b><small>Siswa dapat menilai & mengubah</small></button><button type="button" data-v="TIDAK" class="' + (!aktif ? 'on' : '') + '"><span class="mp-ic">' + ic('lock') + '</span><b>Ditutup</b><small>Siswa hanya melihat</small></button></div><div class="note mt12">' + ic('info') + '<div>Penilaian dikelompokkan per semester (Pengaturan → Akademik). Saat semester berganti, siswa dapat menilai lagi.</div></div>',
      foot: '<button class="btn btn-outline" data-x>Tutup</button>' });
    $$('#raPilih button', m.el).forEach(function (b) { b.onclick = async function () { btnBusy(b, true); var r = await api('rating.atur', { aktif: b.dataset.v }); btnBusy(b, false); if (toastRes(r)) { m.close(); self.rekap(el); } }; });
  }
});
