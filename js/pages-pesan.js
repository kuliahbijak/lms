/* =====================================================================
   SIAKAD SISWA v3.0 — pages-pesan.js : Pesan Instan Privat
   Daftar percakapan + ruang obrolan, polling hemat adaptif, kirim dengan Enter,
   hapus pesan sendiri, blokir, cari kontak. Isi pesan dienkripsi di server.
   ===================================================================== */
'use strict';

daftarHalaman(['guru', 'siswa'], 'pesan', function () { return {
  title: 'Pesan', alwaysRender: false, _keepScroll: false,
  render: function (el, param) {
    var self = this;
    self.st = { v: '', pid: '', dengan: '', pesan: [], lawan: null, sibuk: false };
    el.innerHTML = pageHead('Komunikasi <span>/ Pesan</span>', 'Pesan', 'Obrolan privat guru & siswa. Isi pesan disimpan terenkripsi.') +
      '<div class="chat-wrap card" id="chW"><aside class="chat-list"><div class="chat-cari"><div class="inp-ic grow">' + ic('search') + '<input class="inp" id="chCari" placeholder="Cari percakapan…"></div><button class="btn btn-primary btn-sm" id="chBaru" title="Pesan baru">' + ic('square-pen') + '</button></div><div id="chDaftar" class="chat-items"><div class="sk" style="height:200px;margin:12px"></div></div></aside>' +
      '<section class="chat-main" id="chMain"><div class="chat-kosong">' + ic('messages-square') + '<b>Pilih percakapan</b><div class="small muted">atau mulai pesan baru</div></div></section></div>';
    $('#chBaru', el).onclick = function () { self.kontak(el); };
    $('#chCari', el).oninput = function () { self.gambarDaftar(el); };
    self.muatDaftar(el).then(function () { if (param) self.buka(el, { dengan: param }); });
    if (!self._ev) { self._ev = true; window.addEventListener('pesan-baru', function (e) { if (currentRoute().name === 'pesan' && self.st) { self.daftar = e.detail.percakapan || self.daftar; self.gambarDaftar(el); } }); }
    if (!self._poll) self._poll = setInterval(function () { if (currentRoute().name === 'pesan' && !document.hidden && Activity.due('pesanAktif', 4000, 20000)) self.poll(el); }, 2000);
  },
  show: function (el, param) { if (param && this.st && param !== this.st.dengan && $('#chMain', el)) this.buka(el, { dengan: param }); },
  muatDaftar: function (el) {
    var self = this;
    return api('pesan.daftar', {}).then(function (r) {
      if (!r.success) { $('#chDaftar', el).innerHTML = errorBox(r.message); return; }
      self.daftar = r.data.percakapan; self.st.v = r.data.v; ChatBadge.set(r.data.belum); self.gambarDaftar(el);
    });
  },
  gambarDaftar: function (el) {
    var self = this, q = ($('#chCari', el) || {}).value || '', list = (this.daftar || []).filter(function (p) { return !q || p.lawan.nama.toLowerCase().indexOf(q.toLowerCase()) > -1; });
    $('#chDaftar', el).innerHTML = list.length ? list.map(function (p) {
      return '<a href="#" class="chat-i' + (p.percakapan_id === self.st.pid ? ' on' : '') + (p.belum ? ' baru' : '') + '" data-pid="' + esc(p.percakapan_id) + '">' + avatar(p.lawan.nama, '', 'sm') + '<div class="grow"><div class="row"><b class="grow ellipsis">' + esc(p.lawan.nama) + '</b><span class="xs muted">' + esc(relTime(p.terakhir_pada)) + '</span></div><div class="row"><span class="xs muted ellipsis grow">' + (p.terakhir_dari === 'saya' ? 'Anda: ' : '') + esc(p.cuplikan) + '</span>' + (p.belum ? '<span class="dot-baru"></span>' : '') + '</div><span class="xs peran-' + esc(p.lawan.peran) + '">' + esc(peranLabel(p.lawan.peran)) + '</span></div></a>';
    }).join('') : '<div class="chat-kosong kecil">' + ic('inbox') + '<div class="small muted">Belum ada percakapan.</div></div>';
    $('#chDaftar', el).onclick = function (e) { var a = e.target.closest('[data-pid]'); if (a) { e.preventDefault(); self.buka(el, { percakapan_id: a.dataset.pid }); } };
  },
  buka: async function (el, p) {
    var self = this, main = $('#chMain', el);
    $('#chW', el).classList.add('buka');
    main.innerHTML = '<div class="sk" style="height:100%;min-height:300px;margin:12px"></div>';
    var r = await api('pesan.buka', p);
    if (!r.success) { main.innerHTML = errorBox(r.message); return; }
    var d = r.data;
    Object.assign(self.st, { pid: d.percakapan_id, dengan: d.lawan.uid, pesan: d.pesan, lawan: d.lawan, v: d.v });
    main.innerHTML = '<div class="chat-h"><button class="btn-ic chat-back" id="chBack" aria-label="Kembali">' + ic('arrow-left') + '</button>' + avatar(d.lawan.nama, '', 'sm') + '<div class="grow"><b>' + esc(d.lawan.nama) + '</b><div class="xs muted">' + esc(peranLabel(d.lawan.peran)) + ' • ' + ic('lock') + 'terenkripsi</div></div>' +
      (d.lawan.peran === 'siswa' ? '<button class="btn btn-ghost btn-sm" id="chBlok">' + ic(d.diblokir ? 'shield-check' : 'shield-off') + (d.diblokir ? 'Buka blokir' : 'Blokir') + '</button>' : '') + '</div>' +
      '<div class="chat-pesan" id="chPesan"></div>' + (d.bolehKirim ? '<div class="chat-tulis"><textarea class="inp" id="chIsi" rows="1" placeholder="' + (window.innerWidth < 768 ? 'Tulis pesan…' : 'Tulis pesan… (Enter kirim, Shift+Enter baris baru)') + '" maxlength="2000"></textarea><button class="btn btn-primary" id="chKirim" aria-label="Kirim">' + ic('send') + '</button></div>' : '<div class="chat-tulis"><div class="note warn grow">' + ic('ban') + '<div>' + esc(d.alasan) + '</div></div></div>');
    self.gambarPesan(el, true);
    self.gambarDaftar(el);
    if (d.percakapan_id) { (self.daftar || []).forEach(function (x) { if (x.percakapan_id === d.percakapan_id) x.belum = false; }); self.gambarDaftar(el); ChatBadge.set((self.daftar || []).filter(function (x) { return x.belum; }).length); }
    $('#chBack', el).onclick = function () { $('#chW', el).classList.remove('buka'); };
    if ($('#chBlok', el)) $('#chBlok', el).onclick = async function () { if (!d.diblokir && !await confirmBox('Blokir ' + d.lawan.nama + '? Ia tidak bisa mengirim pesan kepada Anda.')) return; var b = await api('pesan.blokir', { uid: d.lawan.uid, blokir: !d.diblokir }); if (toastRes(b)) self.buka(el, { dengan: d.lawan.uid }); };
    var ta = $('#chIsi', el);
    if (ta) {
      ta.oninput = function () { this.style.height = 'auto'; this.style.height = Math.min(140, this.scrollHeight) + 'px'; };
      ta.onkeydown = function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); self.kirim(el); } };
      $('#chKirim', el).onclick = function () { self.kirim(el); };
      if (window.innerWidth > 767) ta.focus();
    }
  },
  gambarPesan: function (el, gulir) {
    var box = $('#chPesan', el); if (!box) return;
    var tgl = '', html = this.st.pesan.map(function (m) {
      var t = String(m.waktu).slice(0, 10), sep = t !== tgl ? '<div class="chat-tgl"><span>' + esc(tglIndo(t)) + '</span></div>' : ''; tgl = t;
      return sep + '<div class="bubble ' + (m.dari === 'saya' ? 'saya' : 'lawan') + (m.dihapus ? ' dihapus' : '') + (m.sementara ? ' kirim' : '') + '" data-id="' + esc(m.pesan_id || '') + '"><div class="bb-isi">' + (m.dihapus ? '<i>' + ic('ban') + ' Pesan dihapus</i>' : esc(m.isi).replace(/\n/g, '<br>').replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>')) + '</div><div class="bb-meta">' + (m.sementara ? 'mengirim…' : esc(new Date(m.waktu).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }))) + (m.bolehHapus ? ' <button class="bb-hapus" data-hapus="' + esc(m.pesan_id) + '" title="Hapus">' + ic('trash-2') + '</button>' : '') + '</div></div>';
    }).join('');
    box.innerHTML = html || '<div class="chat-kosong kecil">' + ic('hand') + '<div class="small muted">Mulai percakapan dengan ' + esc(this.st.lawan ? this.st.lawan.nama : '') + '.</div></div>';
    var self = this;
    box.onclick = async function (e) { var b = e.target.closest('[data-hapus]'); if (!b) return; if (!await confirmBox('Hapus pesan ini untuk semua?', { danger: true })) return; var r = await api('pesan.hapus', { pesan_id: b.dataset.hapus }); if (toastRes(r)) self.st.pesan.forEach(function (m) { if (m.pesan_id === b.dataset.hapus) { m.dihapus = true; m.isi = ''; m.bolehHapus = false; } }), self.gambarPesan(el); };
    if (gulir !== false) box.scrollTop = box.scrollHeight;
  },
  kirim: async function (el) {
    var self = this, ta = $('#chIsi', el), isi = ta.value.trim(); if (!isi || self.st.sibuk) return;
    self.st.sibuk = true; ta.value = ''; ta.style.height = 'auto';
    var tmp = { dari: 'saya', isi: isi, waktu: new Date().toISOString(), sementara: true };
    self.st.pesan.push(tmp); self.gambarPesan(el);
    var r = await api('pesan.kirim', self.st.pid ? { percakapan_id: self.st.pid, isi: isi } : { ke: self.st.dengan, isi: isi });
    self.st.sibuk = false;
    var i = self.st.pesan.indexOf(tmp);
    if (!r.success) { self.st.pesan.splice(i, 1); self.gambarPesan(el); ta.value = isi; return toast(r.message, 'bad'); }
    self.st.pesan[i] = r.data.pesan; self.st.pid = r.data.percakapan_id; self.st.v = r.data.v;
    self.gambarPesan(el);
    self.muatDaftar(el);
  },
  poll: async function (el) {
    var self = this; if (self._polling) return; self._polling = true;
    try {
      var akhir = self.st.pesan.filter(function (m) { return !m.sementara; }).slice(-1)[0];
      var r = await api('pesan.poll', { v: self.st.v, percakapan_id: self.st.pid, sejak: akhir ? akhir.waktu : '' });
      if (!r.success || r.data.sama) return;
      self.st.v = r.data.v; ChatBadge.v = ''; ChatBadge.set(r.data.belum);
      if (r.data.percakapan) { self.daftar = r.data.percakapan; self.gambarDaftar(el); }
      if (r.data.baru && r.data.baru.length) {
        var ada = {}; self.st.pesan.forEach(function (m) { if (m.pesan_id) ada[m.pesan_id] = m; });
        var tambah = r.data.baru.filter(function (m) { if (ada[m.pesan_id]) { Object.assign(ada[m.pesan_id], m); return false; } return true; });
        var box = $('#chPesan', el), bawah = box && box.scrollHeight - box.scrollTop - box.clientHeight < 80;
        self.st.pesan = self.st.pesan.concat(tambah);
        self.gambarPesan(el, bawah);
      }
    } finally { self._polling = false; }
  },
  kontak: function (el) {
    var self = this;
    var m = modal({ title: 'Pesan Baru', sub: isSiswa() ? 'Kirim ke guru atau teman sekelas' : 'Kirim ke guru atau siswa', size: 'md', body: '<div class="inp-ic">' + ic('search') + '<input class="inp" id="ktCari" placeholder="Cari nama atau email…"></div><div id="ktList" class="kontak-list mt12"><div class="sk" style="height:160px"></div></div>' });
    function muat() { api('pesan.kontak', { cari: $('#ktCari', m.el).value }).then(function (r) { if (!r.success) return; $('#ktList', m.el).innerHTML = r.data.kontak.map(function (k) { return '<a href="#" class="list-i" data-uid="' + esc(k.uid) + '">' + avatar(k.nama, '', 'sm') + '<div class="grow"><b>' + esc(k.nama) + '</b><div class="xs muted">' + esc(peranLabel(k.peran)) + (k.kelas ? ' • ' + esc(k.kelas) : '') + '</div></div>' + ic('chevron-right') + '</a>'; }).join('') || emptyHtml('Tidak ditemukan', '', 'user-x') + (r.data.total > r.data.kontak.length ? '<div class="xs muted tc mt8">Ketik nama untuk mempersempit (' + r.data.total + ' kontak).</div>' : ''); }); }
    $('#ktCari', m.el).oninput = debounce(muat, 300); muat();
    $('#ktList', m.el).onclick = function (e) { var a = e.target.closest('[data-uid]'); if (a) { e.preventDefault(); m.close(); self.buka(el, { dengan: a.dataset.uid }); } };
  }
}; });
