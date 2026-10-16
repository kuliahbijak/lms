/* =====================================================================
   SIAKAD SISWA v3.0 — lms-aktivitas.js : Penampil Aktivitas & Sumber Belajar
   Kuis (pemutar 7 tipe soal + seret-lepas ramah sentuh, timer, simpan otomatis,
   ulasan, penilaian esai), Tugas (+rubrik), Forum, Wiki, Glosarium, Workshop,
   Pelajaran interaktif, Umpan balik/survei, Kelas virtual, Berkas/Halaman/URL/Web.
   ===================================================================== */
'use strict';

daftarHalaman(['guru', 'siswa'], 'aktivitas', function () { return {
  title: 'Aktivitas', alwaysRender: true,
  render: function (el, mid) { if (!mid) { go('kursus'); return; } muatAktivitas(el, mid); }
}; });

/** v3.1: tandai cache kursus "basi" (bukan dihapus) → saat dibuka tampil seketika dari data terakhir, lalu langsung disegarkan dari server */
function lmsBasiLunak(kunci) { var c = Store.get(userKey(kunci), null); if (c) { c.t = 0; Store.set(userKey(kunci), c); } }
function lmsBasi(kid) { lmsBasiLunak('lms:kursus'); if (kid) lmsBasiLunak('lms:k:' + kid); }
/* v3.1 turbo: tampil SEKETIKA dari data kursus/cache perangkat, lalu dicocokkan dengan server.
   Isi aktivitas (kuis, tugas, …) & detail modul diminta di tik yang sama → 1 eksekusi batch. */
function tandaModul(m) { return JSON.stringify([m.judul, m.deskripsi, m.tipe, m.konten, m.kelola, m.buka, m.tutup, m.nilai_maks, m.penyelesaian, m.peran]); }
function metaAktivitas(m) {
  var meta = [tipeLabel(m.tipe)];
  if (m.tutup) meta.push((Date.now() > msDari(m.tutup) ? 'Ditutup ' : 'Tenggat ') + tglJam(m.tutup));
  if (!m.kelola && m.penyelesaian && m.penyelesaian.mode !== 'tidak') meta.push(m.status === 'gagal' ? '<span class="bad-t">Belum mencapai nilai minimal</span>' : m.status ? '<span class="ok-t">' + ic('circle-check') + 'Selesai</span>' : '<span class="muted">Belum selesai</span>');
  if (!m.kelola && m.nilai !== null && m.nilai !== undefined) meta.push('<b>Nilai ' + fmtN(m.nilai) + '%</b>');
  return meta.join(' • ');
}
function gambarAktivitas(el, m) {
  var mid = m.modul_id;
  document.title = m.judul + ' — ' + brandNama();
  el.innerHTML = '<div class="ak-head"><a href="#/kursus/' + esc(m.kursus_id) + '" class="kh-back">' + ic('arrow-left') + esc(m.kursus_nama) + '</a><div class="row gap12 mt8">' + tipeIkon(m.tipe, 'besar') + '<div class="grow"><h1>' + esc(m.judul) + '</h1><div class="mod-meta" id="akMeta">' + metaAktivitas(m) + '</div></div>' +
    (m.kelola ? '<button class="btn btn-outline btn-sm" id="akEdit">' + ic('settings') + '<span class="hide-m">Pengaturan</span></button>' : '') + '</div>' + (m.deskripsi ? '<div class="mt12">' + md(m.deskripsi) + '</div>' : '') + '</div><div id="akBody" class="mt16"></div>';
  if ($('#akEdit', el)) $('#akEdit', el).onclick = async function () {
    var c = Store.get(userKey('lms:k:' + m.kursus_id), null), k = c ? { success: true, data: c.data } : null;   // pakai data kursus yang sudah ada
    if (!k) { btnBusy(this, true); k = await api('lms.kursus.get', { kursus_id: m.kursus_id }); btnBusy(this, false); }
    if (k.success) editorModul(k.data, { modul: k.data.modul.filter(function (x) { return x.modul_id === mid; })[0] }, function () { lmsBasi(m.kursus_id); muatAktivitas(el, mid); });
  };
  var body = $('#akBody', el), v = VIEW[m.tipe] || VIEW._sumber;
  try { v(body, m, el); } catch (e) { console.error(e); body.innerHTML = errorBox(e.message); }
}
async function muatAktivitas(el, mid) {
  var kc = LC.kunci('lms.modul.get', { modul_id: mid }), c = LC.get(kc);
  var awal = c && Date.now() - c.t < LC.UMUR ? c.data : LmsIdx.m[mid];
  if (awal && awal.terkunci) awal = null;                          // terkunci → tunggu keputusan server
  if (awal) gambarAktivitas(el, awal);
  else el.innerHTML = '<div class="sk" style="height:110px"></div><div class="sk mt16" style="height:300px"></div>';
  var n0 = Interaksi.n;
  var r = await apiQ('lms.modul.get', { modul_id: mid });
  if (currentRoute().param !== mid) return;
  if (!r.success) { LC.hapus(function (k) { return k === kc; }); el.innerHTML = errorBox(r.message) + '<div class="mt16"><a class="btn btn-outline" href="#/kursus">' + ic('arrow-left') + 'Kembali ke kursus</a></div>'; return; }
  LC.set(kc, r.data);
  var m = r.data;
  if (!awal || (tandaModul(awal) !== tandaModul(m) && Interaksi.n === n0 && !adaIsian())) gambarAktivitas(el, m);
  else if ($('#akMeta', el)) { $('#akMeta', el).innerHTML = metaAktivitas(m); Object.assign(awal, { status: m.status, nilai: m.nilai }); }
}

var VIEW = {};
// =====================================================================
// SUMBER BELAJAR
// =====================================================================
VIEW._sumber = function (body, m) {
  var k = m.konten || {};
  if (m.tipe === 'berkas') {
    var b = k.berkas || {}, url = berkasPratinjau(b), pdf = /pdf/i.test(b.mime || b.nama), img = /image|png|jpe?g|gif|webp/i.test(b.mime || b.nama);
    body.innerHTML = '<div class="card"><div class="card-h"><div class="grow row gap8">' + ic(berkasIkon(b.nama)) + '<b class="ellipsis">' + esc(b.nama || 'Berkas') + '</b><span class="xs muted">' + esc(fmtSize(b.ukuran)) + '</span></div><a class="btn btn-primary btn-sm" href="' + esc(berkasUrl(b)) + '" target="_blank" rel="noopener"' + (DEMO && !b.url ? ' download="' + esc(b.nama) + '"' : '') + '>' + ic('download') + 'Buka / Unduh</a></div>' +
      (k.tampil !== 'unduh' && url ? (img ? '<div class="card-b tc"><img src="' + esc(url) + '" alt="' + esc(b.nama) + '" class="pratinjau-img"></div>' : (pdf || !DEMO ? '<iframe class="viewer-frame lms-frame" src="' + esc(url) + '" title="' + esc(b.nama) + '" loading="lazy"></iframe>' : '')) : '') + '</div>';
  } else if (m.tipe === 'folder') {
    body.innerHTML = '<div class="card card-p"><h3>' + ic('folder-open') + ' ' + (k.berkas || []).length + ' berkas</h3><div class="mt12">' + daftarBerkas(k.berkas) + '</div></div>';
  } else if (m.tipe === 'halaman' || m.tipe === 'label') {
    body.innerHTML = '<article class="card card-p bacaan">' + md(k.isi) + '</article>';
  } else if (m.tipe === 'url') {
    body.innerHTML = '<div class="card card-p"><div class="row gap12 wrap">' + ic('link') + '<a class="grow ellipsis" href="' + esc(k.url) + '" target="_blank" rel="noopener noreferrer">' + esc(k.url) + '</a><a class="btn btn-primary" href="' + esc(k.url) + '" target="_blank" rel="noopener noreferrer">' + ic('external-link') + 'Buka tautan</a></div></div>' +
      (k.buka === 'sematkan' ? '<iframe class="viewer-frame lms-frame mt16" src="' + esc(k.url) + '" title="' + esc(m.judul) + '" loading="lazy" referrerpolicy="no-referrer" sandbox="allow-scripts allow-same-origin allow-popups allow-forms"></iframe>' : '');
  } else if (m.tipe === 'web') {
    body.innerHTML = '<div class="card"><div class="card-h"><div class="grow small muted ellipsis">' + ic('globe') + esc(k.url) + '</div><a class="btn btn-outline btn-sm" href="' + esc(k.url) + '" target="_blank" rel="noopener noreferrer">' + ic('external-link') + 'Buka di tab baru</a></div><iframe class="lms-frame" style="height:' + Number(k.tinggi || 640) + 'px" src="' + esc(k.url) + '" title="' + esc(m.judul) + '" loading="lazy" referrerpolicy="no-referrer" sandbox="allow-scripts allow-same-origin allow-popups allow-forms"></iframe></div>';
  }
};

// =====================================================================
// KUIS
// =====================================================================
VIEW.kuis = function (body, m, el) {
  if (m.kelola) return kuisGuru(body, m, el);
  body.innerHTML = '<div class="sk" style="height:200px"></div>';
  apiLR('kuis.info', { modul_id: m.modul_id }, function (r) {
    if (!r.success) { body.innerHTML = errorBox(r.message); return; }
    var d = r.data, k = d.modul.konten, bisa = d.sudahBuka && !d.sudahTutup && (d.sisa === null || d.sisa > 0 || d.berjalan);
    body.innerHTML = '<div class="grid g-main"><div class="card card-p"><h3>' + ic('info') + ' Informasi Kuis</h3>' + (k.petunjuk ? md(k.petunjuk) : '') +
      '<dl class="kv-list mt12"><dt>Jumlah soal</dt><dd>' + k.jml_soal + '</dd><dt>Batas waktu</dt><dd>' + (k.waktu_menit ? k.waktu_menit + ' menit' : 'Tanpa batas') + '</dd><dt>Kesempatan</dt><dd>' + (k.percobaan_maks ? k.percobaan_maks + '× (sisa ' + d.sisa + ')' : 'Tak terbatas') + '</dd>' +
      '<dt>Nilai yang dipakai</dt><dd>' + esc({ tertinggi: 'Tertinggi', terakhir: 'Terakhir', rata: 'Rata-rata', pertama: 'Pertama' }[k.metode_nilai] || '-') + '</dd>' + (d.buka ? '<dt>Dibuka</dt><dd>' + tglJam(d.buka) + '</dd>' : '') + (d.tutup ? '<dt>Ditutup</dt><dd>' + tglJam(d.tutup) + '</dd>' : '') + '</dl>' +
      '<button class="btn btn-primary btn-lg mt16" id="kzMulai"' + (bisa ? '' : ' disabled') + '>' + ic(d.berjalan ? 'play' : 'circle-play') + (d.berjalan ? 'Lanjutkan Kuis' : d.percobaan.length ? 'Kerjakan Lagi' : 'Mulai Kuis') + '</button>' +
      (!d.sudahBuka ? '<div class="note warn mt12">' + ic('clock') + '<div>Kuis belum dibuka.</div></div>' : d.sudahTutup ? '<div class="note mt12">' + ic('lock') + '<div>Kuis sudah ditutup.</div></div>' : d.sisa === 0 && !d.berjalan ? '<div class="note mt12">' + ic('ban') + '<div>Kesempatan sudah habis.</div></div>' : '') + '</div>' +
      '<div class="card card-p tc"><div class="xs b muted">NILAI ANDA</div><div class="big-num">' + (d.nilaiAkhir === null ? '–' : fmtN(d.nilaiAkhir)) + '</div><div class="small muted">KKM ' + (k.nilai_lulus || 70) + '</div></div></div>' +
      (d.percobaan.length ? '<div class="card mt16"><div class="card-h"><h3>' + ic('history') + ' Riwayat Percobaan</h3></div><div class="tbl-wrap"><table class="tbl"><thead><tr><th>#</th><th>Selesai</th><th>Durasi</th><th class="tr">Nilai</th><th>Status</th><th></th></tr></thead><tbody>' +
        d.percobaan.map(function (p) { return '<tr><td>' + p.no + '</td><td class="small">' + tglJam(p.selesai) + (p.terlambat ? ' <span class="bdg warn">auto</span>' : '') + '</td><td class="small">' + durasi(p.durasi_detik) + '</td><td class="tr"><b>' + (p.persen === null ? '-' : fmtN(p.persen)) + '</b><span class="xs muted"> (' + fmtN(p.nilai) + '/' + p.nilai_maks + ')</span></td><td>' + (p.status === 'perlu_dinilai' ? '<span class="bdg amber">Esai dinilai guru</span>' : '<span class="bdg ok">Selesai</span>') + '</td><td><button class="btn btn-ghost btn-xs" data-ul="' + esc(p.percobaan_id) + '">Ulasan</button></td></tr>'; }).join('') + '</tbody></table></div></div>' : '');
    $('#kzMulai', body).onclick = async function () { btnBusy(this, true); var s = await api('kuis.mulai', { modul_id: m.modul_id }); btnBusy(this, false); if (!s.success) return toast(s.message, 'bad'); kuisPemutar(body, s.data, m, function () { lmsBasi(m.kursus_id); }); };
    body.onclick = function (e) { var b = e.target.closest('[data-ul]'); if (b) kuisUlasanModal(b.dataset.ul, false); };
  });
};
function kuisGuru(body, m, el) {
  body.innerHTML = '<div class="tabs" id="kgTab"><button data-t="soal" class="on">' + ic('list-checks') + 'Soal</button><button data-t="cob">' + ic('users') + 'Percobaan Siswa</button><button data-t="ana">' + ic('chart-column') + 'Analisis Butir</button><button data-t="pre">' + ic('eye') + 'Pratinjau</button></div><div id="kgBody" class="mt16"></div>';
  var box = $('#kgBody', body);
  function tab(t) {
    $$('#kgTab button', body).forEach(function (b) { b.classList.toggle('on', b.dataset.t === t); });
    box.innerHTML = '<div class="sk" style="height:200px"></div>';
    if (t === 'soal') apiLR('kuis.info', { modul_id: m.modul_id }, function (r) {
      if (!r.success) { box.innerHTML = errorBox(r.message); return; }
      var k = r.data.modul.konten;
      box.innerHTML = '<div class="card"><div class="card-h"><div class="grow"><h3>' + r.data.soal.length + ' soal • total skor ' + r.data.soal.reduce(function (s, q) { return s + Number(q.skor); }, 0) + '</h3><p>' + (k.waktu_menit ? k.waktu_menit + ' menit • ' : '') + (k.percobaan_maks ? k.percobaan_maks + '× kesempatan • ' : '') + (k.acak_soal ? 'soal diacak • ' : '') + r.data.percobaan + ' percobaan</p></div><a class="btn btn-outline btn-sm" href="#/banksoal/' + esc(m.kursus_id) + '">' + ic('list-checks') + 'Bank soal</a></div>' +
        r.data.soal.map(function (q, i) { return '<div class="soal-ring"><span class="bdg navy">' + (i + 1) + '</span><span class="bdg">' + esc(SOAL_LBL[q.tipe] || '?') + '</span><div class="grow">' + (q.hilang ? '<i class="bad-t">Soal dihapus dari bank</i>' : esc(q.teks)) + '</div><span class="xs muted">' + q.skor + ' poin</span></div>'; }).join('') + '</div>';
    });
    else if (t === 'cob') apiLR('kuis.percobaan', { modul_id: m.modul_id }, function (r) {
      if (!r.success) { box.innerHTML = errorBox(r.message); return; }
      var d = r.data, sdh = d.siswa.filter(function (s) { return s.percobaan.length; });
      box.innerHTML = '<div class="grid g4">' + kpi('Sudah mengerjakan', sdh.length + '<small>/' + d.siswa.length + '</small>', '', 'users', 'info') + kpi('Perlu dinilai', d.perluDinilai, 'jawaban esai', 'pen-line', d.perluDinilai ? 'amber' : '') +
        kpi('Rata-rata', fmtN(avg(sdh.map(function (s) { return s.nilai; }).filter(function (x) { return x !== null; }))), 'nilai akhir', 'chart-line') + kpi('Durasi rata-rata', durasi(avg([].concat.apply([], sdh.map(function (s) { return s.percobaan.map(function (p) { return p.durasi_detik; }); })))), 'per percobaan', 'timer') + '</div>' +
        '<div class="card mt16"><div class="card-h"><h3 class="grow">Percobaan per siswa</h3><button class="btn btn-outline btn-sm" id="kgCsv">' + ic('download') + 'CSV</button></div><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Siswa</th><th>Percobaan</th><th class="tr">Nilai akhir</th></tr></thead><tbody>' +
        d.siswa.map(function (s) { return '<tr><td><b>' + esc(s.nama) + '</b></td><td>' + (s.percobaan.length ? s.percobaan.map(function (p) { return '<button class="chip ' + (p.status === 'perlu_dinilai' ? 'amber' : '') + '" data-ul="' + esc(p.percobaan_id) + '" title="' + esc(tglJam(p.selesai) + ' • ' + durasi(p.durasi_detik)) + '">#' + p.no + ' ' + (p.status === 'perlu_dinilai' ? ic('pen-line') + 'nilai esai' : fmtN(p.persen) + '%') + ' <span class="xs muted">' + durasi(p.durasi_detik) + '</span></button>'; }).join(' ') : '<span class="muted small">Belum mengerjakan</span>') + '</td><td class="tr"><b>' + (s.nilai === null ? '-' : fmtN(s.nilai)) + '</b></td></tr>'; }).join('') + '</tbody></table></div></div>';
      $('#kgCsv', box).onclick = function () { downloadCSV('kuis-' + m.modul_id + '.csv', ['Siswa', 'Percobaan', 'Nilai %', 'Durasi (detik)', 'Status', 'Nilai akhir'], [].concat.apply([], d.siswa.map(function (s) { return s.percobaan.length ? s.percobaan.map(function (p) { return [s.nama, p.no, p.persen, p.durasi_detik, p.status, s.nilai]; }) : [[s.nama, '', '', '', 'belum', '']]; }))); };
      box.onclick = function (e) { var b = e.target.closest('[data-ul]'); if (b) kuisUlasanModal(b.dataset.ul, true, function () { tab('cob'); }); };
    });
    else if (t === 'ana') apiLR('kuis.percobaan', { modul_id: m.modul_id }, function (r) {
      if (!r.success) { box.innerHTML = errorBox(r.message); return; }
      box.innerHTML = '<div class="card card-p"><h3>' + ic('chart-column') + ' Analisis Butir Soal</h3><p class="small muted">Persentase siswa menjawab benar & rata-rata skor per soal. Soal di bawah 40% patut ditinjau.</p>' +
        (r.data.analisis.length ? r.data.analisis.map(function (a, i) { return '<div class="ana-i"><div class="row"><span class="bdg">' + (i + 1) + '</span><span class="grow small clamp2">' + esc(a.teks) + '</span><b class="' + (a.persenBenar < 40 ? 'bad-t' : a.persenBenar >= 75 ? 'ok-t' : '') + '">' + a.persenBenar + '%</b></div>' + barProgres(a.persenBenar, a.persenBenar < 40 ? 'bad' : a.persenBenar >= 75 ? 'ok' : '') + '<div class="xs muted">' + a.n + ' jawaban • rata skor ' + a.rataSkor + '% • ' + esc(SOAL_LBL[a.tipe] || '') + '</div></div>'; }).join('') : emptyHtml('Belum ada data', '', 'chart-column')) + '</div>';
    });
    else if (t === 'pre') { box.innerHTML = '<div class="card card-p tc"><p>Coba kuis sebagai siswa. Jawaban tidak disimpan.</p><button class="btn btn-primary" id="kgPre">' + ic('play') + 'Mulai pratinjau</button></div>'; $('#kgPre', box).onclick = async function () { var s = await api('kuis.mulai', { modul_id: m.modul_id }); if (!s.success) return toast(s.message, 'bad'); kuisPemutar(box, s.data, m, function () {}); }; }
  }
  $$('#kgTab button', body).forEach(function (b) { b.onclick = function () { tab(b.dataset.t); }; });
  tab('soal');
}
function avg(a) { return a.length ? a.reduce(function (s, x) { return s + Number(x); }, 0) / a.length : null; }

/** Pemutar kuis: satu soal per layar, navigator, timer server, simpan otomatis */
function kuisPemutar(wadah, d, m, selesaiCb) {
  var jw = Object.assign({}, d.jawaban || {}), idx = 0, n = d.soal.length, offset = (d.sekarang || Date.now()) - Date.now(), lsKey = userKey('kuis:' + hashStr(d.tiket)), timer = null, simpanT = null, kirimSedang = false;
  try { var lokal = Store.get(lsKey, null); if (lokal) Object.keys(lokal).forEach(function (k) { if (jw[k] === undefined) jw[k] = lokal[k]; }); } catch (e) {}
  wadah.innerHTML = '<div class="kz-wrap"><div class="kz-top card"><div class="grow"><b>' + esc(d.judul) + '</b><div class="xs muted">' + (d.pratinjau ? 'PRATINJAU — jawaban tidak disimpan' : 'Percobaan ke-' + d.no) + ' • <span id="kzDij"></span></div></div>' + (d.batas ? '<div class="kz-timer" id="kzTimer">' + ic('timer') + '<span>--:--</span></div>' : '') + '<span class="xs muted" id="kzSimpan"></span></div>' +
    '<div class="kz-nav" id="kzNav"></div><div class="card kz-soal" id="kzSoal"></div><div class="row between mt12"><button class="btn btn-outline" id="kzPrev">' + ic('arrow-left') + 'Sebelumnya</button><button class="btn btn-outline" id="kzNext">Berikutnya' + ic('arrow-right') + '</button></div>' +
    '<div class="tc mt16"><button class="btn btn-dark btn-lg" id="kzKirim">' + ic('send') + 'Selesai & Kirim Jawaban</button></div></div>';
  function terjawab(q) { var v = jw[q.id]; if (v === undefined || v === null || v === '') return false; if (Array.isArray(v)) return v.length > 0; if (typeof v === 'object') return Object.keys(v).length > 0; return true; }
  function nav() {
    $('#kzNav', wadah).innerHTML = d.soal.map(function (q, i) { return '<button class="' + (i === idx ? 'on ' : '') + (terjawab(q) ? 'isi' : '') + '" data-i="' + i + '">' + (i + 1) + '</button>'; }).join('');
    $('#kzDij', wadah).textContent = d.soal.filter(terjawab).length + '/' + n + ' terjawab';
    $('#kzPrev', wadah).disabled = idx === 0; $('#kzNext', wadah).disabled = idx === n - 1;
  }
  function ubah() { Store.set(lsKey, jw); nav(); clearTimeout(simpanT); simpanT = setTimeout(simpan, 2500); }
  async function simpan() {
    if (d.pratinjau || kirimSedang) return;
    var s = $('#kzSimpan', wadah); if (s) s.textContent = 'menyimpan…';
    var r = await api('kuis.simpan', { tiket: d.tiket, jawaban: jw });
    if (s) s.textContent = r.success ? '✓ tersimpan ' + nowHM() : '⚠ belum tersimpan';
  }
  function gambar() {
    var q = d.soal[idx], v = jw[q.id], h2 = '<div class="row between"><span class="bdg navy">Soal ' + (idx + 1) + ' dari ' + n + '</span><span class="xs muted">' + esc(SOAL_LBL[q.tipe] || '') + ' • ' + q.skor + ' poin</span></div>' + (q.teks && q.tipe !== 'dragdrop' ? '<div class="kz-teks">' + md(q.teks) + '</div>' : '');
    if (q.tipe === 'pg' || q.tipe === 'pgk') {
      h2 += (q.multi ? '<div class="xs muted mb8">Pilih semua jawaban yang benar.</div>' : '') + '<div class="kz-opsi">' + q.opsi.map(function (o, i) { var on = q.multi ? (Array.isArray(v) && v.indexOf(o.id) > -1) : v === o.id; return '<label class="kz-o' + (on ? ' on' : '') + '"><input type="' + (q.multi ? 'checkbox' : 'radio') + '" name="kzq" value="' + esc(o.id) + '"' + (on ? ' checked' : '') + '><span class="kz-huruf">' + String.fromCharCode(65 + i) + '</span><span class="grow">' + md(o.teks) + '</span></label>'; }).join('') + '</div>';
    } else if (q.tipe === 'bs') {
      h2 += '<div class="kz-bs"><button class="' + (v === true ? 'on' : '') + '" data-bs="1">' + ic('check') + 'Benar</button><button class="' + (v === false ? 'on' : '') + '" data-bs="0">' + ic('x') + 'Salah</button></div>';
    } else if (q.tipe === 'cocok') {
      v = v || {};
      h2 += '<div class="kz-cocok">' + q.kiri.map(function (k, i) { return '<div class="kz-c"><div class="kz-ck">' + esc(k) + '</div><span class="muted">' + ic('arrow-right') + '</span><select class="sel" data-ck="' + i + '"><option value="">— pilih —</option>' + q.kanan.map(function (o) { return '<option value="' + esc(o.id) + '"' + (v[i] === o.id ? ' selected' : '') + '>' + esc(o.teks) + '</option>'; }).join('') + '</select></div>'; }).join('') + '</div>';
    } else if (q.tipe === 'singkat') {
      h2 += '<input class="inp kz-singkat" id="kzS" value="' + esc(v || '') + '" placeholder="Ketik jawaban singkat…" autocomplete="off">';
    } else if (q.tipe === 'esai') {
      h2 += '<textarea class="inp" id="kzE" rows="8" placeholder="Tulis jawaban Anda…">' + esc(v || '') + '</textarea><div class="xs muted mt4" id="kzKata"></div>';
    } else if (q.tipe === 'dragdrop') {
      v = v || {}; var dipakai = {}; Object.keys(v).forEach(function (g) { dipakai[v[g]] = 1; });
      var byId = {}; q.pilihan.forEach(function (p) { byId[p.id] = p.teks; });
      h2 += '<div class="xs muted mb8">' + (q.teks && q.teks !== '(isi bagian yang kosong)' ? esc(q.teks) + ' — ' : '') + 'Seret pilihan ke kotak kosong, atau ketuk pilihan lalu ketuk kotaknya.</div><div class="dd-teks">' + q.bagian.map(function (b) { return b.gap ? '<span class="dd-gap' + (v[b.gap] ? ' isi' : '') + '" data-gap="' + b.gap + '" tabindex="0">' + (v[b.gap] ? esc(byId[v[b.gap]] || '?') + '<i data-lepas="' + b.gap + '">×</i>' : '&nbsp;') + '</span>' : esc(b.t); }).join('') + '</div>' +
        '<div class="dd-pilihan">' + q.pilihan.map(function (p) { return '<span class="dd-chip' + (dipakai[p.id] ? ' dipakai' : '') + '" draggable="' + (dipakai[p.id] ? 'false' : 'true') + '" data-chip="' + esc(p.id) + '">' + esc(p.teks) + '</span>'; }).join('') + '</div>';
    }
    var box = $('#kzSoal', wadah); box.innerHTML = h2;
    if (q.tipe === 'esai') { var hk = function () { var t = $('#kzE', box).value.trim(), nk = t ? t.split(/\s+/).length : 0; $('#kzKata', box).textContent = nk + ' kata' + (q.min_kata ? ' (minimal ' + q.min_kata + ')' : ''); }; hk(); $('#kzE', box).oninput = function () { jw[q.id] = this.value; hk(); ubah(); }; }
    if (q.tipe === 'singkat') $('#kzS', box).oninput = function () { jw[q.id] = this.value; ubah(); };
    nav();
  }
  var pilihChip = null;
  function isiGap(q, gap, chip) { var v = jw[q.id] = Object.assign({}, jw[q.id] || {}); Object.keys(v).forEach(function (g) { if (v[g] === chip) delete v[g]; }); v[gap] = chip; pilihChip = null; ubah(); gambar(); }
  wadah.addEventListener('change', function (e) {
    var q = d.soal[idx];
    if (e.target.name === 'kzq') { if (q.multi) jw[q.id] = $$('input[name=kzq]:checked', wadah).map(function (x) { return x.value; }); else jw[q.id] = e.target.value; $$('.kz-o', wadah).forEach(function (l) { l.classList.toggle('on', $('input', l).checked); }); ubah(); }
    if (e.target.dataset.ck !== undefined) { var v = jw[q.id] = Object.assign({}, jw[q.id] || {}); if (e.target.value) v[e.target.dataset.ck] = e.target.value; else delete v[e.target.dataset.ck]; ubah(); }
  });
  wadah.addEventListener('click', function (e) {
    var q = d.soal[idx], t = e.target;
    var nb = t.closest('#kzNav button'); if (nb) { idx = Number(nb.dataset.i); gambar(); return; }
    if (t.closest('#kzPrev')) { if (idx > 0) { idx--; gambar(); } return; }
    if (t.closest('#kzNext')) { if (idx < n - 1) { idx++; gambar(); } return; }
    var bs = t.closest('[data-bs]'); if (bs) { jw[q.id] = bs.dataset.bs === '1'; ubah(); gambar(); return; }
    var lepas = t.closest('[data-lepas]'); if (lepas) { e.stopPropagation(); var v = Object.assign({}, jw[q.id] || {}); delete v[lepas.dataset.lepas]; jw[q.id] = v; ubah(); gambar(); return; }
    var chip = t.closest('[data-chip]'); if (chip && !chip.classList.contains('dipakai')) { pilihChip = chip.dataset.chip; $$('.dd-chip', wadah).forEach(function (c) { c.classList.toggle('pilih', c === chip); }); return; }
    var gap = t.closest('[data-gap]'); if (gap && pilihChip) { isiGap(q, gap.dataset.gap, pilihChip); return; }
    if (t.closest('#kzKirim')) kirim(false);
  });
  wadah.addEventListener('dragstart', function (e) { var c = e.target.closest && e.target.closest('[data-chip]'); if (c) { e.dataTransfer.setData('text/plain', c.dataset.chip); e.dataTransfer.effectAllowed = 'move'; } });
  wadah.addEventListener('dragover', function (e) { if (e.target.closest && e.target.closest('[data-gap]')) { e.preventDefault(); e.target.closest('[data-gap]').classList.add('over'); } });
  wadah.addEventListener('dragleave', function (e) { var g = e.target.closest && e.target.closest('[data-gap]'); if (g) g.classList.remove('over'); });
  wadah.addEventListener('drop', function (e) { var g = e.target.closest && e.target.closest('[data-gap]'); if (g) { e.preventDefault(); isiGap(d.soal[idx], g.dataset.gap, e.dataTransfer.getData('text/plain')); } });
  async function kirim(otomatis) {
    if (kirimSedang) return;
    var kosong = d.soal.filter(function (q) { return !terjawab(q); }).length;
    if (!otomatis && !await confirmBox((kosong ? kosong + ' soal belum dijawab. ' : 'Semua soal sudah dijawab. ') + 'Kirim jawaban sekarang? Jawaban tidak dapat diubah setelah dikirim.', { ok: 'Kirim' })) return;
    kirimSedang = true; clearInterval(timer); clearTimeout(simpanT);
    var b = $('#kzKirim', wadah); if (b) btnBusy(b, true);
    var r = await api('kuis.kirim', { tiket: d.tiket, jawaban: jw });
    if (!r.success) { kirimSedang = false; if (b) btnBusy(b, false); return toast(r.message, 'bad'); }
    Store.del(lsKey);
    selesaiCb && selesaiCb(r.data);
    kuisHasil(wadah, r.data, m);
  }
  if (d.batas) {
    var tick = function () {
      var sisa = d.batas - (Date.now() + offset), el2 = $('#kzTimer span', wadah); if (!el2) { clearInterval(timer); return; }
      el2.textContent = jamDetik(sisa); $('#kzTimer', wadah).classList.toggle('kritis', sisa < 60000);
      if (sisa <= 0) { clearInterval(timer); toast('Waktu habis — jawaban dikirim otomatis.', 'warn'); kirim(true); }
    };
    tick(); timer = setInterval(tick, 1000);
  }
  var simpanBerkala = setInterval(function () { if (!$('#kzSoal', wadah)) { clearInterval(simpanBerkala); clearInterval(timer); return; } if (!document.hidden) simpan(); }, 30000);
  if (d.lanjut) toast('Melanjutkan percobaan yang belum selesai.', 'warn');
  gambar();
}
function kuisHasil(wadah, r, m) {
  var lulus = r.persen >= ((m.konten || {}).nilai_lulus || 70);
  wadah.innerHTML = '<div class="card card-p tc kz-hasil"><div class="kz-skor ' + (r.manual ? '' : lulus ? 'ok' : 'warn') + '">' + fmtN(r.persen) + '<small>%</small></div><h3>' + (r.pratinjau ? 'Pratinjau selesai' : r.manual ? 'Jawaban terkirim — esai menunggu penilaian guru' : lulus ? 'Selamat, Anda tuntas!' : 'Jawaban terkirim') + '</h3>' +
    '<div class="small muted">Skor ' + fmtN(r.nilai) + ' dari ' + r.maks + ' • durasi ' + durasi(r.durasi_detik) + (r.terlambat ? ' • melewati batas waktu' : '') + '</div><div class="row wrap gap8 mt16" style="justify-content:center"><a class="btn btn-outline" href="#/kursus/' + esc(m.kursus_id) + '">' + ic('arrow-left') + 'Kembali ke kursus</a><button class="btn btn-primary" id="kzUlang">' + ic('rotate-ccw') + 'Muat ulang aktivitas</button></div></div>' +
    (r.ulasan ? '<div class="card mt16"><div class="card-h"><h3>' + ic('clipboard-check') + ' Ulasan Jawaban</h3></div><div class="card-b">' + r.ulasan.map(ulasanHtml).join('') + '</div></div>' : (!r.lihatJawaban ? '<div class="note mt16">' + ic('eye-off') + '<div>Kunci jawaban ditampilkan sesuai pengaturan guru.</div></div>' : ''));
  $('#kzUlang', wadah).onclick = function () { muatAktivitas($('.page[data-page="aktivitas"]'), m.modul_id); };
}
function ulasanHtml(u, i) {
  var st = u.manual ? '<span class="bdg amber">Menunggu dinilai</span>' : u.benar ? '<span class="bdg ok">' + ic('check') + 'Benar</span>' : u.skorDapat > 0 ? '<span class="bdg warn">Sebagian</span>' : '<span class="bdg bad">' + ic('x') + 'Salah</span>';
  var h2 = '<div class="ul-i"><div class="row between"><b>Soal ' + (i + 1) + '</b><span class="row gap8">' + st + '<span class="xs muted">' + fmtN(u.skorDapat) + '/' + u.skor + '</span></span></div>' + (u.tipe !== 'dragdrop' ? '<div class="kz-teks">' + md(u.teks) + '</div>' : '');
  var j = u.jawaban;
  if (u.tipe === 'pg' || u.tipe === 'pgk') {
    var kunci = Array.isArray(u.kunci) ? u.kunci : [u.kunci], pilih = Array.isArray(j) ? j : [j];
    h2 += '<div class="kz-opsi">' + u.opsi.map(function (o) { var p = pilih.indexOf(o.id) > -1, k = kunci.indexOf(o.id) > -1; return '<div class="kz-o ulas' + (k ? ' kunci' : '') + (p && !k ? ' salah' : '') + (p ? ' on' : '') + '">' + ic(k ? 'circle-check' : p ? 'circle-x' : 'circle') + '<span class="grow">' + md(o.teks) + (u.umpanOpsi && u.umpanOpsi[o.id] && (p || k) ? '<div class="xs muted">' + esc(u.umpanOpsi[o.id]) + '</div>' : '') + '</span></div>'; }).join('') + '</div>';
  } else if (u.tipe === 'bs') h2 += '<div class="small">Jawaban Anda: <b>' + (j === true ? 'Benar' : j === false ? 'Salah' : '-') + '</b> • Kunci: <b>' + (u.kunci ? 'Benar' : 'Salah') + '</b></div>';
  else if (u.tipe === 'cocok') { var kn = {}; u.kanan.forEach(function (o) { kn[o.id] = o.teks; }); h2 += '<table class="tbl kecil"><tbody>' + u.kiri.map(function (k, x) { var jj = j && j[x], ok = jj === 'k' + x; return '<tr><td>' + esc(k) + '</td><td>' + (jj ? esc(kn[jj] || '?') : '<i class="muted">kosong</i>') + '</td><td>' + (ok ? '<span class="ok-t">' + ic('check') + '</span>' : '<span class="bad-t">' + ic('x') + '</span> <span class="xs">' + esc(kn['k' + x]) + '</span>') + '</td></tr>'; }).join('') + '</tbody></table>'; }
  else if (u.tipe === 'singkat') h2 += '<div class="small">Jawaban Anda: <b>' + esc(j || '-') + '</b> • Diterima: <b>' + esc((u.kunci || []).join(' / ')) + '</b></div>';
  else if (u.tipe === 'esai') h2 += '<div class="esai-jwb">' + (j ? esc(j).replace(/\n/g, '<br>') : '<i class="muted">Tidak dijawab</i>') + '</div>' + (u.komentar ? '<div class="note mt8">' + ic('message-circle') + '<div><b>Komentar guru:</b> ' + esc(u.komentar) + '</div></div>' : '');
  else if (u.tipe === 'dragdrop') { var by = {}; u.pilihan.forEach(function (p) { by[p.id] = p.teks; }); h2 += '<div class="dd-teks">' + u.bagian.map(function (b) { if (!b.gap) return esc(b.t); var jj = j && j[b.gap], ok = jj === u.kunci[b.gap]; return '<span class="dd-gap isi ' + (ok ? 'benar' : 'salah') + '">' + esc(jj ? by[jj] : '…') + (ok ? '' : ' <small>(' + esc(by[u.kunci[b.gap]]) + ')</small>') + '</span>'; }).join('') + '</div>'; }
  if (u.umpan_balik) h2 += '<div class="note mt8">' + ic('lightbulb') + '<div>' + esc(u.umpan_balik) + '</div></div>';
  return h2 + '</div>';
}
async function kuisUlasanModal(pid, guru, onSave) {
  var r = await api('kuis.ulasan', { percobaan_id: pid });
  if (!r.success) return toast(r.message, 'bad');
  var d = r.data, esai = (d.ulasan || []).filter(function (u) { return u.tipe === 'esai'; });
  var m = modal({ title: 'Ulasan Percobaan #' + d.no + (guru ? ' — ' + d.nama : ''), sub: tglJam(d.selesai) + ' • ' + durasi(d.durasi_detik) + ' • nilai ' + fmtN(d.persen) + '%', size: 'lg',
    body: (d.ulasan ? d.ulasan.map(function (u, i) {
      var h2 = ulasanHtml(u, i);
      if (guru && u.tipe === 'esai') h2 += '<div class="esai-nilai card card-p"><div class="xs b muted">NILAI ESAI</div>' + (u.panduan ? '<div class="small muted">' + ic('book-open') + ' ' + esc(u.panduan) + '</div>' : '') + '<div class="row gap8 mt8"><input class="inp" type="number" min="0" max="' + u.skor + '" step="0.5" data-esai="' + esc(u.id) + '" value="' + (u.manual ? '' : u.skorDapat) + '" style="width:100px"><span class="small">/ ' + u.skor + '</span><input class="inp grow" data-kom="' + esc(u.id) + '" value="' + esc(u.komentar || '') + '" placeholder="Komentar untuk siswa"></div></div>';
      return h2;
    }).join('') : '<div class="note">' + ic('eye-off') + '<div>Ulasan belum dapat ditampilkan sesuai pengaturan kuis.</div></div>'),
    foot: guru && esai.length ? '<button class="btn btn-outline" data-x>Tutup</button><button class="btn btn-primary" id="ulSimpan">' + ic('save') + 'Simpan nilai esai</button>' : '<button class="btn btn-outline" data-x>Tutup</button>' });
  if ($('#ulSimpan', m.el)) $('#ulSimpan', m.el).onclick = async function () {
    var nilai = {}, kom = {};
    $$('[data-esai]', m.el).forEach(function (x) { if (x.value !== '') nilai[x.dataset.esai] = Number(x.value); });
    $$('[data-kom]', m.el).forEach(function (x) { kom[x.dataset.kom] = x.value; });
    btnBusy(this, true); var s = await api('kuis.nilaiEsai', { percobaan_id: pid, nilai: nilai, komentar: kom }); btnBusy(this, false);
    if (toastRes(s)) { m.close(); onSave && onSave(); }
  };
}

// =====================================================================
// TUGAS
// =====================================================================
function rubrikTabel(rub, pilih, interaktif) {
  if (!rub) return '';
  pilih = pilih || {};
  if (rub.jenis === 'panduan') return '<table class="tbl rubrik"><thead><tr><th>Kriteria</th><th style="width:120px">Skor</th></tr></thead><tbody>' + rub.kriteria.map(function (k) { return '<tr><td><b>' + esc(k.nama) + '</b>' + (k.deskripsi ? '<div class="xs muted">' + esc(k.deskripsi) + '</div>' : '') + '</td><td>' + (interaktif ? '<input class="inp" type="number" min="0" max="' + k.maks + '" data-rk="' + esc(k.id) + '" value="' + esc(pilih[k.id] !== undefined ? pilih[k.id] : '') + '" style="width:80px"> / ' + k.maks : (pilih[k.id] !== undefined ? '<b>' + fmtN(pilih[k.id]) + '</b> / ' : 'maks ') + k.maks) + '</td></tr>'; }).join('') + '</tbody></table>';
  var maxLv = Math.max.apply(null, rub.kriteria.map(function (k) { return k.level.length; }));
  return '<div class="tbl-wrap"><table class="tbl rubrik"><tbody>' + rub.kriteria.map(function (k) {
    return '<tr><th>' + esc(k.nama) + '</th>' + k.level.map(function (l, i) { var on = String(pilih[k.id]) === String(i); return '<td class="rb-sel' + (on ? ' on' : '') + (interaktif ? ' klik' : '') + '" data-rk="' + esc(k.id) + '" data-lv="' + i + '"><b>' + fmtN(l.skor) + '</b><div class="xs">' + esc(l.deskripsi) + '</div></td>'; }).join('') + '<td colspan="' + (maxLv - k.level.length) + '" class="kosong"></td></tr>';
  }).join('') + '</tbody></table></div>';
}
VIEW.tugas = function (body, m) {
  if (m.kelola) return tugasGuru(body, m);
  body.innerHTML = '<div class="sk" style="height:240px"></div>';
  apiLR('tugas.get', { modul_id: m.modul_id }, function (r) {
    if (!r.success) { body.innerHTML = errorBox(r.message); return; }
    var d = r.data, k = d.modul.konten, t = d.kiriman || {}, tutup = msDari(m.tutup), lewat = tutup && Date.now() > tutup, dinilai = t.status === 'dinilai', terkirim = t.status === 'terkirim';
    var stat = dinilai ? '<span class="bdg ok">' + ic('award') + 'Dinilai</span>' : terkirim ? '<span class="bdg info">' + ic('check') + 'Terkirim' + (t.terlambat ? ' (terlambat)' : '') + '</span>' : '<span class="bdg amber">Belum dikumpulkan</span>';
    body.innerHTML = '<div class="grid g-main"><div class="stack">' + (k.petunjuk ? '<div class="card card-p bacaan"><h3>' + ic('clipboard-list') + ' Petunjuk</h3>' + md(k.petunjuk) + '</div>' : '') +
      (d.rubrik ? '<div class="card card-p"><h3>' + ic('grid-3x3') + ' ' + esc(d.rubrik.nama) + '</h3><p class="xs muted">Tugas dinilai dengan ' + (d.rubrik.jenis === 'panduan' ? 'panduan penilaian' : 'rubrik') + ' berikut.</p>' + rubrikTabel(d.rubrik, dinilai && t.rincian_nilai ? (t.rincian_nilai.pilih || {}) : {}, false) + '</div>' : '') +
      '<div class="card card-p" id="tgForm"></div></div>' +
      '<div class="stack"><div class="card card-p"><div class="xs b muted">STATUS</div><div class="mt8">' + stat + '</div>' + (m.tutup ? '<div class="mt12 small">' + ic('calendar-clock') + ' Batas: <b>' + tglJam(m.tutup) + '</b><div class="' + (lewat ? 'bad-t' : 'muted') + ' xs">' + (lewat ? 'Sudah lewat' + (k.terlambat_boleh !== false ? ' — masih bisa dikirim (terlambat)' : '') : 'Sisa ' + sisaWaktu(tutup - Date.now())) + '</div></div>' : '') +
      (t.dikirim_pada ? '<div class="small mt8">Dikirim ' + tglJam(t.dikirim_pada) + '<div class="xs muted">Durasi pengerjaan ' + durasi(t.durasi_detik) + '</div></div>' : '') + (d.grup ? '<div class="small mt12">' + ic('users-round') + ' Tugas kelompok — <b>' + esc(d.grup.nama) + '</b><div class="xs muted">' + esc(d.grup.anggota.join(', ')) + '</div></div>' : '') + '</div>' +
      (dinilai ? '<div class="card card-p tc"><div class="xs b muted">NILAI</div><div class="big-num">' + fmtN(t.nilai) + '<small>/' + (d.modul.nilai_maks || 100) + '</small></div>' + (t.umpan_balik ? '<div class="note mt8 tl">' + ic('message-circle') + '<div><b>Umpan balik ' + esc(t.dinilai_oleh) + ':</b> ' + esc(t.umpan_balik) + '</div></div>' : '') + '</div>' : (t.umpan_balik ? '<div class="note warn">' + ic('rotate-ccw') + '<div><b>Perlu revisi:</b> ' + esc(t.umpan_balik) + '</div></div>' : '')) + '</div></div>';
    var f = $('#tgForm', body);
    if (d.tanpaGrup) { f.innerHTML = '<div class="note warn">' + ic('users-round') + '<div>Ini tugas kelompok, tetapi Anda belum masuk grup. Hubungi guru.</div></div>'; return; }
    if (dinilai) { f.innerHTML = '<h3>' + ic('file-check') + ' Kiriman Anda</h3>' + (t.teks ? '<div class="esai-jwb mt8">' + md(t.teks) + '</div>' : '') + '<div class="mt8">' + daftarBerkas(t.berkas, { kosong: false }) + '</div>'; return; }
    var bolehTeks = k.tipe_kirim !== 'berkas', bolehBerkas = k.tipe_kirim !== 'teks', baru = [];
    f.innerHTML = '<h3>' + ic('upload') + (terkirim ? ' Kiriman Anda (dapat diperbarui sampai dinilai)' : ' Kumpulkan Tugas') + '</h3>' +
      (bolehTeks ? '<div class="field mt12"><label>Jawaban teks</label><textarea class="inp" id="tgTeks" rows="7">' + esc(t.teks || '') + '</textarea></div>' : '') +
      (bolehBerkas ? '<div class="field mt12"><label>Berkas (maks ' + (k.maks_berkas || 3) + ')</label>' + daftarBerkas(t.berkas, { hapus: true, kosong: false }) + '<button class="btn btn-outline btn-sm mt8" id="tgPilih">' + ic('paperclip') + 'Lampirkan berkas</button><div id="tgBaru" class="small mt8"></div></div>' : '') +
      '<div class="row wrap gap8 mt16"><button class="btn btn-outline" id="tgDraf">' + ic('save') + 'Simpan draf</button><button class="btn btn-primary" id="tgKirim">' + ic('send') + (terkirim ? 'Kirim ulang' : 'Kirim tugas') + '</button></div>';
    if ($('#tgPilih', f)) $('#tgPilih', f).onclick = async function () { var x = await pilihBerkas({ multiple: true }); baru = baru.concat(x); $('#tgBaru', f).innerHTML = baru.map(function (b) { return ic('paperclip') + esc(b.name) + ' <span class="muted">(' + fmtSize(b.size) + ')</span>'; }).join('<br>'); };
    async function simpan(final, btn) {
      if (final && !await confirmBox('Kumpulkan tugas sekarang?' + (lewat ? '\nBatas waktu sudah lewat — kiriman ditandai terlambat.' : ''), { ok: 'Kumpulkan' })) return;
      btnBusy(btn, true);
      var r2 = await api('tugas.kirim', { modul_id: m.modul_id, teks: $('#tgTeks', f) ? $('#tgTeks', f).value : '', unggah: baru.map(function (b) { return { name: b.name, mime: b.mime, data: b.data }; }), hapusBerkas: $$('[data-hapus-berkas]:checked', f).map(function (x) { return x.dataset.hapusBerkas; }), final: final });
      btnBusy(btn, false);
      if (toastRes(r2)) { lmsBasi(m.kursus_id); VIEW.tugas(body, m); }
    }
    $('#tgDraf', f).onclick = function () { simpan(false, this); };
    $('#tgKirim', f).onclick = function () { simpan(true, this); };
  });
};
function tugasGuru(body, m) {
  body.innerHTML = '<div class="sk" style="height:240px"></div>';
  apiLR('tugas.list', { modul_id: m.modul_id }, function (r) {
    if (!r.success) { body.innerHTML = errorBox(r.message); return; }
    var d = r.data, kel = !!d.kelompok, baris = kel ? d.kelompok.map(function (g) { return { nama: g.nama, sub: g.anggota.map(function (a) { return a.nama; }).join(', '), kiriman: g.kiriman }; }) : d.siswa.map(function (s) { return { nama: s.nama, kiriman: s.kiriman }; });
    var st = function (x) { var t = x.kiriman; return !t || t.status === 'draf' ? 'belum' : t.status === 'dinilai' ? 'dinilai' : 'perlu'; };
    var cnt = { belum: 0, perlu: 0, dinilai: 0, telat: 0 }; baris.forEach(function (x) { cnt[st(x)]++; if (x.kiriman && x.kiriman.terlambat) cnt.telat++; });
    var filter = cnt.perlu ? 'perlu' : '';
    function draw() {
      $('#tgList', body).innerHTML = baris.filter(function (x) { return !filter || st(x) === filter; }).map(function (x, i) {
        var t = x.kiriman || {};
        return '<tr><td><b>' + esc(x.nama) + '</b>' + (x.sub ? '<div class="xs muted">' + esc(x.sub) + '</div>' : '') + '</td><td>' + ({ belum: '<span class="bdg">' + (t.status === 'draf' ? 'Draf' : 'Belum') + '</span>', perlu: '<span class="bdg amber">Perlu dinilai</span>', dinilai: '<span class="bdg ok">Dinilai</span>' }[st(x)]) + (t.terlambat ? ' <span class="bdg warn">Terlambat</span>' : '') + '</td>' +
          '<td class="small">' + (t.dikirim_pada ? tglJam(t.dikirim_pada, true) : '-') + '</td><td class="small hide-m">' + (t.durasi_detik ? durasi(t.durasi_detik) : '-') + '</td><td class="tr"><b>' + (t.nilai === null || t.nilai === undefined ? '-' : fmtN(t.nilai)) + '</b></td><td class="tr">' + (t.kirim_id && t.status !== 'draf' ? '<button class="btn btn-' + (st(x) === 'perlu' ? 'primary' : 'outline') + ' btn-xs" data-nilai="' + esc(t.kirim_id) + '">' + ic('pen-line') + (st(x) === 'dinilai' ? 'Ubah' : 'Nilai') + '</button>' : '') + '</td></tr>';
      }).join('') || '<tr><td colspan="6">' + emptyHtml('Tidak ada data', '', 'inbox') + '</td></tr>';
    }
    body.innerHTML = '<div class="grid g4">' + kpi('Perlu dinilai', cnt.perlu, '', 'pen-line', cnt.perlu ? 'amber' : '') + kpi('Sudah dinilai', cnt.dinilai, '', 'award', 'ok') + kpi('Belum mengumpulkan', cnt.belum, '', 'clock') + kpi('Terlambat', cnt.telat, '', 'alarm-clock', cnt.telat ? 'bad' : '') + '</div>' +
      '<div class="card mt16"><div class="card-h"><div class="tabs grow" id="tgF"><button data-f="" class="' + (filter ? '' : 'on') + '">Semua</button><button data-f="perlu" class="' + (filter === 'perlu' ? 'on' : '') + '">Perlu dinilai</button><button data-f="dinilai">Dinilai</button><button data-f="belum">Belum</button></div><button class="btn btn-outline btn-sm" id="tgCsv">' + ic('download') + 'CSV</button></div>' +
      '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>' + (kel ? 'Kelompok' : 'Siswa') + '</th><th>Status</th><th>Dikirim</th><th class="hide-m">Durasi</th><th class="tr">Nilai</th><th></th></tr></thead><tbody id="tgList"></tbody></table></div></div>';
    draw();
    $$('#tgF button', body).forEach(function (b) { b.onclick = function () { filter = b.dataset.f; $$('#tgF button', body).forEach(function (x) { x.classList.toggle('on', x === b); }); draw(); }; });
    $('#tgCsv', body).onclick = function () { downloadCSV('tugas-' + m.modul_id + '.csv', ['Nama', 'Status', 'Dikirim', 'Terlambat', 'Durasi (detik)', 'Nilai', 'Umpan balik'], baris.map(function (x) { var t = x.kiriman || {}; return [x.nama, st(x), t.dikirim_pada || '', t.terlambat ? 'YA' : '', t.durasi_detik || '', t.nilai === null || t.nilai === undefined ? '' : t.nilai, t.umpan_balik || '']; })); };
    body.onclick = function (e) {
      var b = e.target.closest('[data-nilai]'); if (!b) return;
      var x = baris.filter(function (y) { return y.kiriman && y.kiriman.kirim_id === b.dataset.nilai; })[0], t = x.kiriman, rub = d.rubrik, pilih = t.rincian_nilai && t.rincian_nilai.pilih ? Object.assign({}, t.rincian_nilai.pilih) : {};
      var mm = modal({ title: 'Nilai Tugas — ' + x.nama, sub: 'Dikirim ' + tglJam(t.dikirim_pada) + (t.terlambat ? ' (terlambat)' : '') + ' • durasi ' + durasi(t.durasi_detik), size: 'xl',
        body: '<div class="grid g2"><div><div class="xs b muted">KIRIMAN</div>' + (t.teks ? '<div class="esai-jwb mt8">' + md(t.teks) + '</div>' : '<div class="muted small mt8">Tanpa teks</div>') + '<div class="mt8">' + daftarBerkas(t.berkas, { kosong: false }) + '</div></div>' +
          '<div>' + (rub ? '<div class="xs b muted">' + esc(rub.nama.toUpperCase()) + ' — klik sel untuk memilih</div><div class="mt8" id="tnRub">' + rubrikTabel(rub, pilih, true) + '</div><div class="mt8 b" id="tnHit"></div>' : '<div class="field"><label>Nilai (0–' + (d.modul.nilai_maks || 100) + ')</label><input class="inp" type="number" id="tnNilai" min="0" max="' + (d.modul.nilai_maks || 100) + '" value="' + esc(t.nilai === null ? '' : t.nilai) + '"></div>') +
          '<div class="field mt12"><label>Umpan balik</label><textarea class="inp" id="tnUb" rows="4">' + esc(t.umpan_balik || '') + '</textarea></div></div></div>',
        foot: '<button class="btn btn-ghost" id="tnBalik">' + ic('rotate-ccw') + 'Kembalikan untuk revisi</button><span class="sp"></span><button class="btn btn-outline" data-x>Batal</button><button class="btn btn-primary" id="tnSimpan">' + ic('save') + 'Simpan nilai</button>' });
      function hitung() {
        if (!rub) return;
        var tot = 0, mx = 0;
        rub.kriteria.forEach(function (k) { if (rub.jenis === 'panduan') { tot += Math.min(k.maks, Number(pilih[k.id] || 0)); mx += k.maks; } else { var lv = k.level[pilih[k.id]]; tot += lv ? Number(lv.skor) : 0; mx += Math.max.apply(null, k.level.map(function (l) { return Number(l.skor); })); } });
        $('#tnHit', mm.el).textContent = 'Skor ' + fmtN(tot) + ' / ' + mx + ' → nilai ' + fmtN(mx ? Math.round(tot / mx * (d.modul.nilai_maks || 100) * 10) / 10 : 0);
      }
      if (rub) {
        hitung();
        $('#tnRub', mm.el).addEventListener('click', function (e2) { var c = e2.target.closest('.rb-sel.klik'); if (!c) return; pilih[c.dataset.rk] = Number(c.dataset.lv); $$('.rb-sel[data-rk="' + c.dataset.rk + '"]', mm.el).forEach(function (z) { z.classList.toggle('on', z === c); }); hitung(); });
        $('#tnRub', mm.el).addEventListener('input', function (e2) { if (e2.target.dataset.rk) { pilih[e2.target.dataset.rk] = Number(e2.target.value); hitung(); } });
      }
      $('#tnSimpan', mm.el).onclick = async function () {
        var p = { kirim_id: t.kirim_id, umpan_balik: $('#tnUb', mm.el).value };
        if (rub) { if (rub.kriteria.some(function (k) { return pilih[k.id] === undefined || pilih[k.id] === ''; })) return toast('Lengkapi semua kriteria rubrik.', 'warn'); p.rubrik = pilih; } else p.nilai = $('#tnNilai', mm.el).value;
        btnBusy(this, true); var s = await api('tugas.nilai', p); btnBusy(this, false);
        if (toastRes(s)) { mm.close(); tugasGuru(body, m); }
      };
      $('#tnBalik', mm.el).onclick = async function () { var s = await api('tugas.nilai', { kirim_id: t.kirim_id, kembalikan: true, umpan_balik: $('#tnUb', mm.el).value }); if (toastRes(s)) { mm.close(); tugasGuru(body, m); } };
    };
  });
}

// =====================================================================
// FORUM DISKUSI
// =====================================================================
VIEW.forum = function (body, m) {
  var st = { diskusi: null };
  function daftar() {
    body.innerHTML = '<div class="sk" style="height:220px"></div>';
    apiLR('forum.list', { modul_id: m.modul_id }, function (r) {
      if (!r.success) { body.innerHTML = errorBox(r.message); return; }
      var d = r.data, k = d.modul.konten;
      if (k.jenis === 'satu' && d.satu) return thread(d.satu);
      body.innerHTML = (k.petunjuk ? '<div class="card card-p mb12">' + md(k.petunjuk) + '</div>' : '') + (k.jenis === 'tanya_jawab' ? '<div class="note mb12">' + ic('message-circle-question') + '<div><b>Forum tanya-jawab:</b> jawaban teman terlihat setelah Anda menjawab.</div></div>' : '') +
        '<div class="card"><div class="card-h"><div class="grow"><h3>' + ic('messages-square') + ' ' + d.diskusi.length + ' topik diskusi</h3>' + (k.dinilai ? '<p>Postingan dinilai guru (maks ' + d.modul.nilai_maks + ')</p>' : '') + '</div>' + (d.bolehBuat ? '<button class="btn btn-primary btn-sm" id="fdBaru">' + ic('plus') + 'Topik baru</button>' : '') + '</div>' +
        (d.diskusi.length ? d.diskusi.map(function (x) { return '<a href="#" class="forum-i" data-did="' + esc(x.diskusi_id) + '">' + avatar(x.nama, '', 'sm') + '<div class="grow"><b class="clamp2">' + (x.disematkan ? ic('pin') : '') + (x.terkunci ? ic('lock') : '') + esc(x.judul) + '</b><div class="xs muted">' + esc(x.nama) + ' • ' + relTime(x.dibuat_pada) + (x.grup_id ? ' • ' + esc((d.grup.filter(function (g) { return g.grup_id === x.grup_id; })[0] || {}).nama || '') : '') + '</div></div><div class="tr"><div class="b">' + Math.max(0, x.jml_post - 1) + ' ' + ic('message-circle') + '</div><div class="xs muted">' + relTime(x.terakhir_pada) + '</div></div></a>'; }).join('') : '<div class="card-b">' + emptyHtml('Belum ada diskusi', d.bolehBuat ? 'Mulai topik pertama!' : '', 'messages-square') + '</div>') + '</div>' +
        (d.nilaiSiswa && d.nilaiSiswa.length ? '<div class="card mt16"><div class="card-h"><h3>' + ic('award') + ' Nilai Forum Siswa</h3></div><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Siswa</th><th>Postingan dinilai</th><th class="tr">Nilai forum</th></tr></thead><tbody>' + d.nilaiSiswa.map(function (x) { return '<tr><td>' + esc(x.nama) + '</td><td>' + x.jml + '</td><td class="tr"><b>' + fmtN(x.nilai) + '</b></td></tr>'; }).join('') + '</tbody></table></div></div>' : '');
      body.onclick = function (e) { var a = e.target.closest('[data-did]'); if (a) { e.preventDefault(); thread(a.dataset.did); } };
      if ($('#fdBaru', body)) $('#fdBaru', body).onclick = function () { formPost('Topik Diskusi Baru', true, k.lampiran !== false, d.modul.kelola && d.grup.length ? d.grup : null, async function (v) { var r2 = await api('forum.buat', { modul_id: m.modul_id, judul: v.judul, isi: v.isi, unggah: v.unggah, grup_id: v.grup_id }); if (toastRes(r2)) { lmsBasi(m.kursus_id); thread(r2.data.diskusi_id); return true; } }); };
    });
  }
  function thread(did) {
    var sama = st.diskusi === did && body.querySelector('.thread');   // v3.1: muat ulang topik yang sama tanpa kedip kerangka
    st.diskusi = did;
    if (!sama) body.innerHTML = '<div class="sk" style="height:260px"></div>';
    apiLR('forum.diskusi', { diskusi_id: did }, function (r) {
      if (!r.success) { body.innerHTML = errorBox(r.message); return; }
      var d = r.data, dk = d.diskusi, posts = d.post, anak = {};
      posts.forEach(function (p) { (anak[p.induk_id || '_'] = anak[p.induk_id || '_'] || []).push(p); });
      function postHtml(p, lv) {
        var milik = p.user_id === d.saya, bolehEdit = !p.dihapus && (d.kelola || (milik && Date.now() - new Date(p.dibuat_pada).getTime() < 30 * 60000));
        return '<div class="post lv' + Math.min(lv, 3) + '" data-pid="' + esc(p.post_id) + '"><div class="post-h">' + avatar(p.nama, '', 'sm') + '<div class="grow"><b>' + esc(p.nama) + '</b>' + (p.peran !== 'siswa' ? ' <span class="bdg navy xs">' + esc(peranLabel(p.peran)) + '</span>' : '') + '<div class="xs muted">' + relTime(p.dibuat_pada) + (p.diedit_pada ? ' • diedit' : '') + '</div></div>' +
          (d.modul.dinilai && d.kelola && !p.dihapus && p.peran === 'siswa' ? '<select class="sel nilai-post" data-np="' + esc(p.post_id) + '" title="Nilai postingan"><option value="">Nilai…</option>' + Array.from({ length: Math.min(Number(d.modul.nilai_maks) || 10, 100) + 1 }, function (_, i) { return '<option' + (p.nilai === i ? ' selected' : '') + '>' + i + '</option>'; }).join('') + '</select>' : (p.nilai !== null ? '<span class="bdg ok">Nilai ' + p.nilai + '</span>' : '')) + '</div>' +
          '<div class="post-b">' + (p.dihapus ? '<i class="muted">Postingan dihapus.</i>' : md(p.isi) + (p.berkas.length ? daftarBerkas(p.berkas) : '')) + '</div>' +
          (!p.dihapus ? '<div class="post-a">' + (!dk.terkunci || d.kelola ? '<button class="btn btn-ghost btn-xs" data-balas="' + esc(p.post_id) + '">' + ic('reply') + 'Balas</button>' : '') + (bolehEdit ? '<button class="btn btn-ghost btn-xs" data-edit="' + esc(p.post_id) + '">' + ic('pencil') + 'Ubah</button><button class="btn btn-ghost btn-xs" data-hapus="' + esc(p.post_id) + '">' + ic('trash-2') + 'Hapus</button>' : '') + '</div>' : '') + '</div>' +
          (anak[p.post_id] || []).map(function (c) { return postHtml(c, lv + 1); }).join('');
      }
      body.innerHTML = '<div class="row wrap gap8 mb12"><button class="btn btn-outline btn-sm" id="fdKembali">' + ic('arrow-left') + 'Semua topik</button><span class="sp"></span>' + (d.kelola ? '<button class="btn btn-ghost btn-sm" data-kel="sematkan">' + ic('pin') + (dk.disematkan ? 'Lepas sematan' : 'Sematkan') + '</button><button class="btn btn-ghost btn-sm" data-kel="kunci">' + ic(dk.terkunci ? 'lock-open' : 'lock') + (dk.terkunci ? 'Buka kunci' : 'Kunci') + '</button><button class="btn btn-ghost btn-sm" data-kel="hapus">' + ic('trash-2') + 'Hapus topik</button>' : '') + '</div>' +
        '<div class="card"><div class="card-h"><h3 class="grow">' + (dk.terkunci ? ic('lock') : '') + esc(dk.judul) + '</h3></div><div class="card-b thread">' + (anak._ || []).map(function (p) { return postHtml(p, 0); }).join('') +
        (d.tanyaJawabTerkunci ? '<div class="note mt12">' + ic('eye-off') + '<div>Jawaban teman tersembunyi. Tulis jawaban Anda dulu untuk melihatnya.</div></div>' : '') + '</div>' +
        (!dk.terkunci || d.kelola ? '<div class="card-b balas-box"><div class="xs b muted" id="fdKe">BALAS TOPIK</div><textarea class="inp mt8" id="fdIsi" rows="3" placeholder="Tulis balasan…"></textarea><div class="row gap8 mt8">' + (d.modul.lampiran ? '<button class="btn btn-ghost btn-sm" id="fdLamp">' + ic('paperclip') + 'Lampiran</button>' : '') + '<span id="fdLampN" class="xs muted grow"></span><button class="btn btn-primary btn-sm" id="fdKirim">' + ic('send') + 'Kirim</button></div></div>' : '<div class="card-b"><div class="note">' + ic('lock') + '<div>Diskusi dikunci pengajar.</div></div></div>') + '</div>';
      var induk = '', lamp = [];
      $('#fdKembali', body).onclick = daftar;
      if ($('#fdLamp', body)) $('#fdLamp', body).onclick = async function () { lamp = lamp.concat(await pilihBerkas({ multiple: true })); $('#fdLampN', body).textContent = lamp.map(function (x) { return x.name; }).join(', '); };
      if ($('#fdKirim', body)) $('#fdKirim', body).onclick = async function () {
        var isi = $('#fdIsi', body).value.trim(); if (!isi) return toast('Tulis balasan dulu.', 'warn');
        btnBusy(this, true); var r2 = await api('forum.balas', { diskusi_id: did, induk_id: induk, isi: isi, unggah: lamp.map(function (x) { return { name: x.name, mime: x.mime, data: x.data }; }) }); btnBusy(this, false);
        if (toastRes(r2)) { lmsBasi(m.kursus_id); thread(did); }
      };
      body.onchange = async function (e) { if (e.target.dataset.np) { var r3 = await api('forum.nilai', { post_id: e.target.dataset.np, nilai: e.target.value }); toastRes(r3); } };
      body.onclick = async function (e) {
        var b = e.target.closest('button'); if (!b) return;
        if (b.dataset.balas) { induk = b.dataset.balas; var p = posts.filter(function (x) { return x.post_id === induk; })[0]; $('#fdKe', body).innerHTML = 'MEMBALAS ' + esc((p.nama || '').toUpperCase()) + ' <a href="#" id="fdBatal">batal</a>'; $('#fdIsi', body).focus(); $('#fdBatal', body).onclick = function (x) { x.preventDefault(); induk = ''; $('#fdKe', body).textContent = 'BALAS TOPIK'; }; return; }
        if (b.dataset.edit) { var p2 = posts.filter(function (x) { return x.post_id === b.dataset.edit; })[0]; formPost('Ubah Postingan', false, false, null, async function (v) { var r4 = await api('forum.edit', { post_id: p2.post_id, isi: v.isi }); if (toastRes(r4)) { thread(did); return true; } }, { isi: p2.isi }); return; }
        if (b.dataset.hapus) { if (!await confirmBox('Hapus postingan ini?', { danger: true })) return; var r5 = await api('forum.edit', { post_id: b.dataset.hapus, hapus: true }); if (toastRes(r5)) thread(did); return; }
        if (b.dataset.kel) { if (b.dataset.kel === 'hapus' && !await confirmBox('Hapus seluruh topik & balasannya?', { danger: true })) return; var p6 = { diskusi_id: did }; if (b.dataset.kel === 'hapus') p6.hapus = true; if (b.dataset.kel === 'sematkan') p6.sematkan = !dk.disematkan; if (b.dataset.kel === 'kunci') p6.kunci = !dk.terkunci; var r6 = await api('forum.kelola', p6); if (toastRes(r6)) { if (p6.hapus) daftar(); else thread(did); } }
      };
    });
  }
  daftar();
};
function formPost(judul, adaJudul, lampiran, grup, cb, awal) {
  awal = awal || {}; var lamp = [];
  var m = modal({ title: judul, size: 'lg', body: (adaJudul ? '<div class="field"><label>Judul</label><input class="inp" id="fpJ" value="' + esc(awal.judul || '') + '"></div>' : '') + (grup ? '<div class="field mt12"><label>Untuk grup</label><select class="sel" id="fpG"><option value="">Semua peserta</option>' + grup.map(function (g) { return '<option value="' + esc(g.grup_id) + '">' + esc(g.nama) + '</option>'; }).join('') + '</select></div>' : '') +
    '<div class="field mt12"><label>Isi (mendukung **tebal**, daftar, tautan)</label><textarea class="inp" id="fpI" rows="7">' + esc(awal.isi || '') + '</textarea></div>' + (lampiran ? '<button class="btn btn-ghost btn-sm mt8" id="fpL">' + ic('paperclip') + 'Lampirkan berkas</button><span id="fpLn" class="xs muted"></span>' : ''),
    foot: '<button class="btn btn-outline" data-x>Batal</button><button class="btn btn-primary" id="fpK">' + ic('send') + 'Kirim</button>' });
  if ($('#fpL', m.el)) $('#fpL', m.el).onclick = async function () { lamp = lamp.concat(await pilihBerkas({ multiple: true })); $('#fpLn', m.el).textContent = ' ' + lamp.map(function (x) { return x.name; }).join(', '); };
  $('#fpK', m.el).onclick = async function () { btnBusy(this, true); var ok2 = await cb({ judul: $('#fpJ', m.el) ? $('#fpJ', m.el).value : '', isi: $('#fpI', m.el).value, grup_id: $('#fpG', m.el) ? $('#fpG', m.el).value : '', unggah: lamp.map(function (x) { return { name: x.name, mime: x.mime, data: x.data }; }) }); btnBusy(this, false); if (ok2) m.close(); };
}

// =====================================================================
// WIKI
// =====================================================================
VIEW.wiki = function (body, m) {
  var lk = { grup_id: '', pemilik: '' }, judul = '';
  function muat(j) {
    judul = j || '';
    var lama = body.querySelector('.wiki-main');                       // v3.1: halaman lama tetap tampil (redup) sampai data baru siap
    if (lama) lama.style.opacity = '.6'; else body.innerHTML = '<div class="sk" style="height:260px"></div>';
    apiLR('wiki.get', Object.assign({ modul_id: m.modul_id, judul: judul }, lk), function (r) {
      if (!r.success) { body.innerHTML = errorBox(r.message); return; }
      var d = r.data, h = d.halaman; lk = d.lingkup;
      body.innerHTML = '<div class="wiki-wrap"><aside class="card card-p wiki-side">' +
        (d.grup && d.grup.length ? '<div class="field"><label>Wiki grup</label><select class="sel" id="wkG"><option value="">— umum —</option>' + d.grup.map(function (g) { return '<option value="' + esc(g.grup_id) + '"' + (g.grup_id === lk.grup_id ? ' selected' : '') + '>' + esc(g.nama) + '</option>'; }).join('') + '</select></div>' : '') +
        (d.siswa ? '<div class="field"><label>Wiki siswa</label><select class="sel" id="wkS">' + d.siswa.map(function (s) { return '<option value="' + esc(s.uid) + '"' + (s.uid === lk.pemilik ? ' selected' : '') + '>' + esc(s.nama) + '</option>'; }).join('') + '</select></div>' : '') +
        '<div class="xs b muted mt8">HALAMAN (' + d.daftar.length + ')</div><div class="wiki-daftar">' + d.daftar.map(function (x) { return '<a href="#" data-wj="' + esc(x.judul) + '" class="' + (x.judul === d.judul ? 'on' : '') + '">' + ic('file-text') + esc(x.judul) + '</a>'; }).join('') + '</div>' +
        (d.bolehEdit ? '<button class="btn btn-ghost btn-sm mt8" id="wkBaru">' + ic('file-plus') + 'Halaman baru</button>' : '') + '</aside>' +
        '<div class="card wiki-main"><div class="card-h"><div class="grow"><h3>' + ic('notebook-pen') + ' ' + esc(d.judul) + '</h3>' + (h ? '<p>Versi ' + h.versi + ' • diubah ' + esc(h.diedit_oleh) + ', ' + relTime(h.diedit_pada) + '</p>' : '<p>Halaman belum dibuat</p>') + '</div>' +
        (h ? '<button class="btn btn-ghost btn-sm" id="wkRiwayat">' + ic('history') + 'Riwayat</button>' : '') + (d.bolehEdit ? '<button class="btn btn-primary btn-sm" id="wkEdit">' + ic('pencil') + (h ? 'Ubah' : 'Buat halaman') + '</button>' : '') + '</div><div class="card-b" id="wkIsi">' + (h ? md(h.isi, { wiki: true }) : emptyHtml('Halaman "' + d.judul + '" belum ada', d.bolehEdit ? 'Klik "Buat halaman" untuk mulai menulis.' : '', 'file-plus')) + '</div></div></div>';
      body.onclick = function (e) {
        var a = e.target.closest('[data-wj],[data-wiki]'); if (a) { e.preventDefault(); muat(a.dataset.wj || a.dataset.wiki); return; }
        if (e.target.closest('#wkEdit')) edit(d);
        if (e.target.closest('#wkRiwayat')) riwayat(h);
        if (e.target.closest('#wkBaru')) promptBox('Halaman baru', 'Judul halaman', '').then(function (v) { if (v) { judul = v; edit({ judul: v, halaman: null, lingkup: lk }); } });
      };
      body.onchange = function (e) { if (e.target.id === 'wkG') { lk.grup_id = e.target.value; muat(''); } if (e.target.id === 'wkS') { lk.pemilik = e.target.value; muat(''); } };
    });
  }
  function edit(d) {
    var h = d.halaman, isi = h ? h.isi : '', versi = h ? h.versi : 0;
    var box = $('#wkIsi', body) || body;
    box.innerHTML = '<div class="xs muted mb8">Tautkan halaman lain dengan [[Judul Halaman]]. Gunakan # judul, **tebal**, - daftar.</div><textarea class="inp" id="wkTa" rows="14">' + esc(isi) + '</textarea><div class="row gap8 mt8"><button class="btn btn-outline" id="wkBatal">Batal</button><button class="btn btn-ghost" id="wkPrev">' + ic('eye') + 'Pratinjau</button><span class="sp"></span><button class="btn btn-primary" id="wkSimpan">' + ic('save') + 'Simpan versi</button></div><div id="wkPv" class="card card-p mt8" hidden></div>';
    $('#wkBatal', box).onclick = function () { muat(d.judul); };
    $('#wkPrev', box).onclick = function () { var p = $('#wkPv', box); p.hidden = !p.hidden; p.innerHTML = md($('#wkTa', box).value, { wiki: true }); };
    $('#wkSimpan', box).onclick = async function () {
      btnBusy(this, true);
      var r = await api('wiki.simpan', Object.assign({ modul_id: m.modul_id, judul: d.judul, isi: $('#wkTa', box).value, versi: versi }, lk));
      btnBusy(this, false);
      if (r.success) { toast(r.message, 'ok'); lmsBasi(m.kursus_id); muat(d.judul); }
      else if (r.data && r.data.code === 'KONFLIK') { toast(r.message, 'warn'); versi = r.data.versi; var pv = $('#wkPv', box); pv.hidden = false; pv.innerHTML = '<div class="note warn">' + ic('git-merge') + '<div><b>Versi terbaru dari orang lain:</b></div></div>' + md(r.data.isi, { wiki: true }) + '<div class="xs muted mt8">Gabungkan perubahan Anda ke teks di atas, lalu klik Simpan versi lagi.</div>'; }
      else toast(r.message, 'bad');
    };
  }
  async function riwayat(h) {
    var r = await api('wiki.riwayat', { halaman_id: h.halaman_id }); if (!r.success) return toast(r.message, 'bad');
    var d = r.data;
    var mm = modal({ title: 'Riwayat: ' + d.halaman.judul, sub: 'Versi saat ini: ' + d.halaman.versi, size: 'lg', body: '<div class="list-i"><b class="grow">Versi ' + d.halaman.versi + ' (saat ini)</b><span class="xs muted">' + esc(d.halaman.oleh) + ' • ' + tglJam(d.halaman.waktu) + '</span></div>' + d.riwayat.map(function (x) { return '<details class="wk-ver"><summary><b>Versi ' + x.versi + '</b> <span class="xs muted">' + esc(x.oleh) + ' • ' + tglJam(x.waktu) + '</span>' + (d.bolehEdit ? ' <button class="btn btn-ghost btn-xs" data-pul="' + x.versi + '">' + ic('rotate-ccw') + 'Pulihkan</button>' : '') + '</summary><div class="card card-p mt8">' + md(x.isi) + '</div></details>'; }).join('') });
    mm.el.addEventListener('click', async function (e) { var b = e.target.closest('[data-pul]'); if (!b) return; e.preventDefault(); var s = await api('wiki.pulihkan', { halaman_id: h.halaman_id, versi: Number(b.dataset.pul) }); if (toastRes(s, 'Versi ' + b.dataset.pul + ' dipulihkan.')) { mm.close(); muat(d.halaman.judul); } });
  }
  muat('');
};

// =====================================================================
// GLOSARIUM
// =====================================================================
VIEW.glosarium = function (body, m) {
  var q = '', huruf = '';
  function muat() {
    apiLR('glos.list', { modul_id: m.modul_id, cari: q, huruf: huruf }, function (r) {
      if (!r.success) { body.innerHTML = errorBox(r.message); return; }
      var d = r.data;
      if (!$('#glCari', body)) {
        body.innerHTML = '<div class="card card-p"><div class="row wrap gap8"><div class="inp-ic grow">' + ic('search') + '<input class="inp" id="glCari" placeholder="Cari istilah atau definisi…"></div>' + (d.bolehTambah ? '<button class="btn btn-primary" id="glBaru">' + ic('plus') + 'Tambah istilah</button>' : '') + '</div><div class="abjad mt12" id="glAbjad"><button data-h="" class="on">Semua</button>' + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(function (x) { return '<button data-h="' + x + '">' + x + '</button>'; }).join('') + '</div></div><div id="glInfo"></div><div class="glos-list mt16" id="glList"></div>';
        $('#glCari', body).oninput = debounce(function () { q = this.value; muat(); }, 300);
        if ($('#glBaru', body)) $('#glBaru', body).onclick = function () { formGlos(null); };
      }
      $('#glInfo', body).innerHTML = d.kelola && d.menunggu ? '<div class="note warn mt12">' + ic('hourglass') + '<div>' + d.menunggu + ' istilah menunggu persetujuan Anda.</div></div>' : '';
      $('#glList', body).innerHTML = d.entri.length ? d.entri.map(function (e) {
        var milik = !!e.milik;
        return '<div class="card glos-i' + (e.status === 'Menunggu' ? ' menunggu' : '') + '"><div class="row"><h3 class="grow">' + esc(e.istilah) + (e.alias ? ' <span class="xs muted">(' + esc(e.alias) + ')</span>' : '') + '</h3>' + (e.status === 'Menunggu' ? '<span class="bdg amber">Menunggu</span>' : '') +
          (d.kelola && e.status === 'Menunggu' ? '<button class="btn btn-ok btn-xs" data-setuju="' + esc(e.entri_id) + '">' + ic('check') + 'Setujui</button>' : '') + (d.kelola || milik ? '<button class="btn-ic" data-gedit="' + esc(e.entri_id) + '">' + ic('pencil') + '</button><button class="btn-ic" data-ghapus="' + esc(e.entri_id) + '">' + ic('trash-2') + '</button>' : '') + '</div>' + md(e.definisi) + '<div class="xs muted">Oleh ' + esc(e.nama) + ' • ' + relTime(e.dibuat_pada) + '</div></div>';
      }).join('') : '<div class="card card-p">' + emptyHtml('Tidak ada istilah', q || huruf ? 'Coba kata kunci lain.' : '', 'book-a') + '</div>';
      body.onclick = async function (e) {
        var a = e.target.closest('[data-h]'); if (a) { huruf = a.dataset.h; $$('#glAbjad button', body).forEach(function (x) { x.classList.toggle('on', x === a); }); muat(); return; }
        var s = e.target.closest('[data-setuju]'); if (s) { var r2 = await api('glos.kelola', { entri_id: s.dataset.setuju, setuju: true }); if (toastRes(r2)) muat(); return; }
        var g = e.target.closest('[data-gedit]'); if (g) { formGlos(d.entri.filter(function (x) { return x.entri_id === g.dataset.gedit; })[0]); return; }
        var hp = e.target.closest('[data-ghapus]'); if (hp) { if (!await confirmBox('Hapus istilah ini?', { danger: true })) return; var r3 = await api('glos.kelola', { entri_id: hp.dataset.ghapus, hapus: true }); if (toastRes(r3)) muat(); }
      };
    });
  }
  function formGlos(e) {
    var mm = modal({ title: e ? 'Ubah Istilah' : 'Tambah Istilah', size: 'md', body: '<div class="grid g2"><div class="field"><label>Istilah *</label><input class="inp" id="gIs" value="' + esc(e ? e.istilah : '') + '"></div><div class="field"><label>Alias / sinonim</label><input class="inp" id="gAl" value="' + esc(e ? e.alias : '') + '"></div></div><div class="field mt12"><label>Definisi *</label><textarea class="inp" id="gDf" rows="5">' + esc(e ? e.definisi : '') + '</textarea></div>',
      foot: '<button class="btn btn-outline" data-x>Batal</button><button class="btn btn-primary" id="gSv">Simpan</button>' });
    $('#gSv', mm.el).onclick = async function () { btnBusy(this, true); var r = await api('glos.simpan', { modul_id: m.modul_id, entri_id: e ? e.entri_id : '', istilah: $('#gIs', mm.el).value, alias: $('#gAl', mm.el).value, definisi: $('#gDf', mm.el).value }); btnBusy(this, false); if (toastRes(r)) { mm.close(); lmsBasi(m.kursus_id); muat(); } };
  }
  body.innerHTML = '<div class="sk" style="height:200px"></div>';
  muat();
};

// =====================================================================
// WORKSHOP (penilaian sejawat)
// =====================================================================
var WS_LBL = { penyiapan: 'Penyiapan', pengiriman: 'Pengiriman karya', penilaian: 'Penilaian sejawat', evaluasi: 'Evaluasi nilai', selesai: 'Selesai' };
VIEW.workshop = function (body, m) {
  body.innerHTML = '<div class="sk" style="height:240px"></div>';
  apiLR('ws.get', { modul_id: m.modul_id }, function (r) {
    if (!r.success) { body.innerHTML = errorBox(r.message); return; }
    var d = r.data, fase = d.fase, urut = Object.keys(WS_LBL), fi = urut.indexOf(fase);
    var step = '<div class="ws-step">' + urut.map(function (f, i) { return '<div class="' + (i < fi ? 'lewat' : i === fi ? 'kini' : '') + '"><span>' + (i < fi ? ic('check') : i + 1) + '</span><b>' + WS_LBL[f] + '</b></div>'; }).join('') + '</div>';
    var kr = d.kriteria || [];
    function formNilai(id, skor, komentar) { return '<div class="ws-nilai" data-k="' + esc(id) + '">' + kr.map(function (k) { return '<div class="row gap8 mt8"><span class="grow small">' + esc(k.deskripsi) + '</span><input class="inp" type="number" min="0" max="' + k.maks + '" data-kr="' + esc(k.id) + '" value="' + esc(skor && skor[k.id] !== undefined ? skor[k.id] : '') + '" style="width:76px"><span class="xs muted">/ ' + k.maks + '</span></div>'; }).join('') + '<textarea class="inp mt8" data-kom rows="2" placeholder="Komentar membangun…">' + esc(komentar || '') + '</textarea><button class="btn btn-primary btn-sm mt8" data-wsn="' + esc(id) + '">' + ic('save') + 'Simpan penilaian</button></div>'; }
    if (m.kelola) {
      body.innerHTML = step + '<div class="card card-p mt16"><div class="row wrap gap8"><b class="grow ws-fase">Fase saat ini: ' + WS_LBL[fase] + '</b>' + urut.map(function (f) { return f === fase ? '' : '<button class="btn btn-outline btn-sm" data-fase="' + f + '">→ ' + WS_LBL[f] + '</button>'; }).join('') + '</div><div class="xs muted mt8">Masuk "Penilaian sejawat" membagi karya ke ' + '' + 'penilai secara acak & merata. Masuk "Evaluasi" menghitung nilai: karya ' + d.bobot_kirim + '% + akurasi menilai ' + d.bobot_menilai + '%.</div></div>' +
        '<div class="card mt16"><div class="card-h"><h3>' + ic('users-round') + ' ' + d.kiriman.length + ' karya dari ' + d.jml_siswa + ' siswa</h3></div><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Siswa / karya</th><th>Penilai</th><th class="tr">Rata (%)</th><th class="tr">Nilai akhir</th><th></th></tr></thead><tbody>' +
        d.kiriman.map(function (x) { return '<tr><td><b>' + esc(x.nama) + '</b><div class="xs muted">' + esc(x.judul) + '</div></td><td class="small">' + (x.penilai.length ? x.penilai.map(function (p) { return '<span class="chip ' + (p.total !== null ? 'ok' : '') + '">' + esc(p.nama.split(' ')[0]) + (p.total !== null ? ' ' + fmtN(p.total) : ' …') + '</span>'; }).join(' ') : '-') + '</td><td class="tr">' + (x.rata === null ? '-' : fmtN(x.rata)) + '</td><td class="tr"><b>' + (x.nilai_akhir === null ? '-' : fmtN(x.nilai_akhir)) + '</b></td><td><button class="btn btn-ghost btn-xs" data-lihat="' + esc(x.kirim_id) + '">' + ic('eye') + 'Lihat/nilai</button></td></tr>'; }).join('') + '</tbody></table></div></div>';
      body.onclick = async function (e) {
        var f = e.target.closest('[data-fase]'); if (f) { if (!await confirmBox('Pindah ke fase "' + WS_LBL[f.dataset.fase] + '"?')) return; var r2 = await api('ws.fase', { modul_id: m.modul_id, fase: f.dataset.fase }); if (toastRes(r2)) VIEW.workshop(body, m); return; }
        var l = e.target.closest('[data-lihat]'); if (l) {
          var x = d.kiriman.filter(function (y) { return y.kirim_id === l.dataset.lihat; })[0];
          var mm = modal({ title: x.judul, sub: x.nama + ' • ' + tglJam(x.dikirim_pada), size: 'lg', body: md(x.isi) + daftarBerkas(x.berkas, { kosong: false }) + (fase === 'penilaian' || fase === 'evaluasi' ? '<div class="xs b muted mt16">PENILAIAN GURU (berbobot 3×)</div>' + formNilai(x.kirim_id, null, '') : '') });
          mm.el.addEventListener('click', async function (e2) { var b = e2.target.closest('[data-wsn]'); if (!b) return; var box = b.closest('.ws-nilai'), sk = {}; $$('[data-kr]', box).forEach(function (i) { sk[i.dataset.kr] = Number(i.value || 0); }); var r3 = await api('ws.nilai', { kirim_id: x.kirim_id, skor: sk, komentar: $('[data-kom]', box).value }); if (toastRes(r3)) { mm.close(); VIEW.workshop(body, m); } });
        }
      };
      return;
    }
    var mine = d.kirimanSaya, html = step;
    if (fase === 'penyiapan') html += '<div class="card card-p mt16">' + emptyHtml('Workshop belum dimulai', 'Guru akan membuka fase pengiriman.', 'hourglass') + '</div>';
    if (fase === 'pengiriman') html += '<div class="card card-p mt16"><h3>' + ic('upload') + ' Karya Anda</h3>' + (d.petunjuk_kirim ? md(d.petunjuk_kirim) : '') + '<div class="field mt12"><label>Judul *</label><input class="inp" id="wsJ" value="' + esc(mine ? mine.judul : '') + '"></div><div class="field mt12"><label>Isi karya</label><textarea class="inp" id="wsI" rows="9">' + esc(mine ? mine.isi : '') + '</textarea></div>' + (mine ? daftarBerkas(mine.berkas, { hapus: true, kosong: false }) : '') + '<button class="btn btn-ghost btn-sm mt8" id="wsL">' + ic('paperclip') + 'Lampiran</button><span id="wsLn" class="xs muted"></span><div class="mt12"><button class="btn btn-primary" id="wsK">' + ic('send') + (mine ? 'Perbarui karya' : 'Kirim karya') + '</button></div></div>';
    if (fase === 'penilaian') html += '<div class="card card-p mt16"><h3>' + ic('clipboard-pen-line') + ' Karya yang perlu Anda nilai (' + d.tugasNilai.length + ')</h3>' + (d.petunjuk_nilai ? md(d.petunjuk_nilai) : '') + (d.tugasNilai.length ? d.tugasNilai.map(function (t) { return '<div class="ws-karya card card-p mt12"><div class="row"><b class="grow">' + esc(t.label) + ': ' + esc(t.judul) + '</b>' + (t.sudah ? '<span class="bdg ok">' + ic('check') + 'Sudah dinilai</span>' : '<span class="bdg amber">Belum</span>') + '</div>' + md(t.isi) + daftarBerkas(t.berkas, { kosong: false }) + formNilai(t.kirim_id, t.skor, t.komentar) + '</div>'; }).join('') : '<div class="muted small mt8">Tidak ada karya yang dialokasikan untuk Anda.</div>') + '</div>' + (mine ? '<div class="card card-p mt16"><b>Karya Anda:</b> ' + esc(mine.judul) + '</div>' : '');
    if (fase === 'evaluasi' || fase === 'selesai') html += '<div class="grid g-main mt16"><div class="card card-p"><h3>' + ic('message-square-quote') + ' Penilaian untuk karya Anda</h3>' + ((d.diterima || []).length ? d.diterima.map(function (x) { return '<div class="list-i"><div class="grow"><b>' + esc(x.label) + '</b><div class="small">' + kr.map(function (k) { return esc(k.deskripsi) + ': ' + (x.skor[k.id] === undefined ? '-' : x.skor[k.id]) + '/' + k.maks; }).join(' • ') + '</div>' + (x.komentar ? '<div class="xs muted">"' + esc(x.komentar) + '"</div>' : '') + '</div><b>' + fmtN(x.total) + '%</b></div>'; }).join('') : '<div class="muted small">Belum ada penilaian.</div>') + '</div>' +
      '<div class="card card-p tc"><div class="xs b muted">NILAI WORKSHOP</div><div class="big-num">' + (mine && mine.nilai_akhir !== null ? fmtN(mine.nilai_akhir) : '-') + '</div>' + (mine ? '<div class="small muted">Karya ' + fmtN(mine.nilai_kirim) + ' + menilai ' + fmtN(mine.nilai_menilai) + '</div>' : '') + '</div></div>';
    body.innerHTML = html;
    var lamp = [];
    if ($('#wsL', body)) $('#wsL', body).onclick = async function () { lamp = lamp.concat(await pilihBerkas({ multiple: true })); $('#wsLn', body).textContent = ' ' + lamp.map(function (x) { return x.name; }).join(', '); };
    if ($('#wsK', body)) $('#wsK', body).onclick = async function () { btnBusy(this, true); var r2 = await api('ws.kirim', { modul_id: m.modul_id, judul: $('#wsJ', body).value, isi: $('#wsI', body).value, unggah: lamp.map(function (x) { return { name: x.name, mime: x.mime, data: x.data }; }), hapusBerkas: $$('[data-hapus-berkas]:checked', body).map(function (x) { return x.dataset.hapusBerkas; }) }); btnBusy(this, false); if (toastRes(r2)) { lmsBasi(m.kursus_id); VIEW.workshop(body, m); } };
    body.onclick = async function (e) { var b = e.target.closest('[data-wsn]'); if (!b) return; var box = b.closest('.ws-nilai'), sk = {}; $$('[data-kr]', box).forEach(function (i) { sk[i.dataset.kr] = Number(i.value || 0); }); btnBusy(b, true); var r3 = await api('ws.nilai', { kirim_id: b.dataset.wsn, skor: sk, komentar: $('[data-kom]', box).value }); btnBusy(b, false); if (toastRes(r3)) VIEW.workshop(body, m); };
  });
};

// =====================================================================
// PELAJARAN INTERAKTIF
// =====================================================================
VIEW.pelajaran = function (body, m) {
  var preview = null;
  function main(p) {
    body.innerHTML = '<div class="sk" style="height:240px"></div>';
    api('pel.mulai', Object.assign({ modul_id: m.modul_id }, p || {})).then(function (r) {
      if (!r.success) { body.innerHTML = errorBox(r.message); return; }
      var d = r.data;
      if (d.kelola) return guru(d);
      if (d.selesai) {
        body.innerHTML = '<div class="card card-p tc"><div class="kz-skor ' + (d.terbaik >= (d.modul.konten.nilai_min || 70) ? 'ok' : 'warn') + '">' + fmtN(d.terbaik) + '<small>%</small></div><h3>Nilai terbaik Anda</h3><div class="small muted">Percobaan terakhir ' + fmtN(d.nilai) + '% • ' + d.percobaan + ' kali dikerjakan • lulus bila ≥ ' + (d.modul.konten.nilai_min || 70) + '%</div>' +
          (d.sisa === 0 ? '<div class="note mt12">' + ic('ban') + '<div>Kesempatan mengulang habis.</div></div>' : '<button class="btn btn-primary mt16" id="plUlang">' + ic('rotate-ccw') + 'Ulangi pelajaran' + (d.sisa ? ' (sisa ' + d.sisa + ')' : '') + '</button>') + '</div>';
        if ($('#plUlang', body)) $('#plUlang', body).onclick = function () { main({ ulang: true }); };
        return;
      }
      halaman(d);
    });
  }
  function halaman(d, umpan) {
    var h = d.halaman;
    body.innerHTML = '<div class="pel-wrap"><div class="row between small"><span>' + (d.pratinjau ? '<span class="bdg amber">Pratinjau</span> ' : '') + 'Halaman ' + d.posisi + ' dari ' + d.total + '</span><span class="muted">' + d.benar + '/' + d.dijawab + ' benar</span></div>' + barProgres(d.posisi / d.total * 100) +
      (umpan ? '<div class="note ' + (umpan.benar === true ? 'ok' : umpan.benar === false ? 'bad' : '') + ' mt12">' + ic(umpan.benar ? 'circle-check' : 'circle-x') + '<div>' + esc(umpan.teks) + '</div></div>' : '') +
      '<div class="card card-p mt12 pel-hal"><h2>' + esc(h.judul) + '</h2>' + md(h.isi) +
      (h.tipe === 'soal' ? '<div class="pel-opsi mt16">' + h.opsi.map(function (o, i) { return '<button class="kz-o" data-pil="' + i + '"><span class="kz-huruf">' + String.fromCharCode(65 + i) + '</span><span class="grow tl">' + esc(o.teks) + '</span></button>'; }).join('') + '</div>'
        : '<div class="row wrap gap8 mt16">' + h.tombol.map(function (t, i) { return '<button class="btn btn-primary" data-tb="' + i + '">' + esc(t.label || 'Lanjut') + ic('arrow-right') + '</button>'; }).join('') + '</div>') + '</div></div>';
    body.onclick = async function (e) {
      var b = e.target.closest('[data-pil],[data-tb]'); if (!b || b.disabled) return;
      $$('[data-pil],[data-tb]', body).forEach(function (x) { x.disabled = true; });
      var p = { modul_id: m.modul_id, halaman_id: h.id };
      if (b.dataset.pil !== undefined) p.pilihan = Number(b.dataset.pil); else p.tombol = Number(b.dataset.tb);
      if (preview) p.st = preview;
      var r = await api('pel.jawab', p);
      if (!r.success) { toast(r.message, 'bad'); if (r.data && r.data.code === 'ULANG') main(); return; }
      var x = r.data;
      if (x.st) preview = x.st;
      if (x.selesai) {
        lmsBasi(m.kursus_id);
        body.innerHTML = '<div class="card card-p tc">' + (x.umpan ? '<div class="note ' + (x.jawabanBenar ? 'ok' : 'bad') + ' tl">' + ic(x.jawabanBenar ? 'circle-check' : 'circle-x') + '<div>' + esc(x.umpan) + '</div></div>' : '') + '<div class="kz-skor ' + (x.lulus ? 'ok' : 'warn') + ' mt12">' + fmtN(x.nilai) + '<small>%</small></div><h3>' + (x.lulus ? 'Pelajaran tuntas! 🎉' : 'Pelajaran selesai') + '</h3><div class="small muted">' + x.benar + ' dari ' + x.dijawab + ' jawaban benar</div><div class="row wrap gap8 mt16" style="justify-content:center"><a class="btn btn-outline" href="#/kursus/' + esc(m.kursus_id) + '">' + ic('arrow-left') + 'Kembali ke kursus</a>' + (preview ? '' : '<button class="btn btn-primary" id="plRingkas">' + ic('rotate-ccw') + 'Lihat ringkasan</button>') + '</div></div>';
        if ($('#plRingkas', body)) $('#plRingkas', body).onclick = function () { main(); };
        preview = null;
        return;
      }
      halaman(x, x.umpan ? { teks: x.umpan, benar: x.jawabanBenar } : null);
    };
  }
  function guru(d) {
    var hal = d.halaman, idx = {}; hal.forEach(function (h) { idx[h.id] = h; });
    var tj = function (k) { return { lanjut: 'halaman berikut', ulang: 'ulangi', sebelum: 'sebelumnya', akhir: 'SELESAI' }[k] || (idx[k] ? k + ': ' + idx[k].judul : k); };
    body.innerHTML = '<div class="grid g-main"><div class="card"><div class="card-h"><div class="grow"><h3>' + ic('route') + ' Alur ' + hal.length + ' halaman</h3><p>Lulus bila ≥ ' + (d.modul.konten.nilai_min || 70) + '%</p></div><button class="btn btn-primary btn-sm" id="plPre">' + ic('play') + 'Pratinjau</button></div><div class="card-b">' +
      hal.map(function (h) { return '<div class="pel-alur"><span class="bdg navy">' + esc(h.id) + '</span><div class="grow"><b>' + esc(h.judul) + '</b> <span class="xs muted">' + (h.tipe === 'soal' ? 'pertanyaan' : 'konten') + '</span><div class="xs">' + (h.tipe === 'soal' ? h.opsi.map(function (o) { return (o.benar ? '✓ ' : '✗ ') + esc(o.teks) + ' → ' + esc(tj(o.lompat)); }).join('<br>') : (h.tombol || []).map(function (t) { return '[' + esc(t.label) + '] → ' + esc(tj(t.ke)); }).join(' ')) + '</div></div></div>'; }).join('') + '</div></div>' +
      '<div class="card"><div class="card-h"><h3>' + ic('users') + ' Progres Siswa</h3></div><div class="card-b">' + (d.ringkasan.length ? d.ringkasan.map(function (s) { return '<div class="list-i"><div class="grow"><b>' + esc(s.nama) + '</b><div class="xs muted">' + s.percobaan + '× • ' + relTime(s.terakhir) + '</div></div><b>' + (s.terbaik === null ? '-' : fmtN(s.terbaik) + '%') + '</b></div>'; }).join('') : '<div class="muted small">Belum ada siswa yang mengerjakan.</div>') + '</div></div></div>';
    $('#plPre', body).onclick = function () { preview = null; main({ pratinjau: true }); };
  }
  main();
};

// =====================================================================
// UMPAN BALIK & SURVEI
// =====================================================================
VIEW.umpanbalik = function (body, m) {
  body.innerHTML = '<div class="sk" style="height:220px"></div>';
  apiLR('ub.get', { modul_id: m.modul_id }, function (r) {
    if (!r.success) { body.innerHTML = errorBox(r.message); return; }
    var d = r.data;
    if (m.kelola) return hasil(true, d);
    if (d.sudah) { body.innerHTML = '<div class="card card-p tc">' + ic('heart-handshake', 'besar ok-t') + '<h3 class="mt8">Terima kasih, survei sudah Anda isi!</h3>' + (d.anonim ? '<div class="small muted">Jawaban disimpan secara anonim.</div>' : '') + (d.bolehLihatHasil ? '<button class="btn btn-outline mt12" id="ubHasil">' + ic('chart-column') + 'Lihat rekap hasil</button>' : '') + '</div><div id="ubBox"></div>'; if ($('#ubHasil', body)) $('#ubHasil', body).onclick = function () { hasil(false, d); }; return; }
    if (!d.dibuka || d.ditutup) { body.innerHTML = '<div class="card card-p">' + emptyHtml(d.ditutup ? 'Survei sudah ditutup' : 'Survei belum dibuka', '', 'clock') + '</div>'; return; }
    body.innerHTML = '<div class="card card-p ub-form">' + (d.pengantar ? md(d.pengantar) : '') + (d.anonim ? '<div class="note mb12">' + ic('venetian-mask') + '<div>Survei ini <b>anonim</b> — nama Anda tidak disimpan bersama jawaban.</div></div>' : '') +
      d.pertanyaan.map(function (q, i) {
        var inp = '';
        if (q.tipe === 'skala') inp = '<div class="skala">' + [1, 2, 3, 4, 5].map(function (v) { return '<label><input type="radio" name="' + q.id + '" value="' + v + '"><span>' + v + '</span></label>'; }).join('') + '</div><div class="row between xs muted"><span>Sangat tidak setuju</span><span>Sangat setuju</span></div>';
        else if (q.tipe === 'pilihan') inp = q.opsi.map(function (o) { return '<label class="chk"><input type="radio" name="' + q.id + '" value="' + esc(o) + '"> ' + esc(o) + '</label>'; }).join('');
        else if (q.tipe === 'pilihanganda') inp = q.opsi.map(function (o) { return '<label class="chk"><input type="checkbox" name="' + q.id + '" value="' + esc(o) + '"> ' + esc(o) + '</label>'; }).join('');
        else inp = '<textarea class="inp" name="' + q.id + '" rows="3"></textarea>';
        return '<div class="ub-q"><b>' + (i + 1) + '. ' + esc(q.teks) + (q.wajib ? ' <span class="bad-t">*</span>' : '') + '</b><div class="mt8">' + inp + '</div></div>';
      }).join('') + '<button class="btn btn-primary btn-lg mt16" id="ubKirim">' + ic('send') + 'Kirim jawaban</button></div>';
    $('#ubKirim', body).onclick = async function () {
      var jw = {};
      d.pertanyaan.forEach(function (q) {
        if (q.tipe === 'pilihanganda') jw[q.id] = $$('[name="' + q.id + '"]:checked', body).map(function (x) { return x.value; });
        else if (q.tipe === 'teks') jw[q.id] = $('[name="' + q.id + '"]', body).value;
        else { var c = $('[name="' + q.id + '"]:checked', body); jw[q.id] = c ? c.value : ''; }
      });
      btnBusy(this, true); var s = await api('ub.kirim', { modul_id: m.modul_id, jawaban: jw }); btnBusy(this, false);
      if (toastRes(s)) { lmsBasi(m.kursus_id); VIEW.umpanbalik(body, m); }
    };
  });
  function hasil(guru, info) {
    var box = guru ? body : $('#ubBox', body);
    box.innerHTML = '<div class="sk mt16" style="height:200px"></div>';
    apiLR('ub.hasil', { modul_id: m.modul_id }, function (r) {
      if (!r.success) { box.innerHTML = errorBox(r.message); return; }
      var d = r.data;
      box.innerHTML = (guru ? '<div class="grid g3">' + kpi('Responden', d.jml + '<small>/' + d.jml_siswa + '</small>', d.jml_siswa ? Math.round(d.jml / d.jml_siswa * 100) + '% partisipasi' : '', 'users', 'info') + kpi('Mode', d.anonim ? 'Anonim' : 'Bernama', '', d.anonim ? 'venetian-mask' : 'user-round') + kpi('Pertanyaan', d.hasil.length, '', 'list') + '</div>' : '') +
        '<div class="card mt16"><div class="card-h"><h3 class="grow">' + ic('chart-column') + ' Rekap Jawaban</h3>' + (guru ? '<button class="btn btn-outline btn-sm" id="ubCsv">' + ic('download') + 'CSV</button>' : '') + '</div><div class="card-b">' +
        d.hasil.map(function (q, i) {
          var isi = '';
          if (q.tipe === 'skala') { var mx = Math.max.apply(null, q.dist.concat([1])); isi = '<div class="row gap8"><b class="big-mid">' + (q.rata === null ? '-' : fmtN(q.rata)) + '</b><span class="xs muted">rata-rata dari 5 • ' + q.n + ' jawaban</span></div>' + q.dist.map(function (c, v) { return '<div class="bar-row"><span>' + (v + 1) + '</span><div class="bar-bg"><span style="width:' + (c / mx * 100) + '%"></span></div><b>' + c + '</b></div>'; }).join(''); }
          else if (q.hitung) { var tot = Math.max(1, q.n); isi = Object.keys(q.hitung).map(function (o) { return '<div class="bar-row lebar"><span class="ellipsis">' + esc(o) + '</span><div class="bar-bg"><span style="width:' + (q.hitung[o] / tot * 100) + '%"></span></div><b>' + q.hitung[o] + '</b></div>'; }).join(''); }
          else isi = q.teksJawaban.length ? q.teksJawaban.slice(0, 50).map(function (t) { return '<div class="ub-teks">"' + esc(t.teks) + '"' + (t.nama ? ' <span class="xs muted">— ' + esc(t.nama) + '</span>' : '') + '</div>'; }).join('') : '<div class="muted small">Belum ada jawaban.</div>';
          return '<div class="ub-hasil"><b>' + (i + 1) + '. ' + esc(q.teks) + '</b><div class="mt8">' + isi + '</div></div>';
        }).join('') + '</div></div>';
      if ($('#ubCsv', box)) $('#ubCsv', box).onclick = function () {
        var rows = d.responden ? d.responden.map(function (x) { return [x.nama, x.waktu].concat(d.hasil.map(function (q) { var v = x.jawaban[q.id]; return Array.isArray(v) ? v.join('; ') : v || ''; })); }) : d.hasil.map(function (q) { return [q.teks, q.rata !== undefined ? q.rata : '', JSON.stringify(q.hitung || q.dist || q.teksJawaban.map(function (t) { return t.teks; }))]; });
        downloadCSV('survei-' + m.modul_id + '.csv', d.responden ? ['Nama', 'Waktu'].concat(d.hasil.map(function (q) { return q.teks; })) : ['Pertanyaan', 'Rata-rata', 'Rekap'], rows);
      };
    });
  }
};

// =====================================================================
// KELAS VIRTUAL
// =====================================================================
var KV_LBL = { meet: ['Google Meet', '#188038'], zoom: ['Zoom', '#2D8CFF'], bbb: ['BigBlueButton', '#283274'], teams: ['Microsoft Teams', '#5059C9'], lain: ['Ruang virtual', '#475569'] };
VIEW.kelasvirtual = function (body, m) {
  var k = m.konten, pl = KV_LBL[k.platform] || KV_LBL.lain, mulai = msDari(k.mulai), akhir = mulai + (k.durasi || 60) * 60000, now = Date.now();
  var status = !mulai ? '' : now < mulai ? 'Dimulai dalam ' + sisaWaktu(mulai - now) : now <= akhir ? '<b class="ok-t">● Sedang berlangsung</b>' : 'Sudah selesai';
  body.innerHTML = '<div class="grid g-main"><div class="card card-p kv-card" style="--pc:' + pl[1] + '"><div class="kv-plat">' + ic('video') + esc(pl[0]) + '</div>' + (k.mulai ? '<h2 class="mt12">' + tglJam(k.mulai) + '</h2><div class="small">' + (k.durasi || 60) + ' menit • ' + status + '</div>' : '') +
    (k.catatan ? '<div class="mt12">' + md(k.catatan) + '</div>' : '') + (k.kata_sandi ? '<div class="small mt8">Kode sandi: <span class="kbd">' + esc(k.kata_sandi) + '</span></div>' : '') +
    '<button class="btn btn-primary btn-lg mt16" id="kvGabung">' + ic('log-in') + (m.kelola ? 'Masuk sebagai pengajar' : 'Gabung kelas virtual') + '</button><div id="kvLink" class="small mt8"></div>' +
    (k.rekaman ? '<div class="mt16"><a class="btn btn-outline" href="' + esc(k.rekaman) + '" target="_blank" rel="noopener">' + ic('circle-play') + 'Tonton rekaman</a></div>' : '') + '</div><div id="kvHadir"></div></div>';
  $('#kvGabung', body).onclick = async function () {
    var w = window.open('', '_blank');
    btnBusy(this, true); var r = await api('kv.gabung', { modul_id: m.modul_id }); btnBusy(this, false);
    if (!r.success) { if (w) w.close(); return toast(r.message, 'bad'); }
    if (w) { try { w.opener = null; w.location = r.data.url; } catch (e) {} }
    $('#kvLink', body).innerHTML = 'Bila tidak terbuka otomatis: <a href="' + esc(r.data.url) + '" target="_blank" rel="noopener">buka kelas virtual</a>';
    lmsBasi(m.kursus_id);
    if (m.kelola) hadir();
  };
  function hadir() {
    apiLR('kv.hadir', { modul_id: m.modul_id }, function (r) {
      if (!r.success) return;
      $('#kvHadir', body).innerHTML = '<div class="card"><div class="card-h"><h3>' + ic('user-check') + ' Kehadiran ' + r.data.jml_hadir + '/' + r.data.siswa.length + '</h3></div><div class="card-b">' + r.data.siswa.map(function (s) { return '<div class="list-i small"><span class="grow">' + esc(s.nama) + '</span>' + (s.hadir.length ? '<span class="bdg ok">' + tglJam(s.hadir[s.hadir.length - 1], true) + '</span>' : '<span class="muted">—</span>') + '</div>'; }).join('') + '</div></div>';
    });
  }
  if (m.kelola) hadir();
};
