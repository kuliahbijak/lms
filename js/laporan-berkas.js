/* =====================================================================
   SIAKAD SISWA v3.1 — laporan-berkas.js : Berkas Laporan Resmi
   Rekap ABSENSI & rekap NILAI — semua siswa (per kelas) atau per individu —
   sebagai PDF formal (kop sekolah, tabel, ringkasan, tanda tangan, nomor halaman)
   dan Excel .xlsx bergaya (bukan CSV): judul, header berwarna, garis tabel,
   format persen, matriks harian berwarna, filter, panel beku, siap cetak A4.
   Data dihitung server (laporan.rekap); berkas dibuat di browser (tanpa kuota Drive).
   Pustaka (lazy, cdnjs): jsPDF 2.5.1 + jsPDF-AutoTable 3.8.4, ExcelJS 4.4.0.
   Catatan font PDF (Latin-1): hindari karakter "·", "–", "≥", emoji.
   ===================================================================== */
'use strict';

var LAP_LIB = {
  pdf: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  tabel: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.4/jspdf.plugin.autotable.min.js',
  excel: 'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js'
};
var LAP_JENIS = { absensi: 'Rekap Absensi', nilai: 'Rekap Nilai', lengkap: 'Lengkap (Absensi + Nilai)' };
var LAP_STATUS = { H: 'Hadir', T: 'Terlambat', I: 'Izin', S: 'Sakit', A: 'Alpha' };

// ---------------------------------------------------------------- utilitas
function lapPersen(x) { return x === null || x === undefined || x === '' ? '-' : fmtN(x, 1) + '%'; }
function lapNilai(x) { return x === '' || x === null || x === undefined ? '-' : fmtN(x); }
function lapRgb(hex) { var n = parseInt(String(hex || '#1E3A5F').slice(1), 16); return isNaN(n) ? [30, 58, 95] : [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function lapArgb(hex) { return 'FF' + String(hex || '#1E3A5F').slice(1).toUpperCase(); }
function lapNamaFile(s) { return String(s || '').replace(/[^\w\-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').substring(0, 90); }
function lapKelas(d, id) { return (d.kelas || []).filter(function (k) { return k.kelas_id === id; })[0] || { kelas_id: id, nama_kelas: id, wali: '', wali_nuptk: '' }; }
function lapPeriode(d) { return tglIndo(d.periode.dari) + ' s.d. ' + tglIndo(d.periode.sampai); }
function lapBulan(t) { var p = String(t).split('-'); return BULAN[Number(p[1]) - 1] + ' ' + p[0]; }
/** Rekap per bulan dari kode harian */
function lapPerBulan(hari, kode) {
  var out = {}, urut = [];
  (hari || []).forEach(function (t, i) {
    var b = t.substring(0, 7), c = (kode || '').charAt(i) || 'A';
    if (!out[b]) { out[b] = { bulan: b, hari: 0, H: 0, T: 0, I: 0, S: 0, A: 0 }; urut.push(b); }
    var o = out[b]; o.hari++;
    if (c === 'T') { o.H++; o.T++; } else if (o[c] !== undefined) o[c]++;
  });
  return urut.map(function (b) { var o = out[b]; o.persen = o.hari ? Math.round(o.H / o.hari * 1000) / 10 : null; return o; });
}
/** Logo → PNG data URL (SVG/URL/data URL). Gagal (CORS dll.) → tanpa logo, laporan tetap jadi. */
function lapLogo(src) {
  return new Promise(function (res) {
    if (!src) return res(null);
    var selesai = false, img = new Image();
    function kirim(v) { if (!selesai) { selesai = true; res(v); } }
    if (!/^data:/.test(src)) img.crossOrigin = 'anonymous';
    img.onload = function () {
      try {
        var s = 240, w = img.naturalWidth || s, h = img.naturalHeight || s, r = Math.min(s / w, s / h);
        var c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w * r)); c.height = Math.max(1, Math.round(h * r));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        kirim({ data: c.toDataURL('image/png'), w: c.width, h: c.height });
      } catch (e) { kirim(null); }
    };
    img.onerror = function () { kirim(null); };
    setTimeout(function () { kirim(null); }, 5000);
    img.src = src;
  });
}
/** Ringkasan per kelas (dipakai PDF & Excel) */
function lapStatKelas(d, siswa) {
  var A = d.absensi, batas = d.sekolah.batas_hadir, t = { n: siswa.length, H: 0, T: 0, I: 0, S: 0, A: 0, rata: null, bawah: 0 }, ps = [];
  siswa.forEach(function (s) { var r = A.rekap[s.NIS]; if (!r) return; ['H', 'T', 'I', 'S', 'A'].forEach(function (k) { t[k] += r[k]; }); if (r.persen !== null) { ps.push(r.persen); if (r.persen < batas) t.bawah++; } });
  t.rata = ps.length ? Math.round(ps.reduce(function (a, b) { return a + b; }, 0) / ps.length * 10) / 10 : null;
  return t;
}
function lapNilaiSiswa(d, nis) {
  var N = d.nilai, b = N.baris[nis] || {}, ak = [];
  N.mapel.forEach(function (m) { var x = b[m]; if (x && x.akhir !== '') ak.push(Number(x.akhir)); });
  return { rata: ak.length ? Math.round(ak.reduce(function (a, c) { return a + c; }, 0) / ak.length * 10) / 10 : null, tuntas: ak.filter(function (v) { return v >= d.sekolah.kkm; }).length, jml: ak.length };
}
function lapKodeMapel(d, m, i) { return (d.nilai.kode || {})[m] || ('M' + (i + 1)); }

// =====================================================================
// PDF
// =====================================================================
function LapPdf(d, o, logo) {
  this.d = d; this.o = o; this.logo = logo; this.warna = lapRgb(o.warna);
  this.doc = new jspdf.jsPDF({ unit: 'mm', format: 'a4', orientation: o.landscapePertama ? 'landscape' : 'portrait', compress: true });
  this.doc.setProperties({ title: o.judulDok, subject: 'Laporan ' + d.sekolah.nama, author: d.pembuat, creator: d.sekolah.aplikasi || 'SIAKAD SISWA' });
  this.halamanBaru = false;
}
LapPdf.prototype.W = function () { return this.doc.internal.pageSize.getWidth(); };
LapPdf.prototype.H = function () { return this.doc.internal.pageSize.getHeight(); };
LapPdf.prototype.halaman = function (lanskap) {
  if (this.halamanBaru) this.doc.addPage('a4', lanskap ? 'landscape' : 'portrait');
  else if (!!lanskap !== (this.W() > this.H())) { this.doc.addPage('a4', lanskap ? 'landscape' : 'portrait'); this.hapusPertama = true; }
  this.halamanBaru = true;
  return this.kop();
};
/** Kop sekolah: logo, nama, alamat, garis ganda */
LapPdf.prototype.kop = function () {
  var doc = this.doc, W = this.W(), sk = this.d.sekolah, y = 12;
  if (this.logo) { var h = 20, w = Math.min(26, h * this.logo.w / this.logo.h); doc.addImage(this.logo.data, 'PNG', 14, y - 2, w, h); }
  doc.setTextColor(20); doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
  doc.text(String(sk.nama || '').toUpperCase(), W / 2, y + 4, { align: 'center', maxWidth: W - 70 });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(60);
  if (sk.alamat) doc.text(String(sk.alamat), W / 2, y + 10, { align: 'center', maxWidth: W - 70 });
  doc.text('Tahun Pelajaran ' + (this.d.tahun_ajaran || sk.tahun_ajaran) + '  |  Semester ' + (this.d.semester || sk.semester), W / 2, y + 15, { align: 'center' });
  doc.setDrawColor(20); doc.setLineWidth(0.9); doc.line(14, y + 20, W - 14, y + 20);
  doc.setLineWidth(0.25); doc.line(14, y + 21.3, W - 14, y + 21.3);
  return y + 29;
};
LapPdf.prototype.judul = function (y, teks, sub) {
  var doc = this.doc, W = this.W();
  doc.setTextColor(15); doc.setFont('helvetica', 'bold'); doc.setFontSize(12.5);
  doc.text(teks, W / 2, y, { align: 'center' });
  var lw = doc.getTextWidth(teks); doc.setLineWidth(0.3); doc.line(W / 2 - lw / 2, y + 1, W / 2 + lw / 2, y + 1);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(50);
  (sub || []).forEach(function (s, i) { doc.text(s, W / 2, y + 6 + i * 4.6, { align: 'center' }); });
  return y + 8 + (sub || []).length * 4.6;
};
LapPdf.prototype.subjudul = function (y, teks) {
  var doc = this.doc;
  y = this.cukup(y, 18);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(this.warna[0], this.warna[1], this.warna[2]);
  doc.text(teks, 14, y); doc.setTextColor(20);
  return y + 2.5;
};
/** Pastikan sisa ruang cukup, bila tidak → halaman baru (tanpa kop ulang) */
LapPdf.prototype.cukup = function (y, perlu) { if (y + perlu > this.H() - 18) { this.doc.addPage('a4', this.W() > this.H() ? 'landscape' : 'portrait'); return 18; } return y; };
LapPdf.prototype.tabel = function (y, head, body, opsi) {
  opsi = opsi || {};
  var w = this.warna, self = this, at = opsi.at || {};
  var dasar = {
    head: head, body: body, startY: y, theme: 'grid', margin: { left: 14, right: 14, bottom: 18 },
    styles: { font: 'helvetica', fontSize: opsi.kecil ? 7.6 : 8.6, cellPadding: opsi.kecil ? 1.1 : 1.6, lineColor: [205, 212, 224], lineWidth: 0.15, textColor: 25, valign: 'middle', overflow: 'linebreak' },
    headStyles: { fillColor: w, textColor: 255, fontStyle: 'bold', halign: 'center', valign: 'middle' },
    alternateRowStyles: { fillColor: [246, 248, 252] },
    footStyles: { fillColor: [236, 240, 247], textColor: 20, fontStyle: 'bold' },
    rowPageBreak: 'avoid', showHead: 'everyPage', showFoot: 'lastPage'
  };
  Object.keys(at).forEach(function (k) { dasar[k] = /^(styles|headStyles|footStyles)$/.test(k) ? Object.assign({}, dasar[k], at[k]) : at[k]; });   // gabung gaya, bukan timpa
  this.doc.autoTable(dasar);
  return self.doc.lastAutoTable.finalY + 5;
};
/** Pasangan kunci : nilai (identitas siswa) dalam 2 kolom */
LapPdf.prototype.identitas = function (y, pasangan) {
  var body = [], W = this.W(), lebar = (W - 28) / 2;
  for (var i = 0; i < pasangan.length; i += 2) {
    var a = pasangan[i], b = pasangan[i + 1] || ['', ''];
    body.push([a[0], ':', a[1], b[0], b[0] ? ':' : '', b[1]]);
  }
  this.doc.autoTable({ body: body, startY: y, theme: 'plain', margin: { left: 14, right: 14 },
    styles: { fontSize: 9.2, cellPadding: { top: 0.9, bottom: 0.9, left: 0, right: 1 }, textColor: 20 },
    columnStyles: { 0: { cellWidth: 32, textColor: 80 }, 1: { cellWidth: 3 }, 2: { cellWidth: lebar - 35, fontStyle: 'bold' }, 3: { cellWidth: 32, textColor: 80 }, 4: { cellWidth: 3 }, 5: { fontStyle: 'bold' } } });
  return this.doc.lastAutoTable.finalY + 4;
};
LapPdf.prototype.catatan = function (y, teks) {
  var doc = this.doc;
  doc.setFont('helvetica', 'italic'); doc.setFontSize(8); doc.setTextColor(90);
  var baris = doc.splitTextToSize(teks, this.W() - 28); y = this.cukup(y, baris.length * 3.6 + 2);
  doc.text(baris, 14, y); doc.setTextColor(20);
  return y + baris.length * 3.6 + 2;
};
/** Blok tanda tangan: [{atas, jabatan, nama, nomor}] dibagi rata selebar halaman */
LapPdf.prototype.ttd = function (y, blok) {
  var doc = this.doc, W = this.W(), n = blok.length, lebar = (W - 28) / n;
  y = this.cukup(y + 2, 34);
  blok.forEach(function (b, i) {
    var x = 14 + lebar * i + lebar / 2;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(20);
    if (b.atas) doc.text(b.atas, x, y, { align: 'center' });
    doc.text(b.jabatan, x, y + 4.8, { align: 'center' });
    doc.setFont('helvetica', 'bold');
    var nama = b.nama || '(...................................)';
    doc.text(nama, x, y + 27, { align: 'center' });
    if (b.nama) { var lw = doc.getTextWidth(nama); doc.setLineWidth(0.25); doc.line(x - lw / 2, y + 27.8, x + lw / 2, y + 27.8); }
    doc.setFont('helvetica', 'normal');
    if (b.nomor) doc.text(b.nomor, x, y + 32, { align: 'center' });
  });
  return y + 38;
};
LapPdf.prototype.kaki = function () {
  if (this.hapusPertama) { this.doc.deletePage(1); this.hapusPertama = false; }
  var doc = this.doc, n = doc.getNumberOfPages(), sk = this.d.sekolah, waktu = new Date(this.d.dibuat || Date.now());
  var info = (sk.aplikasi || 'SIAKAD SISWA') + '  |  dicetak ' + tglIndo(todayStr()) + ' ' + waktu.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }) + ' oleh ' + (this.d.pembuat || '-');
  for (var i = 1; i <= n; i++) {
    doc.setPage(i);
    var W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
    doc.setDrawColor(210); doc.setLineWidth(0.2); doc.line(14, H - 12, W - 14, H - 12);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(120);
    doc.text(info, 14, H - 8);
    doc.text('Halaman ' + i + ' dari ' + n, W - 14, H - 8, { align: 'right' });
  }
};
LapPdf.prototype.ttdKelas = function (y, k) {
  var o = this.o, sk = this.d.sekolah;
  return this.ttd(y, [
    { atas: 'Mengetahui,', jabatan: 'Kepala Sekolah', nama: o.kepala, nomor: o.nip ? 'NIP. ' + o.nip : '' },
    { atas: (o.kota || sk.kota || '') + ', ' + tglIndo(o.tglTtd), jabatan: 'Wali Kelas ' + (k.nama_kelas || ''), nama: k.wali, nomor: k.wali_nuptk ? 'NUPTK. ' + k.wali_nuptk : '' }
  ]);
};

// ---------------------------------------------------------------- isi PDF
LapPdf.prototype.absensiKelas = function (k) {
  var d = this.d, A = d.absensi, sk = d.sekolah, batas = sk.batas_hadir;
  var siswa = d.siswa.filter(function (s) { return s.kelas_id === k.kelas_id; }), st = lapStatKelas(d, siswa), hari = (A.hari[k.kelas_id] || []).length;
  var y = this.halaman(false);
  y = this.judul(y, 'REKAPITULASI KEHADIRAN SISWA', ['Kelas ' + k.nama_kelas + '  |  Periode ' + lapPeriode(d), 'Hari efektif: ' + hari + ' hari  |  Batas minimal kehadiran: ' + batas + '%']);
  y = this.tabel(y, [['Jumlah Siswa', 'Rata-rata Kehadiran', 'Total Terlambat', 'Total Izin', 'Total Sakit', 'Total Alpha', 'Di Bawah Batas']],
    [[st.n + ' siswa', lapPersen(st.rata), st.T, st.I, st.S, st.A, st.bawah + ' siswa']], { at: { styles: { halign: 'center', fontSize: 8.6, cellPadding: 1.8 }, headStyles: { fillColor: [236, 240, 247], textColor: 30, halign: 'center' } } });
  var body = siswa.map(function (s, i) {
    var r = A.rekap[s.NIS] || {};
    return [i + 1, s.NIS, s.nama, s.jk || '-', r.H, r.T, r.I, r.S, r.A, lapPersen(r.persen), r.persen !== null && r.persen < batas ? 'Di bawah batas' : 'Memenuhi'];
  });
  var self = this;
  y = this.tabel(y, [['No', 'NIS', 'Nama Siswa', 'L/P', 'Hadir', 'Terlambat', 'Izin', 'Sakit', 'Alpha', '% Hadir', 'Keterangan']], body, { at: {
    columnStyles: { 0: { halign: 'center', cellWidth: 9 }, 1: { cellWidth: 20 }, 3: { halign: 'center', cellWidth: 9 }, 4: { halign: 'center', cellWidth: 12 }, 5: { halign: 'center', cellWidth: 18 }, 6: { halign: 'center', cellWidth: 10 }, 7: { halign: 'center', cellWidth: 11 }, 8: { halign: 'center', cellWidth: 12 }, 9: { halign: 'center', cellWidth: 16 }, 10: { cellWidth: 27 } },
    didParseCell: function (h) { if (h.section === 'body' && (h.column.index === 10 || h.column.index === 9) && /bawah/.test(h.row.raw[10])) { h.cell.styles.textColor = [185, 28, 28]; h.cell.styles.fontStyle = 'bold'; } }
  } });
  y = this.catatan(y, 'Keterangan: % Hadir = jumlah hadir (termasuk terlambat) dibagi hari efektif x 100%. Hari efektif adalah tanggal kelas memiliki catatan absensi; siswa tanpa catatan pada hari efektif dihitung Alpha.');
  this.ttdKelas(y, k);
};
LapPdf.prototype.absensiSiswa = function (s) {
  var d = this.d, A = d.absensi, sk = d.sekolah, k = lapKelas(d, s.kelas_id), r = A.rekap[s.NIS] || {}, batas = sk.batas_hadir;
  var y = this.halaman(false);
  y = this.judul(y, 'LAPORAN KEHADIRAN SISWA', ['Periode ' + lapPeriode(d)]);
  y = this.identitas(y, [['Nama Siswa', s.nama], ['Kelas', k.nama_kelas], ['NIS / NISN', s.NIS + (s.NISN ? ' / ' + s.NISN : '')], ['Wali Kelas', k.wali || '-'], ['Jenis Kelamin', s.jk === 'P' ? 'Perempuan' : s.jk === 'L' ? 'Laki-laki' : '-'], ['Orang Tua/Wali', s.nama_ortu || '-']]);
  y = this.subjudul(y, 'A. Ringkasan Kehadiran');
  y = this.tabel(y, [['Hari Efektif', 'Hadir', 'Terlambat', 'Izin', 'Sakit', 'Alpha', '% Kehadiran', 'Status']],
    [[r.hari + ' hari', r.H, r.T, r.I, r.S, r.A, lapPersen(r.persen), r.persen !== null && r.persen < batas ? 'Di bawah batas ' + batas + '%' : 'Memenuhi batas ' + batas + '%']],
    { at: { styles: { halign: 'center' }, didParseCell: function (h) { if (h.section === 'body' && h.column.index === 7 && r.persen !== null && r.persen < batas) { h.cell.styles.textColor = [185, 28, 28]; h.cell.styles.fontStyle = 'bold'; } } } });
  var bulan = lapPerBulan(A.hari[s.kelas_id], A.kode[s.NIS]);
  y = this.subjudul(y, 'B. Rekap per Bulan');
  y = this.tabel(y, [['Bulan', 'Hari Efektif', 'Hadir', 'Terlambat', 'Izin', 'Sakit', 'Alpha', '% Kehadiran']],
    bulan.map(function (b) { return [lapBulan(b.bulan), b.hari, b.H, b.T, b.I, b.S, b.A, lapPersen(b.persen)]; }).concat(bulan.length ? [] : [['-', '-', '-', '-', '-', '-', '-', '-']]),
    { at: { columnStyles: { 0: { halign: 'left' } }, styles: { halign: 'center' } } });
  var log = (A.log[s.NIS] || []).filter(function (x) { return x.status !== 'Hadir' || x.terlambat; });
  y = this.subjudul(y, 'C. Rincian Ketidakhadiran & Keterlambatan');
  if (log.length) y = this.tabel(y, [['No', 'Hari, Tanggal', 'Status', 'Jam Tercatat', 'Keterangan']],
    log.map(function (x, i) { return [i + 1, tglHari(x.tanggal), x.terlambat && x.status === 'Hadir' ? 'Terlambat' : x.status, x.jam || '-', x.keterangan || '-']; }),
    { at: { columnStyles: { 0: { halign: 'center', cellWidth: 10 }, 2: { cellWidth: 24 }, 3: { halign: 'center', cellWidth: 24 } },
      didParseCell: function (h) { if (h.section === 'body' && h.column.index === 2) { var t = h.cell.raw; h.cell.styles.textColor = t === 'Alpha' ? [185, 28, 28] : t === 'Terlambat' ? [146, 64, 14] : [30, 58, 95]; h.cell.styles.fontStyle = 'bold'; } } } });
  else y = this.catatan(y + 2, 'Tidak ada ketidakhadiran maupun keterlambatan pada periode ini.');
  this.ttdKelas(y, k);
};
LapPdf.prototype.nilaiKelas = function (k) {
  var d = this.d, N = d.nilai, sk = d.sekolah, kkm = sk.kkm;
  var siswa = d.siswa.filter(function (s) { return s.kelas_id === k.kelas_id; }), mapel = N.mapel;
  var y = this.halaman(true);
  y = this.judul(y, 'REKAPITULASI NILAI SISWA', ['Kelas ' + k.nama_kelas + '  |  Tahun Pelajaran ' + d.tahun_ajaran + '  |  Semester ' + d.semester + '  |  KKM ' + kkm, 'Nilai yang ditampilkan adalah nilai akhir rapor (harian ' + sk.bobot.harian + '%, UTS ' + sk.bobot.uts + '%, UAS ' + sk.bobot.uas + '%)']);
  var head = ['No', 'NIS', 'Nama Siswa'].concat(mapel.map(function (m, i) { return lapKodeMapel(d, m, i); })).concat(['Rata-rata', 'Peringkat']);
  var body = siswa.map(function (s, i) {
    var b = N.baris[s.NIS] || {}, ns = lapNilaiSiswa(d, s.NIS), p = N.peringkat[s.NIS];
    return [i + 1, s.NIS, s.nama].concat(mapel.map(function (m) { return b[m] ? lapNilai(b[m].akhir) : '-'; })).concat([lapNilai(ns.rata), p ? p.ke : '-']);
  });
  var kecil = mapel.length > 10, nm = mapel.length;
  y = this.tabel(y, [head], body, { kecil: kecil, at: {
    styles: { cellPadding: kecil ? 1.0 : 1.3 },
    columnStyles: Object.assign({ 0: { halign: 'center', cellWidth: 8 }, 1: { cellWidth: 19 }, 2: { cellWidth: kecil ? 42 : 52 } }, (function () { var c = {}; for (var j = 3; j < 3 + nm + 2; j++) c[j] = { halign: 'center' }; return c; })()),
    didParseCell: function (h) { if (h.section === 'body' && h.column.index >= 3 && h.column.index < 3 + nm) { var v = Number(String(h.cell.raw).replace(',', '.')); if (!isNaN(v) && v < kkm) { h.cell.styles.textColor = [185, 28, 28]; h.cell.styles.fontStyle = 'bold'; } } }
  } });
  // statistik & keterangan kode mapel
  var stat = mapel.map(function (m, i) {
    var v = siswa.map(function (s) { var x = (N.baris[s.NIS] || {})[m]; return x && x.akhir !== '' ? Number(x.akhir) : null; }).filter(function (x) { return x !== null; });
    var tuntas = v.filter(function (x) { return x >= kkm; }).length;
    return [lapKodeMapel(d, m, i), m, v.length ? lapNilai(Math.round(v.reduce(function (a, b) { return a + b; }, 0) / v.length * 10) / 10) : '-', v.length ? lapNilai(Math.max.apply(null, v)) : '-', v.length ? lapNilai(Math.min.apply(null, v)) : '-', v.length ? tuntas + ' / ' + v.length + ' (' + Math.round(tuntas / v.length * 100) + '%)' : '-'];
  });
  y = this.subjudul(y, 'Statistik Mata Pelajaran & Keterangan Kode');
  y = this.tabel(y, [['Kode', 'Mata Pelajaran', 'Rata-rata', 'Tertinggi', 'Terendah', 'Tuntas (>= KKM)']], stat, { at: { columnStyles: { 0: { halign: 'center', cellWidth: 18 }, 2: { halign: 'center' }, 3: { halign: 'center' }, 4: { halign: 'center' }, 5: { halign: 'center' } } } });
  y = this.catatan(y, 'Nilai berwarna merah berada di bawah KKM (' + kkm + '). Peringkat dihitung dari rata-rata nilai akhir seluruh mata pelajaran di kelas.');
  this.ttdKelas(y, k);
};
LapPdf.prototype.nilaiSiswa = function (s, denganAbsen) {
  var d = this.d, N = d.nilai, sk = d.sekolah, kkm = sk.kkm, k = lapKelas(d, s.kelas_id), b = N.baris[s.NIS] || {}, ns = lapNilaiSiswa(d, s.NIS), p = N.peringkat[s.NIS];
  var y = this.halaman(false);
  y = this.judul(y, 'LAPORAN HASIL BELAJAR SISWA', ['Tahun Pelajaran ' + d.tahun_ajaran + '  |  Semester ' + d.semester]);
  y = this.identitas(y, [['Nama Siswa', s.nama], ['Kelas', k.nama_kelas], ['NIS / NISN', s.NIS + (s.NISN ? ' / ' + s.NISN : '')], ['Wali Kelas', k.wali || '-'], ['Tempat, Tgl Lahir', (s.tempat_lahir || '-') + (s.tanggal_lahir ? ', ' + tglIndo(s.tanggal_lahir) : '')], ['Orang Tua/Wali', s.nama_ortu || '-']]);
  y = this.subjudul(y, 'A. Nilai Mata Pelajaran');
  var body = N.mapel.filter(function (m) { return b[m]; }).map(function (m, i) {
    var x = b[m]; return [i + 1, m, lapNilai(x.harian), lapNilai(x.uts), lapNilai(x.uas), lapNilai(x.akhir), x.predikat || '-', x.akhir === '' ? '-' : Number(x.akhir) >= kkm ? 'Tuntas' : 'Belum tuntas'];
  });
  y = this.tabel(y, [['No', 'Mata Pelajaran', 'Harian', 'UTS', 'UAS', 'Nilai Akhir', 'Predikat', 'Ketuntasan']], body.length ? body : [['-', 'Belum ada nilai pada semester ini', '', '', '', '', '', '']], { at: {
    foot: body.length ? [[{ content: 'Rata-rata nilai akhir', colSpan: 5, styles: { halign: 'right' } }, lapNilai(ns.rata), { content: (p ? 'Peringkat ' + p.ke + ' dari ' + p.dari + ' siswa' : ''), colSpan: 2 }]] : undefined,
    columnStyles: { 0: { halign: 'center', cellWidth: 9 }, 2: { halign: 'center', cellWidth: 16 }, 3: { halign: 'center', cellWidth: 16 }, 4: { halign: 'center', cellWidth: 16 }, 5: { halign: 'center', cellWidth: 20 }, 6: { halign: 'center', cellWidth: 17 }, 7: { halign: 'center', cellWidth: 25 } },
    didParseCell: function (h) { if (h.section === 'body' && h.column.index === 7 && h.cell.raw === 'Belum tuntas') { h.cell.styles.textColor = [185, 28, 28]; h.cell.styles.fontStyle = 'bold'; } }
  } });
  y = this.catatan(y, 'KKM ' + kkm + '. Predikat: A = 90-100, B = 80-89, C = ' + kkm + '-79, D = di bawah ' + kkm + '. Nilai akhir = harian ' + sk.bobot.harian + '% + UTS ' + sk.bobot.uts + '% + UAS ' + sk.bobot.uas + '%. Jumlah mapel tuntas: ' + ns.tuntas + ' dari ' + ns.jml + '.');
  if (denganAbsen && d.absensi) {
    var r = d.absensi.rekap[s.NIS] || {};
    y = this.subjudul(y + 1, 'B. Kehadiran (' + lapPeriode(d) + ')');
    y = this.tabel(y, [['Hari Efektif', 'Hadir', 'Terlambat', 'Sakit', 'Izin', 'Tanpa Keterangan (Alpha)', '% Kehadiran']], [[r.hari + ' hari', r.H, r.T, r.S, r.I, r.A, lapPersen(r.persen)]], { at: { styles: { halign: 'center' } } });
  }
  y = this.cukup(y + 1, 26);
  y = this.subjudul(y, (denganAbsen ? 'C' : 'B') + '. Catatan Wali Kelas');
  this.doc.setDrawColor(190); this.doc.setLineWidth(0.2);
  for (var i = 0; i < 3; i++) this.doc.line(14, y + 6 + i * 6, this.W() - 14, y + 6 + i * 6);
  y += 22;
  var o = this.o;
  this.ttd(y, [
    { atas: 'Mengetahui,', jabatan: 'Orang Tua/Wali', nama: '' },
    { atas: 'Mengetahui,', jabatan: 'Kepala Sekolah', nama: o.kepala, nomor: o.nip ? 'NIP. ' + o.nip : '' },
    { atas: (o.kota || sk.kota || '') + ', ' + tglIndo(o.tglTtd), jabatan: 'Wali Kelas', nama: k.wali, nomor: k.wali_nuptk ? 'NUPTK. ' + k.wali_nuptk : '' }
  ]);
};

async function lapBuatPdf(d, o) {
  await loadLib(LAP_LIB.pdf); await loadLib(LAP_LIB.tabel);
  if (!window.jspdf || !window.jspdf.jsPDF || !window.jspdf.jsPDF.API.autoTable) throw new Error('Pustaka PDF gagal dimuat. Periksa koneksi internet.');
  var logo = await lapLogo(o.logo);
  var lanskap = d.jenis === 'nilai' && !d.perorangan;
  var pdf = new LapPdf(d, Object.assign({ landscapePertama: lanskap }, o), logo);
  if (d.perorangan) {
    var s = d.siswa[0];
    if (d.jenis === 'absensi') pdf.absensiSiswa(s);
    else if (d.jenis === 'nilai') pdf.nilaiSiswa(s, false);
    else { pdf.nilaiSiswa(s, true); pdf.absensiSiswa(s); }
  } else {
    d.kelas.forEach(function (k) {
      if (d.jenis !== 'nilai') pdf.absensiKelas(k);
      if (d.jenis !== 'absensi') pdf.nilaiKelas(k);
    });
  }
  pdf.kaki();
  pdf.doc.save(o.namaFile + '.pdf');
  return pdf.doc.getNumberOfPages();
}

// =====================================================================
// EXCEL (.xlsx bergaya)
// =====================================================================
var LapXl = {
  garis: { top: { style: 'thin', color: { argb: 'FFC9D2E0' } }, left: { style: 'thin', color: { argb: 'FFC9D2E0' } }, bottom: { style: 'thin', color: { argb: 'FFC9D2E0' } }, right: { style: 'thin', color: { argb: 'FFC9D2E0' } } },
  isiStatus: { H: ['FFE7F6EC', 'FF166534'], T: ['FFFFF4DF', 'FF835500'], I: ['FFE8EEFA', 'FF1E3A5F'], S: ['FFF3E8FF', 'FF6B21A8'], A: ['FFFEE2E2', 'FF991B1B'] },
  namaSheet: function (wb, n) { var s = String(n).replace(/[\[\]\*\?\/\\:]/g, ' ').substring(0, 31).trim() || 'Sheet', x = s, i = 2; while (wb.getWorksheet(x)) x = s.substring(0, 28) + ' ' + i++; return x; },
  sheet: function (wb, nama, lanskap, d) {
    var ws = wb.addWorksheet(this.namaSheet(wb, nama), { pageSetup: { paperSize: 9, orientation: lanskap ? 'landscape' : 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, horizontalCentered: true, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.6, header: 0.2, footer: 0.3 } } });
    ws.headerFooter.oddFooter = '&L&8' + String(d.sekolah.nama).replace(/&/g, '&&') + '&R&8Halaman &P dari &N';
    return ws;
  },
  /** Judul 4 baris (sekolah, judul, sub) digabung selebar tabel */
  judul: function (ws, d, judul, sub, ncol, warna) {
    var self = this;
    [[String(d.sekolah.nama).toUpperCase(), 14, true, 'FF0F172A'], [judul, 12, true, lapArgb(warna)], [sub, 10, false, 'FF475569'], [d.sekolah.alamat + '  |  Tahun Pelajaran ' + d.tahun_ajaran + '  |  Semester ' + d.semester, 9, false, 'FF64748B']].forEach(function (r, i) {
      ws.mergeCells(i + 1, 1, i + 1, ncol);
      var c = ws.getCell(i + 1, 1); c.value = r[0]; c.font = { name: 'Calibri', size: r[1], bold: r[2], color: { argb: r[3] } }; c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      ws.getRow(i + 1).height = i < 2 ? 22 : 16;
    });
    return 6;                                                 // baris header tabel
  },
  header: function (ws, baris, label, warna, lebar) {
    var self = this, r = ws.getRow(baris);
    label.forEach(function (t, i) {
      var c = r.getCell(i + 1); c.value = t; c.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: lapArgb(warna) } };
      c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; c.border = self.garis;
      if (lebar && lebar[i]) ws.getColumn(i + 1).width = lebar[i];
    });
    r.height = 30;
  },
  baris: function (ws, baris, nilai, opsi) {
    var self = this, r = ws.getRow(baris); opsi = opsi || {};
    nilai.forEach(function (v, i) {
      var c = r.getCell(i + 1); c.value = v === '' || v === null || v === undefined ? null : v; c.border = self.garis;
      c.alignment = { vertical: 'middle', horizontal: (opsi.kiri || []).indexOf(i) > -1 ? 'left' : 'center', wrapText: (opsi.kiri || []).indexOf(i) > -1 };
      if (opsi.zebra) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF6F8FC' } };
      if (opsi.format && opsi.format[i]) c.numFmt = opsi.format[i];
    });
    return r;
  },
  akhiri: function (ws, barisHeader, baris, ncol, beku) {
    ws.views = [{ state: 'frozen', xSplit: beku || 0, ySplit: barisHeader, showGridLines: false }];
    ws.autoFilter = { from: { row: barisHeader, column: 1 }, to: { row: Math.max(barisHeader, baris), column: ncol } };
    ws.pageSetup.printTitlesRow = barisHeader + ':' + barisHeader;
  },
  catatan: function (ws, baris, teks, ncol) { ws.mergeCells(baris, 1, baris, ncol); var c = ws.getCell(baris, 1); c.value = teks; c.font = { italic: true, size: 9, color: { argb: 'FF64748B' } }; c.alignment = { wrapText: true, vertical: 'top' }; ws.getRow(baris).height = 30; },
  ttd: function (ws, baris, d, o, k, ncol) {
    var kiri = 2, kanan = Math.max(4, ncol - 2), sk = d.sekolah;
    function tulis(r, c, v, b) { var x = ws.getCell(r, c); x.value = v; x.font = { bold: !!b, size: 10, underline: !!b && !!v }; x.alignment = { horizontal: 'center' }; }
    tulis(baris, kiri, 'Mengetahui,'); tulis(baris + 1, kiri, 'Kepala Sekolah'); tulis(baris + 5, kiri, o.kepala || '(..............................)', true); tulis(baris + 6, kiri, o.nip ? 'NIP. ' + o.nip : '');
    tulis(baris, kanan, (o.kota || sk.kota || '') + ', ' + tglIndo(o.tglTtd)); tulis(baris + 1, kanan, k ? 'Wali Kelas ' + k.nama_kelas : 'Wali Kelas'); tulis(baris + 5, kanan, (k && k.wali) || '(..............................)', true); tulis(baris + 6, kanan, k && k.wali_nuptk ? 'NUPTK. ' + k.wali_nuptk : '');
  }
};
function lapXlAbsensiKelas(wb, d, o, k) {
  var X = LapXl, A = d.absensi, batas = d.sekolah.batas_hadir, siswa = d.siswa.filter(function (s) { return s.kelas_id === k.kelas_id; }), hari = A.hari[k.kelas_id] || [];
  // --- rekap
  var ws = X.sheet(wb, 'Absensi ' + k.nama_kelas, false, d), ncol = 11;
  var h = X.judul(ws, d, 'REKAPITULASI KEHADIRAN SISWA', 'Kelas ' + k.nama_kelas + '  |  Periode ' + lapPeriode(d) + '  |  Hari efektif ' + hari.length + ' hari  |  Batas ' + batas + '%', ncol, o.warna);
  X.header(ws, h, ['No', 'NIS', 'Nama Siswa', 'L/P', 'Hadir', 'Terlambat', 'Izin', 'Sakit', 'Alpha', '% Hadir', 'Keterangan'], o.warna, [6, 13, 32, 6, 9, 11, 8, 8, 8, 10, 16]);
  siswa.forEach(function (s, i) {
    var r = A.rekap[s.NIS] || {}, n = h + 1 + i, bawah = r.persen !== null && r.persen < batas;
    var row = X.baris(ws, n, [i + 1, s.NIS, s.nama, s.jk, r.H, r.T, r.I, r.S, r.A, r.hari ? { formula: 'IFERROR(E' + n + '/' + r.hari + ',0)', result: r.H / r.hari } : null, bawah ? 'Di bawah batas' : 'Memenuhi'], { kiri: [2], zebra: i % 2 === 1, format: { 9: '0.0%' } });
    if (bawah) { row.getCell(10).font = { bold: true, color: { argb: 'FFB91C1C' } }; row.getCell(11).font = { bold: true, color: { argb: 'FFB91C1C' } }; }
  });
  var akhir = h + siswa.length, t = akhir + 1;
  if (siswa.length) {
    var tot = X.baris(ws, t, ['', '', 'JUMLAH / RATA-RATA', '', { formula: 'SUM(E' + (h + 1) + ':E' + akhir + ')' }, { formula: 'SUM(F' + (h + 1) + ':F' + akhir + ')' }, { formula: 'SUM(G' + (h + 1) + ':G' + akhir + ')' }, { formula: 'SUM(H' + (h + 1) + ':H' + akhir + ')' }, { formula: 'SUM(I' + (h + 1) + ':I' + akhir + ')' }, { formula: 'IFERROR(AVERAGE(J' + (h + 1) + ':J' + akhir + '),0)' }, ''], { kiri: [2], format: { 9: '0.0%' } });
    tot.eachCell(function (c) { c.font = { bold: true }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFECF0F7' } }; });
  }
  X.catatan(ws, t + 2, '% Hadir = hadir (termasuk terlambat) / hari efektif. Hari efektif = tanggal kelas memiliki catatan absensi; tanpa catatan dihitung Alpha. Rincian harian ada di sheet "Harian ' + k.nama_kelas + '".', ncol);
  X.ttd(ws, t + 4, d, o, k, ncol);
  X.akhiri(ws, h, akhir, ncol, 3);
  // --- matriks harian berwarna
  var wh = X.sheet(wb, 'Harian ' + k.nama_kelas, true, d), nc = 3 + hari.length + 5;
  var h2 = X.judul(wh, d, 'DAFTAR HADIR HARIAN', 'Kelas ' + k.nama_kelas + '  |  ' + lapPeriode(d) + '  |  H = hadir, T = terlambat, I = izin, S = sakit, A = alpha', nc, o.warna);
  X.header(wh, h2, ['No', 'NIS', 'Nama Siswa'].concat(hari.map(function (t) { return Number(t.substring(8)) + '/' + Number(t.substring(5, 7)); })).concat(['H', 'T', 'I', 'S', 'A']), o.warna);
  wh.getColumn(1).width = 5; wh.getColumn(2).width = 12; wh.getColumn(3).width = 28;
  for (var j = 0; j < hari.length + 5; j++) wh.getColumn(4 + j).width = j < hari.length ? 4.6 : 5.5;
  wh.getRow(h2).height = 34; for (var q = 4; q < 4 + hari.length; q++) wh.getRow(h2).getCell(q).alignment = { textRotation: 90, horizontal: 'center', vertical: 'middle' };
  siswa.forEach(function (s, i) {
    var kd = A.kode[s.NIS] || '', r = A.rekap[s.NIS] || {};
    var row = X.baris(wh, h2 + 1 + i, [i + 1, s.NIS, s.nama].concat(kd.split('')).concat([r.H, r.T, r.I, r.S, r.A]), { kiri: [2] });
    kd.split('').forEach(function (c, x) { var w = X.isiStatus[c]; if (w) { var cell = row.getCell(4 + x); cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: w[0] } }; cell.font = { bold: true, size: 9, color: { argb: w[1] } }; } });
  });
  X.akhiri(wh, h2, h2 + siswa.length, nc, 3);
}
function lapXlAbsensiSiswa(wb, d, o, s) {
  var X = LapXl, A = d.absensi, k = lapKelas(d, s.kelas_id), r = A.rekap[s.NIS] || {}, batas = d.sekolah.batas_hadir;
  var ws = X.sheet(wb, 'Kehadiran ' + s.nama, false, d), ncol = 8;
  var h = X.judul(ws, d, 'LAPORAN KEHADIRAN SISWA', s.nama + '  |  NIS ' + s.NIS + '  |  Kelas ' + k.nama_kelas + '  |  Periode ' + lapPeriode(d), ncol, o.warna);
  X.header(ws, h, ['Hari Efektif', 'Hadir', 'Terlambat', 'Izin', 'Sakit', 'Alpha', '% Kehadiran', 'Status'], o.warna, [14, 10, 11, 10, 10, 10, 13, 24]);
  var rr = X.baris(ws, h + 1, [r.hari, r.H, r.T, r.I, r.S, r.A, r.hari ? r.H / r.hari : null, r.persen !== null && r.persen < batas ? 'Di bawah batas ' + batas + '%' : 'Memenuhi batas ' + batas + '%'], { format: { 6: '0.0%' } });
  if (r.persen !== null && r.persen < batas) rr.getCell(8).font = { bold: true, color: { argb: 'FFB91C1C' } };
  var b0 = h + 3; X.header(ws, b0, ['Bulan', 'Hari Efektif', 'Hadir', 'Terlambat', 'Izin', 'Sakit', 'Alpha', '% Kehadiran'], o.warna);
  var bulan = lapPerBulan(A.hari[s.kelas_id], A.kode[s.NIS]);
  bulan.forEach(function (b, i) { X.baris(ws, b0 + 1 + i, [lapBulan(b.bulan), b.hari, b.H, b.T, b.I, b.S, b.A, b.hari ? b.H / b.hari : null], { kiri: [0], zebra: i % 2 === 1, format: { 7: '0.0%' } }); });
  X.ttd(ws, b0 + bulan.length + 3, d, o, k, ncol);
  ws.views = [{ showGridLines: false }];
  // rincian semua hari
  var wl = X.sheet(wb, 'Rincian Harian', false, d), nl = 6;
  var h2 = X.judul(wl, d, 'RINCIAN KEHADIRAN HARIAN', s.nama + '  |  NIS ' + s.NIS + '  |  ' + lapPeriode(d), nl, o.warna);
  X.header(wl, h2, ['No', 'Hari', 'Tanggal', 'Status', 'Jam Tercatat', 'Keterangan'], o.warna, [6, 10, 14, 13, 12, 42]);
  (A.log[s.NIS] || []).forEach(function (x, i) {
    var st = x.terlambat && x.status === 'Hadir' ? 'Terlambat' : x.status, kode = st === 'Terlambat' ? 'T' : String(st).charAt(0), w = X.isiStatus[kode];
    var row = X.baris(wl, h2 + 1 + i, [i + 1, hariDari(x.tanggal), new Date(x.tanggal + 'T00:00:00Z'), st, x.jam, x.keterangan], { kiri: [5], zebra: i % 2 === 1, format: { 2: 'dd/mm/yyyy' } });
    if (w) { row.getCell(4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: w[0] } }; row.getCell(4).font = { bold: true, color: { argb: w[1] } }; }
  });
  X.akhiri(wl, h2, h2 + (A.log[s.NIS] || []).length, nl, 0);
}
function lapXlNilaiKelas(wb, d, o, k) {
  var X = LapXl, N = d.nilai, kkm = d.sekolah.kkm, siswa = d.siswa.filter(function (s) { return s.kelas_id === k.kelas_id; }), mapel = N.mapel, ncol = 3 + mapel.length + 3;
  var ws = X.sheet(wb, 'Nilai ' + k.nama_kelas, true, d);
  var h = X.judul(ws, d, 'REKAPITULASI NILAI SISWA', 'Kelas ' + k.nama_kelas + '  |  KKM ' + kkm + '  |  Nilai akhir rapor', ncol, o.warna);
  X.header(ws, h, ['No', 'NIS', 'Nama Siswa'].concat(mapel.map(function (m, i) { return lapKodeMapel(d, m, i); })).concat(['Rata-rata', 'Peringkat', 'Mapel Tuntas']), o.warna);
  ws.getColumn(1).width = 5; ws.getColumn(2).width = 12; ws.getColumn(3).width = 30;
  mapel.forEach(function (m, i) { ws.getColumn(4 + i).width = 8.5; });
  ws.getColumn(4 + mapel.length).width = 10; ws.getColumn(5 + mapel.length).width = 10; ws.getColumn(6 + mapel.length).width = 12;
  var awal = h + 1, akhir = h + siswa.length, kolA = function (i) { return X_KOLOM(4 + i); }, kolR = X_KOLOM(4 + mapel.length);
  siswa.forEach(function (s, i) {
    var b = N.baris[s.NIS] || {}, n = awal + i, ns = lapNilaiSiswa(d, s.NIS);
    var nilai = mapel.map(function (m) { return b[m] && b[m].akhir !== '' ? Number(b[m].akhir) : null; });
    var rng = X_KOLOM(4) + n + ':' + X_KOLOM(3 + mapel.length) + n;
    var row = X.baris(ws, n, [i + 1, s.NIS, s.nama].concat(nilai).concat([
      mapel.length ? { formula: 'IFERROR(ROUND(AVERAGE(' + rng + '),1),"")', result: ns.rata === null ? '' : ns.rata } : null,
      siswa.length ? { formula: 'IF(' + kolR + n + '="","",RANK(' + kolR + n + ',$' + kolR + '$' + awal + ':$' + kolR + '$' + akhir + '))', result: (N.peringkat[s.NIS] || {}).ke || '' } : null,
      mapel.length ? { formula: 'COUNTIF(' + rng + ',">="&' + kkm + ')&" / "&COUNT(' + rng + ')', result: ns.tuntas + ' / ' + ns.jml } : null]),
      { kiri: [2], zebra: i % 2 === 1, format: (function () { var f = {}; for (var j = 0; j < mapel.length + 1; j++) f[3 + j] = '0.0'; return f; })() });
    nilai.forEach(function (v, x) { if (v !== null && v < kkm) row.getCell(4 + x).font = { bold: true, color: { argb: 'FFB91C1C' } }; });
  });
  // baris statistik
  var t = akhir + 1;
  [['RATA-RATA', 'AVERAGE'], ['TERTINGGI', 'MAX'], ['TERENDAH', 'MIN']].forEach(function (st, x) {
    var vals = ['', '', st[0]].concat(mapel.map(function (m, i) { var c = kolA(i); return siswa.length ? { formula: 'IFERROR(ROUND(' + st[1] + '(' + c + awal + ':' + c + akhir + '),1),"")' } : null; })).concat(['', '', '']);
    var r = X.baris(ws, t + x, vals, { kiri: [2], format: (function () { var f = {}; for (var j = 0; j < mapel.length; j++) f[3 + j] = '0.0'; return f; })() });
    r.eachCell(function (c) { c.font = { bold: true }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFECF0F7' } }; });
  });
  var leg = t + 4;
  ws.getCell(leg, 3).value = 'Keterangan kode mata pelajaran:'; ws.getCell(leg, 3).font = { bold: true };
  mapel.forEach(function (m, i) { ws.getCell(leg + 1 + i, 3).value = lapKodeMapel(d, m, i) + ' = ' + m; });
  X.catatan(ws, leg + mapel.length + 2, 'Nilai merah = di bawah KKM ' + kkm + '. Rata-rata, peringkat, dan jumlah tuntas memakai rumus Excel sehingga ikut berubah bila nilai dikoreksi.', ncol);
  X.ttd(ws, leg + mapel.length + 4, d, o, k, ncol);
  X.akhiri(ws, h, akhir, ncol, 3);
  // detail komponen (format panjang — mudah difilter/pivot)
  var wd = X.sheet(wb, 'Detail Nilai ' + k.nama_kelas, true, d), nd = 10;
  var h2 = X.judul(wd, d, 'DETAIL KOMPONEN NILAI', 'Kelas ' + k.nama_kelas + '  |  Harian ' + d.sekolah.bobot.harian + '%, UTS ' + d.sekolah.bobot.uts + '%, UAS ' + d.sekolah.bobot.uas + '%', nd, o.warna);
  X.header(wd, h2, ['No', 'NIS', 'Nama Siswa', 'Mata Pelajaran', 'Harian', 'UTS', 'UAS', 'Nilai Akhir', 'Predikat', 'Ketuntasan'], o.warna, [6, 12, 28, 26, 9, 9, 9, 11, 10, 14]);
  var n2 = h2;
  siswa.forEach(function (s) {
    var b = N.baris[s.NIS] || {};
    mapel.forEach(function (m) {
      var x = b[m]; if (!x) return; n2++;
      var row = X.baris(wd, n2, [n2 - h2, s.NIS, s.nama, m, x.harian, x.uts, x.uas, x.akhir, x.predikat, x.akhir === '' ? '' : Number(x.akhir) >= kkm ? 'Tuntas' : 'Belum tuntas'], { kiri: [2, 3], zebra: (n2 - h2) % 2 === 0, format: { 4: '0.0', 5: '0.0', 6: '0.0', 7: '0.0' } });
      if (x.akhir !== '' && Number(x.akhir) < kkm) row.getCell(10).font = { bold: true, color: { argb: 'FFB91C1C' } };
    });
  });
  X.akhiri(wd, h2, n2, nd, 3);
}
function X_KOLOM(n) { var s = ''; while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
function lapXlNilaiSiswa(wb, d, o, s, denganAbsen) {
  var X = LapXl, N = d.nilai, kkm = d.sekolah.kkm, k = lapKelas(d, s.kelas_id), b = N.baris[s.NIS] || {}, ns = lapNilaiSiswa(d, s.NIS), p = N.peringkat[s.NIS], ncol = 8;
  var ws = X.sheet(wb, 'Nilai ' + s.nama, false, d);
  var h = X.judul(ws, d, 'LAPORAN HASIL BELAJAR SISWA', s.nama + '  |  NIS ' + s.NIS + '  |  Kelas ' + k.nama_kelas + '  |  Wali kelas ' + (k.wali || '-'), ncol, o.warna);
  X.header(ws, h, ['No', 'Mata Pelajaran', 'Harian', 'UTS', 'UAS', 'Nilai Akhir', 'Predikat', 'Ketuntasan'], o.warna, [6, 32, 10, 10, 10, 12, 10, 16]);
  var list = N.mapel.filter(function (m) { return b[m]; });
  list.forEach(function (m, i) {
    var x = b[m], row = X.baris(ws, h + 1 + i, [i + 1, m, x.harian, x.uts, x.uas, x.akhir, x.predikat, x.akhir === '' ? '' : Number(x.akhir) >= kkm ? 'Tuntas' : 'Belum tuntas'], { kiri: [1], zebra: i % 2 === 1, format: { 2: '0.0', 3: '0.0', 4: '0.0', 5: '0.0' } });
    if (x.akhir !== '' && Number(x.akhir) < kkm) row.getCell(8).font = { bold: true, color: { argb: 'FFB91C1C' } };
  });
  var t = h + list.length + 1;
  var tot = X.baris(ws, t, ['', 'Rata-rata nilai akhir', '', '', '', list.length ? { formula: 'ROUND(AVERAGE(F' + (h + 1) + ':F' + (t - 1) + '),1)', result: ns.rata } : null, '', p ? 'Peringkat ' + p.ke + ' / ' + p.dari : ''], { kiri: [1], format: { 5: '0.0' } });
  tot.eachCell(function (c) { c.font = { bold: true }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFECF0F7' } }; });
  var y = t + 2;
  if (denganAbsen && d.absensi) {
    var r = d.absensi.rekap[s.NIS] || {};
    ws.getCell(y, 1).value = 'Kehadiran (' + lapPeriode(d) + ')'; ws.getCell(y, 1).font = { bold: true, color: { argb: lapArgb(o.warna) } };
    X.header(ws, y + 1, ['Hari Efektif', 'Hadir', 'Terlambat', 'Sakit', 'Izin', 'Alpha', '% Kehadiran', ''], o.warna);
    X.baris(ws, y + 2, [r.hari, r.H, r.T, r.S, r.I, r.A, r.hari ? r.H / r.hari : null, ''], { format: { 6: '0.0%' } });
    y += 4;
  }
  X.catatan(ws, y, 'KKM ' + kkm + '. Predikat A = 90-100, B = 80-89, C = ' + kkm + '-79, D = di bawah ' + kkm + '.', ncol);
  X.ttd(ws, y + 2, d, o, k, ncol);
  ws.views = [{ state: 'frozen', ySplit: h, showGridLines: false }];
  ws.pageSetup.printTitlesRow = h + ':' + h;
}
async function lapBuatExcel(d, o) {
  await loadLib(LAP_LIB.excel);
  if (!window.ExcelJS) throw new Error('Pustaka Excel gagal dimuat. Periksa koneksi internet.');
  var wb = new ExcelJS.Workbook();
  wb.creator = d.pembuat || 'SIAKAD SISWA'; wb.created = new Date(); wb.title = o.judulDok; wb.company = d.sekolah.nama;
  if (d.perorangan) {
    var s = d.siswa[0];
    if (d.jenis !== 'absensi') lapXlNilaiSiswa(wb, d, o, s, d.jenis === 'lengkap');
    if (d.jenis !== 'nilai') lapXlAbsensiSiswa(wb, d, o, s);
  } else {
    d.kelas.forEach(function (k) {
      if (d.jenis !== 'nilai') lapXlAbsensiKelas(wb, d, o, k);
      if (d.jenis !== 'absensi') lapXlNilaiKelas(wb, d, o, k);
    });
  }
  var buf = await wb.xlsx.writeBuffer();
  downloadBlob(o.namaFile + '.xlsx', new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  return wb.worksheets.length;
}

// =====================================================================
// PEMBUAT LAPORAN (dialog)
// =====================================================================
var LapBerkas = {
  st: { jenis: 'lengkap', cakupan: 'semua', kelas: '', NIS: '', periode: 'semester', dari: '', sampai: '' },
  /** pre: { NIS?, kelas_id?, jenis? } */
  buka: function (pre) {
    var st = this.st, self = this; pre = pre || {};
    if (pre.NIS) { st.cakupan = 'siswa'; st.NIS = String(pre.NIS); var s0 = siswaByNIS(pre.NIS); if (s0) st.kelas = s0.kelas_id; }
    if (pre.kelas_id !== undefined) { st.kelas = pre.kelas_id; if (!pre.NIS) st.cakupan = 'semua'; }   // dibuka dari menu kelas → rekap satu kelas
    if (pre.jenis) st.jenis = pre.jenis;
    var hari = todayStr(), bl = [], dt = new Date();
    for (var i = 0; i < 8; i++) { var t = new Date(dt.getFullYear(), dt.getMonth() - i, 1); bl.push([t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0'), BULAN[t.getMonth()] + ' ' + t.getFullYear()]); }
    var m = modal({ title: 'Unduh Laporan Resmi', sub: 'Rekap absensi & nilai siswa — PDF formal atau Excel (.xlsx)', size: 'lg', body:
      '<div class="xs b muted">1. JENIS LAPORAN</div><div class="lap-pilih mt8" id="lbJenis">' + Object.keys(LAP_JENIS).map(function (k) {
        return '<button type="button" data-j="' + k + '" class="' + (st.jenis === k ? 'on' : '') + '">' + ic({ absensi: 'calendar-check', nilai: 'award', lengkap: 'file-text' }[k]) + '<b>' + LAP_JENIS[k] + '</b><small>' + { absensi: 'Hadir, terlambat, izin, sakit, alpha & % kehadiran', nilai: 'Nilai akhir per mapel, rata-rata, peringkat, statistik', lengkap: 'Gabungan nilai + kehadiran (seperti rapor ringkas)' }[k] + '</small></button>';
      }).join('') + '</div>' +
      '<div class="xs b muted mt16">2. CAKUPAN</div><div class="seg plain mt8" id="lbCak" style="max-width:420px"><button type="button" data-c="semua" class="' + (st.cakupan === 'semua' ? 'on' : '') + '">' + ic('users') + 'Semua siswa</button><button type="button" data-c="siswa" class="' + (st.cakupan === 'siswa' ? 'on' : '') + '">' + ic('user-round') + 'Per siswa</button></div>' +
      '<div class="grid-form mt12"><div class="field c6"><label>Kelas</label><select class="sel" id="lbKelas">' + kelasOpts(st.kelas, 'Semua kelas') + '</select></div>' +
      '<div class="field c6" id="lbSiswaF"><label>Siswa</label><select class="sel" id="lbSiswa"></select><div class="hint">Ketik di kolom cari untuk mempersempit.</div></div>' +
      '<div class="field c6" id="lbCariF"><label>Cari siswa</label><input class="inp" id="lbCari" placeholder="Nama atau NIS…" autocomplete="off"></div></div>' +
      '<div id="lbAbs"><div class="xs b muted mt16">3. PERIODE KEHADIRAN</div><div class="grid-form mt8"><div class="field c6"><select class="sel" id="lbPer"><option value="semester">Semester berjalan (' + esc(cfg('SEMESTER', '')) + ')</option>' + bl.map(function (b) { return '<option value="' + b[0] + '">' + b[1] + '</option>'; }).join('') + '<option value="rentang">Rentang tanggal…</option></select></div>' +
      '<div class="field c3" id="lbDariF"><input class="inp" type="date" id="lbDari" value="' + esc(st.dari || cfg('SEMESTER_MULAI', hari)) + '"></div><div class="field c3" id="lbSampaiF"><input class="inp" type="date" id="lbSampai" value="' + esc(st.sampai || hari) + '"></div></div></div>' +
      '<div id="lbNil"><div class="xs b muted mt16">' + ic('award') + ' NILAI</div><div class="grid-form mt8"><div class="field c6"><label>Tahun pelajaran</label><input class="inp" id="lbTa" value="' + esc(cfg('TAHUN_AJARAN', '')) + '"></div><div class="field c6"><label>Semester</label><select class="sel" id="lbSem">' + selOpts(['Ganjil', 'Genap'], cfg('SEMESTER', 'Ganjil')) + '</select></div></div></div>' +
      '<details class="mt16" id="lbTtdD"><summary class="small b">' + ic('pen-line') + ' Penanda tangan & tanggal</summary><div class="grid-form mt12">' +
      '<div class="field c6"><label>Kepala sekolah</label><input class="inp" id="lbKep" value="' + esc(cfg('KEPALA_SEKOLAH', '')) + '" placeholder="Nama lengkap & gelar"></div><div class="field c6"><label>NIP kepala sekolah</label><input class="inp" id="lbNip" value="' + esc(cfg('NIP_KEPALA_SEKOLAH', '')) + '"></div>' +
      '<div class="field c6"><label>Kota</label><input class="inp" id="lbKota" value="' + esc(cfg('KOTA_LAPORAN', '')) + '" placeholder="Kosong = dari alamat sekolah"></div><div class="field c6"><label>Tanggal tanda tangan</label><input class="inp" type="date" id="lbTgl" value="' + hari + '"></div>' +
      (isSA() ? '<label class="chk c12"><input type="checkbox" id="lbSimpan"> Simpan nama kepala sekolah, NIP, dan kota sebagai bawaan</label>' : '') + '</div><div class="hint">Wali kelas diambil otomatis dari data kelas.</div></details>' +
      '<div class="note mt16" id="lbInfo">' + ic('info') + '<div>PDF: kop sekolah, tabel rapi, ringkasan, tanda tangan & nomor halaman. Excel: sheet per kelas, header berwarna, rumus rata-rata/peringkat, daftar hadir harian berwarna, siap cetak A4.</div></div>',
      foot: '<span class="xs muted grow" id="lbSt"></span><button class="btn btn-outline" id="lbXl">' + ic('file-spreadsheet') + 'Unduh Excel</button><button class="btn btn-primary" id="lbPdf">' + ic('file-down') + 'Unduh PDF</button>' });
    var el = m.el;
    function siswaList() {
      var q = ($('#lbCari', el).value || '').toLowerCase(), kls = $('#lbKelas', el).value;
      var list = (B().siswa || []).filter(function (s) { return (s.status || 'Aktif') === 'Aktif' && (!kls || s.kelas_id === kls) && (!q || (s.nama_lengkap + ' ' + s.NIS).toLowerCase().indexOf(q) > -1); })
        .sort(function (a, b) { return String(a.nama_lengkap).localeCompare(String(b.nama_lengkap), 'id'); }).slice(0, 300);
      $('#lbSiswa', el).innerHTML = list.length ? list.map(function (s) { return '<option value="' + esc(s.NIS) + '"' + (String(s.NIS) === st.NIS ? ' selected' : '') + '>' + esc(s.nama_lengkap) + ' — ' + esc(s.NIS) + (kls ? '' : ' (' + esc(kelasNama(s.kelas_id)) + ')') + '</option>'; }).join('') : '<option value="">Tidak ada siswa</option>';
      st.NIS = $('#lbSiswa', el).value;
    }
    function segarkan() {
      $$('#lbJenis button', el).forEach(function (b) { b.classList.toggle('on', b.dataset.j === st.jenis); });
      $$('#lbCak button', el).forEach(function (b) { b.classList.toggle('on', b.dataset.c === st.cakupan); });
      var per = st.cakupan === 'siswa';
      $('#lbSiswaF', el).hidden = !per; $('#lbCariF', el).hidden = !per;
      $('#lbAbs', el).hidden = st.jenis === 'nilai'; $('#lbNil', el).hidden = st.jenis === 'absensi';
      var r = $('#lbPer', el).value === 'rentang'; $('#lbDariF', el).hidden = !r; $('#lbSampaiF', el).hidden = !r;
    }
    $('#lbPer', el).value = st.periode; siswaList(); segarkan();
    $('#lbJenis', el).onclick = function (e) { var b = e.target.closest('[data-j]'); if (b) { st.jenis = b.dataset.j; segarkan(); } };
    $('#lbCak', el).onclick = function (e) { var b = e.target.closest('[data-c]'); if (b) { st.cakupan = b.dataset.c; segarkan(); } };
    $('#lbKelas', el).onchange = function () { st.kelas = this.value; siswaList(); };
    $('#lbCari', el).oninput = debounce(siswaList, 200);
    $('#lbSiswa', el).onchange = function () { st.NIS = this.value; };
    $('#lbPer', el).onchange = function () { st.periode = this.value; segarkan(); };
    function opsi() {
      var per = $('#lbPer', el).value, dari = '', sampai = '';
      if (per === 'rentang') { dari = $('#lbDari', el).value; sampai = $('#lbSampai', el).value; }
      else if (/^\d{4}-\d{2}$/.test(per)) { dari = per + '-01'; var akhir = new Date(Number(per.substring(0, 4)), Number(per.substring(5, 7)), 0).getDate(); sampai = per + '-' + String(akhir).padStart(2, '0'); if (sampai > todayStr()) sampai = todayStr(); }
      st.dari = dari; st.sampai = sampai;
      return { jenis: st.jenis, kelas_id: st.cakupan === 'semua' ? $('#lbKelas', el).value : '', NIS: st.cakupan === 'siswa' ? $('#lbSiswa', el).value : '', dari: dari, sampai: sampai, tahun_ajaran: $('#lbTa', el).value.trim(), semester: $('#lbSem', el).value };
    }
    async function jalan(format, btn) {
      var p = opsi();
      if (st.cakupan === 'siswa' && !p.NIS) return toast('Pilih siswa terlebih dulu.', 'warn');
      if (p.dari && p.sampai && p.dari > p.sampai) return toast('Tanggal awal harus sebelum tanggal akhir.', 'warn');
      btnBusy(btn, true); $('#lbSt', el).textContent = 'Menghitung rekap di server…';
      try {
        if ($('#lbSimpan', el) && $('#lbSimpan', el).checked) {
          var s0 = await api('laporan.ttd', { KEPALA_SEKOLAH: $('#lbKep', el).value, NIP_KEPALA_SEKOLAH: $('#lbNip', el).value, KOTA_LAPORAN: $('#lbKota', el).value });
          if (s0.success) { var c = (AppState.boot && AppState.boot.cfg) || {}; Object.assign(c, s0.data); }
        }
        var r = await api('laporan.rekap', p);
        if (!r.success) { toast(/tidak dikenal/i.test(r.message || '') ? 'Fitur laporan PDF/Excel membutuhkan backend v3.1: tempel Laporan.gs di Apps Script lalu Deploy → Edit → New version.' : r.message, 'bad'); $('#lbSt', el).textContent = ''; return; }
        var d = r.data;
        d.pembuat = AppState.nama || d.pembuat; d.dibuat = new Date().toISOString();   // hasil server bisa dari cache bersama → nama & waktu cetak dari pengguna ini
        $('#lbSt', el).textContent = 'Menyusun berkas ' + (format === 'pdf' ? 'PDF' : 'Excel') + '…';
        var k0 = d.kelas.length === 1 ? d.kelas[0].nama_kelas : 'Semua-Kelas', s0n = d.perorangan ? d.siswa[0] : null;
        var dasar = { absensi: 'Rekap-Absensi', nilai: 'Rekap-Nilai', lengkap: 'Laporan-Lengkap' }[d.jenis];
        var nama = lapNamaFile(dasar + '_' + (s0n ? s0n.nama + '_' + s0n.NIS : k0) + '_' + (d.jenis === 'nilai' ? d.tahun_ajaran.replace('/', '-') + '-' + d.semester : d.periode.dari + '_sd_' + d.periode.sampai));
        var o = { kepala: $('#lbKep', el).value.trim(), nip: $('#lbNip', el).value.trim(), kota: $('#lbKota', el).value.trim(), tglTtd: $('#lbTgl', el).value || todayStr(),
          warna: Brand.get().warna, logo: Brand.get().logo || d.sekolah.logo || LOGO, namaFile: nama, judulDok: dasar.replace(/-/g, ' ') + ' ' + (s0n ? s0n.nama : k0) };
        var n = format === 'pdf' ? await lapBuatPdf(d, o) : await lapBuatExcel(d, o);
        $('#lbSt', el).textContent = '✓ ' + nama + (format === 'pdf' ? '.pdf (' + n + ' halaman)' : '.xlsx (' + n + ' sheet)');
        toast('Berkas ' + (format === 'pdf' ? 'PDF' : 'Excel') + ' diunduh.', 'ok');
      } catch (e) { console.error(e); toast(e.message || 'Gagal membuat berkas.', 'bad'); $('#lbSt', el).textContent = ''; }
      finally { btnBusy(btn, false); }
    }
    $('#lbPdf', el).onclick = function () { jalan('pdf', this); };
    $('#lbXl', el).onclick = function () { jalan('excel', this); };
  }
};
