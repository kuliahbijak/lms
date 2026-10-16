/* =====================================================================
   SIAKAD SISWA v3.0 — pages-evaluasi.js : Penilaian & Evaluasi LMS (guru)
   Buku Nilai (kategori berbobot, skala, nilai timpa, ekspor Excel, kirim ke
   raport), Bank Soal (7 tipe soal + impor teks), Rubrik & Panduan Penilaian.
   ===================================================================== */
'use strict';

function pilihKursusKelola(sel, cb) {
  return api('lms.kursus.list', {}).then(function (r) {
    var list = r.success ? r.data.kursus.filter(function (k) { return k.peran !== 'siswa'; }) : [];
    cb(list, sel && list.some(function (k) { return k.kursus_id === sel; }) ? sel : (list[0] && list[0].kursus_id));
    return list;
  });
}

// =====================================================================
// BUKU NILAI
// =====================================================================
registerPage('guru', 'bukunilai', {
  title: 'Buku Nilai', alwaysRender: true,
  render: function (el, kid) {
    var self = this;
    el.innerHTML = pageHead('E-Learning <span>/ Buku Nilai</span>', 'Buku Nilai Kursus', 'Nilai seluruh aktivitas berbobot, kategori & bobot, skala nilai, ekspor Excel, dan kirim ke nilai raport.',
      '<select class="sel" id="bnK" style="min-width:240px"></select>') + '<div id="bnBody"><div class="sk" style="height:320px"></div></div>';
    pilihKursusKelola(kid, function (list, pilih) {
      $('#bnK', el).innerHTML = list.map(function (k) { return '<option value="' + esc(k.kursus_id) + '"' + (k.kursus_id === pilih ? ' selected' : '') + '>' + esc(k.nama) + '</option>'; }).join('');
      $('#bnK', el).onchange = function () { go('bukunilai', this.value); };
      if (!pilih) { $('#bnBody', el).innerHTML = '<div class="card card-p">' + emptyHtml('Belum ada kursus yang Anda ajar', 'Buat kursus di menu Kursus.', 'graduation-cap') + '</div>'; return; }
      self.muat(el, pilih);
    });
  },
  muat: function (el, kid) {
    var self = this, box = $('#bnBody', el);
    apiLR('nilai.buku', { kursus_id: kid }, function (r) {
      if (!r.success) { box.innerHTML = errorBox(r.message); return; }
      self.d = r.data; self.kid = kid; self.ubah = {}; self.gambar(el);
    });
  },
  gambar: function (el) {
    var self = this, d = this.d, box = $('#bnBody', el), kat = d.kategori.concat([{ kategori_id: '', nama: 'Lainnya', bobot: d.bobotSisa }]);
    var grup = kat.map(function (c) { return { c: c, items: d.items.filter(function (it) { return (d.kategori.some(function (x) { return x.kategori_id === it.kategori_id; }) ? it.kategori_id : '') === c.kategori_id; }) }; }).filter(function (g) { return g.items.length; });
    var lulus = d.baris.filter(function (b) { return b.total !== null && b.total >= d.kkm; }).length;
    box.innerHTML = '<div class="grid g4">' + kpi('Siswa', d.baris.length, d.kursus.nama, 'users', 'info') + kpi('Item nilai', d.items.length, grup.length + ' kategori', 'list-checks') + kpi('Rata-rata kelas', d.rataKelas === null ? '-' : fmtN(d.rataKelas), 'skala ' + esc(d.skala.nama), 'chart-line') + kpi('Tuntas KKM ' + d.kkm, lulus + '<small>/' + d.baris.length + '</small>', '', 'award', 'ok') + '</div>' +
      '<div class="card mt16"><div class="card-h wrap"><div class="grow"><h3>' + ic('table-2') + ' Lembar Nilai</h3><p>Klik sel untuk mengisi / menimpa nilai. ' + ic('circle-dot', 'amber') + ' = nilai ditimpa guru.</p></div><div class="row wrap gap8">' +
      '<button class="btn btn-outline btn-sm" id="bnAtur">' + ic('sliders-horizontal') + 'Kategori & bobot</button><button class="btn btn-outline btn-sm" id="bnItem">' + ic('plus') + 'Item manual</button><button class="btn btn-outline btn-sm" id="bnXls">' + ic('file-spreadsheet') + 'Ekspor Excel</button><button class="btn btn-dark btn-sm" id="bnRaport">' + ic('send') + 'Kirim ke Nilai Raport</button></div></div>' +
      '<div class="tbl-wrap bn-wrap"><table class="tbl bn"><thead><tr><th rowspan="2" class="stick">Siswa</th>' + grup.map(function (g) { return '<th colspan="' + (g.items.length + 1) + '" class="tc kat-h">' + esc(g.c.nama) + ' <span class="xs">' + fmtN(g.c.bobot) + '%</span></th>'; }).join('') + '<th rowspan="2" class="tc">Total</th><th rowspan="2" class="tc">Huruf</th></tr><tr>' +
      grup.map(function (g) { return g.items.map(function (it) { return '<th class="tc it-h" title="' + esc(it.nama) + ' (maks ' + it.maks + ', bobot ' + it.bobot + ')">' + tipeIkon(it.otomatis ? it.tipe : 'label', 'kecil') + '<div class="xs ellipsis">' + esc(it.nama) + '</div><div class="xs muted">/' + it.maks + '</div></th>'; }).join('') + '<th class="tc sub-h xs">Σ ' + esc(g.c.nama.split(' ')[0]) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      d.baris.map(function (b) {
        return '<tr data-uid="' + esc(b.uid) + '"><td class="stick"><b class="small">' + esc(b.nama) + '</b><div class="xs muted">' + esc(b.kelas) + '</div></td>' + grup.map(function (g) {
          return g.items.map(function (it) { var e = b.nilai[it.ref], k = it.ref + '|' + b.uid, u = self.ubah[k]; var v = u ? u.nilai : (e ? e.nilai : ''); return '<td class="tc sel-n' + (u ? ' diubah' : '') + (e && e.timpa ? ' timpa' : '') + '" data-ref="' + esc(it.ref) + '" title="' + esc(e && e.catatan ? e.catatan : '') + '">' + (v === '' || v === null || v === undefined ? '<span class="muted">·</span>' : fmtN(v)) + '</td>'; }).join('') +
            '<td class="tc sub">' + (b.perKategori[g.c.kategori_id] === null || b.perKategori[g.c.kategori_id] === undefined ? '-' : fmtN(b.perKategori[g.c.kategori_id])) + '</td>';
        }).join('') + '<td class="tc"><b class="' + (b.total !== null && b.total < d.kkm ? 'bad-t' : '') + '">' + (b.total === null ? '-' : fmtN(b.total)) + '</b></td><td class="tc">' + (b.skala ? '<span class="bdg ' + (b.total >= d.kkm ? 'ok' : 'warn') + '">' + esc(b.skala.huruf) + '</span>' : '-') + '</td></tr>';
      }).join('') + '</tbody><tfoot><tr><td class="stick xs b">Rata-rata<br>Min – Maks</td>' + grup.map(function (g) { return g.items.map(function (it) { var s = d.statistik[it.ref] || {}; return '<td class="tc xs">' + (s.n ? fmtN(s.rata) + '%<br><span class="muted">' + fmtN(s.min) + '–' + fmtN(s.maks) + '</span>' : '-') + '</td>'; }).join('') + '<td></td>'; }).join('') + '<td class="tc xs b">' + (d.rataKelas === null ? '-' : fmtN(d.rataKelas)) + '</td><td></td></tr></tfoot></table></div>' +
      '<div class="card-b row" id="bnSimpanBar" hidden><span class="grow small"><b id="bnN">0</b> perubahan belum disimpan</span><button class="btn btn-outline btn-sm" id="bnBatal">Batal</button><button class="btn btn-primary btn-sm" id="bnSimpan">' + ic('save') + 'Simpan</button></div></div>';
    function bar() { var n = Object.keys(self.ubah).length; $('#bnSimpanBar', box).hidden = !n; $('#bnN', box).textContent = n; }
    box.onclick = async function (e) {
      var td = e.target.closest('.sel-n');
      if (td) {
        var uid = td.closest('tr').dataset.uid, ref = td.dataset.ref, it = d.items.filter(function (x) { return x.ref === ref; })[0], b = d.baris.filter(function (x) { return x.uid === uid; })[0], ent = b.nilai[ref] || {}, k = ref + '|' + uid, u = self.ubah[k] || {};
        var mm = modal({ title: it.nama, sub: b.nama + ' • maks ' + it.maks, size: 'sm', body: '<div class="field"><label>Nilai (0–' + it.maks + ')</label><input class="inp" type="number" min="0" max="' + it.maks + '" step="0.5" id="cnV" value="' + esc(u.nilai !== undefined ? u.nilai : (ent.nilai === undefined ? '' : ent.nilai)) + '"></div><div class="field mt12"><label>Catatan</label><input class="inp" id="cnC" value="' + esc(u.catatan !== undefined ? u.catatan : (ent.catatan || '')) + '"></div>' +
          (it.otomatis ? '<div class="note mt12">' + ic('info') + '<div>Nilai aktivitas diisi otomatis. Mengubahnya di sini <b>menimpa</b> nilai otomatis.' + (ent.timpa ? '<label class="chk mt8"><input type="checkbox" id="cnL"> Kembalikan ke nilai otomatis</label>' : '') + '</div></div>' : ''),
          foot: '<button class="btn btn-outline" data-x>Batal</button><button class="btn btn-primary" id="cnOk">Terapkan</button>' });
        $('#cnOk', mm.el).onclick = function () { var v = $('#cnV', mm.el).value; if (v !== '' && (Number(v) < 0 || Number(v) > it.maks)) return toast('Nilai 0–' + it.maks + '.', 'warn'); self.ubah[k] = { uid: uid, ref: ref, nilai: v === '' ? '' : Number(v), catatan: $('#cnC', mm.el).value, lepasTimpa: $('#cnL', mm.el) ? $('#cnL', mm.el).checked : false }; mm.close(); self.gambar(el); };
        return;
      }
      var bt = e.target.closest('button'); if (!bt) return;
      if (bt.id === 'bnBatal') { self.ubah = {}; self.gambar(el); }
      else if (bt.id === 'bnSimpan') { btnBusy(bt, true); var r = await api('nilai.entri.save', { kursus_id: self.kid, entri: Object.keys(self.ubah).map(function (k) { return self.ubah[k]; }) }); btnBusy(bt, false); if (toastRes(r)) self.muat(el, self.kid); }
      else if (bt.id === 'bnAtur') self.atur(el);
      else if (bt.id === 'bnItem') self.itemManual(el, null);
      else if (bt.id === 'bnXls') self.excel();
      else if (bt.id === 'bnRaport') self.raport(el);
    };
    bar();
  },
  atur: function (el) {
    var self = this, d = this.d, kat = d.kategori.map(function (c) { return Object.assign({}, c); });
    var m = modal({ title: 'Kategori, Bobot & Skala', sub: d.kursus.nama, size: 'xl', body: '<div class="grid g2"><div><div class="xs b muted">KATEGORI NILAI (total ≤ 100%)</div><div id="atK" class="mt8"></div><button class="btn btn-ghost btn-sm mt8" id="atKAdd">' + ic('plus') + 'Kategori</button><div class="xs muted mt8" id="atSisa"></div>' +
      '<div class="xs b muted mt16">SKALA NILAI</div><div class="row gap8 mt8"><select class="sel" id="atSkala">' + d.skalaSemua.map(function (s) { return '<option value="' + esc(s.skala_id) + '"' + (s.skala_id === d.skala.skala_id ? ' selected' : '') + '>' + esc(s.nama) + '</option>'; }).join('') + '</select><button class="btn btn-ghost btn-sm" id="atSkalaBaru">' + ic('plus') + 'Skala baru</button></div><div id="atSkalaInfo" class="xs muted mt8"></div>' +
      '<label class="chk mt16"><input type="checkbox" id="atTampil"' + (d.kursus.tampil_nilai !== 'TIDAK' ? ' checked' : '') + '> Tampilkan nilai kursus ke siswa</label></div>' +
      '<div><div class="xs b muted">PENEMPATAN ITEM & BOBOT</div><div class="tbl-wrap mt8"><table class="tbl"><thead><tr><th>Item</th><th>Kategori</th><th>Bobot</th></tr></thead><tbody id="atItem"></tbody></table></div></div></div>',
      foot: '<button class="btn btn-outline" data-x>Batal</button><button class="btn btn-primary" id="atSave">' + ic('save') + 'Simpan</button>' });
    function drawK() {
      $('#atK', m.el).innerHTML = kat.map(function (c, i) { return '<div class="row gap8 mt8" data-i="' + i + '"><input class="inp grow" data-f="nama" value="' + esc(c.nama) + '" placeholder="Nama kategori"><input class="inp" type="number" data-f="bobot" min="0" max="100" value="' + esc(c.bobot) + '" style="width:80px" title="Bobot %"><span class="xs">%</span><input class="inp" type="number" data-f="buang_terendah" min="0" max="10" value="' + esc(c.buang_terendah || 0) + '" style="width:64px" title="Buang N nilai terendah"><button class="btn-ic" data-del>' + ic('x') + '</button></div>'; }).join('');
      var tot = kat.reduce(function (s, c) { return s + Number(c.bobot || 0); }, 0);
      $('#atSisa', m.el).innerHTML = 'Total ' + tot + '% • item tanpa kategori mendapat sisa <b>' + Math.max(0, 100 - tot) + '%</b>' + (tot > 100 ? ' <span class="bad-t">— melebihi 100%!</span>' : '') + '<br>Kolom ketiga = jumlah nilai terendah yang dibuang.';
      $('#atItem', m.el).innerHTML = d.items.map(function (it) { return '<tr><td class="small">' + tipeIkon(it.otomatis ? it.tipe : 'label', 'kecil') + esc(it.nama) + '</td><td><select class="sel" data-pen="' + esc(it.ref) + '"><option value="">Lainnya</option>' + kat.filter(function (c) { return c.kategori_id; }).map(function (c) { return '<option value="' + esc(c.kategori_id) + '"' + (c.kategori_id === it.kategori_id ? ' selected' : '') + '>' + esc(c.nama) + '</option>'; }).join('') + '</select></td><td>' + (it.otomatis ? '<input class="inp" type="number" min="0" step="0.5" data-bobot="' + esc(it.ref) + '" value="' + esc(it.bobot) + '" style="width:70px">' : it.bobot) + '</td></tr>'; }).join('');
      var s = d.skalaSemua.filter(function (x) { return x.skala_id === $('#atSkala', m.el).value; })[0];
      $('#atSkalaInfo', m.el).textContent = s ? s.rentang.map(function (r) { return r.huruf + ' ≥ ' + r.min + ' (' + r.predikat + ')'; }).join(' • ') : '';
    }
    function sinkron() { $$('#atK [data-i]', m.el).forEach(function (r) { var c = kat[Number(r.dataset.i)]; $$('[data-f]', r).forEach(function (x) { c[x.dataset.f] = x.type === 'number' ? Number(x.value) : x.value; }); }); }
    drawK();
    m.el.addEventListener('input', function (e) { if (e.target.closest('#atK')) { sinkron(); var tot = kat.reduce(function (s, c) { return s + Number(c.bobot || 0); }, 0); $('#atSisa', m.el).firstChild.textContent = 'Total ' + tot + '% • item tanpa kategori mendapat sisa '; } });
    m.el.addEventListener('change', function (e) { if (e.target.id === 'atSkala') drawK(); });
    m.el.addEventListener('click', async function (e) {
      if (e.target.closest('#atKAdd')) { sinkron(); kat.push({ nama: '', bobot: 0, buang_terendah: 0 }); drawK(); }
      var del = e.target.closest('[data-del]'); if (del) { sinkron(); kat.splice(Number(del.closest('[data-i]').dataset.i), 1); drawK(); }
      if (e.target.closest('#atSkalaBaru')) {
        var mm = modal({ title: 'Skala Nilai Baru', size: 'md', body: '<div class="field"><label>Nama skala</label><input class="inp" id="skN" placeholder="mis. Predikat Kurikulum Merdeka"></div><div class="xs b muted mt12">TINGKAT (nilai minimal → huruf → predikat)</div><div id="skR">' + [[90, 'A', 'Sangat Baik'], [80, 'B', 'Baik'], [70, 'C', 'Cukup'], [0, 'D', 'Perlu Bimbingan']].map(function (x) { return '<div class="row gap8 mt8"><input class="inp" type="number" value="' + x[0] + '" style="width:80px"><input class="inp" value="' + x[1] + '" style="width:70px"><input class="inp grow" value="' + x[2] + '"></div>'; }).join('') + '</div>',
          foot: '<button class="btn btn-outline" data-x>Batal</button><button class="btn btn-primary" id="skOk">Simpan skala</button>' });
        $('#skOk', mm.el).onclick = async function () { var rentang = $$('#skR .row', mm.el).map(function (r) { var i = $$('input', r); return { min: Number(i[0].value), huruf: i[1].value, predikat: i[2].value }; }); var r = await api('nilai.skala.save', { nama: $('#skN', mm.el).value, rentang: rentang }); if (toastRes(r)) { d.skalaSemua = r.data.skalaSemua; mm.close(); $('#atSkala', m.el).innerHTML = d.skalaSemua.map(function (s) { return '<option value="' + esc(s.skala_id) + '">' + esc(s.nama) + '</option>'; }).join(''); $('#atSkala', m.el).value = d.skalaSemua[d.skalaSemua.length - 1].skala_id; drawK(); } };
      }
    });
    $('#atSave', m.el).onclick = async function () {
      sinkron();
      var hapus = d.kategori.filter(function (c) { return !kat.some(function (x) { return x.kategori_id === c.kategori_id; }); }).map(function (c) { return c.kategori_id; });
      var pen = {}; $$('[data-pen]', m.el).forEach(function (s) { pen[s.dataset.pen] = s.value; });
      var bobot = {}; $$('[data-bobot]', m.el).forEach(function (s) { bobot[s.dataset.bobot] = Number(s.value); });
      btnBusy(this, true);
      var r = await api('nilai.kategori.save', { kursus_id: self.kid, kategori: kat, hapus: hapus, penempatan: pen, bobotItem: bobot, skala_id: $('#atSkala', m.el).value, tampil_nilai: $('#atTampil', m.el).checked ? 'YA' : 'TIDAK' });
      btnBusy(this, false);
      if (toastRes(r)) { m.close(); LmsOpsi = {}; self.muat(el, self.kid); }
    };
  },
  itemManual: function (el, it) {
    var self = this, d = this.d;
    var m = modal({ title: 'Item Nilai Manual', sub: 'Untuk nilai luring: praktikum, presentasi, ulangan kertas…', size: 'sm', body: '<div class="field"><label>Nama item</label><input class="inp" id="imN" placeholder="mis. Praktikum Lab"></div><div class="grid g2 mt12"><div class="field"><label>Nilai maks</label><input class="inp" type="number" id="imM" value="100"></div><div class="field"><label>Bobot</label><input class="inp" type="number" id="imB" value="1" step="0.5"></div></div><div class="field mt12"><label>Kategori</label><select class="sel" id="imK"><option value="">Lainnya</option>' + d.kategori.map(function (c) { return '<option value="' + esc(c.kategori_id) + '">' + esc(c.nama) + '</option>'; }).join('') + '</select></div>',
      foot: '<button class="btn btn-outline" data-x>Batal</button><button class="btn btn-primary" id="imOk">Tambah</button>' });
    $('#imOk', m.el).onclick = async function () { var r = await api('nilai.item.save', { kursus_id: self.kid, nama: $('#imN', m.el).value, nilai_maks: Number($('#imM', m.el).value), bobot: Number($('#imB', m.el).value), kategori_id: $('#imK', m.el).value }); if (toastRes(r)) { m.close(); self.muat(el, self.kid); } };
  },
  excel: async function () {
    var d = this.d;
    try { await loadLib('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'); } catch (e) { return toast('Pustaka Excel gagal dimuat.', 'bad'); }
    var head = ['No', 'Nama', 'Kelas'].concat(d.items.map(function (it) { return it.nama + ' (/' + it.maks + ')'; })).concat(d.kategori.map(function (c) { return 'Σ ' + c.nama + ' (' + c.bobot + '%)'; })).concat(['Total', 'Huruf', 'Predikat']);
    var rows = d.baris.map(function (b, i) { return [i + 1, b.nama, b.kelas].concat(d.items.map(function (it) { var e = b.nilai[it.ref]; return e && e.nilai !== '' ? Number(e.nilai) : ''; })).concat(d.kategori.map(function (c) { var v = b.perKategori[c.kategori_id]; return v === null || v === undefined ? '' : v; })).concat([b.total === null ? '' : b.total, b.skala ? b.skala.huruf : '', b.skala ? b.skala.predikat : '']); });
    var ws = XLSX.utils.aoa_to_sheet([[d.kursus.nama], ['Tahun ajaran ' + d.tahun_ajaran + ' • Semester ' + d.semester + ' • KKM ' + d.kkm], []].concat([head]).concat(rows));
    ws['!cols'] = [{ wch: 4 }, { wch: 28 }, { wch: 12 }].concat(head.slice(3).map(function () { return { wch: 12 }; }));
    var wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Buku Nilai');
    XLSX.writeFile(wb, 'buku-nilai-' + (d.kursus.kode || this.kid) + '.xlsx');
    toast('Berkas Excel diunduh.', 'ok');
  },
  raport: function (el) {
    var self = this, d = this.d;
    var m = modal({ title: 'Kirim ke Nilai Raport', sub: 'Mengisi satu kolom raport (Harian/UTS/UAS) dari nilai kursus. Modul raport tetap seperti biasa.', size: 'lg',
      body: '<div class="grid-form"><div class="field c4"><label>Kolom raport</label><select class="sel" id="rpK">' + selOpts([['nilai_harian', 'Nilai Harian'], ['nilai_uts', 'Nilai UTS'], ['nilai_uas', 'Nilai UAS']], 'nilai_harian') + '</select></div>' +
        '<div class="field c4"><label>Sumber nilai</label><select class="sel" id="rpS"><option value="total">Total kursus</option>' + d.kategori.map(function (c) { return '<option value="' + esc(c.kategori_id) + '">Kategori: ' + esc(c.nama) + '</option>'; }).join('') + '</select></div>' +
        '<div class="field c4"><label>Mata pelajaran raport</label><select class="sel" id="rpM">' + ((AppState.boot && AppState.boot.mapel) || []).map(function (x) { return '<option' + (x.nama === d.kursus.mapel ? ' selected' : '') + '>' + esc(x.nama) + '</option>'; }).join('') + '</select></div></div>' +
        '<div class="row mt8"><button class="btn btn-outline btn-sm" id="rpPre">' + ic('eye') + 'Pratinjau</button><span class="xs muted grow" style="margin-left:8px">Tahun ajaran ' + esc(d.tahun_ajaran) + ' • semester ' + esc(d.semester) + '</span></div><div id="rpBox" class="mt12"></div>',
      foot: '<button class="btn btn-outline" data-x>Batal</button><button class="btn btn-dark" id="rpGo" disabled>' + ic('send') + 'Kirim ke raport</button>' });
    function par() { return { kursus_id: self.kid, kolom: $('#rpK', m.el).value, sumber: $('#rpS', m.el).value, mapel: $('#rpM', m.el).value }; }
    $('#rpPre', m.el).onclick = async function () {
      btnBusy(this, true); var r = await api('nilai.raport.pratinjau', par()); btnBusy(this, false);
      if (!r.success) return toast(r.message, 'bad');
      var x = r.data, adaNilai = x.baris.filter(function (b) { return b.baru !== null; }).length;
      $('#rpBox', m.el).innerHTML = '<div class="tbl-wrap" style="max-height:320px"><table class="tbl"><thead><tr><th>NIS</th><th>Nama</th><th class="tr">Nilai lama</th><th class="tr">Nilai baru</th></tr></thead><tbody>' + x.baris.map(function (b) { return '<tr><td class="mono small">' + esc(b.NIS) + '</td><td>' + esc(b.nama) + '</td><td class="tr muted">' + (b.lama === '' ? '-' : esc(b.lama)) + '</td><td class="tr"><b>' + (b.baru === null ? '<span class="muted">-</span>' : b.baru) + '</b></td></tr>'; }).join('') + '</tbody></table></div><div class="note mt8">' + ic('info') + '<div>' + adaNilai + ' nilai akan ditulis ke kolom ' + esc($('#rpK', m.el).selectedOptions[0].text) + ' — ' + esc(x.mapel) + '. Nilai akhir & predikat raport dihitung ulang otomatis.</div></div>';
      $('#rpGo', m.el).disabled = !adaNilai;
    };
    ['rpK', 'rpS', 'rpM'].forEach(function (id) { $('#' + id, m.el).onchange = function () { $('#rpGo', m.el).disabled = true; $('#rpBox', m.el).innerHTML = ''; }; });
    $('#rpGo', m.el).onclick = async function () { if (!await confirmBox('Tulis nilai ke raport sekarang? Nilai lama di kolom tersebut akan diganti.', { ok: 'Kirim' })) return; btnBusy(this, true); var r = await api('nilai.raport.kirim', par()); btnBusy(this, false); if (toastRes(r)) { m.close(); afterWrite(); } };
  }
});

// =====================================================================
// BANK SOAL
// =====================================================================
registerPage('guru', 'banksoal', {
  title: 'Bank Soal', alwaysRender: true,
  render: function (el, kid) {
    var self = this;
    self.f = { kursus: kid || '', kategori: '', tipe: '', q: '' };
    el.innerHTML = pageHead('E-Learning <span>/ Bank Soal</span>', 'Bank Soal', 'Soal pilihan ganda, benar-salah, mencocokkan, isian singkat, esai, dan seret-lepas — dipakai ulang di banyak kuis.',
      '<button class="btn btn-outline" id="bsImpor">' + ic('file-up') + 'Impor teks</button><button class="btn btn-dark" id="bsBaru">' + ic('plus') + 'Soal baru</button>') +
      '<div class="card card-p"><div class="row wrap gap8"><select class="sel" id="bsK" style="max-width:260px"><option value="">Semua kursus & bank pribadi</option></select><select class="sel" id="bsKat" style="max-width:180px"><option value="">Semua kategori</option></select><select class="sel" id="bsT" style="max-width:190px"><option value="">Semua tipe</option>' + Object.keys(SOAL_LBL).map(function (t) { return '<option value="' + t + '">' + SOAL_LBL[t] + '</option>'; }).join('') + '</select><div class="inp-ic grow">' + ic('search') + '<input class="inp" id="bsQ" placeholder="Cari teks soal…"></div></div></div><div id="bsList" class="mt16"><div class="sk" style="height:240px"></div></div>';
    pilihKursusKelola(kid, function (list) { self.kursus = list; $('#bsK', el).innerHTML = '<option value="">Semua kursus & bank pribadi</option>' + list.map(function (k) { return '<option value="' + esc(k.kursus_id) + '"' + (k.kursus_id === kid ? ' selected' : '') + '>' + esc(k.nama) + '</option>'; }).join(''); });
    $('#bsK', el).onchange = function () { self.f.kursus = this.value; self.muat(el); };
    $('#bsKat', el).onchange = function () { self.f.kategori = this.value; self.draw(el); };
    $('#bsT', el).onchange = function () { self.f.tipe = this.value; self.draw(el); };
    $('#bsQ', el).oninput = debounce(function () { self.f.q = this.value.toLowerCase(); self.draw(el); }, 250);
    $('#bsBaru', el).onclick = function () { editorSoal(null, self.f.kursus, self.data ? self.data.kategori : [], function () { self.muat(el); }); };
    $('#bsImpor', el).onclick = function () { imporSoal(self.f.kursus, function () { self.muat(el); }); };
    this.muat(el);
  },
  muat: function (el) {
    var self = this;
    api('soal.list', { kursus_id: this.f.kursus }).then(function (r) {
      if (!r.success) { $('#bsList', el).innerHTML = errorBox(r.message); return; }
      self.data = r.data;
      $('#bsKat', el).innerHTML = '<option value="">Semua kategori</option>' + r.data.kategori.map(function (k) { return '<option' + (k === self.f.kategori ? ' selected' : '') + '>' + esc(k) + '</option>'; }).join('');
      self.draw(el);
    });
  },
  draw: function (el) {
    var self = this, f = this.f, list = (this.data.soal || []).filter(function (q) { return (!f.kategori || q.kategori === f.kategori) && (!f.tipe || q.tipe === f.tipe) && (!f.q || q.teks.toLowerCase().indexOf(f.q) > -1); });
    $('#bsList', el).innerHTML = '<div class="card"><div class="card-h"><h3 class="grow">' + list.length + ' soal</h3><button class="btn btn-ghost btn-sm" id="bsHapus" hidden>' + ic('trash-2') + 'Hapus terpilih</button></div>' +
      (list.length ? list.map(function (q) { return '<div class="soal-row"><label class="chk"><input type="checkbox" data-cek="' + esc(q.soal_id) + '"' + (q.milikSaya ? '' : ' disabled') + '></label><div class="grow"><div class="row wrap gap4"><span class="bdg navy">' + esc(SOAL_LBL[q.tipe]) + '</span>' + (q.kategori ? '<span class="bdg">' + esc(q.kategori) + '</span>' : '') + (q.kursus ? '<span class="xs muted">' + esc(q.kursus) + '</span>' : '<span class="xs muted">Bank pribadi</span>') + '</div><div class="mt4">' + esc(q.teks) + '</div><div class="xs muted mt4">' + q.skor + ' poin • dipakai ' + q.dipakai + ' kuis</div></div><button class="btn-ic" data-ed="' + esc(q.soal_id) + '" title="Ubah">' + ic('pencil') + '</button><button class="btn-ic" data-dup="' + esc(q.soal_id) + '" title="Duplikat">' + ic('copy') + '</button></div>'; }).join('') : '<div class="card-b">' + emptyHtml('Belum ada soal', 'Klik "Soal baru" atau impor dari teks.', 'list-checks') + '</div>') + '</div>';
    var box = $('#bsList', el);
    box.onchange = function () { $('#bsHapus', box).hidden = !$$('[data-cek]:checked', box).length; };
    box.onclick = async function (e) {
      var ed = e.target.closest('[data-ed],[data-dup]'); if (ed) { var q = self.data.soal.filter(function (x) { return x.soal_id === (ed.dataset.ed || ed.dataset.dup); })[0], salin = Object.assign({}, q); if (ed.dataset.dup) { delete salin.soal_id; salin.teks = salin.teks + ' (salinan)'; } editorSoal(salin, self.f.kursus, self.data.kategori, function () { self.muat(el); }); return; }
      if (e.target.closest('#bsHapus')) { var ids = $$('[data-cek]:checked', box).map(function (x) { return x.dataset.cek; }); if (!await confirmBox('Hapus ' + ids.length + ' soal dari bank?', { danger: true })) return; var r = await api('soal.hapus', { ids: ids }); if (toastRes(r)) self.muat(el); }
    };
  }
});
function editorSoal(q, kid, kategori, selesai) {
  q = q || { tipe: 'pg', teks: '', data: {}, skor: 1, kategori: '', kursus_id: kid };
  var d = JSON.parse(JSON.stringify(q.data || {}));
  var m = modal({ title: q.soal_id ? 'Ubah Soal' : 'Soal Baru', size: 'xl', body: '<div class="grid-form"><div class="field c4"><label>Tipe soal</label><select class="sel" id="esT"' + (q.soal_id ? ' disabled' : '') + '>' + Object.keys(SOAL_LBL).map(function (t) { return '<option value="' + t + '"' + (t === q.tipe ? ' selected' : '') + '>' + SOAL_LBL[t] + '</option>'; }).join('') + '</select></div>' +
    '<div class="field c4"><label>Kategori / topik</label><input class="inp" id="esK" list="esKl" value="' + esc(q.kategori || '') + '"><datalist id="esKl">' + (kategori || []).map(function (k) { return '<option>' + esc(k) + '</option>'; }).join('') + '</datalist></div><div class="field c4"><label>Skor bawaan</label><input class="inp" type="number" min="0.5" step="0.5" id="esS" value="' + esc(q.skor || 1) + '"></div>' +
    '<div class="field c12" id="esTeksW"><label>Pertanyaan</label><textarea class="inp" id="esTeks" rows="3">' + esc(q.teks === '(isi bagian yang kosong)' ? '' : q.teks) + '</textarea></div></div><div id="esData" class="mt12"></div><div class="field mt12"><label>Umpan balik umum (tampil saat ulasan)</label><input class="inp" id="esU" value="' + esc(q.umpan_balik || '') + '"></div>',
    foot: '<button class="btn btn-outline" data-x>Batal</button><button class="btn btn-primary" id="esSave">' + ic('save') + 'Simpan soal</button>' });
  function tipe() { return $('#esT', m.el).value; }
  function draw() {
    var t = tipe(), w = $('#esData', m.el);
    $('#esTeksW label', m.el).textContent = t === 'dragdrop' ? 'Instruksi (opsional)' : 'Pertanyaan';
    if (t === 'pg' || t === 'pgk') { if (!d.opsi || !d.opsi.length) d.opsi = [{ teks: '', benar: true }, { teks: '', benar: false }, { teks: '', benar: false }, { teks: '', benar: false }];
      w.innerHTML = '<div class="xs b muted">PILIHAN JAWABAN — tandai ' + (t === 'pg' ? 'satu' : 'semua') + ' jawaban benar</div>' + d.opsi.map(function (o, i) { return '<div class="row gap8 mt8" data-i="' + i + '"><input type="' + (t === 'pg' ? 'radio' : 'checkbox') + '" name="esB" data-f="benar"' + (o.benar ? ' checked' : '') + ' title="Benar"><span class="kz-huruf">' + String.fromCharCode(65 + i) + '</span><input class="inp grow" data-f="teks" value="' + esc(o.teks) + '"><input class="inp grow hide-m" data-f="umpan" value="' + esc(o.umpan || '') + '" placeholder="Umpan balik pilihan (opsional)"><button class="btn-ic" data-del>' + ic('x') + '</button></div>'; }).join('') + '<button class="btn btn-ghost btn-sm mt8" data-add>' + ic('plus') + 'Pilihan</button>'; }
    else if (t === 'bs') w.innerHTML = '<div class="xs b muted">KUNCI</div><div class="seg mt8"><label class="chk"><input type="radio" name="esBs" value="1"' + (d.benar !== false ? ' checked' : '') + '> Pernyataan BENAR</label><label class="chk"><input type="radio" name="esBs" value="0"' + (d.benar === false ? ' checked' : '') + '> Pernyataan SALAH</label></div>';
    else if (t === 'cocok') { if (!d.pasangan || !d.pasangan.length) d.pasangan = [{ kiri: '', kanan: '' }, { kiri: '', kanan: '' }, { kiri: '', kanan: '' }];
      w.innerHTML = '<div class="xs b muted">PASANGAN (kiri ↔ kanan)</div>' + d.pasangan.map(function (p, i) { return '<div class="row gap8 mt8" data-i="' + i + '"><input class="inp grow" data-f="kiri" value="' + esc(p.kiri) + '" placeholder="Pernyataan"><span>' + ic('arrow-left-right') + '</span><input class="inp grow" data-f="kanan" value="' + esc(p.kanan) + '" placeholder="Pasangan"><button class="btn-ic" data-del>' + ic('x') + '</button></div>'; }).join('') + '<button class="btn btn-ghost btn-sm mt8" data-add>' + ic('plus') + 'Pasangan</button><div class="field mt12"><label>Pengecoh di kolom kanan (pisahkan baris)</label><textarea class="inp" id="esPg" rows="2">' + esc((d.pengecoh || []).join('\n')) + '</textarea></div>'; }
    else if (t === 'singkat') { if (!d.jawaban || !d.jawaban.length) d.jawaban = [{ teks: '', nilai: 100 }];
      w.innerHTML = '<div class="xs b muted">JAWABAN YANG DITERIMA (gunakan * sebagai wildcard)</div>' + d.jawaban.map(function (j, i) { return '<div class="row gap8 mt8" data-i="' + i + '"><input class="inp grow" data-f="teks" value="' + esc(j.teks) + '" placeholder="Jawaban"><input class="inp" type="number" data-f="nilai" min="0" max="100" value="' + esc(j.nilai) + '" style="width:80px" title="Nilai %"><span class="xs">%</span><button class="btn-ic" data-del>' + ic('x') + '</button></div>'; }).join('') + '<button class="btn btn-ghost btn-sm mt8" data-add>' + ic('plus') + 'Jawaban</button><div class="row gap16 mt12 wrap"><label class="chk"><input type="checkbox" id="esHb"' + (d.huruf_besar ? ' checked' : '') + '> Peka huruf besar/kecil</label><label class="small">Toleransi angka ± <input class="inp" type="number" id="esTol" step="any" value="' + esc(d.toleransi || 0) + '" style="width:80px;display:inline-block"></label></div>'; }
    else if (t === 'esai') w.innerHTML = '<div class="field"><label>Panduan penilaian untuk guru</label><textarea class="inp" id="esPd" rows="3">' + esc(d.panduan || '') + '</textarea></div><div class="field mt12"><label>Minimal kata (0 = bebas)</label><input class="inp" type="number" id="esMk" min="0" value="' + esc(d.min_kata || 0) + '" style="max-width:120px"></div>';
    else if (t === 'dragdrop') { if (!d.pilihan) d.pilihan = ['', '', ''];
      w.innerHTML = '<div class="field"><label>Teks dengan tempat kosong — tulis [[1]], [[2]] … merujuk ke nomor pilihan yang BENAR</label><textarea class="inp" id="esDt" rows="3">' + esc(d.teks || 'Ibu kota Indonesia adalah [[1]].') + '</textarea></div><div class="xs b muted mt12">PILIHAN (nomor = urutan; sisa pilihan menjadi pengecoh)</div>' +
        d.pilihan.map(function (p, i) { return '<div class="row gap8 mt8" data-i="' + i + '"><span class="bdg navy">' + (i + 1) + '</span><input class="inp grow" data-f="v" value="' + esc(p) + '"><button class="btn-ic" data-del>' + ic('x') + '</button></div>'; }).join('') + '<button class="btn btn-ghost btn-sm mt8" data-add>' + ic('plus') + 'Pilihan</button>'; }
  }
  function sinkron() {
    var t = tipe(), w = $('#esData', m.el);
    if (t === 'pg' || t === 'pgk') d.opsi = $$('[data-i]', w).map(function (r, i) { return { id: (d.opsi[i] && d.opsi[i].id) || 'o' + (i + 1), teks: $('[data-f=teks]', r).value, benar: $('[data-f=benar]', r).checked, umpan: $('[data-f=umpan]', r).value }; });
    if (t === 'cocok') { d.pasangan = $$('[data-i]', w).map(function (r) { return { kiri: $('[data-f=kiri]', r).value, kanan: $('[data-f=kanan]', r).value }; }); var pg = $('#esPg', w); if (pg) d.pengecoh = pg.value.split('\n').map(function (s) { return s.trim(); }).filter(String); }
    if (t === 'singkat') { d.jawaban = $$('[data-i]', w).map(function (r) { return { teks: $('[data-f=teks]', r).value, nilai: Number($('[data-f=nilai]', r).value) }; }); if ($('#esHb', w)) { d.huruf_besar = $('#esHb', w).checked; d.toleransi = Number($('#esTol', w).value); } }
    if (t === 'esai' && $('#esPd', w)) { d.panduan = $('#esPd', w).value; d.min_kata = Number($('#esMk', w).value); }
    if (t === 'dragdrop') { d.pilihan = $$('[data-i]', w).map(function (r) { return $('[data-f=v]', r).value; }); if ($('#esDt', w)) d.teks = $('#esDt', w).value; }
    if (t === 'bs') { var c = $('[name=esBs]:checked', w); d.benar = !c || c.value === '1'; }
  }
  $('#esT', m.el).onchange = function () { d = {}; draw(); };
  $('#esData', m.el).addEventListener('click', function (e) {
    var t = tipe();
    if (e.target.closest('[data-add]')) { sinkron(); if (t === 'pg' || t === 'pgk') d.opsi.push({ teks: '', benar: false }); else if (t === 'cocok') d.pasangan.push({ kiri: '', kanan: '' }); else if (t === 'singkat') d.jawaban.push({ teks: '', nilai: 100 }); else if (t === 'dragdrop') d.pilihan.push(''); draw(); }
    var del = e.target.closest('[data-del]'); if (del) { sinkron(); var i = Number(del.closest('[data-i]').dataset.i); (t === 'pg' || t === 'pgk' ? d.opsi : t === 'cocok' ? d.pasangan : t === 'singkat' ? d.jawaban : d.pilihan).splice(i, 1); draw(); }
  });
  draw();
  $('#esSave', m.el).onclick = async function () {
    sinkron();
    btnBusy(this, true);
    var r = await api('soal.save', { soal: { soal_id: q.soal_id || '', tipe: tipe(), teks: $('#esTeks', m.el).value, kategori: $('#esK', m.el).value, skor: Number($('#esS', m.el).value), umpan_balik: $('#esU', m.el).value, kursus_id: q.kursus_id || kid || '', data: d } });
    btnBusy(this, false);
    if (toastRes(r)) { m.close(); selesai && selesai(); }
  };
}
/** Impor format Aiken sederhana: pertanyaan, A. … D., ANSWER: B (atau ANSWER: BENAR/SALAH untuk benar-salah) */
function parseAiken(teks, kategori) {
  var blok = String(teks || '').replace(/\r/g, '').split(/\n\s*\n/), out = [], gagal = 0;
  blok.forEach(function (b) {
    var lines = b.split('\n').map(function (l) { return l.trim(); }).filter(String); if (!lines.length) return;
    var ans = lines.filter(function (l) { return /^(ANSWER|JAWABAN|KUNCI)\s*:/i.test(l); })[0]; if (!ans) { gagal++; return; }
    var kunci = ans.split(':')[1].trim().toUpperCase(), opsi = [], tanya = [];
    lines.forEach(function (l) { var m = l.match(/^([A-J])[.)]\s+(.*)$/); if (m) opsi.push({ id: 'o' + (opsi.length + 1), huruf: m[1].toUpperCase(), teks: m[2] }); else if (l !== ans) tanya.push(l); });
    if (!opsi.length && /^(BENAR|SALAH|B|S|TRUE|FALSE)$/.test(kunci)) { out.push({ tipe: 'bs', teks: tanya.join('\n'), kategori: kategori, skor: 1, data: { benar: /^(BENAR|B|TRUE)$/.test(kunci) } }); return; }
    var kun = kunci.split(/[,\s]+/).filter(String);
    if (opsi.length < 2 || !kun.length) { gagal++; return; }
    opsi.forEach(function (o) { o.benar = kun.indexOf(o.huruf) > -1; delete o.huruf; });
    out.push({ tipe: kun.length > 1 ? 'pgk' : 'pg', teks: tanya.join('\n'), kategori: kategori, skor: 1, data: { opsi: opsi } });
  });
  return { soal: out, gagal: gagal };
}
function imporSoal(kid, selesai) {
  var contoh = 'Organ yang memompa darah ke seluruh tubuh adalah…\nA. Paru-paru\nB. Jantung\nC. Hati\nD. Ginjal\nANSWER: B\n\nVena membawa darah menuju jantung.\nANSWER: BENAR';
  var m = modal({ title: 'Impor Soal dari Teks', sub: 'Format Aiken: satu soal per blok, pisahkan dengan baris kosong.', size: 'lg', body: '<div class="field"><label>Kategori untuk semua soal</label><input class="inp" id="ipK" placeholder="mis. Bab 3"></div><div class="field mt12"><label>Teks soal</label><textarea class="inp mono" id="ipT" rows="12" placeholder="' + esc(contoh) + '"></textarea></div><div id="ipInfo" class="small mt8"></div>',
    foot: '<button class="btn btn-outline" data-x>Batal</button><button class="btn btn-ghost" id="ipCek">' + ic('scan-search') + 'Periksa</button><button class="btn btn-primary" id="ipGo">' + ic('file-up') + 'Impor</button>' });
  function cek() { var p = parseAiken($('#ipT', m.el).value, $('#ipK', m.el).value); $('#ipInfo', m.el).innerHTML = '<b>' + p.soal.length + '</b> soal terbaca (' + p.soal.filter(function (s) { return s.tipe === 'pg'; }).length + ' PG, ' + p.soal.filter(function (s) { return s.tipe === 'pgk'; }).length + ' PG kompleks, ' + p.soal.filter(function (s) { return s.tipe === 'bs'; }).length + ' benar-salah)' + (p.gagal ? ' • <span class="bad-t">' + p.gagal + ' blok tidak dikenali</span>' : ''); return p; }
  $('#ipCek', m.el).onclick = cek;
  $('#ipGo', m.el).onclick = async function () { var p = cek(); if (!p.soal.length) return toast('Tidak ada soal yang terbaca.', 'warn'); p.soal.forEach(function (s) { s.kursus_id = kid || ''; }); btnBusy(this, true); var r = await api('soal.save', { soal: p.soal }); btnBusy(this, false); if (toastRes(r)) { m.close(); selesai && selesai(); } };
}

// =====================================================================
// RUBRIK & PANDUAN PENILAIAN
// =====================================================================
registerPage('guru', 'rubrik', {
  title: 'Rubrik Penilaian',
  render: function (el) {
    var self = this;
    el.innerHTML = pageHead('E-Learning <span>/ Rubrik</span>', 'Rubrik & Panduan Penilaian', 'Penilaian transparan dan konsisten untuk tugas esai atau proyek. Siswa melihat rubrik sebelum mengumpulkan.', '<button class="btn btn-dark" id="rbBaru">' + ic('plus') + 'Rubrik baru</button>') + '<div id="rbList" class="grid g2"><div class="sk" style="height:200px"></div></div>';
    $('#rbBaru', el).onclick = function () { editorRubrik(null, function () { self.render(el); }); };
    apiLR('rubrik.list', {}, function (r) {
      if (!r.success) { $('#rbList', el).innerHTML = errorBox(r.message); return; }
      var list = r.data.rubrik;
      $('#rbList', el).innerHTML = list.length ? list.map(function (x) { return '<div class="card card-p"><div class="row"><h3 class="grow">' + esc(x.nama) + '</h3><span class="bdg ' + (x.jenis === 'panduan' ? 'info' : 'navy') + '">' + (x.jenis === 'panduan' ? 'Panduan' : 'Rubrik') + '</span></div><div class="xs muted mt4">' + x.kriteria.length + ' kriteria • dipakai ' + x.dipakai + ' tugas • oleh ' + esc(x.pemilik) + '</div><div class="mt12 rb-mini">' + rubrikTabel(x, {}, false) + '</div><div class="row gap8 mt12">' + (x.milikSaya ? '<button class="btn btn-outline btn-sm" data-ed="' + esc(x.rubrik_id) + '">' + ic('pencil') + 'Ubah</button>' : '') + '<button class="btn btn-ghost btn-sm" data-dup="' + esc(x.rubrik_id) + '">' + ic('copy') + 'Duplikat</button>' + (x.milikSaya ? '<button class="btn btn-ghost btn-sm" data-del="' + esc(x.rubrik_id) + '">' + ic('trash-2') + 'Hapus</button>' : '') + '</div></div>'; }).join('') : '<div class="card card-p" style="grid-column:1/-1">' + emptyHtml('Belum ada rubrik', 'Buat rubrik lalu pilih di pengaturan tugas.', 'grid-3x3') + '</div>';
      $('#rbList', el).onclick = async function (e) {
        var b = e.target.closest('button'); if (!b) return;
        var x = list.filter(function (y) { return y.rubrik_id === (b.dataset.ed || b.dataset.dup || b.dataset.del); })[0];
        if (b.dataset.ed) editorRubrik(x, function () { self.render(el); });
        if (b.dataset.dup) { var s = JSON.parse(JSON.stringify(x)); delete s.rubrik_id; s.nama += ' (salinan)'; editorRubrik(s, function () { self.render(el); }); }
        if (b.dataset.del) { if (!await confirmBox('Hapus rubrik "' + x.nama + '"?', { danger: true })) return; var r2 = await api('rubrik.hapus', { rubrik_id: x.rubrik_id }); if (toastRes(r2)) self.render(el); }
      };
    });
  }
});
function editorRubrik(x, selesai) {
  x = x ? JSON.parse(JSON.stringify(x)) : { nama: '', jenis: 'rubrik', kriteria: [{ nama: 'Ketepatan isi', level: [{ deskripsi: 'Kurang', skor: 1 }, { deskripsi: 'Cukup', skor: 2 }, { deskripsi: 'Baik', skor: 3 }, { deskripsi: 'Sangat baik', skor: 4 }] }] };
  var m = modal({ title: x.rubrik_id ? 'Ubah Rubrik' : 'Rubrik Baru', size: 'xl', body: '<div class="grid-form"><div class="field c8"><label>Nama</label><input class="inp" id="erN" value="' + esc(x.nama) + '"></div><div class="field c4"><label>Jenis</label><select class="sel" id="erJ">' + selOpts([['rubrik', 'Rubrik (tingkat per kriteria)'], ['panduan', 'Panduan penilaian (skor maks per kriteria)']], x.jenis) + '</select></div></div><div id="erK" class="mt12"></div><button class="btn btn-ghost btn-sm mt8" id="erAdd">' + ic('plus') + 'Kriteria</button>',
    foot: '<button class="btn btn-outline" data-x>Batal</button><button class="btn btn-primary" id="erSave">' + ic('save') + 'Simpan</button>' });
  function draw() {
    var j = $('#erJ', m.el).value;
    $('#erK', m.el).innerHTML = x.kriteria.map(function (k, i) {
      return '<div class="card card-p mt8 rb-ed" data-i="' + i + '"><div class="row gap8"><input class="inp grow" data-f="nama" value="' + esc(k.nama) + '" placeholder="Nama kriteria">' + (j === 'panduan' ? '<input class="inp" type="number" data-f="maks" value="' + esc(k.maks || 10) + '" style="width:90px" title="Skor maksimal">' : '') + '<button class="btn-ic" data-delk>' + ic('trash-2') + '</button></div>' +
        (j === 'panduan' ? '<input class="inp mt8" data-f="deskripsi" value="' + esc(k.deskripsi || '') + '" placeholder="Deskripsi kriteria">' : '<div class="rb-lv mt8">' + (k.level || []).map(function (l, x2) { return '<div class="rb-lvi" data-l="' + x2 + '"><input class="inp" type="number" data-lf="skor" value="' + esc(l.skor) + '" title="Skor"><textarea class="inp" data-lf="deskripsi" rows="2" placeholder="Deskripsi tingkat">' + esc(l.deskripsi) + '</textarea><button class="btn-ic" data-dell>' + ic('x') + '</button></div>'; }).join('') + '<button class="btn btn-ghost btn-xs" data-addl>' + ic('plus') + 'Tingkat</button></div>') + '</div>';
    }).join('');
  }
  function sinkron() { var j = $('#erJ', m.el).value; $$('.rb-ed', m.el).forEach(function (r) { var k = x.kriteria[Number(r.dataset.i)]; k.nama = $('[data-f=nama]', r).value; if (j === 'panduan') { k.maks = Number(($('[data-f=maks]', r) || {}).value || 10); k.deskripsi = ($('[data-f=deskripsi]', r) || {}).value || ''; } else k.level = $$('[data-l]', r).map(function (l) { return { skor: Number($('[data-lf=skor]', l).value), deskripsi: $('[data-lf=deskripsi]', l).value }; }); }); }
  $('#erJ', m.el).onchange = function () { sinkron(); x.kriteria.forEach(function (k) { if (this.value === 'rubrik' && !k.level) k.level = [{ deskripsi: 'Kurang', skor: 1 }, { deskripsi: 'Baik', skor: 3 }]; }, this); draw(); };
  m.el.addEventListener('click', function (e) {
    if (e.target.closest('#erAdd')) { sinkron(); x.kriteria.push({ nama: '', maks: 10, level: [{ deskripsi: '', skor: 1 }, { deskripsi: '', skor: 2 }, { deskripsi: '', skor: 3 }, { deskripsi: '', skor: 4 }] }); draw(); }
    var r = e.target.closest('.rb-ed'); if (!r) return; var k = x.kriteria[Number(r.dataset.i)];
    if (e.target.closest('[data-delk]')) { sinkron(); x.kriteria.splice(Number(r.dataset.i), 1); draw(); }
    if (e.target.closest('[data-addl]')) { sinkron(); k.level.push({ deskripsi: '', skor: (k.level.length + 1) }); draw(); }
    if (e.target.closest('[data-dell]')) { sinkron(); k.level.splice(Number(e.target.closest('[data-l]').dataset.l), 1); draw(); }
  });
  draw();
  $('#erSave', m.el).onclick = async function () { sinkron(); btnBusy(this, true); var r = await api('rubrik.save', { rubrik_id: x.rubrik_id || '', nama: $('#erN', m.el).value, jenis: $('#erJ', m.el).value, kriteria: x.kriteria }); btnBusy(this, false); if (toastRes(r)) { m.close(); LmsOpsi = {}; selesai && selesai(); } };
}
