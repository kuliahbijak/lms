/* MODE DEMO: salinan backend Apps Script (backend/*.gs) yang dijalankan di browser. Dibuat otomatis oleh tools/build.js. */
// ==== Kode.gs ====
/**
 * =====================================================================
 *  SIAKAD SISWA v3.1 — Backend REST API (Google Apps Script)
 *  File 1/13: Kode.gs — konfigurasi, pintu rahasia, router & peran,
 *             auth, database, cache berversi, antrean, warmup, setup
 *
 *  Arsitektur : GAS sebagai pure REST API (ContentService JSON).
 *               Frontend statis (GitHub Pages) memanggil via fetch().
 *  Performa   : gas-instant-ux-pro + gas-scale-turbo (cache admin berversi,
 *               antrean notifikasi keluar dari jalur respons, warmup 3 lapis).
 *  Keamanan   : gas-rahasia-script-properties — SEMUA rahasia (secret sesi,
 *               hash + salt kata sandi, token Fonnte, QR secret) hanya di
 *               Script Properties. Tidak ada di kode, Sheets, log, atau browser.
 *  File lain  : Akademik.gs, Admin.gs, Tagihan.gs, Migrasi.gs, Notifikasi.gs, CRM.gs
 *  v3.0 (LMS) : Lms.gs, LmsAktivitas.gs, LmsNilai.gs, Pesan.gs, Keamanan.gs, Branding.gs
 *               — modul tambahan menempel lewat titik sambung EXT (bagian 1b).
 * =====================================================================
 */

// ---------------------------------------------------------------------
// 1. KONFIGURASI (tanpa satu pun literal rahasia)
// ---------------------------------------------------------------------
var APP = {
  NAME: 'SIAKAD SISWA',
  VERSION: '3.1.0',
  TZ: 'Asia/Jakarta',
  SCHEMA_VERSION: 3,
  TOKEN_TTL_MS: 8 * 3600 * 1000,          // PRD US-01: sesi 8 jam
  REMEMBER_TTL_MS: 7 * 24 * 3600 * 1000,  // "Ingat saya" = 7 hari
  SA_TTL_MS: 8 * 3600 * 1000,             // superadmin tidak pernah 7 hari
  SLOW_MS: 3000,
  HASH_ITER: 300                          // iterasi HMAC untuk sandi pilihan pengguna
};
var ROLES = { superadmin: 'Super Admin', guru: 'Guru', siswa: 'Siswa' };

// ---------------------------------------------------------------------
// 1a. PINTU TUNGGAL SCRIPT PROPERTIES (R2) — dibaca per kunci + memo per eksekusi.
//     (Per kunci, bukan getProperties(), karena hash sandi PW_* ikut tersimpan
//      di sini; memuat semuanya tiap request akan memperlambat.)
// ---------------------------------------------------------------------
var PROPS = PropertiesService.getScriptProperties();
var _PROP_MEMO = {};
function prop_(key, def) {
  var v = _PROP_MEMO.hasOwnProperty(key) ? _PROP_MEMO[key] : (_PROP_MEMO[key] = PROPS.getProperty(key));
  return v === undefined || v === null || v === '' ? (def === undefined ? '' : def) : v;
}
/** Baca langsung tanpa memo — untuk penghitung yang bisa diubah eksekusi lain (SEQ_, ANTRIAN_) */
function propFresh_(key, def) { var v = PROPS.getProperty(key); _PROP_MEMO[key] = v; return v === null || v === '' ? (def === undefined ? '' : def) : v; }
function setProp_(key, val) { PROPS.setProperty(key, String(val)); _PROP_MEMO[key] = String(val); }
function setProps_(obj) { if (!Object.keys(obj).length) return; PROPS.setProperties(obj); Object.keys(obj).forEach(function (k) { _PROP_MEMO[k] = String(obj[k]); }); }
function delProp_(key) { PROPS.deleteProperty(key); _PROP_MEMO[key] = null; }

/** ID environment dibaca dari Script Properties (diisi setupAppEnvironment) — Kelas B */
var CONFIG = {
  get SPREADSHEET_ID() { return prop_('SPREADSHEET_ID'); },
  get ROOT_FOLDER_ID() { return prop_('ROOT_FOLDER_ID'); },
  get MATERI_FOLDER()  { return prop_('MATERI_FOLDER'); },
  get SELFIE_FOLDER()  { return prop_('SELFIE_FOLDER'); },
  get ASET_FOLDER()    { return prop_('ASET_FOLDER'); },
  get EXPORTS_FOLDER() { return prop_('EXPORTS_FOLDER'); },
  get BUKTI_FOLDER()   { return prop_('BUKTI_FOLDER') || prop_('ASET_FOLDER'); }
};

/** Skema database. Semua kolom diformat teks '@' agar 0 di depan & tanggal tidak berubah.
 *  Users.password_hash & salt DIPERTAHANKAN demi kompatibilitas, tetapi SELALU KOSONG:
 *  hash disimpan di Script Properties (PW_<user_id>). */
var SCHEMA = {
  Config:        { key: 'key', cols: ['key', 'value', 'keterangan'] },
  Users:         { key: 'user_id', prefix: 'USR', cols: ['user_id', 'nama', 'email', 'password_hash', 'salt', 'role', 'ref_id', 'kelas_id', 'status_aktif', 'wajib_ganti_sandi', 'last_login', 'dibuat_pada', 'hak_akses', 'lokasi_ids', 'device_id', 'device_info', 'catatan'] },
  Siswa:         { key: 'NIS', cols: ['NIS', 'NISN', 'nama_lengkap', 'jenis_kelamin', 'kelas_id', 'jenjang', 'barcode_id', 'email', 'no_wa', 'nama_ortu', 'no_wa_ortu', 'tempat_lahir', 'tanggal_lahir', 'alamat', 'foto_profil_url', 'tahun_masuk', 'status', 'StatusWA', 'CekWAAt', 'dibuat_pada'] },
  Guru:          { key: 'NUPTK', cols: ['NUPTK', 'nama_lengkap', 'email', 'no_wa', 'mata_pelajaran', 'jabatan', 'foto_profil_url', 'status', 'StatusWA', 'CekWAAt', 'dibuat_pada'] },
  Kelas:         { key: 'kelas_id', prefix: 'KLS', cols: ['kelas_id', 'nama_kelas', 'jenjang', 'tingkat', 'wali_kelas_id', 'tahun_ajaran'] },
  Mapel:         { key: 'mapel_id', prefix: 'MPL', cols: ['mapel_id', 'nama', 'kode', 'kelompok', 'jenjang'] },
  Jadwal:        { key: 'jadwal_id', prefix: 'JDW', cols: ['jadwal_id', 'kelas_id', 'mata_pelajaran', 'guru_id', 'hari', 'jam_mulai', 'jam_selesai', 'ruang'] },
  Absensi:       { key: 'absensi_id', prefix: 'ABS', cols: ['absensi_id', 'NIS', 'kelas_id', 'tanggal', 'jam', 'status', 'metode', 'latitude', 'longitude', 'jarak_m', 'foto_selfie_id', 'keterangan', 'terlambat', 'dicatat_oleh', 'dibuat_pada', 'lokasi_id', 'device_id'] },
  Materi:        { key: 'materi_id', prefix: 'MTR', cols: ['materi_id', 'judul', 'deskripsi', 'mata_pelajaran', 'kelas_id', 'guru_id', 'tipe', 'url_konten', 'drive_file_id', 'ukuran', 'durasi', 'tanggal_upload', 'status'] },
  MateriAkses:   { key: 'akses_id', prefix: 'AKS', cols: ['akses_id', 'materi_id', 'NIS', 'waktu'] },
  Nilai:         { key: 'nilai_id', prefix: 'NIL', cols: ['nilai_id', 'NIS', 'kelas_id', 'mata_pelajaran', 'guru_id', 'semester', 'tahun_ajaran', 'nilai_harian', 'nilai_uts', 'nilai_uas', 'nilai_akhir', 'predikat', 'catatan', 'diperbarui_pada'] },
  Pengumuman:    { key: 'pengumuman_id', prefix: 'PNG', cols: ['pengumuman_id', 'judul', 'isi', 'kategori', 'tanggal', 'oleh', 'status'] },
  Logs:          { key: 'log_id', cols: ['log_id', 'timestamp', 'email', 'role', 'action', 'detail', 'target'] },
  // --- Modul Notifikasi & CRM (gas-notifikasi-wa-crm) ---
  AntrianNotif:  { key: 'AntrianID', prefix: 'ANT', cols: ['AntrianID', 'Kanal', 'Tujuan', 'NamaPenerima', 'Subjek', 'Pesan', 'Event', 'RefID', 'BlastID', 'Status', 'Percobaan', 'Respon', 'DibuatPada', 'DikirimPada'] },
  BlastWA:       { key: 'BlastID', prefix: 'BLW', cols: ['BlastID', 'Judul', 'Pesan', 'Sasaran', 'Total', 'Terkirim', 'Gagal', 'UkuranBatch', 'JedaDetik', 'Status', 'DibuatOleh', 'Tanggal', 'SelesaiPada'] },
  CRM_Kontak:    { key: 'KontakID', prefix: 'KTK', cols: ['KontakID', 'Nama', 'Email', 'NoWA', 'Segmen', 'Sumber', 'RefID', 'Tag', 'StatusWA', 'CekWAAt', 'EmailValid', 'OptOut', 'Catatan', 'JumlahPesan', 'TerakhirDihubungi', 'Info', 'DibuatPada', 'DiperbaruiPada'] },
  CRM_Interaksi: { key: 'InteraksiID', prefix: 'INT', cols: ['InteraksiID', 'KontakID', 'Kanal', 'Arah', 'Ringkasan', 'RefID', 'Oleh', 'Tanggal'] },
  // --- v2.1: Super Admin, geofencing, presensi guru, notifikasi in-app ---
  Lokasi:        { key: 'lokasi_id', prefix: 'LOK', cols: ['lokasi_id', 'nama', 'tipe', 'latitude', 'longitude', 'radius_m', 'alamat', 'berlaku', 'aktif', 'dibuat_oleh', 'diperbarui_pada'] },
  PresensiGuru:  { key: 'presensi_id', prefix: 'PRG', cols: ['presensi_id', 'user_id', 'NUPTK', 'nama', 'tanggal', 'jam_masuk', 'jam_pulang', 'status', 'lokasi_id', 'latitude', 'longitude', 'jarak_m', 'foto_id', 'terlambat', 'device_id', 'keterangan', 'diperbarui_pada'] },
  Notifikasi:    { key: 'notif_id', prefix: 'NTF', cols: ['notif_id', 'user_id', 'judul', 'pesan', 'tipe', 'link', 'dibaca', 'tanggal'] },
  // --- v2.1: Tagihan & Pembayaran (gas-tagihan-pembayaran) — subjek = Siswa (NIS) ---
  Biaya:         { key: 'biaya_id', prefix: 'BYA', cols: ['biaya_id', 'kode', 'nama', 'jenis', 'nominal', 'nominal_khusus', 'jatuh_tempo_tgl', 'jatuh_tempo', 'keterangan', 'aktif', 'dibuat_pada'] },
  Tagihan:       { key: 'TagihanID', prefix: 'TGH', cols: ['TagihanID', 'NIS', 'Jenis', 'BiayaKode', 'Periode', 'KodeTagihan', 'NamaTagihan', 'JumlahAsal', 'Potongan', 'Jumlah', 'AlasanPotongan', 'Status', 'TanggalTerbit', 'JatuhTempo', 'TanggalLunas', 'DiterbitkanOleh', 'Keterangan', 'kelas_id'] },
  Pembayaran:    { key: 'PembayaranID', prefix: 'PBY', cols: ['PembayaranID', 'TagihanID', 'NIS', 'Jumlah', 'Metode', 'NoReferensi', 'BuktiID', 'Status', 'TanggalBayar', 'VerifiedBy', 'VerifiedAt', 'Catatan', 'GrupBayar', 'NoKwitansi'] },
  PotonganTagihan: { key: 'PotonganID', prefix: 'POT', cols: ['PotonganID', 'NIS', 'Tipe', 'Nilai', 'Berlaku', 'Mulai', 'Sampai', 'Alasan', 'Aktif', 'DibuatOleh', 'DibuatPada'] },
  ReminderLog:   { key: 'ReminderID', prefix: 'RML', cols: ['ReminderID', 'Kunci', 'Jenis', 'NIS', 'TagihanID', 'Nama', 'Jumlah', 'JatuhTempo', 'Mode', 'Status', 'Oleh', 'Tanggal'] }
};

/** Kolom angka — dikembalikan sebagai Number saat dibaca */
var NUMERIC_COLS = { nilai_harian: 1, nilai_uts: 1, nilai_uas: 1, nilai_akhir: 1, jarak_m: 1, latitude: 1, longitude: 1, Percobaan: 1, Total: 1, Terkirim: 1, Gagal: 1, UkuranBatch: 1, JumlahPesan: 1, ukuran: 1,
  radius_m: 1, nominal: 1, JumlahAsal: 1, Potongan: 1, Jumlah: 1, Nilai: 1 };

/** Seed pengaturan (key, value, keterangan). Ditambah idempoten oleh setup/upgrade. TIDAK ADA rahasia di sini. */
var CONFIG_SEED = [
  ['NAMA_SEKOLAH', 'SMA Negeri Unggulan Indonesia', 'Nama sekolah'],
  ['ALAMAT_SEKOLAH', 'Jl. Pendidikan No. 1, Jakarta', 'Alamat sekolah'],
  ['LOGO_URL', '', 'URL logo sekolah (kosong = logo bawaan)'],
  ['LAT_SEKOLAH', '-6.2088', 'Latitude titik pusat sekolah (cadangan bila sheet Lokasi kosong)'],
  ['LNG_SEKOLAH', '106.8456', 'Longitude titik pusat sekolah (cadangan bila sheet Lokasi kosong)'],
  ['RADIUS_M', '100', 'Radius absensi bawaan (meter)'],
  ['GPS_WAJIB_SCAN', 'YA', 'YA/TIDAK — validasi GPS guru saat scan barcode'],
  ['GPS_TOLERANSI_M', '15', 'Toleransi akurasi GPS perangkat (meter) yang ditambahkan ke radius'],
  ['JAM_MASUK', '07:15', 'Batas jam masuk siswa (lewat = terlambat)'],
  ['JAM_PULANG', '14:30', 'Jam pulang siswa'],
  ['AUTO_ALPHA_JAM', '', 'Jam otomatis menandai Alpha (kosong = nonaktif), contoh 10:00'],
  ['TAHUN_AJARAN', '2026/2027', 'Tahun ajaran aktif'],
  ['SEMESTER', 'Ganjil', 'Semester aktif (Ganjil/Genap)'],
  ['SEMESTER_MULAI', '2026-07-13', 'Tanggal mulai semester (yyyy-MM-dd)'],
  ['SEMESTER_SELESAI', '2026-12-19', 'Tanggal akhir semester (yyyy-MM-dd)'],
  ['KKM', '70', 'Batas tuntas (PRD: Tuntas >= 70)'],
  ['BOBOT_HARIAN', '40', 'Bobot nilai harian (%)'],
  ['BOBOT_UTS', '30', 'Bobot nilai UTS (%)'],
  ['BOBOT_UAS', '30', 'Bobot nilai UAS (%)'],
  ['BATAS_KEHADIRAN', '75', 'Batas % kehadiran (di bawah = perlu perhatian)'],
  ['EMAIL_DOMAIN_SISWA', 'siswa.sch.id', 'Domain email otomatis akun siswa'],
  ['MATERI_MAKS_MB', '20', 'Batas ukuran upload materi (MB)'],
  // --- notifikasi (gas-notifikasi-wa-crm) ---
  ['NOTIF_WA_AKTIF', 'TIDAK', 'YA/TIDAK — saklar utama WhatsApp (Fonnte)'],
  ['NOTIF_EMAIL_AKTIF', 'TIDAK', 'YA/TIDAK — saklar utama Email'],
  ['NOTIF_MATRIKS', '', 'JSON matriks event x kanal (diatur dari menu)'],
  ['WA_BATCH_DEFAULT', '20', 'Ukuran batch blast (10/20/50)'],
  ['WA_JEDA_DETIK', '5', 'Jeda antarpesan, boleh acak "3-8"'],
  ['WA_DETEKSI_OTOMATIS', 'YA', 'Cek otomatis nomor kontak baru terdaftar WA'],
  ['EMAIL_NAMA_PENGIRIM', 'SIAKAD SISWA', 'Nama pengirim email'],
  ['APP_URL', '', 'URL app untuk {link} & QR kwitansi — terisi otomatis saat admin login'],
  ['CRM_SYNC_MENIT', '30', 'Interval sinkron otomatis CRM (menit)'],
  // --- v2.1: presensi guru & perangkat ---
  ['JAM_MASUK_GURU', '07:00', 'Batas jam masuk guru (lewat = terlambat)'],
  ['JAM_PULANG_GURU', '15:00', 'Jam pulang guru (presensi pulang dibuka mulai jam ini)'],
  ['KUNCI_PERANGKAT', 'TIDAK', 'YA/TIDAK — absensi hanya dari perangkat yang terdaftar per akun'],
  ['PRESENSI_GURU_SELFIE', 'TIDAK', 'YA/TIDAK — presensi guru wajib foto selfie'],
  // --- v2.1: tagihan & pembayaran ---
  ['JATUH_TEMPO_TANGGAL', '10', 'Tanggal jatuh tempo tagihan bulanan (1-28)'],
  ['REKENING_BANK', '', 'Rekening tujuan pembayaran, contoh: BSI 7123456789 a.n. Yayasan'],
  ['NAMA_BENDAHARA', 'Bendahara Sekolah', 'Nama penanda tangan kwitansi'],
  ['KWITANSI_PREFIX', 'KW', 'Awalan nomor kwitansi'],
  ['REMINDER_OTOMATIS', 'TIDAK', 'YA/TIDAK — pengingat jatuh tempo otomatis tiap hari'],
  ['REMINDER_JAM', '08:00', 'Jam pengingat otomatis dikirim'],
  ['REMINDER_H3', 'YA', 'YA/TIDAK — pengingat 3 hari sebelum jatuh tempo'],
  ['REMINDER_H0', 'YA', 'YA/TIDAK — pengingat pada hari jatuh tempo']
];

// ---------------------------------------------------------------------
// 1b. v3.0 — TITIK SAMBUNG MODUL TAMBAHAN (non-destruktif)
//     File baru (Lms.gs, Pesan.gs, Keamanan.gs, Branding.gs, …) mendaftarkan sheet,
//     pengaturan, rute, pekerja menit, dan kait (hook) lewat EXT — kode di atas
//     tidak perlu diubah. Urutan file di proyek bebas: penggabungan diulang tiap eksekusi.
// ---------------------------------------------------------------------
var EXT = (typeof EXT !== 'undefined' && EXT) || { schema: {}, seed: [], routes: [], tick: [], reset: [], hooks: {} };
function pasangEkstensi_() {
  Object.keys(EXT.schema).forEach(function (k) { if (!SCHEMA[k]) SCHEMA[k] = EXT.schema[k]; });
  if (EXT.seed.length) { var ada = {}; CONFIG_SEED.forEach(function (x) { ada[x[0]] = 1; }); EXT.seed.forEach(function (x) { if (!ada[x[0]]) { CONFIG_SEED.push(x); ada[x[0]] = 1; } }); }
  EXT.reset.forEach(function (f) { try { f(); } catch (e) {} });
}
/** Jalankan kait berurutan; berhenti & kembalikan hasil pertama yang tidak kosong (untuk gerbang) */
function extHook_(nama) { var a = Array.prototype.slice.call(arguments, 1), fns = EXT.hooks[nama] || [], out; for (var i = 0; i < fns.length; i++) { out = fns[i].apply(null, a); if (out) return out; } return null; }
/** Jalankan SEMUA kait (untuk menambah data); galat satu kait tidak menghentikan yang lain */
function extSemua_(nama) { var a = Array.prototype.slice.call(arguments, 1); (EXT.hooks[nama] || []).forEach(function (f) { try { f.apply(null, a); } catch (e) { console.error('kait ' + nama + ': ' + e.message); } }); }
pasangEkstensi_();

// ---------------------------------------------------------------------
// 2. ENTRY POINTS
// ---------------------------------------------------------------------
function doGet(e) {
  resetMemo_();
  var p = (e && e.parameter) || {};
  var res;
  try {
    if (p.w) res = ok_({ warm: warmCaches_(p.w === 'admin' ? 'admin' : 'pub') }, 'warm');      // warmup lapis 1 (dari browser)
    else if (p.action === 'config.public') res = apiConfigPublic({}, {});
    else res = ok_({ app: APP.NAME, version: APP.VERSION, time: nowIso_(), ready: !!CONFIG.SPREADSHEET_ID }, 'pong');
  } catch (err) { res = fail_(err.message); }
  res.v = APP.VERSION;
  return json_(res);
}

/** Reset memo per eksekusi (di GAS asli tiap request sudah bersih; penting untuk mode demo & uji) */
function resetMemo_() { _ROWS = {}; _SETTINGS = null; _ABS_IDX = null; _IN_LOCK = false; _PROP_MEMO = {}; _UIDX = null; _NQ = []; _IN_WEB = false; _LOK = null; _COLS_OK = {}; _REQ = null; pasangEkstensi_(); }
var _REQ = null;   // v3.0: metadata permintaan (parameter URL dari proxy IP bertanda tangan)

function doPost(e) {
  resetMemo_();
  _IN_WEB = true;
  var t0 = Date.now(), body = {}, res;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    _REQ = { p: (e && e.parameter) || {}, raw: (e && e.postData && e.postData.contents) || '' };
    res = dispatch_(body);
  } catch (err) {
    _NQ = [];
    res = fail_(err && err.message ? err.message : String(err));
  }
  res.ms = Date.now() - t0;
  res.v = APP.VERSION;
  if (res.ms > APP.SLOW_MS) { try { queueLog_(['', 'SYSTEM', 'SLOW', (body.action || '') + ' ' + res.ms + 'ms', '']); } catch (x) {} }
  _IN_WEB = false;
  return json_(res);
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
function ok_(data, message) { return { success: true, message: message || 'OK', data: data === undefined ? null : data }; }
function fail_(message, data) { return { success: false, message: message || 'Terjadi kesalahan.', data: data || null }; }

// ---------------------------------------------------------------------
// 3. ROUTER
//    auth : public | any | siswa | guru (guru + superadmin) | sa (superadmin)
//           keu (superadmin, atau guru ber-hak "keuangan") | bayar (siswa atau keu)
//           gurux (guru/superadmin yang terhubung ke data Guru — presensi)
//    write: pakai lock + idempotensi reqId
//    cache: hasil baca admin di-cache berversi ('adm') — gas-scale-turbo
// ---------------------------------------------------------------------
var _ROUTES = null;
function routes_() {
  if (_ROUTES) return _ROUTES;
  var R = {};
  function add(name, fn, auth, write, opt) { R[name] = { name: name, fn: fn, auth: auth, write: !!write, cache: !!(opt && opt.ttl), ttl: opt && opt.ttl, audit: !!(opt && opt.audit) }; }
  // --- publik ---
  add('ping', function () { return ok_({ time: nowIso_(), version: APP.VERSION }); }, 'public');
  add('config.public', apiConfigPublic, 'public');
  add('login', apiLogin, 'public');
  add('auth.forgot', apiForgot, 'public');
  add('auth.resetConfirm', apiResetConfirm, 'public', true);
  add('notif.drain', apiNotifDrain, 'public');
  add('kwitansi.verify', svcTgVerifyReceipt, 'public');
  // --- semua user login ---
  add('me.password', apiChangePassword, 'any', true);
  add('batch', apiBatch, 'any');
  add('materi.view', apiMateriView, 'any');
  add('notif.mine', apiNotifMine, 'any');
  add('notif.read', apiNotifRead, 'any', true);
  add('lokasi.saya', apiLokasiSaya, 'any');
  add('perangkat.daftar', apiPerangkatDaftar, 'any', true);
  // --- siswa ---
  add('siswa.bootstrap', apiSiswaBootstrap, 'siswa');
  add('absensi.self', apiAbsenSelf, 'siswa', true);
  add('billing.mine', svcTgMine, 'siswa');
  // --- guru & superadmin (akademik) ---
  add('guru.bootstrap', apiGuruBootstrap, 'guru');
  add('siswa.save', apiSiswaSave, 'guru', true);
  add('siswa.bulk', apiSiswaBulk, 'guru', true);
  add('master.save', apiMasterSave, 'guru', true);
  add('master.delete', apiMasterDelete, 'guru', true);
  add('config.get', apiConfigGet, 'guru');
  add('absensi.scan', apiAbsenScan, 'guru', true);
  add('absensi.manual', apiAbsenManual, 'guru', true);
  add('absensi.finalize', apiAbsenFinalize, 'guru', true);
  add('absensi.list', apiAbsenList, 'guru');
  add('absensi.foto', apiAbsenFoto, 'guru');
  add('materi.save', apiMateriSave, 'guru', true);
  add('materi.delete', apiMateriDelete, 'guru', true);
  add('nilai.list', apiNilaiList, 'guru');
  add('nilai.saveBatch', apiNilaiSaveBatch, 'guru', true);
  add('laporan.export', apiLaporanExport, 'guru', true);
  // --- presensi guru (geofencing) ---
  add('presensi.guru', apiPresensiGuru, 'gurux', true);
  add('presensi.saya', apiPresensiSaya, 'gurux');
  // --- SUPER ADMIN ---
  add('config.save', apiConfigSave, 'sa', true);
  add('guru.save', apiGuruSave, 'sa', true);
  add('guru.delete', apiGuruDelete, 'sa', true);
  add('siswa.delete', apiSiswaDelete, 'sa', true);
  add('siswa.resetPassword', apiSiswaResetPassword, 'sa', true);
  add('logs.list', apiLogsList, 'sa', false, { ttl: 60 });
  add('demo.clear', apiDemoClear, 'sa', true);
  add('sa.monitor', apiSaMonitor, 'sa', false, { ttl: 60 });
  add('sa.akun.list', apiSaAkunList, 'sa', false, { ttl: 300 });
  add('sa.akun.save', apiSaAkunSave, 'sa', true);
  add('sa.akun.create', apiSaAkunCreate, 'sa', true);
  add('sa.akun.reset', apiSaAkunReset, 'sa', true);
  add('sa.akun.logout', apiSaAkunLogout, 'sa', true);
  add('sa.akun.device', apiSaAkunDevice, 'sa', true);
  add('sa.akun.delete', apiSaAkunDelete, 'sa', true);
  add('sa.akun.bulk', apiSaAkunBulk, 'sa', true);
  add('lokasi.list', apiLokasiList, 'sa', false, { ttl: 600 });
  add('lokasi.save', apiLokasiSave, 'sa', true);
  add('lokasi.delete', apiLokasiDelete, 'sa', true);
  add('presensi.list', apiPresensiList, 'sa', false, { ttl: 120 });
  add('rahasia.status', apiRahasiaStatus, 'sa');
  add('rahasia.simpan', apiRahasiaSimpan, 'sa', true);
  add('rahasia.rotasiSesi', apiRahasiaRotasiSesi, 'sa', true);
  // --- migrasi (gas-migrasi-database) — superadmin ---
  add('migrasi.scan', apiMigrasiScan, 'sa');
  add('migrasi.run', apiMigrasiRun, 'sa', true);
  add('migrasi.csv', apiMigrasiCsv, 'sa', true);
  // --- notifikasi & CRM (gas-notifikasi-wa-crm) — superadmin ---
  add('notif.config', svcNotifConfig, 'sa');
  add('notif.configSave', svcNotifConfigSave, 'sa', true);
  add('notif.queue', svcNotifQueue, 'sa');
  add('notif.processNow', svcNotifProcessNow, 'sa');
  add('notif.retry', svcNotifRetry, 'sa', true);
  add('wa.device', svcWaDevice, 'sa');
  add('wa.test', svcWaTest, 'sa');
  add('email.test', svcEmailTest, 'sa');
  add('wa.validate', svcWaValidate, 'sa');
  add('wa.audience', svcWaAudience, 'sa');
  add('wa.blastCreate', svcWaBlastCreate, 'sa', true);
  add('wa.blastList', svcWaBlastList, 'sa', false, { ttl: 20 });
  add('wa.blastProcess', svcWaBlastProcess, 'sa');
  add('wa.blastStop', svcWaBlastStop, 'sa', true);
  add('crm.list', svcCrmList, 'sa');
  add('crm.stats', svcCrmStats, 'sa', false, { ttl: 600 });
  add('crm.detail', svcCrmDetail, 'sa');
  add('crm.sync', svcCrmSync, 'sa', true);
  add('crm.save', svcCrmSave, 'sa', true);
  add('crm.bulk', svcCrmBulk, 'sa', true);
  add('crm.interaksi', svcCrmInteraksi, 'sa', true);
  add('crm.import', svcCrmImport, 'sa', true);
  add('crm.merge', svcCrmMerge, 'sa', true);
  add('crm.export', svcCrmExport, 'sa');
  // --- tagihan & pembayaran (gas-tagihan-pembayaran) ---
  add('billing.submitProof', svcTgSubmit, 'bayar', true);
  add('billing.receipt', svcTgReceipt, 'bayar');
  add('billing.bukti', svcTgBukti, 'bayar');
  add('billing.list', svcTgList, 'keu', false, { ttl: 600 });
  add('billing.pending', svcTgPending, 'keu', false, { ttl: 300 });
  add('billing.eligible', svcTgEligible, 'keu');
  add('billing.genBatch', function (ctx, d) { return svcTgTerbit(ctx, d, true); }, 'keu', true);
  add('billing.genForSelected', function (ctx, d) { return svcTgTerbit(ctx, d, false); }, 'keu', true);
  add('billing.verifyPayment', svcTgVerify, 'keu', true);
  add('billing.cancel', svcTgCancel, 'keu', true);
  add('billing.ubahNominal', svcTgUbahNominal, 'keu', true);
  add('billing.history', svcTgHistory, 'keu');
  add('billing.settingsGet', svcTgSettingsGet, 'keu');
  add('billing.settings', svcTgSettingsSave, 'keu', true);
  add('biaya.list', svcTgBiayaList, 'keu', false, { ttl: 600 });
  add('biaya.save', svcTgBiayaSave, 'keu', true);
  add('biaya.delete', svcTgBiayaDelete, 'keu', true);
  add('discount.list', svcTgDiscountList, 'keu', false, { ttl: 600 });
  add('discount.save', svcTgDiscountSave, 'keu', true);
  add('discount.delete', svcTgDiscountDelete, 'keu', true);
  add('reminder.preview', svcTgReminderPreview, 'keu');
  add('reminder.run', svcTgReminderRun, 'keu', true);
  // --- v3.0: rute modul tambahan (LMS, pesan, keamanan, branding) ---
  EXT.routes.forEach(function (f) { f(add); });
  return (_ROUTES = R);
}

/** Aksi yang diaudit ke Logs (lewat antrean). Payload selalu lewat redaksi_(). */
var AUDIT_ACTIONS = /^(siswa\.(save|delete|resetPassword|bulk)|guru\.(save|delete)|master\.(save|delete)|config\.save|materi\.(save|delete)|nilai\.saveBatch|absensi\.(manual|finalize)|migrasi\.(run|csv)|notif\.configSave|wa\.(blastCreate|blastStop)|crm\.(bulk|merge|import|export)|laporan\.export|demo\.clear|sa\.akun\.\w+|lokasi\.(save|delete)|rahasia\.(simpan|rotasiSesi)|billing\.(genBatch|genForSelected|verifyPayment|cancel|ubahNominal|settings)|biaya\.(save|delete)|discount\.(save|delete)|reminder\.run)$/;

function punyaHak_(ctx, hak) { return !!(ctx.user && ('|' + String(ctx.user.h || '').toLowerCase().replace(/\s*,\s*/g, '|') + '|').indexOf('|' + hak + '|') > -1); }
function isSA_(ctx) { return !!(ctx.session && ctx.session.role === 'superadmin'); }
function isKeu_(ctx) { return isSA_(ctx) || !!(ctx.session && ctx.session.role === 'guru' && punyaHak_(ctx, 'keuangan')); }

function authorized_(route, ctx) {
  if (route.auth === 'public') return true;
  if (!ctx.session) return false;
  var role = ctx.session.role;
  switch (route.auth) {
    case 'any': return true;
    case 'siswa': return role === 'siswa';
    case 'guru': case 'gurux': return role === 'guru' || role === 'superadmin';
    case 'sa': return role === 'superadmin';
    case 'keu': return isKeu_(ctx);
    case 'bayar': return role === 'siswa' || isKeu_(ctx);
  }
  return false;
}

var _IN_WEB = false, _NQ = [];
function dispatch_(body) {
  var r = routes_()[body.action];
  if (!r) return fail_('Aksi tidak dikenal: ' + body.action);
  if (r.auth !== 'public' && !CONFIG.SPREADSHEET_ID) return fail_('Server belum di-setup. Jalankan setupAppEnvironment() di editor Apps Script.');
  var ctx = { session: null, user: null, reqId: String(body.reqId || ''), after: [], action: body.action, dev: String(body.dev || '').substring(0, 64) };
  if (r.auth !== 'public') {
    ctx.session = verifyToken_(body.token);
    if (ctx.session) {                                    // token sah TETAP dicek: akun aktif & peran sama (R8)
      var u = userIdx_()[ctx.session.uid];
      if (!u || !u.a || u.r !== ctx.session.role) ctx.session = null;
      else { ctx.user = u; markSeen_(ctx); }
    }
  }
  var gerbang = extHook_('gerbang', ctx, r, body);         // v3.0: batas IP, anti-spam, sesi idle
  if (gerbang) return gerbang;
  if (!authorized_(r, ctx)) return fail_(ctx.session ? 'Akses ditolak untuk peran Anda.' : 'Sesi berakhir, silakan login ulang.', { code: ctx.session ? 'FORBIDDEN' : 'AUTH' });
  var data = body.data || {};
  var res, nq = 0;
  if (!r.write) {
    res = runRoute_(r, ctx, data);
    if (_NQ.length) { if (res && res.success) { var x = withLock_(function () { return simpanNQ_(); }); nq = typeof x === 'number' ? x : 0; } else _NQ = []; }
  } else {
    res = withLock_(function () {
      var c = CacheService.getScriptCache(), k = ctx.reqId && ('idem_' + ctx.reqId);
      var hit = k && c.get(k);
      if (hit) return JSON.parse(hit);                          // permintaan ulang → hasil sama
      var out = r.fn(ctx, data);
      if (out && out.success) {
        nq = simpanNQ_();                                     // notifikasi → antrean cache (bukan tulis sheet)
        bump_('adm', true);                                   // semua cache menu admin basi
        extSemua_('setelahTulis', r.name, ctx, data, out);    // v3.1: cache LMS per kursus/pengguna ikut basi
        if (k) { var s = JSON.stringify(redaksi_(out)); if (s.length < 90000) c.put(k, s, 21600); }   // R6: tanpa sandi
      } else _NQ = [];
      return out;
    });
  }
  if (res && res.success && (AUDIT_ACTIONS.test(body.action) || r.audit) && ctx.session) {
    queueLog_([ctx.session.email, ctx.session.role, body.action, res.auditDetail || auditDetail_(body.action, data), res.auditTarget || '']);
    delete res.auditDetail; delete res.auditTarget;
  }
  ctx.after.forEach(function (fn) { try { fn(); } catch (e) { console.error('after: ' + e.message); } });  // di luar lock
  if (nq > 0 && res) res.nq = nq;                             // frontend memanggil notif.drain
  return res;
}

/** Cache hasil menu admin berversi — kunci memuat versi 'adm', peran, dan hash parameter */
function runRoute_(r, ctx, data) {
  if (!r.cache) return r.fn(ctx, data);
  var d = Object.assign({}, data || {}), fresh = !!d._fresh; delete d._fresh;
  var key = 'ac_' + r.name + '_' + ver_('adm') + '_' + (ctx.session ? ctx.session.role : '-') + '_' + hashKecil_(JSON.stringify(d));
  if (!fresh) { var hit = CacheX.get(key); if (hit && hit.success) { hit.cached = true; return hit; } }
  var res = r.fn(ctx, d);
  if (res && res.success) CacheX.put(key, res, r.ttl || 600);
  return res;
}
function hashKecil_(s) { return b64u_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8)).substring(0, 16); }

function auditDetail_(action, d) {
  var o = {};
  ['NIS', 'NUPTK', 'sheet', 'id', 'user_id', 'lokasi_id', 'materi_id', 'kelas_id', 'mata_pelajaran', 'judul', 'aksi', 'blastId', 'kunci', 'biayaKode', 'pembayaranId', 'tagihanId', 'periodeList'].forEach(function (k) { if (d[k] !== undefined) o[k] = d[k]; });
  if (d.data && d.data.NIS) o.NIS = d.data.NIS;
  if (d.rows && d.rows.length) o.rows = d.rows.length;
  if (d.ids && d.ids.length) o.ids = d.ids.length;
  return JSON.stringify(redaksi_(o)).substring(0, 400);
}

/** Tandai pengguna "online" (monitoring Super Admin) — 1 put cache, TTL 15 menit */
function markSeen_(ctx) {
  try { CacheService.getScriptCache().put('seen_' + ctx.session.uid, JSON.stringify({ t: Date.now(), a: ctx.action }), 900); } catch (e) {}
}

var _IN_LOCK = false;
function withLock_(fn) {
  if (_IN_LOCK) return fn();                               // sudah memegang lock (panggilan bersarang)
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return fail_('Server sedang sibuk, coba lagi sebentar.', { retryable: true });
  _IN_LOCK = true;
  try { return fn(); }
  finally { _IN_LOCK = false; flushPendingWrites_(); lock.releaseLock(); }
}
/** Bagikan file "siapa saja yang punya link" — bisa ditolak kebijakan domain Workspace, maka tidak fatal */
function shareLink_(f) { try { f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) { console.warn('setSharing ditolak: ' + e.message); } return f; }
function flushPendingWrites_() { try { SpreadsheetApp.flush(); } catch (e) {} }

function apiBatch(ctx, d) {
  var out = {};
  (d.calls || []).slice(0, 10).forEach(function (c) {
    var r = routes_()[c.action], k = c.k ? String(c.k).substring(0, 80) : c.action;   // v3.1: kunci hasil (aksi sama, data beda)
    if (!r || r.write || c.action === 'batch' || r.auth === 'public' || !authorized_(r, ctx)) { out[k] = fail_('Tidak diizinkan dalam batch.'); return; }
    try { out[k] = runRoute_(r, ctx, c.data || {}); } catch (e) { out[k] = fail_(e.message); }
  });
  return ok_(out);
}

// ---------------------------------------------------------------------
// 4. RAHASIA — acak kuat, hash iteratif, perbandingan aman, masking, redaksi
// ---------------------------------------------------------------------
function acak_(n, huruf) {
  huruf = huruf || 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  var s = '';
  while (s.length < n) {
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Date.now() + Math.random())
      .forEach(function (b) { if (s.length < n) s += huruf[(b & 0xff) % huruf.length]; });
  }
  return s;
}
function sandiAcak_(n) { var s = acak_(n || 12); return /\d/.test(s) && /[A-Z]/.test(s) && /[a-z]/.test(s) ? s : sandiAcak_(n); }
function hashPass_(pass, salt, iter) {                     // HMAC-SHA256 iteratif (lambat disengaja)
  var h = String(pass), n = iter || APP.HASH_ITER;
  for (var i = 0; i < n; i++) h = Utilities.base64Encode(Utilities.computeHmacSha256Signature(h + salt, salt));
  return h;
}
function samaAman_(a, b) {                                 // perbandingan waktu-konstan
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  var r = 0; for (var i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
function samarkan_(v) { v = String(v || ''); return !v ? '' : v.length <= 8 ? '••••••' : v.slice(0, 4) + '••••••' + v.slice(-3); }
var POLA_RAHASIA = /(token|password|passwd|sandi|secret|rahasia|credential|kredensial|api[_-]?key|apikey|hash|salt|authorization|otp|pin|kode_reset)/i;
function redaksi_(o, d) {
  d = d || 0;
  if (o === null || typeof o !== 'object' || d > 6) return o;
  if (Array.isArray(o)) return o.map(function (x) { return redaksi_(x, d + 1); });
  var out = {};
  Object.keys(o).forEach(function (k) { out[k] = POLA_RAHASIA.test(k) && o[k] !== '' && o[k] !== null && typeof o[k] !== 'boolean' ? '[DISAMARKAN]' : redaksi_(o[k], d + 1); });
  return out;
}

// ---------------------------------------------------------------------
// 5. AUTENTIKASI — token HMAC stateless + hash sandi di Script Properties
// ---------------------------------------------------------------------
function secret_() {
  var s = prop_('TOKEN_SECRET');                           // nama lama dipertahankan agar sesi v2.0 tetap sah
  if (!s) { s = acak_(64); setProp_('TOKEN_SECRET', s); }
  return s;
}
function b64u_(bytesOrStr) { return Utilities.base64EncodeWebSafe(bytesOrStr).replace(/=+$/, ''); }
function sign_(s) { return b64u_(Utilities.computeHmacSha256Signature(s, secret_())); }
function signToken_(p) {
  var body = b64u_(Utilities.newBlob(JSON.stringify(p)).getBytes());
  return body + '.' + sign_(body);
}
function verifyToken_(t) {
  try {
    var parts = String(t || '').split('.');
    if (parts.length !== 2 || !samaAman_(sign_(parts[0]), parts[1])) return null;
    var b = parts[0]; while (b.length % 4) b += '=';
    var p = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(b)).getDataAsString());
    if (!p.x || p.x < Date.now()) return null;
    var rev = Number(CacheService.getScriptCache().get('rev_' + p.e) || prop_('REV_' + p.e) || 0);
    if (p.i < rev) return null;                            // dicabut ("keluar dari semua perangkat")
    return { email: p.e, role: p.r, ref: p.f, uid: p.u, exp: p.x };
  } catch (e) { return null; }
}
function revokeAll_(email) {
  var t = String(Date.now());
  setProp_('REV_' + email, t);
  CacheService.getScriptCache().put('rev_' + email, t, 21600);
}

/** Format hash: 'v2$<iterasi>$<salt>$<hash>'. iter=1 hanya untuk sandi awal massal (=NIS, wajib ganti). */
function hashPassword_(pw, salt, iter) { iter = iter || APP.HASH_ITER; salt = salt || newSalt_(); return 'v2$' + iter + '$' + salt + '$' + hashPass_(pw, salt, iter); }
function newSalt_() { return acak_(16); }
function randomPassword_(n) { return acak_(n || 8, 'abcdefghjkmnpqrstuvwxyz23456789'); }
function pwSimpan_(uid, pw, iter) { setProp_('PW_' + uid, hashPassword_(pw, newSalt_(), iter)); bump_('akun'); }
function bytesToHex_(bytes) {
  return bytes.map(function (b) { var v = (b + 256) % 256; return (v < 16 ? '0' : '') + v.toString(16); }).join('');
}
function sha256Bytes_(s) { return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8); }
/** true | false | 'upgrade' (hash format lama cocok → login akan mengubahnya ke v2) */
function verifyPassword_(pw, user) {
  var stored = prop_('PW_' + user.user_id);
  if (!stored && user.password_hash) stored = 'v1$' + String(user.salt || '') + '$' + String(user.password_hash).trim();   // sisa data lama di sheet
  if (!stored) return false;
  var p = String(stored).split('$');
  if (p[0] === 'v2' && p.length >= 4) return samaAman_(hashPass_(pw, p[2], Number(p[1]) || APP.HASH_ITER), p.slice(3).join('$'));
  if (p[0] === 'v1') {
    var salt = p[1], h = p.slice(2).join('$'), bytes = sha256Bytes_(String(salt || '') + String(pw));
    return samaAman_(h.toLowerCase(), bytesToHex_(bytes)) || samaAman_(h, Utilities.base64Encode(bytes)) ? 'upgrade' : false;
  }
  return false;
}

function apiConfigPublic(ctx, d) {
  var ready = !!CONFIG.SPREADSHEET_ID;
  var cfg = ready ? settings_() : {};
  var out = {
    ready: ready, version: APP.VERSION,
    namaSekolah: cfg.NAMA_SEKOLAH || APP.NAME, logo: cfg.LOGO_URL || '',
    demo: ready && prop_('DEMO_SEEDED') === '1'
  };
  if (ready) extSemua_('publik', out, cfg);                  // v3.0: branding & opsi login Google
  return ok_(out);
}

function apiLogin(ctx, d) {
  var id = String(d.id || '').trim().toLowerCase(), pw = String(d.password || '');
  if (!id || !pw) return fail_('Email/NIS dan password wajib diisi.');
  var cache = CacheService.getScriptCache(), fk = 'fail_' + id.replace(/[^a-z0-9@._-]/g, '');
  var fails = Number(cache.get(fk) || 0);
  if (fails >= 5) return fail_('Terlalu banyak percobaan gagal. Coba lagi dalam 10 menit.');
  var u = findUser_(id);
  if (u && u.role === 'superadmin') {                        // R9: penguncian khusus superadmin
    var kunci = Number(prop_('SA_KUNCI_' + u.user_id) || 0);
    if (kunci > Date.now()) return fail_('Akun Super Admin dikunci sementara. Coba lagi ' + Math.ceil((kunci - Date.now()) / 60000) + ' menit lagi, atau jalankan resetSuperAdmin() dari editor Apps Script.', { code: 'LOCKED' });
  }
  var cek = u ? verifyPassword_(pw, u) : false;
  if (!cek) {
    cache.put(fk, String(fails + 1), 600);
    if (u && u.role === 'superadmin') {
      var sk = 'safail_' + u.user_id, n = Number(cache.get(sk) || 0) + 1;
      cache.put(sk, String(n), 900);
      if (n >= 5) { setProp_('SA_KUNCI_' + u.user_id, String(Date.now() + 15 * 60000)); cache.remove(sk); }
      queueLog_([lower_(u.email), 'superadmin', 'LOGIN_SA_GAGAL', 'Percobaan ke-' + n, '']);   // tanpa sandi
      Utilities.sleep(400);
    }
    extSemua_('loginGagal', id, u);                          // v3.0: log keamanan
    return fail_('Email atau password salah.');
  }
  if (String(u.status_aktif).toUpperCase() !== 'YA') return fail_('Akun belum aktif / dinonaktifkan. Hubungi wali kelas atau Super Admin sekolah.');
  if (d.role === 'siswa' && u.role !== 'siswa') return fail_('Akun ini terdaftar sebagai ' + (u.role === 'superadmin' ? 'Super Admin' : 'Guru / Admin') + '. Pilih tab Guru / Admin.');
  if (d.role === 'guru' && u.role === 'siswa') return fail_('Akun ini terdaftar sebagai Siswa. Pilih tab Siswa.');
  var gerbangLogin = extHook_('login', u, ctx, d);          // v3.0: mode login Super Admin & batas IP
  if (gerbangLogin) return gerbangLogin;
  cache.remove(fk);
  if (cek === 'upgrade') { try { withLock_(function () { pwSimpan_(u.user_id, pw); if (u.password_hash) DB.updateBatch('Users', 'user_id', [{ user_id: u.user_id, password_hash: '', salt: '' }]); return ok_(); }); } catch (e) {} }
  if (u.role === 'superadmin') { delProp_('SA_KUNCI_' + u.user_id); }
  var now = Date.now(), ttl = u.role === 'superadmin' ? APP.SA_TTL_MS : (d.remember ? APP.REMEMBER_TTL_MS : APP.TOKEN_TTL_MS);
  var token = signToken_({ e: lower_(u.email), r: u.role, f: String(u.ref_id), u: u.user_id, i: now, x: now + ttl });
  touchLastLogin_(u);
  if (u.role !== 'siswa' && d.appUrl && !setting_('APP_URL', '')) { try { withLock_(function () { saveSettings_({ APP_URL: String(d.appUrl).split('#')[0] }); return ok_(); }); } catch (e) {} }
  queueLog_([lower_(u.email), u.role, 'LOGIN', '', '']);
  extSemua_('loginOk', u, ctx, 'sandi');                    // v3.0: riwayat login (perangkat, IP)
  var sess = { email: lower_(u.email), role: u.role, ref: String(u.ref_id), uid: u.user_id };
  var fakeCtx = { session: sess, user: userIdx_()[u.user_id], dev: ctx.dev || '' };
  markSeen_(fakeCtx);
  var boot = u.role === 'siswa' ? apiSiswaBootstrap(fakeCtx, {}).data : apiGuruBootstrap(fakeCtx, {}).data;
  return ok_({
    token: token, role: u.role, email: lower_(u.email), nama: u.nama, ref: String(u.ref_id), hak: String(u.hak_akses || ''),
    wajibGantiSandi: String(u.wajib_ganti_sandi).toUpperCase() === 'YA',
    exp: now + ttl,
    boot: boot                                          // login = bootstrap (1 panggilan)
  }, 'Selamat datang, ' + u.nama + '!');
}

function findUser_(id) {
  id = String(id || '').trim().toLowerCase();
  if (!id) return null;
  var users = DB.all('Users');
  for (var i = 0; i < users.length; i++) {
    var u = users[i];
    if (lower_(u.email) === id || (u.ref_id !== '' && lower_(u.ref_id) === id)) return u;
  }
  return null;
}
function touchLastLogin_(u) {
  if (Date.now() - new Date(u.last_login || 0).getTime() > 6 * 3600e3) {
    try { withLock_(function () { DB.updateBatch('Users', 'user_id', [{ user_id: u.user_id, last_login: nowIso_() }]); return ok_(); }); } catch (e) {}
  }
}

function kuatSandi_(role, pw) {
  if (role === 'superadmin') return pw.length >= 12 && /[A-Za-z]/.test(pw) && /\d/.test(pw) ? '' : 'Sandi Super Admin minimal 12 karakter berisi huruf dan angka.';
  return pw.length >= 6 ? '' : 'Password baru minimal 6 karakter.';
}

function apiChangePassword(ctx, d) {
  var u = DB.find('Users', 'user_id', ctx.session.uid);
  if (!u) return fail_('Akun tidak ditemukan.');
  if (!verifyPassword_(String(d.lama || ''), u)) return fail_('Password lama salah.');
  var baru = String(d.baru || ''), lemah = kuatSandi_(u.role, baru);
  if (lemah) return fail_(lemah);
  pwSimpan_(u.user_id, baru);
  DB.updateBatch('Users', 'user_id', [{ user_id: u.user_id, wajib_ganti_sandi: 'TIDAK' }]);
  revokeAll_(lower_(u.email));
  var now = Date.now() + 1, ttl = u.role === 'superadmin' ? APP.SA_TTL_MS : APP.TOKEN_TTL_MS;
  var token = signToken_({ e: lower_(u.email), r: u.role, f: String(u.ref_id), u: u.user_id, i: now, x: now + ttl });
  return ok_({ token: token, exp: now + ttl }, 'Password berhasil diganti. Perangkat lain otomatis keluar.');
}

/** Lupa password: kirim kode 6 digit ke WA/Email terdaftar (butuh modul notifikasi aktif) */
function apiForgot(ctx, d) {
  var u = findUser_(d.id);
  var generic = 'Jika akun ditemukan dan kontak terdaftar, kode reset telah dikirim via WhatsApp/Email. Bila tidak menerima, hubungi wali kelas / admin.';
  if (!u) return ok_({ sent: false }, generic);
  var c = CacheService.getScriptCache(), rk = 'rst_' + lower_(u.email);
  if (c.get(rk + '_t')) return ok_({ sent: false }, 'Kode sudah dikirim. Tunggu 2 menit sebelum meminta lagi.');
  var kode = acak_(6, '0123456789');
  c.put(rk, kode, 900); c.put(rk + '_t', '1', 120);
  var n = kirimNotif_('RESET_SANDI', kontakUser_(u), { kode: kode }, u.user_id);
  return ok_({ sent: n > 0 }, n > 0 ? generic : 'Notifikasi belum aktif di sekolah ini. Hubungi wali kelas / admin untuk reset password.');
}
function apiResetConfirm(ctx, d) {
  var u = findUser_(d.id);
  if (!u) return fail_('Kode tidak valid atau kedaluwarsa.');
  var c = CacheService.getScriptCache(), rk = 'rst_' + lower_(u.email), simpan = c.get(rk);
  if (!simpan || !samaAman_(simpan, String(d.kode || '').trim())) return fail_('Kode tidak valid atau kedaluwarsa.');
  var baru = String(d.baru || ''), lemah = kuatSandi_(u.role, baru);
  if (lemah) return fail_(lemah);
  pwSimpan_(u.user_id, baru);
  DB.updateBatch('Users', 'user_id', [{ user_id: u.user_id, wajib_ganti_sandi: 'TIDAK' }]);
  c.remove(rk); revokeAll_(lower_(u.email));
  return ok_(null, 'Password berhasil direset. Silakan login.');
}
/** Kontak notifikasi untuk seorang user: siswa → WA orang tua + email siswa; guru → WA + email guru */
function kontakUser_(u) {
  if (u.role === 'siswa') {
    var s = DB.find('Siswa', 'NIS', u.ref_id) || {};
    return { nama: s.nama_lengkap || u.nama, hp: s.no_wa_ortu || s.no_wa, email: s.email || u.email };
  }
  var g = (u.ref_id && DB.find('Guru', 'NUPTK', u.ref_id)) || {};
  return { nama: g.nama_lengkap || u.nama, hp: g.no_wa, email: g.email || u.email };
}

/** Indeks akun (cache berversi 'akun'): dipakai cek sesi tiap request & monitoring */
var _UIDX = null;
function userIdx_() {
  if (_UIDX) return _UIDX;
  var key = 'uidx_' + ver_('akun'), c = CacheX.get(key);
  if (c) return (_UIDX = c);
  var o = {};
  DB.all('Users').forEach(function (u) {
    o[u.user_id] = { r: u.role, a: String(u.status_aktif).toUpperCase() === 'YA' ? 1 : 0, n: u.nama, e: lower_(u.email), f: String(u.ref_id || ''), k: u.kelas_id || '',
      h: u.hak_akses || '', l: u.lokasi_ids || '', d: u.device_id || '' };
  });
  CacheX.put(key, o, 21600);
  return (_UIDX = o);
}

/** Pindahkan semua hash yang masih tertulis di sheet Users ke Script Properties (idempoten) */
function amankanSandi_() {
  var sisa = DB.all('Users').filter(function (u) { return String(u.password_hash || '') !== ''; });
  if (!sisa.length) return 0;
  DB.updateBatch('Users', 'user_id', sisa.map(function (u) { return { user_id: u.user_id, password_hash: u.password_hash, salt: u.salt }; }));   // hook memindahkan & mengosongkan
  return sisa.length;
}
/** Hapus PW_ milik akun yang sudah tidak ada */
function bersihkanPwYatim_() {
  var ada = {}; DB.all('Users').forEach(function (u) { ada['PW_' + u.user_id] = 1; });
  var n = 0;
  PROPS.getKeys().forEach(function (k) { if (k.indexOf('PW_') === 0 && !ada[k]) { delProp_(k); n++; } });
  return n;
}

// ---------------------------------------------------------------------
// 6. DATABASE — memo per eksekusi, batch setValues, semua kolom teks
// ---------------------------------------------------------------------
var _SS = null, _ROWS = {}, _SETTINGS = null, _COLS_OK = {};
function getSS_() { return _SS || (_SS = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID)); }
function getSheet_(name) {
  var sh = getSS_().getSheetByName(name);
  if (!sh) {                                               // upgrade aditif: sheet baru dibuat otomatis
    if (!SCHEMA[name]) throw new Error('Sheet tidak dikenal: ' + name);
    sh = createSheet_(getSS_(), name);
  }
  return sh;
}
function createSheet_(ss, name) {
  var cols = SCHEMA[name].cols, sh = ss.insertSheet(name);
  sh.getRange(1, 1, sh.getMaxRows(), cols.length).setNumberFormat('@');
  sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold').setBackground('#1E3A5F').setFontColor('#ffffff');
  sh.setFrozenRows(1);
  return sh;
}
/** Kolom skema yang belum ada ditambahkan di kanan (aditif) — dipanggil saat menulis, tanpa baca ekstra */
function tambahKolom_(sh, name, h) {
  if (!SCHEMA[name] || _COLS_OK[name]) return h;
  var miss = SCHEMA[name].cols.filter(function (c) { return h.indexOf(c) === -1; });
  _COLS_OK[name] = 1;
  if (!miss.length) return h;
  var start = h.length + 1;
  if (sh.getMaxColumns() < h.length + miss.length) sh.insertColumnsAfter(sh.getMaxColumns(), h.length + miss.length - sh.getMaxColumns());
  sh.getRange(1, start, sh.getMaxRows(), miss.length).setNumberFormat('@');
  sh.getRange(1, start, 1, miss.length).setValues([miss]).setFontWeight('bold').setBackground('#1E3A5F').setFontColor('#ffffff');
  return h.concat(miss);
}

function normCell_(col, v) {
  if (v instanceof Date) {
    if (/^(Periode|Mulai|Sampai)$/.test(col)) return Utilities.formatDate(v, APP.TZ, 'yyyy-MM');
    if (/tanggal$|^tanggal|^Tanggal|^JatuhTempo$|^jatuh_tempo$/.test(col)) return Utilities.formatDate(v, APP.TZ, 'yyyy-MM-dd');
    if (/^jam/.test(col)) return Utilities.formatDate(v, APP.TZ, 'HH:mm');
    return v.toISOString();
  }
  if (NUMERIC_COLS[col]) return v === '' || v === null ? '' : Number(v);
  if (/^(no_wa|no_wa_ortu|NoWA)$/.test(col)) return hp08_(v);
  if (v === null || v === undefined) return '';
  return typeof v === 'number' ? String(v) : v;
}

/** Hook keamanan sheet Users: hash sandi TIDAK PERNAH ditulis ke sheet (R1/R6) */
function hookUsers_(rows) {
  var simpan = {}, berubah = false;
  rows.forEach(function (o) {
    if (Object.keys(o).some(function (k) { return k !== 'user_id' && k !== 'last_login'; })) berubah = true;
    var h = o.password_hash;
    if (h !== undefined && h !== null && String(h) !== '') {
      var s = String(h);
      if (s.indexOf('v2$') !== 0) s = 'v1$' + String(o.salt || '') + '$' + s;
      if (o.user_id) simpan['PW_' + o.user_id] = s;
      o.password_hash = ''; o.salt = '';
    }
  });
  setProps_(simpan);
  return berubah;
}

var DB = {
  all: function (name) {
    if (_ROWS[name]) return _ROWS[name];
    var sh = getSheet_(name), v = sh.getDataRange().getValues();
    var h = v[0].map(String), out = [];
    for (var r = 1; r < v.length; r++) {
      if (v[r].join('') === '') continue;
      var o = {};
      for (var i = 0; i < h.length; i++) if (h[i]) o[h[i]] = normCell_(h[i], v[r][i]);
      out.push(o);
    }
    return (_ROWS[name] = out);
  },
  find: function (name, col, val) {
    var s = String(val), rows = DB.all(name);
    for (var i = 0; i < rows.length; i++) if (String(rows[i][col]) === s) return rows[i];
    return null;
  },
  filter: function (name, fn) { return DB.all(name).filter(fn); },
  headers_: function (sh) { return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String); },
  /** Tambah banyak baris: 1× setValues */
  appendBatch: function (name, objs) {
    if (!objs || !objs.length) return 0;
    var akun = name === 'Users' && hookUsers_(objs);
    var sh = getSheet_(name), h = tambahKolom_(sh, name, DB.headers_(sh));
    var rows = objs.map(function (o) { return h.map(function (k) { var v = o[k]; return v === undefined || v === null ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v)); }); });
    var start = sh.getLastRow() + 1, need = start + rows.length - 1, max = sh.getMaxRows();
    if (need > max) {
      sh.insertRowsAfter(max, need - max + 100);
      sh.getRange(max + 1, 1, need - max + 100, h.length).setNumberFormat('@');
    }
    sh.getRange(start, 1, rows.length, h.length).setValues(rows);
    delete _ROWS[name];
    if (akun) bump_('akun');
    return rows.length;
  },
  /** Ubah banyak baris (patches = [{keyCol: id, kolom: nilai}]) → 1 blok kontigu */
  updateBatch: function (name, keyCol, patches) {
    if (!patches || !patches.length) return 0;
    var akun = name === 'Users' && hookUsers_(patches);
    var sh = getSheet_(name), v = sh.getDataRange().getValues(), h = v[0].map(String);
    var h2 = tambahKolom_(sh, name, h);
    if (h2.length > h.length) { v = v.map(function (r, i) { return i === 0 ? h2.slice() : r.concat(h2.slice(h.length).map(function () { return ''; })); }); h = h2; }
    var ki = h.indexOf(keyCol);
    var map = {}; patches.forEach(function (p) { map[String(p[keyCol])] = Object.assign(map[String(p[keyCol])] || {}, p); });
    var min = Infinity, max = -1, n = 0;
    for (var i = 1; i < v.length; i++) {
      var p = map[String(v[i][ki])]; if (!p) continue;
      Object.keys(p).forEach(function (k) { var c = h.indexOf(k); if (c > -1 && k !== keyCol) v[i][c] = p[k] === null || p[k] === undefined ? '' : (typeof p[k] === 'object' ? JSON.stringify(p[k]) : String(p[k])); });
      min = Math.min(min, i); max = Math.max(max, i); n++;
    }
    if (max > -1) sh.getRange(min + 1, 1, max - min + 1, h.length).setValues(v.slice(min, max + 1));
    delete _ROWS[name];
    if (akun && n) bump_('akun');
    return n;
  },
  /** Hapus baris dengan kunci tertentu: filter di memori, tulis ulang blok, bersihkan sisa */
  deleteWhere: function (name, keyCol, keys) {
    var set = {}; (keys || []).forEach(function (k) { set[String(k)] = 1; });
    var sh = getSheet_(name), v = sh.getDataRange().getValues(), h = v[0], ki = h.map(String).indexOf(keyCol);
    var keep = [v[0]], removed = 0, ids = [];
    for (var i = 1; i < v.length; i++) { if (set[String(v[i][ki])]) { removed++; ids.push(String(v[i][ki])); } else keep.push(v[i]); }
    if (!removed) return 0;
    sh.getRange(1, 1, keep.length, h.length).setValues(keep);
    sh.getRange(keep.length + 1, 1, removed, h.length).clearContent();
    delete _ROWS[name];
    if (name === 'Users') { ids.forEach(function (id) { delProp_('PW_' + id); delProp_('SA_KUNCI_' + id); }); bump_('akun'); }
    return removed;
  },
  /** Upsert berdasarkan fungsi kunci; mengembalikan {inserted, updated} */
  upsert: function (name, keyFn, objs) {
    var idx = {}, keyCol = SCHEMA[name].key;
    DB.all(name).forEach(function (r) { idx[keyFn(r)] = r; });
    var ins = [], upd = [];
    objs.forEach(function (o) {
      var ex = idx[keyFn(o)];
      if (ex) upd.push(Object.assign({}, o, (function () { var t = {}; t[keyCol] = ex[keyCol]; return t; })()));
      else ins.push(o);
    });
    if (ins.length && SCHEMA[name].prefix) {
      var need = ins.filter(function (o) { return !o[keyCol]; });
      var ids = reserveIds_(name, need.length);
      need.forEach(function (o, i) { o[keyCol] = ids[i]; });
    }
    DB.appendBatch(name, ins);
    DB.updateBatch(name, keyCol, upd);
    return { inserted: ins.length, updated: upd.length, rows: ins.concat(upd) };
  }
};
function invalidateRows_(name) { delete _ROWS[name]; }

/** ID berurutan tanpa pemotongan (high-water mark di Properties, dibaca segar): ABS000001 */
function reserveIds_(name, n) {
  if (!n) return [];
  var prefix = SCHEMA[name].prefix, k = 'SEQ_' + name;
  var cur = Number(propFresh_(k) || 0);
  if (!cur) {                                            // inisialisasi dari data yang ada
    DB.all(name).forEach(function (r) { var m = String(r[SCHEMA[name].key] || '').match(/(\d+)$/); if (m) cur = Math.max(cur, Number(m[1])); });
  }
  var out = [];
  for (var i = 1; i <= n; i++) { var num = String(cur + i); out.push(prefix + (num.length < 6 ? ('000000' + num).slice(-6) : num)); }
  setProp_(k, String(cur + n));
  return out;
}

// ---------------------------------------------------------------------
// 7. PENGATURAN (sheet Config — Kelas C, tidak pernah berisi rahasia)
// ---------------------------------------------------------------------
function settings_() {
  if (_SETTINGS) return _SETTINGS;
  var c = CacheX.get('cfg_' + ver_('master'));
  if (c) return (_SETTINGS = c);
  var o = {};
  CONFIG_SEED.forEach(function (s) { o[s[0]] = s[1]; });
  DB.all('Config').forEach(function (r) { if (r.key) o[r.key] = String(r.value); });
  CacheX.put('cfg_' + ver_('master'), o, 3600);
  return (_SETTINGS = o);
}
function setting_(k, d) { var v = settings_()[k]; return v === undefined || v === '' ? d : v; }
function saveSettings_(pairs) {
  var rows = DB.all('Config'), have = {}, upd = [], ins = [];
  rows.forEach(function (r) { have[r.key] = 1; });
  Object.keys(pairs).forEach(function (k) {
    var v = pairs[k] === null || pairs[k] === undefined ? '' : String(pairs[k]);
    if (have[k]) upd.push({ key: k, value: v }); else ins.push({ key: k, value: v, keterangan: '' });
  });
  DB.updateBatch('Config', 'key', upd);
  DB.appendBatch('Config', ins);
  _SETTINGS = null;
  bump_('master');
}

// ---------------------------------------------------------------------
// 8. CACHE BERLAPIS — chunk > 50 KB, invalidasi berbasis versi
// ---------------------------------------------------------------------
var CacheX = {
  SZ: 50000,
  c: function () { return CacheService.getScriptCache(); },
  get: function (key) {
    try {
      var c = this.c(), head = c.get(key);
      if (head == null) return null;
      if (head.indexOf('__chunks:') !== 0) return JSON.parse(head);
      var n = +head.slice(9), keys = [];
      for (var i = 0; i < n; i++) keys.push(key + '#' + i);
      var parts = c.getAll(keys), s = '';
      for (var j = 0; j < n; j++) { if (parts[keys[j]] == null) return null; s += parts[keys[j]]; }
      return JSON.parse(s);
    } catch (e) { return null; }
  },
  put: function (key, val, ttl) {
    try {
      var s = JSON.stringify(val), c = this.c();
      if (s.length <= this.SZ) { c.put(key, s, ttl); return true; }
      var n = Math.ceil(s.length / this.SZ); if (n > 20) return false;
      var m = {}; for (var i = 0; i < n; i++) m[key + '#' + i] = s.substr(i * this.SZ, this.SZ);
      c.putAll(m, ttl); c.put(key, '__chunks:' + n, ttl);   // kepala ditulis TERAKHIR
      return true;
    } catch (e) { return false; }
  },
  remove: function (key) { try { this.c().remove(key); } catch (e) {} }
};
function ver_(scope) {
  var c = CacheService.getScriptCache(), k = 'ver_' + scope, v = c.get(k);
  if (!v) { v = prop_(k) || String(Date.now()); c.put(k, v, 21600); }
  return v;
}
/** Naikkan versi lingkup. cacheOnly = tidak ditulis ke Properties (lingkup sering berubah: 'adm') */
function bump_(scope, cacheOnly) {
  var v = String(Date.now()) + Math.floor(Math.random() * 1000);
  CacheService.getScriptCache().put('ver_' + scope, v, 21600);
  if (!cacheOnly) setProp_('ver_' + scope, v);
  if (scope === 'master') _SETTINGS = null;
  if (scope === 'akun') _UIDX = null;
}
function cached_(key, ttl, build) { var v = CacheX.get(key); if (v !== null) return v; var d = build(); CacheX.put(key, d, ttl); return d; }

// ---------------------------------------------------------------------
// 9. ANTREAN NOTIFIKASI — keluar dari jalur respons (gas-scale-turbo 3.5)
//    kirimNotifBatch_ saat request web → _NQ → cache 'nq' (di dalam lock tulis).
//    Respons membawa res.nq → frontend memanggil 'notif.drain'. Cadangan: pekerjaMenit.
// ---------------------------------------------------------------------
function simpanNQ_() {
  if (!_NQ.length) return 0;
  var rows = _NQ; _NQ = [];
  var q = CacheX.get('nq') || [];
  q = q.concat(rows);
  if (q.length > 2500 || !CacheX.put('nq', q, 21600)) { tulisAntrian_(rows); return 0; }   // cache penuh → tulis langsung (perilaku lama)
  return rows.length;
}
function tulisAntrian_(rows) {
  if (!rows.length) return 0;
  var ids = reserveIds_('AntrianNotif', rows.length);
  rows.forEach(function (r, i) { r.AntrianID = ids[i]; });
  DB.appendBatch('AntrianNotif', rows);
  if (!propFresh_('ANTRIAN_MULAI')) setProp_('ANTRIAN_MULAI', '2');
  setProp_('ANTRIAN_ADA', '1');
  return rows.length;
}
/** Pindahkan antrean cache → sheet AntrianNotif (dipanggil di bawah lock) */
function pindahkanNQ_() {
  var q = CacheX.get('nq');
  if (!q || !q.length) return 0;
  tulisAntrian_(q);
  CacheX.remove('nq');
  return q.length;
}
function apiNotifDrain(ctx, d) {
  var c = CacheService.getScriptCache();
  var adaCache = !!c.get('nq');
  if (!adaCache && propFresh_('ANTRIAN_ADA') !== '1') return ok_({ moved: 0, left: 0 }, 'Antrean kosong');   // cepat tanpa lock
  var moved = 0;
  if (adaCache) { var r = withLock_(function () { return pindahkanNQ_(); }); moved = typeof r === 'number' ? r : 0; }
  var h = {};
  if (!c.get('drain_t')) { c.put('drain_t', '1', 3); h = prosesAntrianNotif({ tanpaTugasLain: true }); }
  return ok_({ moved: moved, left: c.get('nq') ? 1 : 0, kirim: h });
}

// ---------------------------------------------------------------------
// 10. LOG — antrean cache, di-flush trigger (jalur baca tidak menulis)
// ---------------------------------------------------------------------
function queueLog_(row) {
  var full = [Utilities.getUuid(), nowIso_()].concat(row);
  var lock = _IN_LOCK ? null : LockService.getScriptLock();
  if (lock && !lock.tryLock(300)) { try { DB.appendBatch('Logs', [rowToLog_(full)]); } catch (e) {} return; }
  try {
    var c = CacheService.getScriptCache(), q = JSON.parse(c.get('logq') || '[]');
    q.push(full);
    if (q.length >= 100) { DB.appendBatch('Logs', q.map(rowToLog_)); c.remove('logq'); }
    else c.put('logq', JSON.stringify(q), 21600);
  } finally { if (lock) lock.releaseLock(); }
}
function rowToLog_(r) { return { log_id: r[0], timestamp: r[1], email: r[2], role: r[3], action: r[4], detail: r[5], target: r[6] }; }
function flushLogs_() {
  var c = CacheService.getScriptCache(), q = JSON.parse(c.get('logq') || '[]');
  if (q.length) { DB.appendBatch('Logs', q.map(rowToLog_)); c.remove('logq'); }
  var v = JSON.parse(c.get('viewq') || '[]');
  if (v.length) { flushMateriViews_(v); c.remove('viewq'); }
}
function logTerakhir_(n) {
  var sh = getSheet_('Logs'), last = sh.getLastRow(), cnt = Math.min(n, Math.max(0, last - 1));
  var rows = [];
  if (cnt > 0) {
    var h = SCHEMA.Logs.cols, v = sh.getRange(last - cnt + 1, 1, cnt, h.length).getValues();
    rows = v.map(function (r) { var o = {}; h.forEach(function (k, i) { o[k] = r[i] instanceof Date ? r[i].toISOString() : r[i]; }); return o; });
  }
  var q = JSON.parse(CacheService.getScriptCache().get('logq') || '[]').map(rowToLog_);
  return rows.concat(q).reverse().slice(0, n);
}
function apiLogsList(ctx, d) { return ok_(logTerakhir_(300)); }

// ---------------------------------------------------------------------
// 11. UTILITAS
// ---------------------------------------------------------------------
function nowIso_() { return Utilities.formatDate(new Date(), APP.TZ, "yyyy-MM-dd'T'HH:mm:ssXXX"); }
function today_() { return Utilities.formatDate(new Date(), APP.TZ, 'yyyy-MM-dd'); }
function timeNow_() { return Utilities.formatDate(new Date(), APP.TZ, 'HH:mm:ss'); }
function lower_(s) { return String(s || '').trim().toLowerCase(); }
function num_(v, d) { var n = Number(v); return v === '' || v === null || v === undefined || isNaN(n) ? (d === undefined ? 0 : d) : n; }
/** Nominal uang: menerima 400000, "400.000", "Rp 400.000" */
function uang_(v) { if (typeof v === 'number') return v; var s = String(v === null || v === undefined ? '' : v).replace(/^\s*Rp\.?\s*/i, '').replace(/[.\s]/g, '').replace(',', '.'); var n = Number(s); return isNaN(n) ? 0 : n; }
function round1_(n) { return Math.round(n * 10) / 10; }
function hp08_(v) {
  var s = String(v == null ? '' : v).trim().replace(/\.0+$/, '').replace(/[^0-9+]/g, '').replace(/^\+/, '');
  if (!s) return '';
  if (s.indexOf('62') === 0) s = '0' + s.substring(2); else if (s.indexOf('8') === 0) s = '0' + s;
  return s;
}
function hp62_(v) { var s = hp08_(v); return s ? (s[0] === '0' ? '62' + s.substring(1) : s) : ''; }
function hpValid_(v) { return /^08\d{8,12}$/.test(hp08_(v)); }
function emailValid_(e) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(e || '').trim()); }
function isiTemplate_(tpl, v) { return String(tpl || '').replace(/\{(\w+)\}/g, function (m, k) { return v[k] == null ? '' : String(v[k]); }); }
function haversine_(lat1, lon1, lat2, lon2) {
  var R = 6371000, toR = Math.PI / 180;
  var dLat = (lat2 - lat1) * toR, dLon = (lon2 - lon1) * toR;
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function slug_(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, ''); }
function driveFolder_(id) { return DriveApp.getFolderById(id); }
function saveBase64File_(folderId, name, mime, b64) {
  var bytes = Utilities.base64Decode(String(b64).replace(/^data:[^,]+,/, ''));
  var blob = Utilities.newBlob(bytes, mime, name);
  var f = driveFolder_(folderId).createFile(blob);
  return f;
}

// ---------------------------------------------------------------------
// 12. TRIGGER — satu pekerja per menit: log, antrean notif, auto-alpha,
//     pengingat tagihan, CRM, dan warmup lapis 2 (keepWarm)
// ---------------------------------------------------------------------
function pekerjaMenit() {
  resetMemo_();
  try { withLock_(function () { flushLogs_(); pindahkanNQ_(); autoAlphaCek_(); return ok_(); }); } catch (e) { console.error('pekerja: ' + e.message); }
  try { withLock_(function () { tgReminderOtomatis_(); return ok_(); }); } catch (e1) { console.error('reminder: ' + e1.message); }
  try { prosesAntrianNotif({}); } catch (e2) { console.error('notif: ' + e2.message); }
  try { if (prop_('KEEP_WARM') !== 'off') warmCaches_('tick'); } catch (e3) { console.error('warm: ' + e3.message); }
  if (EXT.tick.length) { try { withLock_(function () { EXT.tick.forEach(function (f) { try { f(); } catch (x) { console.error('ext: ' + x.message); } }); return ok_(); }); } catch (e4) { console.error('ext: ' + e4.message); } }   // v3.0
}
function pasangTrigger() {
  var have = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
  if (have.indexOf('pekerjaMenit') === -1) ScriptApp.newTrigger('pekerjaMenit').timeBased().everyMinutes(1).create();
  Logger.log('✅ Trigger pekerjaMenit aktif (1 menit).');
  return true;
}

/** Warmup: isi cache yang sering dipakai. scope: pub | admin | tick | setup. Tidak mengembalikan data. */
function warmCaches_(scope) {
  if (!CONFIG.SPREADSHEET_ID) return 'belum setup';
  var c = CacheService.getScriptCache(), flag = 'warm_' + scope;
  if (scope !== 'setup' && c.get(flag)) return 'skip';
  c.put(flag, '1', scope === 'tick' ? 50 : 60);
  var t0 = Date.now(), langkah = [];
  function step(n, fn) { try { fn(); langkah.push(n); } catch (e) { langkah.push(n + '✗'); } }
  step('pengaturan', settings_);
  step('akun', userIdx_);
  step('lokasi', lokasiAktif_);
  if (scope !== 'pub') {
    step('absensi', absenIndex_);
    step('bootGuru', function () { cached_('bootG_' + versKey_(), 600, buildGuruBootstrap_); });
  }
  extSemua_('warm', step, scope);                            // v3.1: modul tambahan ikut dipanaskan (mis. struktur kursus LMS)
  c.put('warm_last', JSON.stringify({ at: nowIso_(), scope: scope, ms: Date.now() - t0, langkah: langkah }), 21600);
  return langkah.join(',');
}
function matikanKeepWarm() { setProp_('KEEP_WARM', 'off'); Logger.log('⏸️ Warmup otomatis dimatikan. Trigger pekerjaMenit tetap berjalan untuk notifikasi & log.'); }
function nyalakanKeepWarm() { delProp_('KEEP_WARM'); pasangTrigger(); Logger.log('▶️ Warmup otomatis dinyalakan.'); }

// ---------------------------------------------------------------------
// 13. SETUP — jalankan SEKALI dari editor (idempoten, tidak menimpa rahasia)
// ---------------------------------------------------------------------
var _DEMO_PW = null;
/** Sandi akun contoh: mode demo browser memakai window.__DEMO_PW; server asli = acak, tampil SEKALI di log */
function demoPw_(kind) {
  if (typeof __DEMO_PW !== 'undefined' && __DEMO_PW && __DEMO_PW[kind]) return __DEMO_PW[kind];
  _DEMO_PW = _DEMO_PW || {};
  return _DEMO_PW[kind] || (_DEMO_PW[kind] = sandiAcak_(12));
}
function setupRahasia_() {
  secret_();                                               // TOKEN_SECRET (secret sesi) bila belum ada
  if (!prop_('QR_SECRET')) setProp_('QR_SECRET', acak_(48));   // tanda tangan QR kwitansi
  extSemua_('setupRahasia');                               // v3.0: kunci enkripsi pesan, dll.
}

function setupAppEnvironment() {
  if (prop_('SPREADSHEET_ID')) {
    Logger.log('⚠️ Setup sudah pernah dijalankan. Spreadsheet: ' + prop_('SPREADSHEET_ID'));
    Logger.log('   Untuk update ke v2.1 jalankan setupV21(). Untuk memulai ulang hapus Script Properties dulu.');
    return;
  }
  Logger.log('🚀 Memulai setup ' + APP.NAME + ' v' + APP.VERSION + '...');
  var root = DriveApp.createFolder('📁 ' + APP.NAME);
  var fMateri = root.createFolder('SIAKAD_MATERI');
  var fSelfie = root.createFolder('SIAKAD_FOTO_SELFIE');
  var fAset = root.createFolder('SIAKAD_ASET');
  var fExport = root.createFolder('SIAKAD_EXPORTS');
  var fBukti = root.createFolder('SIAKAD_BUKTI_BAYAR');
  var ss = SpreadsheetApp.create('🗃️ Database — ' + APP.NAME);
  DriveApp.getFileById(ss.getId()).moveTo(root);
  setProps_({
    SPREADSHEET_ID: ss.getId(), ROOT_FOLDER_ID: root.getId(), MATERI_FOLDER: fMateri.getId(),
    SELFIE_FOLDER: fSelfie.getId(), ASET_FOLDER: fAset.getId(), EXPORTS_FOLDER: fExport.getId(), BUKTI_FOLDER: fBukti.getId(),
    SCHEMA_VERSION: String(APP.SCHEMA_VERSION)
  });
  _SS = ss;
  var first = ss.getSheets()[0];
  Object.keys(SCHEMA).forEach(function (name) { createSheet_(ss, name); });
  ss.deleteSheet(first);
  // Config + catatan environment (Kelas B saja — bukan rahasia)
  DB.appendBatch('Config', CONFIG_SEED.map(function (r) { return { key: r[0], value: r[1], keterangan: r[2] }; }).concat([
    { key: 'ENV_ROOT_FOLDER_ID', value: root.getId(), keterangan: 'ID folder root Drive (catatan, baca-saja)' },
    { key: 'ENV_SPREADSHEET_ID', value: ss.getId(), keterangan: 'ID spreadsheet ini (catatan, baca-saja)' },
    { key: 'ENV_CREATED_AT', value: nowIso_(), keterangan: 'Tanggal setup' }
  ]));
  setupRahasia_();
  seedDemo_();
  pasangTrigger();
  Logger.log('✅ Setup selesai!');
  Logger.log('   Spreadsheet : ' + ss.getUrl());
  Logger.log('   Drive Folder: ' + root.getUrl());
  Logger.log('🔐 AKUN CONTOH (catat sekarang — hanya tampil SEKALI, segera ganti / hapus data contoh):');
  Logger.log('   Super Admin : admin@sekolah.sch.id / ' + demoPw_('sa'));
  Logger.log('   Guru        : guru@sekolah.sch.id / ' + demoPw_('guru'));
  Logger.log('   Siswa       : 20230101 / ' + demoPw_('siswa') + '   (siswa contoh lain: sandi = NIS)');
}

/** UPDATE v2.0 → v2.1 — jalankan SEKALI dari editor setelah menempel kode baru. Aman diulang. */
function setupV21() {
  resetMemo_();
  if (!prop_('SPREADSHEET_ID')) { Logger.log('⚠️ Belum ada setup. Jalankan setupAppEnvironment() dulu.'); return; }
  Logger.log('🔧 Update ke v' + APP.VERSION + ' ...');
  upgradeSchema(true);
  setupRahasia_();
  if (!prop_('BUKTI_FOLDER')) {
    try { var root = DriveApp.getFolderById(prop_('ROOT_FOLDER_ID')); setProp_('BUKTI_FOLDER', root.createFolder('SIAKAD_BUKTI_BAYAR').getId()); Logger.log('+ folder SIAKAD_BUKTI_BAYAR'); }
    catch (e) { Logger.log('⚠️ Folder bukti bayar gagal dibuat: ' + e.message + ' (bukti akan disimpan di SIAKAD_ASET)'); }
  }
  var dipindah = amankanSandi_();
  Logger.log('🔐 Hash sandi dipindahkan dari sheet ke Script Properties: ' + dipindah + ' akun');
  Logger.log('🧹 Hash akun yatim dibersihkan: ' + bersihkanPwYatim_());
  var lok = lokasiBawaan_();
  if (lok) Logger.log('📍 Lokasi bawaan dibuat dari LAT/LNG sekolah: ' + lok);
  var sa = ensureSuperAdmin_();
  if (sa) {
    Logger.log('👑 AKUN SUPER ADMIN BARU (catat sekarang — hanya tampil SEKALI, wajib ganti setelah login):');
    Logger.log('   Email : ' + sa.email);
    Logger.log('   Sandi : ' + sa.password);
  } else Logger.log('👑 Super Admin sudah ada (lupa sandi? jalankan resetSuperAdmin()).');
  ['master', 'absen', 'nilai', 'akun', 'adm', 'tagihan', 'notif'].forEach(function (s) { bump_(s); });
  pasangTrigger();
  Logger.log('🔥 Warmup: ' + warmCaches_('setup'));
  Logger.log('✅ Selesai. Lanjutkan: Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy.');
  cekPerforma();
}

/** Laporan kesehatan server (jalankan dari editor) */
function cekPerforma() {
  resetMemo_();
  var c = CacheService.getScriptCache(), out = [];
  function st(k) { return c.get(k) ? 'HANGAT' : 'dingin'; }
  out.push('Versi           : ' + APP.VERSION);
  out.push('Cache pengaturan: ' + st('cfg_' + ver_('master')));
  out.push('Cache akun      : ' + st('uidx_' + ver_('akun')));
  out.push('Cache boot guru : ' + st('bootG_' + versKey_()));
  out.push('Warmup terakhir : ' + (c.get('warm_last') || '-'));
  out.push('Warmup otomatis : ' + (prop_('KEEP_WARM') === 'off' ? 'DIMATIKAN (nyalakanKeepWarm untuk mengaktifkan)' : 'aktif (pekerjaMenit)'));
  var nq = CacheX.get('nq');
  out.push('Antrean notif   : cache ' + (nq ? nq.length : 0) + ' pesan · sheet ' + (propFresh_('ANTRIAN_ADA') === '1' ? 'ada antrean' : 'kosong'));
  out.push('Trigger         : ' + ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); }).join(', '));
  var all = PROPS.getProperties(), keys = Object.keys(all), size = 0, pw = 0;
  keys.forEach(function (k) { size += k.length + String(all[k]).length; if (k.indexOf('PW_') === 0) pw++; });
  out.push('Script Properties: ' + keys.length + ' kunci (' + pw + ' hash sandi), ±' + Math.round(size / 1024) + ' KB dari batas ±500 KB' + (size > 400000 ? ' ⚠️ hampir penuh' : ''));
  out.push('Secret sesi     : ' + (prop_('TOKEN_SECRET') ? 'ada' : 'BELUM') + ' · QR secret: ' + (prop_('QR_SECRET') ? 'ada' : 'BELUM') + ' · Token Fonnte: ' + (prop_('FONNTE_TOKEN') ? samarkan_(prop_('FONNTE_TOKEN')) : 'belum diisi'));
  Logger.log('📊 CEK PERFORMA\n   ' + out.join('\n   '));
  return out;
}

/** Upgrade aditif: sheet & kolom baru ditambahkan tanpa menyentuh data lama */
function upgradeSchema(diam) {
  var ss = getSS_();
  Object.keys(SCHEMA).forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) { createSheet_(ss, name); Logger.log('+ sheet ' + name); return; }
    var h = DB.headers_(sh), miss = SCHEMA[name].cols.filter(function (c) { return h.indexOf(c) === -1; });
    if (miss.length) { _COLS_OK[name] = 0; tambahKolom_(sh, name, h); Logger.log('+ kolom ' + name + ': ' + miss.join(', ')); }
  });
  var have = {}; DB.all('Config').forEach(function (r) { have[r.key] = 1; });
  DB.appendBatch('Config', CONFIG_SEED.filter(function (r) { return !have[r[0]]; }).map(function (r) { return { key: r[0], value: r[1], keterangan: r[2] }; }));
  setProp_('SCHEMA_VERSION', String(APP.SCHEMA_VERSION));
  bump_('master'); bump_('absen'); bump_('nilai');
  if (!diam) { pasangTrigger(); Logger.log('✅ Upgrade skema selesai.'); }
}

;
// ==== Akademik.gs ====
/**
 * =====================================================================
 *  SIAKAD SISWA v2.1 — File 2/7 : Akademik.gs
 *  Bootstrap per peran, data induk, jadwal, absensi (barcode/selfie/GPS),
 *  materi (Drive/YouTube), penilaian, laporan, data contoh.
 * =====================================================================
 */

var HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

// ---------------------------------------------------------------------
// A. BOOTSTRAP — satu panggilan untuk satu layar (cache per versi)
// ---------------------------------------------------------------------
function versKey_() { return ver_('master') + '_' + ver_('absen') + '_' + ver_('nilai') + '_' + today_(); }

function publicCfg_() {
  var c = settings_(), o = {};
  ['NAMA_SEKOLAH', 'ALAMAT_SEKOLAH', 'LOGO_URL', 'LAT_SEKOLAH', 'LNG_SEKOLAH', 'RADIUS_M', 'GPS_WAJIB_SCAN', 'JAM_MASUK', 'JAM_PULANG',
    'TAHUN_AJARAN', 'SEMESTER', 'SEMESTER_MULAI', 'SEMESTER_SELESAI', 'KKM', 'BOBOT_HARIAN', 'BOBOT_UTS', 'BOBOT_UAS', 'BATAS_KEHADIRAN',
    'MATERI_MAKS_MB', 'AUTO_ALPHA_JAM', 'EMAIL_DOMAIN_SISWA', 'GPS_TOLERANSI_M', 'JAM_MASUK_GURU', 'JAM_PULANG_GURU', 'KUNCI_PERANGKAT', 'PRESENSI_GURU_SELFIE',
    'REKENING_BANK'].forEach(function (k) { o[k] = c[k]; });
  o.demo = prop_('DEMO_SEEDED') === '1';
  extSemua_('cfg', o, c);                                   // v3.0: branding & pengaturan LMS publik
  o.today = today_();
  o.now = nowIso_();
  return o;
}

function siswaPublic_(s) {
  return { NIS: s.NIS, NISN: s.NISN, nama_lengkap: s.nama_lengkap, jenis_kelamin: s.jenis_kelamin, kelas_id: s.kelas_id, jenjang: s.jenjang,
    barcode_id: s.barcode_id, email: s.email, no_wa: s.no_wa, nama_ortu: s.nama_ortu, no_wa_ortu: s.no_wa_ortu, tempat_lahir: s.tempat_lahir,
    tanggal_lahir: s.tanggal_lahir, alamat: s.alamat, foto_profil_url: s.foto_profil_url, tahun_masuk: s.tahun_masuk, status: s.status, StatusWA: s.StatusWA };
}

/** Indeks absensi semester berjalan: hari efektif per kelas + rekap per siswa (memo & cache) */
var _ABS_IDX = null;
function absenIndex_() {
  if (_ABS_IDX) return _ABS_IDX;
  var key = 'absidx_' + ver_('absen') + '_' + ver_('master') + '_' + today_();
  var c = CacheX.get(key);
  if (c) return (_ABS_IDX = c);
  var mulai = setting_('SEMESTER_MULAI', '2000-01-01'), selesai = setting_('SEMESTER_SELESAI', '2999-12-31'), tdy = today_();
  var batasAkhir = selesai < tdy ? selesai : tdy;
  var hariKelas = {}, rekap = {}, daily = {};
  var siswa = DB.all('Siswa'), kelasOf = {};
  siswa.forEach(function (s) { kelasOf[s.NIS] = s.kelas_id; });
  DB.all('Absensi').forEach(function (a) {
    var t = String(a.tanggal);
    if (t < mulai || t > batasAkhir) return;
    var k = a.kelas_id || kelasOf[a.NIS] || '-';
    (hariKelas[k] = hariKelas[k] || {})[t] = 1;
    var r = rekap[a.NIS] = rekap[a.NIS] || { H: 0, I: 0, S: 0, A: 0, T: 0, n: 0 };
    var st = String(a.status || '').charAt(0).toUpperCase();
    if (r[st] !== undefined) r[st]++;
    if (st === 'H' && String(a.terlambat).toUpperCase() === 'YA') r.T++;
    r.n++;
    var d = daily[t] = daily[t] || { H: 0, I: 0, S: 0, A: 0 };
    if (d[st] !== undefined) d[st]++;
  });
  var hk = {}; Object.keys(hariKelas).forEach(function (k) { hk[k] = Object.keys(hariKelas[k]).sort(); });
  var out = {};
  siswa.forEach(function (s) {
    var r = rekap[s.NIS] || { H: 0, I: 0, S: 0, A: 0, T: 0, n: 0 };
    var hari = (hk[s.kelas_id] || []).length;
    var tanpaKet = Math.max(0, hari - r.n);
    out[s.NIS] = { H: r.H, I: r.I, S: r.S, A: r.A + tanpaKet, T: r.T, hari: hari, persen: hari ? round1_(r.H / hari * 100) : null };
  });
  var res = { rekap: out, daily: daily, hariKelas: hk, mulai: mulai };
  CacheX.put(key, res, 900);
  return (_ABS_IDX = res);
}

/** Tren kehadiran: 7 hari terakhir (harian) + 12 pekan (mingguan) */
function trendKehadiran_(idx, totalSiswa) {
  var hariIni = new Date(today_() + 'T00:00:00+07:00'), harian = [], pekan = {};
  for (var i = 6; i >= 0; i--) {
    var d = new Date(hariIni.getTime() - i * 864e5), t = Utilities.formatDate(d, APP.TZ, 'yyyy-MM-dd'), r = idx.daily[t];
    var tot = r ? r.H + r.I + r.S + r.A : 0;
    harian.push({ tanggal: t, hari: HARI[Number(Utilities.formatDate(d, APP.TZ, 'u')) % 7], H: r ? r.H : 0, I: r ? r.I : 0, S: r ? r.S : 0, A: r ? r.A : 0, persen: r && totalSiswa ? round1_(r.H / totalSiswa * 100) : null });
  }
  Object.keys(idx.daily).forEach(function (t) {
    var d = new Date(t + 'T00:00:00+07:00'), senin = new Date(d.getTime() - ((Number(Utilities.formatDate(d, APP.TZ, 'u')) + 6) % 7) * 864e5);
    var k = Utilities.formatDate(senin, APP.TZ, 'yyyy-MM-dd'), r = idx.daily[t], p = pekan[k] = pekan[k] || { H: 0, tot: 0, hari: 0, I: 0, S: 0, A: 0 };
    p.H += r.H; p.I += r.I; p.S += r.S; p.A += r.A; p.hari++;
  });
  var mingguan = Object.keys(pekan).sort().slice(-12).map(function (k, i) {
    var p = pekan[k], denom = totalSiswa * p.hari;
    return { pekan: k, label: 'Pekan ' + (i + 1), persen: denom ? round1_(p.H / denom * 100) : null, H: p.H, I: p.I, S: p.S, A: p.A };
  });
  return { harian: harian, mingguan: mingguan };
}

function predikat_(n) {
  var kkm = num_(setting_('KKM', 70), 70);
  if (n === '' || n === null || isNaN(n)) return '';
  if (n >= 90) return 'A';
  if (n >= 80) return 'B';
  if (n >= kkm) return 'C';
  return 'D';
}
function hitungAkhir_(h, u, a) {
  if (h === '' || u === '' || a === '') return '';
  var bh = num_(setting_('BOBOT_HARIAN', 40)), bu = num_(setting_('BOBOT_UTS', 30)), ba = num_(setting_('BOBOT_UAS', 30));
  var tot = bh + bu + ba || 100;
  return round1_((num_(h) * bh + num_(u) * bu + num_(a) * ba) / tot);
}
function nilaiAktif_() {
  var ta = setting_('TAHUN_AJARAN', ''), sem = setting_('SEMESTER', '');
  return DB.all('Nilai').filter(function (n) { return String(n.tahun_ajaran) === ta && String(n.semester) === sem; });
}

function apiGuruBootstrap(ctx, d) {
  var data = cached_('bootG_' + versKey_(), 600, buildGuruBootstrap_);
  var me = null, u = ctx.user || {};
  (data.guru || []).forEach(function (g) { if (ctx.session.ref && String(g.NUPTK) === String(ctx.session.ref)) me = g; });
  // bagian per-akun (di luar cache bersama): peran, hak, geofence, perangkat, presensi hari ini, lonceng
  var akun = Object.assign({ role: ctx.session.role, sa: ctx.session.role === 'superadmin', hak: String(u.h || ''), keu: isKeu_(ctx), terhubungGuru: !!me,
    presensiHariIni: me ? presensiHariIni_(ctx.session.uid) : null, notifBelum: notifBelum_(ctx.session.uid) }, lokasiInfo_(ctx));
  return ok_(Object.assign({}, data, { me: me || { nama_lengkap: u.n || ctx.session.email, email: ctx.session.email, jabatan: ROLES[ctx.session.role] }, role: 'guru', akun: akun }));
}

function buildGuruBootstrap_() {
  var cfg = publicCfg_(), tdy = cfg.today;
  var siswa = DB.all('Siswa').map(siswaPublic_);
  var aktif = siswa.filter(function (s) { return String(s.status || 'Aktif') === 'Aktif'; });
  var akunMap = {}; DB.all('Users').forEach(function (u) { if (u.role === 'siswa') akunMap[u.ref_id] = { status: u.status_aktif, last: u.last_login }; });
  siswa.forEach(function (s) { var a = akunMap[s.NIS]; s.akun = a ? a.status : ''; s.last_login = a ? a.last : ''; });
  var idx = absenIndex_();
  var absHariIni = DB.all('Absensi').filter(function (a) { return String(a.tanggal) === tdy; });
  var cnt = { H: 0, I: 0, S: 0, A: 0 };
  absHariIni.forEach(function (a) { var st = String(a.status).charAt(0).toUpperCase(); if (cnt[st] !== undefined) cnt[st]++; });
  var nilai = nilaiAktif_();
  var aksesCount = {};
  DB.all('MateriAkses').forEach(function (a) { aksesCount[a.materi_id] = (aksesCount[a.materi_id] || 0) + 1; });
  var materi = DB.all('Materi').filter(function (m) { return m.status !== 'Dihapus'; }).map(function (m) { return Object.assign({}, m, { akses: aksesCount[m.materi_id] || 0 }); });
  var batas = num_(setting_('BATAS_KEHADIRAN', 75));
  var perhatian = aktif.filter(function (s) { var r = idx.rekap[s.NIS]; return r && r.persen !== null && r.persen < batas; })
    .map(function (s) { var r = idx.rekap[s.NIS]; return { NIS: s.NIS, nama: s.nama_lengkap, kelas_id: s.kelas_id, persen: r.persen, absen: r.hari - r.H }; })
    .sort(function (a, b) { return a.persen - b.persen; });
  var rataKelas = {}, sumK = {};
  nilai.forEach(function (n) { if (n.nilai_akhir === '') return; var s = sumK[n.kelas_id] = sumK[n.kelas_id] || [0, 0]; s[0] += num_(n.nilai_akhir); s[1]++; });
  Object.keys(sumK).forEach(function (k) { rataKelas[k] = round1_(sumK[k][0] / sumK[k][1]); });
  var allN = nilai.filter(function (n) { return n.nilai_akhir !== ''; });
  var rata = allN.length ? round1_(allN.reduce(function (a, n) { return a + num_(n.nilai_akhir); }, 0) / allN.length) : null;
  return {
    cfg: cfg,
    kelas: DB.all('Kelas'), mapel: DB.all('Mapel'), guru: DB.all('Guru'), jadwal: DB.all('Jadwal'),
    siswa: siswa, materi: materi, nilai: nilai,
    pengumuman: DB.all('Pengumuman').filter(function (p) { return p.status !== 'Arsip'; }).sort(function (a, b) { return String(b.tanggal).localeCompare(String(a.tanggal)); }),
    absensiHariIni: absHariIni,
    rekapAbsen: idx.rekap, hariKelas: idx.hariKelas,
    trend: trendKehadiran_(idx, aktif.length),
    stats: {
      totalSiswa: aktif.length, L: aktif.filter(function (s) { return s.jenis_kelamin === 'L'; }).length,
      hadirHariIni: cnt.H, izinHariIni: cnt.I, sakitHariIni: cnt.S, alphaHariIni: cnt.A,
      persenHariIni: aktif.length ? round1_(cnt.H / aktif.length * 100) : 0,
      materiAktif: materi.length, rataNilai: rata, rataKelas: rataKelas,
      akunBelumAktif: siswa.filter(function (s) { return s.akun !== 'YA'; }).length
    },
    perhatian: perhatian
  };
}

function apiSiswaBootstrap(ctx, d) {
  var nis = String(ctx.session.ref);
  var data = cached_('bootS_' + versKey_() + '_' + nis, 600, function () { return buildSiswaBootstrap_(nis); });
  var akun = Object.assign({ role: 'siswa', tagihan: tgRingkasSiswa_(nis), notifBelum: notifBelum_(ctx.session.uid) }, lokasiInfo_(ctx));
  return ok_(Object.assign({}, data, { akun: akun }));
}

function buildSiswaBootstrap_(nis) {
  var s = DB.find('Siswa', 'NIS', nis);
  if (!s) throw new Error('Data siswa tidak ditemukan untuk akun ini.');
  var cfg = publicCfg_(), tdy = cfg.today, mulai = cfg.SEMESTER_MULAI;
  var kelas = DB.find('Kelas', 'kelas_id', s.kelas_id) || {};
  var guruMap = {}; DB.all('Guru').forEach(function (g) { guruMap[g.NUPTK] = g.nama_lengkap; });
  var riwayat = DB.all('Absensi').filter(function (a) { return String(a.NIS) === nis && String(a.tanggal) >= mulai; })
    .map(function (a) { return { absensi_id: a.absensi_id, tanggal: a.tanggal, jam: a.jam, status: a.status, metode: a.metode, jarak_m: a.jarak_m, terlambat: a.terlambat, keterangan: a.keterangan }; })
    .sort(function (a, b) { return String(b.tanggal + b.jam).localeCompare(String(a.tanggal + a.jam)); });
  var hariIni = riwayat.filter(function (a) { return a.tanggal === tdy; })[0] || null;
  var idx = absenIndex_();
  var viewed = {};
  DB.all('MateriAkses').forEach(function (a) { if (String(a.NIS) === nis) viewed[a.materi_id] = 1; });
  var materi = DB.all('Materi').filter(function (m) { return m.status !== 'Dihapus' && (!m.kelas_id || m.kelas_id === s.kelas_id); })
    .map(function (m) { return Object.assign({}, m, { guru: guruMap[m.guru_id] || '', dibaca: !!viewed[m.materi_id] }); })
    .sort(function (a, b) { return String(b.tanggal_upload).localeCompare(String(a.tanggal_upload)); });
  var jadwal = DB.all('Jadwal').filter(function (j) { return j.kelas_id === s.kelas_id; })
    .map(function (j) { return Object.assign({}, j, { guru: guruMap[j.guru_id] || '' }); });
  var nilaiAll = nilaiAktif_();
  var kelasNilai = nilaiAll.filter(function (n) { return n.kelas_id === s.kelas_id && n.nilai_akhir !== ''; });
  var rataMapel = {}, agg = {};
  kelasNilai.forEach(function (n) { var a = agg[n.mata_pelajaran] = agg[n.mata_pelajaran] || [0, 0]; a[0] += num_(n.nilai_akhir); a[1]++; });
  Object.keys(agg).forEach(function (k) { rataMapel[k] = round1_(agg[k][0] / agg[k][1]); });
  var perSiswa = {};
  kelasNilai.forEach(function (n) { var a = perSiswa[n.NIS] = perSiswa[n.NIS] || [0, 0]; a[0] += num_(n.nilai_akhir); a[1]++; });
  var ranking = Object.keys(perSiswa).map(function (k) { return { NIS: k, rata: perSiswa[k][0] / perSiswa[k][1] }; }).sort(function (a, b) { return b.rata - a.rata; });
  var rank = 0; ranking.forEach(function (r, i) { if (r.NIS === nis) rank = i + 1; });
  var nilai = DB.all('Nilai').filter(function (n) { return String(n.NIS) === nis; })
    .map(function (n) { return Object.assign({}, n, { guru: guruMap[n.guru_id] || '' }); });
  var wali = guruMap[kelas.wali_kelas_id] || '';
  return {
    role: 'siswa', cfg: cfg,
    profil: Object.assign(siswaPublic_(s), { nama_kelas: kelas.nama_kelas || s.kelas_id, wali_kelas: wali }),
    hariIni: hariIni, rekap: idx.rekap[nis] || { H: 0, I: 0, S: 0, A: 0, T: 0, hari: 0, persen: null },
    riwayat: riwayat, jadwal: jadwal, materi: materi, nilai: nilai,
    rataMapel: rataMapel, peringkat: rank, jumlahSiswaKelas: DB.all('Siswa').filter(function (x) { return x.kelas_id === s.kelas_id && (x.status || 'Aktif') === 'Aktif'; }).length,
    mapel: DB.all('Mapel'),
    pengumuman: DB.all('Pengumuman').filter(function (p) { return p.status !== 'Arsip'; }).sort(function (a, b) { return String(b.tanggal).localeCompare(String(a.tanggal)); }).slice(0, 10)
  };
}

// ---------------------------------------------------------------------
// B. DATA INDUK SISWA & GURU
// ---------------------------------------------------------------------
function uniqueEmail_(base, domain, exceptUid) {
  var used = {}; DB.all('Users').forEach(function (u) { if (u.user_id !== exceptUid) used[lower_(u.email)] = 1; });
  var e = base + '@' + domain, i = 2;
  while (used[e]) { e = base + i + '@' + domain; i++; }
  return e;
}

function apiSiswaSave(ctx, d) {
  var x = d.data || {}, isNew = !!d.isNew;
  var nis = String(x.NIS || '').trim();
  if (!/^[0-9A-Za-z.-]{3,20}$/.test(nis)) return fail_('NIS wajib diisi (3–20 karakter, angka/huruf).');
  if (!String(x.nama_lengkap || '').trim()) return fail_('Nama lengkap wajib diisi.');
  if (x.NISN && !/^\d{10}$/.test(String(x.NISN).trim())) return fail_('NISN harus 10 digit angka.');
  var kelas = DB.find('Kelas', 'kelas_id', x.kelas_id);
  if (!kelas) return fail_('Kelas / rombel belum dipilih atau tidak ditemukan.');
  var ada = DB.find('Siswa', 'NIS', nis);
  if (isNew && ada) return fail_('NIS ' + nis + ' sudah terdaftar atas nama ' + ada.nama_lengkap + '.');
  if (!isNew && !ada) return fail_('Data siswa tidak ditemukan.');
  if (x.no_wa_ortu && !hpValid_(x.no_wa_ortu)) return fail_('Nomor WhatsApp orang tua tidak valid (contoh: 0812xxxxxxx).');
  if (x.no_wa && !hpValid_(x.no_wa)) return fail_('Nomor WhatsApp siswa tidak valid.');
  var barcode = String(x.barcode_id || (ada && ada.barcode_id) || ('ID-' + nis)).trim();
  var bentrok = DB.all('Siswa').filter(function (s) { return s.NIS !== nis && String(s.barcode_id).toUpperCase() === barcode.toUpperCase(); })[0];
  if (bentrok) return fail_('Barcode ID sudah dipakai ' + bentrok.nama_lengkap + '.');
  var user = DB.all('Users').filter(function (u) { return u.role === 'siswa' && String(u.ref_id) === nis; })[0];
  var domain = setting_('EMAIL_DOMAIN_SISWA', 'siswa.sch.id');
  var email = lower_(x.email) || (user ? lower_(user.email) : uniqueEmail_(slug_(x.nama_lengkap).split('.').slice(0, 2).join('.') || nis, domain, ''));
  if (!emailValid_(email)) return fail_('Format email tidak valid.');
  var dupe = DB.all('Users').filter(function (u) { return lower_(u.email) === email && (!user || u.user_id !== user.user_id); })[0];
  if (dupe) return fail_('Email ' + email + ' sudah dipakai akun lain.');
  var foto = x.foto_profil_url || (ada && ada.foto_profil_url) || '';
  if (d.foto && d.foto.data) {
    var f = saveBase64File_(CONFIG.ASET_FOLDER, 'FOTO_' + nis + '.jpg', d.foto.mime || 'image/jpeg', d.foto.data);
    shareLink_(f);
    foto = 'https://drive.google.com/thumbnail?id=' + f.getId() + '&sz=w400';
  }
  var row = {
    NIS: nis, NISN: String(x.NISN || '').trim(), nama_lengkap: String(x.nama_lengkap).trim(), jenis_kelamin: x.jenis_kelamin === 'P' ? 'P' : 'L',
    kelas_id: kelas.kelas_id, jenjang: kelas.jenjang, barcode_id: barcode, email: email, no_wa: hp08_(x.no_wa), nama_ortu: x.nama_ortu || '',
    no_wa_ortu: hp08_(x.no_wa_ortu), tempat_lahir: x.tempat_lahir || '', tanggal_lahir: x.tanggal_lahir || '', alamat: x.alamat || '',
    foto_profil_url: foto, tahun_masuk: x.tahun_masuk || setting_('TAHUN_AJARAN', ''), status: x.status || (ada ? ada.status : 'Aktif') || 'Aktif'
  };
  var akun = null;
  if (isNew) {
    row.dibuat_pada = nowIso_(); row.StatusWA = ''; row.CekWAAt = '';
    DB.appendBatch('Siswa', [row]);
  } else {
    if (hp08_(ada.no_wa_ortu) !== row.no_wa_ortu) { row.StatusWA = ''; row.CekWAAt = ''; }
    DB.updateBatch('Siswa', 'NIS', [row]);
  }
  if (!user) {
    var pw = String(d.password || '').trim() || randomPassword_(8), salt = newSalt_();
    DB.appendBatch('Users', [{ user_id: reserveIds_('Users', 1)[0], nama: row.nama_lengkap, email: email, password_hash: hashPassword_(pw, salt), salt: salt,
      role: 'siswa', ref_id: nis, kelas_id: row.kelas_id, status_aktif: d.aktifkan === false ? 'TIDAK' : 'YA', wajib_ganti_sandi: 'YA', last_login: '', dibuat_pada: nowIso_() }]);
    akun = { email: email, password: pw };
    if (d.kirimKredensial) kirimNotif_('AKUN_DIBUAT', { nama: row.nama_lengkap, hp: row.no_wa_ortu || row.no_wa, email: email }, { username: email, sandi: pw, nis: nis }, nis);
  } else {
    var patch = { user_id: user.user_id, nama: row.nama_lengkap, email: email, kelas_id: row.kelas_id };
    if (d.password) { var s2 = newSalt_(); patch.password_hash = hashPassword_(d.password, s2); patch.salt = s2; patch.wajib_ganti_sandi = 'YA'; akun = { email: email, password: d.password }; }
    DB.updateBatch('Users', 'user_id', [patch]);
  }
  bump_('master');
  if (typeof crmUpsertSatu_ === 'function') { try { crmUpsertSatu_('siswa', row); crmUpsertSatu_('ortu', row); } catch (e) {} }
  return ok_({ siswa: siswaPublic_(row), akun: akun }, isNew ? 'Siswa ' + row.nama_lengkap + ' berhasil didaftarkan.' : 'Data siswa diperbarui.');
}

function apiSiswaDelete(ctx, d) {
  var nis = String(d.NIS || '');
  var s = DB.find('Siswa', 'NIS', nis);
  if (!s) return fail_('Siswa tidak ditemukan.');
  DB.deleteWhere('Siswa', 'NIS', [nis]);
  var u = DB.all('Users').filter(function (x) { return x.role === 'siswa' && String(x.ref_id) === nis; });
  if (u.length) DB.deleteWhere('Users', 'user_id', u.map(function (x) { return x.user_id; }));
  bump_('master'); bump_('absen');
  return ok_(null, 'Siswa ' + s.nama_lengkap + ' dihapus. Riwayat absensi & nilai tetap tersimpan.');
}

function apiSiswaResetPassword(ctx, d) {
  var u = DB.all('Users').filter(function (x) { return String(x.ref_id) === String(d.NIS || d.NUPTK) && (d.NUPTK ? x.role !== 'siswa' : x.role === 'siswa'); })[0];
  if (!u) return fail_('Akun tidak ditemukan.');
  var pw = String(d.password || '').trim() || randomPassword_(8), salt = newSalt_();
  DB.updateBatch('Users', 'user_id', [{ user_id: u.user_id, password_hash: hashPassword_(pw, salt), salt: salt, wajib_ganti_sandi: 'YA', status_aktif: 'YA' }]);
  revokeAll_(lower_(u.email));
  if (d.kirim) kirimNotif_('RESET_SANDI_ADMIN', kontakUser_(u), { username: u.email, sandi: pw }, u.user_id);
  bump_('master');
  return ok_({ email: u.email, password: pw }, 'Password baru dibuat untuk ' + u.nama + '.');
}

function apiSiswaBulk(ctx, d) {
  var nis = (d.nis || []).map(String), aksi = d.aksi;
  if (!nis.length) return fail_('Belum ada siswa yang dipilih.');
  if ((aksi === 'aktivasi' || aksi === 'nonaktifkanAkun' || aksi === 'hapus') && !isSA_(ctx)) return fail_('Aktivasi akun & hapus massal hanya untuk Super Admin.', { code: 'FORBIDDEN' });
  var set = {}; nis.forEach(function (n) { set[n] = 1; });
  if (aksi === 'aktivasi' || aksi === 'nonaktifkanAkun') {
    var up = DB.all('Users').filter(function (u) { return u.role === 'siswa' && set[u.ref_id]; }).map(function (u) { return { user_id: u.user_id, status_aktif: aksi === 'aktivasi' ? 'YA' : 'TIDAK' }; });
    DB.updateBatch('Users', 'user_id', up);
  } else if (aksi === 'pindahKelas') {
    var k = DB.find('Kelas', 'kelas_id', d.nilai); if (!k) return fail_('Kelas tujuan tidak ditemukan.');
    DB.updateBatch('Siswa', 'NIS', nis.map(function (n) { return { NIS: n, kelas_id: k.kelas_id, jenjang: k.jenjang }; }));
    DB.updateBatch('Users', 'user_id', DB.all('Users').filter(function (u) { return u.role === 'siswa' && set[u.ref_id]; }).map(function (u) { return { user_id: u.user_id, kelas_id: k.kelas_id }; }));
  } else if (aksi === 'status') {
    if (['Aktif', 'Nonaktif', 'Lulus', 'Pindah'].indexOf(d.nilai) === -1) return fail_('Status tidak valid.');
    DB.updateBatch('Siswa', 'NIS', nis.map(function (n) { return { NIS: n, status: d.nilai }; }));
  } else if (aksi === 'hapus') {
    DB.deleteWhere('Siswa', 'NIS', nis);
    DB.deleteWhere('Users', 'user_id', DB.all('Users').filter(function (u) { return u.role === 'siswa' && set[u.ref_id]; }).map(function (u) { return u.user_id; }));
  } else return fail_('Aksi massal tidak dikenal.');
  bump_('master'); bump_('absen');
  return ok_({ n: nis.length }, 'Aksi massal diterapkan ke ' + nis.length + ' siswa.');
}

function apiGuruSave(ctx, d) {
  var x = d.data || {}, isNew = !!d.isNew, id = String(x.NUPTK || '').trim();
  if (!/^[0-9A-Za-z.-]{3,24}$/.test(id)) return fail_('NUPTK / NIP wajib diisi (3–24 karakter).');
  if (!String(x.nama_lengkap || '').trim()) return fail_('Nama guru wajib diisi.');
  var email = lower_(x.email);
  if (!emailValid_(email)) return fail_('Email guru wajib diisi dengan format benar.');
  if (x.no_wa && !hpValid_(x.no_wa)) return fail_('Nomor WhatsApp tidak valid.');
  var ada = DB.find('Guru', 'NUPTK', id);
  if (isNew && ada) return fail_('NUPTK sudah terdaftar.');
  if (!isNew && !ada) return fail_('Guru tidak ditemukan.');
  var user = DB.all('Users').filter(function (u) { return u.role !== 'siswa' && String(u.ref_id) === id; })[0];
  var dupe = DB.all('Users').filter(function (u) { return lower_(u.email) === email && (!user || u.user_id !== user.user_id); })[0];
  if (dupe) return fail_('Email sudah dipakai akun lain.');
  var row = { NUPTK: id, nama_lengkap: String(x.nama_lengkap).trim(), email: email, no_wa: hp08_(x.no_wa), mata_pelajaran: x.mata_pelajaran || '', jabatan: x.jabatan || 'Guru', foto_profil_url: x.foto_profil_url || '', status: x.status || 'Aktif' };
  if (isNew) { row.dibuat_pada = nowIso_(); DB.appendBatch('Guru', [row]); } else DB.updateBatch('Guru', 'NUPTK', [row]);
  var akun = null;
  if (!user) {
    var pw = String(d.password || '').trim() || randomPassword_(8), salt = newSalt_();
    DB.appendBatch('Users', [{ user_id: reserveIds_('Users', 1)[0], nama: row.nama_lengkap, email: email, password_hash: hashPassword_(pw, salt), salt: salt, role: 'guru', ref_id: id, kelas_id: '', status_aktif: 'YA', wajib_ganti_sandi: 'YA', last_login: '', dibuat_pada: nowIso_() }]);
    akun = { email: email, password: pw };
    if (d.kirimKredensial) kirimNotif_('AKUN_DIBUAT', { nama: row.nama_lengkap, hp: row.no_wa, email: email }, { username: email, sandi: pw, nis: id }, id);
  } else {
    var pu = { user_id: user.user_id, nama: row.nama_lengkap, email: email };
    if (user.role === 'guru') pu.status_aktif = row.status === 'Aktif' ? 'YA' : 'TIDAK';    // akun Super Admin tidak ikut dinonaktifkan
    DB.updateBatch('Users', 'user_id', [pu]);
    if (lower_(user.email) !== email || pu.status_aktif === 'TIDAK') revokeAll_(lower_(user.email));
  }
  bump_('master');
  return ok_({ guru: row, akun: akun }, isNew ? 'Guru ditambahkan.' : 'Data guru diperbarui.');
}

function apiGuruDelete(ctx, d) {
  var id = String(d.NUPTK || '');
  if (id === String(ctx.session.ref)) return fail_('Tidak bisa menghapus akun Anda sendiri.');
  var g = DB.find('Guru', 'NUPTK', id); if (!g) return fail_('Guru tidak ditemukan.');
  var akun = DB.all('Users').filter(function (u) { return u.role !== 'siswa' && String(u.ref_id) === id; });
  if (akun.some(function (u) { return u.role === 'superadmin'; })) return fail_('Guru ini juga Super Admin. Turunkan perannya dulu di menu Kelola Akun.');
  DB.deleteWhere('Guru', 'NUPTK', [id]);
  akun.forEach(function (u) { revokeAll_(lower_(u.email)); });
  DB.deleteWhere('Users', 'user_id', akun.map(function (u) { return u.user_id; }));
  bump_('master');
  return ok_(null, 'Guru ' + g.nama_lengkap + ' dihapus.');
}

// ---------------------------------------------------------------------
// C. MASTER GENERIK: Kelas, Mapel, Jadwal, Pengumuman
// ---------------------------------------------------------------------
var MASTER_SHEETS = { Kelas: 1, Mapel: 1, Jadwal: 1, Pengumuman: 1 };
function toMin_(hhmm) { var p = String(hhmm || '').split(':'); return Number(p[0]) * 60 + Number(p[1] || 0); }

function apiMasterSave(ctx, d) {
  var sheet = d.sheet, x = Object.assign({}, d.row || {});
  if (!MASTER_SHEETS[sheet]) return fail_('Data tidak dikenal.');
  var key = SCHEMA[sheet].key, isNew = !x[key];
  if (sheet === 'Kelas') {
    if (!String(x.nama_kelas || '').trim()) return fail_('Nama kelas wajib diisi.');
    if (['SD', 'SMP', 'SMA'].indexOf(x.jenjang) === -1) return fail_('Jenjang harus SD, SMP, atau SMA.');
    x.tahun_ajaran = x.tahun_ajaran || setting_('TAHUN_AJARAN', '');
  } else if (sheet === 'Mapel') {
    if (!String(x.nama || '').trim()) return fail_('Nama mata pelajaran wajib diisi.');
    var dup = DB.all('Mapel').filter(function (m) { return lower_(m.nama) === lower_(x.nama) && m.mapel_id !== x.mapel_id; })[0];
    if (dup) return fail_('Mata pelajaran sudah ada.');
  } else if (sheet === 'Jadwal') {
    if (!x.kelas_id || !x.mata_pelajaran || !x.hari || !x.jam_mulai || !x.jam_selesai) return fail_('Kelas, mapel, hari, jam mulai & selesai wajib diisi.');
    if (toMin_(x.jam_selesai) <= toMin_(x.jam_mulai)) return fail_('Jam selesai harus setelah jam mulai.');
    var a1 = toMin_(x.jam_mulai), a2 = toMin_(x.jam_selesai);
    var konflik = DB.all('Jadwal').filter(function (j) {
      if (j.jadwal_id === x.jadwal_id || j.hari !== x.hari) return false;
      var overlap = toMin_(j.jam_mulai) < a2 && a1 < toMin_(j.jam_selesai);
      return overlap && (j.kelas_id === x.kelas_id || (x.guru_id && j.guru_id === x.guru_id) || (x.ruang && lower_(j.ruang) === lower_(x.ruang)));
    })[0];
    if (konflik) return fail_('Jadwal bentrok dengan ' + konflik.mata_pelajaran + ' (' + konflik.hari + ' ' + konflik.jam_mulai + '–' + konflik.jam_selesai + ', ' + konflik.kelas_id + (konflik.ruang ? ', ' + konflik.ruang : '') + ').');
  } else if (sheet === 'Pengumuman') {
    if (!String(x.judul || '').trim() || !String(x.isi || '').trim()) return fail_('Judul dan isi pengumuman wajib diisi.');
    x.tanggal = x.tanggal || nowIso_(); x.oleh = x.oleh || ctx.session.email; x.status = x.status || 'Aktif'; x.kategori = x.kategori || 'Akademik';
  }
  var cols = SCHEMA[sheet].cols, row = {};
  cols.forEach(function (c) { if (x[c] !== undefined) row[c] = x[c]; });
  if (isNew) { row[key] = reserveIds_(sheet, 1)[0]; DB.appendBatch(sheet, [row]); }
  else { if (!DB.find(sheet, key, row[key])) return fail_('Data tidak ditemukan.'); DB.updateBatch(sheet, key, [row]); }
  if (sheet === 'Pengumuman' && isNew && d.kirimNotif) {
    var penerima = DB.all('Siswa').filter(function (s) { return (s.status || 'Aktif') === 'Aktif'; }).map(function (s) { return { penerima: { nama: s.nama_lengkap, hp: s.no_wa_ortu || s.no_wa, email: s.email }, vars: { judul: row.judul, isi: row.isi }, refId: row[key] }; });
    kirimNotifBatch_('PENGUMUMAN', penerima);
  }
  bump_('master');
  return ok_(row, 'Data ' + sheet.toLowerCase() + ' tersimpan.');
}

function apiMasterDelete(ctx, d) {
  var sheet = d.sheet; if (!MASTER_SHEETS[sheet]) return fail_('Data tidak dikenal.');
  var key = SCHEMA[sheet].key, id = String(d.id || '');
  if (sheet === 'Kelas' && DB.all('Siswa').some(function (s) { return s.kelas_id === id; })) return fail_('Kelas masih memiliki siswa. Pindahkan siswa terlebih dahulu.');
  var n = DB.deleteWhere(sheet, key, [id]);
  if (!n) return fail_('Data tidak ditemukan.');
  bump_('master');
  return ok_(null, 'Data dihapus.');
}

var CONFIG_EDITABLE = /^(NAMA_SEKOLAH|ALAMAT_SEKOLAH|LOGO_URL|LAT_SEKOLAH|LNG_SEKOLAH|RADIUS_M|GPS_WAJIB_SCAN|GPS_TOLERANSI_M|JAM_MASUK|JAM_PULANG|AUTO_ALPHA_JAM|TAHUN_AJARAN|SEMESTER|SEMESTER_MULAI|SEMESTER_SELESAI|KKM|BOBOT_HARIAN|BOBOT_UTS|BOBOT_UAS|BATAS_KEHADIRAN|EMAIL_DOMAIN_SISWA|MATERI_MAKS_MB|JAM_MASUK_GURU|JAM_PULANG_GURU|KUNCI_PERANGKAT|PRESENSI_GURU_SELFIE)$/;
function apiConfigGet(ctx, d) {
  var ket = {}; CONFIG_SEED.forEach(function (r) { ket[r[0]] = r[2]; });
  var s = settings_();
  return ok_(Object.keys(s).filter(function (k) { return CONFIG_EDITABLE.test(k); }).map(function (k) { return { key: k, value: s[k], keterangan: ket[k] || '' }; }));
}
function apiConfigSave(ctx, d) {
  var p = d.pairs || {}, clean = {};
  Object.keys(p).forEach(function (k) { if (CONFIG_EDITABLE.test(k)) clean[k] = String(p[k]).trim(); });
  if (clean.LAT_SEKOLAH !== undefined && (isNaN(Number(clean.LAT_SEKOLAH)) || Math.abs(Number(clean.LAT_SEKOLAH)) > 90)) return fail_('Latitude tidak valid.');
  if (clean.LNG_SEKOLAH !== undefined && (isNaN(Number(clean.LNG_SEKOLAH)) || Math.abs(Number(clean.LNG_SEKOLAH)) > 180)) return fail_('Longitude tidak valid.');
  if (clean.RADIUS_M !== undefined && !(Number(clean.RADIUS_M) >= 10 && Number(clean.RADIUS_M) <= 5000)) return fail_('Radius harus 10–5000 meter.');
  var bh = num_(clean.BOBOT_HARIAN !== undefined ? clean.BOBOT_HARIAN : setting_('BOBOT_HARIAN', 40)),
      bu = num_(clean.BOBOT_UTS !== undefined ? clean.BOBOT_UTS : setting_('BOBOT_UTS', 30)),
      ba = num_(clean.BOBOT_UAS !== undefined ? clean.BOBOT_UAS : setting_('BOBOT_UAS', 30));
  if (bh + bu + ba !== 100) return fail_('Total bobot Harian + UTS + UAS harus 100%.');
  var jamSalah = false;
  ['JAM_MASUK', 'JAM_PULANG', 'AUTO_ALPHA_JAM', 'JAM_MASUK_GURU', 'JAM_PULANG_GURU'].forEach(function (k) { if (clean[k] && !/^\d{2}:\d{2}$/.test(clean[k])) jamSalah = true; });
  if (jamSalah) return fail_('Format jam harus HH:mm (contoh 07:15).');
  ['GPS_WAJIB_SCAN', 'KUNCI_PERANGKAT', 'PRESENSI_GURU_SELFIE'].forEach(function (k) { if (clean[k] !== undefined) clean[k] = clean[k] === 'YA' ? 'YA' : 'TIDAK'; });
  if (clean.GPS_TOLERANSI_M !== undefined && !(Number(clean.GPS_TOLERANSI_M) >= 0 && Number(clean.GPS_TOLERANSI_M) <= 100)) return fail_('Toleransi GPS 0–100 meter.');
  saveSettings_(clean);
  bump_('absen'); bump_('nilai');
  return ok_(publicCfg_(), 'Pengaturan disimpan.');
}

// ---------------------------------------------------------------------
// D. ABSENSI
// ---------------------------------------------------------------------
/* cekLokasi_ (multi-lokasi) ada di Admin.gs */
function terlambat_(jam) { return jam.substring(0, 5) > setting_('JAM_MASUK', '07:15') ? 'YA' : 'TIDAK'; }

function catatHadir_(s, metode, lat, lng, jarak, fotoId, oleh, ket, extra) {
  extra = extra || {};
  var tdy = today_(), jam = timeNow_();
  var ada = DB.all('Absensi').filter(function (a) { return String(a.NIS) === String(s.NIS) && String(a.tanggal) === tdy; })[0];
  if (ada && String(ada.status) === 'Hadir') return { duplikat: true, row: ada };
  var row = { NIS: s.NIS, kelas_id: s.kelas_id, tanggal: tdy, jam: jam, status: 'Hadir', metode: metode, latitude: lat === undefined ? '' : lat, longitude: lng === undefined ? '' : lng,
    jarak_m: jarak === null || jarak === undefined ? '' : jarak, foto_selfie_id: fotoId || '', keterangan: ket || (ada ? 'Sebelumnya: ' + ada.status : ''), terlambat: terlambat_(jam), dicatat_oleh: oleh, dibuat_pada: nowIso_(),
    lokasi_id: extra.lokasi_id || '', device_id: extra.device_id || '' };
  if (ada) { row.absensi_id = ada.absensi_id; DB.updateBatch('Absensi', 'absensi_id', [row]); }
  else { row.absensi_id = reserveIds_('Absensi', 1)[0]; DB.appendBatch('Absensi', [row]); }
  bump_('absen');
  kirimNotif_('ABSEN_HADIR', { nama: s.nama_lengkap, hp: s.no_wa_ortu, email: s.email },
    { jam: jam.substring(0, 5), metode: metodeLabel_(metode), tanggal: tanggalIndo_(tdy), status: row.terlambat === 'YA' ? 'Hadir (terlambat)' : 'Hadir tepat waktu' }, row.absensi_id);
  return { duplikat: false, row: row };
}
function metodeLabel_(m) { return { barcode: 'Scan Barcode', selfie: 'Selfie + GPS', lokasi: 'Lokasi GPS', manual: 'Input Guru' }[m] || m; }
function tanggalIndo_(t) {
  var bln = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  var p = String(t).split('-'); return Number(p[2]) + ' ' + bln[Number(p[1]) - 1] + ' ' + p[0];
}
function ringkasHariIni_() {
  var tdy = today_(), c = { H: 0, I: 0, S: 0, A: 0 };
  DB.all('Absensi').forEach(function (a) { if (String(a.tanggal) === tdy) { var st = String(a.status).charAt(0).toUpperCase(); if (c[st] !== undefined) c[st]++; } });
  return c;
}

function apiAbsenScan(ctx, d) {
  var kode = String(d.barcode || '').trim();
  if (!kode) return fail_('Barcode kosong.');
  var up = kode.toUpperCase().replace(/-SIAKAD-SECURE$/, '');
  var s = DB.all('Siswa').filter(function (x) { return String(x.barcode_id).toUpperCase() === up || String(x.NIS) === kode || ('ID-' + x.NIS) === up; })[0];
  if (!s) return fail_('Barcode "' + kode + '" tidak terdaftar.', { code: 'NOT_FOUND' });
  if ((s.status || 'Aktif') !== 'Aktif') return fail_(s.nama_lengkap + ' berstatus ' + s.status + '.');
  var lok = { ok: true, jarak: null };
  if (setting_('GPS_WAJIB_SCAN', 'YA') === 'YA') {
    lok = cekLokasi_(d.lat, d.lng, { peran: 'guru', user: ctx.user, acc: d.acc });
    if (!lok.ok) return fail_(lok.msg, { code: 'OUT_OF_RANGE', jarak: lok.jarak });
  }
  var r = catatHadir_(s, 'barcode', d.lat, d.lng, lok.jarak, '', ctx.session.email, d.sesi || '', { lokasi_id: lok.lokasi_id || '' });
  var kelas = DB.find('Kelas', 'kelas_id', s.kelas_id) || {};
  return ok_({ duplikat: r.duplikat, row: r.row, siswa: { NIS: s.NIS, nama: s.nama_lengkap, kelas: kelas.nama_kelas || s.kelas_id, foto: s.foto_profil_url }, jarak: lok.jarak, ringkas: ringkasHariIni_() },
    r.duplikat ? s.nama_lengkap + ' sudah tercatat hadir pukul ' + String(r.row.jam).substring(0, 5) + '.' : '✅ ' + s.nama_lengkap + ' berhasil diabsen.');
}

function apiAbsenSelf(ctx, d) {
  var s = DB.find('Siswa', 'NIS', ctx.session.ref);
  if (!s) return fail_('Data siswa tidak ditemukan.');
  var metode = d.metode === 'selfie' ? 'selfie' : 'lokasi';
  var ada = DB.all('Absensi').filter(function (a) { return String(a.NIS) === String(s.NIS) && String(a.tanggal) === today_() && a.status === 'Hadir'; })[0];
  if (ada) return fail_('Anda sudah absen hari ini pukul ' + String(ada.jam).substring(0, 5) + '.', { code: 'DUPLICATE', row: ada });
  var dev = cekPerangkat_(ctx, d.device_info);
  if (!dev.ok) return fail_(dev.msg, { code: 'DEVICE' });
  var lok = cekLokasi_(d.lat, d.lng, { peran: 'siswa', user: ctx.user, acc: d.acc });
  if (!lok.ok) return fail_(lok.msg.indexOf('tidak sesuai') > -1 ? 'Anda berada di luar area sekolah (' + lok.jarak + ' m dari ' + lok.nama + ', maks ' + lok.radius + ' m).' : lok.msg, { code: 'OUT_OF_RANGE', jarak: lok.jarak, lokasi: lok.nama });
  var fotoId = '';
  if (metode === 'selfie') {
    if (!d.foto) return fail_('Foto selfie belum diambil.');
    if (String(d.foto).length > 3 * 1024 * 1024) return fail_('Ukuran foto terlalu besar.');
    var nama = s.NIS + '_' + today_().replace(/-/g, '') + '_' + timeNow_().replace(/:/g, '') + '.jpg';
    fotoId = saveBase64File_(CONFIG.SELFIE_FOLDER, nama, 'image/jpeg', d.foto).getId();
  }
  var r = catatHadir_(s, metode, d.lat, d.lng, lok.jarak, fotoId, s.email || ctx.session.email, '', { lokasi_id: lok.lokasi_id, device_id: ctx.dev });
  return ok_({ row: r.row, jarak: lok.jarak, lokasi: lok.nama, perangkatBaru: !!dev.baru }, 'Absensi berhasil! Tercatat Hadir pukul ' + String(r.row.jam).substring(0, 5) + ' WIB di ' + lok.nama + '.');
}

var STATUS_ABSEN = { Hadir: 1, Izin: 1, Sakit: 1, Alpha: 1 };
function apiAbsenManual(ctx, d) {
  var tgl = d.tanggal || today_(), items = d.items || [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tgl)) return fail_('Tanggal tidak valid.');
  if (tgl > today_()) return fail_('Tidak bisa mengisi absensi untuk tanggal yang akan datang.');
  var sMap = {}; DB.all('Siswa').forEach(function (s) { sMap[s.NIS] = s; });
  var idx = {}; DB.all('Absensi').forEach(function (a) { if (String(a.tanggal) === tgl) idx[a.NIS] = a; });
  var ins = [], upd = [], notif = { Alpha: [], Izin: [], Sakit: [] };
  for (var i = 0; i < items.length; i++) {
    var it = items[i], s = sMap[String(it.NIS)];
    if (!s) return fail_('Siswa ' + it.NIS + ' tidak ditemukan.');
    if (!STATUS_ABSEN[it.status]) return fail_('Status harus Hadir, Izin, Sakit, atau Alpha.');
    var ex = idx[s.NIS];
    var row = { NIS: s.NIS, kelas_id: s.kelas_id, tanggal: tgl, jam: ex && ex.jam ? ex.jam : (tgl === today_() ? timeNow_() : '07:00:00'), status: it.status,
      metode: ex && ex.status === 'Hadir' && it.status === 'Hadir' ? ex.metode : 'manual', keterangan: it.keterangan || '', dicatat_oleh: ctx.session.email,
      terlambat: it.status === 'Hadir' ? (ex && ex.terlambat ? ex.terlambat : 'TIDAK') : '', dibuat_pada: nowIso_() };
    if (ex) { row.absensi_id = ex.absensi_id; upd.push(row); } else ins.push(row);
    if (notif[it.status] && (!ex || ex.status !== it.status)) notif[it.status].push(s);
  }
  var ids = reserveIds_('Absensi', ins.length); ins.forEach(function (r, j) { r.absensi_id = ids[j]; });
  DB.appendBatch('Absensi', ins); DB.updateBatch('Absensi', 'absensi_id', upd);
  bump_('absen');
  var tglI = tanggalIndo_(tgl);
  kirimNotifBatch_('ABSEN_ALPHA', notif.Alpha.map(function (s) { return { penerima: { nama: s.nama_lengkap, hp: s.no_wa_ortu, email: s.email }, vars: { tanggal: tglI }, refId: s.NIS }; }));
  kirimNotifBatch_('ABSEN_IZIN_SAKIT', notif.Izin.concat(notif.Sakit).map(function (s) { return { penerima: { nama: s.nama_lengkap, hp: s.no_wa_ortu, email: s.email }, vars: { tanggal: tglI, status: notif.Izin.indexOf(s) > -1 ? 'Izin' : 'Sakit' }, refId: s.NIS }; }));
  return ok_({ ditambah: ins.length, diperbarui: upd.length, ringkas: ringkasHariIni_() }, 'Absensi ' + (ins.length + upd.length) + ' siswa disimpan.');
}

/** Tandai siswa aktif tanpa catatan pada tanggal tsb sebagai Alpha */
function apiAbsenFinalize(ctx, d) {
  var tgl = d.tanggal || today_();
  var sudah = {}; DB.all('Absensi').forEach(function (a) { if (String(a.tanggal) === tgl) sudah[a.NIS] = 1; });
  var target = DB.all('Siswa').filter(function (s) { return (s.status || 'Aktif') === 'Aktif' && !sudah[s.NIS] && (!d.kelas_id || s.kelas_id === d.kelas_id); });
  if (!target.length) return ok_({ n: 0 }, 'Semua siswa sudah memiliki catatan absensi.');
  return apiAbsenManual(ctx, { tanggal: tgl, items: target.map(function (s) { return { NIS: s.NIS, status: 'Alpha', keterangan: 'Tanpa keterangan (otomatis)' }; }) });
}
function autoAlphaCek_() {
  var jam = setting_('AUTO_ALPHA_JAM', ''); if (!jam) return;
  var tdy = today_(), dow = Number(Utilities.formatDate(new Date(), APP.TZ, 'u'));
  if (dow > 5 || propFresh_('AUTO_ALPHA_DONE') === tdy || timeNow_().substring(0, 5) < jam) return;
  var adaHadir = DB.all('Absensi').some(function (a) { return String(a.tanggal) === tdy && a.status === 'Hadir'; });
  setProp_('AUTO_ALPHA_DONE', tdy);
  if (!adaHadir) return;                                   // hari libur → tidak ditandai
  apiAbsenFinalize({ session: { email: 'SYSTEM', role: 'guru' } }, { tanggal: tdy });
  bump_('adm', true);
}

function apiAbsenList(ctx, d) {
  var dari = d.dari || today_(), sampai = d.sampai || dari;
  var sMap = {}; DB.all('Siswa').forEach(function (s) { sMap[s.NIS] = s; });
  var rows = DB.all('Absensi').filter(function (a) {
    var t = String(a.tanggal);
    return t >= dari && t <= sampai && (!d.kelas_id || a.kelas_id === d.kelas_id) && (!d.NIS || String(a.NIS) === String(d.NIS));
  }).map(function (a) { var s = sMap[a.NIS] || {}; return Object.assign({}, a, { nama: s.nama_lengkap || '(dihapus)' }); })
    .sort(function (a, b) { return String(b.tanggal + b.jam).localeCompare(String(a.tanggal + a.jam)); });
  return ok_({ rows: rows.slice(0, 5000), total: rows.length, dari: dari, sampai: sampai });
}

function apiAbsenFoto(ctx, d) {
  var a = DB.find('Absensi', 'absensi_id', d.absensi_id);
  if (!a || !a.foto_selfie_id) return fail_('Foto tidak tersedia.');
  var k = 'foto_' + a.foto_selfie_id, c = CacheX.get(k);
  if (c) return ok_(c);
  var b = DriveApp.getFileById(a.foto_selfie_id).getBlob();
  var url = 'data:' + b.getContentType() + ';base64,' + Utilities.base64Encode(b.getBytes());
  CacheX.put(k, url, 21600);
  return ok_(url);
}

// ---------------------------------------------------------------------
// E. MATERI
// ---------------------------------------------------------------------
function youtubeId_(url) {
  var m = String(url || '').match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/))([A-Za-z0-9_-]{11})/);
  return m ? m[1] : (/^[A-Za-z0-9_-]{11}$/.test(String(url).trim()) ? String(url).trim() : '');
}
function driveId_(url) { var m = String(url || '').match(/\/d\/([A-Za-z0-9_-]{20,})/) || String(url || '').match(/[?&]id=([A-Za-z0-9_-]{20,})/); return m ? m[1] : ''; }

function apiMateriSave(ctx, d) {
  var x = d.data || {}, isNew = !x.materi_id;
  if (!String(x.judul || '').trim()) return fail_('Judul materi wajib diisi.');
  if (!x.mata_pelajaran) return fail_('Mata pelajaran wajib dipilih.');
  var tipe = x.tipe === 'video' ? 'video' : 'dokumen';
  var ada = isNew ? null : DB.find('Materi', 'materi_id', x.materi_id);
  if (!isNew && !ada) return fail_('Materi tidak ditemukan.');
  var row = { judul: String(x.judul).trim(), deskripsi: x.deskripsi || '', mata_pelajaran: x.mata_pelajaran, kelas_id: x.kelas_id || '', guru_id: x.guru_id || ctx.session.ref,
    tipe: tipe, url_konten: ada ? ada.url_konten : '', drive_file_id: ada ? ada.drive_file_id : '', ukuran: ada ? ada.ukuran : '', durasi: x.durasi || (ada ? ada.durasi : ''), status: 'Aktif' };
  if (tipe === 'video') {
    var yid = youtubeId_(x.url_konten);
    if (!yid) return fail_('URL YouTube tidak valid. Contoh: https://www.youtube.com/watch?v=XXXXXXXXXXX');
    row.url_konten = 'https://www.youtube.com/embed/' + yid; row.drive_file_id = ''; row.ukuran = '';
  } else if (d.file && d.file.data) {
    var maks = num_(setting_('MATERI_MAKS_MB', 20), 20) * 1024 * 1024;
    var bytesLen = Math.floor(String(d.file.data).replace(/^data:[^,]+,/, '').length * 3 / 4);
    if (bytesLen > maks) return fail_('Ukuran file melebihi ' + setting_('MATERI_MAKS_MB', 20) + ' MB.');
    if (!/\.(pdf|docx?|pptx?|xlsx?)$/i.test(d.file.name || '')) return fail_('Format file harus PDF, Word, PowerPoint, atau Excel.');
    var f = saveBase64File_(CONFIG.MATERI_FOLDER, d.file.name, d.file.mime || 'application/pdf', d.file.data);
    shareLink_(f);
    if (ada && ada.drive_file_id) { try { DriveApp.getFileById(ada.drive_file_id).setTrashed(true); } catch (e) {} }
    row.drive_file_id = f.getId(); row.url_konten = 'https://drive.google.com/file/d/' + f.getId() + '/preview'; row.ukuran = bytesLen;
  } else if (x.url_konten && x.url_konten !== (ada && ada.url_konten)) {
    var did = driveId_(x.url_konten);
    row.url_konten = did ? 'https://drive.google.com/file/d/' + did + '/preview' : String(x.url_konten).trim();
    row.drive_file_id = did || '';
    if (!/^https?:\/\//.test(row.url_konten) && !/^demo\//.test(row.url_konten)) return fail_('Tautan dokumen harus diawali https://');
  } else if (!row.url_konten) return fail_('Unggah file dokumen atau tempel tautan Google Drive.');
  if (isNew) {
    row.materi_id = reserveIds_('Materi', 1)[0]; row.tanggal_upload = nowIso_();
    DB.appendBatch('Materi', [row]);
    if (d.kirimNotif) {
      var guru = DB.find('Guru', 'NUPTK', row.guru_id) || {};
      kirimNotifBatch_('MATERI_BARU', DB.all('Siswa').filter(function (s) { return (s.status || 'Aktif') === 'Aktif' && (!row.kelas_id || s.kelas_id === row.kelas_id); })
        .map(function (s) { return { penerima: { nama: s.nama_lengkap, hp: s.no_wa, email: s.email }, vars: { judul: row.judul, mapel: row.mata_pelajaran, guru: guru.nama_lengkap || '' }, refId: row.materi_id }; }));
    }
  } else { row.materi_id = ada.materi_id; row.tanggal_upload = ada.tanggal_upload; DB.updateBatch('Materi', 'materi_id', [row]); }
  bump_('master');
  return ok_(row, isNew ? 'Materi berhasil diunggah dan langsung tampil di dashboard siswa.' : 'Materi diperbarui.');
}

function apiMateriDelete(ctx, d) {
  var m = DB.find('Materi', 'materi_id', d.materi_id);
  if (!m) return fail_('Materi tidak ditemukan.');
  DB.updateBatch('Materi', 'materi_id', [{ materi_id: m.materi_id, status: 'Dihapus' }]);
  if (m.drive_file_id && d.hapusFile) { try { DriveApp.getFileById(m.drive_file_id).setTrashed(true); } catch (e) {} }
  bump_('master');
  return ok_(null, 'Materi dihapus.');
}

/** Catat akses materi — antrean cache (jalur baca tidak menulis sheet) */
function apiMateriView(ctx, d) {
  if (ctx.session.role !== 'siswa' || !d.materi_id) return ok_(null);
  var k = 'viewed_' + ctx.session.ref + '_' + d.materi_id, c = CacheService.getScriptCache();
  if (c.get(k)) return ok_(null);
  c.put(k, '1', 21600);
  var lock = LockService.getScriptLock();
  if (lock.tryLock(300)) {
    try { var q = JSON.parse(c.get('viewq') || '[]'); q.push([d.materi_id, ctx.session.ref, nowIso_()]); c.put('viewq', JSON.stringify(q), 21600); }
    finally { lock.releaseLock(); }
  }
  return ok_(null);
}
function flushMateriViews_(q) {
  var have = {}; DB.all('MateriAkses').forEach(function (a) { have[a.materi_id + '|' + a.NIS] = 1; });
  var rows = q.filter(function (r) { var k = r[0] + '|' + r[1]; if (have[k]) return false; have[k] = 1; return true; });
  if (!rows.length) return;
  var ids = reserveIds_('MateriAkses', rows.length);
  DB.appendBatch('MateriAkses', rows.map(function (r, i) { return { akses_id: ids[i], materi_id: r[0], NIS: r[1], waktu: r[2] }; }));
  bump_('master');
}

// ---------------------------------------------------------------------
// F. PENILAIAN
// ---------------------------------------------------------------------
function nilaiKey_(n) { return [n.NIS, lower_(n.mata_pelajaran), n.semester, n.tahun_ajaran].join('|'); }

function apiNilaiList(ctx, d) {
  var ta = d.tahun_ajaran || setting_('TAHUN_AJARAN', ''), sem = d.semester || setting_('SEMESTER', '');
  var siswa = DB.all('Siswa').filter(function (s) { return s.kelas_id === d.kelas_id && (s.status || 'Aktif') === 'Aktif'; });
  var idx = {};
  DB.all('Nilai').forEach(function (n) { if (lower_(n.mata_pelajaran) === lower_(d.mata_pelajaran) && n.semester === sem && n.tahun_ajaran === ta) idx[n.NIS] = n; });
  return ok_({
    tahun_ajaran: ta, semester: sem, kelas_id: d.kelas_id, mata_pelajaran: d.mata_pelajaran,
    rows: siswa.sort(function (a, b) { return a.nama_lengkap.localeCompare(b.nama_lengkap); }).map(function (s) {
      var n = idx[s.NIS] || {};
      return { NIS: s.NIS, nama: s.nama_lengkap, foto: s.foto_profil_url, nilai_id: n.nilai_id || '', nilai_harian: n.nilai_harian === undefined ? '' : n.nilai_harian,
        nilai_uts: n.nilai_uts === undefined ? '' : n.nilai_uts, nilai_uas: n.nilai_uas === undefined ? '' : n.nilai_uas, nilai_akhir: n.nilai_akhir === undefined ? '' : n.nilai_akhir,
        predikat: n.predikat || '', catatan: n.catatan || '', diperbarui_pada: n.diperbarui_pada || '' };
    })
  });
}

function apiNilaiSaveBatch(ctx, d) {
  var ta = d.tahun_ajaran || setting_('TAHUN_AJARAN', ''), sem = d.semester || setting_('SEMESTER', '');
  if (!d.kelas_id || !d.mata_pelajaran) return fail_('Kelas dan mata pelajaran wajib dipilih.');
  var sMap = {}; DB.all('Siswa').forEach(function (s) { sMap[s.NIS] = s; });
  var kkm = num_(setting_('KKM', 70), 70), rows = [], remedial = [], terbit = [];
  var lama = {}; DB.all('Nilai').forEach(function (n) { lama[nilaiKey_(n)] = n; });
  for (var i = 0; i < (d.rows || []).length; i++) {
    var r = d.rows[i], s = sMap[String(r.NIS)];
    if (!s) return fail_('Siswa ' + r.NIS + ' tidak ditemukan.');
    var vals = [r.nilai_harian, r.nilai_uts, r.nilai_uas].map(function (v) { return v === '' || v === null || v === undefined ? '' : Number(v); });
    for (var j = 0; j < 3; j++) if (vals[j] !== '' && (isNaN(vals[j]) || vals[j] < 0 || vals[j] > 100)) return fail_('Nilai ' + s.nama_lengkap + ' harus 0–100.');
    var akhir = hitungAkhir_(vals[0], vals[1], vals[2]);
    var row = { NIS: s.NIS, kelas_id: d.kelas_id, mata_pelajaran: d.mata_pelajaran, guru_id: ctx.session.ref, semester: sem, tahun_ajaran: ta,
      nilai_harian: vals[0], nilai_uts: vals[1], nilai_uas: vals[2], nilai_akhir: akhir, predikat: predikat_(akhir), catatan: r.catatan || '', diperbarui_pada: nowIso_() };
    var prev = lama[nilaiKey_(row)];
    if (akhir !== '' && (!prev || String(prev.nilai_akhir) !== String(akhir))) (akhir < kkm ? remedial : terbit).push({ s: s, akhir: akhir });
    rows.push(row);
  }
  var res = DB.upsert('Nilai', nilaiKey_, rows);
  bump_('nilai');
  if (d.kirimNotif) {
    kirimNotifBatch_('NILAI_TERBIT', terbit.map(function (x) { return { penerima: { nama: x.s.nama_lengkap, hp: x.s.no_wa_ortu, email: x.s.email }, vars: { mapel: d.mata_pelajaran, nilai: x.akhir, predikat: predikat_(x.akhir), semester: sem }, refId: x.s.NIS }; }));
    kirimNotifBatch_('REMEDIAL', remedial.map(function (x) { return { penerima: { nama: x.s.nama_lengkap, hp: x.s.no_wa_ortu, email: x.s.email }, vars: { mapel: d.mata_pelajaran, nilai: x.akhir, kkm: kkm }, refId: x.s.NIS }; }));
  }
  return ok_({ inserted: res.inserted, updated: res.updated, rows: res.rows }, 'Nilai ' + rows.length + ' siswa tersimpan ke Sheets.');
}

// ---------------------------------------------------------------------
// G. LAPORAN — ekspor ke Google Sheets (folder SIAKAD_EXPORTS)
// ---------------------------------------------------------------------
function apiLaporanExport(ctx, d) {
  var headers = d.headers || [], rows = d.rows || [];
  if (!headers.length) return fail_('Tidak ada data untuk diekspor.');
  if (rows.length > 20000) return fail_('Data terlalu besar (maks 20.000 baris).');
  var judul = String(d.judul || 'Laporan SIAKAD').substring(0, 90) + ' — ' + Utilities.formatDate(new Date(), APP.TZ, 'yyyy-MM-dd HH.mm');
  var ss = SpreadsheetApp.create(judul);
  DriveApp.getFileById(ss.getId()).moveTo(driveFolder_(CONFIG.EXPORTS_FOLDER));
  var sh = ss.getSheets()[0];
  sh.setName('Laporan');
  var data = [headers].concat(rows.map(function (r) { return headers.map(function (h, i) { var v = Array.isArray(r) ? r[i] : r[h]; return v === undefined || v === null ? '' : v; }); }));
  sh.getRange(1, 1, data.length, headers.length).setValues(data);
  sh.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#1E3A5F').setFontColor('#ffffff');
  sh.setFrozenRows(1);
  return ok_({ url: ss.getUrl(), id: ss.getId(), nama: judul }, 'Laporan diekspor ke Google Sheets.');
}

// ---------------------------------------------------------------------
// H. DATA CONTOH (demo) — dipanggil setupAppEnvironment()
// ---------------------------------------------------------------------
function prng_(seed) { var s = seed % 2147483647; if (s <= 0) s += 2147483646; return function () { s = s * 16807 % 2147483647; return (s - 1) / 2147483646; }; }

function seedDemo_() {
  var rnd = prng_(20260928), now = nowIso_(), tdy = today_();
  var ta = setting_('TAHUN_AJARAN', '2026/2027');
  // Semester dibuat mencakup hari ini agar grafik demo selalu terisi
  var mulaiD = new Date(new Date(tdy + 'T00:00:00+07:00').getTime() - 45 * 864e5);
  var selesaiD = new Date(new Date(tdy + 'T00:00:00+07:00').getTime() + 90 * 864e5);
  saveSettings_({ SEMESTER_MULAI: Utilities.formatDate(mulaiD, APP.TZ, 'yyyy-MM-dd'), SEMESTER_SELESAI: Utilities.formatDate(selesaiD, APP.TZ, 'yyyy-MM-dd') });

  var guru = [
    ['19780215', 'Drs. H. Hartono, M.Si.', 'guru@sekolah.sch.id', '081298443210', 'Biologi', 'Wali Kelas XII IPA 1'],
    ['19680512', 'Drs. H. Mulyadi, M.Pd.', 'mulyadi@sekolah.sch.id', '081311223344', 'Matematika', 'Guru'],
    ['19840215', 'Siti Nurhaliza, S.Si., M.Sc.', 'siti.nurhaliza@sekolah.sch.id', '081322334455', 'Fisika', 'Guru'],
    ['19770821', "Ahmad Rifa'i, M.Pd.", 'ahmad.rifai@sekolah.sch.id', '081333445566', 'Kimia', 'Wali Kelas XI IPA 1'],
    ['19891004', 'Elizabeth Watson, M.A.', 'elizabeth.watson@sekolah.sch.id', '081344556677', 'Bahasa Inggris', 'Guru'],
    ['19730419', 'K.H. Zainuddin, S.Ag.', 'zainuddin@sekolah.sch.id', '081355667788', 'Pendidikan Agama & Budi Pekerti', 'Guru'],
    ['19710311', 'Dra. Endang Sulistowati', 'endang@sekolah.sch.id', '081366778899', 'Bahasa Indonesia', 'Wali Kelas X-A']
  ];
  DB.appendBatch('Guru', guru.map(function (g) { return { NUPTK: g[0], nama_lengkap: g[1], email: g[2], no_wa: g[3], mata_pelajaran: g[4], jabatan: g[5], foto_profil_url: '', status: 'Aktif', StatusWA: '', CekWAAt: '', dibuat_pada: now }; }));

  var kelas = [['KLS000001', 'XII IPA 1', 'SMA', 'XII', '19780215'], ['KLS000002', 'XI IPA 1', 'SMA', 'XI', '19770821'], ['KLS000003', 'X-A', 'SMA', 'X', '19710311'], ['KLS000004', 'IX-B', 'SMP', 'IX', ''], ['KLS000005', 'VI-A', 'SD', 'VI', '']];
  DB.appendBatch('Kelas', kelas.map(function (k) { return { kelas_id: k[0], nama_kelas: k[1], jenjang: k[2], tingkat: k[3], wali_kelas_id: k[4], tahun_ajaran: ta }; }));
  setProp_('SEQ_Kelas', '5');

  var mapel = [['Matematika Wajib', 'MAT', 'Wajib'], ['Matematika Peminatan', 'MTP', 'Peminatan'], ['Fisika', 'FIS', 'Peminatan'], ['Kimia', 'KIM', 'Peminatan'], ['Biologi', 'BIO', 'Peminatan'],
    ['Bahasa Indonesia', 'BIN', 'Wajib'], ['Bahasa Inggris', 'BIG', 'Wajib'], ['Pendidikan Agama & Budi Pekerti', 'PAI', 'Wajib'], ['Sejarah Indonesia', 'SEJ', 'Wajib']];
  DB.appendBatch('Mapel', mapel.map(function (m, i) { return { mapel_id: 'MPL' + ('00000' + (i + 1)).slice(-6), nama: m[0], kode: m[1], kelompok: m[2], jenjang: 'SMA' }; }));
  setProp_('SEQ_Mapel', String(mapel.length));

  var depan = ['Ahmad', 'Budi', 'Citra', 'Dewi', 'Dimas', 'Eko', 'Farhan', 'Gita', 'Hendra', 'Indah', 'Joko', 'Kartika', 'Lukman', 'Maya', 'Nanda', 'Oki', 'Putri', 'Rian', 'Siti', 'Taufik', 'Umi', 'Vina', 'Wahyu', 'Yuni', 'Zaki',
    'Aulia', 'Bagus', 'Cahya', 'Dinda', 'Fajar', 'Galih', 'Hana', 'Irfan', 'Jihan', 'Kevin', 'Laila', 'Mega', 'Nabila', 'Olivia', 'Pandu', 'Qori', 'Rizky', 'Salsa', 'Tegar', 'Ulfa', 'Vito', 'Wulan', 'Yoga', 'Zahra', 'Arya'];
  var belakang = ['Fauzi', 'Santoso', 'Lestari', 'Anggraini', 'Bagus', 'Prasetyo', 'Pratama', 'Rahmawati', 'Wijaya', 'Permata', 'Susilo', 'Sari', 'Hakim', 'Safitri', 'Putra', 'Saputra', 'Ayu', 'Pratama', 'Rahma', 'Hidayat',
    'Kalsum', 'Oktaviani', 'Nugroho', 'Kurniasih', 'Ramadhan', 'Azzahra', 'Setiawan', 'Kirana', 'Maharani', 'Nugraha', 'Pamungkas', 'Humaira', 'Maulana', 'Nuraini', 'Wibowo', 'Fitriani', 'Utami', 'Syakira', 'Anjani', 'Wicaksono',
    'Amalia', 'Firmansyah', 'Billa', 'Satria', 'Nisa', 'Alfarizi', 'Handayani', 'Adi', 'Khairunnisa', 'Dwipa'];
  var P = { Citra: 1, Dewi: 1, Gita: 1, Indah: 1, Kartika: 1, Maya: 1, Nanda: 1, Putri: 1, Siti: 1, Umi: 1, Vina: 1, Yuni: 1, Aulia: 1, Cahya: 1, Dinda: 1, Hana: 1, Jihan: 1, Laila: 1, Mega: 1, Nabila: 1, Olivia: 1, Qori: 1, Salsa: 1, Ulfa: 1, Wulan: 1, Zahra: 1 };
  var kota = ['Jakarta', 'Bogor', 'Depok', 'Tangerang', 'Bekasi', 'Bandung'];
  var siswa = [], users = [], nisList = [];
  for (var i = 0; i < 50; i++) {
    var k = i < 20 ? kelas[0] : i < 35 ? kelas[1] : kelas[2];
    var angkatan = k[3] === 'XII' ? '2024' : k[3] === 'XI' ? '2025' : '2026';
    var nis = angkatan + ('0000' + (101 + i)).slice(-4);
    if (i === 0) nis = '20230101';
    var nama = depan[i] + ' ' + belakang[i], jk = P[depan[i]] ? 'P' : 'L';
    var email = i === 0 ? 'siswa@sekolah.sch.id' : slug_(nama) + '@siswa.sch.id';
    var wa = '0812' + ('0000000' + Math.floor(rnd() * 9999999)).slice(-7);
    siswa.push({ NIS: nis, NISN: '00' + ('00000000' + Math.floor(58291048 + i * 7)).slice(-8), nama_lengkap: nama, jenis_kelamin: jk, kelas_id: k[0], jenjang: k[2], barcode_id: 'ID-' + nis,
      email: email, no_wa: '', nama_ortu: (jk === 'L' ? 'Bpk. ' : 'Ibu ') + belakang[(i + 7) % 50] + ' ' + depan[(i + 13) % 50], no_wa_ortu: wa, tempat_lahir: kota[i % kota.length],
      tanggal_lahir: (Number(angkatan) - 15) + '-' + ('0' + (1 + i % 12)).slice(-2) + '-' + ('0' + (1 + (i * 3) % 28)).slice(-2), alamat: 'Jl. Contoh No. ' + (i + 1) + ', ' + kota[i % kota.length],
      foto_profil_url: '', tahun_masuk: angkatan, status: 'Aktif', StatusWA: '', CekWAAt: '', dibuat_pada: now });
    nisList.push(nis);
    var salt = newSalt_();
    users.push({ nama: nama, email: email, password_hash: i === 0 ? hashPassword_(demoPw_('siswa'), salt) : hashPassword_(nis, salt, 1), salt: salt, role: 'siswa', ref_id: nis, kelas_id: k[0],
      status_aktif: i === 6 || i === 41 ? 'TIDAK' : 'YA', wajib_ganti_sandi: i === 0 ? 'TIDAK' : 'YA', last_login: '', dibuat_pada: now });
  }
  siswa[0].nama_lengkap = 'Ahmad Fauzi'; users[0].nama = 'Ahmad Fauzi';
  var hashGuru = hashPassword_(demoPw_('guru'));              // satu hash dipakai bersama akun guru contoh (hemat waktu setup)
  guru.slice().reverse().forEach(function (g) {
    var gi = guru.indexOf(g);
    users.unshift({ nama: g[1], email: g[2], password_hash: hashGuru, salt: '', role: 'guru', ref_id: g[0], kelas_id: '', status_aktif: 'YA', wajib_ganti_sandi: gi === 0 ? 'TIDAK' : 'YA', last_login: '', dibuat_pada: now,
      hak_akses: gi === 6 ? 'keuangan' : '' });
  });
  users.unshift({ nama: 'Super Admin Sekolah', email: 'admin@sekolah.sch.id', password_hash: hashPassword_(demoPw_('sa')), salt: '', role: 'superadmin', ref_id: '', kelas_id: '', status_aktif: 'YA',
    wajib_ganti_sandi: 'TIDAK', last_login: '', dibuat_pada: now, hak_akses: 'keuangan', catatan: 'Akun contoh — ganti sandi atau hapus data contoh' });
  var uids = reserveIds_('Users', users.length);
  users.forEach(function (u, j) { u.user_id = uids[j]; });
  DB.appendBatch('Siswa', siswa);
  DB.appendBatch('Users', users);

  // Jadwal XII IPA 1 & XI IPA 1
  var slot = [['07:15', '08:45'], ['09:00', '10:30'], ['10:45', '12:15'], ['13:00', '14:30']];
  var plan = { KLS000001: [['Matematika Wajib', '19680512', 'R-302'], ['Fisika', '19840215', 'Lab Fisika'], ['Kimia', '19770821', 'Lab Kimia'], ['Bahasa Inggris', '19891004', 'R. Multimedia'], ['Biologi', '19780215', 'Lab Biologi'],
    ['Matematika Peminatan', '19680512', 'R-302'], ['Bahasa Indonesia', '19710311', 'R-302'], ['Pendidikan Agama & Budi Pekerti', '19730419', 'Aula'], ['Sejarah Indonesia', '19710311', 'R-302']],
    KLS000002: [['Kimia', '19770821', 'Lab Kimia'], ['Matematika Wajib', '19680512', 'R-204'], ['Biologi', '19780215', 'Lab Biologi'], ['Bahasa Inggris', '19891004', 'R-204'], ['Fisika', '19840215', 'Lab Fisika']] };
  var jadwal = [], hariList = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat'];
  var busy = {};
  Object.keys(plan).forEach(function (kid, ki) {
    var n = 0;
    hariList.forEach(function (h, hi) {
      slot.forEach(function (sl, si) {
        if (si === 3 && hi === 4) return;
        var m = plan[kid][(n + ki) % plan[kid].length];
        var bk = h + sl[0] + m[1], rk = h + sl[0] + m[2];
        if (busy[bk] || busy[rk]) { n++; m = plan[kid][(n + ki) % plan[kid].length]; bk = h + sl[0] + m[1]; rk = h + sl[0] + m[2]; if (busy[bk] || busy[rk]) return; }
        busy[bk] = busy[rk] = 1;
        jadwal.push({ kelas_id: kid, mata_pelajaran: m[0], guru_id: m[1], hari: h, jam_mulai: sl[0], jam_selesai: sl[1], ruang: m[2] });
        n++;
      });
    });
  });
  var jids = reserveIds_('Jadwal', jadwal.length); jadwal.forEach(function (j, x) { j.jadwal_id = jids[x]; });
  DB.appendBatch('Jadwal', jadwal);

  // Absensi 30 hari sekolah terakhir (Senin–Jumat) + sebagian hari ini
  var abs = [], base = new Date(tdy + 'T00:00:00+07:00'), hari = 0, back = 0;
  var bolos = { 4: 0.28, 5: 0.25, 17: 0.3, 33: 0.24, 44: 0.27 };   // beberapa siswa kehadiran < 75%
  while (hari < 30 && back < 60) {
    back++;
    var dd = new Date(base.getTime() - back * 864e5), dow = Number(Utilities.formatDate(dd, APP.TZ, 'u'));
    if (dow > 5) continue;
    hari++;
    var t = Utilities.formatDate(dd, APP.TZ, 'yyyy-MM-dd');
    siswa.forEach(function (s, si) {
      var r = rnd(), pb = bolos[si] || 0.04, st = r < pb * 0.6 ? 'Alpha' : r < pb * 0.8 ? 'Izin' : r < pb ? 'Sakit' : 'Hadir';
      var menit = 6 * 60 + 45 + Math.floor(rnd() * 40), jam = ('0' + Math.floor(menit / 60)).slice(-2) + ':' + ('0' + (menit % 60)).slice(-2) + ':' + ('0' + Math.floor(rnd() * 60)).slice(-2);
      var met = st !== 'Hadir' ? 'manual' : ['barcode', 'barcode', 'barcode', 'selfie', 'lokasi'][Math.floor(rnd() * 5)];
      abs.push({ NIS: s.NIS, kelas_id: s.kelas_id, tanggal: t, jam: st === 'Hadir' ? jam : '07:00:00', status: st, metode: met, latitude: st === 'Hadir' ? '-6.2089' : '', longitude: st === 'Hadir' ? '106.8457' : '',
        jarak_m: st === 'Hadir' ? String(10 + Math.floor(rnd() * 60)) : '', foto_selfie_id: '', keterangan: st === 'Izin' ? 'Acara keluarga' : st === 'Sakit' ? 'Surat dokter' : '', terlambat: st === 'Hadir' && jam.substring(0, 5) > '07:15' ? 'YA' : st === 'Hadir' ? 'TIDAK' : '',
        dicatat_oleh: met === 'barcode' || met === 'manual' ? 'guru@sekolah.sch.id' : s.email, dibuat_pada: t + 'T' + jam + '+07:00' });
    });
  }
  var dowT = Number(Utilities.formatDate(base, APP.TZ, 'u'));
  if (dowT <= 5) {
    siswa.slice(1, 14).forEach(function (s, si) {
      var jam = '07:' + ('0' + (2 + si * 2)).slice(-2) + ':' + ('0' + Math.floor(rnd() * 60)).slice(-2);
      abs.push({ NIS: s.NIS, kelas_id: s.kelas_id, tanggal: tdy, jam: jam, status: si === 9 ? 'Izin' : 'Hadir', metode: si === 9 ? 'manual' : si % 4 === 0 ? 'selfie' : 'barcode', latitude: '-6.2088', longitude: '106.8456', jarak_m: String(20 + si * 3), foto_selfie_id: '',
        keterangan: si === 9 ? 'Surat Dokter.pdf' : '', terlambat: si === 9 ? '' : 'TIDAK', dicatat_oleh: 'guru@sekolah.sch.id', dibuat_pada: tdy + 'T' + jam + '+07:00' });
    });
  }
  var aids = reserveIds_('Absensi', abs.length); abs.forEach(function (a, x) { a.absensi_id = aids[x]; });
  DB.appendBatch('Absensi', abs);

  // Nilai
  var nilai = [];
  var mapelKelas = { KLS000001: mapel.map(function (m) { return m[0]; }), KLS000002: ['Matematika Wajib', 'Fisika', 'Kimia', 'Biologi', 'Bahasa Inggris'], KLS000003: ['Matematika Wajib', 'Bahasa Indonesia', 'Bahasa Inggris'] };
  var guruMapel = { 'Matematika Wajib': '19680512', 'Matematika Peminatan': '19680512', 'Fisika': '19840215', 'Kimia': '19770821', 'Biologi': '19780215', 'Bahasa Indonesia': '19710311', 'Bahasa Inggris': '19891004', 'Pendidikan Agama & Budi Pekerti': '19730419', 'Sejarah Indonesia': '19710311' };
  var sem = setting_('SEMESTER', 'Ganjil');
  siswa.forEach(function (s, si) {
    var bakat = si === 0 ? 88 : si === 2 ? 93 : (si === 4 || si === 6) ? 64 : 72 + Math.floor(rnd() * 20);
    (mapelKelas[s.kelas_id] || []).forEach(function (mp) {
      var v = function () { return Math.max(40, Math.min(100, Math.round(bakat + (rnd() - 0.5) * 14))); };
      var h = v(), u = v(), a = s.kelas_id === 'KLS000003' && mp === 'Bahasa Indonesia' ? '' : v();
      var akhir = hitungAkhir_(h, u, a);
      nilai.push({ NIS: s.NIS, kelas_id: s.kelas_id, mata_pelajaran: mp, guru_id: guruMapel[mp], semester: sem, tahun_ajaran: ta, nilai_harian: h, nilai_uts: u, nilai_uas: a, nilai_akhir: akhir, predikat: predikat_(akhir),
        catatan: akhir !== '' && akhir >= 90 ? 'Pemahaman sangat baik, pertahankan.' : akhir !== '' && akhir < 70 ? 'Perlu remedial KD utama.' : '', diperbarui_pada: now });
    });
  });
  var nids = reserveIds_('Nilai', nilai.length); nilai.forEach(function (n, x) { n.nilai_id = nids[x]; });
  DB.appendBatch('Nilai', nilai);

  // Materi
  var mt = [
    ['Modul Turunan Fungsi Trigonometri Lanjutan & Penerapannya', 'Pembahasan mendalam konsep turunan kedua fungsi trigonometri, grafik kurva kecepatan sesaat, dan latihan soal persiapan ujian.', 'Matematika Peminatan', 'KLS000001', '19680512', 'dokumen', 'demo/modul-trigonometri.pdf', 2457600, ''],
    ['Eksperimen Efek Fotolistrik & Dualisme Gelombang Partikel', 'Video demonstrasi efek fotolistrik, frekuensi ambang logam, dan interpretasi grafik fungsi kerja foton.', 'Fisika', 'KLS000001', '19840215', 'video', 'https://www.youtube.com/embed/6k_sXYgwMeA', '', '45 Menit'],
    ['Tata Nama Senyawa Benzena & Turunannya (Orto, Meta, Para)', 'Struktur cincin aromatik, reaksi substitusi elektrofilik, serta turunan monosubstitusi dan disubstitusi benzena dalam industri.', 'Kimia', 'KLS000001', '19770821', 'dokumen', 'demo/benzena.pdf', 1887436, ''],
    ['Turunan Fungsi Trigonometri — Video Pembahasan', 'Rumus dasar turunan sin, cos, tan beserta contoh soal bertahap.', 'Matematika Peminatan', 'KLS000001', '19680512', 'video', 'https://www.youtube.com/embed/HC6BNJGKoTk', '', '30 Menit'],
    ['Kumpulan Soal & Pembahasan Limit Menuju Tak Hingga', 'Trik cepat metode rasionalisasi akar sekawan, teorema limit fungsi aljabar, dan bank soal evaluasi mandiri semester ganjil.', 'Matematika Wajib', '', '19680512', 'dokumen', 'demo/limit.pdf', 3250585, ''],
    ['Mekanisme Transpor Membran: Difusi, Osmosis & Endositosis', 'Animasi membran bilayer fosfolipid, transpor aktif primer-sekunder melalui pompa natrium-kalium.', 'Biologi', 'KLS000002', '19780215', 'video', 'https://www.youtube.com/embed/w8CmZzmzh6E', '', '20 Menit']
  ];
  var mids = reserveIds_('Materi', mt.length);
  DB.appendBatch('Materi', mt.map(function (m, x) {
    var tgl = Utilities.formatDate(new Date(base.getTime() - (x * 2 + 1) * 864e5), APP.TZ, "yyyy-MM-dd'T'HH:mm:ssXXX");
    return { materi_id: mids[x], judul: m[0], deskripsi: m[1], mata_pelajaran: m[2], kelas_id: m[3], guru_id: m[4], tipe: m[5], url_konten: m[6], drive_file_id: '', ukuran: m[7], durasi: m[8], tanggal_upload: tgl, status: 'Aktif' };
  }));
  var akses = [];
  siswa.slice(0, 20).forEach(function (s, si) { mids.slice(0, 4).forEach(function (m, x) { if (rnd() < 0.6 && !(si === 0 && x > 1)) akses.push({ materi_id: m, NIS: s.NIS, waktu: now }); }); });
  var akids = reserveIds_('MateriAkses', akses.length); akses.forEach(function (a, x) { a.akses_id = akids[x]; });
  DB.appendBatch('MateriAkses', akses);

  // Pengumuman
  var png = [['Jadwal Penilaian Tengah Semester Dirilis', 'Jadwal pelaksanaan Penilaian Tengah Semester Ganjil telah dirilis. Harap siswa mempersiapkan diri dan membawa kartu pelajar ber-barcode.', 'Akademik', 2],
    ['Pendaftaran Lomba Karya Ilmiah Remaja', 'Pendaftaran kompetisi karya ilmiah remaja dan pameran sains dibuka hingga akhir bulan ini. Hubungi wali kelas masing-masing.', 'Event', 5],
    ['Wajib Aktivasi Akun SIAKAD', 'Seluruh siswa wajib login dan mengganti password awal. Absensi mandiri menggunakan selfie/GPS hanya dapat dilakukan di area sekolah.', 'Informasi', 9]];
  var pids = reserveIds_('Pengumuman', png.length);
  DB.appendBatch('Pengumuman', png.map(function (p, x) { return { pengumuman_id: pids[x], judul: p[0], isi: p[1], kategori: p[2], tanggal: Utilities.formatDate(new Date(base.getTime() - p[3] * 864e5), APP.TZ, "yyyy-MM-dd'T'HH:mm:ssXXX"), oleh: 'guru@sekolah.sch.id', status: 'Aktif' }; }));

  seedDemoV21_(rnd, siswa, guru, users, base);
  extSemua_('seedDemo', rnd);                               // v3.0: data contoh LMS
  setProp_('DEMO_SEEDED', '1');
  bump_('master'); bump_('absen'); bump_('nilai'); bump_('tagihan'); bump_('notif');
}

/** Data contoh v2.1: lokasi geofence, presensi guru, jenis biaya, tagihan & pembayaran, notifikasi */
function seedDemoV21_(rnd, siswa, guru, users, base) {
  var now = nowIso_(), tdy = today_(), fmt = function (d) { return Utilities.formatDate(d, APP.TZ, 'yyyy-MM-dd'); };
  // Lokasi
  var lok = [['Kampus Utama', 'Sekolah', '-6.2088', '106.8456', '100', 'Jl. Pendidikan No. 1', 'Semua'], ['Gedung Olahraga', 'Sekolah', '-6.2104', '106.8471', '80', 'Kompleks GOR', 'Semua'],
    ['Kantor Yayasan', 'Kantor', '-6.2150', '106.8502', '60', 'Jl. Yayasan No. 7', 'Guru']];
  var lids = reserveIds_('Lokasi', lok.length);
  DB.appendBatch('Lokasi', lok.map(function (l, i) { return { lokasi_id: lids[i], nama: l[0], tipe: l[1], latitude: l[2], longitude: l[3], radius_m: l[4], alamat: l[5], berlaku: l[6], aktif: 'YA', dibuat_oleh: 'seed', diperbarui_pada: now }; }));
  // Presensi guru 10 hari sekolah terakhir + sebagian hari ini
  var uidGuru = {}; users.forEach(function (u) { if (u.role === 'guru') uidGuru[u.ref_id] = u.user_id; });
  var pres = [], hari = 0, back = 0;
  var jamStr = function (m) { return ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + (m % 60)).slice(-2) + ':' + ('0' + Math.floor(rnd() * 60)).slice(-2); };
  while (hari < 10 && back < 25) {
    back++;
    var dd = new Date(base.getTime() - back * 864e5); if (Number(Utilities.formatDate(dd, APP.TZ, 'u')) > 5) continue;
    hari++;
    guru.forEach(function (g) {
      if (rnd() < 0.08) return;
      var m = 6 * 60 + 35 + Math.floor(rnd() * 40), mp = 15 * 60 + Math.floor(rnd() * 60), jm = jamStr(m);
      pres.push({ user_id: uidGuru[g[0]], NUPTK: g[0], nama: g[1], tanggal: fmt(dd), jam_masuk: jm, jam_pulang: jamStr(mp), status: 'Hadir', lokasi_id: rnd() < 0.85 ? lids[0] : lids[2], latitude: '-6.2089', longitude: '106.8457',
        jarak_m: String(5 + Math.floor(rnd() * 60)), foto_id: '', terlambat: jm.substring(0, 5) > '07:00' ? 'YA' : 'TIDAK', device_id: '', keterangan: '', diperbarui_pada: now });
    });
  }
  if (Number(Utilities.formatDate(base, APP.TZ, 'u')) <= 5) {
    guru.slice(1, 5).forEach(function (g, i) {
      var jm = jamStr(6 * 60 + 40 + i * 7);
      pres.push({ user_id: uidGuru[g[0]], NUPTK: g[0], nama: g[1], tanggal: tdy, jam_masuk: jm, jam_pulang: '', status: 'Hadir', lokasi_id: lids[0], latitude: '-6.2088', longitude: '106.8456', jarak_m: String(12 + i * 9),
        foto_id: '', terlambat: jm.substring(0, 5) > '07:00' ? 'YA' : 'TIDAK', device_id: '', keterangan: '', diperbarui_pada: now });
    });
  }
  var prids = reserveIds_('PresensiGuru', pres.length); pres.forEach(function (p, i) { p.presensi_id = prids[i]; });
  DB.appendBatch('PresensiGuru', pres);
  // Jenis biaya (custom)
  var jtPangkal = fmt(new Date(base.getTime() + 30 * 864e5));
  var biaya = [
    { kode: 'SPP', nama: 'SPP', jenis: 'Bulanan', nominal: 350000, nominal_khusus: JSON.stringify({ 'KELAS:KLS000001': 400000, 'JENJANG:SMP': 250000, 'JENJANG:SD': 150000 }), jatuh_tempo_tgl: '10', jatuh_tempo: '', keterangan: 'Sumbangan Pembinaan Pendidikan bulanan' },
    { kode: 'MAKAN', nama: 'Uang Makan Siang', jenis: 'Bulanan', nominal: 300000, nominal_khusus: '{}', jatuh_tempo_tgl: '5', jatuh_tempo: '', keterangan: 'Opsional, hanya siswa yang mendaftar katering' },
    { kode: 'PANGKAL', nama: 'Uang Pangkal', jenis: 'Sekali', nominal: 2500000, nominal_khusus: '{}', jatuh_tempo_tgl: '', jatuh_tempo: jtPangkal, keterangan: 'Siswa baru angkatan ' + tdy.substring(0, 4) },
    { kode: 'TOUR', nama: 'Study Tour Yogyakarta', jenis: 'Sekali', nominal: 750000, nominal_khusus: '{}', jatuh_tempo_tgl: '', jatuh_tempo: jtPangkal, keterangan: 'Kelas XI' }
  ];
  var bids = reserveIds_('Biaya', biaya.length);
  DB.appendBatch('Biaya', biaya.map(function (b, i) { return Object.assign({ biaya_id: bids[i], aktif: 'YA', dibuat_pada: now }, b); }));
  // Potongan: beasiswa prestasi 50% SPP (siswa ke-3), gratis SPP (siswa ke-11)
  var saUid = users.filter(function (u) { return u.role === 'superadmin'; })[0].user_id;
  var potRows = [{ NIS: siswa[2].NIS, Tipe: 'Persen', Nilai: 50, Berlaku: 'KODE:SPP', Mulai: '', Sampai: '', Alasan: 'Beasiswa Prestasi', Aktif: 'YA', DibuatOleh: saUid, DibuatPada: now },
    { NIS: siswa[10].NIS, Tipe: 'Gratis', Nilai: 100, Berlaku: 'KODE:SPP', Mulai: '', Sampai: '', Alasan: 'Beasiswa Yatim', Aktif: 'YA', DibuatOleh: saUid, DibuatPada: now }];
  var poids = reserveIds_('PotonganTagihan', potRows.length); potRows.forEach(function (p, i) { p.PotonganID = poids[i]; });
  DB.appendBatch('PotonganTagihan', potRows);
  // Tagihan SPP 4 bulan (3 bulan lalu s.d. bulan ini)
  var bulan = [], d0 = new Date(tdy.substring(0, 7) + '-15T12:00:00+07:00');
  for (var b = 3; b >= 0; b--) { var x = new Date(d0.getTime()); x.setUTCMonth(x.getUTCMonth() - b); bulan.push(Utilities.formatDate(x, APP.TZ, 'yyyy-MM')); }
  var tg = [], byr = [], seq = 0, th = tdy.substring(0, 4), kwPrefix = setting_('KWITANSI_PREFIX', 'KW'), bayarTunggu = [];
  var harga = function (s) { return s.kelas_id === 'KLS000001' ? 400000 : s.jenjang === 'SMP' ? 250000 : s.jenjang === 'SD' ? 150000 : 350000; };
  siswa.forEach(function (s, si) {
    bulan.forEach(function (per, bi) {
      var asal = harga(s), pot = si === 2 ? asal / 2 : si === 10 ? asal : 0, jml = asal - pot, jt = per + '-10', lewat = jt < tdy, kini = bi === bulan.length - 1;
      var status = jml === 0 ? 'Gratis' : (si === 0 ? (bi < 2 ? 'Lunas' : (lewat ? 'Terlambat' : 'Belum Bayar')) : si === 3 && bi >= 2 ? 'Menunggu Verifikasi' : si === 8 && kini ? 'Menunggu Verifikasi'
        : (!kini && rnd() < 0.86) || (kini && rnd() < 0.4) ? 'Lunas' : (lewat ? 'Terlambat' : 'Belum Bayar'));
      var t = { NIS: s.NIS, Jenis: 'Bulanan', BiayaKode: 'SPP', Periode: per, KodeTagihan: 'SPP-' + per, NamaTagihan: 'SPP ' + tgLabel_(per), JumlahAsal: asal, Potongan: pot, Jumlah: jml,
        AlasanPotongan: si === 2 ? 'Beasiswa Prestasi' : si === 10 ? 'Beasiswa Yatim' : '', Status: status, TanggalTerbit: per + '-01', JatuhTempo: jt, TanggalLunas: '', DiterbitkanOleh: saUid, Keterangan: '', kelas_id: s.kelas_id };
      if (status === 'Gratis') t.TanggalLunas = per + '-01';
      tg.push(t);
    });
  });
  // Uang pangkal untuk kelas X-A
  siswa.filter(function (s) { return s.kelas_id === 'KLS000003'; }).forEach(function (s, i) {
    tg.push({ NIS: s.NIS, Jenis: 'Sekali', BiayaKode: 'PANGKAL', Periode: '', KodeTagihan: 'PANGKAL', NamaTagihan: 'Uang Pangkal', JumlahAsal: 2500000, Potongan: 0, Jumlah: 2500000, AlasanPotongan: '',
      Status: i < 5 ? 'Lunas' : 'Belum Bayar', TanggalTerbit: fmt(new Date(base.getTime() - 20 * 864e5)), JatuhTempo: jtPangkal, TanggalLunas: '', DiterbitkanOleh: saUid, Keterangan: '', kelas_id: s.kelas_id });
  });
  var tids = reserveIds_('Tagihan', tg.length); tg.forEach(function (t, i) { t.TagihanID = tids[i]; });
  // Pembayaran untuk Lunas (1 kwitansi per tagihan) & Menunggu (bukti contoh)
  tg.forEach(function (t) {
    if (t.Status === 'Lunas') {
      seq++;
      var tglBayar = t.Jenis === 'Bulanan' ? t.Periode + '-0' + (2 + Math.floor(rnd() * 7)) : fmt(new Date(base.getTime() - (3 + Math.floor(rnd() * 10)) * 864e5));
      if (tglBayar > tdy) tglBayar = tdy;
      t.TanggalLunas = tglBayar;
      byr.push({ TagihanID: t.TagihanID, NIS: t.NIS, Jumlah: t.Jumlah, Metode: rnd() < 0.7 ? 'Transfer' : 'Tunai', NoReferensi: rnd() < 0.7 ? 'TRX' + Math.floor(100000 + rnd() * 899999) : '', BuktiID: '', Status: 'Terverifikasi',
        TanggalBayar: tglBayar, VerifiedBy: saUid, VerifiedAt: tglBayar + 'T10:00:00+07:00', Catatan: '', GrupBayar: '', NoKwitansi: kwPrefix + '-' + th + '-' + ('00000' + seq).slice(-6) });
    } else if (t.Status === 'Menunggu Verifikasi') bayarTunggu.push(t);
  });
  var perNis = {}; bayarTunggu.forEach(function (t) { (perNis[t.NIS] = perNis[t.NIS] || []).push(t); });
  Object.keys(perNis).forEach(function (nis) {
    var ts = perNis[nis], total = ts.reduce(function (a, t) { return a + t.Jumlah; }, 0), s = siswa.filter(function (x) { return x.NIS === nis; })[0];
    var svg = buktiContohSvg_(s.nama_lengkap, total, tdy), f = null;
    try { f = shareLink_(saveBase64File_(CONFIG.BUKTI_FOLDER, nis + '_bukti_contoh.svg', 'image/svg+xml', Utilities.base64Encode(svg, Utilities.Charset.UTF_8))); } catch (e) {}
    ts.forEach(function (t, i) {
      byr.push({ TagihanID: t.TagihanID, NIS: nis, Jumlah: t.Jumlah, Metode: 'Transfer', NoReferensi: 'TRX' + Math.floor(100000 + rnd() * 899999), BuktiID: f ? f.getId() : '', Status: 'Menunggu',
        TanggalBayar: tdy, VerifiedBy: '', VerifiedAt: '', Catatan: 'Transfer dari rekening orang tua', GrupBayar: ts.length > 1 ? '#G' : '', NoKwitansi: '' });
    });
  });
  var pyids = reserveIds_('Pembayaran', byr.length), grupId = {};
  byr.forEach(function (b, i) { b.PembayaranID = pyids[i]; if (b.GrupBayar === '#G') { b.GrupBayar = grupId[b.NIS] || (grupId[b.NIS] = b.PembayaranID); } });
  DB.appendBatch('Tagihan', tg);
  DB.appendBatch('Pembayaran', byr);
  setProp_('SEQ_KWITANSI_' + th, String(seq));
  // Notifikasi in-app contoh untuk siswa pertama
  var uSiswa0 = users.filter(function (u) { return u.role === 'siswa' && u.ref_id === siswa[0].NIS; })[0];
  if (uSiswa0) notifApp_([{ user_id: uSiswa0.user_id, judul: 'Tagihan Baru: SPP ' + tgLabel_(bulan[3]), pesan: 'Tagihan SPP ' + tgLabel_(bulan[3]) + ' sebesar ' + tgRp_(harga(siswa[0])) + ' telah terbit.', tipe: 'tagihan', link: 'tagihan' },
    { user_id: uSiswa0.user_id, judul: 'Materi baru tersedia', pesan: 'Modul Turunan Fungsi Trigonometri sudah bisa dibaca.', tipe: 'info', link: 'materi' }]);
}
function buktiContohSvg_(nama, total, tgl) {
  var rp = 'Rp ' + String(total).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="640" viewBox="0 0 480 640"><rect width="480" height="640" fill="#f8fafc"/><rect x="24" y="24" width="432" height="592" rx="18" fill="#fff" stroke="#e2e8f0"/>' +
    '<rect x="24" y="24" width="432" height="96" rx="18" fill="#1E3A5F"/><text x="240" y="70" font-family="Arial" font-size="22" font-weight="700" fill="#fff" text-anchor="middle">BUKTI TRANSFER</text>' +
    '<text x="240" y="98" font-family="Arial" font-size="13" fill="#F5A623" text-anchor="middle">Contoh — Mode Demo SIAKAD</text>' +
    '<circle cx="240" cy="190" r="38" fill="#dcfce7"/><path d="M222 190l12 12 24-26" stroke="#16a34a" stroke-width="7" fill="none" stroke-linecap="round"/>' +
    '<text x="240" y="268" font-family="Arial" font-size="15" fill="#64748b" text-anchor="middle">Transfer Berhasil</text><text x="240" y="310" font-family="Arial" font-size="32" font-weight="700" fill="#0f172a" text-anchor="middle">' + rp + '</text>' +
    '<g font-family="Arial" font-size="14" fill="#334155"><text x="56" y="380">Tanggal</text><text x="424" y="380" text-anchor="end">' + tgl + '</text><text x="56" y="420">Dari</text><text x="424" y="420" text-anchor="end">Orang tua ' + String(nama).replace(/[<&]/g, '') + '</text>' +
    '<text x="56" y="460">Ke</text><text x="424" y="460" text-anchor="end">Rekening Sekolah</text><text x="56" y="500">Berita</text><text x="424" y="500" text-anchor="end">SPP</text></g>' +
    '<line x1="56" y1="540" x2="424" y2="540" stroke="#e2e8f0" stroke-dasharray="6 6"/><text x="240" y="580" font-family="Arial" font-size="12" fill="#94a3b8" text-anchor="middle">Dokumen ini hanya ilustrasi data contoh</text></svg>';
}

/** Hapus data contoh; semua akun Super Admin (dan data guru miliknya) dipertahankan */
function apiDemoClear(ctx, d) {
  var keepUsers = DB.all('Users').filter(function (u) { return u.role === 'superadmin' || u.user_id === ctx.session.uid; });
  var keepRef = {}; keepUsers.forEach(function (u) { if (u.ref_id) keepRef[String(u.ref_id)] = 1; });
  ['Siswa', 'Absensi', 'Nilai', 'Materi', 'MateriAkses', 'Jadwal', 'Pengumuman', 'CRM_Kontak', 'CRM_Interaksi', 'AntrianNotif', 'BlastWA',
    'Tagihan', 'Pembayaran', 'PotonganTagihan', 'ReminderLog', 'PresensiGuru', 'Notifikasi', 'Biaya'].forEach(function (name) {
    var sh = getSheet_(name), last = sh.getLastRow();
    if (last > 1) sh.getRange(2, 1, last - 1, sh.getLastColumn()).clearContent();
    invalidateRows_(name);
  });
  var keepGuru = DB.all('Guru').filter(function (g) { return keepRef[String(g.NUPTK)]; });
  var shG = getSheet_('Guru'); if (shG.getLastRow() > 1) shG.getRange(2, 1, shG.getLastRow() - 1, shG.getLastColumn()).clearContent(); invalidateRows_('Guru');
  DB.appendBatch('Guru', keepGuru);
  var shU = getSheet_('Users'); if (shU.getLastRow() > 1) shU.getRange(2, 1, shU.getLastRow() - 1, shU.getLastColumn()).clearContent(); invalidateRows_('Users');
  DB.appendBatch('Users', keepUsers.map(function (u) { var o = Object.assign({}, u); delete o.password_hash; delete o.salt; return o; }));
  bump_('akun');
  bersihkanPwYatim_();
  if (d.hapusKelas) {
    ['Kelas', 'Mapel'].forEach(function (n) { var sh = getSheet_(n); if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).clearContent(); invalidateRows_(n); });
  }
  setProps_({ DEMO_SEEDED: '0', ANTRIAN_MULAI: '2', ANTRIAN_ADA: '0' });
  CacheX.remove('nq');
  bump_('master'); bump_('absen'); bump_('nilai'); bump_('tagihan'); bump_('notif');
  extSemua_('demoClear', ctx, d);                           // v3.0: kosongkan data contoh LMS
  return ok_(null, 'Data contoh dihapus. Sistem siap diisi data sekolah Anda.');
}

;
// ==== Admin.gs ====
/**
 * =====================================================================
 *  SIAKAD SISWA v2.1 — File 3/7 : Admin.gs
 *  • Reset Super Admin dari editor Apps Script (resetSuperAdmin)
 *  • Kelola akun guru & siswa, monitoring guru & siswa, pengguna online
 *  • Geofencing multi-lokasi + kunci perangkat per akun
 *  • Presensi guru (masuk/pulang) berbasis GPS
 *  • Rahasia pihak ketiga ber-allowlist (respons tersamar)
 *  • Notifikasi in-app (lonceng)
 * =====================================================================
 */

// ---------------------------------------------------------------------
// A. RESET SUPER ADMIN — jalankan dari editor: pilih fungsi resetSuperAdmin ▶ Jalankan
// ---------------------------------------------------------------------
/** Opsional: isi email untuk memulihkan / menjadikan akun tertentu sebagai Super Admin.
 *  Kosong = reset Super Admin pertama (atau buat baru bila belum ada). Jangan isi sandi di sini. */
var RESET_SA_EMAIL = '';

function resetSuperAdmin() {
  resetMemo_();
  if (!prop_('SPREADSHEET_ID')) { Logger.log('⚠️ Server belum di-setup. Jalankan setupAppEnvironment() dulu.'); return; }
  var email = lower_(RESET_SA_EMAIL), users = DB.all('Users'), target = null;
  if (email) {
    if (!emailValid_(email)) { Logger.log('⚠️ RESET_SA_EMAIL tidak valid: ' + email); return; }
    target = users.filter(function (u) { return lower_(u.email) === email; })[0] || null;
    if (target && target.role === 'siswa') { Logger.log('⛔ ' + email + ' adalah akun siswa — tidak bisa dijadikan Super Admin.'); return; }
  } else target = users.filter(function (u) { return u.role === 'superadmin'; })[0] || null;
  var sandi = sandiAcak_(14), hasil = null;
  withLock_(function () {
    if (!target) {
      var e = email || emailSuperAdminBaru_();
      var uid = reserveIds_('Users', 1)[0];
      DB.appendBatch('Users', [{ user_id: uid, nama: 'Super Admin', email: e, role: 'superadmin', ref_id: '', kelas_id: '', status_aktif: 'YA', wajib_ganti_sandi: 'YA', last_login: '', dibuat_pada: nowIso_(), hak_akses: 'keuangan', catatan: 'Dibuat oleh resetSuperAdmin()' }]);
      hasil = { uid: uid, email: e, baru: true };
    } else {
      DB.updateBatch('Users', 'user_id', [{ user_id: target.user_id, role: 'superadmin', status_aktif: 'YA', wajib_ganti_sandi: 'YA' }]);
      hasil = { uid: target.user_id, email: lower_(target.email), baru: false, dari: target.role };
    }
    pwSimpan_(hasil.uid, sandi);
    delProp_('SA_KUNCI_' + hasil.uid);
    revokeAll_(hasil.email);
    bump_('akun'); bump_('master'); bump_('adm');
    queueLog_(['editor-apps-script', 'superadmin', 'RESET_SUPERADMIN', hasil.email + (hasil.baru ? ' (baru)' : ''), '']);   // tanpa sandi
    return ok_();
  });
  if (!hasil) { Logger.log('⚠️ Server sibuk, coba jalankan lagi.'); return; }
  Logger.log('👑 SUPER ADMIN ' + (hasil.baru ? 'BARU DIBUAT' : 'DIRESET') + (hasil.dari && hasil.dari !== 'superadmin' ? ' (sebelumnya ' + hasil.dari + ')' : ''));
  Logger.log('   Email : ' + hasil.email);
  Logger.log('   Sandi : ' + sandi);
  Logger.log('   ⚠️ Catat sekarang — sandi hanya tampil SEKALI. Wajib diganti saat login. Semua sesi lama akun ini dikeluarkan.');
  extSemua_('resetSA', hasil);                              // v3.0: buka mode login Google & batas IP agar pemulihan selalu bisa
}
/** Keluarkan semua orang (rotasi secret sesi) — dari editor */
function rotasiSecretSesi() { setProp_('TOKEN_SECRET', acak_(64)); Logger.log('✅ Secret sesi dirotasi — semua pengguna harus login ulang.'); }

function emailSuperAdminBaru_() {
  var dom = '';
  DB.all('Guru').some(function (g) { var m = String(g.email || '').match(/@(.+)$/); if (m) { dom = m[1]; return true; } return false; });
  dom = dom || 'sekolah.sch.id';
  var dipakai = {}; DB.all('Users').forEach(function (u) { dipakai[lower_(u.email)] = 1; });
  var e = 'superadmin@' + dom, i = 2;
  while (dipakai[e]) { e = 'superadmin' + i + '@' + dom; i++; }
  return e;
}
/** Dipanggil setupV21: bila belum ada Super Admin, buat satu (sandi acak, tampil sekali di log) */
function ensureSuperAdmin_() {
  if (DB.all('Users').some(function (u) { return u.role === 'superadmin'; })) return null;
  var e = emailSuperAdminBaru_(), pw = sandiAcak_(14), uid;
  withLock_(function () {
    uid = reserveIds_('Users', 1)[0];
    DB.appendBatch('Users', [{ user_id: uid, nama: 'Super Admin', email: e, role: 'superadmin', ref_id: '', kelas_id: '', status_aktif: 'YA', wajib_ganti_sandi: 'YA', last_login: '', dibuat_pada: nowIso_(), hak_akses: 'keuangan', catatan: 'Dibuat oleh setupV21()' }]);
    pwSimpan_(uid, pw);
    return ok_();
  });
  return { email: e, password: pw };
}

// ---------------------------------------------------------------------
// B. GEOFENCING MULTI-LOKASI
// ---------------------------------------------------------------------
var _LOK = null;
/** Lokasi aktif (cache berversi 'master'). Sheet kosong → titik bawaan dari Pengaturan. */
function lokasiAktif_() {
  if (_LOK) return _LOK;
  return (_LOK = cached_('lok_' + ver_('master'), 3600, function () {
    var rows = DB.all('Lokasi').filter(function (l) { return String(l.aktif || 'YA').toUpperCase() !== 'TIDAK' && l.latitude !== '' && l.longitude !== ''; })
      .map(function (l) { return { lokasi_id: l.lokasi_id, nama: l.nama, tipe: l.tipe || 'Sekolah', latitude: num_(l.latitude), longitude: num_(l.longitude), radius_m: num_(l.radius_m, 100) || 100, alamat: l.alamat || '', berlaku: l.berlaku || 'Semua' }; });
    if (!rows.length) rows = [{ lokasi_id: 'DEFAULT', nama: setting_('NAMA_SEKOLAH', 'Sekolah'), tipe: 'Sekolah', latitude: num_(setting_('LAT_SEKOLAH', 0)), longitude: num_(setting_('LNG_SEKOLAH', 0)), radius_m: num_(setting_('RADIUS_M', 100), 100), alamat: setting_('ALAMAT_SEKOLAH', ''), berlaku: 'Semua', bawaan: true }];
    return rows;
  }));
}
/** Lokasi yang berlaku untuk peran & akun (lokasi_ids per akun; kosong = semua) */
function lokasiUntuk_(peran, user) {
  var P = peran === 'siswa' ? 'Siswa' : 'Guru';
  var semua = lokasiAktif_().filter(function (l) { return l.berlaku === 'Semua' || l.berlaku === P; });
  var ids = String((user && user.l) || '').split(',').map(function (x) { return x.trim(); }).filter(String);
  if (!ids.length) return semua;
  var pilih = semua.filter(function (l) { return ids.indexOf(l.lokasi_id) > -1; });
  return pilih.length ? pilih : semua;
}
/** Cek posisi terhadap lokasi terdekat yang diizinkan. opt = { peran, user, acc } */
function cekLokasi_(lat, lng, opt) {
  opt = opt || {};
  var la = Number(lat), lo = Number(lng);
  if (lat === undefined || lat === null || lat === '' || lng === '' || lng === undefined || isNaN(la) || isNaN(lo)) return { ok: false, jarak: null, msg: 'Lokasi GPS belum terbaca. Aktifkan izin lokasi di browser.' };
  var daftar = lokasiUntuk_(opt.peran || 'siswa', opt.user);
  if (!daftar.length) return { ok: false, jarak: null, msg: 'Belum ada lokasi absensi untuk akun Anda. Hubungi Super Admin.' };
  var tol = Math.min(Math.max(num_(opt.acc, 0), 0), num_(setting_('GPS_TOLERANSI_M', 15), 15));
  var semua = daftar.map(function (l) { var j = Math.round(haversine_(la, lo, l.latitude, l.longitude)); return { lokasi_id: l.lokasi_id, nama: l.nama, jarak: j, radius: l.radius_m, selisih: j - l.radius_m }; })
    .sort(function (a, b) { return a.selisih - b.selisih; });
  var b = semua[0], ok = b.jarak <= b.radius + tol;
  return { ok: ok, jarak: b.jarak, radius: b.radius, lokasi_id: b.lokasi_id, nama: b.nama, toleransi: tol, semua: semua.slice(0, 5),
    msg: ok ? 'Dalam radius ' + b.nama + ' (' + b.jarak + ' m)' : 'Lokasi tidak sesuai area sekolah (' + b.jarak + ' m dari ' + b.nama + ', maks ' + b.radius + ' m).' };
}
/** Buat 1 lokasi dari LAT/LNG sekolah bila sheet Lokasi masih kosong (setupV21) */
function lokasiBawaan_() {
  if (DB.all('Lokasi').length) return '';
  var nama = setting_('NAMA_SEKOLAH', 'Sekolah');
  withLock_(function () {
    DB.appendBatch('Lokasi', [{ lokasi_id: reserveIds_('Lokasi', 1)[0], nama: nama, tipe: 'Sekolah', latitude: setting_('LAT_SEKOLAH', '-6.2088'), longitude: setting_('LNG_SEKOLAH', '106.8456'),
      radius_m: setting_('RADIUS_M', '100'), alamat: setting_('ALAMAT_SEKOLAH', ''), berlaku: 'Semua', aktif: 'YA', dibuat_oleh: 'setupV21', diperbarui_pada: nowIso_() }]);
    bump_('master');
    return ok_();
  });
  return nama;
}

function apiLokasiList(ctx, d) {
  var pakai = {};
  DB.all('Users').forEach(function (u) { String(u.lokasi_ids || '').split(',').forEach(function (id) { id = id.trim(); if (id) pakai[id] = (pakai[id] || 0) + 1; }); });
  return ok_({ rows: DB.all('Lokasi').map(function (l) { return Object.assign({}, l, { akun: pakai[l.lokasi_id] || 0 }); }), bawaan: lokasiAktif_()[0].bawaan ? lokasiAktif_()[0] : null,
    toleransi: num_(setting_('GPS_TOLERANSI_M', 15), 15), kunciPerangkat: setting_('KUNCI_PERANGKAT', 'TIDAK') === 'YA' });
}
function apiLokasiSave(ctx, d) {
  var x = d.row || {}, isNew = !x.lokasi_id;
  if (!String(x.nama || '').trim()) return fail_('Nama lokasi wajib diisi (contoh: Kampus Utama, Kantor Yayasan).');
  var la = Number(x.latitude), lo = Number(x.longitude), r = Number(x.radius_m);
  if (x.latitude === '' || isNaN(la) || Math.abs(la) > 90) return fail_('Latitude tidak valid.');
  if (x.longitude === '' || isNaN(lo) || Math.abs(lo) > 180) return fail_('Longitude tidak valid.');
  if (!(r >= 10 && r <= 5000)) return fail_('Radius harus 10–5000 meter.');
  var berlaku = ['Semua', 'Siswa', 'Guru'].indexOf(x.berlaku) > -1 ? x.berlaku : 'Semua';
  var row = { nama: String(x.nama).trim().substring(0, 80), tipe: x.tipe || 'Sekolah', latitude: String(Math.round(la * 1e6) / 1e6), longitude: String(Math.round(lo * 1e6) / 1e6), radius_m: String(Math.round(r)),
    alamat: String(x.alamat || '').substring(0, 200), berlaku: berlaku, aktif: String(x.aktif || 'YA').toUpperCase() === 'TIDAK' ? 'TIDAK' : 'YA', diperbarui_pada: nowIso_() };
  if (isNew) { row.lokasi_id = reserveIds_('Lokasi', 1)[0]; row.dibuat_oleh = ctx.session.email; DB.appendBatch('Lokasi', [row]); }
  else { if (!DB.find('Lokasi', 'lokasi_id', x.lokasi_id)) return fail_('Lokasi tidak ditemukan.'); row.lokasi_id = x.lokasi_id; DB.updateBatch('Lokasi', 'lokasi_id', [row]); }
  bump_('master');
  return ok_(row, isNew ? 'Lokasi ' + row.nama + ' ditambahkan.' : 'Lokasi diperbarui.');
}
function apiLokasiDelete(ctx, d) {
  var l = DB.find('Lokasi', 'lokasi_id', d.lokasi_id);
  if (!l) return fail_('Lokasi tidak ditemukan.');
  DB.deleteWhere('Lokasi', 'lokasi_id', [l.lokasi_id]);
  var up = DB.all('Users').filter(function (u) { return String(u.lokasi_ids || '').split(',').indexOf(l.lokasi_id) > -1; })
    .map(function (u) { return { user_id: u.user_id, lokasi_ids: String(u.lokasi_ids).split(',').filter(function (x) { return x && x !== l.lokasi_id; }).join(',') }; });
  DB.updateBatch('Users', 'user_id', up);
  bump_('master');
  return ok_({ akunDiperbarui: up.length }, 'Lokasi ' + l.nama + ' dihapus.' + (up.length ? ' ' + up.length + ' akun kembali memakai semua lokasi.' : ''));
}

/** Info geofence & perangkat untuk akun yang login (dipakai bootstrap & halaman Akun) */
function lokasiInfo_(ctx) {
  var u = ctx.user || {}, kunci = setting_('KUNCI_PERANGKAT', 'TIDAK') === 'YA';
  var peran = ctx.session && ctx.session.role === 'siswa' ? 'siswa' : 'guru';
  return {
    lokasi: lokasiUntuk_(peran, u).map(function (l) { return { lokasi_id: l.lokasi_id, nama: l.nama, tipe: l.tipe, latitude: l.latitude, longitude: l.longitude, radius_m: l.radius_m, alamat: l.alamat }; }),
    khusus: !!String(u.l || '').trim(),
    toleransi: num_(setting_('GPS_TOLERANSI_M', 15), 15),
    kunciPerangkat: kunci,
    perangkat: { terdaftar: !!u.d, cocok: !!u.d && !!ctx.dev && u.d === ctx.dev, perluDaftar: kunci && !u.d }
  };
}
function apiLokasiSaya(ctx, d) { return ok_(lokasiInfo_(ctx)); }

/** Kunci perangkat: perangkat pertama yang absen otomatis terdaftar; berbeda → ditolak */
function cekPerangkat_(ctx, info) {
  var dev = ctx.dev, u = ctx.user || {};
  if (setting_('KUNCI_PERANGKAT', 'TIDAK') !== 'YA') return { ok: true, dev: dev };
  if (!dev) return { ok: false, msg: 'Perangkat tidak dikenali. Muat ulang aplikasi lalu coba lagi.' };
  if (!u.d) {
    DB.updateBatch('Users', 'user_id', [{ user_id: ctx.session.uid, device_id: dev, device_info: String(info || '').substring(0, 120) + ' · ' + nowIso_().substring(0, 10) }]);
    u.d = dev;
    return { ok: true, dev: dev, baru: true };
  }
  if (u.d !== dev) return { ok: false, msg: 'Absensi hanya bisa dari perangkat yang terdaftar untuk akun Anda. Berganti HP? Minta Super Admin mereset perangkat.' };
  return { ok: true, dev: dev };
}
function apiPerangkatDaftar(ctx, d) {
  var u = ctx.user || {};
  if (!ctx.dev) return fail_('Perangkat tidak dikenali. Muat ulang aplikasi lalu coba lagi.');
  if (u.d && u.d === ctx.dev) return ok_(lokasiInfo_(ctx), 'Perangkat ini sudah terdaftar.');
  if (u.d && u.d !== ctx.dev) return fail_('Akun Anda sudah terdaftar di perangkat lain. Minta Super Admin mereset perangkat terlebih dahulu.', { code: 'DEVICE' });
  DB.updateBatch('Users', 'user_id', [{ user_id: ctx.session.uid, device_id: ctx.dev, device_info: String(d.device_info || '').substring(0, 120) + ' · ' + nowIso_().substring(0, 10) }]);
  u.d = ctx.dev;
  return ok_(lokasiInfo_(ctx), 'Perangkat ini berhasil didaftarkan untuk absensi.');
}

// ---------------------------------------------------------------------
// C. PRESENSI GURU (masuk / pulang) — geofence + kunci perangkat
// ---------------------------------------------------------------------
function guruDariCtx_(ctx) { return ctx.session.ref ? DB.find('Guru', 'NUPTK', ctx.session.ref) : null; }
function presensiHariIni_(uid) {
  var tdy = today_();
  return DB.all('PresensiGuru').filter(function (p) { return p.user_id === uid && String(p.tanggal) === tdy; })[0] || null;
}
function apiPresensiGuru(ctx, d) {
  var g = guruDariCtx_(ctx);
  if (!g) return fail_('Akun Anda belum terhubung ke data guru (NUPTK). Hubungi Super Admin.');
  var jenis = d.jenis === 'pulang' ? 'pulang' : 'masuk';
  var dev = cekPerangkat_(ctx, d.device_info);
  if (!dev.ok) return fail_(dev.msg, { code: 'DEVICE' });
  var lok = cekLokasi_(d.lat, d.lng, { peran: 'guru', user: ctx.user, acc: d.acc });
  if (!lok.ok) return fail_(lok.msg, { code: 'OUT_OF_RANGE', jarak: lok.jarak, lokasi: lok.nama });
  var tdy = today_(), jam = timeNow_(), ada = presensiHariIni_(ctx.session.uid);
  var fotoId = '';
  if (d.foto) {
    if (String(d.foto).length > 3 * 1024 * 1024) return fail_('Ukuran foto terlalu besar.');
    fotoId = saveBase64File_(CONFIG.SELFIE_FOLDER, 'GURU_' + g.NUPTK + '_' + tdy.replace(/-/g, '') + '_' + jam.replace(/:/g, '') + '.jpg', 'image/jpeg', d.foto).getId();
  } else if (jenis === 'masuk' && setting_('PRESENSI_GURU_SELFIE', 'TIDAK') === 'YA') return fail_('Presensi masuk wajib menyertakan foto selfie.', { code: 'SELFIE' });
  var row;
  if (jenis === 'masuk') {
    if (ada && ada.jam_masuk) return fail_('Anda sudah presensi masuk pukul ' + String(ada.jam_masuk).substring(0, 5) + '.', { code: 'DUPLICATE', row: ada });
    row = { user_id: ctx.session.uid, NUPTK: g.NUPTK, nama: g.nama_lengkap, tanggal: tdy, jam_masuk: jam, jam_pulang: '', status: 'Hadir', lokasi_id: lok.lokasi_id, latitude: d.lat, longitude: d.lng,
      jarak_m: lok.jarak, foto_id: fotoId, terlambat: jam.substring(0, 5) > setting_('JAM_MASUK_GURU', '07:00') ? 'YA' : 'TIDAK', device_id: ctx.dev || '', keterangan: String(d.keterangan || '').substring(0, 200), diperbarui_pada: nowIso_() };
    if (ada) { row.presensi_id = ada.presensi_id; DB.updateBatch('PresensiGuru', 'presensi_id', [row]); }
    else { row.presensi_id = reserveIds_('PresensiGuru', 1)[0]; DB.appendBatch('PresensiGuru', [row]); }
  } else {
    if (!ada || !ada.jam_masuk) return fail_('Belum ada presensi masuk hari ini.');
    if (ada.jam_pulang) return fail_('Anda sudah presensi pulang pukul ' + String(ada.jam_pulang).substring(0, 5) + '.', { code: 'DUPLICATE', row: ada });
    var awal = jam.substring(0, 5) < setting_('JAM_PULANG_GURU', '15:00');
    if (awal && !String(d.keterangan || '').trim()) return fail_('Presensi pulang dibuka pukul ' + setting_('JAM_PULANG_GURU', '15:00') + '. Untuk pulang lebih awal, isi alasan.', { code: 'EARLY' });
    row = Object.assign({}, ada, { jam_pulang: jam, keterangan: awal ? ('Pulang awal: ' + String(d.keterangan).substring(0, 180)) : ada.keterangan, diperbarui_pada: nowIso_() });
    DB.updateBatch('PresensiGuru', 'presensi_id', [{ presensi_id: ada.presensi_id, jam_pulang: jam, keterangan: row.keterangan, diperbarui_pada: row.diperbarui_pada }]);
  }
  bump_('presensi', true);
  var pesan = jenis === 'masuk' ? 'Presensi masuk tercatat pukul ' + jam.substring(0, 5) + (row.terlambat === 'YA' ? ' (terlambat)' : '') + ' di ' + lok.nama + '.' : 'Presensi pulang tercatat pukul ' + jam.substring(0, 5) + '. Terima kasih!';
  return ok_({ row: row, lokasi: lok.nama, jarak: lok.jarak, perangkatBaru: !!dev.baru }, pesan);
}
function apiPresensiSaya(ctx, d) {
  var dari = d.dari || Utilities.formatDate(new Date(Date.now() - 60 * 864e5), APP.TZ, 'yyyy-MM-dd');
  var rows = DB.all('PresensiGuru').filter(function (p) { return p.user_id === ctx.session.uid && String(p.tanggal) >= dari; })
    .sort(function (a, b) { return String(b.tanggal).localeCompare(String(a.tanggal)); });
  var bln = today_().substring(0, 7), ini = rows.filter(function (p) { return String(p.tanggal).substring(0, 7) === bln; });
  return ok_({ rows: rows, hariIni: presensiHariIni_(ctx.session.uid), ringkas: { hadir: ini.length, terlambat: ini.filter(function (p) { return p.terlambat === 'YA'; }).length, pulangAwal: ini.filter(function (p) { return /^Pulang awal/.test(p.keterangan); }).length },
    jamMasuk: setting_('JAM_MASUK_GURU', '07:00'), jamPulang: setting_('JAM_PULANG_GURU', '15:00'), selfie: setting_('PRESENSI_GURU_SELFIE', 'TIDAK') === 'YA' });
}
/** Rekap presensi guru (Super Admin): satu tanggal → semua guru aktif + status; rentang → baris presensi */
function apiPresensiList(ctx, d) {
  var dari = d.dari || today_(), sampai = d.sampai || dari, lokNama = {};
  lokasiAktif_().forEach(function (l) { lokNama[l.lokasi_id] = l.nama; });
  DB.all('Lokasi').forEach(function (l) { lokNama[l.lokasi_id] = l.nama; });
  var rows = DB.all('PresensiGuru').filter(function (p) { var t = String(p.tanggal); return t >= dari && t <= sampai && (!d.NUPTK || String(p.NUPTK) === String(d.NUPTK)); })
    .map(function (p) { return Object.assign({}, p, { lokasi: lokNama[p.lokasi_id] || p.lokasi_id }); })
    .sort(function (a, b) { return String(b.tanggal + b.jam_masuk).localeCompare(String(a.tanggal + a.jam_masuk)); });
  var harian = null;
  if (dari === sampai) {
    var per = {}; rows.forEach(function (p) { per[p.NUPTK] = p; });
    harian = DB.all('Guru').filter(function (g) { return (g.status || 'Aktif') === 'Aktif'; }).map(function (g) {
      var p = per[g.NUPTK];
      return { NUPTK: g.NUPTK, nama: g.nama_lengkap, mapel: g.mata_pelajaran, jabatan: g.jabatan, masuk: p ? p.jam_masuk : '', pulang: p ? p.jam_pulang : '', terlambat: p ? p.terlambat : '', lokasi: p ? p.lokasi : '', jarak_m: p ? p.jarak_m : '', keterangan: p ? p.keterangan : '', foto_id: p ? p.foto_id : '' };
    });
  }
  return ok_({ rows: rows.slice(0, 5000), harian: harian, dari: dari, sampai: sampai });
}

// ---------------------------------------------------------------------
// D. MONITORING SUPER ADMIN
// ---------------------------------------------------------------------
function seenAll_(uidx) {
  var keys = Object.keys(uidx).map(function (u) { return 'seen_' + u; }), out = {}, c = CacheService.getScriptCache();
  for (var i = 0; i < keys.length; i += 500) {
    var m = c.getAll(keys.slice(i, i + 500));
    Object.keys(m).forEach(function (k) { try { out[k.substring(5)] = JSON.parse(m[k]); } catch (e) {} });
  }
  return out;
}
function apiSaMonitor(ctx, d) {
  var tdy = today_(), now = Date.now(), uidx = userIdx_(), seen = seenAll_(uidx), ONLINE = 5 * 60e3;
  var uidByRef = {};
  Object.keys(uidx).forEach(function (id) { var u = uidx[id]; if (u.r !== 'siswa' && u.f) uidByRef[u.f] = id; });
  var lokNama = {}; DB.all('Lokasi').forEach(function (l) { lokNama[l.lokasi_id] = l.nama; }); lokNama.DEFAULT = setting_('NAMA_SEKOLAH', 'Sekolah');
  var presAll = DB.all('PresensiGuru'), pres = {};
  presAll.forEach(function (p) { if (String(p.tanggal) === tdy) pres[p.NUPTK] = p; });
  var guru = DB.all('Guru').filter(function (g) { return (g.status || 'Aktif') === 'Aktif'; }).map(function (g) {
    var id = uidByRef[g.NUPTK], u = uidx[id] || {}, p = pres[g.NUPTK], s = seen[id];
    return { NUPTK: g.NUPTK, nama: g.nama_lengkap, mapel: g.mata_pelajaran, jabatan: g.jabatan, foto: g.foto_profil_url, user_id: id || '', role: u.r || '', akunAktif: !!u.a,
      masuk: p ? String(p.jam_masuk).substring(0, 5) : '', pulang: p ? String(p.jam_pulang || '').substring(0, 5) : '', terlambat: p ? p.terlambat : '', lokasi: p ? (lokNama[p.lokasi_id] || p.lokasi_id) : '', jarak_m: p ? p.jarak_m : '',
      online: !!(s && now - s.t < ONLINE), terakhir: s ? s.t : 0, aksi: s ? s.a : '', perangkat: !!u.d };
  });
  // siswa: kehadiran hari ini per kelas
  var siswa = DB.all('Siswa').filter(function (s) { return (s.status || 'Aktif') === 'Aktif'; }), absT = {};
  DB.all('Absensi').forEach(function (a) { if (String(a.tanggal) === tdy) absT[a.NIS] = String(a.status).charAt(0).toUpperCase(); });
  var idx = absenIndex_(), perKelas = {};
  DB.all('Kelas').forEach(function (k) { perKelas[k.kelas_id] = { kelas_id: k.kelas_id, nama: k.nama_kelas, jenjang: k.jenjang, total: 0, H: 0, I: 0, S: 0, A: 0, belum: 0, sumPersen: 0, nPersen: 0 }; });
  siswa.forEach(function (s) {
    var k = perKelas[s.kelas_id] || (perKelas[s.kelas_id] = { kelas_id: s.kelas_id, nama: s.kelas_id || '-', total: 0, H: 0, I: 0, S: 0, A: 0, belum: 0, sumPersen: 0, nPersen: 0 });
    k.total++; var st = absT[s.NIS]; if (st && k[st] !== undefined) k[st]++; else k.belum++;
    var r = idx.rekap[s.NIS]; if (r && r.persen !== null) { k.sumPersen += r.persen; k.nPersen++; }
  });
  var kelas = Object.keys(perKelas).map(function (k) { var o = perKelas[k]; o.persenSemester = o.nPersen ? round1_(o.sumPersen / o.nPersen) : null; o.persenHariIni = o.total ? round1_(o.H / o.total * 100) : 0; delete o.sumPersen; delete o.nPersen; return o; })
    .filter(function (k) { return k.total > 0; });
  var online = Object.keys(seen).filter(function (id) { return uidx[id] && now - seen[id].t < ONLINE; })
    .map(function (id) { var u = uidx[id]; return { user_id: id, nama: u.n, role: u.r, aksi: seen[id].a, t: seen[id].t }; })
    .sort(function (a, b) { return b.t - a.t; });
  // tren presensi guru 7 hari
  var tren = [];
  for (var i = 6; i >= 0; i--) {
    var dt = new Date(new Date(tdy + 'T00:00:00+07:00').getTime() - i * 864e5), t = Utilities.formatDate(dt, APP.TZ, 'yyyy-MM-dd');
    var hadir = presAll.filter(function (p) { return String(p.tanggal) === t && p.jam_masuk; });
    tren.push({ tanggal: t, hari: HARI[Number(Utilities.formatDate(dt, APP.TZ, 'u')) % 7], hadir: hadir.length, terlambat: hadir.filter(function (p) { return p.terlambat === 'YA'; }).length });
  }
  var akun = { total: 0, aktif: 0, nonaktif: 0, superadmin: 0, guru: 0, siswa: 0, perangkat: 0 };
  Object.keys(uidx).forEach(function (id) { var u = uidx[id]; akun.total++; u.a ? akun.aktif++ : akun.nonaktif++; if (akun[u.r] !== undefined) akun[u.r]++; if (u.d) akun.perangkat++; });
  var hadirSiswa = siswa.filter(function (s) { return absT[s.NIS] === 'H'; }).length;
  return ok_({
    tanggal: tdy, jam: timeNow_().substring(0, 5), jamMasukGuru: setting_('JAM_MASUK_GURU', '07:00'),
    ringkas: { guruTotal: guru.length, guruHadir: guru.filter(function (g) { return g.masuk; }).length, guruTerlambat: guru.filter(function (g) { return g.terlambat === 'YA'; }).length,
      siswaTotal: siswa.length, siswaHadir: hadirSiswa, persenSiswa: siswa.length ? round1_(hadirSiswa / siswa.length * 100) : 0, online: online.length },
    guru: guru, kelas: kelas, online: online.slice(0, 100), aktivitas: logTerakhir_(40), trenGuru: tren, akun: akun,
    perhatian: siswa.map(function (s) { var r = idx.rekap[s.NIS]; return r && r.persen !== null && r.persen < num_(setting_('BATAS_KEHADIRAN', 75)) ? { NIS: s.NIS, nama: s.nama_lengkap, kelas_id: s.kelas_id, persen: r.persen } : null; })
      .filter(Boolean).sort(function (a, b) { return a.persen - b.persen; }).slice(0, 15)
  });
}

// ---------------------------------------------------------------------
// E. KELOLA AKUN (guru, siswa, super admin)
// ---------------------------------------------------------------------
var HAK_AKSES = { keuangan: 'Keuangan (Tagihan & Pembayaran)' };
function bersihHak_(h) { return String(h || '').split(',').map(function (x) { return x.trim().toLowerCase(); }).filter(function (x) { return HAK_AKSES[x]; }).filter(function (x, i, a) { return a.indexOf(x) === i; }).join(','); }
function bersihLokasiIds_(v) {
  var ada = {}; DB.all('Lokasi').forEach(function (l) { ada[l.lokasi_id] = 1; });
  return [].concat(Array.isArray(v) ? v : String(v || '').split(',')).map(function (x) { return String(x).trim(); }).filter(function (x) { return ada[x]; }).filter(function (x, i, a) { return a.indexOf(x) === i; }).join(',');
}
function saAktifLain_(kecuali) { return DB.all('Users').filter(function (u) { return u.role === 'superadmin' && String(u.status_aktif).toUpperCase() === 'YA' && kecuali.indexOf(u.user_id) === -1; }).length; }

function apiSaAkunList(ctx, d) {
  var kelas = {}; DB.all('Kelas').forEach(function (k) { kelas[k.kelas_id] = k.nama_kelas; });
  var uidx = userIdx_(), seen = seenAll_(uidx), now = Date.now();
  var rows = DB.all('Users').map(function (u) {
    var s = seen[u.user_id];
    return { user_id: u.user_id, nama: u.nama, email: u.email, role: u.role, ref_id: u.ref_id, kelas_id: u.kelas_id, kelas: kelas[u.kelas_id] || '', status_aktif: u.status_aktif, wajib_ganti_sandi: u.wajib_ganti_sandi,
      last_login: u.last_login, hak_akses: u.hak_akses || '', lokasi_ids: u.lokasi_ids || '', perangkat: !!u.device_id, device_info: u.device_info || '', catatan: u.catatan || '', dibuat_pada: u.dibuat_pada,
      online: !!(s && now - s.t < 5 * 60e3), terakhir: s ? s.t : 0 };
  });
  return ok_({ rows: rows, lokasi: DB.all('Lokasi').map(function (l) { return { lokasi_id: l.lokasi_id, nama: l.nama, berlaku: l.berlaku, aktif: l.aktif }; }), hak: HAK_AKSES, saya: ctx.session.uid });
}

function apiSaAkunSave(ctx, d) {
  var u = DB.find('Users', 'user_id', d.user_id);
  if (!u) return fail_('Akun tidak ditemukan.');
  var p = { user_id: u.user_id }, cabut = false, diri = u.user_id === ctx.session.uid;
  if (d.nama !== undefined) { if (!String(d.nama).trim()) return fail_('Nama wajib diisi.'); p.nama = String(d.nama).trim().substring(0, 80); }
  if (d.email !== undefined && lower_(d.email) !== lower_(u.email)) {
    var e = lower_(d.email);
    if (!emailValid_(e)) return fail_('Format email tidak valid.');
    if (DB.all('Users').some(function (x) { return lower_(x.email) === e && x.user_id !== u.user_id; })) return fail_('Email sudah dipakai akun lain.');
    p.email = e; cabut = true;
  }
  if (d.role !== undefined && d.role !== u.role) {
    if (u.role === 'siswa' || d.role === 'siswa' || !ROLES[d.role]) return fail_('Peran siswa tidak bisa diubah. Hanya Guru ⇄ Super Admin.');
    if (d.role === 'guru' && !u.ref_id) return fail_('Akun ini tidak terhubung ke data guru, sehingga tidak bisa dijadikan Guru.');
    if (u.role === 'superadmin' && (diri || !saAktifLain_([u.user_id]))) return fail_(diri ? 'Tidak bisa menurunkan peran akun Anda sendiri.' : 'Minimal harus ada satu Super Admin aktif.');
    p.role = d.role; cabut = true;
  }
  if (d.status_aktif !== undefined) {
    var st = String(d.status_aktif).toUpperCase() === 'YA' ? 'YA' : 'TIDAK';
    if (st === 'TIDAK' && diri) return fail_('Tidak bisa menonaktifkan akun Anda sendiri.');
    if (st === 'TIDAK' && u.role === 'superadmin' && !saAktifLain_([u.user_id])) return fail_('Minimal harus ada satu Super Admin aktif.');
    p.status_aktif = st; if (st === 'TIDAK') cabut = true;
  }
  if (d.hak_akses !== undefined) p.hak_akses = bersihHak_(d.hak_akses);
  if (d.lokasi_ids !== undefined) p.lokasi_ids = bersihLokasiIds_(d.lokasi_ids);
  if (d.catatan !== undefined) p.catatan = String(d.catatan).substring(0, 200);
  if (d.wajib_ganti_sandi !== undefined) p.wajib_ganti_sandi = d.wajib_ganti_sandi ? 'YA' : 'TIDAK';
  DB.updateBatch('Users', 'user_id', [p]);
  if (p.email || p.nama) {                                  // sinkron ke data induk
    if (u.role === 'siswa') DB.updateBatch('Siswa', 'NIS', [Object.assign({ NIS: u.ref_id }, p.email ? { email: p.email } : {}, p.nama ? { nama_lengkap: p.nama } : {})]);
    else if (u.ref_id && DB.find('Guru', 'NUPTK', u.ref_id)) DB.updateBatch('Guru', 'NUPTK', [Object.assign({ NUPTK: u.ref_id }, p.email ? { email: p.email } : {}, p.nama ? { nama_lengkap: p.nama } : {})]);
  }
  if (cabut) revokeAll_(lower_(u.email));
  bump_('master');
  var res = ok_(Object.assign({}, u, p, { password_hash: undefined, salt: undefined }), 'Akun ' + (p.nama || u.nama) + ' diperbarui.' + (cabut ? ' Sesi lama akun ini dikeluarkan.' : ''));
  res.auditTarget = u.user_id;
  return res;
}

function apiSaAkunCreate(ctx, d) {
  var nama = String(d.nama || '').trim(), e = lower_(d.email);
  if (!nama) return fail_('Nama wajib diisi.');
  if (!emailValid_(e)) return fail_('Format email tidak valid.');
  if (DB.all('Users').some(function (x) { return lower_(x.email) === e; })) return fail_('Email sudah dipakai akun lain.');
  var pw = String(d.password || '').trim();
  if (pw) { var lemah = kuatSandi_('superadmin', pw); if (lemah) return fail_(lemah); } else pw = sandiAcak_(14);
  var uid = reserveIds_('Users', 1)[0];
  DB.appendBatch('Users', [{ user_id: uid, nama: nama, email: e, role: 'superadmin', ref_id: '', kelas_id: '', status_aktif: 'YA', wajib_ganti_sandi: 'YA', last_login: '', dibuat_pada: nowIso_(),
    hak_akses: bersihHak_(d.hak_akses || 'keuangan'), catatan: String(d.catatan || '').substring(0, 200) }]);
  pwSimpan_(uid, pw);
  bump_('master');
  var res = ok_({ user_id: uid, akun: { email: e, password: pw } }, 'Akun Super Admin ' + nama + ' dibuat.');
  res.auditTarget = uid;
  return res;
}

function apiSaAkunReset(ctx, d) {
  var u = DB.find('Users', 'user_id', d.user_id);
  if (!u) return fail_('Akun tidak ditemukan.');
  var pw = String(d.password || '').trim();
  if (pw) { var lemah = kuatSandi_(u.role, pw); if (lemah) return fail_(lemah); }
  else pw = u.role === 'superadmin' ? sandiAcak_(14) : randomPassword_(8);
  pwSimpan_(u.user_id, pw);
  DB.updateBatch('Users', 'user_id', [{ user_id: u.user_id, wajib_ganti_sandi: 'YA', status_aktif: 'YA' }]);
  delProp_('SA_KUNCI_' + u.user_id);
  revokeAll_(lower_(u.email));
  if (d.kirim) kirimNotif_('RESET_SANDI_ADMIN', kontakUser_(u), { username: u.email, sandi: pw }, u.user_id);
  bump_('master');
  var res = ok_({ akun: { email: u.email, password: pw }, nama: u.nama }, 'Sandi baru dibuat untuk ' + u.nama + '. Sesi lamanya dikeluarkan.');
  res.auditTarget = u.user_id;
  return res;
}
function apiSaAkunLogout(ctx, d) {
  var u = DB.find('Users', 'user_id', d.user_id);
  if (!u) return fail_('Akun tidak ditemukan.');
  revokeAll_(lower_(u.email));
  var res = ok_(null, u.nama + ' dikeluarkan dari semua perangkat.'); res.auditTarget = u.user_id; return res;
}
function apiSaAkunDevice(ctx, d) {
  var u = DB.find('Users', 'user_id', d.user_id);
  if (!u) return fail_('Akun tidak ditemukan.');
  DB.updateBatch('Users', 'user_id', [{ user_id: u.user_id, device_id: '', device_info: '' }]);
  var res = ok_(null, 'Perangkat ' + u.nama + ' direset. Perangkat berikutnya yang dipakai absen akan terdaftar otomatis.'); res.auditTarget = u.user_id; return res;
}
function apiSaAkunDelete(ctx, d) {
  var u = DB.find('Users', 'user_id', d.user_id);
  if (!u) return fail_('Akun tidak ditemukan.');
  if (u.user_id === ctx.session.uid) return fail_('Tidak bisa menghapus akun Anda sendiri.');
  if (u.role !== 'superadmin') return fail_('Akun guru/siswa dihapus dari menu Data Guru / Data Siswa agar data induknya ikut rapi.');
  if (!saAktifLain_([u.user_id])) return fail_('Minimal harus ada satu Super Admin aktif.');
  revokeAll_(lower_(u.email));
  DB.deleteWhere('Users', 'user_id', [u.user_id]);
  bump_('master');
  var res = ok_(null, 'Akun ' + u.nama + ' dihapus.'); res.auditTarget = u.user_id; return res;
}
function apiSaAkunBulk(ctx, d) {
  var ids = [].concat(d.ids || []).map(String), aksi = d.aksi;
  if (!ids.length) return fail_('Belum ada akun yang dipilih.');
  var set = {}; ids.forEach(function (x) { set[x] = 1; });
  var users = DB.all('Users').filter(function (u) { return set[u.user_id]; });
  if (aksi === 'nonaktifkan') {
    if (set[ctx.session.uid]) return fail_('Akun Anda sendiri ikut terpilih — hapus centangnya dulu.');
    var saKena = users.filter(function (u) { return u.role === 'superadmin'; }).map(function (u) { return u.user_id; });
    if (saKena.length && !saAktifLain_(saKena)) return fail_('Minimal harus ada satu Super Admin aktif.');
  }
  var patch = null, n = users.length;
  if (aksi === 'aktifkan') patch = function (u) { return { user_id: u.user_id, status_aktif: 'YA' }; };
  else if (aksi === 'nonaktifkan') patch = function (u) { return { user_id: u.user_id, status_aktif: 'TIDAK' }; };
  else if (aksi === 'resetPerangkat') patch = function (u) { return { user_id: u.user_id, device_id: '', device_info: '' }; };
  else if (aksi === 'wajibGanti') patch = function (u) { return { user_id: u.user_id, wajib_ganti_sandi: 'YA' }; };
  else if (aksi === 'setLokasi') { var l = bersihLokasiIds_(d.nilai); patch = function (u) { return { user_id: u.user_id, lokasi_ids: l }; }; }
  else if (aksi !== 'logout') return fail_('Aksi massal tidak dikenal.');
  if (patch) DB.updateBatch('Users', 'user_id', users.map(patch));
  if (aksi === 'logout' || aksi === 'nonaktifkan') users.forEach(function (u) { revokeAll_(lower_(u.email)); });
  bump_('master');
  return ok_({ n: n }, 'Aksi diterapkan ke ' + n + ' akun.');
}

// ---------------------------------------------------------------------
// F. RAHASIA PIHAK KETIGA (R5) — allowlist, respons tersamar, tidak pernah dicatat
// ---------------------------------------------------------------------
var RAHASIA_DASHBOARD = {
  FONNTE_TOKEN: { label: 'Token Fonnte (WhatsApp)', pola: /^[^\s]{10,200}$/, pesan: 'Token Fonnte tidak valid (10–200 karakter tanpa spasi).' }
  // tambahkan API key lain di sini — JANGAN pernah TOKEN_SECRET / QR_SECRET / PW_* / SPREADSHEET_ID
};
/** '' bila berhasil, atau pesan galat */
function simpanRahasia_(k, nilai) {
  var aturan = RAHASIA_DASHBOARD[k];
  if (!aturan) return 'Kunci tidak diizinkan.';
  if (nilai === '__HAPUS__') { delProp_(k); return ''; }
  var v = String(nilai || '').trim();
  if (!v) return 'Nilai kosong — tidak ada yang diubah.';
  if (aturan.pola && !aturan.pola.test(v)) return aturan.pesan || 'Format tidak valid.';
  setProp_(k, v);
  return '';
}
function apiRahasiaStatus(ctx, d) {
  var items = Object.keys(RAHASIA_DASHBOARD).map(function (k) { return { kunci: k, label: RAHASIA_DASHBOARD[k].label, ada: !!prop_(k), samar: samarkan_(prop_(k)) }; });
  var sa = DB.all('Users').filter(function (u) { return u.role === 'superadmin'; });
  return ok_({ items: items,
    internal: [{ label: 'Secret sesi (TOKEN_SECRET)', ada: !!prop_('TOKEN_SECRET') }, { label: 'Secret QR kwitansi (QR_SECRET)', ada: !!prop_('QR_SECRET') }],
    superadmin: sa.map(function (u) { return { nama: u.nama, email: u.email, aktif: u.status_aktif === 'YA', terkunci: Number(prop_('SA_KUNCI_' + u.user_id) || 0) > Date.now() }; }),
    sesiJam: APP.TOKEN_TTL_MS / 3600e3, hashIterasi: APP.HASH_ITER });
}
function apiRahasiaSimpan(ctx, d) {
  var k = String(d.kunci || ''), e = simpanRahasia_(k, d.nilai);
  if (e) return fail_(e);
  var res = ok_({ kunci: k, ada: !!prop_(k), samar: samarkan_(prop_(k)) }, 'Tersimpan di Script Properties.');
  res.auditDetail = 'Rahasia:' + k + ' ' + (d.nilai === '__HAPUS__' ? 'dihapus' : 'diperbarui');   // nilai TIDAK dicatat
  return res;
}
function apiRahasiaRotasiSesi(ctx, d) {
  if (d.konfirmasi !== 'ROTASI') return fail_('Ketik ROTASI untuk konfirmasi.');
  setProp_('TOKEN_SECRET', acak_(64));
  return ok_({ logout: true }, 'Secret sesi dirotasi. Semua pengguna (termasuk Anda) harus login ulang.');
}

// ---------------------------------------------------------------------
// G. NOTIFIKASI IN-APP (lonceng)
// ---------------------------------------------------------------------
/** rows: [{ user_id, judul, pesan, tipe, link }] — 1 kali tulis */
function notifApp_(rows) {
  rows = (rows || []).filter(function (n) { return n && n.user_id; });
  if (!rows.length) return 0;
  var ids = reserveIds_('Notifikasi', rows.length), t = nowIso_();
  DB.appendBatch('Notifikasi', rows.map(function (n, i) { return { notif_id: ids[i], user_id: n.user_id, judul: String(n.judul || '').substring(0, 120), pesan: String(n.pesan || '').substring(0, 500), tipe: n.tipe || 'info', link: n.link || '', dibaca: 'TIDAK', tanggal: t }; }));
  bump_('notif');
  return rows.length;
}
function notifBelum_(uid) {
  var idx = cached_('ntfidx_' + ver_('notif'), 21600, function () {
    var o = {}; DB.all('Notifikasi').forEach(function (n) { if (n.dibaca !== 'YA') o[n.user_id] = (o[n.user_id] || 0) + 1; }); return o;
  });
  return idx[uid] || 0;
}
function apiNotifMine(ctx, d) {
  var rows = DB.all('Notifikasi').filter(function (n) { return n.user_id === ctx.session.uid; }).sort(function (a, b) { return String(b.tanggal).localeCompare(String(a.tanggal)); });
  return ok_({ rows: rows.slice(0, 40), belum: rows.filter(function (n) { return n.dibaca !== 'YA'; }).length });
}
function apiNotifRead(ctx, d) {
  var ids = d.ids ? [].concat(d.ids).map(String) : null;
  var up = DB.all('Notifikasi').filter(function (n) { return n.user_id === ctx.session.uid && n.dibaca !== 'YA' && (!ids || ids.indexOf(n.notif_id) > -1); }).map(function (n) { return { notif_id: n.notif_id, dibaca: 'YA' }; });
  if (up.length) { DB.updateBatch('Notifikasi', 'notif_id', up); bump_('notif'); }
  return ok_({ n: up.length });
}

;
// ==== Tagihan.gs ====
/**
 * =====================================================================
 *  SIAKAD SISWA v2.1 — File 4/7 : Tagihan.gs  (gas-tagihan-pembayaran)
 *  Tagihan & Pembayaran dengan JENIS BIAYA CUSTOM (master Biaya):
 *   • Bulanan (SPP, uang makan, antar-jemput…) — centang bulan apa saja,
 *     1 baris per siswa × kode (KodeTagihan = KODE-yyyy-MM)
 *   • Sekali bayar (uang pangkal, seragam, study tour…) atau ad-hoc
 *   • Nominal khusus per jenjang / kelas / siswa, potongan & beasiswa
 *   • 1 bukti transfer untuk banyak tagihan, verifikasi semua-atau-tidak
 *   • Kwitansi bernomor + QR ber-HMAC (QR_SECRET di Script Properties)
 *   • Pengingat H-3 / H-0 + tandai Terlambat otomatis
 *  Subjek = Siswa (NIS). WA dikirim ke orang tua (no_wa_ortu).
 * =====================================================================
 */

var TG = {
  subjek: { tabel: 'Siswa', id: 'NIS', nama: 'nama_lengkap', nomor: 'NIS', hp: 'no_wa_ortu', hp2: 'no_wa', email: 'email',
    aktif: function (r) { return (r.status || 'Aktif') === 'Aktif'; } },
  label: 'Siswa',
  maksBulan: 24
};
var TG_SID = 'NIS';
var TG_BELUM = { 'Belum Bayar': 1, 'Terlambat': 1 };
var TG_TANPA_REMINDER = { 'Lunas': 1, 'Gratis': 1, 'Menunggu Verifikasi': 1 };
var TG_BISA_BATAL = { 'Belum Bayar': 1, 'Terlambat': 1, 'Gratis': 1 };
var TG_BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
var TG_SETTING = /^(JATUH_TEMPO_TANGGAL|REKENING_BANK|NAMA_BENDAHARA|KWITANSI_PREFIX|REMINDER_OTOMATIS|REMINDER_JAM|REMINDER_H3|REMINDER_H0)$/;

// ---------------------------------------------------------------------
// 1. HELPER
// ---------------------------------------------------------------------
function tgLabel_(per) { var m = String(per || '').match(/^(\d{4})-(\d{2})/); return m ? TG_BULAN[parseInt(m[2], 10) - 1] + ' ' + m[1] : String(per || ''); }
function tgRp_(n) { return 'Rp ' + Math.round(uang_(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
function tgU_(ctx) { return { UserID: ctx.session ? ctx.session.uid : '', Role: ctx.session ? ctx.session.role : '', Nama: (ctx.user && ctx.user.n) || (ctx.session && ctx.session.email) || 'Sistem' }; }
function tgDaftarPeriode_(p) {
  var a = [].concat(p.periodeList || []);
  if (!a.length && p.periode) a = [p.periode];
  var set = {};
  a.forEach(function (x) { var s = String(x === null || x === undefined ? '' : x).trim().substring(0, 7); if (/^\d{4}-(0[1-9]|1[0-2])$/.test(s)) set[s] = 1; });
  return Object.keys(set).sort().slice(0, TG.maksBulan);
}
function tgIds_(x, maks) {
  var out = [];
  [].concat(x || []).forEach(function (v) { var s = String(v === null || v === undefined ? '' : v).trim(); if (s && out.indexOf(s) === -1) out.push(s); });
  return out.slice(0, maks || 3000);
}
function tgPetaSubjek_() { var m = {}; DB.all('Siswa').forEach(function (r) { m[r.NIS] = r; }); return m; }
function tgPetaKelas_() { var m = {}; DB.all('Kelas').forEach(function (k) { m[k.kelas_id] = k.nama_kelas; }); return m; }
/** NIS → user_id akun siswa (untuk notifikasi in-app) */
function tgUserOf_() { var m = {}, u = userIdx_(); Object.keys(u).forEach(function (id) { if (u[id].r === 'siswa') m[u[id].f] = id; }); return m; }
function tgWA_(event, daftar) { return typeof kirimNotifBatch_ === 'function' ? kirimNotifBatch_(event, daftar) : 0; }
function tgPenerima_(s) { return { nama: s.nama_lengkap, hp: s.no_wa_ortu || s.no_wa, email: s.email }; }
function tgFileUrl_(id) { return id ? 'https://drive.google.com/file/d/' + id + '/view' : ''; }
function tgThumbUrl_(id, w) { return id ? 'https://drive.google.com/thumbnail?id=' + id + '&sz=w' + (w || 480) : ''; }
function tgBiaya_(kode) { var k = String(kode || '').trim().toUpperCase(); return DB.all('Biaya').filter(function (b) { return String(b.kode).toUpperCase() === k; })[0] || null; }
function tgKhusus_(b) { try { var o = typeof b.nominal_khusus === 'object' ? b.nominal_khusus : JSON.parse(b.nominal_khusus || '{}'); return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; } }
/** Nominal per siswa: NIS › KELAS › JENJANG › nominal dasar */
function tgHarga_(b, s) {
  var k = tgKhusus_(b), keys = ['NIS:' + s.NIS, 'KELAS:' + s.kelas_id, 'JENJANG:' + s.jenjang];
  for (var i = 0; i < keys.length; i++) if (k[keys[i]] !== undefined && k[keys[i]] !== '') return uang_(k[keys[i]]);
  return uang_(b.nominal);
}
/** Potongan/beasiswa yang berlaku untuk 1 tagihan */
function tgPotongan_(daftar, nis, jenis, biayaKode, kode, periode, harga) {
  var pot = 0, alasan = [];
  daftar.forEach(function (p) {
    if (String(p.NIS) !== String(nis) || String(p.Aktif).toUpperCase() !== 'YA') return;
    var b = String(p.Berlaku || 'Semua');
    if (!(b === 'Semua' || b === jenis || b === 'KODE:' + biayaKode || b === 'KODE:' + kode)) return;
    if (jenis === 'Bulanan' && ((p.Mulai && periode < p.Mulai) || (p.Sampai && periode > p.Sampai))) return;
    pot += p.Tipe === 'Gratis' ? harga : p.Tipe === 'Persen' ? Math.round(harga * uang_(p.Nilai) / 100) : uang_(p.Nilai);
    if (p.Alasan) alasan.push(p.Alasan);
  });
  pot = Math.max(0, Math.min(pot, harga));
  return { potongan: pot, jumlah: harga - pot, alasan: alasan.join('; ') };
}
function tgSasaran_(p) {
  var kelas = tgIds_(p.kelas_ids || p.kelas_id), jenjang = String(p.jenjang || '');
  return DB.all('Siswa').filter(TG.subjek.aktif).filter(function (s) { return (!kelas.length || kelas.indexOf(s.kelas_id) > -1) && (!jenjang || s.jenjang === jenjang); });
}
/** Susun rencana terbit dari payload. Bulanan: {biayaKode, periodeList}. Sekali: {biayaKode, nominal?, jatuhTempo?, sufiks?} atau ad-hoc {jenis:'Sekali', kode, nama, nominal, jatuhTempo} */
function tgRencana_(p) {
  var b = p.biayaKode ? tgBiaya_(p.biayaKode) : null;
  if (p.biayaKode && !b) return { err: 'Jenis biaya ' + p.biayaKode + ' tidak ditemukan.' };
  if (b && String(b.aktif || 'YA').toUpperCase() === 'TIDAK') return { err: 'Jenis biaya ' + b.nama + ' sedang nonaktif.' };
  var sekali = b ? b.jenis === 'Sekali' : p.jenis === 'Sekali';
  if (!sekali && !b) return { err: 'Pilih jenis biaya bulanan dari daftar Biaya.' };
  if (!sekali) {
    var daftar = tgDaftarPeriode_(p);
    if (!daftar.length) return { err: 'Pilih minimal satu bulan tagihan.' };
    var tgl = ('0' + Math.min(28, Math.max(1, parseInt(b.jatuh_tempo_tgl || setting_('JATUH_TEMPO_TANGGAL', '10'), 10) || 10))).slice(-2);
    return { sekali: false, b: b, items: daftar.map(function (per) { return { kode: b.kode + '-' + per, periode: per, nama: b.nama + ' ' + tgLabel_(per), jatuhTempo: per + '-' + tgl }; }), daftar: daftar, tgl: tgl };
  }
  var kode = b ? String(b.kode + (p.sufiks ? '-' + p.sufiks : '')).trim().toUpperCase() : String(p.kode || '').trim().toUpperCase();
  var nama = String(p.nama || (b ? b.nama + (p.sufiks ? ' ' + p.sufiks : '') : '')).trim();
  var jt = String(p.jatuhTempo || (b ? b.jatuh_tempo : '') || '');
  if (!/^[A-Z0-9][A-Z0-9-]{1,40}$/.test(kode)) return { err: 'Kode tagihan wajib (huruf/angka/tanda -, mis. UP-2026).' };
  if (!nama) return { err: 'Nama tagihan wajib diisi.' };
  if (!b && (p.nominal === undefined || String(p.nominal) === '' || !(uang_(p.nominal) >= 0))) return { err: 'Nominal tagihan wajib diisi.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(jt)) return { err: 'Tanggal jatuh tempo wajib (yyyy-MM-dd).' };
  var override = p.nominal !== undefined && String(p.nominal) !== '' ? uang_(p.nominal) : null;
  return { sekali: true, b: b, override: override, items: [{ kode: kode, periode: '', nama: nama, jatuhTempo: jt }], daftar: [], kode: kode };
}
function tgHargaRencana_(rc, s) { return rc.override !== null && rc.override !== undefined ? rc.override : rc.b ? tgHarga_(rc.b, s) : 0; }

// ---------------------------------------------------------------------
// 2. DAFTAR & RINGKASAN
// ---------------------------------------------------------------------
function svcTgList(ctx, p) {
  var subjek = tgPetaSubjek_(), kelas = tgPetaKelas_(), rows = DB.all('Tagihan');
  if (p.periode) rows = rows.filter(function (t) { return String(t.Periode) === p.periode; });
  if (p.jenis) rows = rows.filter(function (t) { return t.Jenis === p.jenis; });
  if (p.status) rows = rows.filter(function (t) { return p.status === 'Belum' ? TG_BELUM[t.Status] : t.Status === p.status; });
  if (p.biayaKode) rows = rows.filter(function (t) { return t.BiayaKode === p.biayaKode || String(t.KodeTagihan).indexOf(p.biayaKode) === 0; });
  if (p.kelas_id) rows = rows.filter(function (t) { return (t.kelas_id || (subjek[t.NIS] || {}).kelas_id) === p.kelas_id; });
  if (p.NIS) rows = rows.filter(function (t) { return String(t.NIS) === String(p.NIS); });
  var hasil = rows.map(function (t) { var s = subjek[t.NIS] || {}; var k = t.kelas_id || s.kelas_id; return Object.assign({}, t, { Nama: s.nama_lengkap || '-', Nomor: t.NIS, kelas_id: k, Kelas: kelas[k] || k || '' }); });
  if (p.cari) {
    var q = String(p.cari).toLowerCase();
    hasil = hasil.filter(function (t) { return [t.Nama, t.Nomor, t.TagihanID, t.NamaTagihan, t.Kelas].join(' ').toLowerCase().indexOf(q) > -1; });
  }
  if (p.denganBukti) hasil = tgTambahBukti_(hasil);
  var jumlah = function (st) { return hasil.filter(function (t) { return st[t.Status]; }).reduce(function (s, t) { return s + uang_(t.Jumlah); }, 0); };
  var menunggu = {};
  DB.filter('Pembayaran', function (b) { return b.Status === 'Menunggu'; }).forEach(function (b) { menunggu[b.GrupBayar || b.PembayaranID] = 1; });   // 1 bukti = 1 transaksi
  return ok_({
    rows: hasil.sort(function (a, b) { return String(b.TanggalTerbit).localeCompare(String(a.TanggalTerbit)) || String(a.Nama).localeCompare(String(b.Nama)); }),
    ringkasan: {
      totalTagihan: hasil.reduce(function (s, t) { return s + uang_(t.Jumlah); }, 0),
      terkumpul: jumlah({ 'Lunas': 1 }), tunggakan: jumlah(TG_BELUM), menunggu: jumlah({ 'Menunggu Verifikasi': 1 }),
      totalPotongan: hasil.reduce(function (s, t) { return s + uang_(t.Potongan); }, 0),
      jumlahLunas: hasil.filter(function (t) { return t.Status === 'Lunas'; }).length,
      jumlahGratis: hasil.filter(function (t) { return t.Status === 'Gratis'; }).length,
      jumlahBelum: hasil.filter(function (t) { return TG_BELUM[t.Status]; }).length,
      jumlahTerlambat: hasil.filter(function (t) { return t.Status === 'Terlambat'; }).length,
      menungguVerifikasi: Object.keys(menunggu).length
    },
    periodeAda: Object.keys(DB.all('Tagihan').reduce(function (o, t) { if (t.Periode) o[t.Periode] = 1; return o; }, {})).sort().reverse()
  });
}

function svcTgMine(ctx, p) {
  var s = DB.find('Siswa', 'NIS', ctx.session.ref);
  if (!s) return fail_('Data siswa tidak ditemukan.');
  var tagihan = DB.filter('Tagihan', function (t) { return String(t.NIS) === String(s.NIS); })
    .sort(function (a, b) { return String(b.JatuhTempo).localeCompare(String(a.JatuhTempo)); });
  var bayar = DB.filter('Pembayaran', function (b) { return String(b.NIS) === String(s.NIS); });
  return ok_({
    tagihan: tagihan.map(function (t) { return Object.assign({}, t, { pembayaran: bayar.filter(function (b) { return b.TagihanID === t.TagihanID; }).map(function (b) { return { PembayaranID: b.PembayaranID, Status: b.Status, Catatan: b.Catatan, TanggalBayar: b.TanggalBayar, NoKwitansi: b.NoKwitansi }; }) }); }),
    transaksi: tgRiwayat_(s.NIS).transaksi,
    rekening: setting_('REKENING_BANK', ''),
    totalTunggakan: tagihan.filter(function (t) { return TG_BELUM[t.Status]; }).reduce(function (x, t) { return x + uang_(t.Jumlah); }, 0)
  });
}
/** Ringkasan tagihan per siswa (cache berversi 'tagihan') — untuk kartu di dashboard siswa */
function tgRingkasSiswa_(nis) {
  var idx = cached_('tgidx_' + ver_('tagihan'), 21600, function () {
    var o = {};
    DB.all('Tagihan').forEach(function (t) {
      var r = o[t.NIS] = o[t.NIS] || [0, 0, 0, ''];
      if (TG_BELUM[t.Status]) { r[0]++; r[1] += uang_(t.Jumlah); if (!r[3] || String(t.JatuhTempo) < r[3]) r[3] = String(t.JatuhTempo); }
      if (t.Status === 'Menunggu Verifikasi') r[2]++;
    });
    return o;
  });
  var r = idx[nis] || [0, 0, 0, ''];
  return { belum: r[0], tunggakan: r[1], menunggu: r[2], jatuhTempo: r[3] };
}

// ---------------------------------------------------------------------
// 3. PENERBITAN
// ---------------------------------------------------------------------
function svcTgEligible(ctx, p) {
  var rc = tgRencana_(p);
  if (rc.err) return fail_(rc.err);
  var ada = {}; DB.all('Tagihan').forEach(function (t) { ada[t.NIS + '|' + t.KodeTagihan] = 1; });
  var potongan = DB.all('PotonganTagihan'), kelas = tgPetaKelas_();
  var rows = tgSasaran_(p).map(function (s) {
    var baru = rc.items.filter(function (it) { return !ada[s.NIS + '|' + it.kode]; });
    var harga = tgHargaRencana_(rc, s), total = 0, pot = 0;
    baru.forEach(function (it) { var x = tgPotongan_(potongan, s.NIS, rc.sekali ? 'Sekali' : 'Bulanan', rc.b ? rc.b.kode : it.kode, it.kode, it.periode, harga); total += x.jumlah; pot += x.potongan; });
    return { NIS: s.NIS, Nama: s.nama_lengkap, kelas_id: s.kelas_id, Kelas: kelas[s.kelas_id] || s.kelas_id, Harga: harga, kodeBaru: baru.map(function (it) { return it.kode; }), periodeBaru: baru.map(function (it) { return it.periode; }), Potongan: pot, Total: total };
  }).filter(function (r) { return r.kodeBaru.length > 0; });
  return ok_({ jenis: rc.sekali ? 'Sekali' : 'Bulanan', periodeList: rc.daftar, kode: rc.kode || '', biaya: rc.b ? { kode: rc.b.kode, nama: rc.b.nama } : null, rows: rows,
    jumlahTagihan: rows.reduce(function (s, r) { return s + r.kodeBaru.length; }, 0), estimasi: rows.reduce(function (s, r) { return s + r.Total; }, 0) });
}

function svcTgTerbit(ctx, p, semua) {
  var rc = tgRencana_(p);
  if (rc.err) return fail_(rc.err);
  var u = tgU_(ctx);
  var ada = {}; DB.all('Tagihan').forEach(function (t) { ada[t.NIS + '|' + t.KodeTagihan] = 1; });
  var target = tgSasaran_(semua ? p : {});
  if (!semua) { var ids = tgIds_(p.subjekIds || p.nisList); if (!ids.length) return fail_('Pilih minimal satu siswa.'); target = target.filter(function (s) { return ids.indexOf(String(s.NIS)) > -1; }); }
  var baru = [];
  target.forEach(function (s) { rc.items.forEach(function (it) { if (!ada[s.NIS + '|' + it.kode]) baru.push({ s: s, it: it }); }); });
  if (!baru.length) return ok_({ dibuat: 0 }, 'Tidak ada tagihan baru — semua sudah diterbitkan.');
  var potongan = DB.all('PotonganTagihan'), idBaru = reserveIds_('Tagihan', baru.length), tdy = today_();
  var rows = baru.map(function (x, i) {
    var harga = tgHargaRencana_(rc, x.s), jenis = rc.sekali ? 'Sekali' : 'Bulanan';
    var pot = tgPotongan_(potongan, x.s.NIS, jenis, rc.b ? rc.b.kode : x.it.kode, x.it.kode, x.it.periode, harga), gratis = pot.jumlah === 0;
    return { TagihanID: idBaru[i], NIS: x.s.NIS, Jenis: jenis, BiayaKode: rc.b ? rc.b.kode : '', Periode: x.it.periode, KodeTagihan: x.it.kode, NamaTagihan: x.it.nama,
      JumlahAsal: harga, Potongan: pot.potongan, Jumlah: pot.jumlah, AlasanPotongan: pot.alasan, Status: gratis ? 'Gratis' : 'Belum Bayar', TanggalTerbit: tdy,
      JatuhTempo: x.it.jatuhTempo, TanggalLunas: gratis ? tdy : '', DiterbitkanOleh: u.UserID, Keterangan: '', kelas_id: x.s.kelas_id };
  });
  DB.appendBatch('Tagihan', rows);
  bump_('tagihan');
  // 1 notifikasi in-app + 1 WA per siswa (bukan per bulan); yang Gratis tidak diberi tahu
  var subjek = tgPetaSubjek_(), uidOf = tgUserOf_(), per = {}, urut = [];
  rows.filter(function (t) { return t.Status !== 'Gratis'; }).forEach(function (t) { if (!per[t.NIS]) { per[t.NIS] = []; urut.push(t.NIS); } per[t.NIS].push(t); });
  var rek = setting_('REKENING_BANK', '-'), isi = urut.map(function (nis) {
    var s = subjek[nis] || {}, ts = per[nis], total = ts.reduce(function (a, t) { return a + uang_(t.Jumlah); }, 0);
    var label = ts.length === 1 ? ts[0].NamaTagihan : (rc.b ? rc.b.nama + ' ' : '') + ts.map(function (t) { return t.Jenis === 'Bulanan' ? tgLabel_(t.Periode) : t.NamaTagihan; }).join(', ');
    return { s: s, judul: ts.length === 1 ? 'Tagihan Baru: ' + ts[0].NamaTagihan : 'Tagihan Baru (' + ts.length + ' bulan)', pesan: 'Tagihan ' + label + ' sebesar ' + tgRp_(total) + ' telah terbit.' + (ts.length > 1 ? ' Bisa dibayar sekaligus atau per bulan.' : ''),
      vars: { periode: label, jumlah: tgRp_(total), rekening: rek, nis: nis, jatuhTempo: ts[0].JatuhTempo + (ts.length > 1 ? ' (bulan pertama; berikutnya tiap tanggal ' + (rc.tgl || '') + ')' : '') }, refId: ts[0].TagihanID };
  });
  notifApp_(isi.map(function (x) { return { user_id: uidOf[x.s.NIS], judul: x.judul, pesan: x.pesan, tipe: 'tagihan', link: 'tagihan' }; }));
  tgWA_('TAGIHAN_TERBIT', isi.map(function (x) { return { penerima: tgPenerima_(x.s), vars: x.vars, refId: x.refId }; }));
  var nSiswa = Object.keys(rows.reduce(function (o, t) { o[t.NIS] = 1; return o; }, {})).length;
  var res = ok_({ dibuat: rows.length, siswa: nSiswa, periodeList: rc.daftar, kode: rc.kode || '' },
    rows.length + ' tagihan diterbitkan untuk ' + nSiswa + ' siswa' + (rc.sekali ? ' (' + rc.items[0].nama + ').' : ' (' + rc.b.nama + ', ' + rc.daftar.length + ' bulan).'));
  res.auditDetail = JSON.stringify({ biaya: rc.b ? rc.b.kode : rc.kode, periode: rc.daftar, dibuat: rows.length, siswa: nSiswa });
  return res;
}

// ---------------------------------------------------------------------
// 4. BAYAR — 1 BUKTI UNTUK 1 ATAU BEBERAPA TAGIHAN
// ---------------------------------------------------------------------
function svcTgSubmit(ctx, p) {
  var u = tgU_(ctx), keu = isKeu_(ctx);
  var ids = tgIds_(p.tagihanIds && p.tagihanIds.length ? p.tagihanIds : [p.tagihanId], TG.maksBulan + 1);
  if (!ids.length) return fail_('Pilih minimal satu tagihan.');
  if (ids.length > TG.maksBulan) return fail_('Maksimal ' + TG.maksBulan + ' tagihan dalam satu pembayaran.');
  var tagihan = ids.map(function (id) { return DB.find('Tagihan', 'TagihanID', id); });
  if (tagihan.some(function (t) { return !t; })) return fail_('Tagihan tidak ditemukan.');
  if (u.Role === 'siswa' && tagihan.some(function (t) { return String(t.NIS) !== String(ctx.session.ref); })) return fail_('Tagihan ini bukan milik Anda.', { code: 'FORBIDDEN' });
  if (tagihan.some(function (t) { return t.NIS !== tagihan[0].NIS; })) return fail_('Satu bukti transfer hanya untuk tagihan satu siswa.');
  var salah = tagihan.filter(function (t) { return !TG_BELUM[t.Status]; })[0];
  if (salah) return fail_('Tagihan ' + (salah.NamaTagihan || salah.TagihanID) + ' berstatus ' + salah.Status + ' — tidak perlu dibayar lagi.');
  tagihan.sort(function (a, b) { return String(a.JatuhTempo).localeCompare(String(b.JatuhTempo)); });
  var total = tagihan.reduce(function (s, t) { return s + uang_(t.Jumlah); }, 0), jumlah = p.jumlah === undefined || p.jumlah === '' ? total : uang_(p.jumlah);
  if (jumlah < total) return fail_('Nominal transfer ' + tgRp_(jumlah) + ' kurang dari total ' + tgRp_(total) + '.');
  var metode = String(p.metode || 'Transfer').substring(0, 30), buktiId = '';
  if (p.bukti && p.bukti.data) {
    var b64 = String(p.bukti.data).replace(/^data:[^,]+,/, '');
    if (b64.length * 3 / 4 > 5 * 1024 * 1024) return fail_('Ukuran bukti maksimal 5 MB.');
    var mime = p.bukti.mime || 'image/jpeg';
    if (!/^image\/|application\/pdf/.test(mime)) return fail_('Bukti harus berupa foto atau PDF.');
    var nama = tagihan[0].NIS + '_' + tagihan[0].TagihanID + (tagihan.length > 1 ? '_' + tagihan.length + 'tagihan' : '') + '_bukti.' + (mime === 'application/pdf' ? 'pdf' : 'jpg');
    buktiId = shareLink_(saveBase64File_(CONFIG.BUKTI_FOLDER, nama, mime, b64)).getId();
  }
  if (!buktiId && !(keu && /tunai|cash/i.test(metode))) return fail_('Unggah bukti transfer terlebih dahulu.');
  var pid = reserveIds_('Pembayaran', tagihan.length), grup = tagihan.length > 1 ? pid[0] : '', akhir = tagihan.length - 1;
  DB.appendBatch('Pembayaran', tagihan.map(function (t, i) {
    return { PembayaranID: pid[i], TagihanID: t.TagihanID, NIS: t.NIS, Jumlah: uang_(t.Jumlah) + (i === akhir ? jumlah - total : 0), Metode: metode, NoReferensi: String(p.noReferensi || '').substring(0, 60),
      BuktiID: buktiId, Status: 'Menunggu', TanggalBayar: /^\d{4}-\d{2}-\d{2}$/.test(String(p.tanggalBayar || '')) ? p.tanggalBayar : today_(), VerifiedBy: '', VerifiedAt: '', Catatan: String(p.catatan || '').substring(0, 200), GrupBayar: grup, NoKwitansi: '' };
  }));
  DB.updateBatch('Tagihan', 'TagihanID', tagihan.map(function (t) { return { TagihanID: t.TagihanID, Status: 'Menunggu Verifikasi' }; }));
  bump_('tagihan');
  if (keu && p.langsungVerifikasi) {                        // pembayaran di loket: catat + verifikasi sekaligus
    var v = svcTgVerify(ctx, { pembayaranId: pid[0], aksi: 'terima' });
    if (v.success) { v.data.PembayaranID = pid[0]; v.message = 'Pembayaran dicatat & diverifikasi · kwitansi ' + v.data.noKwitansi + '.'; }
    return v;
  }
  return ok_({ PembayaranID: pid[0], GrupBayar: grup, jumlahTagihan: tagihan.length, total: jumlah },
    'Bukti pembayaran ' + (tagihan.length > 1 ? tagihan.length + ' tagihan ' : '') + 'terkirim, menunggu verifikasi bendahara.');
}

/** Data URL bukti (cadangan bila thumbnail Drive tidak bisa dibuka, & mode demo) */
function svcTgBukti(ctx, p) {
  var b = DB.find('Pembayaran', 'PembayaranID', p.pembayaranId);
  if (!b || !b.BuktiID) return fail_('Bukti tidak tersedia.');
  if (ctx.session.role === 'siswa' && String(b.NIS) !== String(ctx.session.ref)) return fail_('Bukti ini bukan milik Anda.', { code: 'FORBIDDEN' });
  var k = 'bukti_' + b.BuktiID, c = CacheX.get(k);
  if (c) return ok_(c);
  var blob = DriveApp.getFileById(b.BuktiID).getBlob();
  var url = 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes());
  CacheX.put(k, url, 21600);
  return ok_(url);
}

// ---------------------------------------------------------------------
// 5. VERIFIKASI — 1 KLIK UNTUK SEMUA TAGIHAN DALAM 1 BUKTI
// ---------------------------------------------------------------------
function svcTgVerify(ctx, p) {
  var u = tgU_(ctx), bayar = DB.find('Pembayaran', 'PembayaranID', p.pembayaranId);
  if (!bayar) return fail_('Pembayaran tidak ditemukan.');
  var anggota = bayar.GrupBayar ? DB.filter('Pembayaran', function (b) { return b.GrupBayar === bayar.GrupBayar && b.Status === 'Menunggu'; }) : (bayar.Status === 'Menunggu' ? [bayar] : []);
  if (!anggota.length) return fail_('Pembayaran ini sudah diverifikasi sebelumnya.');
  if (p.aksi === 'tolak' && !String(p.catatan || '').trim()) return fail_('Alasan penolakan wajib diisi.');
  var tg = {};
  anggota.forEach(function (b) { tg[b.TagihanID] = DB.find('Tagihan', 'TagihanID', b.TagihanID); });
  if (anggota.some(function (b) { return !tg[b.TagihanID]; })) return fail_('Tagihan terkait tidak ditemukan.');
  var label = anggota.map(function (b) { return tg[b.TagihanID].NamaTagihan; }).join(', ');
  var s = DB.find('Siswa', 'NIS', bayar.NIS) || {}, waktu = nowIso_(), ref = bayar.GrupBayar || bayar.PembayaranID, uid = tgUserOf_()[bayar.NIS];
  if (p.aksi === 'tolak') {
    DB.updateBatch('Pembayaran', 'PembayaranID', anggota.map(function (b) { return { PembayaranID: b.PembayaranID, Status: 'Ditolak', VerifiedBy: u.UserID, VerifiedAt: waktu, Catatan: String(p.catatan).substring(0, 200) }; }));
    DB.updateBatch('Tagihan', 'TagihanID', anggota.map(function (b) { var t = tg[b.TagihanID]; return { TagihanID: b.TagihanID, Status: t.JatuhTempo && String(t.JatuhTempo) < today_() ? 'Terlambat' : 'Belum Bayar' }; }));
    bump_('tagihan');
    notifApp_([{ user_id: uid, judul: 'Bukti Pembayaran Ditolak', pesan: p.catatan + ' (' + label + ')', tipe: 'danger', link: 'tagihan' }]);
    tgWA_('PEMBAYARAN_VERIFIKASI', [{ penerima: tgPenerima_(s), vars: { periode: label, status: 'DITOLAK', catatan: 'Alasan: ' + p.catatan + '. Silakan unggah ulang bukti yang benar.' }, refId: ref }]);
    return ok_({ jumlahTagihan: anggota.length }, 'Pembayaran ' + (anggota.length > 1 ? anggota.length + ' tagihan ' : '') + 'ditolak.');
  }
  var noKw = tgNoKwitansi_();                               // 1 kwitansi per transaksi (bukti)
  DB.updateBatch('Pembayaran', 'PembayaranID', anggota.map(function (b) { return { PembayaranID: b.PembayaranID, Status: 'Terverifikasi', VerifiedBy: u.UserID, VerifiedAt: waktu, NoKwitansi: noKw }; }));
  var terbayar = {};
  DB.filter('Pembayaran', function (b) { return tg[b.TagihanID] && b.Status === 'Terverifikasi'; }).forEach(function (b) { terbayar[b.TagihanID] = (terbayar[b.TagihanID] || 0) + uang_(b.Jumlah); });
  var semuaLunas = true;
  DB.updateBatch('Tagihan', 'TagihanID', anggota.map(function (b) {
    var t = tg[b.TagihanID], dibayar = terbayar[b.TagihanID] || 0, patch = { TagihanID: t.TagihanID };
    if (dibayar >= uang_(t.Jumlah)) { patch.Status = 'Lunas'; patch.TanggalLunas = today_(); } else semuaLunas = false;
    if (dibayar > uang_(t.Jumlah)) patch.Keterangan = 'Kelebihan bayar ' + tgRp_(dibayar - uang_(t.Jumlah));
    return patch;
  }));
  bump_('tagihan');
  notifApp_([{ user_id: uid, judul: 'Pembayaran Terverifikasi', pesan: 'Tagihan ' + label + ' telah ' + (semuaLunas ? 'Lunas' : 'diperbarui') + '. Kwitansi ' + noKw + ' bisa diunduh.', tipe: 'success', link: 'tagihan' }]);
  tgWA_('PEMBAYARAN_VERIFIKASI', [{ penerima: tgPenerima_(s), vars: { periode: label, status: semuaLunas ? 'LUNAS ✅' : 'Terverifikasi', catatan: 'No. kwitansi ' + noKw + '. Terima kasih, pembayaran Anda telah kami terima.' }, refId: ref }]);
  return ok_({ statusTagihan: semuaLunas ? 'Lunas' : 'Terverifikasi', jumlahTagihan: anggota.length, noKwitansi: noKw, PembayaranID: bayar.PembayaranID },
    (anggota.length > 1 ? anggota.length + ' tagihan' : 'Pembayaran') + ' diverifikasi · kwitansi ' + noKw + '.');
}

function svcTgPending(ctx, p) {
  var subjek = tgPetaSubjek_(), kelas = tgPetaKelas_();
  return ok_(DB.filter('Pembayaran', function (b) { return b.Status === 'Menunggu'; }).map(function (b) {
    var s = subjek[b.NIS] || {}, t = DB.find('Tagihan', 'TagihanID', b.TagihanID) || {};
    return Object.assign({}, b, { Nama: s.nama_lengkap || '-', Nomor: b.NIS, Kelas: kelas[s.kelas_id] || '', Periode: t.Periode || '', NamaTagihan: t.NamaTagihan || '', NominalTagihan: uang_(t.Jumlah),
      BuktiURL: tgFileUrl_(b.BuktiID), BuktiThumb: tgThumbUrl_(b.BuktiID, 480) });
  }));
}

// ---------------------------------------------------------------------
// 6. BATAL TERBITKAN & UBAH NOMINAL
// ---------------------------------------------------------------------
function svcTgCancel(ctx, p) {
  var ids = tgIds_(p.tagihanIds);
  if (!ids.length) return fail_('Pilih minimal satu tagihan yang akan dibatalkan.');
  var set = {}; ids.forEach(function (id) { set[id] = 1; });
  var tagihan = DB.all('Tagihan').filter(function (t) { return set[t.TagihanID]; });
  if (!tagihan.length) return fail_('Tagihan tidak ditemukan (mungkin sudah dibatalkan).');
  var adaBayar = {};
  DB.all('Pembayaran').forEach(function (b) { if (set[b.TagihanID] && (b.Status === 'Menunggu' || b.Status === 'Terverifikasi')) adaBayar[b.TagihanID] = b.Status; });
  var subjek = tgPetaSubjek_(), hapus = [], lewati = [];
  tagihan.forEach(function (t) {
    var info = { TagihanID: t.TagihanID, Nama: (subjek[t.NIS] || {}).nama_lengkap || '-', NamaTagihan: t.NamaTagihan, Status: t.Status };
    if (!TG_BISA_BATAL[t.Status]) { info.alasan = 'Sudah ' + t.Status; lewati.push(info); return; }
    if (adaBayar[t.TagihanID]) { info.alasan = adaBayar[t.TagihanID] === 'Menunggu' ? 'Ada bukti menunggu verifikasi' : 'Sudah ada pembayaran terverifikasi'; lewati.push(info); return; }
    hapus.push(t);
  });
  if (!hapus.length) return fail_('Tidak ada tagihan yang bisa dibatalkan — ' + lewati.length + ' tagihan sudah dibayar / menunggu verifikasi.');
  DB.deleteWhere('Tagihan', 'TagihanID', hapus.map(function (t) { return t.TagihanID; }));
  bump_('tagihan');
  var uidOf = tgUserOf_(), per = {}, urut = [];
  hapus.filter(function (t) { return t.Status !== 'Gratis'; }).forEach(function (t) { if (!per[t.NIS]) { per[t.NIS] = []; urut.push(t.NIS); } per[t.NIS].push(t); });
  notifApp_(urut.map(function (nis) {
    var ts = per[nis], total = ts.reduce(function (a, t) { return a + uang_(t.Jumlah); }, 0);
    return { user_id: uidOf[nis], judul: 'Tagihan Dibatalkan', tipe: 'warning', link: 'tagihan', pesan: 'Tagihan ' + ts.map(function (t) { return t.NamaTagihan; }).join(', ') + ' (' + tgRp_(total) + ') dibatalkan bendahara. Tidak perlu dibayar.' };
  }));
  var nSiswa = Object.keys(hapus.reduce(function (o, t) { o[t.NIS] = 1; return o; }, {})).length;
  var res = ok_({ dibatalkan: hapus.length, siswa: nSiswa, dilewati: lewati },
    hapus.length + ' tagihan dibatalkan (' + nSiswa + ' siswa).' + (lewati.length ? ' ' + lewati.length + ' dilewati karena sudah dibayar / menunggu verifikasi.' : ''));
  res.auditDetail = JSON.stringify({ dibatalkan: hapus.length, siswa: nSiswa, dilewati: lewati.length, ids: hapus.map(function (t) { return t.TagihanID; }).join(',') }).substring(0, 400);
  return res;
}

function svcTgUbahNominal(ctx, p) {
  var t = DB.find('Tagihan', 'TagihanID', p.tagihanId);
  if (!t) return fail_('Tagihan tidak ditemukan.');
  if (!TG_BELUM[t.Status] && t.Status !== 'Gratis') return fail_('Hanya tagihan yang belum dibayar yang bisa diubah (status ' + t.Status + ').');
  var asal = uang_(t.JumlahAsal || t.Jumlah), baru = uang_(p.jumlahBaru);
  if (String(p.jumlahBaru) === '' || p.jumlahBaru === undefined || baru < 0 || baru > asal) return fail_('Nominal baru harus 0 s.d. ' + tgRp_(asal) + '.');
  if (!String(p.alasan || '').trim()) return fail_('Alasan perubahan wajib diisi.');
  var patch = { TagihanID: t.TagihanID, Jumlah: baru, JumlahAsal: asal, Potongan: asal - baru, AlasanPotongan: String(p.alasan).trim().substring(0, 200),
    Status: baru === 0 ? 'Gratis' : (TG_BELUM[t.Status] ? t.Status : 'Belum Bayar'), TanggalLunas: baru === 0 ? today_() : '' };
  DB.updateBatch('Tagihan', 'TagihanID', [patch]);
  bump_('tagihan');
  notifApp_([{ user_id: tgUserOf_()[t.NIS], judul: 'Nominal Tagihan Diperbarui', pesan: t.NamaTagihan + ': ' + tgRp_(t.Jumlah) + ' → ' + tgRp_(baru) + ' (' + patch.AlasanPotongan + ').', tipe: 'info', link: 'tagihan' }]);
  var res = ok_(patch, 'Nominal tagihan diperbarui menjadi ' + tgRp_(baru) + '.');
  res.auditDetail = JSON.stringify({ id: t.TagihanID, dari: uang_(t.Jumlah), ke: baru, alasan: patch.AlasanPotongan }).substring(0, 400);
  return res;
}

// ---------------------------------------------------------------------
// 7. MASTER JENIS BIAYA (custom per sekolah)
// ---------------------------------------------------------------------
function svcTgBiayaList(ctx, p) {
  var pakai = {}; DB.all('Tagihan').forEach(function (t) { var k = t.BiayaKode || ''; if (k) pakai[k] = (pakai[k] || 0) + 1; });
  return ok_({ rows: DB.all('Biaya').map(function (b) { return Object.assign({}, b, { khusus: tgKhusus_(b), tagihan: pakai[b.kode] || 0 }); }),
    kelas: DB.all('Kelas').map(function (k) { return { kelas_id: k.kelas_id, nama_kelas: k.nama_kelas, jenjang: k.jenjang }; }) });
}
function svcTgBiayaSave(ctx, p) {
  var x = p.row || {}, isNew = !x.biaya_id;
  var kode = String(x.kode || '').trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9-]{1,20}$/.test(kode)) return fail_('Kode biaya 2–21 huruf besar/angka/tanda -, contoh SPP, UANG-MAKAN.');
  if (!String(x.nama || '').trim()) return fail_('Nama biaya wajib diisi.');
  var jenis = x.jenis === 'Sekali' ? 'Sekali' : 'Bulanan';
  if (x.nominal === undefined || String(x.nominal) === '' || uang_(x.nominal) < 0) return fail_('Nominal dasar wajib diisi (boleh 0 bila semua memakai nominal khusus).');
  var khusus = typeof x.nominal_khusus === 'object' && x.nominal_khusus ? x.nominal_khusus : (function () { try { return JSON.parse(x.nominal_khusus || '{}'); } catch (e) { return null; } })();
  if (!khusus || typeof khusus !== 'object') return fail_('Nominal khusus tidak valid.');
  var bersih = {};
  for (var k in khusus) {
    if (!/^(NIS|KELAS|JENJANG):[A-Za-z0-9.-]+$/.test(k)) return fail_('Kunci nominal khusus tidak dikenal: ' + k);
    if (String(khusus[k]) === '' || uang_(khusus[k]) < 0) return fail_('Nominal khusus ' + k + ' tidak valid.');
    bersih[k] = uang_(khusus[k]);
  }
  var tgl = parseInt(x.jatuh_tempo_tgl || '', 10);
  if (jenis === 'Bulanan' && x.jatuh_tempo_tgl && !(tgl >= 1 && tgl <= 28)) return fail_('Tanggal jatuh tempo bulanan 1–28.');
  if (jenis === 'Sekali' && x.jatuh_tempo && !/^\d{4}-\d{2}-\d{2}$/.test(x.jatuh_tempo)) return fail_('Jatuh tempo sekali bayar berformat yyyy-MM-dd.');
  var dupe = DB.all('Biaya').filter(function (b) { return String(b.kode).toUpperCase() === kode && b.biaya_id !== x.biaya_id; })[0];
  if (dupe) return fail_('Kode ' + kode + ' sudah dipakai biaya ' + dupe.nama + '.');
  var row = { kode: kode, nama: String(x.nama).trim().substring(0, 80), jenis: jenis, nominal: uang_(x.nominal), nominal_khusus: JSON.stringify(bersih), jatuh_tempo_tgl: jenis === 'Bulanan' && tgl ? String(tgl) : '',
    jatuh_tempo: jenis === 'Sekali' ? String(x.jatuh_tempo || '') : '', keterangan: String(x.keterangan || '').substring(0, 200), aktif: String(x.aktif || 'YA').toUpperCase() === 'TIDAK' ? 'TIDAK' : 'YA' };
  if (isNew) { row.biaya_id = reserveIds_('Biaya', 1)[0]; row.dibuat_pada = nowIso_(); DB.appendBatch('Biaya', [row]); }
  else {
    var lama = DB.find('Biaya', 'biaya_id', x.biaya_id);
    if (!lama) return fail_('Jenis biaya tidak ditemukan.');
    if (String(lama.kode).toUpperCase() !== kode && DB.all('Tagihan').some(function (t) { return t.BiayaKode === lama.kode; })) return fail_('Kode tidak bisa diubah karena sudah dipakai tagihan. Buat jenis biaya baru.');
    row.biaya_id = lama.biaya_id; DB.updateBatch('Biaya', 'biaya_id', [row]);
  }
  return ok_(row, (isNew ? 'Jenis biaya ' + row.nama + ' ditambahkan.' : 'Jenis biaya diperbarui.') + ' Perubahan nominal berlaku untuk tagihan yang diterbitkan berikutnya.');
}
function svcTgBiayaDelete(ctx, p) {
  var b = DB.find('Biaya', 'biaya_id', p.biaya_id);
  if (!b) return fail_('Jenis biaya tidak ditemukan.');
  if (DB.all('Tagihan').some(function (t) { return t.BiayaKode === b.kode; })) return fail_('Biaya ini sudah dipakai tagihan — nonaktifkan saja agar riwayat tetap utuh.');
  DB.deleteWhere('Biaya', 'biaya_id', [b.biaya_id]);
  return ok_(null, 'Jenis biaya ' + b.nama + ' dihapus.');
}

// ---------------------------------------------------------------------
// 8. POTONGAN / BEASISWA
// ---------------------------------------------------------------------
function svcTgDiscountList(ctx, p) {
  var subjek = tgPetaSubjek_(), kelas = tgPetaKelas_();
  return ok_(DB.all('PotonganTagihan').map(function (r) { var s = subjek[r.NIS] || {}; return Object.assign({}, r, { Nama: s.nama_lengkap || '-', Kelas: kelas[s.kelas_id] || '' }); }));
}
function svcTgDiscountSave(ctx, p) {
  var d = p.data || {}, u = tgU_(ctx);
  if (!DB.find('Siswa', 'NIS', d.NIS)) return fail_('Siswa tidak ditemukan.');
  if (['Persen', 'Nominal', 'Gratis'].indexOf(d.Tipe) === -1) return fail_('Tipe potongan: Persen, Nominal, atau Gratis.');
  var nilai = d.Tipe === 'Gratis' ? 100 : uang_(d.Nilai);
  if (!(nilai > 0) || (d.Tipe === 'Persen' && nilai > 100)) return fail_('Nilai potongan tidak valid.');
  var berlaku = String(d.Berlaku || 'Semua');
  if (!/^(Semua|Bulanan|Sekali|KODE:[A-Z0-9-]+)$/.test(berlaku)) return fail_('Berlaku: Semua, Bulanan, Sekali, atau KODE:<kode biaya>.');
  var rx = /^(\d{4}-(0[1-9]|1[0-2]))?$/;
  if (!rx.test(d.Mulai || '') || !rx.test(d.Sampai || '')) return fail_('Mulai/Sampai berformat yyyy-MM (boleh kosong).');
  if (!String(d.Alasan || '').trim()) return fail_('Alasan potongan wajib (mis. Beasiswa Prestasi).');
  var row = { NIS: String(d.NIS), Tipe: d.Tipe, Nilai: nilai, Berlaku: berlaku, Mulai: d.Mulai || '', Sampai: d.Sampai || '', Alasan: String(d.Alasan).trim().substring(0, 120), Aktif: String(d.Aktif || 'YA').toUpperCase() === 'TIDAK' ? 'TIDAK' : 'YA' };
  if (d.PotonganID && DB.find('PotonganTagihan', 'PotonganID', d.PotonganID)) {
    row.PotonganID = d.PotonganID; DB.updateBatch('PotonganTagihan', 'PotonganID', [row]);
    return ok_(row, 'Potongan diperbarui. Berlaku untuk tagihan yang diterbitkan berikutnya.');
  }
  row.PotonganID = reserveIds_('PotonganTagihan', 1)[0]; row.DibuatOleh = u.UserID; row.DibuatPada = nowIso_();
  DB.appendBatch('PotonganTagihan', [row]);
  return ok_(row, 'Potongan disimpan. Berlaku untuk tagihan yang diterbitkan berikutnya.');
}
function svcTgDiscountDelete(ctx, p) {
  if (!DB.find('PotonganTagihan', 'PotonganID', p.potonganId)) return fail_('Potongan tidak ditemukan.');
  DB.deleteWhere('PotonganTagihan', 'PotonganID', [p.potonganId]);
  return ok_(null, 'Potongan dihapus (tagihan yang sudah terbit tidak berubah).');
}

// ---------------------------------------------------------------------
// 9. RIWAYAT PEMBAYARAN & EKSPOR DENGAN LINK BUKTI
// ---------------------------------------------------------------------
function tgRiwayat_(nis) {
  var tagihan = DB.filter('Tagihan', function (t) { return String(t.NIS) === String(nis); }).sort(function (a, b) { return String(b.JatuhTempo).localeCompare(String(a.JatuhTempo)); });
  var tg = {}; tagihan.forEach(function (t) { tg[t.TagihanID] = t; });
  var peta = {}, urut = [];
  DB.filter('Pembayaran', function (b) { return String(b.NIS) === String(nis); }).forEach(function (b) {
    var k = b.GrupBayar || b.PembayaranID;
    if (!peta[k]) {
      peta[k] = { PembayaranID: b.PembayaranID, GrupBayar: b.GrupBayar || '', TanggalBayar: b.TanggalBayar, Metode: b.Metode, NoReferensi: b.NoReferensi, Status: b.Status, Catatan: b.Catatan, VerifiedAt: b.VerifiedAt,
        NoKwitansi: b.NoKwitansi || '', BuktiID: b.BuktiID, BuktiURL: tgFileUrl_(b.BuktiID), BuktiThumb: tgThumbUrl_(b.BuktiID, 480), Jumlah: 0, item: [] };
      urut.push(k);
    }
    var t = tg[b.TagihanID];
    peta[k].Jumlah += uang_(b.Jumlah);
    peta[k].item.push({ TagihanID: b.TagihanID, NamaTagihan: t ? t.NamaTagihan : '(tagihan dibatalkan)', Nominal: t ? uang_(t.Jumlah) : 0, Dibatalkan: !t });
  });
  var transaksi = urut.map(function (k) { return peta[k]; }).sort(function (a, b) { return String(b.TanggalBayar).localeCompare(String(a.TanggalBayar)) || String(b.PembayaranID).localeCompare(String(a.PembayaranID)); });
  var nilai = function (st) { return tagihan.filter(function (t) { return st[t.Status]; }).reduce(function (s, t) { return s + uang_(t.Jumlah); }, 0); };
  var hitung = function (st) { return tagihan.filter(function (t) { return st[t.Status]; }).length; };
  return { tagihan: tagihan, transaksi: transaksi, ringkasan: { lunas: nilai({ 'Lunas': 1 }), tunggakan: nilai(TG_BELUM), menunggu: nilai({ 'Menunggu Verifikasi': 1 }),
    potongan: tagihan.reduce(function (s, t) { return s + uang_(t.Potongan); }, 0), nLunas: hitung({ 'Lunas': 1 }), nBelum: hitung(TG_BELUM), nMenunggu: hitung({ 'Menunggu Verifikasi': 1 }), nGratis: hitung({ 'Gratis': 1 }) } };
}
function svcTgHistory(ctx, p) {
  var s = DB.find('Siswa', 'NIS', p.NIS || p.subjekId);
  if (!s) return fail_('Siswa tidak ditemukan.');
  return ok_(tgRiwayat_(s.NIS));
}
function tgTambahBukti_(rows) {
  var prio = { 'Terverifikasi': 3, 'Menunggu': 2, 'Ditolak': 1 };
  var kunci = function (b) { return (prio[b.Status] || 0) + '|' + String(b.TanggalBayar) + '|' + ('0000000000' + String(b.PembayaranID).replace(/\D/g, '')).slice(-10); };
  var pilih = {}, perGrup = {};
  DB.all('Pembayaran').forEach(function (b) { if (b.GrupBayar) perGrup[b.GrupBayar] = (perGrup[b.GrupBayar] || 0) + 1; if (!pilih[b.TagihanID] || kunci(b) > kunci(pilih[b.TagihanID])) pilih[b.TagihanID] = b; });
  return rows.map(function (t) {
    var b = pilih[t.TagihanID];
    return Object.assign({}, t, b ? { TanggalBayar: b.TanggalBayar, JumlahBayar: uang_(b.Jumlah), MetodeBayar: b.Metode, NoReferensi: b.NoReferensi, StatusBayar: b.Status, NoKwitansi: b.NoKwitansi || '', BuktiURL: tgFileUrl_(b.BuktiID), BuktiUntuk: b.GrupBayar ? perGrup[b.GrupBayar] : 1 }
      : { TanggalBayar: '', JumlahBayar: '', MetodeBayar: '', NoReferensi: '', StatusBayar: '', NoKwitansi: '', BuktiURL: '', BuktiUntuk: 0 });
  });
}

// ---------------------------------------------------------------------
// 10. KWITANSI (nomor saat diverifikasi, PDF di browser, QR verifikasi publik)
// ---------------------------------------------------------------------
function tgNoKwitansi_() {                                  // dipanggil di dalam lock tulis
  var th = today_().substring(0, 4), k = 'SEQ_KWITANSI_' + th;
  var n = (parseInt(propFresh_(k) || '0', 10) || 0) + 1;
  setProp_(k, String(n));
  return setting_('KWITANSI_PREFIX', 'KW') + '-' + th + '-' + ('00000' + n).slice(-6);
}
function tgKodeKwitansi_(no) {
  var rahasia = prop_('QR_SECRET') || secret_();            // rahasia hanya di Script Properties
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(String(no), rahasia)).replace(/[^A-Za-z0-9]/g, '').substring(0, 10);
}
function tgTerbilang_(n) {
  n = Math.floor(Math.abs(uang_(n)));
  var s = ['', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan', 'sepuluh', 'sebelas'];
  var f = function (x) {
    if (x < 12) return s[x];
    if (x < 20) return f(x - 10) + ' belas';
    if (x < 100) return f(Math.floor(x / 10)) + ' puluh ' + f(x % 10);
    if (x < 200) return 'seratus ' + f(x - 100);
    if (x < 1000) return f(Math.floor(x / 100)) + ' ratus ' + f(x % 100);
    if (x < 2000) return 'seribu ' + f(x - 1000);
    if (x < 1e6) return f(Math.floor(x / 1000)) + ' ribu ' + f(x % 1000);
    if (x < 1e9) return f(Math.floor(x / 1e6)) + ' juta ' + f(x % 1e6);
    if (x < 1e12) return f(Math.floor(x / 1e9)) + ' miliar ' + f(x % 1e9);
    return f(Math.floor(x / 1e12)) + ' triliun ' + f(x % 1e12);
  };
  var hasil = n === 0 ? 'nol' : f(n).replace(/\s+/g, ' ').trim();
  return hasil.charAt(0).toUpperCase() + hasil.slice(1) + ' rupiah';
}
function svcTgReceipt(ctx, p) {
  var b = DB.find('Pembayaran', 'PembayaranID', p.pembayaranId);
  if (!b || b.Status !== 'Terverifikasi' || !b.NoKwitansi) return fail_('Kwitansi belum tersedia (pembayaran belum diverifikasi).');
  if (ctx.session.role === 'siswa' && String(b.NIS) !== String(ctx.session.ref)) return fail_('Kwitansi ini bukan milik Anda.', { code: 'FORBIDDEN' });
  var s = DB.find('Siswa', 'NIS', b.NIS) || {}, kelas = tgPetaKelas_();
  var anggota = b.GrupBayar ? DB.filter('Pembayaran', function (x) { return x.GrupBayar === b.GrupBayar && x.Status === 'Terverifikasi'; }) : [b];
  var item = anggota.map(function (x) { var t = DB.find('Tagihan', 'TagihanID', x.TagihanID) || {}; return { TagihanID: x.TagihanID, NamaTagihan: t.NamaTagihan || x.TagihanID, Jumlah: uang_(x.Jumlah) }; });
  var total = item.reduce(function (a, x) { return a + x.Jumlah; }, 0), verif = userIdx_()[b.VerifiedBy] || {}, kode = tgKodeKwitansi_(b.NoKwitansi);
  return ok_({ noKwitansi: b.NoKwitansi, tanggal: String(b.VerifiedAt).substring(0, 10), tanggalBayar: b.TanggalBayar, nama: s.nama_lengkap || '-', nomor: 'NIS ' + b.NIS + (kelas[s.kelas_id] ? ' / ' + kelas[s.kelas_id] : ''),
    item: item, total: total, terbilang: tgTerbilang_(total), metode: b.Metode, noReferensi: b.NoReferensi, diverifikasiOleh: setting_('NAMA_BENDAHARA', '') || verif.n || 'Bendahara',
    institusi: setting_('NAMA_SEKOLAH', APP.NAME), alamat: setting_('ALAMAT_SEKOLAH', ''), kodeVerifikasi: kode,
    urlVerifikasi: (setting_('APP_URL', '') || '') + '#kwitansi=' + encodeURIComponent(b.NoKwitansi + '.' + kode) });
}
/** PUBLIK: { kode: 'KW-2026-000001.AbC123xyZ9' } → keaslian kwitansi, nama disamarkan */
function svcTgVerifyReceipt(ctx, p) {
  if (!CONFIG.SPREADSHEET_ID) return fail_('Server belum di-setup.');
  var x = String(p.kode || ''), titik = x.lastIndexOf('.');
  var no = titik > 0 ? x.substring(0, titik) : '', kode = titik > 0 ? x.substring(titik + 1) : '';
  if (!no || !samaAman_(kode, tgKodeKwitansi_(no))) return ok_({ valid: false }, 'Kwitansi tidak dikenal / kode tidak cocok.');
  var rows = DB.filter('Pembayaran', function (b) { return b.NoKwitansi === no && b.Status === 'Terverifikasi'; });
  if (!rows.length) return ok_({ valid: false }, 'Kwitansi tidak ditemukan atau sudah dibatalkan.');
  var s = DB.find('Siswa', 'NIS', rows[0].NIS) || {};
  var samar = String(s.nama_lengkap || '').split(/\s+/).map(function (w) { return w ? w.charAt(0) + '***' : ''; }).join(' ');
  return ok_({ valid: true, noKwitansi: no, nama: samar, institusi: setting_('NAMA_SEKOLAH', APP.NAME), total: rows.reduce(function (a, b) { return a + uang_(b.Jumlah); }, 0), tanggal: String(rows[0].VerifiedAt).substring(0, 10), jumlahTagihan: rows.length }, 'Kwitansi asli.');
}

// ---------------------------------------------------------------------
// 11. PENGINGAT H-3 / H-0 + TANDAI TERLAMBAT
// ---------------------------------------------------------------------
function tgTambahHari_(ymd, n) { var d = new Date(ymd + 'T12:00:00+07:00'); return Utilities.formatDate(new Date(d.getTime() + n * 864e5), APP.TZ, 'yyyy-MM-dd'); }
function tgHitungReminder_(jenis, tanggal) {
  tanggal = tanggal || today_();
  var jt = jenis === 'H3' ? tgTambahHari_(tanggal, 3) : tanggal;
  var subjek = tgPetaSubjek_(), sudah = {}, kirim = [], lewati = [];
  DB.all('ReminderLog').forEach(function (r) { if (r.Status !== 'Gagal') sudah[r.Kunci] = r.Tanggal; });
  DB.all('Tagihan').filter(function (t) { return String(t.JatuhTempo).substring(0, 10) === jt; }).forEach(function (t) {
    var s = subjek[t.NIS];
    if (!s) return;
    var kunci = jenis + '|' + t.TagihanID;
    var x = { kunci: kunci, NIS: t.NIS, TagihanID: t.TagihanID, Nama: s.nama_lengkap, Nomor: t.NIS, HP: s.no_wa_ortu || s.no_wa, Email: s.email, NamaTagihan: t.NamaTagihan, Jumlah: uang_(t.Jumlah), JatuhTempo: jt, Status: t.Status };
    if (TG_TANPA_REMINDER[t.Status]) { x.alasan = 'Sudah ' + t.Status; lewati.push(x); return; }
    if (!TG.subjek.aktif(s)) { x.alasan = 'Siswa tidak aktif'; lewati.push(x); return; }
    if (sudah[kunci]) { x.alasan = 'Sudah diingatkan'; x.sudah = true; lewati.push(x); return; }
    kirim.push(x);
  });
  return { jenis: jenis, tanggal: tanggal, jatuhTempo: jt, kirim: kirim, lewati: lewati };
}
function tgJalankanReminder_(jenis, tanggal, opsi, u) {
  opsi = opsi || {};
  var h = tgHitungReminder_(jenis, tanggal), sasaran = h.kirim;
  if (opsi.ulang) sasaran = sasaran.concat(h.lewati.filter(function (x) { return x.sudah; }));
  if (opsi.ids && opsi.ids.length) sasaran = sasaran.filter(function (x) { return opsi.ids.indexOf(x.NIS) > -1 || opsi.ids.indexOf(x.TagihanID) > -1; });
  if (!sasaran.length) return { jenis: jenis, jatuhTempo: h.jatuhTempo, penerima: 0, diantrekan: 0, lewati: h.lewati.length };
  var rek = setting_('REKENING_BANK', '-'), uidOf = tgUserOf_();
  var n = tgWA_(jenis === 'H3' ? 'TAGIHAN_REMINDER_H3' : 'TAGIHAN_REMINDER_H0', sasaran.map(function (x) {
    return { penerima: { nama: x.Nama, hp: x.HP, email: x.Email }, refId: x.TagihanID, vars: { periode: x.NamaTagihan, jumlah: tgRp_(x.Jumlah), jatuhTempo: x.JatuhTempo, rekening: rek, nis: x.Nomor, hari: jenis === 'H3' ? '3 hari lagi' : 'hari ini' } };
  }));
  notifApp_(sasaran.map(function (x) { return { user_id: uidOf[x.NIS], judul: 'Pengingat Tagihan', pesan: x.NamaTagihan + ' (' + tgRp_(x.Jumlah) + ') jatuh tempo ' + (jenis === 'H3' ? '3 hari lagi' : 'hari ini') + ' — ' + x.JatuhTempo + '.', tipe: 'warning', link: 'tagihan' }; }));
  var ids = reserveIds_('ReminderLog', sasaran.length), now = nowIso_();
  DB.appendBatch('ReminderLog', sasaran.map(function (x, i) {
    return { ReminderID: ids[i], Kunci: x.kunci, Jenis: jenis, NIS: x.NIS, TagihanID: x.TagihanID, Nama: x.Nama, Jumlah: x.Jumlah, JatuhTempo: x.JatuhTempo, Mode: opsi.mode || 'Manual', Status: n ? 'Diantrekan' : 'In-app', Oleh: u ? u.Nama : 'Sistem', Tanggal: now };
  }));
  return { jenis: jenis, jatuhTempo: h.jatuhTempo, penerima: sasaran.length, diantrekan: n, lewati: h.lewati.length };
}
function svcTgReminderPreview(ctx, p) {
  var tgl = /^\d{4}-\d{2}-\d{2}$/.test(String(p.tanggal || '')) ? p.tanggal : today_();
  return ok_({ tanggal: tgl, H3: tgHitungReminder_('H3', tgl), H0: tgHitungReminder_('H0', tgl), otomatis: setting_('REMINDER_OTOMATIS', 'TIDAK') === 'YA', jam: setting_('REMINDER_JAM', '08:00'), terakhir: prop_('TG_REMINDER_TERAKHIR') });
}
function svcTgReminderRun(ctx, p) {
  var tgl = /^\d{4}-\d{2}-\d{2}$/.test(String(p.tanggal || '')) ? p.tanggal : today_();
  var r = tgJalankanReminder_(p.jenis === 'H0' ? 'H0' : 'H3', tgl, { ulang: !!p.ulang, ids: p.ids || [] }, tgU_(ctx));
  return ok_(r, r.penerima ? 'Pengingat dikirim ke ' + r.penerima + ' siswa' + (r.diantrekan ? ' (' + r.diantrekan + ' pesan WA/Email diantrekan).' : ' (notifikasi in-app; WA/Email belum aktif).') : 'Tidak ada penerima (semua lunas / sudah diingatkan).');
}
/** Dari pekerjaMenit: tandai Terlambat sekali sehari; pengingat otomatis setelah REMINDER_JAM */
function tgReminderOtomatis_() {
  var hari = today_();
  if (propFresh_('TG_TERLAMBAT_TERAKHIR') !== hari) { setProp_('TG_TERLAMBAT_TERAKHIR', hari); if (tgTandaiTerlambat_()) bump_('adm', true); }
  if (setting_('REMINDER_OTOMATIS', 'TIDAK') !== 'YA') return;
  if (propFresh_('TG_REMINDER_TERAKHIR') === hari || timeNow_().substring(0, 5) < setting_('REMINDER_JAM', '08:00')) return;
  setProp_('TG_REMINDER_TERAKHIR', hari);                    // tandai dulu → tidak dobel walau error
  if (setting_('REMINDER_H3', 'YA') === 'YA') tgJalankanReminder_('H3', hari, { mode: 'Otomatis' }, null);
  if (setting_('REMINDER_H0', 'YA') === 'YA') tgJalankanReminder_('H0', hari, { mode: 'Otomatis' }, null);
  bump_('adm', true);
}
function tgTandaiTerlambat_() {
  var hari = today_();
  var lewat = DB.all('Tagihan').filter(function (t) { return t.Status === 'Belum Bayar' && t.JatuhTempo && String(t.JatuhTempo).substring(0, 10) < hari; });
  if (lewat.length) { DB.updateBatch('Tagihan', 'TagihanID', lewat.map(function (t) { return { TagihanID: t.TagihanID, Status: 'Terlambat' }; })); bump_('tagihan'); }
  return lewat.length;
}

// ---------------------------------------------------------------------
// 12. PENGATURAN KEUANGAN (bendahara boleh mengubah tanpa akses Pengaturan umum)
// ---------------------------------------------------------------------
function svcTgSettingsGet(ctx, p) {
  var ket = {}; CONFIG_SEED.forEach(function (r) { ket[r[0]] = r[2]; });
  var s = settings_();
  return ok_(Object.keys(s).filter(function (k) { return TG_SETTING.test(k); }).map(function (k) { return { key: k, value: s[k], keterangan: ket[k] || '' }; }));
}
function svcTgSettingsSave(ctx, p) {
  var src = p.pairs || {}, clean = {};
  Object.keys(src).forEach(function (k) { if (TG_SETTING.test(k)) clean[k] = String(src[k]).trim().substring(0, 200); });
  if (clean.JATUH_TEMPO_TANGGAL !== undefined && !(Number(clean.JATUH_TEMPO_TANGGAL) >= 1 && Number(clean.JATUH_TEMPO_TANGGAL) <= 28)) return fail_('Tanggal jatuh tempo 1–28.');
  if (clean.REMINDER_JAM !== undefined && !/^\d{2}:\d{2}$/.test(clean.REMINDER_JAM)) return fail_('Jam pengingat berformat HH:mm.');
  ['REMINDER_OTOMATIS', 'REMINDER_H3', 'REMINDER_H0'].forEach(function (k) { if (clean[k] !== undefined) clean[k] = clean[k] === 'YA' ? 'YA' : 'TIDAK'; });
  if (clean.KWITANSI_PREFIX !== undefined && !/^[A-Z0-9-]{1,10}$/.test(clean.KWITANSI_PREFIX)) return fail_('Awalan kwitansi 1–10 huruf besar/angka.');
  saveSettings_(clean);
  return svcTgSettingsGet(ctx, {});
}

;
// ==== Migrasi.gs ====
/**
 * =====================================================================
 *  SIAKAD SISWA — File 3/5 : Migrasi.gs  (gas-migrasi-database)
 *  Import data dari spreadsheet app LAMA → app baru.
 *  • App lama HANYA DIBACA (openById), tidak pernah ditulis.
 *  • Baca berdasarkan NAMA header (dengan alias), bukan indeks kolom.
 *  • Idempoten (upsert kunci alami) • Dry-run • Delta sync • Batch 1× tulis/sheet
 *  • Keputusan di app baru tidak ditimpa (kecuali opsi "timpa").
 * =====================================================================
 */

/** Alias nama sheet di app lama */
var MIG_SHEET_ALIAS = {
  Kelas: ['Kelas', 'Data Kelas', 'Rombel', 'Classes'],
  Mapel: ['Mapel', 'Mata Pelajaran', 'MataPelajaran', 'Subjects'],
  Guru: ['Guru', 'Data Guru', 'Teachers', 'Pengajar'],
  Siswa: ['Siswa', 'Data Siswa', 'DataSiswa', 'Students', 'Peserta Didik'],
  Users: ['Users', 'User', 'Akun', 'Login'],
  Jadwal: ['Jadwal', 'Jadwal Pelajaran', 'Schedule'],
  Materi: ['Materi', 'Materi Pembelajaran', 'Materials'],
  Absensi: ['Absensi', 'Presensi', 'Kehadiran', 'Attendance'],
  Nilai: ['Nilai', 'Penilaian', 'Grades', 'Raport'],
  Pengumuman: ['Pengumuman', 'Announcements', 'Informasi'],
  Config: ['Config', 'Pengaturan', 'Settings', 'AppConfig']
};
/** Alias kolom → kolom target (dicocokkan setelah dinormalisasi: huruf kecil tanpa spasi/simbol) */
var MIG_COL_ALIAS = {
  NIS: ['nis', 'nomorinduksiswa', 'noinduk', 'nisn_lokal', 'studentid'],
  NISN: ['nisn'],
  nama_lengkap: ['namalengkap', 'nama', 'namasiswa', 'namaguru', 'fullname', 'name'],
  jenis_kelamin: ['jeniskelamin', 'jk', 'gender', 'lp'],
  kelas_id: ['kelasid', 'kelas', 'rombel', 'idkelas', 'namakelas', 'class'],
  jenjang: ['jenjang', 'tingkatpendidikan', 'level'],
  barcode_id: ['barcodeid', 'barcode', 'kodebarcode', 'qr', 'qrcode'],
  email: ['email', 'emailsiswa', 'emailguru', 'surel'],
  no_wa: ['nowa', 'wa', 'nohp', 'hp', 'whatsapp', 'telepon', 'nohpsiswa', 'nowasiswa'],
  nama_ortu: ['namaortu', 'namaorangtua', 'namawali', 'ortu', 'wali'],
  no_wa_ortu: ['nowaortu', 'hportu', 'nohportu', 'waortu', 'nohpwali', 'nowawali', 'telportu', 'nowhatsapporangtua'],
  tempat_lahir: ['tempatlahir'], tanggal_lahir: ['tanggallahir', 'tgllahir', 'ttl_tanggal'],
  alamat: ['alamat', 'alamatdomisili'], foto_profil_url: ['fotoprofilurl', 'foto', 'fotourl', 'pasfoto'],
  tahun_masuk: ['tahunmasuk', 'angkatan', 'tahunangkatan'], status: ['status', 'statussiswa', 'statusaktif'],
  NUPTK: ['nuptk', 'nip', 'guruid', 'idguru', 'kodeguru'],
  mata_pelajaran: ['matapelajaran', 'mapel', 'subject', 'pelajaran'],
  jabatan: ['jabatan', 'tugastambahan'],
  nama_kelas: ['namakelas', 'kelas', 'rombel', 'nama'], tingkat: ['tingkat', 'grade'], wali_kelas_id: ['walikelasid', 'walikelas', 'wali'], tahun_ajaran: ['tahunajaran', 'ta'],
  nama: ['nama', 'namamapel', 'namalengkap'], kode: ['kode', 'kodemapel'], kelompok: ['kelompok', 'kategori'],
  user_id: ['userid', 'id'], password_hash: ['passwordhash', 'hash', 'password'], salt: ['salt'], role: ['role', 'peran', 'level'], ref_id: ['refid', 'nis', 'nuptk', 'nip', 'noinduk'], status_aktif: ['statusaktif', 'aktif', 'status'],
  jadwal_id: ['jadwalid', 'id'], guru_id: ['guruid', 'nuptk', 'nip', 'idguru', 'guru'], hari: ['hari', 'day'], jam_mulai: ['jammulai', 'mulai', 'start'], jam_selesai: ['jamselesai', 'selesai', 'end'], ruang: ['ruang', 'ruangan', 'room'],
  materi_id: ['materiid', 'id'], judul: ['judul', 'title'], deskripsi: ['deskripsi', 'keterangan', 'description'], tipe: ['tipe', 'jenis', 'type'], url_konten: ['urlkonten', 'url', 'link', 'tautan'], drive_file_id: ['drivefileid', 'fileid'], tanggal_upload: ['tanggalupload', 'tanggal', 'createdat'],
  absensi_id: ['absensiid', 'id'], tanggal: ['tanggal', 'tgl', 'date'], jam: ['jam', 'waktu', 'time'], metode: ['metode', 'method', 'cara'], latitude: ['latitude', 'lat'], longitude: ['longitude', 'lng', 'long', 'lon'], foto_selfie_id: ['fotoselfieurl', 'fotoselfie', 'fotoselfieid', 'selfie'], keterangan: ['keterangan', 'catatan', 'note'],
  nilai_id: ['nilaiid', 'id'], semester: ['semester'], nilai_harian: ['nilaiharian', 'harian', 'tugas'], nilai_uts: ['nilaiuts', 'uts', 'pts'], nilai_uas: ['nilaiuas', 'uas', 'pas'], nilai_akhir: ['nilaiakhir', 'akhir', 'na'], catatan: ['catatan', 'deskripsi'],
  pengumuman_id: ['pengumumanid', 'id'], isi: ['isi', 'konten', 'content'], kategori: ['kategori', 'category'], oleh: ['oleh', 'author', 'penulis']
};

function normKey_(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9_]/g, '').replace(/_/g, ''); }

function openSource_(idOrUrl) {
  var m = String(idOrUrl || '').match(/\/d\/([A-Za-z0-9_-]{20,})/);
  var id = m ? m[1] : String(idOrUrl || '').trim();
  if (!id) throw new Error('Tempel URL atau ID spreadsheet app LAMA.');
  if (id === getSS_().getId()) throw new Error('Itu spreadsheet app baru. Tempel spreadsheet app LAMA.');
  try { return SpreadsheetApp.openById(id); }
  catch (e) { throw new Error('Spreadsheet tidak bisa dibuka. Pastikan ID benar & dimiliki / dibagikan ke akun Google pemilik script ini.'); }
}

/** Baca sheet sumber menjadi objek dengan kolom target (lewat alias). null = sheet tidak ada. */
function readSource_(ss, target) {
  var sh = null, names = MIG_SHEET_ALIAS[target] || [target];
  for (var i = 0; i < names.length && !sh; i++) sh = ss.getSheetByName(names[i]);
  if (!sh) {
    var lowerNames = names.map(normKey_);
    ss.getSheets().forEach(function (s) { if (!sh && lowerNames.indexOf(normKey_(s.getName())) > -1) sh = s; });
  }
  if (!sh) return null;
  var v = sh.getDataRange().getValues(); if (v.length <= 1) return { sheet: sh.getName(), rows: [], headers: v[0] || [] };
  var h = v[0].map(String), hn = h.map(normKey_);
  var cols = SCHEMA[target] ? SCHEMA[target].cols : Object.keys(MIG_COL_ALIAS);
  var peta = {};                                          // kolom target → indeks sumber
  cols.forEach(function (c) {
    var exact = h.indexOf(c); if (exact > -1) { peta[c] = exact; return; }
    var cand = [normKey_(c)].concat(MIG_COL_ALIAS[c] || []);
    for (var j = 0; j < cand.length; j++) { var ix = hn.indexOf(cand[j]); if (ix > -1 && Object.keys(peta).map(function (k) { return peta[k]; }).indexOf(ix) === -1) { peta[c] = ix; return; } }
  });
  var rows = v.slice(1).filter(function (r) { return r.join('') !== ''; }).map(function (r) {
    var o = { _raw: {} }; h.forEach(function (k, i) { o._raw[normKey_(k)] = r[i]; });
    Object.keys(peta).forEach(function (c) { o[c] = r[peta[c]]; });
    return o;
  });
  return { sheet: sh.getName(), rows: rows, headers: h, peta: peta };
}

// ---- Normalisasi nilai ----
function tglIso_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, APP.TZ, 'yyyy-MM-dd');
  var s = String(v || '').trim(); if (!s) return '';
  var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
  m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/); if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  return s;
}
function jamIso_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, APP.TZ, 'HH:mm:ss');
  var m = String(v || '').match(/(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?/);
  return m ? ('0' + m[1]).slice(-2) + ':' + m[2] + ':' + (m[3] || '00') : '';
}
function jamHM_(v) { var j = jamIso_(v); return j ? j.substring(0, 5) : ''; }
function statusAbsen_(v) {
  var s = lower_(v);
  if (/^(h|hadir|present|masuk)/.test(s)) return 'Hadir';
  if (/^(i|izin|ijin|permit)/.test(s)) return 'Izin';
  if (/^(s|sakit|sick)/.test(s)) return 'Sakit';
  if (/^(a|alpa|alpha|absent|tanpa)/.test(s)) return 'Alpha';
  return 'Hadir';
}
function jkNorm_(v) { var s = lower_(v); return /^(p|perempuan|f|female|wanita)/.test(s) ? 'P' : 'L'; }
function driveUrlNorm_(v) {
  var id = driveId_(v);
  return id ? 'https://drive.google.com/file/d/' + id + '/preview' : String(v || '').trim();
}
function str_(v) { return v instanceof Date ? Utilities.formatDate(v, APP.TZ, "yyyy-MM-dd'T'HH:mm:ssXXX") : (v === null || v === undefined ? '' : String(v).trim()); }

/**
 * Upsert batch per skill: target dibaca 1×, digabung di memori, ditulis 1×.
 * plan = { target, key(o), rows[], updatable[], fillBlank?, onlyIfPending?, sortBy? }
 */
function upsertPlan_(plan, dryRun) {
  var sh = getSheet_(plan.target), values = sh.getDataRange().getValues(), h = values[0].map(String);
  var toObj = function (r) { var o = {}; h.forEach(function (k, i) { o[k] = normCell_(k, r[i]); }); return o; };
  var index = {};
  for (var r = 1; r < values.length; r++) { if (values[r].join('') === '') continue; var k0 = plan.key(toObj(values[r])); if (k0) index[k0] = r; }
  var res = { source: plan.rows.length, inserted: 0, updated: 0, skipped: 0 }, newRows = [], seen = {}, dupe = 0;
  var keyCol = SCHEMA[plan.target].key, needIds = [];
  plan.rows.forEach(function (src) {
    var k = plan.key(src);
    if (!k) { res.skipped++; return; }
    if (seen[k]) { res.skipped++; dupe++; return; } seen[k] = true;
    if (index[k] !== undefined) {
      var row = values[index[k]], changed = false;
      var fields = (plan.updatable || []).concat(plan.fillBlank ? h : []);
      fields.forEach(function (f) {
        var i = h.indexOf(f); if (i === -1 || f === keyCol || src[f] === undefined || src[f] === '') return;
        var isUpd = (plan.updatable || []).indexOf(f) > -1;
        if (!isUpd && String(row[i]) !== '') return;           // fillBlank: hanya kolom kosong
        var v = String(src[f]);
        if (String(row[i]) !== v) { row[i] = v; changed = true; }
      });
      changed ? res.updated++ : res.skipped++;
    } else {
      var nr = h.map(function (f) { return src[f] !== undefined && src[f] !== null ? String(src[f]) : ''; });
      if (!nr[h.indexOf(keyCol)] && SCHEMA[plan.target].prefix) needIds.push(newRows.length);
      newRows.push(nr); res.inserted++;
    }
  });
  if (dupe) res.dupe = dupe;
  if (!dryRun && (res.updated || newRows.length)) {
    if (needIds.length) { var ids = reserveIds_(plan.target, needIds.length), ki = h.indexOf(keyCol); needIds.forEach(function (n, j) { newRows[n][ki] = ids[j]; }); }
    var body = values.slice(1).filter(function (r) { return r.join('') !== ''; }).map(function (r) { return r.map(function (c, i) { return c instanceof Date ? normCell_(h[i], c) : c; }); }).concat(newRows);
    if (plan.sortBy) { var si = h.indexOf(plan.sortBy); body.sort(function (a, b) { return String(a[si]).localeCompare(String(b[si])); }); }
    var all = [h].concat(body), max = sh.getMaxRows();
    if (all.length > max) { sh.insertRowsAfter(max, all.length - max + 100); sh.getRange(max + 1, 1, all.length - max + 100, h.length).setNumberFormat('@'); }
    sh.getRange(1, 1, all.length, h.length).setValues(all);
    var sisa = values.length - all.length; if (sisa > 0) sh.getRange(all.length + 1, 1, sisa, h.length).clearContent();
    invalidateRows_(plan.target);
    var pre = SCHEMA[plan.target].prefix;
    if (pre) {                                            // jaga high-water mark ID agar tidak bentrok dengan ID lama
      var kIx = h.indexOf(keyCol), mx = Number(propFresh_('SEQ_' + plan.target) || 0);
      body.forEach(function (r) { var m = String(r[kIx]).match(new RegExp('^' + pre + '(\\d+)$')); if (m) mx = Math.max(mx, Number(m[1])); });
      setProp_('SEQ_' + plan.target, String(mx));
      if (plan.target === 'Users') { amankanSandi_(); bump_('akun'); }   // hash lama dipindah ke Script Properties
    }
  }
  return res;
}

var MIG_URUTAN = ['Kelas', 'Mapel', 'Guru', 'Siswa', 'Users', 'Jadwal', 'Materi', 'Absensi', 'Nilai', 'Pengumuman', 'Config'];

function apiMigrasiScan(ctx, d) {
  var ss = openSource_(d.source), info = {};
  MIG_URUTAN.forEach(function (t) {
    var s = readSource_(ss, t);
    info[t] = s ? { ada: true, sheet: s.sheet, baris: s.rows.length, kolom: s.headers.length, terpetakan: Object.keys(s.peta || {}) } : { ada: false };
  });
  var dry = migrasiJalan_(ss, d, true);
  return ok_({ source: { name: ss.getName(), id: ss.getId() }, sheets: info, report: dry.report, warnings: dry.warnings, dryRun: true });
}

function apiMigrasiRun(ctx, d) {
  var ss = openSource_(d.source);
  var out = migrasiJalan_(ss, d, !!d.dryRun);
  if (!d.dryRun) {
    bump_('master'); bump_('absen'); bump_('nilai');
    setProp_('MIGRASI_TERAKHIR', JSON.stringify({ at: nowIso_(), source: ss.getId(), name: ss.getName() }));
    queueLog_([ctx.session.email, ctx.session.role, 'IMPORT_RUN', JSON.stringify(out.report).substring(0, 400), ss.getId()]);
    try { svcCrmSync(ctx, {}); } catch (e) {}
  }
  return ok_({ source: { name: ss.getName(), id: ss.getId() }, dryRun: !!d.dryRun, report: out.report, warnings: out.warnings },
    d.dryRun ? 'Pindai selesai (tidak ada data yang ditulis).' : 'Import selesai.');
}

/** Inti migrasi: master dulu, lalu relasi. */
function migrasiJalan_(ss, d, dryRun) {
  var pilih = d.sheets && d.sheets.length ? d.sheets : ['Kelas', 'Mapel', 'Guru', 'Siswa', 'Users', 'Jadwal', 'Materi', 'Nilai', 'Pengumuman', 'Config'];
  var timpa = !!d.overwrite, report = {}, warnings = [];
  var src = {}; MIG_URUTAN.forEach(function (t) { if (pilih.indexOf(t) > -1 || ['Kelas', 'Siswa', 'Guru'].indexOf(t) > -1) src[t] = readSource_(ss, t); });

  // ---- Resolver kelas: id lama / nama → id baru ----
  var kelasSrcNama = {};
  (src.Kelas ? src.Kelas.rows : []).forEach(function (k) { var nm = str_(k.nama_kelas || k.nama || k.kelas_id); if (k.kelas_id) kelasSrcNama[lower_(k.kelas_id)] = nm; kelasSrcNama[lower_(nm)] = nm; });
  function kelasResolver() {
    var map = {};
    DB.all('Kelas').forEach(function (k) { map[lower_(k.kelas_id)] = k.kelas_id; map[lower_(k.nama_kelas)] = k.kelas_id; });
    return function (v) { var s = lower_(v); if (!s) return ''; if (map[s]) return map[s]; var nm = kelasSrcNama[s]; return nm && map[lower_(nm)] ? map[lower_(nm)] : (dryRun && nm ? 'BARU:' + nm : ''); };
  }
  function run(t, plan) {
    if (pilih.indexOf(t) === -1) return;
    if (!src[t]) { report[t] = { source: 0, inserted: 0, updated: 0, skipped: 0, catatan: 'Sheet tidak ditemukan di app lama' }; return; }
    report[t] = upsertPlan_(plan, dryRun);
    if (report[t].dupe) warnings.push(t + ': ' + report[t].dupe + ' baris ganda di sumber dilewati.');
  }

  // 1. Kelas
  run('Kelas', { target: 'Kelas', key: function (o) { return lower_(o.nama_kelas); }, fillBlank: true, updatable: timpa ? ['jenjang', 'tingkat', 'wali_kelas_id', 'tahun_ajaran'] : [],
    rows: src.Kelas ? src.Kelas.rows.map(function (k) {
      var nm = str_(k.nama_kelas || k.kelas_id), jj = String(k.jenjang || '').toUpperCase();
      var ada = DB.find('Kelas', 'kelas_id', str_(k.kelas_id));
      return { kelas_id: ada ? '' : str_(k.kelas_id), nama_kelas: nm, jenjang: ['SD', 'SMP', 'SMA'].indexOf(jj) > -1 ? jj : (/^(x|xi|xii)\b/i.test(nm) ? 'SMA' : /^(vii|viii|ix)\b/i.test(nm) ? 'SMP' : 'SD'),
        tingkat: str_(k.tingkat), wali_kelas_id: str_(k.wali_kelas_id), tahun_ajaran: str_(k.tahun_ajaran) || setting_('TAHUN_AJARAN', '') };
    }) : [] });
  // Kelas yang hanya disebut di data siswa (tanpa sheet Kelas) → buat otomatis
  if (src.Siswa && pilih.indexOf('Siswa') > -1) {
    var rk = kelasResolver(), baruK = {};
    src.Siswa.rows.forEach(function (s) { var v = str_(s.kelas_id); if (v && !rk(v)) baruK[lower_(v)] = v; });
    var listK = Object.keys(baruK).map(function (k) { return { nama_kelas: baruK[k], jenjang: /^(x|xi|xii)\b/i.test(baruK[k]) ? 'SMA' : /^(vii|viii|ix)\b/i.test(baruK[k]) ? 'SMP' : 'SD', tahun_ajaran: setting_('TAHUN_AJARAN', '') }; });
    if (listK.length) {
      var rK = upsertPlan_({ target: 'Kelas', key: function (o) { return lower_(o.nama_kelas); }, rows: listK }, dryRun);
      warnings.push('Kelas dibuat otomatis dari data siswa: ' + listK.map(function (k) { return k.nama_kelas; }).join(', ') + (dryRun ? ' (akan dibuat)' : ''));
      listK.forEach(function (k) { kelasSrcNama[lower_(k.nama_kelas)] = k.nama_kelas; });
      if (report.Kelas) report.Kelas.inserted += rK.inserted;
    }
  }
  // 2. Mapel
  run('Mapel', { target: 'Mapel', key: function (o) { return lower_(o.nama); }, fillBlank: true, updatable: timpa ? ['kode', 'kelompok'] : [],
    rows: src.Mapel ? src.Mapel.rows.map(function (m) { return { nama: str_(m.nama || m.mata_pelajaran), kode: str_(m.kode), kelompok: str_(m.kelompok) || 'Wajib', jenjang: str_(m.jenjang) }; }) : [] });
  // 3. Guru
  run('Guru', { target: 'Guru', key: function (o) { return lower_(o.NUPTK); }, fillBlank: true, updatable: timpa ? ['nama_lengkap', 'mata_pelajaran', 'jabatan', 'foto_profil_url'] : [],
    rows: src.Guru ? src.Guru.rows.map(function (g) { return { NUPTK: str_(g.NUPTK), nama_lengkap: str_(g.nama_lengkap), email: lower_(g.email), no_wa: hp08_(g.no_wa), mata_pelajaran: str_(g.mata_pelajaran), jabatan: str_(g.jabatan) || 'Guru', foto_profil_url: str_(g.foto_profil_url), status: 'Aktif', dibuat_pada: nowIso_() }; }) : [] });
  // 4. Siswa
  var rkS = kelasResolver(), yatimKelas = 0;
  run('Siswa', { target: 'Siswa', key: function (o) { return lower_(o.NIS); }, fillBlank: true,
    updatable: timpa ? ['nama_lengkap', 'NISN', 'kelas_id', 'jenjang', 'nama_ortu', 'no_wa_ortu', 'alamat', 'foto_profil_url'] : [],
    rows: src.Siswa ? src.Siswa.rows.map(function (s) {
      var nis = str_(s.NIS).replace(/\.0+$/, ''), kid = rkS(s.kelas_id);
      if (s.kelas_id && !kid) yatimKelas++;
      var kel = DB.find('Kelas', 'kelas_id', kid) || {};
      return { NIS: nis, NISN: str_(s.NISN).replace(/\.0+$/, '').replace(/^(\d{8,9})$/, function (x) { return ('00' + x).slice(-10); }), nama_lengkap: str_(s.nama_lengkap), jenis_kelamin: jkNorm_(s.jenis_kelamin),
        kelas_id: kid.indexOf('BARU:') === 0 ? '' : kid, jenjang: str_(s.jenjang) || kel.jenjang || '', barcode_id: str_(s.barcode_id) || ('ID-' + nis), email: lower_(s.email), no_wa: hp08_(s.no_wa),
        nama_ortu: str_(s.nama_ortu), no_wa_ortu: hp08_(s.no_wa_ortu), tempat_lahir: str_(s.tempat_lahir), tanggal_lahir: tglIso_(s.tanggal_lahir), alamat: str_(s.alamat),
        foto_profil_url: /drive\.google\.com/.test(str_(s.foto_profil_url)) && driveId_(s.foto_profil_url) ? 'https://drive.google.com/thumbnail?id=' + driveId_(s.foto_profil_url) + '&sz=w400' : str_(s.foto_profil_url),
        tahun_masuk: str_(s.tahun_masuk), status: /lulus/i.test(str_(s.status)) ? 'Lulus' : /pindah/i.test(str_(s.status)) ? 'Pindah' : /non|tidak|false/i.test(str_(s.status)) ? 'Nonaktif' : 'Aktif', dibuat_pada: nowIso_() };
    }) : [] });
  if (yatimKelas) warnings.push(yatimKelas + ' siswa merujuk kelas yang tidak ditemukan — kolom kelas dikosongkan, atur ulang di menu Data Siswa.');
  if (src.Siswa) { var cnt = {}; src.Siswa.rows.forEach(function (s) { var e = lower_(s.email); if (e) cnt[e] = (cnt[e] || 0) + 1; }); var g2 = Object.keys(cnt).filter(function (e) { return cnt[e] > 1; }); if (g2.length) warnings.push('Email ganda di data siswa lama: ' + g2.slice(0, 5).join(', ') + (g2.length > 5 ? '…' : '')); }

  // 5. Users (akun login) — hash lama dipertahankan bila ada
  if (pilih.indexOf('Users') > -1) {
    var admin = 0, tanpaHash = 0, uRows = [];
    (src.Users ? src.Users.rows : []).forEach(function (u) {
      var role = lower_(u.role);
      if (/admin/.test(role)) { admin++; role = 'superadmin'; }
      else role = /guru|teacher/.test(role) ? 'guru' : 'siswa';
      var hash = str_(u.password_hash), salt = str_(u.salt), ref = str_(u.ref_id || u._raw.nis || u._raw.nuptk).replace(/\.0+$/, '');
      if (!/^[a-f0-9]{64}$/i.test(hash) && !/^[A-Za-z0-9+\/]{43}=$/.test(hash) && !/^v2\$/.test(hash)) { tanpaHash++; salt = newSalt_(); hash = dryRun ? '' : hashPassword_(ref || sandiAcak_(10), salt, 1); }
      uRows.push({ nama: str_(u.nama || u.nama_lengkap), email: lower_(u.email), password_hash: hash, salt: salt, role: role, ref_id: ref, kelas_id: '', status_aktif: /^(tidak|false|0|nonaktif|n)$/i.test(str_(u.status_aktif)) ? 'TIDAK' : 'YA',
        wajib_ganti_sandi: tanpaHash ? 'YA' : 'TIDAK', last_login: '', dibuat_pada: nowIso_() });
    });
    // Akun otomatis untuk siswa/guru yang belum punya akun (password awal = NIS / NUPTK)
    if (d.buatAkun !== false) {
      var punya = {}; DB.all('Users').forEach(function (u) { punya[u.role + ':' + u.ref_id] = 1; }); uRows.forEach(function (u) { punya[u.role + ':' + u.ref_id] = 1; });
      var dom = setting_('EMAIL_DOMAIN_SISWA', 'siswa.sch.id'), dipakai = {}; DB.all('Users').forEach(function (u) { dipakai[lower_(u.email)] = 1; }); uRows.forEach(function (u) { dipakai[u.email] = 1; });
      var auto = 0;
      var sumberSiswa = dryRun && src.Siswa ? src.Siswa.rows.map(function (s) { return { NIS: str_(s.NIS).replace(/\.0+$/, ''), nama_lengkap: str_(s.nama_lengkap), email: lower_(s.email) }; }) : DB.all('Siswa');
      sumberSiswa.forEach(function (s) {
        if (!s.NIS || punya['siswa:' + s.NIS]) return;
        var e = lower_(s.email); if (!e || dipakai[e]) { var base = slug_(s.nama_lengkap).split('.').slice(0, 2).join('.') || s.NIS; e = base + '@' + dom; var i = 2; while (dipakai[e]) { e = base + i + '@' + dom; i++; } }
        dipakai[e] = 1; var sl = newSalt_(); auto++;
        uRows.push({ nama: s.nama_lengkap, email: e, password_hash: dryRun ? '' : hashPassword_(s.NIS, sl, 1), salt: sl, role: 'siswa', ref_id: s.NIS, kelas_id: s.kelas_id || '', status_aktif: 'YA', wajib_ganti_sandi: 'YA', last_login: '', dibuat_pada: nowIso_() });
      });
      if (auto) warnings.push(auto + ' akun siswa dibuat otomatis dengan password awal = NIS (wajib ganti saat login).');
    }
    report.Users = upsertPlan_({ target: 'Users', key: function (o) { return lower_(o.email); }, rows: uRows, updatable: [] }, dryRun);
    if (admin) warnings.push(admin + ' akun Admin lama diimpor sebagai Super Admin. Periksa di menu Kelola Akun.');
    if (tanpaHash) warnings.push(tanpaHash + ' akun lama tanpa hash SHA-256 yang dikenali → password diatur = NIS/NUPTK (wajib ganti).');
    if (!dryRun) {                                       // sinkronkan kelas_id akun siswa
      var km = {}; DB.all('Siswa').forEach(function (s) { km[s.NIS] = s.kelas_id; });
      DB.updateBatch('Users', 'user_id', DB.all('Users').filter(function (u) { return u.role === 'siswa' && km[u.ref_id] !== undefined && u.kelas_id !== km[u.ref_id]; }).map(function (u) { return { user_id: u.user_id, kelas_id: km[u.ref_id] }; }));
    }
  }
  // 6. Jadwal
  var rkJ = kelasResolver();
  run('Jadwal', { target: 'Jadwal', key: function (o) { return [o.kelas_id, lower_(o.hari), jamHM_(o.jam_mulai), lower_(o.mata_pelajaran)].join('|'); }, fillBlank: true, updatable: timpa ? ['guru_id', 'jam_selesai', 'ruang'] : [],
    rows: src.Jadwal ? src.Jadwal.rows.map(function (j) { return { kelas_id: rkJ(j.kelas_id), mata_pelajaran: str_(j.mata_pelajaran), guru_id: str_(j.guru_id).replace(/\.0+$/, ''), hari: str_(j.hari).replace(/^./, function (c) { return c.toUpperCase(); }), jam_mulai: jamHM_(j.jam_mulai), jam_selesai: jamHM_(j.jam_selesai), ruang: str_(j.ruang) }; })
      .filter(function (j) { if (!j.kelas_id) { warnings.push('Jadwal ' + j.mata_pelajaran + ' ' + j.hari + ' dilewati: kelas tidak ditemukan.'); return false; } return true; }) : [] });
  // 7. Materi — ID file Drive lama tetap valid (akun Google sama)
  var rkM = kelasResolver();
  run('Materi', { target: 'Materi', key: function (o) { return lower_(o.materi_id) || lower_(o.judul); }, fillBlank: true, updatable: timpa ? ['judul', 'deskripsi', 'url_konten'] : [],
    rows: src.Materi ? src.Materi.rows.map(function (m) {
      var url = str_(m.url_konten), tipe = /video|youtube/i.test(str_(m.tipe)) || youtubeId_(url) ? 'video' : 'dokumen';
      var did = str_(m.drive_file_id) || driveId_(url);
      return { materi_id: str_(m.materi_id), judul: str_(m.judul), deskripsi: str_(m.deskripsi), mata_pelajaran: str_(m.mata_pelajaran), kelas_id: rkM(m.kelas_id), guru_id: str_(m.guru_id).replace(/\.0+$/, ''), tipe: tipe,
        url_konten: tipe === 'video' ? 'https://www.youtube.com/embed/' + youtubeId_(url) : (did ? 'https://drive.google.com/file/d/' + did + '/preview' : url), drive_file_id: tipe === 'video' ? '' : did,
        ukuran: '', durasi: '', tanggal_upload: str_(m.tanggal_upload) || nowIso_(), status: 'Aktif' };
    }) : [] });
  // 8. Absensi (opsional, bisa besar) — urut ulang by tanggal
  var nisAda = {}; (dryRun && src.Siswa ? src.Siswa.rows.map(function (s) { return str_(s.NIS).replace(/\.0+$/, ''); }) : []).concat(DB.all('Siswa').map(function (s) { return s.NIS; })).forEach(function (n) { nisAda[n] = 1; });
  var kelasSiswa = {}; DB.all('Siswa').forEach(function (s) { kelasSiswa[s.NIS] = s.kelas_id; });
  if (pilih.indexOf('Absensi') > -1) {
    src.Absensi = src.Absensi || readSource_(ss, 'Absensi');
    var yatimA = 0;
    run('Absensi', { target: 'Absensi', key: function (o) { return String(o.NIS) + '|' + tglIso_(o.tanggal); }, updatable: timpa ? ['status', 'keterangan'] : [], sortBy: 'tanggal',
      rows: src.Absensi ? src.Absensi.rows.map(function (a) {
        var nis = str_(a.NIS).replace(/\.0+$/, ''), st = statusAbsen_(a.status), jam = jamIso_(a.jam);
        return { absensi_id: '', NIS: nis, kelas_id: kelasSiswa[nis] || rkM(a.kelas_id), tanggal: tglIso_(a.tanggal), jam: jam, status: st, metode: lower_(a.metode) || 'manual', latitude: str_(a.latitude), longitude: str_(a.longitude),
          jarak_m: '', foto_selfie_id: driveId_(a.foto_selfie_id) || str_(a.foto_selfie_id), keterangan: str_(a.keterangan), terlambat: st === 'Hadir' && jam && jam.substring(0, 5) > setting_('JAM_MASUK', '07:15') ? 'YA' : st === 'Hadir' ? 'TIDAK' : '', dicatat_oleh: 'IMPORT', dibuat_pada: nowIso_() };
      }).filter(function (a) { if (!nisAda[a.NIS]) { yatimA++; return false; } return !!a.tanggal; }) : [] });
    if (yatimA) warnings.push(yatimA + ' baris absensi dilewati karena NIS tidak ada di data siswa.');
  }
  // 9. Nilai — nilai akhir dihitung ulang bila kosong
  if (pilih.indexOf('Nilai') > -1) {
    var yatimN = 0;
    run('Nilai', { target: 'Nilai', key: nilaiKey_, fillBlank: true, updatable: timpa ? ['nilai_harian', 'nilai_uts', 'nilai_uas', 'nilai_akhir', 'predikat', 'catatan'] : [],
      rows: src.Nilai ? src.Nilai.rows.map(function (n) {
        var nis = str_(n.NIS).replace(/\.0+$/, ''), h = n.nilai_harian === '' ? '' : num_(n.nilai_harian, ''), u = n.nilai_uts === '' ? '' : num_(n.nilai_uts, ''), a = n.nilai_uas === '' ? '' : num_(n.nilai_uas, '');
        var akhir = n.nilai_akhir !== undefined && n.nilai_akhir !== '' ? num_(n.nilai_akhir) : hitungAkhir_(h === undefined ? '' : h, u === undefined ? '' : u, a === undefined ? '' : a);
        return { nilai_id: '', NIS: nis, kelas_id: kelasSiswa[nis] || rkM(n.kelas_id), mata_pelajaran: str_(n.mata_pelajaran), guru_id: str_(n.guru_id).replace(/\.0+$/, ''), semester: str_(n.semester) || setting_('SEMESTER', ''),
          tahun_ajaran: str_(n.tahun_ajaran) || setting_('TAHUN_AJARAN', ''), nilai_harian: h === undefined ? '' : h, nilai_uts: u === undefined ? '' : u, nilai_uas: a === undefined ? '' : a, nilai_akhir: akhir, predikat: predikat_(akhir), catatan: str_(n.catatan), diperbarui_pada: nowIso_() };
      }).filter(function (n) { if (!nisAda[n.NIS]) { yatimN++; return false; } return !!n.mata_pelajaran; }) : [] });
    if (yatimN) warnings.push(yatimN + ' baris nilai dilewati karena NIS tidak ada di data siswa.');
  }
  // 10. Pengumuman
  run('Pengumuman', { target: 'Pengumuman', key: function (o) { return lower_(o.judul) + '|' + String(o.tanggal).substring(0, 10); },
    rows: src.Pengumuman ? src.Pengumuman.rows.map(function (p) { return { judul: str_(p.judul), isi: str_(p.isi), kategori: str_(p.kategori) || 'Informasi', tanggal: str_(p.tanggal) || nowIso_(), oleh: str_(p.oleh) || 'IMPORT', status: 'Aktif' }; }) : [] });
  // 11. Config — salin hanya bila nilai target masih bawaan (seed)
  if (pilih.indexOf('Config') > -1) {
    var cs = readSource_(ss, 'Config'), seed = {}, pairs = {};
    CONFIG_SEED.forEach(function (r) { seed[r[0]] = r[1]; });
    var lama = {};
    if (cs && cs.rows.length) {
      var raw0 = cs.rows[0]._raw;
      if (raw0.key !== undefined && raw0.value !== undefined) cs.rows.forEach(function (r) { lama[normKey_(r._raw.key)] = r._raw.value; });
      else Object.keys(raw0).forEach(function (k) { lama[k] = raw0[k]; });
    }
    var petaCfg = { NAMA_SEKOLAH: ['namasekolah', 'sekolahnama', 'appname', 'namainstitusi'], LAT_SEKOLAH: ['latsekolah', 'latitudesekolah', 'latitude'], LNG_SEKOLAH: ['lngsekolah', 'longitudesekolah', 'longitude'],
      RADIUS_M: ['radiusm', 'radiusabsensimeter', 'radius'], LOGO_URL: ['logourl', 'logo'], ALAMAT_SEKOLAH: ['alamatsekolah', 'alamat'], KKM: ['kkm'] };
    var cfgNow = settings_(), dipakai = [];
    Object.keys(petaCfg).forEach(function (k) {
      var v; petaCfg[k].some(function (a) { if (lama[a] !== undefined && lama[a] !== '') { v = lama[a]; return true; } return false; });
      if (v === undefined) return;
      if ((cfgNow[k] === seed[k] || cfgNow[k] === '' || timpa) && String(cfgNow[k]) !== String(v)) { pairs[k] = str_(v); dipakai.push(k + '=' + str_(v)); }
    });
    report.Config = { source: Object.keys(lama).length, inserted: 0, updated: Object.keys(pairs).length, skipped: 0 };
    if (dipakai.length) warnings.push('Pengaturan lama diterapkan: ' + dipakai.join(', ') + (dryRun ? ' (akan diterapkan)' : ''));
    if (!dryRun && Object.keys(pairs).length) saveSettings_(pairs);
  }
  return { report: report, warnings: warnings };
}

/** Import CSV siswa (data dari luar app) — rows sudah di-parse di browser */
function apiMigrasiCsv(ctx, d) {
  var rows = d.rows || [];
  if (!rows.length) return fail_('CSV kosong.');
  if (rows.length > 3000) return fail_('Maksimal 3.000 baris per import.');
  var kelasMap = {}; DB.all('Kelas').forEach(function (k) { kelasMap[lower_(k.nama_kelas)] = k; kelasMap[lower_(k.kelas_id)] = k; });
  var warnings = [], baruKelas = {};
  var list = rows.map(function (r) {
    var o = {}; Object.keys(r).forEach(function (k) { o[normKey_(k)] = r[k]; });
    var pick = function (col) { var c = [normKey_(col)].concat(MIG_COL_ALIAS[col] || []); for (var i = 0; i < c.length; i++) if (o[c[i]] !== undefined && o[c[i]] !== '') return String(o[c[i]]).trim(); return ''; };
    var kls = pick('kelas_id'), k = kelasMap[lower_(kls)];
    if (kls && !k) baruKelas[lower_(kls)] = kls;
    var nis = pick('NIS');
    return { NIS: nis, NISN: pick('NISN'), nama_lengkap: pick('nama_lengkap'), jenis_kelamin: jkNorm_(pick('jenis_kelamin')), kelas_id: k ? k.kelas_id : kls, jenjang: k ? k.jenjang : '', barcode_id: pick('barcode_id') || ('ID-' + nis),
      email: lower_(pick('email')), no_wa: hp08_(pick('no_wa')), nama_ortu: pick('nama_ortu'), no_wa_ortu: hp08_(pick('no_wa_ortu')), tempat_lahir: pick('tempat_lahir'), tanggal_lahir: tglIso_(pick('tanggal_lahir')),
      alamat: pick('alamat'), foto_profil_url: '', tahun_masuk: pick('tahun_masuk') || setting_('TAHUN_AJARAN', ''), status: 'Aktif', dibuat_pada: nowIso_() };
  }).filter(function (r) { if (!r.NIS || !r.nama_lengkap) { warnings.push('Baris tanpa NIS/nama dilewati.'); return false; } return true; });
  var kb = Object.keys(baruKelas);
  if (kb.length) {
    warnings.push('Kelas baru ' + (d.dryRun ? 'akan dibuat' : 'dibuat') + ': ' + kb.map(function (k) { return baruKelas[k]; }).join(', '));
    if (!d.dryRun) {
      upsertPlan_({ target: 'Kelas', key: function (o) { return lower_(o.nama_kelas); }, rows: kb.map(function (k) { var n = baruKelas[k]; return { nama_kelas: n, jenjang: /^(x|xi|xii)\b/i.test(n) ? 'SMA' : /^(vii|viii|ix)\b/i.test(n) ? 'SMP' : 'SD', tahun_ajaran: setting_('TAHUN_AJARAN', '') }; }) }, false);
      var km = {}; DB.all('Kelas').forEach(function (k) { km[lower_(k.nama_kelas)] = k; });
      list.forEach(function (r) { var k = km[lower_(r.kelas_id)]; if (k) { r.kelas_id = k.kelas_id; r.jenjang = k.jenjang; } });
    }
  }
  var rep = upsertPlan_({ target: 'Siswa', key: function (o) { return lower_(o.NIS); }, rows: list, fillBlank: true, updatable: d.overwrite ? ['nama_lengkap', 'NISN', 'kelas_id', 'jenjang', 'nama_ortu', 'no_wa_ortu', 'alamat'] : [] }, !!d.dryRun);
  var akun = 0;
  if (!d.dryRun && d.buatAkun !== false) {
    var punya = {}; DB.all('Users').forEach(function (u) { if (u.role === 'siswa') punya[u.ref_id] = 1; });
    var dipakai = {}; DB.all('Users').forEach(function (u) { dipakai[lower_(u.email)] = 1; });
    var dom = setting_('EMAIL_DOMAIN_SISWA', 'siswa.sch.id'), baru = [];
    DB.all('Siswa').forEach(function (s) {
      if (punya[s.NIS]) return;
      var e = lower_(s.email); if (!e || dipakai[e]) { var base = slug_(s.nama_lengkap).split('.').slice(0, 2).join('.') || s.NIS; e = base + '@' + dom; var i = 2; while (dipakai[e]) { e = base + i + '@' + dom; i++; } }
      dipakai[e] = 1; var sl = newSalt_();
      baru.push({ nama: s.nama_lengkap, email: e, password_hash: hashPassword_(s.NIS, sl, 1), salt: sl, role: 'siswa', ref_id: s.NIS, kelas_id: s.kelas_id, status_aktif: 'YA', wajib_ganti_sandi: 'YA', last_login: '', dibuat_pada: nowIso_() });
    });
    if (baru.length) { var ids = reserveIds_('Users', baru.length); baru.forEach(function (u, i) { u.user_id = ids[i]; }); DB.appendBatch('Users', baru); akun = baru.length; warnings.push(akun + ' akun siswa dibuat (password awal = NIS).'); }
  }
  if (!d.dryRun) { bump_('master'); try { svcCrmSync(ctx, {}); } catch (e) {} }
  return ok_({ report: { Siswa: rep }, akun: akun, warnings: warnings, dryRun: !!d.dryRun }, d.dryRun ? 'Pindai CSV selesai.' : 'Import CSV selesai.');
}

;
// ==== Notifikasi.gs ====
/**
 * =====================================================================
 *  SIAKAD SISWA — File 4/5 : Notifikasi.gs  (gas-notifikasi-wa-crm)
 *  WhatsApp (Fonnte) + Email: saklar utama, matriks event, antrean,
 *  prosesor per menit, blast per batch 10/20/50, deteksi nomor WA.
 *  Token Fonnte disimpan di Script Properties — tidak pernah ke browser
 *  (respons hanya versi tersamar samarkan_). v2.1: antrean via cache (_NQ).
 * =====================================================================
 */

var FONNTE_API = 'https://api.fonnte.com';

/** Registry kejadian yang bisa diaktif/nonaktifkan. Placeholder umum: {nama} {institusi} {link} */
var NOTIF_EVENTS = {
  AKUN_DIBUAT: { label: 'Akun SIAKAD dibuat (kredensial awal)', wa: true, email: true, vars: ['nama', 'username', 'sandi', 'nis', 'link', 'institusi'],
    subjek: 'Akun SIAKAD {nama}',
    pesan: 'Yth. {nama},\nAkun SIAKAD SISWA telah dibuat.\nUsername: *{username}*\nSandi awal: *{sandi}*\nLogin: {link}\nSegera ganti password setelah login pertama.\n— {institusi}' },
  ABSEN_HADIR: { label: 'Siswa tercatat hadir (ke orang tua)', wa: true, email: false, vars: ['nama', 'status', 'tanggal', 'jam', 'metode', 'institusi'],
    subjek: 'Kehadiran {nama} — {tanggal}',
    pesan: 'Yth. Orang Tua/Wali dari *{nama}*,\nAnanda tercatat *{status}* pada {tanggal} pukul {jam} WIB ({metode}).\n— {institusi}' },
  ABSEN_ALPHA: { label: 'Siswa alpha / tanpa keterangan', wa: true, email: true, vars: ['nama', 'tanggal', 'institusi'],
    subjek: 'Pemberitahuan Ketidakhadiran {nama}',
    pesan: 'Yth. Orang Tua/Wali dari *{nama}*,\nAnanda tercatat *TIDAK HADIR tanpa keterangan (Alpha)* pada {tanggal}. Mohon konfirmasi kepada wali kelas.\n— {institusi}' },
  ABSEN_IZIN_SAKIT: { label: 'Siswa izin / sakit dicatat', wa: true, email: false, vars: ['nama', 'status', 'tanggal', 'institusi'],
    subjek: 'Status Kehadiran {nama}',
    pesan: 'Yth. Orang Tua/Wali dari *{nama}*,\nKetidakhadiran Ananda pada {tanggal} tercatat sebagai *{status}*. Terima kasih atas konfirmasinya.\n— {institusi}' },
  NILAI_TERBIT: { label: 'Nilai mata pelajaran terbit', wa: true, email: true, vars: ['nama', 'mapel', 'nilai', 'predikat', 'semester', 'link', 'institusi'],
    subjek: 'Nilai {mapel} — {nama}',
    pesan: 'Yth. Orang Tua/Wali dari *{nama}*,\nNilai *{mapel}* semester {semester} telah terbit: *{nilai}* (predikat {predikat}).\nCek raport digital: {link}\n— {institusi}' },
  REMEDIAL: { label: 'Nilai di bawah KKM (remedial)', wa: true, email: true, vars: ['nama', 'mapel', 'nilai', 'kkm', 'link', 'institusi'],
    subjek: 'Pemberitahuan Remedial {mapel}',
    pesan: 'Yth. Orang Tua/Wali dari *{nama}*,\nNilai akhir *{mapel}* Ananda *{nilai}* masih di bawah KKM {kkm}. Ananda dijadwalkan mengikuti remedial; informasi lengkap dari guru mapel.\n— {institusi}' },
  MATERI_BARU: { label: 'Materi pembelajaran baru', wa: false, email: true, vars: ['nama', 'judul', 'mapel', 'guru', 'link', 'institusi'],
    subjek: 'Materi baru: {judul}',
    pesan: 'Halo {nama},\nMateri baru *{judul}* ({mapel}) dari {guru} sudah tersedia di SIAKAD.\nBuka: {link}\n— {institusi}' },
  PENGUMUMAN: { label: 'Pengumuman sekolah', wa: true, email: true, vars: ['nama', 'judul', 'isi', 'institusi'],
    subjek: '{judul}',
    pesan: '📢 *{judul}*\n\n{isi}\n\n— {institusi}' },
  RESET_SANDI: { label: 'Kode reset password (lupa password)', wa: true, email: true, vars: ['nama', 'kode', 'institusi'],
    subjek: 'Kode Reset Password SIAKAD',
    pesan: 'Kode reset password SIAKAD untuk {nama}: *{kode}*\nBerlaku 15 menit. Abaikan bila Anda tidak memintanya.\n— {institusi}' },
  RESET_SANDI_ADMIN: { label: 'Password direset oleh guru/admin', wa: true, email: true, vars: ['nama', 'username', 'sandi', 'link', 'institusi'],
    subjek: 'Password SIAKAD direset',
    pesan: 'Yth. {nama},\nPassword SIAKAD telah direset.\nUsername: *{username}*\nSandi baru: *{sandi}*\nLogin: {link}\n— {institusi}' },
  // --- v2.1: tagihan & pembayaran (gas-tagihan-pembayaran) ---
  TAGIHAN_TERBIT: { label: 'Tagihan baru terbit (ke orang tua)', wa: true, email: true, vars: ['nama', 'periode', 'jumlah', 'jatuhTempo', 'rekening', 'nis', 'link', 'institusi'],
    subjek: 'Tagihan {periode} — {nama}',
    pesan: 'Yth. Orang Tua/Wali dari *{nama}* (NIS {nis}),\nTagihan *{periode}* sebesar *{jumlah}* telah terbit. Jatuh tempo {jatuhTempo}.\nPembayaran ke: {rekening}\nUnggah bukti transfer di: {link}\n— {institusi}' },
  TAGIHAN_REMINDER_H3: { label: 'Pengingat tagihan H-3', wa: true, email: false, vars: ['nama', 'periode', 'jumlah', 'jatuhTempo', 'hari', 'rekening', 'nis', 'institusi'],
    subjek: 'Pengingat: {periode} jatuh tempo {jatuhTempo}',
    pesan: 'Yth. Orang Tua/Wali dari *{nama}*,\nPengingat: *{periode}* sebesar *{jumlah}* jatuh tempo *{jatuhTempo}* ({hari}).\nPembayaran ke: {rekening}. Abaikan bila sudah membayar.\n— {institusi}' },
  TAGIHAN_REMINDER_H0: { label: 'Pengingat tagihan hari jatuh tempo', wa: true, email: true, vars: ['nama', 'periode', 'jumlah', 'jatuhTempo', 'hari', 'rekening', 'nis', 'institusi'],
    subjek: 'Hari ini jatuh tempo: {periode}',
    pesan: 'Yth. Orang Tua/Wali dari *{nama}*,\n*{periode}* sebesar *{jumlah}* jatuh tempo *hari ini* ({jatuhTempo}).\nPembayaran ke: {rekening}. Abaikan bila sudah membayar.\n— {institusi}' },
  PEMBAYARAN_VERIFIKASI: { label: 'Hasil verifikasi pembayaran', wa: true, email: true, vars: ['nama', 'periode', 'status', 'catatan', 'institusi'],
    subjek: 'Pembayaran {periode}: {status}',
    pesan: 'Yth. Orang Tua/Wali dari *{nama}*,\nPembayaran {periode}: *{status}*.\n{catatan}\n— {institusi}' }
};

// ---------------------------------------------------------------------
// Konfigurasi & matriks
// ---------------------------------------------------------------------
function waAktif_() { return setting_('NOTIF_WA_AKTIF', 'TIDAK') === 'YA' && !!prop_('FONNTE_TOKEN'); }
function emailAktif_() { return setting_('NOTIF_EMAIL_AKTIF', 'TIDAK') === 'YA'; }
function tokenMask_() { return samarkan_(prop_('FONNTE_TOKEN')); }

function matriksNotif_() {
  var simpan = {};
  try { simpan = JSON.parse(setting_('NOTIF_MATRIKS', '') || '{}') || {}; } catch (e) {}
  var out = {};
  Object.keys(NOTIF_EVENTS).forEach(function (k) {
    var d = NOTIF_EVENTS[k], s = simpan[k] || {};
    out[k] = { kode: k, label: d.label, vars: d.vars,
      wa: s.wa !== undefined ? !!s.wa : d.wa, email: s.email !== undefined ? !!s.email : d.email,
      subjek: s.subjek || d.subjek, pesan: s.pesan || d.pesan, subjekDefault: d.subjek, pesanDefault: d.pesan };
  });
  return out;
}
function triggerAktif_() { return ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'pekerjaMenit'; }); }

function svcNotifConfig(ctx, d) {
  var m = matriksNotif_();
  var quota = 0; try { quota = MailApp.getRemainingDailyQuota(); } catch (e) {}
  return ok_({
    waAktif: setting_('NOTIF_WA_AKTIF', 'TIDAK') === 'YA', emailAktif: emailAktif_(), tokenAda: !!prop_('FONNTE_TOKEN'), tokenMask: tokenMask_(),
    batchDefault: Number(setting_('WA_BATCH_DEFAULT', 20)), jeda: setting_('WA_JEDA_DETIK', '5'), deteksiOtomatis: setting_('WA_DETEKSI_OTOMATIS', 'YA') === 'YA',
    namaPengirim: setting_('EMAIL_NAMA_PENGIRIM', APP.NAME), appUrl: setting_('APP_URL', ''), sisaKuotaEmail: quota, trigger: triggerAktif_(),
    matriks: Object.keys(m).map(function (k) { return m[k]; })
  });
}

function svcNotifConfigSave(ctx, d) {
  var pairs = {};
  if (d.token) { var rt = simpanRahasia_('FONNTE_TOKEN', d.token); if (rt) return fail_(rt); }   // allowlist + validasi (Admin.gs)
  if (d.waAktif === true && !prop_('FONNTE_TOKEN')) return fail_('Isi token Fonnte terlebih dahulu sebelum mengaktifkan WhatsApp.');
  if (d.waAktif !== undefined) pairs.NOTIF_WA_AKTIF = d.waAktif ? 'YA' : 'TIDAK';
  if (d.emailAktif !== undefined) pairs.NOTIF_EMAIL_AKTIF = d.emailAktif ? 'YA' : 'TIDAK';
  if (d.batchDefault !== undefined) { if ([10, 20, 50].indexOf(Number(d.batchDefault)) === -1) return fail_('Ukuran batch harus 10, 20, atau 50.'); pairs.WA_BATCH_DEFAULT = String(d.batchDefault); }
  if (d.jeda !== undefined) { if (!/^\d{1,3}(-\d{1,3})?$/.test(String(d.jeda))) return fail_('Jeda harus angka (5) atau rentang (3-8).'); pairs.WA_JEDA_DETIK = String(d.jeda); }
  if (d.deteksiOtomatis !== undefined) pairs.WA_DETEKSI_OTOMATIS = d.deteksiOtomatis ? 'YA' : 'TIDAK';
  if (d.namaPengirim !== undefined) pairs.EMAIL_NAMA_PENGIRIM = String(d.namaPengirim).substring(0, 60);
  if (d.appUrl !== undefined) pairs.APP_URL = String(d.appUrl).trim();
  if (d.matriks) {
    var simpan = {};
    (Array.isArray(d.matriks) ? d.matriks : Object.keys(d.matriks).map(function (k) { return Object.assign({ kode: k }, d.matriks[k]); })).forEach(function (m) {
      var def = NOTIF_EVENTS[m.kode]; if (!def) return;
      var s = {};
      if (!!m.wa !== def.wa) s.wa = !!m.wa;
      if (!!m.email !== def.email) s.email = !!m.email;
      if (m.pesan && m.pesan !== def.pesan) s.pesan = String(m.pesan).substring(0, 2000);
      if (m.subjek && m.subjek !== def.subjek) s.subjek = String(m.subjek).substring(0, 200);
      if (Object.keys(s).length) simpan[m.kode] = s;
    });
    pairs.NOTIF_MATRIKS = JSON.stringify(simpan);
  }
  saveSettings_(pairs);
  try { pasangTrigger(); } catch (e) {}
  return svcNotifConfig(ctx, {});
}

// ---------------------------------------------------------------------
// Antrean — satu-satunya pintu kirim notifikasi otomatis (tidak pernah melempar error)
// ---------------------------------------------------------------------
function kirimNotif_(event, penerima, vars, refId) {
  return kirimNotifBatch_(event, [{ penerima: penerima, vars: vars, refId: refId }]);
}

function kirimNotifBatch_(event, daftar) {
  try {
    if (!daftar || !daftar.length) return 0;
    var waOn = waAktif_(), emOn = emailAktif_();
    if (!waOn && !emOn) return 0;
    var m = matriksNotif_()[event];
    if (!m || (!m.wa && !m.email)) return 0;
    var dasar = { institusi: setting_('NAMA_SEKOLAH', APP.NAME), link: setting_('APP_URL', '') };
    var rows = [];
    daftar.forEach(function (d) {
      var p = d.penerima || {}, v = Object.assign({}, dasar, { nama: p.nama || 'Bapak/Ibu' }, d.vars || {});
      if (waOn && m.wa && hpValid_(p.hp)) rows.push(barisAntrian_('WA', hp62_(p.hp), p.nama, '', isiTemplate_(m.pesan, v), event, d.refId, ''));
      if (emOn && m.email && emailValid_(p.email)) rows.push(barisAntrian_('EMAIL', String(p.email).trim(), p.nama, isiTemplate_(m.subjek, v), isiTemplate_(m.pesan, v), event, d.refId, ''));
    });
    if (!rows.length) return 0;
    if (_IN_WEB) { _NQ = _NQ.concat(rows); return rows.length; }   // request web: antre di cache setelah aksi sukses
    return tulisAntrian_(rows);                                     // trigger / editor: langsung ke sheet
  } catch (e) { console.error('kirimNotif_ (tidak fatal): ' + e.message); return 0; }
}

function barisAntrian_(kanal, tujuan, nama, subjek, pesan, event, refId, blastId) {
  return { AntrianID: '', Kanal: kanal, Tujuan: tujuan, NamaPenerima: nama || '', Subjek: subjek || '', Pesan: pesan, Event: event || '', RefID: refId || '', BlastID: blastId || '',
    Status: 'Antri', Percobaan: 0, Respon: '', DibuatPada: nowIso_(), DikirimPada: '' };
}

// ---------------------------------------------------------------------
// Fonnte
// ---------------------------------------------------------------------
function fonnte_(path, payload) {
  var token = prop_('FONNTE_TOKEN');
  if (!token) return { status: false, reason: 'Token Fonnte belum diisi.' };
  try {
    var r = UrlFetchApp.fetch(FONNTE_API + path, { method: 'post', headers: { Authorization: token }, payload: payload || {}, muteHttpExceptions: true });
    try { return JSON.parse(r.getContentText()); } catch (e) { return { status: false, reason: r.getContentText().substring(0, 120) }; }
  } catch (e) { return { status: false, reason: 'Koneksi Fonnte gagal: ' + e.message }; }
}

/** 1 request per batch (param `data`); fallback 1 request/pesan paralel (fetchAll) */
function fonnteKirimBanyak_(pesan, jeda) {
  if (!pesan.length) return [];
  var data = pesan.map(function (m) { return { target: m.target, message: m.message, delay: String(jeda || '2'), countryCode: '62' }; });
  var res = fonnte_('/send', { data: JSON.stringify(data) });
  if (res && res.status) return pesan.map(function (m, i) { return { ok: true, respon: 'OK ' + ([].concat(res.id || [])[i] || '') }; });
  var token = prop_('FONNTE_TOKEN');
  if (!token) return pesan.map(function () { return { ok: false, respon: 'Token kosong' }; });
  var resps = UrlFetchApp.fetchAll(pesan.map(function (m) {
    return { url: FONNTE_API + '/send', method: 'post', headers: { Authorization: token }, payload: { target: m.target, message: m.message, countryCode: '62' }, muteHttpExceptions: true };
  }));
  return resps.map(function (r) {
    try { var j = JSON.parse(r.getContentText()); return { ok: !!j.status, respon: j.status ? 'OK' : (j.reason || 'Ditolak') }; }
    catch (e) { return { ok: false, respon: 'HTTP ' + r.getResponseCode() }; }
  });
}

function emailHtml_(subjek, pesan) {
  var esc = String(pesan).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  var body = esc.replace(/\*([^*\n]+)\*/g, '<b>$1</b>').replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>').replace(/\n/g, '<br>');
  return '<div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:auto;border:1px solid #E2E8F0;border-radius:12px;overflow:hidden">' +
    '<div style="background:#1E3A5F;color:#fff;padding:16px 20px;font-weight:700">' + setting_('NAMA_SEKOLAH', APP.NAME) + '<div style="font-size:12px;font-weight:400;color:#F5A623">SIAKAD SISWA</div></div>' +
    '<div style="padding:20px;color:#1A1A2E;font-size:14px;line-height:1.6">' + body + '</div>' +
    '<div style="padding:12px 20px;background:#F5F7FA;color:#64748B;font-size:11px">Pesan otomatis dari SIAKAD SISWA. Mohon tidak membalas email ini.</div></div>';
}

// ---------------------------------------------------------------------
// Prosesor antrean (dipanggil pekerjaMenit & tombol manual)
// ---------------------------------------------------------------------
function jedaRata_(j) { var p = String(j || '5').split('-').map(Number); return p.length > 1 ? (p[0] + p[1]) / 2 : p[0]; }

function prosesAntrianNotif(opsi) {
  opsi = opsi || {};
  if (!opsi.paksa && propFresh_('ANTRIAN_ADA') !== '1') { if (!opsi.tanpaTugasLain) { deteksiWAOtomatis_(); crmSyncTerjadwal_(); } return { info: 'Antrean kosong' }; }
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(8000)) return { info: 'Prosesor sedang berjalan' };
  var hasil = { wa: 0, email: 0, gagal: 0 };
  try {
    var sh = getSheet_('AntrianNotif'), last = sh.getLastRow();
    var start = Math.max(2, Number(propFresh_('ANTRIAN_MULAI') || 2));
    if (start > last) { setProp_('ANTRIAN_ADA', '0'); return hasil; }
    var h = DB.headers_(sh), C = {}; h.forEach(function (k, i) { C[k] = i; });
    var v = sh.getRange(start, 1, last - start + 1, h.length).getValues();
    var waOn = waAktif_(), emOn = emailAktif_();
    var blasts = {}; DB.all('BlastWA').forEach(function (b) { if (b.Status === 'Berjalan') blasts[b.BlastID] = b; });
    var ambilWA = [], ambilEmail = [], perBlast = {};
    var kuotaEmail = 0; try { kuotaEmail = Math.min(40, MailApp.getRemainingDailyQuota()); } catch (e) {}
    for (var i = 0; i < v.length; i++) {
      var r = v[i]; if (r[C.Status] !== 'Antri') continue;
      var bid = String(r[C.BlastID] || '');
      if (bid) {
        if (!waOn || !blasts[bid] || (opsi.blastId && opsi.blastId !== bid)) continue;
        var arr = perBlast[bid] = perBlast[bid] || [];
        if (arr.length < Number(blasts[bid].UkuranBatch || 20)) arr.push(i);
      } else if (!opsi.hanyaBlast) {
        if (r[C.Kanal] === 'WA' && waOn && ambilWA.length < 30) ambilWA.push(i);
        else if (r[C.Kanal] === 'EMAIL' && emOn && ambilEmail.length < kuotaEmail) ambilEmail.push(i);
      }
    }
    var touched = [], dihubungi = [];
    function tandai(idx, okx, respon) {
      var r = v[idx];
      if (okx) { r[C.Status] = 'Terkirim'; r[C.DikirimPada] = nowIso_(); dihubungi.push(r[C.Tujuan]); }
      else { r[C.Percobaan] = Number(r[C.Percobaan] || 0) + 1; if (r[C.Percobaan] >= 3) { r[C.Status] = 'Gagal'; hasil.gagal++; } }
      r[C.Respon] = String(respon || '').substring(0, 200);
      touched.push(idx);
    }
    if (ambilWA.length) {
      var res = fonnteKirimBanyak_(ambilWA.map(function (i) { return { target: v[i][C.Tujuan], message: v[i][C.Pesan] }; }), setting_('WA_JEDA_DETIK', '5'));
      ambilWA.forEach(function (i, j) { tandai(i, res[j].ok, res[j].respon); if (res[j].ok) hasil.wa++; });
    }
    var statBlast = {};
    Object.keys(perBlast).forEach(function (bid) {
      var idxs = perBlast[bid]; if (!idxs.length) return;
      var res = fonnteKirimBanyak_(idxs.map(function (i) { return { target: v[i][C.Tujuan], message: v[i][C.Pesan] }; }), blasts[bid].JedaDetik || setting_('WA_JEDA_DETIK', '5'));
      var st = statBlast[bid] = { ok: 0, gagal: 0 };
      idxs.forEach(function (i, j) { var before = v[i][C.Status]; tandai(i, res[j].ok, res[j].respon); if (res[j].ok) { st.ok++; hasil.wa++; } else if (v[i][C.Status] === 'Gagal' && before !== 'Gagal') st.gagal++; });
    });
    var nama = setting_('EMAIL_NAMA_PENGIRIM', APP.NAME);
    ambilEmail.forEach(function (i) {
      try { MailApp.sendEmail({ to: v[i][C.Tujuan], subject: v[i][C.Subjek] || nama, body: String(v[i][C.Pesan]).replace(/\*/g, ''), htmlBody: emailHtml_(v[i][C.Subjek], v[i][C.Pesan]), name: nama }); tandai(i, true, 'OK'); hasil.email++; }
      catch (e) { tandai(i, false, e.message); }
    });
    if (touched.length) {
      var mn = Math.min.apply(null, touched), mx = Math.max.apply(null, touched);
      sh.getRange(start + mn, 1, mx - mn + 1, h.length).setValues(v.slice(mn, mx + 1));
      invalidateRows_('AntrianNotif');
      bump_('adm', true);                                  // progres blast tampil segar di menu admin
    }
    // statistik blast
    var sisaBlast = {};
    v.forEach(function (r) { var b = String(r[C.BlastID] || ''); if (b && r[C.Status] === 'Antri') sisaBlast[b] = (sisaBlast[b] || 0) + 1; });
    var upB = [];
    Object.keys(blasts).forEach(function (bid) {
      var b = blasts[bid], st = statBlast[bid] || { ok: 0, gagal: 0 };
      if (!st.ok && !st.gagal && sisaBlast[bid]) return;
      var p = { BlastID: bid, Terkirim: Number(b.Terkirim || 0) + st.ok, Gagal: Number(b.Gagal || 0) + st.gagal };
      if (!sisaBlast[bid]) { p.Status = 'Selesai'; p.SelesaiPada = nowIso_(); }
      upB.push(p);
    });
    DB.updateBatch('BlastWA', 'BlastID', upB);
    // majukan penunjuk
    var firstAntri = -1;
    for (var k = 0; k < v.length; k++) if (v[k][C.Status] === 'Antri') { firstAntri = k; break; }
    if (firstAntri === -1) setProps_({ ANTRIAN_MULAI: String(last + 1), ANTRIAN_ADA: '0' });
    else setProp_('ANTRIAN_MULAI', String(start + firstAntri));
    if (dihubungi.length) crmCatatKirim_(dihubungi);
  } finally { lock.releaseLock(); }
  return hasil;
}

// ---------------------------------------------------------------------
// Pemantauan antrean
// ---------------------------------------------------------------------
function tailRows_(name, n) {
  var sh = getSheet_(name), last = sh.getLastRow(); if (last < 2) return [];
  var cnt = Math.min(n, last - 1), h = DB.headers_(sh), v = sh.getRange(last - cnt + 1, 1, cnt, h.length).getValues();
  return v.map(function (r, i) { var o = { _row: last - cnt + 1 + i }; h.forEach(function (k, j) { o[k] = normCell_(k, r[j]); }); return o; });
}

function svcNotifQueue(ctx, d) {
  var rows = tailRows_('AntrianNotif', 3000);
  var ring = { Antri: 0, Terkirim: 0, Gagal: 0, Batal: 0 };
  rows.forEach(function (r) { if (ring[r.Status] !== undefined) ring[r.Status]++; });
  var f = rows.filter(function (r) { return (!d.status || r.Status === d.status) && (!d.kanal || r.Kanal === d.kanal) && (!d.blastId || r.BlastID === d.blastId); });
  var nq = CacheX.get('nq') || [];
  ring.Antri += nq.length;
  return ok_({ antreanCache: nq.length, rows: f.slice(-300).reverse().map(function (r) { var o = Object.assign({}, r); o.Pesan = String(o.Pesan).substring(0, 240); delete o._row; return o; }), ringkas: ring, waAktif: waAktif_(), emailAktif: emailAktif_() });
}
function svcNotifProcessNow(ctx, d) { withLock_(function () { return pindahkanNQ_(); }); var h = prosesAntrianNotif({ paksa: true }); return ok_(h, h.info || ('Diproses: ' + (h.wa || 0) + ' WA, ' + (h.email || 0) + ' email.')); }
function svcNotifRetry(ctx, d) {
  var rows = tailRows_('AntrianNotif', 3000).filter(function (r) { return r.Status === 'Gagal' && (!d.ids || d.ids.indexOf(r.AntrianID) > -1); });
  if (!rows.length) return ok_({ n: 0 }, 'Tidak ada pesan gagal.');
  DB.updateBatch('AntrianNotif', 'AntrianID', rows.map(function (r) { return { AntrianID: r.AntrianID, Status: 'Antri', Percobaan: 0, Respon: 'Diulang' }; }));
  var minRow = Math.min.apply(null, rows.map(function (r) { return r._row; }));
  setProps_({ ANTRIAN_MULAI: String(Math.min(minRow, Number(propFresh_('ANTRIAN_MULAI') || minRow))), ANTRIAN_ADA: '1' });
  return ok_({ n: rows.length }, rows.length + ' pesan dijadwalkan ulang.');
}

function svcWaDevice(ctx, d) {
  var r = fonnte_('/device', {});
  if (!r || r.status === false) return fail_(r && r.reason ? r.reason : 'Perangkat tidak terbaca.');
  return ok_({ device: r.device, status: r.device_status, paket: r.package, kuota: r.quota, expired: r.expired, nama: r.name });
}
function svcWaTest(ctx, d) {
  if (!hpValid_(d.nomor)) return fail_('Nomor tidak valid (contoh 0812xxxxxxx).');
  var r = fonnte_('/send', { target: hp62_(d.nomor), message: d.pesan || ('✅ Tes notifikasi WhatsApp dari ' + setting_('NAMA_SEKOLAH', APP.NAME) + ' — SIAKAD SISWA berhasil tersambung.'), countryCode: '62' });
  return r && r.status ? ok_(r, 'Pesan tes terkirim ke ' + hp08_(d.nomor) + '.') : fail_('Gagal: ' + (r && r.reason ? r.reason : 'tidak diketahui'));
}
function svcEmailTest(ctx, d) {
  if (!emailValid_(d.email)) return fail_('Email tidak valid.');
  try {
    MailApp.sendEmail({ to: d.email, subject: 'Tes Email SIAKAD SISWA', body: 'Tes email berhasil.', htmlBody: emailHtml_('Tes', '✅ Tes email dari *SIAKAD SISWA* berhasil.\nKonfigurasi email siap digunakan.'), name: setting_('EMAIL_NAMA_PENGIRIM', APP.NAME) });
    return ok_(null, 'Email tes terkirim ke ' + d.email + '.');
  } catch (e) { return fail_('Gagal kirim email: ' + e.message); }
}

// ---------------------------------------------------------------------
// Deteksi nomor WhatsApp (Fonnte /validate, maks 50/panggilan)
// ---------------------------------------------------------------------
function svcWaValidate(ctx, d) {
  var nomor = [], seen = {};
  (d.nomor || []).forEach(function (n) { var h = hp08_(n); if (hpValid_(h) && !seen[h]) { seen[h] = 1; nomor.push(h); } });
  nomor = nomor.slice(0, 50);
  if (!nomor.length) return ok_({ hasil: {} }, 'Tidak ada nomor valid untuk dicek.');
  var r = fonnte_('/validate', { target: nomor.map(hp62_).join(','), countryCode: '62' });
  if (!r || r.status === false) return fail_('Deteksi WA gagal: ' + (r && r.reason ? r.reason : 'fitur validate mungkin tidak tersedia di paket Fonnte Anda.'));
  var hasil = {};
  [].concat(r.registered || []).forEach(function (n) { hasil[hp08_(n)] = 'Terdaftar'; });
  [].concat(r.not_registered || []).forEach(function (n) { hasil[hp08_(n)] = 'Tidak Terdaftar'; });
  withLock_(function () { simpanStatusWA_(hasil); return ok_(); });
  return ok_({ hasil: hasil }, Object.keys(hasil).length + ' nomor dicek.');
}
function simpanStatusWA_(hasil) {
  var now = nowIso_();
  Object.keys(SUMBER_KONTAK).forEach(function (kode) {
    var s = SUMBER_KONTAK[kode]; if (!s.statusWA) return;
    var up = DB.all(s.tabel).filter(function (r) { return hasil[hp08_(r[s.hp])]; }).map(function (r) { var o = {}; o[s.id] = r[s.id]; o.StatusWA = hasil[hp08_(r[s.hp])]; o.CekWAAt = now; return o; });
    DB.updateBatch(s.tabel, s.id, up);
  });
  DB.updateBatch('CRM_Kontak', 'KontakID', DB.all('CRM_Kontak').filter(function (k) { return hasil[hp08_(k.NoWA)]; }).map(function (k) { return { KontakID: k.KontakID, StatusWA: hasil[hp08_(k.NoWA)], CekWAAt: now }; }));
  bump_('master');
}
function deteksiWAOtomatis_() {
  if (setting_('WA_DETEKSI_OTOMATIS', 'YA') !== 'YA' || !prop_('FONNTE_TOKEN')) return;
  var last = Number(propFresh_('DETEKSI_WA_TERAKHIR') || 0);
  if (Date.now() - last < 10 * 60e3) return;
  setProp_('DETEKSI_WA_TERAKHIR', String(Date.now()));
  var nomor = DB.all('CRM_Kontak').filter(function (k) { return !k.StatusWA && hpValid_(k.NoWA) && k.Tag.indexOf('merged') === -1; }).slice(0, 50).map(function (k) { return k.NoWA; });
  if (nomor.length) { try { svcWaValidate({}, { nomor: nomor }); } catch (e) {} }
}

// ---------------------------------------------------------------------
// Blast WhatsApp per batch
// ---------------------------------------------------------------------
function svcWaAudience(ctx, d) {
  var rows = [], kelasNama = {};
  DB.all('Kelas').forEach(function (k) { kelasNama[k.kelas_id] = k.nama_kelas; });
  if (d.sumber === 'manual') {
    String(d.manual || '').split(/\n/).forEach(function (line) {
      var p = line.split('|'); if (!line.trim()) return;
      rows.push({ id: '', nama: (p[1] || '').trim() || 'Bapak/Ibu', hp: hp08_(p[0]), statusWA: '', vars: {}, optOut: false });
    });
  } else {
    DB.all('CRM_Kontak').forEach(function (k) {
      if (String(k.Tag).indexOf('merged') > -1) return;
      if (d.segmen && k.Segmen !== d.segmen) return;
      if (d.tag && String(k.Tag).split(',').map(function (t) { return t.trim(); }).indexOf(d.tag) === -1) return;
      var info = {}; try { info = JSON.parse(k.Info || '{}'); } catch (e) {}
      if (d.kelas_id && info.kelas_id !== d.kelas_id) return;
      if (d.statusWA && (k.StatusWA || 'Belum') !== d.statusWA) return;
      rows.push({ id: k.KontakID, nama: k.Nama, hp: hp08_(k.NoWA), statusWA: k.StatusWA, optOut: k.OptOut === 'YA', segmen: k.Segmen,
        vars: { kelas: kelasNama[info.kelas_id] || '', nis: info.NIS || '', siswa: info.nama_lengkap || '' } });
    });
  }
  var seen = {}, ring = { total: rows.length, valid: 0, tidakValid: 0, ganda: 0, terdaftarWA: 0, tidakTerdaftarWA: 0, optOut: 0 };
  rows.forEach(function (r) {
    r.valid = hpValid_(r.hp);
    r.ganda = r.valid && !!seen[r.hp]; if (r.valid) seen[r.hp] = 1;
    if (!r.valid) ring.tidakValid++; else if (r.ganda) ring.ganda++; else ring.valid++;
    if (r.statusWA === 'Terdaftar') ring.terdaftarWA++; if (r.statusWA === 'Tidak Terdaftar') ring.tidakTerdaftarWA++;
    if (r.optOut) ring.optOut++;
  });
  return ok_({ rows: rows.slice(0, 5000), ringkas: ring });
}

function svcWaBlastCreate(ctx, d) {
  if (!waAktif_()) return fail_('Notifikasi WhatsApp belum aktif. Isi token & nyalakan di tab Konfigurasi.');
  var ukuran = Number(d.ukuranBatch), jeda = String(d.jeda || setting_('WA_JEDA_DETIK', '5'));
  if ([10, 20, 50].indexOf(ukuran) === -1) return fail_('Ukuran batch harus 10, 20, atau 50.');
  if (!/^\d{1,3}(-\d{1,3})?$/.test(jeda)) return fail_('Jeda tidak valid.');
  if (!String(d.pesan || '').trim()) return fail_('Isi pesan masih kosong.');
  var optout = {}; DB.all('CRM_Kontak').forEach(function (k) { if (k.OptOut === 'YA') optout[hp08_(k.NoWA)] = 1; });
  var seen = {}, list = [];
  (d.penerima || []).forEach(function (p) { var h = hp08_(p.hp); if (hpValid_(h) && !seen[h] && !optout[h]) { seen[h] = 1; list.push(p); } });
  if (!list.length) return fail_('Tidak ada penerima valid (setelah membuang nomor ganda, tidak valid, dan opt-out).');
  if (list.length > 5000) return fail_('Maksimal 5.000 penerima per blast.');
  var bid = reserveIds_('BlastWA', 1)[0];
  var dasar = { institusi: setting_('NAMA_SEKOLAH', APP.NAME), link: setting_('APP_URL', '') };
  var rows = list.map(function (p) { return barisAntrian_('WA', hp62_(p.hp), p.nama, '', isiTemplate_(d.pesan, Object.assign({}, dasar, { nama: p.nama || 'Bapak/Ibu' }, p.vars || {})), 'BLAST', p.id || '', bid); });
  var ids = reserveIds_('AntrianNotif', rows.length); rows.forEach(function (r, i) { r.AntrianID = ids[i]; });
  DB.appendBatch('AntrianNotif', rows);
  DB.appendBatch('BlastWA', [{ BlastID: bid, Judul: d.judul || 'Blast ' + today_(), Pesan: d.pesan, Sasaran: d.sasaran || '', Total: rows.length, Terkirim: 0, Gagal: 0, UkuranBatch: ukuran, JedaDetik: jeda, Status: 'Berjalan', DibuatOleh: ctx.session.email, Tanggal: nowIso_(), SelesaiPada: '' }]);
  if (!propFresh_('ANTRIAN_MULAI')) setProp_('ANTRIAN_MULAI', '2');
  setProp_('ANTRIAN_ADA', '1');
  return ok_({ blastId: bid, total: rows.length, batch: Math.ceil(rows.length / ukuran) }, 'Blast dibuat: ' + rows.length + ' penerima, ' + Math.ceil(rows.length / ukuran) + ' batch.');
}
function blastInfo_(b) {
  var sisa = Math.max(0, Number(b.Total || 0) - Number(b.Terkirim || 0) - Number(b.Gagal || 0));
  return Object.assign({}, b, { sisa: b.Status === 'Dihentikan' ? 0 : sisa, persen: b.Total ? Math.round((Number(b.Terkirim || 0) + Number(b.Gagal || 0)) / Number(b.Total) * 100) : 0 });
}
function svcWaBlastList(ctx, d) { return ok_(DB.all('BlastWA').slice(-100).reverse().map(blastInfo_)); }
function svcWaBlastProcess(ctx, d) {
  var h = prosesAntrianNotif({ paksa: true, blastId: d.blastId, hanyaBlast: true });
  invalidateRows_('BlastWA');
  var b = DB.find('BlastWA', 'BlastID', d.blastId);
  return ok_({ blast: b ? blastInfo_(b) : null, hasil: h }, h.info || ('Batch terkirim: ' + (h.wa || 0) + ' pesan.'));
}
function svcWaBlastStop(ctx, d) {
  var b = DB.find('BlastWA', 'BlastID', d.blastId); if (!b) return fail_('Blast tidak ditemukan.');
  var rows = tailRows_('AntrianNotif', 6000).filter(function (r) { return r.BlastID === d.blastId && r.Status === 'Antri'; });
  DB.updateBatch('AntrianNotif', 'AntrianID', rows.map(function (r) { return { AntrianID: r.AntrianID, Status: 'Batal', Respon: 'Dihentikan admin' }; }));
  DB.updateBatch('BlastWA', 'BlastID', [{ BlastID: b.BlastID, Status: 'Dihentikan', SelesaiPada: nowIso_() }]);
  return ok_({ dibatalkan: rows.length }, 'Blast dihentikan, ' + rows.length + ' pesan dibatalkan.');
}

;
// ==== CRM.gs ====
/**
 * =====================================================================
 *  SIAKAD SISWA — File 5/5 : CRM.gs  (gas-notifikasi-wa-crm, Bagian 7)
 *  CRM Kontak: Nama · Email · WhatsApp dari Siswa, Orang Tua, dan Guru.
 *  CRM_Kontak = materialisasi (sinkron), bukan pengganti tabel asli.
 * =====================================================================
 */

/** Sumber kontak. statusWA = kolom StatusWA di tabel sumber yang merepresentasikan nomor ini. */
var SUMBER_KONTAK = {
  siswa: { tabel: 'Siswa', id: 'NIS', nama: 'nama_lengkap', email: 'email', hp: 'no_wa', segmen: 'Siswa', status: 'status', gender: 'jenis_kelamin', info: ['NIS', 'kelas_id'] },
  ortu:  { tabel: 'Siswa', id: 'NIS', nama: 'nama_ortu', email: '', hp: 'no_wa_ortu', segmen: 'Orang Tua', status: 'status', gender: 'jenis_kelamin', info: ['NIS', 'kelas_id', 'nama_lengkap'], statusWA: true },
  guru:  { tabel: 'Guru', id: 'NUPTK', nama: 'nama_lengkap', email: 'email', hp: 'no_wa', segmen: 'Guru', status: 'status', info: ['mata_pelajaran', 'jabatan'], statusWA: true }
};

function kontakData_(kode, r, now) {
  var s = SUMBER_KONTAK[kode];
  var nama = r[s.nama] || (kode === 'ortu' ? 'Orang Tua ' + (r.nama_lengkap || '') : ''), hp = hp08_(r[s.hp]);
  var email = s.email ? lower_(r[s.email]) : '';
  if (!hp && !email) return null;
  var info = {}; (s.info || []).forEach(function (f) { info[f] = r[f]; });
  if (s.status) info.Status = r[s.status] || 'Aktif';
  if (s.gender) info.JK = r[s.gender];
  return { Nama: nama, Email: email, NoWA: hp, Segmen: s.segmen, Sumber: kode, RefID: String(r[s.id]), EmailValid: email ? (emailValid_(email) ? 'YA' : 'TIDAK') : '',
    StatusWA: s.statusWA ? (r.StatusWA || '') : '', CekWAAt: s.statusWA ? (r.CekWAAt || '') : '', Info: JSON.stringify(info), DiperbaruiPada: now };
}

/** Sinkron semua sumber → CRM_Kontak. Idempoten, batch. */
function svcCrmSync(ctx, d) {
  var lama = DB.all('CRM_Kontak'), idx = {};
  lama.forEach(function (k, i) { idx[k.Sumber + ':' + k.RefID] = i; });
  var baru = [], ubah = [], now = nowIso_();
  Object.keys(SUMBER_KONTAK).forEach(function (kode) {
    var s = SUMBER_KONTAK[kode];
    DB.all(s.tabel).forEach(function (r) {
      var data = kontakData_(kode, r, now); if (!data) return;
      var k = kode + ':' + data.RefID;
      if (idx[k] === undefined) {
        baru.push(Object.assign({ KontakID: '', Tag: '', OptOut: 'TIDAK', Catatan: '', JumlahPesan: 0, TerakhirDihubungi: '', DibuatPada: now }, data));
        idx[k] = -1;
      } else if (idx[k] > -1) {
        var lk = lama[idx[k]];
        var berubah = ['Nama', 'Email', 'NoWA', 'Info'].some(function (f) { return String(lk[f]) !== String(data[f]); }) || (data.StatusWA && data.StatusWA !== lk.StatusWA);
        if (berubah) {
          if (hp08_(lk.NoWA) !== data.NoWA) { data.StatusWA = ''; data.CekWAAt = ''; }
          else if (!data.StatusWA) { delete data.StatusWA; delete data.CekWAAt; }
          ubah.push(Object.assign({ KontakID: lk.KontakID }, data));
        }
      }
    });
  });
  if (baru.length) { var ids = reserveIds_('CRM_Kontak', baru.length); baru.forEach(function (b, i) { b.KontakID = ids[i]; }); DB.appendBatch('CRM_Kontak', baru); }
  if (ubah.length) DB.updateBatch('CRM_Kontak', 'KontakID', ubah);
  setProp_('CRM_SYNC_TERAKHIR', String(Date.now()));
  return ok_({ ditambah: baru.length, diperbarui: ubah.length, total: lama.length + baru.length, terakhir: nowIso_() }, 'Sinkron CRM: +' + baru.length + ' baru, ' + ubah.length + ' diperbarui.');
}
function crmSyncTerjadwal_() {
  var menit = num_(setting_('CRM_SYNC_MENIT', 30), 30), last = Number(propFresh_('CRM_SYNC_TERAKHIR') || 0);
  if (!menit || Date.now() - last < menit * 60e3) return;
  var lock = LockService.getScriptLock(); if (!lock.tryLock(3000)) return;
  try { svcCrmSync({}, {}); } finally { lock.releaseLock(); }
}
/** Dipanggil setelah transaksi penting (siswa baru) agar kontak langsung muncul */
function crmUpsertSatu_(kode, r) {
  var data = kontakData_(kode, r, nowIso_()); if (!data) return;
  var ex = DB.all('CRM_Kontak').filter(function (k) { return k.Sumber === kode && String(k.RefID) === data.RefID; })[0];
  if (ex) { if (hp08_(ex.NoWA) !== data.NoWA) { data.StatusWA = ''; data.CekWAAt = ''; } else { delete data.StatusWA; delete data.CekWAAt; } DB.updateBatch('CRM_Kontak', 'KontakID', [Object.assign({ KontakID: ex.KontakID }, data)]); }
  else DB.appendBatch('CRM_Kontak', [Object.assign({ KontakID: reserveIds_('CRM_Kontak', 1)[0], Tag: '', OptOut: 'TIDAK', Catatan: '', JumlahPesan: 0, TerakhirDihubungi: '', DibuatPada: nowIso_() }, data)]);
}

function crmRows_() {
  var rows = DB.all('CRM_Kontak').filter(function (k) { return String(k.Tag).indexOf('merged') === -1; });
  var cntWA = {}, cntEm = {};
  rows.forEach(function (k) { if (k.NoWA) cntWA[k.NoWA] = (cntWA[k.NoWA] || 0) + 1; if (k.Email) cntEm[k.Email] = (cntEm[k.Email] || 0) + 1; });
  return rows.map(function (k) {
    var o = Object.assign({}, k); try { o.info = JSON.parse(k.Info || '{}'); } catch (e) { o.info = {}; }
    o.duplikat = (k.NoWA && cntWA[k.NoWA] > 1) || (k.Email && cntEm[k.Email] > 1);
    o.waValid = hpValid_(k.NoWA);
    o.bisaDihubungi = o.waValid || k.EmailValid === 'YA';
    return o;
  });
}

function svcCrmList(ctx, d) {
  var q = lower_(d.cari), rows = crmRows_();
  var f = rows.filter(function (k) {
    if (d.segmen && k.Segmen !== d.segmen) return false;
    if (d.sumber && k.Sumber !== d.sumber) return false;
    if (d.kelas_id && k.info.kelas_id !== d.kelas_id) return false;
    if (d.tag && String(k.Tag).split(',').map(function (t) { return t.trim(); }).indexOf(d.tag) === -1) return false;
    if (d.statusWA) { var sw = k.StatusWA || 'Belum'; if (sw !== d.statusWA) return false; }
    if (d.emailValid && k.EmailValid !== d.emailValid) return false;
    if (d.optOut && k.OptOut !== d.optOut) return false;
    if (d.duplikat && !k.duplikat) return false;
    if (d.masalah && k.bisaDihubungi) return false;
    if (q && (lower_(k.Nama) + ' ' + k.Email + ' ' + k.NoWA + ' ' + lower_(k.info.nama_lengkap || '')).indexOf(q) === -1) return false;
    return true;
  }).sort(function (a, b) { return String(a.Nama).localeCompare(String(b.Nama)); });
  var per = Math.min(200, Number(d.per) || 50), hal = Math.max(1, Number(d.halaman) || 1);
  var facet = { segmen: {}, statusWA: {} };
  rows.forEach(function (k) { facet.segmen[k.Segmen] = (facet.segmen[k.Segmen] || 0) + 1; var sw = k.StatusWA || 'Belum'; facet.statusWA[sw] = (facet.statusWA[sw] || 0) + 1; });
  var tags = {}; rows.forEach(function (k) { String(k.Tag || '').split(',').forEach(function (t) { t = t.trim(); if (t) tags[t] = (tags[t] || 0) + 1; }); });
  return ok_({ rows: f.slice((hal - 1) * per, hal * per), total: f.length, halaman: hal, per: per, facet: facet, tags: tags, terakhirSync: Number(propFresh_('CRM_SYNC_TERAKHIR') || 0) });
}

function svcCrmStats(ctx, d) {
  var rows = crmRows_(), tujuh = Date.now() - 7 * 864e5, tigapuluh = Date.now() - 30 * 864e5;
  var s = { total: rows.length, waValid: 0, terdaftarWA: 0, emailValid: 0, belumCekWA: 0, optOut: 0, duplikat: 0, tidakBisa: 0, baru7: 0, dihubungi30: 0, perSegmen: {} };
  rows.forEach(function (k) {
    if (k.waValid) s.waValid++;
    if (k.StatusWA === 'Terdaftar') s.terdaftarWA++;
    if (k.EmailValid === 'YA') s.emailValid++;
    if (k.waValid && !k.StatusWA) s.belumCekWA++;
    if (k.OptOut === 'YA') s.optOut++;
    if (k.duplikat) s.duplikat++;
    if (!k.bisaDihubungi) s.tidakBisa++;
    if (new Date(k.DibuatPada).getTime() > tujuh) s.baru7++;
    if (k.TerakhirDihubungi && new Date(k.TerakhirDihubungi).getTime() > tigapuluh) s.dihubungi30++;
    s.perSegmen[k.Segmen] = (s.perSegmen[k.Segmen] || 0) + 1;
  });
  s.terakhirSync = Number(propFresh_('CRM_SYNC_TERAKHIR') || 0);
  return ok_(s);
}

function svcCrmDetail(ctx, d) {
  var k = DB.find('CRM_Kontak', 'KontakID', d.kontakId); if (!k) return fail_('Kontak tidak ditemukan.');
  var o = Object.assign({}, k); try { o.info = JSON.parse(k.Info || '{}'); } catch (e) { o.info = {}; }
  var s = SUMBER_KONTAK[k.Sumber], asli = s ? DB.find(s.tabel, s.id, k.RefID) : null;
  var tujuanWA = hp62_(k.NoWA), em = lower_(k.Email);
  var pesan = tailRows_('AntrianNotif', 3000).filter(function (r) { return (tujuanWA && r.Tujuan === tujuanWA) || (em && lower_(r.Tujuan) === em); }).slice(-50)
    .map(function (r) { return { tipe: 'pesan', kanal: r.Kanal, ringkasan: String(r.Pesan).substring(0, 160), status: r.Status, event: r.Event, tanggal: r.DikirimPada || r.DibuatPada }; });
  var inter = DB.all('CRM_Interaksi').filter(function (i) { return i.KontakID === k.KontakID; }).map(function (i) { return { tipe: 'interaksi', kanal: i.Kanal, ringkasan: i.Ringkasan, oleh: i.Oleh, tanggal: i.Tanggal }; });
  return ok_({ kontak: o, asli: asli ? (asli.password_hash ? null : asli) : null, timeline: pesan.concat(inter).sort(function (a, b) { return String(b.tanggal).localeCompare(String(a.tanggal)); }) });
}

function svcCrmSave(ctx, d) {
  var x = d.kontak || {}, k = DB.find('CRM_Kontak', 'KontakID', x.KontakID); if (!k) return fail_('Kontak tidak ditemukan.');
  if (x.NoWA && !hpValid_(x.NoWA)) return fail_('Nomor WA tidak valid.');
  if (x.Email && !emailValid_(x.Email)) return fail_('Email tidak valid.');
  var patch = { KontakID: k.KontakID, Tag: x.Tag !== undefined ? x.Tag : k.Tag, Catatan: x.Catatan !== undefined ? x.Catatan : k.Catatan, OptOut: x.OptOut !== undefined ? (x.OptOut === 'YA' || x.OptOut === true ? 'YA' : 'TIDAK') : k.OptOut, DiperbaruiPada: nowIso_() };
  var s = SUMBER_KONTAK[k.Sumber], tulisBalik = {};
  ['Nama', 'Email', 'NoWA'].forEach(function (f) {
    if (x[f] === undefined || String(x[f]) === String(k[f])) return;
    patch[f] = f === 'NoWA' ? hp08_(x[f]) : f === 'Email' ? lower_(x[f]) : x[f];
    if (s) { var col = f === 'Nama' ? s.nama : f === 'Email' ? s.email : s.hp; if (col) tulisBalik[col] = patch[f]; }
    if (f === 'NoWA') { patch.StatusWA = ''; patch.CekWAAt = ''; }
    if (f === 'Email') patch.EmailValid = patch.Email ? 'YA' : '';
  });
  DB.updateBatch('CRM_Kontak', 'KontakID', [patch]);
  if (s && Object.keys(tulisBalik).length) {                  // satu sumber kebenaran
    var p2 = Object.assign({}, tulisBalik); p2[s.id] = k.RefID;
    if (tulisBalik[s.hp] !== undefined && s.statusWA) { p2.StatusWA = ''; p2.CekWAAt = ''; }
    DB.updateBatch(s.tabel, s.id, [p2]);
    if (s.tabel === 'Siswa' && tulisBalik.email) {
      var u = DB.all('Users').filter(function (u) { return u.role === 'siswa' && String(u.ref_id) === String(k.RefID); })[0];
      if (u) DB.updateBatch('Users', 'user_id', [{ user_id: u.user_id, email: tulisBalik.email }]);
    }
    bump_('master');
  }
  return ok_(null, 'Kontak disimpan.');
}

function svcCrmBulk(ctx, d) {
  var ids = d.ids || [], set = {}; ids.forEach(function (i) { set[i] = 1; });
  var rows = DB.all('CRM_Kontak').filter(function (k) { return set[k.KontakID]; });
  if (!rows.length) return fail_('Belum ada kontak dipilih.');
  var nilai = String(d.nilai || '').trim(), up = [];
  if (d.aksi === 'tag' || d.aksi === 'untag') {
    if (!nilai) return fail_('Nama tag kosong.');
    rows.forEach(function (k) {
      var t = String(k.Tag || '').split(',').map(function (x) { return x.trim(); }).filter(String);
      if (d.aksi === 'tag' && t.indexOf(nilai) === -1) t.push(nilai);
      if (d.aksi === 'untag') t = t.filter(function (x) { return x !== nilai; });
      up.push({ KontakID: k.KontakID, Tag: t.join(', ') });
    });
  } else if (d.aksi === 'optout' || d.aksi === 'optin') {
    rows.forEach(function (k) { up.push({ KontakID: k.KontakID, OptOut: d.aksi === 'optout' ? 'YA' : 'TIDAK' }); });
  } else if (d.aksi === 'hapusManual') {
    var man = rows.filter(function (k) { return k.Sumber === 'manual'; }).map(function (k) { return k.KontakID; });
    DB.deleteWhere('CRM_Kontak', 'KontakID', man);
    return ok_({ n: man.length }, man.length + ' kontak manual dihapus (kontak dari data sekolah tidak ikut terhapus).');
  } else return fail_('Aksi tidak dikenal.');
  DB.updateBatch('CRM_Kontak', 'KontakID', up);
  return ok_({ n: up.length }, 'Diterapkan ke ' + up.length + ' kontak.');
}

function svcCrmInteraksi(ctx, d) {
  var k = DB.find('CRM_Kontak', 'KontakID', d.kontakId); if (!k) return fail_('Kontak tidak ditemukan.');
  if (!String(d.ringkasan || '').trim()) return fail_('Ringkasan interaksi kosong.');
  var row = { InteraksiID: reserveIds_('CRM_Interaksi', 1)[0], KontakID: k.KontakID, Kanal: d.kanal || 'Catatan', Arah: d.arah || 'Keluar', Ringkasan: String(d.ringkasan).substring(0, 1000), RefID: '', Oleh: ctx.session.email, Tanggal: nowIso_() };
  DB.appendBatch('CRM_Interaksi', [row]);
  DB.updateBatch('CRM_Kontak', 'KontakID', [{ KontakID: k.KontakID, TerakhirDihubungi: row.Tanggal }]);
  return ok_(row, 'Interaksi dicatat.');
}

function svcCrmImport(ctx, d) {
  var rows = d.rows || [], now = nowIso_(), have = {}, baru = [], lewati = 0;
  DB.all('CRM_Kontak').forEach(function (k) { if (k.Sumber === 'manual') have[k.RefID] = 1; });
  rows.forEach(function (r) {
    var hp = hp08_(r.wa || r.hp || r.nowa), email = lower_(r.email), key = hp || email;
    if (!key || have[key] || (!hpValid_(hp) && !emailValid_(email))) { lewati++; return; }
    have[key] = 1;
    baru.push({ Nama: r.nama || 'Tanpa Nama', Email: email, NoWA: hp, Segmen: r.segmen || 'Lainnya', Sumber: 'manual', RefID: key, Tag: r.tag || '', StatusWA: '', CekWAAt: '', EmailValid: email ? (emailValid_(email) ? 'YA' : 'TIDAK') : '',
      OptOut: 'TIDAK', Catatan: '', JumlahPesan: 0, TerakhirDihubungi: '', Info: '{}', DibuatPada: now, DiperbaruiPada: now });
  });
  if (baru.length) { var ids = reserveIds_('CRM_Kontak', baru.length); baru.forEach(function (b, i) { b.KontakID = ids[i]; }); DB.appendBatch('CRM_Kontak', baru); }
  return ok_({ ditambah: baru.length, dilewati: lewati }, baru.length + ' kontak diimpor, ' + lewati + ' dilewati (ganda/tidak valid).');
}

function svcCrmMerge(ctx, d) {
  var utama = DB.find('CRM_Kontak', 'KontakID', d.utama); if (!utama) return fail_('Kontak utama tidak ditemukan.');
  var gabung = (d.gabung || []).filter(function (id) { return id !== d.utama; }).map(function (id) { return DB.find('CRM_Kontak', 'KontakID', id); }).filter(Boolean);
  if (!gabung.length) return fail_('Pilih kontak yang akan digabung.');
  var tags = String(utama.Tag || '').split(',').map(function (t) { return t.trim(); }).filter(String), jml = Number(utama.JumlahPesan || 0), cat = utama.Catatan ? [utama.Catatan] : [];
  gabung.forEach(function (g) {
    String(g.Tag || '').split(',').forEach(function (t) { t = t.trim(); if (t && tags.indexOf(t) === -1 && t.indexOf('merged') === -1) tags.push(t); });
    jml += Number(g.JumlahPesan || 0); if (g.Catatan) cat.push(g.Catatan);
  });
  DB.updateBatch('CRM_Kontak', 'KontakID', [{ KontakID: utama.KontakID, Tag: tags.join(', '), JumlahPesan: jml, Catatan: cat.join(' | ').substring(0, 1000), OptOut: gabung.some(function (g) { return g.OptOut === 'YA'; }) || utama.OptOut === 'YA' ? 'YA' : 'TIDAK' }]
    .concat(gabung.map(function (g) { return { KontakID: g.KontakID, Tag: 'merged→' + utama.KontakID }; })));
  return ok_(null, gabung.length + ' kontak digabung ke ' + utama.Nama + '.');
}

function svcCrmExport(ctx, d) {
  var kelasNama = {}; DB.all('Kelas').forEach(function (k) { kelasNama[k.kelas_id] = k.nama_kelas; });
  var out = [], hal = 1;
  while (true) {
    var r = svcCrmList(ctx, Object.assign({}, d, { per: 200, halaman: hal })).data;
    r.rows.forEach(function (k) { out.push([k.Nama, k.Segmen, k.NoWA, k.StatusWA || 'Belum dicek', k.Email, k.EmailValid, kelasNama[k.info.kelas_id] || '', k.Tag, k.OptOut, k.JumlahPesan, k.TerakhirDihubungi]); });
    if (hal * 200 >= r.total) break; hal++;
  }
  queueLog_([ctx.session.email, ctx.session.role, 'crm.export', out.length + ' kontak', '']);
  return ok_({ headers: ['Nama', 'Segmen', 'No WA', 'Status WA', 'Email', 'Email Valid', 'Kelas', 'Tag', 'Opt-out', 'Jumlah Pesan', 'Terakhir Dihubungi'], rows: out, n: out.length });
}

/** Dipanggil prosesor antrean: naikkan JumlahPesan & TerakhirDihubungi (1× updateBatch) */
function crmCatatKirim_(tujuan) {
  var set = {}; tujuan.forEach(function (t) { set[String(t).toLowerCase()] = (set[String(t).toLowerCase()] || 0) + 1; });
  var now = nowIso_();
  var up = DB.all('CRM_Kontak').map(function (k) {
    var n = (set[hp62_(k.NoWA)] || 0) + (k.Email ? (set[lower_(k.Email)] || 0) : 0);
    return n ? { KontakID: k.KontakID, JumlahPesan: Number(k.JumlahPesan || 0) + n, TerakhirDihubungi: now } : null;
  }).filter(Boolean);
  DB.updateBatch('CRM_Kontak', 'KontakID', up);
}

;
// ==== Lms.gs ====
/**
 * =====================================================================
 *  SIAKAD SISWA v3.0 — Lms.gs : Manajemen Kursus & Pengajaran
 *  - Kursus berformat Topik / Mingguan / Sosial, seksi, modul aktivitas & sumber belajar
 *  - Peserta otomatis dari kelas + tambahan manual, Grup & Pengelompokan (groupings)
 *  - Penyelesaian aktivitas, syarat buka bersyarat, kelulusan kursus
 *  Menempel ke Kode.gs lewat EXT (bagian 1b) — modul lama tidak diubah.
 *  File LMS lain: LmsAktivitas.gs, LmsNilai.gs, LmsDemo.gs (opsional, data contoh)
 * =====================================================================
 */
var EXT = (typeof EXT !== 'undefined' && EXT) || { schema: {}, seed: [], routes: [], tick: [], reset: [], hooks: {} };
function lmsKait_(nama, fn) { (EXT.hooks[nama] = EXT.hooks[nama] || []).push(fn); }

// ---------------------------------------------------------------------
// 1. SKEMA (sheet dibuat otomatis saat pertama dipakai / setupV30)
// ---------------------------------------------------------------------
Object.assign(EXT.schema, {
  Kursus:         { key: 'kursus_id', prefix: 'KRS', cols: ['kursus_id', 'kode', 'nama', 'ringkasan', 'mapel', 'kelas_ids', 'pengajar', 'format', 'tgl_mulai', 'jml_seksi', 'warna', 'status', 'mode_grup', 'syarat_lulus', 'skala_id', 'tampil_nilai', 'dibuat_oleh', 'dibuat_pada', 'diperbarui_pada'] },
  KursusSeksi:    { key: 'seksi_id', prefix: 'SKS', cols: ['seksi_id', 'kursus_id', 'no', 'judul', 'ringkasan', 'tampil', 'syarat', 'diperbarui_pada'] },
  KursusModul:    { key: 'modul_id', prefix: 'MDL', cols: ['modul_id', 'kursus_id', 'seksi_id', 'urutan', 'tipe', 'judul', 'deskripsi', 'konten', 'tampil', 'syarat', 'penyelesaian', 'grouping_id', 'mode_grup', 'nilai_maks', 'kategori_id', 'bobot', 'buka', 'tutup', 'dibuat_oleh', 'dibuat_pada', 'diperbarui_pada'] },
  KursusPeserta:  { key: 'peserta_id', prefix: 'KPS', cols: ['peserta_id', 'kursus_id', 'user_id', 'peran', 'ditambah_oleh', 'dibuat_pada'] },
  KursusGrup:     { key: 'grup_id', prefix: 'GRP', cols: ['grup_id', 'kursus_id', 'nama', 'deskripsi', 'anggota', 'dibuat_pada'] },
  KursusGrouping: { key: 'grouping_id', prefix: 'GRG', cols: ['grouping_id', 'kursus_id', 'nama', 'grup_ids', 'dibuat_pada'] },
  Penyelesaian:   { key: 'penyelesaian_id', prefix: 'PNY', cols: ['penyelesaian_id', 'kursus_id', 'modul_id', 'user_id', 'status', 'sumber', 'waktu'] }
});
EXT.seed.push(
  ['LMS_MAKS_MB', '10', 'Batas ukuran unggahan berkas kursus, tugas & forum (MB)'],
  ['LMS_GURU_BUAT_KURSUS', 'YA', 'YA/TIDAK — guru boleh membuat kursus sendiri (TIDAK = hanya Super Admin)']
);

var LMS_AKTIVITAS = { kuis: 'Kuis', tugas: 'Tugas', forum: 'Forum Diskusi', wiki: 'Wiki', workshop: 'Workshop (Penilaian Sejawat)', glosarium: 'Glosarium', pelajaran: 'Pelajaran Interaktif', umpanbalik: 'Umpan Balik & Survei', kelasvirtual: 'Kelas Virtual' };
var LMS_SUMBER = { berkas: 'Berkas (PDF/Dokumen)', folder: 'Folder', halaman: 'Halaman', label: 'Label', url: 'Tautan URL', web: 'Halaman Web Eksternal' };
var LMS_DINILAI = { kuis: 1, tugas: 1, forum: 1, workshop: 1, pelajaran: 1 };
var LMS_SELESAI_BAWAAN = { berkas: 'lihat', folder: 'lihat', halaman: 'lihat', label: 'tidak', url: 'lihat', web: 'lihat', kuis: 'nilai', tugas: 'kirim', forum: 'kirim', wiki: 'kirim',
  workshop: 'kirim', glosarium: 'kirim', pelajaran: 'lulus', umpanbalik: 'kirim', kelasvirtual: 'lihat' };
/** Tabel aktivitas yang punya kolom kursus_id & modul_id — dihapus berantai saat kursus/modul dihapus */
var LMS_TABEL_ANAK = (typeof LMS_TABEL_ANAK !== 'undefined' && LMS_TABEL_ANAK) || [];

var _LMS = {};
EXT.reset.push(function () { _LMS = {}; });

// ---------------------------------------------------------------------
// 2. UTILITAS
// ---------------------------------------------------------------------
function lmsJson_(s, d) { if (s && typeof s === 'object') return s; try { return s ? JSON.parse(s) : d; } catch (e) { return d; } }
function lmsIds_(s) { return (Array.isArray(s) ? s : String(s || '').split(',')).map(function (x) { return String(x).trim(); }).filter(String); }
function lmsNama_(uid) { var u = userIdx_()[uid]; return u ? u.n : (uid || '-'); }
function lmsSekarang_() { return Utilities.formatDate(new Date(), APP.TZ, "yyyy-MM-dd'T'HH:mm"); }
function lmsTeks_(v, maks) { return String(v == null ? '' : v).substring(0, maks || 500); }
function lmsAcak_(arr, rnd) { var a = arr.slice(); rnd = rnd || Math.random; for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rnd() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
function lmsLog_(ctx, jenis, halaman, objek, durasi, detail) { if (typeof catatAktivitas_ === 'function') { try { catatAktivitas_(ctx, jenis, halaman, objek, durasi, detail); } catch (e) {} } }

/** uid siswa aktif → kelas_id (sumber kebenaran: sheet Siswa) */
function lmsKelasUid_() {
  if (_LMS.kelas) return _LMS.kelas;
  var key = 'lmsKls_' + ver_('master') + '_' + ver_('akun');
  var c = CacheX.get(key);
  if (!c) {
    var nisK = {}; DB.all('Siswa').forEach(function (s) { if ((s.status || 'Aktif') === 'Aktif') nisK[String(s.NIS)] = s.kelas_id; });
    var ux = userIdx_(); c = {};
    Object.keys(ux).forEach(function (id) { var u = ux[id]; if (u.r === 'siswa' && u.a && nisK[u.f] !== undefined) c[id] = nisK[u.f]; });
    CacheX.put(key, c, 3600);
  }
  return (_LMS.kelas = c);
}

/** Struktur kursus (cache berversi 'lms') */
function lmsStruktur_(kid) {
  kid = String(kid || '');
  if (!kid) return null;
  if (_LMS['s' + kid]) return _LMS['s' + kid];
  var key = 'lmsS_' + kid + '_' + ver_('lms'), s = CacheX.get(key);
  if (!s) {
    var k = DB.find('Kursus', 'kursus_id', kid);
    if (!k) return null;
    var f = function (r) { return String(r.kursus_id) === kid; };
    s = { kursus: k,
      seksi: DB.filter('KursusSeksi', f).sort(function (a, b) { return num_(a.no) - num_(b.no); }),
      modul: DB.filter('KursusModul', f).sort(function (a, b) { return num_(a.urutan) - num_(b.urutan); }),
      grup: DB.filter('KursusGrup', f), grouping: DB.filter('KursusGrouping', f), peserta: DB.filter('KursusPeserta', f),
      nilaiItem: SCHEMA.NilaiItem ? DB.filter('NilaiItem', f) : [], nilaiKat: SCHEMA.NilaiKategori ? DB.filter('NilaiKategori', f) : [] };   // v3.1
    CacheX.put(key, s, 3600);
  }
  return (_LMS['s' + kid] = s);
}
function lmsSegarkan_() { bump_('lms'); Object.keys(_LMS).forEach(function (k) { if (k.charAt(0) === 's' || k === 'ks' || k === 'm2k' || k.indexOf('agg') === 0) delete _LMS[k]; }); }

/** Peran pengguna di kursus: admin (Super Admin) | pengajar | siswa | null */
function lmsPeran_(ctx, s) {
  if (!ctx.session || !s) return null;
  var uid = ctx.session.uid, k = s.kursus;
  if (ctx.session.role === 'superadmin') return 'admin';
  if (lmsIds_(k.pengajar).indexOf(uid) > -1) return 'pengajar';
  var man = s.peserta.filter(function (p) { return p.user_id === uid; })[0];
  if (man) return man.peran === 'pengajar' ? 'pengajar' : (k.status === 'Aktif' ? 'siswa' : null);
  if (ctx.session.role === 'siswa' && k.status === 'Aktif') {
    var kl = lmsKelasUid_()[uid];
    if (kl && lmsIds_(k.kelas_ids).indexOf(kl) > -1) return 'siswa';
  }
  return null;
}
/** uid siswa peserta kursus (dari kelas + tambahan manual) */
function lmsSiswa_(s) {
  var kel = lmsIds_(s.kursus.kelas_ids), map = lmsKelasUid_(), ux = userIdx_(), out = {};
  Object.keys(map).forEach(function (uid) { if (kel.indexOf(map[uid]) > -1) out[uid] = 1; });
  s.peserta.forEach(function (p) { if (p.peran !== 'pengajar' && ux[p.user_id] && ux[p.user_id].a) out[p.user_id] = 1; });
  return Object.keys(out).sort(function (a, b) { return lmsNama_(a).localeCompare(lmsNama_(b)); });
}
function lmsPengajar_(s) {
  var out = {}; lmsIds_(s.kursus.pengajar).forEach(function (u) { out[u] = 1; });
  s.peserta.forEach(function (p) { if (p.peran === 'pengajar') out[p.user_id] = 1; });
  return Object.keys(out);
}
function lmsAkses_(ctx, kid, butuh) {
  var s = lmsStruktur_(kid);
  if (!s) return { err: fail_('Kursus tidak ditemukan atau sudah dihapus.') };
  var p = lmsPeran_(ctx, s);
  if (!p) return { err: fail_('Anda bukan peserta kursus ini.', { code: 'FORBIDDEN' }) };
  if (butuh === 'kelola' && p === 'siswa') return { err: fail_('Hanya pengajar kursus yang dapat melakukan ini.', { code: 'FORBIDDEN' }) };
  return { s: s, peran: p, kelola: p !== 'siswa', uid: ctx.session.uid };
}
/** Akses modul. Siswa ditolak bila modul tersembunyi / terkunci syarat (dicek di server). */
function lmsAksesModul_(ctx, mid, butuh) {
  var m0 = lmsModulKursus_(mid);                                   // v3.1: dari cache berversi
  if (!m0) return { err: fail_('Aktivitas tidak ditemukan atau sudah dihapus.') };
  var a = lmsAkses_(ctx, m0.kursus_id, butuh);
  if (a.err) return a;
  var m = a.s.modul.filter(function (x) { return x.modul_id === mid; })[0] || m0;
  a.m = m; a.konten = lmsJson_(m.konten, {});
  if (!a.kelola) {
    var st = lmsStatus_(a.s, a.uid), lihat = lmsModulTerlihat_(a.s, st)[mid];
    if (!lihat) return { err: fail_('Aktivitas ini tidak tersedia untuk Anda.', { code: 'FORBIDDEN' }) };
    if (!lihat.ok) return { err: fail_('Aktivitas masih terkunci: ' + lihat.alasan.join('; '), { code: 'LOCKED' }) };
    a.st = st;
  }
  return a;
}

// ---------------------------------------------------------------------
// 3. STATUS PENGGUNA, SYARAT BUKA, PENYELESAIAN
// ---------------------------------------------------------------------
function lmsStatus_(s, uid) {
  var kid = s.kursus.kursus_id, mk = 'st' + kid + '|' + uid;
  if (_LMS[mk]) return _LMS[mk];
  var selesai = {}, nilai = {}, rk = lmsRekamUser_(uid);          // v3.1: cache per pengguna
  Object.keys(rk.s[kid] || {}).forEach(function (mid) { selesai[mid] = rk.s[kid][mid]; });
  Object.keys(rk.n[kid] || {}).forEach(function (ref) { var r = rk.n[kid][ref]; if (r.nilai !== '') { var mx = num_(r.maks, 100) || 100; nilai[ref] = round1_(num_(r.nilai) / mx * 100); } });
  var grup = s.grup.filter(function (g) { return lmsIds_(g.anggota).indexOf(uid) > -1; }).map(function (g) { return g.grup_id; });
  var grouping = s.grouping.filter(function (gg) { return lmsIds_(gg.grup_ids).some(function (id) { return grup.indexOf(id) > -1; }); }).map(function (gg) { return gg.grouping_id; });
  return (_LMS[mk] = { uid: uid, selesai: selesai, nilai: nilai, grup: grup, grouping: grouping });
}
function lmsJudulModul_(s, mid) { var m = s.modul.filter(function (x) { return x.modul_id === mid; })[0]; return m ? m.judul : 'aktivitas'; }
function lmsAturan_(s, a, st, now) {
  switch (a.tipe) {
    case 'selesai': { var c = st.selesai[a.modul_id]; return { ok: !!c && c !== 'gagal', alasan: 'Selesaikan "' + lmsJudulModul_(s, a.modul_id) + '"' }; }
    case 'nilai_min': { var g = st.nilai[a.modul_id]; return { ok: g !== undefined && g >= num_(a.nilai), alasan: 'Raih nilai ≥ ' + num_(a.nilai) + ' pada "' + lmsJudulModul_(s, a.modul_id) + '"' }; }
    case 'tanggal_mulai': return { ok: now >= String(a.tgl), alasan: 'Dibuka mulai ' + String(a.tgl).replace('T', ' ') };
    case 'tanggal_sampai': return { ok: now <= String(a.tgl), alasan: 'Hanya tersedia sampai ' + String(a.tgl).replace('T', ' ') };
    case 'grup': { var gg = s.grup.filter(function (x) { return x.grup_id === a.grup_id; })[0]; return { ok: st.grup.indexOf(a.grup_id) > -1, alasan: 'Khusus anggota grup ' + (gg ? gg.nama : a.grup_id) }; }
    case 'grouping': { var gp = s.grouping.filter(function (x) { return x.grouping_id === a.grouping_id; })[0]; return { ok: st.grouping.indexOf(a.grouping_id) > -1, alasan: 'Khusus kelompok ' + (gp ? gp.nama : a.grouping_id) }; }
  }
  return { ok: true, alasan: '' };
}
function lmsCekSyarat_(s, syarat, st, now) {
  syarat = lmsJson_(syarat, null);
  if (!syarat || !syarat.aturan || !syarat.aturan.length) return { ok: true, alasan: [] };
  var hasil = syarat.aturan.map(function (a) { return lmsAturan_(s, a, st, now); });
  var ok = syarat.op === 'salah_satu' ? hasil.some(function (h) { return h.ok; }) : hasil.every(function (h) { return h.ok; });
  return { ok: ok, alasan: ok ? [] : hasil.filter(function (h) { return !h.ok; }).map(function (h) { return h.alasan; }), sembunyi: !ok && !!syarat.sembunyi };
}
/** Peta modul yang TERLIHAT oleh siswa → {ok, alasan} (terkunci tetap tampil kecuali disembunyikan) */
function lmsModulTerlihat_(s, st) {
  var mk = 'vis' + s.kursus.kursus_id + '|' + st.uid;
  if (_LMS[mk]) return _LMS[mk];
  var now = lmsSekarang_(), seksi = {}, out = {};
  s.seksi.forEach(function (sk) { if (sk.tampil === 'TIDAK') return; var c = lmsCekSyarat_(s, sk.syarat, st, now); if (!c.sembunyi) seksi[sk.seksi_id] = c; });
  s.modul.forEach(function (m) {
    if (m.tampil === 'TIDAK' || !seksi[m.seksi_id]) return;
    if (m.grouping_id && st.grouping.indexOf(m.grouping_id) === -1) return;
    var sk = seksi[m.seksi_id], c = sk.ok ? lmsCekSyarat_(s, m.syarat, st, now) : { ok: false, alasan: sk.alasan };
    if (c.sembunyi) return;
    out[m.modul_id] = c;
  });
  return (_LMS[mk] = out);
}
function lmsAturanSelesai_(m) {
  var p = lmsJson_(m.penyelesaian, null) || {};
  if (!p.mode) p.mode = LMS_SELESAI_BAWAAN[m.tipe] || 'tidak';
  if (p.mode === 'lulus' && p.nilai_min === undefined) p.nilai_min = num_(lmsJson_(m.konten, {}).nilai_min, num_(setting_('KKM', 70), 70));
  return p;
}
/**
 * Dipanggil aktivitas saat terjadi peristiwa: 'lihat' | 'kirim' | 'nilai' (persen 0–100).
 * Menulis Penyelesaian bila aturan modul terpenuhi, lalu cek kelulusan kursus. Harus di bawah lock.
 */
function lmsTandai_(kid, mid, uid, peristiwa, persen) {
  var s = lmsStruktur_(kid); if (!s) return null;
  var m = s.modul.filter(function (x) { return x.modul_id === mid; })[0]; if (!m) return null;
  var p = lmsAturanSelesai_(m), status = null;
  if (p.mode === 'lihat' && peristiwa === 'lihat') status = 'selesai';
  else if (p.mode === 'kirim' && peristiwa === 'kirim') status = 'selesai';
  else if (p.mode === 'nilai' && peristiwa === 'nilai') status = 'selesai';
  else if (p.mode === 'lulus' && peristiwa === 'nilai') status = num_(persen) >= num_(p.nilai_min) ? 'lulus' : 'gagal';
  if (!status) return null;
  return lmsSimpanSelesai_(kid, mid, uid, status, peristiwa);
}
function lmsSimpanSelesai_(kid, mid, uid, status, sumber) {
  var cek = (lmsRekamUser_(uid).s[kid] || {})[mid];                 // v3.1: status sama -> tanpa baca/tulis sheet
  if (cek === status || (cek === 'lulus' && status === 'gagal')) return cek;
  var ada = DB.filter('Penyelesaian', function (r) { return r.kursus_id === kid && r.modul_id === mid && r.user_id === uid; })[0];
  if (ada && ada.status === status) return status;
  if (ada && ada.status === 'lulus' && status === 'gagal') return 'lulus';                 // lulus tidak turun
  if (ada) DB.updateBatch('Penyelesaian', 'penyelesaian_id', [{ penyelesaian_id: ada.penyelesaian_id, status: status, sumber: sumber, waktu: nowIso_() }]);
  else DB.appendBatch('Penyelesaian', [{ penyelesaian_id: reserveIds_('Penyelesaian', 1)[0], kursus_id: kid, modul_id: mid, user_id: uid, status: status, sumber: sumber, waktu: nowIso_() }]);
  delete _LMS['st' + kid + '|' + uid]; delete _LMS['vis' + kid + '|' + uid];
  lmsUserBasi_(uid, kid);                                           // v3.1
  if (mid.indexOf('KURSUS:') !== 0) lmsCekLulus_(kid, uid);
  return status;
}
function lmsHapusSelesai_(kid, mid, uid) {
  var ada = DB.filter('Penyelesaian', function (r) { return r.kursus_id === kid && r.modul_id === mid && r.user_id === uid; });
  if (ada.length) DB.deleteWhere('Penyelesaian', 'penyelesaian_id', ada.map(function (r) { return r.penyelesaian_id; }));
  delete _LMS['st' + kid + '|' + uid]; delete _LMS['vis' + kid + '|' + uid];
  lmsUserBasi_(uid, kid);                                           // v3.1
}
/** Modul yang dilacak penyelesaiannya */
function lmsDilacak_(s) { return s.modul.filter(function (m) { return m.tampil !== 'TIDAK' && lmsAturanSelesai_(m).mode !== 'tidak'; }); }
/** Evaluasi kriteria kelulusan kursus seorang siswa */
function lmsEvalLulus_(s, uid) {
  var k = s.kursus, aturan = lmsJson_(k.syarat_lulus, {}) || {}, st = lmsStatus_(s, uid);
  var wajib = (aturan.modul_ids && aturan.modul_ids.length ? aturan.modul_ids : lmsDilacak_(s).map(function (m) { return m.modul_id; }))
    .filter(function (id) { return s.modul.some(function (m) { return m.modul_id === id; }); });
  var beres = wajib.filter(function (id) { var c = st.selesai[id]; return c && c !== 'gagal'; });
  var total = typeof lmsTotalSiswa_ === 'function' ? lmsTotalSiswa_(s, uid) : null;
  var nilaiOk = !aturan.nilai_min || (total !== null && total >= num_(aturan.nilai_min));
  return { wajib: wajib.length, beres: beres.length, persen: wajib.length ? Math.round(beres.length / wajib.length * 100) : 0,
    total: total, nilai_min: aturan.nilai_min || '', lulus: wajib.length > 0 && beres.length === wajib.length && nilaiOk, aktif: aturan.aktif !== false };
}
function lmsCekLulus_(kid, uid) {
  var s = lmsStruktur_(kid); if (!s) return;
  var ev = lmsEvalLulus_(s, uid), sudah = lmsStatus_(s, uid).selesai['KURSUS:' + kid];
  if (ev.lulus && !sudah) {
    lmsSimpanSelesai_(kid, 'KURSUS:' + kid, uid, 'lulus', 'otomatis');
    if (typeof notifApp_ === 'function') notifApp_([{ user_id: uid, judul: 'Selamat! Kursus selesai', pesan: 'Anda telah menyelesaikan semua kriteria kursus "' + s.kursus.nama + '".', tipe: 'success', link: 'kursus/' + kid }]);
  } else if (!ev.lulus && sudah) lmsHapusSelesai_(kid, 'KURSUS:' + kid, uid);
}

// ---------------------------------------------------------------------
// 4. KURSUS
// ---------------------------------------------------------------------
function lmsKursusRingkas_(k, extra) {
  return Object.assign({ kursus_id: k.kursus_id, kode: k.kode, nama: k.nama, ringkasan: k.ringkasan, mapel: k.mapel, kelas_ids: k.kelas_ids, format: k.format, status: k.status,
    warna: k.warna, tgl_mulai: k.tgl_mulai, pengajar: lmsIds_(k.pengajar).map(function (u) { return { uid: u, nama: lmsNama_(u) }; }) }, extra || {});
}
function apiLmsKursusList(ctx, d) {
  var uid = ctx.session.uid, sa = ctx.session.role === 'superadmin', out = [];
  var semua = lmsKursusSemua_();                                    // v3.1: cache berversi
  semua.forEach(function (k) {
    var s = lmsStruktur_(k.kursus_id), p = lmsPeran_(ctx, s);
    if (!p || (p === 'admin' && !sa)) return;
    if (p === 'siswa') {
      var ev = lmsEvalLulus_(s, uid), vis = lmsModulTerlihat_(s, lmsStatus_(s, uid));
      out.push(lmsKursusRingkas_(k, { peran: p, progres: ev.persen, lulus: !!lmsStatus_(s, uid).selesai['KURSUS:' + k.kursus_id], jml_aktivitas: Object.keys(vis).length }));
    } else {
      out.push(lmsKursusRingkas_(k, { peran: p, jml_siswa: lmsSiswa_(s).length, jml_aktivitas: s.modul.length, mengajar: lmsIds_(k.pengajar).indexOf(uid) > -1 }));
    }
  });
  out.sort(function (a, b) { return (a.status === 'Aktif' ? 0 : 1) - (b.status === 'Aktif' ? 0 : 1) || String(a.nama).localeCompare(String(b.nama)); });
  return ok_({ kursus: out, bolehBuat: ctx.session.role === 'superadmin' || (ctx.session.role === 'guru' && setting_('LMS_GURU_BUAT_KURSUS', 'YA') === 'YA') });
}
/** Opsi formulir: calon pengajar & siswa (dengan uid) */
function apiLmsOpsi(ctx, d) {
  var ux = userIdx_(), kls = lmsKelasUid_(), kelasNama = {};
  DB.all('Kelas').forEach(function (k) { kelasNama[k.kelas_id] = k.nama_kelas; });
  var guru = [], siswa = [];
  Object.keys(ux).forEach(function (id) {
    var u = ux[id]; if (!u.a) return;
    if (u.r === 'siswa') { if (kls[id] !== undefined) siswa.push({ uid: id, nama: u.n, kelas_id: kls[id], kelas: kelasNama[kls[id]] || kls[id] }); }
    else guru.push({ uid: id, nama: u.n, peran: u.r });
  });
  guru.sort(function (a, b) { return a.nama.localeCompare(b.nama); }); siswa.sort(function (a, b) { return a.nama.localeCompare(b.nama); });
  return ok_({ guru: guru, siswa: siswa, kelas: DB.all('Kelas'), mapel: DB.all('Mapel'), aktivitas: LMS_AKTIVITAS, sumber: LMS_SUMBER,
    kategori: SCHEMA.NilaiKategori && d.kursus_id ? DB.filter('NilaiKategori', function (c) { return c.kursus_id === d.kursus_id; }) : [],
    rubrik: SCHEMA.Rubrik ? DB.all('Rubrik').map(function (r) { return { rubrik_id: r.rubrik_id, nama: r.nama, jenis: r.jenis }; }) : [],
    platform: typeof kvPlatformSiap_ === 'function' ? kvPlatformSiap_() : {} });
}
function lmsJudulPekan_(tglMulai, no) {
  if (!tglMulai) return 'Pekan ' + no;
  var a = new Date(new Date(tglMulai + 'T00:00:00+07:00').getTime() + (no - 1) * 7 * 864e5), b = new Date(a.getTime() + 6 * 864e5);
  var f = function (x) { return Utilities.formatDate(x, APP.TZ, 'd MMM').replace(/^0/, ''); };
  return 'Pekan ' + no + ' (' + f(a) + ' – ' + f(b) + ')';
}
function apiLmsKursusSave(ctx, d) {
  var o = d.data || {}, uid = ctx.session.uid, now = nowIso_(), baru = !o.kursus_id;
  var nama = lmsTeks_(o.nama, 150).trim();
  if (!nama) return fail_('Nama kursus wajib diisi.');
  var format = { topik: 1, mingguan: 1, sosial: 1 }[o.format] ? o.format : 'topik';
  var jml = Math.max(1, Math.min(52, num_(o.jml_seksi, format === 'mingguan' ? 16 : 6)));
  var pengajar = lmsIds_(o.pengajar).filter(function (u) { var x = userIdx_()[u]; return x && x.r !== 'siswa'; });
  var row = { kode: lmsTeks_(o.kode, 30), nama: nama, ringkasan: lmsTeks_(o.ringkasan, 3000), mapel: lmsTeks_(o.mapel, 80),
    kelas_ids: lmsIds_(o.kelas_ids).join(','), format: format, tgl_mulai: /^\d{4}-\d{2}-\d{2}$/.test(o.tgl_mulai) ? o.tgl_mulai : (o.tgl_mulai ? '' : today_()),
    jml_seksi: jml, warna: /^#[0-9a-fA-F]{6}$/.test(o.warna) ? o.warna : '#1E3A5F', status: { Draf: 1, Aktif: 1, Arsip: 1 }[o.status] ? o.status : 'Draf',
    mode_grup: { tanpa: 1, terpisah: 1, terlihat: 1 }[o.mode_grup] ? o.mode_grup : 'tanpa', tampil_nilai: o.tampil_nilai === 'TIDAK' ? 'TIDAK' : 'YA',
    skala_id: lmsTeks_(o.skala_id, 20), diperbarui_pada: now };
  if (o.syarat_lulus !== undefined) row.syarat_lulus = JSON.stringify(lmsJson_(o.syarat_lulus, {}) || {});
  if (baru) {
    if (ctx.session.role !== 'superadmin' && setting_('LMS_GURU_BUAT_KURSUS', 'YA') !== 'YA') return fail_('Pembuatan kursus oleh guru dinonaktifkan. Hubungi Super Admin.');
    if (ctx.session.role !== 'superadmin' && pengajar.indexOf(uid) === -1) pengajar.unshift(uid);
    if (!pengajar.length) pengajar = [uid];
    row.kursus_id = reserveIds_('Kursus', 1)[0]; row.pengajar = pengajar.join(','); row.dibuat_oleh = uid; row.dibuat_pada = now;
    if (!row.syarat_lulus) row.syarat_lulus = '{}';
    DB.appendBatch('Kursus', [row]);
    // seksi awal: 0 = Umum, lalu Topik/Pekan
    var n = format === 'sosial' ? 0 : jml, ids = reserveIds_('KursusSeksi', n + 1), seksi = [];
    for (var i = 0; i <= n; i++) seksi.push({ seksi_id: ids[i], kursus_id: row.kursus_id, no: i, judul: i === 0 ? (format === 'sosial' ? 'Ruang Diskusi Kelas' : 'Umum') : (format === 'mingguan' ? lmsJudulPekan_(row.tgl_mulai, i) : 'Topik ' + i), ringkasan: '', tampil: 'YA', syarat: '', diperbarui_pada: now });
    DB.appendBatch('KursusSeksi', seksi);
    var awal = [{ tipe: 'forum', judul: format === 'sosial' ? 'Forum Kelas' : 'Pengumuman Kursus', konten: { jenis: format === 'sosial' ? 'umum' : 'berita', lampiran: true }, penyelesaian: { mode: 'tidak' } }];
    var mids = reserveIds_('KursusModul', awal.length);
    DB.appendBatch('KursusModul', awal.map(function (a, x) { return { modul_id: mids[x], kursus_id: row.kursus_id, seksi_id: ids[0], urutan: x + 1, tipe: a.tipe, judul: a.judul, deskripsi: '', konten: JSON.stringify(a.konten), tampil: 'YA', syarat: '', penyelesaian: JSON.stringify(a.penyelesaian), grouping_id: '', mode_grup: '', nilai_maks: 0, kategori_id: '', bobot: 1, buka: '', tutup: '', dibuat_oleh: uid, dibuat_pada: now, diperbarui_pada: now }; }));
    lmsSegarkan_();
    var res = ok_({ kursus_id: row.kursus_id }, 'Kursus dibuat. Tambahkan materi & aktivitas di setiap ' + (format === 'mingguan' ? 'pekan' : 'topik') + '.');
    res.auditDetail = 'Kursus baru ' + row.kursus_id + ' ' + nama;
    return res;
  }
  var a = lmsAkses_(ctx, o.kursus_id, 'kelola'); if (a.err) return a.err;
  if (o.pengajar !== undefined) { if (!pengajar.length) return fail_('Kursus harus memiliki minimal 1 pengajar.'); row.pengajar = pengajar.join(','); }
  row.kursus_id = o.kursus_id;
  DB.updateBatch('Kursus', 'kursus_id', [row]);
  // tambah seksi bila jumlah dinaikkan (tidak pernah menghapus otomatis)
  var adaN = a.s.seksi.filter(function (x) { return num_(x.no) > 0; }).length;
  if (format !== 'sosial' && jml > adaN) {
    var add = jml - adaN, nids = reserveIds_('KursusSeksi', add), rows = [];
    for (var j = 0; j < add; j++) { var no = adaN + j + 1; rows.push({ seksi_id: nids[j], kursus_id: o.kursus_id, no: no, judul: format === 'mingguan' ? lmsJudulPekan_(row.tgl_mulai, no) : 'Topik ' + no, ringkasan: '', tampil: 'YA', syarat: '', diperbarui_pada: now }); }
    DB.appendBatch('KursusSeksi', rows);
  }
  if (format === 'mingguan' && o.judulUlang) {
    DB.updateBatch('KursusSeksi', 'seksi_id', DB.filter('KursusSeksi', function (x) { return x.kursus_id === o.kursus_id && num_(x.no) > 0; }).map(function (x) { return { seksi_id: x.seksi_id, judul: lmsJudulPekan_(row.tgl_mulai, num_(x.no)) }; }));
  }
  lmsSegarkan_();
  var r2 = ok_({ kursus_id: o.kursus_id }, 'Pengaturan kursus disimpan.');
  r2.auditDetail = 'Ubah kursus ' + o.kursus_id;
  return r2;
}
/** Hapus baris tabel berdasarkan nilai kolom (berantai) */
function lmsHapusKolom_(sheet, col, vals) {
  if (!SCHEMA[sheet]) return 0;
  var set = {}; (Array.isArray(vals) ? vals : [vals]).forEach(function (v) { set[String(v)] = 1; });
  var key = SCHEMA[sheet].key, ids = DB.filter(sheet, function (r) { return set[String(r[col])]; }).map(function (r) { return r[key]; });
  if (!ids.length) return 0;
  var jml = DB.deleteWhere(sheet, key, ids);
  if (/^(Penyelesaian|NilaiEntri)$/.test(sheet)) bump_('lmsr', true);   // v3.1: setelah dihapus
  return jml;
}
function apiLmsKursusHapus(ctx, d) {
  var a = lmsAkses_(ctx, d.kursus_id, 'kelola'); if (a.err) return a.err;
  if (String(d.konfirmasi || '') !== a.s.kursus.nama) return fail_('Ketik nama kursus persis untuk konfirmasi penghapusan.');
  var kid = a.s.kursus.kursus_id;
  ['KursusSeksi', 'KursusModul', 'KursusPeserta', 'KursusGrup', 'KursusGrouping', 'Penyelesaian'].concat(LMS_TABEL_ANAK).forEach(function (t) { lmsHapusKolom_(t, 'kursus_id', kid); });
  DB.deleteWhere('Kursus', 'kursus_id', [kid]);
  lmsSegarkan_();
  var res = ok_(null, 'Kursus "' + a.s.kursus.nama + '" beserta seluruh isinya dihapus.');
  res.auditDetail = 'Hapus kursus ' + kid + ' ' + a.s.kursus.nama;
  return res;
}

/** Konten modul yang aman dikirim ke siswa (kunci jawaban & alur pelajaran tidak ikut) */
function lmsKontenPublik_(m, kelola) {
  var k = lmsJson_(m.konten, {}) || {};
  if (kelola) return k;
  if (m.tipe === 'pelajaran') return { jml_halaman: (k.halaman || []).length, nilai_min: k.nilai_min, percobaan_maks: k.percobaan_maks };
  if (m.tipe === 'kuis') return { waktu_menit: k.waktu_menit, percobaan_maks: k.percobaan_maks, metode_nilai: k.metode_nilai, tampil_jawaban: k.tampil_jawaban, nilai_lulus: k.nilai_lulus,
    jml_soal: num_(k.ambil_acak) || (k.soal || []).length, petunjuk: k.petunjuk };
  if (m.tipe === 'kelasvirtual') { var o = Object.assign({}, k); delete o.kunci_moderator; delete o.kunci_peserta; return o; }
  return k;
}
function lmsModulPublik_(m, kelola, extra) {
  return Object.assign({ modul_id: m.modul_id, seksi_id: m.seksi_id, urutan: num_(m.urutan), tipe: m.tipe, judul: m.judul, deskripsi: m.deskripsi, konten: lmsKontenPublik_(m, kelola),
    tampil: m.tampil || 'YA', syarat: lmsJson_(m.syarat, null), penyelesaian: lmsAturanSelesai_(m), grouping_id: m.grouping_id, mode_grup: m.mode_grup,
    nilai_maks: num_(m.nilai_maks), kategori_id: m.kategori_id, bobot: num_(m.bobot, 1), buka: m.buka, tutup: m.tutup }, extra || {});
}
function apiLmsKursusGet(ctx, d) {
  var a = lmsAkses_(ctx, d.kursus_id); if (a.err) return a.err;
  var s = a.s, k = s.kursus, uid = a.uid, kid = k.kursus_id;
  var base = { kursus: lmsKursusRingkas_(k, { peran: a.peran, kelola: a.kelola, mode_grup: k.mode_grup, jml_seksi: num_(k.jml_seksi), syarat_lulus: lmsJson_(k.syarat_lulus, {}) || {}, skala_id: k.skala_id, tampil_nilai: k.tampil_nilai || 'YA' }),
    grup: s.grup.map(function (g) { return { grup_id: g.grup_id, nama: g.nama, jml: lmsIds_(g.anggota).length }; }),
    grouping: s.grouping.map(function (g) { return { grouping_id: g.grouping_id, nama: g.nama, grup_ids: lmsIds_(g.grup_ids) }; }) };
  if (a.kelola) {
    var siswa = lmsSiswa_(s), agg = lmsAgregatGuru_(s), perlu = agg.perlu, selesaiCnt = agg.selesai;   // v3.1: cache per kursus
    lmsLog_(ctx, 'aksi', 'kursus', kid, 0, 'kelola kursus');
    return ok_(Object.assign(base, {
      seksi: s.seksi.map(function (sk) { return { seksi_id: sk.seksi_id, no: num_(sk.no), judul: sk.judul, ringkasan: sk.ringkasan, tampil: sk.tampil || 'YA', syarat: lmsJson_(sk.syarat, null) }; }),
      modul: s.modul.map(function (m) { return lmsModulPublik_(m, true, { perlu_dinilai: perlu[m.modul_id] || 0, jml_selesai: selesaiCnt[m.modul_id] || 0 }); }),
      jml_siswa: siswa.length, lulus: selesaiCnt['KURSUS:' + kid] || 0
    }));
  }
  var st = lmsStatus_(s, uid), vis = lmsModulTerlihat_(s, st), now = lmsSekarang_();
  var seksi = s.seksi.filter(function (sk) { return sk.tampil !== 'TIDAK'; }).map(function (sk) {
    var c = lmsCekSyarat_(s, sk.syarat, st, now);
    return c.sembunyi ? null : { seksi_id: sk.seksi_id, no: num_(sk.no), judul: sk.judul, ringkasan: sk.ringkasan, terkunci: !c.ok, alasan: c.alasan };
  }).filter(Boolean);
  var modul = s.modul.filter(function (m) { return vis[m.modul_id]; }).map(function (m) {
    var c = vis[m.modul_id];
    return lmsModulPublik_(m, false, { terkunci: !c.ok, alasan: c.alasan, status: st.selesai[m.modul_id] || '', nilai: st.nilai[m.modul_id] === undefined ? null : st.nilai[m.modul_id] });
  });
  lmsLog_(ctx, 'aksi', 'kursus', kid, 0, 'buka kursus');
  var ev = lmsEvalLulus_(s, uid);
  return ok_(Object.assign(base, { seksi: seksi, modul: modul, progres: ev, lulus: st.selesai['KURSUS:' + kid] || '', grupSaya: st.grup }));
}

// ---------------------------------------------------------------------
// 5. SEKSI
// ---------------------------------------------------------------------
function apiLmsSeksiSave(ctx, d) {
  var a = lmsAkses_(ctx, d.kursus_id, 'kelola'); if (a.err) return a.err;
  var now = nowIso_(), syarat = d.syarat === undefined ? undefined : JSON.stringify(lmsJson_(d.syarat, null) || '');
  if (d.urutan && d.urutan.length) {                                   // urutkan ulang (drag)
    DB.updateBatch('KursusSeksi', 'seksi_id', d.urutan.map(function (id, i) { return { seksi_id: id, no: i, diperbarui_pada: now }; }).filter(function (p) { return a.s.seksi.some(function (x) { return x.seksi_id === p.seksi_id; }); }));
    lmsSegarkan_(); return ok_(null, 'Urutan seksi disimpan.');
  }
  if (d.seksi_id) {
    var sk = a.s.seksi.filter(function (x) { return x.seksi_id === d.seksi_id; })[0];
    if (!sk) return fail_('Seksi tidak ditemukan.');
    var p = { seksi_id: sk.seksi_id, diperbarui_pada: now };
    if (d.judul !== undefined) p.judul = lmsTeks_(d.judul, 150) || sk.judul;
    if (d.ringkasan !== undefined) p.ringkasan = lmsTeks_(d.ringkasan, 5000);
    if (d.tampil !== undefined) p.tampil = d.tampil === 'TIDAK' ? 'TIDAK' : 'YA';
    if (syarat !== undefined) p.syarat = syarat === '""' ? '' : syarat;
    DB.updateBatch('KursusSeksi', 'seksi_id', [p]);
    lmsSegarkan_(); return ok_(null, 'Seksi disimpan.');
  }
  var no = a.s.seksi.reduce(function (mx, x) { return Math.max(mx, num_(x.no)); }, 0) + 1;
  var k = a.s.kursus, id = reserveIds_('KursusSeksi', 1)[0];
  DB.appendBatch('KursusSeksi', [{ seksi_id: id, kursus_id: k.kursus_id, no: no, judul: lmsTeks_(d.judul, 150) || (k.format === 'mingguan' ? lmsJudulPekan_(k.tgl_mulai, no) : 'Topik ' + no), ringkasan: lmsTeks_(d.ringkasan, 5000), tampil: 'YA', syarat: '', diperbarui_pada: now }]);
  DB.updateBatch('Kursus', 'kursus_id', [{ kursus_id: k.kursus_id, jml_seksi: no }]);
  lmsSegarkan_();
  return ok_({ seksi_id: id }, 'Seksi baru ditambahkan.');
}
function apiLmsSeksiHapus(ctx, d) {
  var a = lmsAkses_(ctx, d.kursus_id, 'kelola'); if (a.err) return a.err;
  var sk = a.s.seksi.filter(function (x) { return x.seksi_id === d.seksi_id; })[0];
  if (!sk) return fail_('Seksi tidak ditemukan.');
  if (num_(sk.no) === 0) return fail_('Seksi Umum tidak dapat dihapus.');
  var mod = a.s.modul.filter(function (m) { return m.seksi_id === sk.seksi_id; });
  if (mod.length && !d.hapusIsi) return fail_('Seksi masih berisi ' + mod.length + ' aktivitas/materi. Pindahkan atau centang "hapus beserta isi".');
  if (mod.length) lmsHapusModul_(a.s, mod.map(function (m) { return m.modul_id; }));
  DB.deleteWhere('KursusSeksi', 'seksi_id', [sk.seksi_id]);
  lmsSegarkan_();
  return ok_(null, 'Seksi "' + sk.judul + '" dihapus.');
}

// ---------------------------------------------------------------------
// 6. MODUL (aktivitas & sumber belajar)
// ---------------------------------------------------------------------
function lmsFolder_() {
  var id = prop_('LMS_FOLDER');
  if (id) { try { DriveApp.getFolderById(id); return id; } catch (e) {} }
  var root = DriveApp.getFolderById(CONFIG.ROOT_FOLDER_ID), f = root.createFolder('SIAKAD_LMS');
  setProp_('LMS_FOLDER', f.getId());
  return f.getId();
}
/** Simpan unggahan {name, mime, data(base64)} ke Drive (berbagi via tautan) → meta */
function lmsSimpanBerkas_(b, awalan) {
  if (!b || !b.data) return null;
  var maks = num_(setting_('LMS_MAKS_MB', 10), 10) * 1048576, data = String(b.data).replace(/^data:[^,]+,/, '');
  var ukuran = Math.floor(data.length * 3 / 4);
  if (ukuran > maks) throw new Error('Berkas "' + b.name + '" melebihi batas ' + setting_('LMS_MAKS_MB', 10) + ' MB.');
  var nama = lmsTeks_(b.name || 'berkas', 120).replace(/[\\/:*?"<>|]+/g, '_');
  if (/\.(exe|bat|cmd|sh|js|msi|scr|vbs|ps1|jar)$/i.test(nama)) throw new Error('Jenis berkas "' + nama + '" tidak diizinkan.');
  var f = saveBase64File_(lmsFolder_(), (awalan ? awalan + '_' : '') + nama, b.mime || 'application/octet-stream', data);
  shareLink_(f);
  return { id: f.getId(), nama: nama, mime: b.mime || 'application/octet-stream', ukuran: ukuran };
}
function lmsUrlValid_(u) { return /^https?:\/\/[^\s<>"']{3,}$/i.test(String(u || '').trim()); }
/** Validasi & normalisasi konten per tipe → {konten} atau {err} */
function lmsNormKonten_(tipe, k, d, lama) {
  k = k || {}; lama = lama || {};
  switch (tipe) {
    case 'berkas': {
      var up = d.unggah ? lmsSimpanBerkas_(d.unggah, 'materi') : null;
      var berkas = up || lama.berkas;
      if (!berkas) return { err: 'Pilih berkas PDF/dokumen untuk diunggah.' };
      return { konten: { berkas: berkas, tampil: k.tampil === 'unduh' ? 'unduh' : 'sematkan' } };
    }
    case 'folder': {
      var list = (lama.berkas || []).filter(function (f) { return (d.hapusBerkas || []).indexOf(f.id) === -1; });
      (d.unggahBanyak || []).slice(0, 20).forEach(function (b) { var x = lmsSimpanBerkas_(b, 'folder'); if (x) list.push(x); });
      return { konten: { berkas: list } };
    }
    case 'halaman': return { konten: { isi: lmsTeks_(k.isi, 45000) } };
    case 'label': return { konten: { isi: lmsTeks_(k.isi, 3000), gaya: { info: 1, peringatan: 1, sukses: 1 }[k.gaya] ? k.gaya : '' } };
    case 'url': case 'web': {
      if (!lmsUrlValid_(k.url)) return { err: 'Alamat URL harus diawali http:// atau https://' };
      return { konten: { url: String(k.url).trim(), buka: k.buka === 'sematkan' || tipe === 'web' ? 'sematkan' : 'tab', tinggi: Math.max(300, Math.min(1600, num_(k.tinggi, 640))) } };
    }
    case 'kuis': {
      var soal = (k.soal || []).filter(function (x) { return x && x.soal_id; }).map(function (x) { return { soal_id: String(x.soal_id), skor: Math.max(0, num_(x.skor, 1)) }; });
      return { konten: { soal: soal, ambil_acak: Math.max(0, Math.min(soal.length, num_(k.ambil_acak))), acak_soal: !!k.acak_soal, acak_opsi: k.acak_opsi !== false,
        waktu_menit: Math.max(0, Math.min(600, num_(k.waktu_menit))), percobaan_maks: Math.max(0, Math.min(20, num_(k.percobaan_maks, 1))),
        metode_nilai: { tertinggi: 1, terakhir: 1, rata: 1, pertama: 1 }[k.metode_nilai] ? k.metode_nilai : 'tertinggi',
        tampil_jawaban: { langsung: 1, setelah_tutup: 1, tidak: 1 }[k.tampil_jawaban] ? k.tampil_jawaban : 'langsung', nilai_lulus: Math.max(0, Math.min(100, num_(k.nilai_lulus, num_(setting_('KKM', 70), 70)))),
        petunjuk: lmsTeks_(k.petunjuk, 3000) } };
    }
    case 'tugas': return { konten: { tipe_kirim: { teks: 1, berkas: 1, keduanya: 1 }[k.tipe_kirim] ? k.tipe_kirim : 'keduanya', maks_berkas: Math.max(1, Math.min(10, num_(k.maks_berkas, 3))),
      terlambat_boleh: k.terlambat_boleh !== false, rubrik_id: lmsTeks_(k.rubrik_id, 20), kelompok: !!k.kelompok, petunjuk: lmsTeks_(k.petunjuk, 10000) } };
    case 'forum': return { konten: { jenis: { umum: 1, tanya_jawab: 1, satu: 1, berita: 1 }[k.jenis] ? k.jenis : 'umum', dinilai: !!k.dinilai, agregasi: { rata: 1, maks: 1, jumlah: 1 }[k.agregasi] ? k.agregasi : 'rata',
      lampiran: k.lampiran !== false, petunjuk: lmsTeks_(k.petunjuk, 5000) } };
    case 'wiki': return { konten: { mode: k.mode === 'individu' ? 'individu' : 'kolaboratif', halaman_awal: lmsTeks_(k.halaman_awal, 100) || 'Beranda' } };
    case 'glosarium': return { konten: { siswa_boleh: k.siswa_boleh !== false, persetujuan: !!k.persetujuan } };
    case 'workshop': {
      var kr = (k.kriteria || []).filter(function (x) { return x && String(x.deskripsi || '').trim(); }).slice(0, 15).map(function (x, i) { return { id: x.id || ('K' + (i + 1)), deskripsi: lmsTeks_(x.deskripsi, 300), maks: Math.max(1, num_(x.maks, 10)) }; });
      if (!kr.length) kr = [{ id: 'K1', deskripsi: 'Kualitas isi', maks: 10 }];
      var bk = Math.max(0, Math.min(100, num_(k.bobot_kirim, 80)));
      return { konten: { fase: lama.fase || 'penyiapan', kriteria: kr, jml_penilai: Math.max(1, Math.min(5, num_(k.jml_penilai, 2))), bobot_kirim: bk, bobot_menilai: 100 - bk,
        petunjuk_kirim: lmsTeks_(k.petunjuk_kirim, 5000), petunjuk_nilai: lmsTeks_(k.petunjuk_nilai, 5000), alokasi: lama.alokasi || null } };
    }
    case 'pelajaran': {
      var hal = (k.halaman || []).slice(0, 60).map(function (h, i) {
        return { id: h.id || ('H' + (i + 1)), judul: lmsTeks_(h.judul, 150) || ('Halaman ' + (i + 1)), tipe: h.tipe === 'soal' ? 'soal' : 'konten', isi: lmsTeks_(h.isi, 15000),
          opsi: (h.opsi || []).slice(0, 8).map(function (o) { return { teks: lmsTeks_(o.teks, 500), benar: !!o.benar, lompat: lmsTeks_(o.lompat, 20) || 'lanjut', umpan: lmsTeks_(o.umpan, 500) }; }),
          tombol: (h.tombol || []).slice(0, 6).map(function (t) { return { label: lmsTeks_(t.label, 60), ke: lmsTeks_(t.ke, 20) || 'lanjut' }; }) };
      });
      if (!hal.length) return { err: 'Pelajaran interaktif minimal memiliki 1 halaman.' };
      return { konten: { halaman: hal, nilai_min: Math.max(0, Math.min(100, num_(k.nilai_min, 70))), percobaan_maks: Math.max(0, Math.min(20, num_(k.percobaan_maks, 0))) } };
    }
    case 'umpanbalik': {
      var q = (k.pertanyaan || []).slice(0, 50).map(function (p, i) {
        return { id: p.id || ('Q' + (i + 1)), tipe: { skala: 1, pilihan: 1, pilihanganda: 1, teks: 1 }[p.tipe] ? p.tipe : 'teks', teks: lmsTeks_(p.teks, 500),
          opsi: (p.opsi || []).slice(0, 12).map(function (o) { return lmsTeks_(o, 150); }).filter(String), wajib: !!p.wajib };
      }).filter(function (p) { return p.teks; });
      if (!q.length) return { err: 'Tambahkan minimal 1 pertanyaan.' };
      return { konten: { pertanyaan: q, anonim: !!k.anonim, tampil_hasil: !!k.tampil_hasil, pengantar: lmsTeks_(k.pengantar, 3000) } };
    }
    case 'kelasvirtual': {
      var plat = { meet: 1, zoom: 1, teams: 1, bbb: 1, lain: 1 }[k.platform] ? k.platform : 'meet';
      var o = { platform: plat, link: String(k.link || lama.link || '').trim(), mulai: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(k.mulai) ? k.mulai : '', durasi: Math.max(5, Math.min(600, num_(k.durasi, 60))),
        rekaman: lmsUrlValid_(k.rekaman) ? String(k.rekaman).trim() : '', catatan: lmsTeks_(k.catatan, 2000), meeting_id: lama.meeting_id || '', kata_sandi: lmsTeks_(k.kata_sandi || lama.kata_sandi, 40),
        kunci_moderator: lama.kunci_moderator || '', kunci_peserta: lama.kunci_peserta || '' };
      if (d.buatOtomatis && typeof kvBuatRapat_ === 'function') {
        var r = kvBuatRapat_(plat, { judul: d.judul, mulai: o.mulai, durasi: o.durasi });
        if (r.err) return { err: r.err };
        Object.assign(o, r);
      }
      if (plat !== 'bbb' && o.link && !lmsUrlValid_(o.link)) return { err: 'Tautan rapat harus diawali https://' };
      if (plat !== 'bbb' && !o.link) return { err: 'Isi tautan rapat, atau centang "buat otomatis" bila platform sudah dihubungkan.' };
      return { konten: o };
    }
  }
  return { err: 'Tipe aktivitas tidak dikenal: ' + tipe };
}
function apiLmsModulSave(ctx, d) {
  var o = d.data || {}, now = nowIso_(), uid = ctx.session.uid;
  var kid = o.kursus_id;
  var lama = null;
  if (o.modul_id) { lama = DB.find('KursusModul', 'modul_id', o.modul_id); if (!lama) return fail_('Aktivitas tidak ditemukan.'); kid = lama.kursus_id; }
  var a = lmsAkses_(ctx, kid, 'kelola'); if (a.err) return a.err;
  var tipe = lama ? lama.tipe : o.tipe;
  if (!LMS_AKTIVITAS[tipe] && !LMS_SUMBER[tipe]) return fail_('Pilih jenis aktivitas / sumber belajar.');
  var judul = lmsTeks_(o.judul, 200).trim();
  if (!judul && tipe !== 'label') return fail_('Judul wajib diisi.');
  var seksiId = o.seksi_id || (lama && lama.seksi_id) || (a.s.seksi[0] && a.s.seksi[0].seksi_id);
  if (!a.s.seksi.some(function (x) { return x.seksi_id === seksiId; })) return fail_('Seksi tujuan tidak ditemukan.');
  var nk;
  try { nk = lmsNormKonten_(tipe, o.konten, Object.assign({}, d, { judul: judul }), lama ? lmsJson_(lama.konten, {}) : null); } catch (e) { return fail_(e.message); }
  if (nk.err) return fail_(nk.err);
  var pen = lmsJson_(o.penyelesaian, null) || {};
  var modeOk = { tidak: 1, manual: 1, lihat: 1, kirim: 1, nilai: 1, lulus: 1 };
  pen = { mode: modeOk[pen.mode] ? pen.mode : (LMS_SELESAI_BAWAAN[tipe] || 'tidak') };
  if (pen.mode === 'lulus') pen.nilai_min = Math.max(0, Math.min(100, num_((lmsJson_(o.penyelesaian, {}) || {}).nilai_min, num_(nk.konten.nilai_min || nk.konten.nilai_lulus, num_(setting_('KKM', 70), 70)))));
  if ((pen.mode === 'nilai' || pen.mode === 'lulus') && !LMS_DINILAI[tipe]) pen.mode = 'kirim';
  var syarat = lmsJson_(o.syarat, null);
  var row = { seksi_id: seksiId, tipe: tipe, judul: judul || 'Label', deskripsi: lmsTeks_(o.deskripsi, 10000), konten: JSON.stringify(nk.konten), tampil: o.tampil === 'TIDAK' ? 'TIDAK' : 'YA',
    syarat: syarat && syarat.aturan && syarat.aturan.length ? JSON.stringify(syarat) : '', penyelesaian: JSON.stringify(pen),
    grouping_id: a.s.grouping.some(function (g) { return g.grouping_id === o.grouping_id; }) ? o.grouping_id : '',
    mode_grup: { tanpa: 1, terpisah: 1, terlihat: 1 }[o.mode_grup] ? o.mode_grup : '',
    nilai_maks: LMS_DINILAI[tipe] && !(tipe === 'forum' && !nk.konten.dinilai) ? Math.max(1, Math.min(1000, num_(o.nilai_maks, 100))) : 0,
    kategori_id: lmsTeks_(o.kategori_id, 20), bobot: Math.max(0, num_(o.bobot, 1)),
    buka: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(o.buka) ? o.buka : '', tutup: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(o.tutup) ? o.tutup : '', diperbarui_pada: now };
  if (lama) {
    row.modul_id = lama.modul_id;
    DB.updateBatch('KursusModul', 'modul_id', [row]);
  } else {
    row.modul_id = reserveIds_('KursusModul', 1)[0]; row.kursus_id = kid;
    row.urutan = a.s.modul.filter(function (m) { return m.seksi_id === seksiId; }).reduce(function (mx, m) { return Math.max(mx, num_(m.urutan)); }, 0) + 1;
    row.dibuat_oleh = uid; row.dibuat_pada = now;
    DB.appendBatch('KursusModul', [row]);
  }
  lmsSegarkan_();
  if (typeof lmsSinkronNilaiModul_ === 'function') lmsSinkronNilaiModul_(kid, row.modul_id);
  var res = ok_({ modul_id: row.modul_id, konten: lmsKontenPublik_(row, true) }, (lama ? 'Perubahan disimpan: ' : 'Ditambahkan: ') + (LMS_AKTIVITAS[tipe] || LMS_SUMBER[tipe]) + ' "' + row.judul + '".');
  res.auditDetail = (lama ? 'Ubah ' : 'Tambah ') + tipe + ' ' + row.modul_id + ' di ' + kid;
  return res;
}
function lmsHapusModul_(s, ids) {
  LMS_TABEL_ANAK.forEach(function (t) { lmsHapusKolom_(t, 'modul_id', ids); });
  lmsHapusKolom_('Penyelesaian', 'modul_id', ids);
  if (SCHEMA.NilaiEntri) lmsHapusKolom_('NilaiEntri', 'item_ref', ids);
  DB.deleteWhere('KursusModul', 'modul_id', ids);
}
function apiLmsModulHapus(ctx, d) {
  var m = DB.find('KursusModul', 'modul_id', d.modul_id); if (!m) return fail_('Aktivitas tidak ditemukan.');
  var a = lmsAkses_(ctx, m.kursus_id, 'kelola'); if (a.err) return a.err;
  lmsHapusModul_(a.s, [m.modul_id]);
  lmsSegarkan_();
  var res = ok_(null, '"' + m.judul + '" dihapus beserta seluruh kiriman & nilainya.');
  res.auditDetail = 'Hapus ' + m.tipe + ' ' + m.modul_id + ' ' + m.judul;
  return res;
}
/** Urutkan / pindah modul: d.urutan = [{modul_id, seksi_id}] urut tampil */
function apiLmsModulUrut(ctx, d) {
  var a = lmsAkses_(ctx, d.kursus_id, 'kelola'); if (a.err) return a.err;
  var ada = {}; a.s.modul.forEach(function (m) { ada[m.modul_id] = 1; });
  var sek = {}; a.s.seksi.forEach(function (x) { sek[x.seksi_id] = 1; });
  var n = {}, patches = (d.urutan || []).filter(function (x) { return ada[x.modul_id] && sek[x.seksi_id]; }).map(function (x) { n[x.seksi_id] = (n[x.seksi_id] || 0) + 1; return { modul_id: x.modul_id, seksi_id: x.seksi_id, urutan: n[x.seksi_id] }; });
  if (d.tampil) patches = patches.concat([{ modul_id: d.tampil.modul_id, tampil: d.tampil.nilai === 'TIDAK' ? 'TIDAK' : 'YA' }].filter(function (p) { return ada[p.modul_id]; }));
  DB.updateBatch('KursusModul', 'modul_id', patches);
  lmsSegarkan_();
  return ok_(null, 'Tata letak kursus disimpan.');
}
/** Detail modul untuk dilihat. Sumber belajar: tandai "dilihat" bila aturannya 'lihat'. */
function apiLmsModulGet(ctx, d) {
  var a = lmsAksesModul_(ctx, d.modul_id); if (a.err) return a.err;
  var m = a.m, out = lmsModulPublik_(m, a.kelola, { kursus_id: m.kursus_id, kursus_nama: a.s.kursus.nama, peran: a.peran, kelola: a.kelola });
  if (!a.kelola) {
    out.status = a.st.selesai[m.modul_id] || '';
    out.nilai = a.st.nilai[m.modul_id] === undefined ? null : a.st.nilai[m.modul_id];
    var aturan = lmsAturanSelesai_(m);
    var tandaiLihat = aturan.mode === 'lihat' && !out.status && m.tipe !== 'kelasvirtual';
    if (tandaiLihat) { var r = withLock_(function () { return { s: lmsTandai_(m.kursus_id, m.modul_id, a.uid, 'lihat') }; }); if (r && r.s) out.status = r.s; }
  }
  lmsLog_(ctx, 'aksi', 'modul:' + m.tipe, m.modul_id, 0, m.judul);
  return ok_(out);
}
function apiLmsSelesaiManual(ctx, d) {
  var a = lmsAksesModul_(ctx, d.modul_id); if (a.err) return a.err;
  if (a.kelola) return fail_('Penyelesaian manual hanya untuk siswa.');
  if (lmsAturanSelesai_(a.m).mode !== 'manual') return fail_('Aktivitas ini diselesaikan otomatis oleh sistem.');
  if (d.selesai === false) lmsHapusSelesai_(a.m.kursus_id, a.m.modul_id, a.uid);
  else lmsSimpanSelesai_(a.m.kursus_id, a.m.modul_id, a.uid, 'selesai', 'manual');
  lmsCekLulus_(a.m.kursus_id, a.uid);
  return ok_({ status: d.selesai === false ? '' : 'selesai' }, d.selesai === false ? 'Tanda selesai dibatalkan.' : 'Ditandai selesai.');
}

// ---------------------------------------------------------------------
// 7. PESERTA, GRUP & PENGELOMPOKAN
// ---------------------------------------------------------------------
function apiLmsPesertaList(ctx, d) {
  var a = lmsAkses_(ctx, d.kursus_id, 'kelola'); if (a.err) return a.err;
  var s = a.s, kls = lmsKelasUid_(), ux = userIdx_(), kelasNama = {}, seen = (typeof seenAll_ === 'function') ? seenAll_(ux) : {};
  DB.all('Kelas').forEach(function (k) { kelasNama[k.kelas_id] = k.nama_kelas; });
  var manual = {}; s.peserta.forEach(function (p) { manual[p.user_id] = p; });
  var lastLogin = {}; DB.all('Users').forEach(function (u) { lastLogin[u.user_id] = u.last_login; });
  var siswa = lmsSiswa_(s).map(function (uid) {
    var ev = lmsEvalLulus_(s, uid), st = lmsStatus_(s, uid);
    return { uid: uid, nama: lmsNama_(uid), kelas: kelasNama[kls[uid]] || kls[uid] || '-', sumber: manual[uid] ? 'manual' : 'kelas', progres: ev.persen, beres: ev.beres, wajib: ev.wajib,
      lulus: !!st.selesai['KURSUS:' + s.kursus.kursus_id], grup: st.grup, last_login: lastLogin[uid] || '', online: !!(seen[uid] && Date.now() - seen[uid].t < 300000) };
  });
  var pengajar = lmsPengajar_(s).map(function (uid) { return { uid: uid, nama: lmsNama_(uid), peran: ux[uid] ? ux[uid].r : '', sumber: lmsIds_(s.kursus.pengajar).indexOf(uid) > -1 ? 'utama' : 'manual' }; });
  return ok_({ siswa: siswa, pengajar: pengajar, grup: s.grup.map(function (g) { return { grup_id: g.grup_id, nama: g.nama, deskripsi: g.deskripsi, anggota: lmsIds_(g.anggota) }; }),
    grouping: s.grouping.map(function (g) { return { grouping_id: g.grouping_id, nama: g.nama, grup_ids: lmsIds_(g.grup_ids) }; }) });
}
function apiLmsPesertaSimpan(ctx, d) {
  var a = lmsAkses_(ctx, d.kursus_id, 'kelola'); if (a.err) return a.err;
  var kid = a.s.kursus.kursus_id, ux = userIdx_(), now = nowIso_(), ada = {};
  a.s.peserta.forEach(function (p) { ada[p.user_id] = p; });
  var tambah = (d.tambah || []).filter(function (t) { return ux[t.user_id] && !ada[t.user_id]; });
  if (tambah.length) {
    var ids = reserveIds_('KursusPeserta', tambah.length);
    DB.appendBatch('KursusPeserta', tambah.map(function (t, i) { return { peserta_id: ids[i], kursus_id: kid, user_id: t.user_id, peran: t.peran === 'pengajar' && ux[t.user_id].r !== 'siswa' ? 'pengajar' : 'siswa', ditambah_oleh: ctx.session.uid, dibuat_pada: now }; }));
  }
  var hapus = (d.hapus || []).map(function (u) { return ada[u] && ada[u].peserta_id; }).filter(Boolean);
  if (hapus.length) DB.deleteWhere('KursusPeserta', 'peserta_id', hapus);
  lmsSegarkan_();
  return ok_(null, (tambah.length ? tambah.length + ' peserta ditambahkan. ' : '') + (hapus.length ? hapus.length + ' peserta manual dikeluarkan.' : '') || 'Tidak ada perubahan.');
}
function apiLmsGrupSave(ctx, d) {
  var a = lmsAkses_(ctx, d.kursus_id, 'kelola'); if (a.err) return a.err;
  var siswa = {}; lmsSiswa_(a.s).forEach(function (u) { siswa[u] = 1; });
  var nama = lmsTeks_(d.nama, 100).trim(); if (!nama) return fail_('Nama grup wajib diisi.');
  var anggota = lmsIds_(d.anggota).filter(function (u) { return siswa[u]; });
  if (d.grup_id) {
    if (!a.s.grup.some(function (g) { return g.grup_id === d.grup_id; })) return fail_('Grup tidak ditemukan.');
    DB.updateBatch('KursusGrup', 'grup_id', [{ grup_id: d.grup_id, nama: nama, deskripsi: lmsTeks_(d.deskripsi, 500), anggota: anggota.join(',') }]);
  } else DB.appendBatch('KursusGrup', [{ grup_id: reserveIds_('KursusGrup', 1)[0], kursus_id: a.s.kursus.kursus_id, nama: nama, deskripsi: lmsTeks_(d.deskripsi, 500), anggota: anggota.join(','), dibuat_pada: nowIso_() }]);
  lmsSegarkan_();
  return ok_(null, 'Grup "' + nama + '" disimpan (' + anggota.length + ' anggota).');
}
function apiLmsGrupHapus(ctx, d) {
  var a = lmsAkses_(ctx, d.kursus_id, 'kelola'); if (a.err) return a.err;
  var ids = lmsIds_(d.grup_ids || d.grup_id).filter(function (id) { return a.s.grup.some(function (g) { return g.grup_id === id; }); });
  if (!ids.length) return fail_('Grup tidak ditemukan.');
  DB.deleteWhere('KursusGrup', 'grup_id', ids);
  var upd = a.s.grouping.map(function (g) { var l = lmsIds_(g.grup_ids), b = l.filter(function (x) { return ids.indexOf(x) === -1; }); return b.length !== l.length ? { grouping_id: g.grouping_id, grup_ids: b.join(',') } : null; }).filter(Boolean);
  DB.updateBatch('KursusGrouping', 'grouping_id', upd);
  lmsSegarkan_();
  return ok_(null, ids.length + ' grup dihapus.');
}
/** Bagi otomatis: d.jumlah grup ATAU d.perGrup anggota; d.cara 'acak'|'abjad'; d.ganti = hapus grup lama */
function apiLmsGrupOtomatis(ctx, d) {
  var a = lmsAkses_(ctx, d.kursus_id, 'kelola'); if (a.err) return a.err;
  var siswa = lmsSiswa_(a.s);
  if (!siswa.length) return fail_('Belum ada siswa di kursus ini.');
  var urut = d.cara === 'abjad' ? siswa : lmsAcak_(siswa);
  var n = d.perGrup ? Math.max(1, Math.ceil(urut.length / Math.max(1, num_(d.perGrup)))) : Math.max(1, Math.min(urut.length, num_(d.jumlah, 4)));
  var grup = []; for (var i = 0; i < n; i++) grup.push([]);
  urut.forEach(function (u, i) { grup[i % n].push(u); });
  if (d.ganti && a.s.grup.length) DB.deleteWhere('KursusGrup', 'grup_id', a.s.grup.map(function (g) { return g.grup_id; }));
  var awalan = lmsTeks_(d.awalan, 40) || 'Kelompok', ids = reserveIds_('KursusGrup', n), now = nowIso_();
  DB.appendBatch('KursusGrup', grup.map(function (g, i) { return { grup_id: ids[i], kursus_id: a.s.kursus.kursus_id, nama: awalan + ' ' + (i + 1), deskripsi: 'Dibagi otomatis (' + (d.cara === 'abjad' ? 'abjad' : 'acak') + ')', anggota: g.join(','), dibuat_pada: now }; }));
  if (d.grouping) {
    DB.appendBatch('KursusGrouping', [{ grouping_id: reserveIds_('KursusGrouping', 1)[0], kursus_id: a.s.kursus.kursus_id, nama: lmsTeks_(d.grouping, 100), grup_ids: ids.join(','), dibuat_pada: now }]);
  }
  lmsSegarkan_();
  return ok_({ grup_ids: ids }, urut.length + ' siswa dibagi ke ' + n + ' grup.');
}
function apiLmsGroupingSave(ctx, d) {
  var a = lmsAkses_(ctx, d.kursus_id, 'kelola'); if (a.err) return a.err;
  var nama = lmsTeks_(d.nama, 100).trim(); if (!nama) return fail_('Nama pengelompokan wajib diisi.');
  var gids = lmsIds_(d.grup_ids).filter(function (id) { return a.s.grup.some(function (g) { return g.grup_id === id; }); });
  if (d.grouping_id) DB.updateBatch('KursusGrouping', 'grouping_id', [{ grouping_id: d.grouping_id, nama: nama, grup_ids: gids.join(',') }]);
  else DB.appendBatch('KursusGrouping', [{ grouping_id: reserveIds_('KursusGrouping', 1)[0], kursus_id: a.s.kursus.kursus_id, nama: nama, grup_ids: gids.join(','), dibuat_pada: nowIso_() }]);
  lmsSegarkan_();
  return ok_(null, 'Pengelompokan "' + nama + '" disimpan.');
}
function apiLmsGroupingHapus(ctx, d) {
  var a = lmsAkses_(ctx, d.kursus_id, 'kelola'); if (a.err) return a.err;
  if (!a.s.grouping.some(function (g) { return g.grouping_id === d.grouping_id; })) return fail_('Pengelompokan tidak ditemukan.');
  DB.deleteWhere('KursusGrouping', 'grouping_id', [d.grouping_id]);
  DB.updateBatch('KursusModul', 'modul_id', a.s.modul.filter(function (m) { return m.grouping_id === d.grouping_id; }).map(function (m) { return { modul_id: m.modul_id, grouping_id: '' }; }));
  lmsSegarkan_();
  return ok_(null, 'Pengelompokan dihapus. Aktivitas yang dibatasi kini terbuka untuk semua.');
}
/** Grup seorang siswa di kursus (untuk mode grup aktivitas) */
function lmsGrupUser_(s, uid) { return s.grup.filter(function (g) { return lmsIds_(g.anggota).indexOf(uid) > -1; }); }

// ---------------------------------------------------------------------
// 8. LAPORAN PENYELESAIAN (matriks siswa × aktivitas)
// ---------------------------------------------------------------------
function apiLmsLaporanSelesai(ctx, d) {
  var a = lmsAkses_(ctx, d.kursus_id, 'kelola'); if (a.err) return a.err;
  var s = a.s, kid = s.kursus.kursus_id, mods = lmsDilacak_(s), siswa = lmsSiswa_(s), map = {};
  DB.all('Penyelesaian').forEach(function (r) { if (r.kursus_id === kid) (map[r.user_id] = map[r.user_id] || {})[r.modul_id] = { s: r.status, w: r.waktu }; });
  return ok_({ kursus: lmsKursusRingkas_(s.kursus), modul: mods.map(function (m) { return { modul_id: m.modul_id, tipe: m.tipe, judul: m.judul, mode: lmsAturanSelesai_(m).mode }; }),
    baris: siswa.map(function (uid) { var ev = lmsEvalLulus_(s, uid); return { uid: uid, nama: lmsNama_(uid), sel: map[uid] || {}, progres: ev.persen, total: ev.total, lulus: !!(map[uid] || {})['KURSUS:' + kid] }; }) });
}

// ---------------------------------------------------------------------
// 9. RUTE & SETUP
// ---------------------------------------------------------------------
EXT.routes.push(function (add) {
  add('lms.kursus.list', apiLmsKursusList, 'any');
  add('lms.kursus.get', apiLmsKursusGet, 'any');
  add('lms.opsi', apiLmsOpsi, 'guru');
  add('lms.kursus.save', apiLmsKursusSave, 'guru', true, { audit: true });
  add('lms.kursus.hapus', apiLmsKursusHapus, 'guru', true, { audit: true });
  add('lms.seksi.save', apiLmsSeksiSave, 'guru', true);
  add('lms.seksi.hapus', apiLmsSeksiHapus, 'guru', true, { audit: true });
  add('lms.modul.save', apiLmsModulSave, 'guru', true, { audit: true });
  add('lms.modul.hapus', apiLmsModulHapus, 'guru', true, { audit: true });
  add('lms.modul.urut', apiLmsModulUrut, 'guru', true);
  add('lms.modul.get', apiLmsModulGet, 'any');
  add('lms.selesai.manual', apiLmsSelesaiManual, 'siswa', true);
  add('lms.peserta.list', apiLmsPesertaList, 'guru');
  add('lms.peserta.simpan', apiLmsPesertaSimpan, 'guru', true, { audit: true });
  add('lms.grup.save', apiLmsGrupSave, 'guru', true);
  add('lms.grup.hapus', apiLmsGrupHapus, 'guru', true);
  add('lms.grup.otomatis', apiLmsGrupOtomatis, 'guru', true);
  add('lms.grouping.save', apiLmsGroupingSave, 'guru', true);
  add('lms.grouping.hapus', apiLmsGroupingHapus, 'guru', true);
  add('lms.laporan.selesai', apiLmsLaporanSelesai, 'guru');
});
lmsKait_('demoClear', function () {
  ['Kursus', 'KursusSeksi', 'KursusModul', 'KursusPeserta', 'KursusGrup', 'KursusGrouping', 'Penyelesaian'].concat(LMS_TABEL_ANAK).forEach(function (n) {
    var sh = getSheet_(n), last = sh.getLastRow();
    if (last > 1) sh.getRange(2, 1, last - 1, sh.getLastColumn()).clearContent();
    invalidateRows_(n);
  });
  bump_('lms'); bump_('lmsr');                                    // v3.1: cache baris siswa ikut basi
});

/**
 * UPDATE KE v3.0 — jalankan SEKALI dari editor setelah menempel file baru (aman diulang).
 * Membuat sheet LMS, kunci enkripsi pesan, folder unggahan, trigger; tidak mengubah data lama.
 */
function setupV30() {
  resetMemo_();
  if (!prop_('SPREADSHEET_ID')) { Logger.log('⚠️ Belum ada setup. Jalankan setupAppEnvironment() dulu.'); return; }
  Logger.log('🔧 Update ke v' + APP.VERSION + ' (LMS) ...');
  upgradeSchema(true);
  setupRahasia_();
  try { lmsFolder_(); Logger.log('+ folder SIAKAD_LMS siap'); } catch (e) { Logger.log('⚠️ Folder LMS: ' + e.message); }
  var baruDemo = false;
  if (prop_('DEMO_SEEDED') === '1' && !DB.all('Kursus').length && typeof seedDemoV3_ === 'function') {
    seedDemoV3_(prng_(20261015)); baruDemo = true; Logger.log('📚 Data contoh LMS ditambahkan (karena data contoh sekolah masih terpasang).');
  }
  setProp_('V3_SIAP', APP.VERSION);
  ['master', 'akun', 'adm', 'lms', 'notif'].forEach(function (s) { bump_(s); });
  pasangTrigger();
  Logger.log('🔐 Kunci enkripsi pesan: ' + (prop_('ENC_KEY') ? 'ada (Script Properties)' : 'BELUM'));
  Logger.log('✅ Selesai' + (baruDemo ? '' : '') + '. Lanjutkan: Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy.');
  if (typeof cekPerforma === 'function') cekPerforma();
}

// =====================================================================
// v3.1 — TURBO LMS (gas-scale-turbo): cache berversi per pengguna & per kursus
//   • Status siswa (Penyelesaian + NilaiEntri) dibaca dari cache MILIK PENGGUNA ITU
//     → membuka kursus/aktivitas tidak lagi membaca 2 sheet besar seluruh sekolah.
//   • Hitungan guru (perlu dinilai, jumlah selesai) di-cache per kursus.
//   • Peta modul→kursus & daftar kursus di-cache (ikut versi 'lms').
//   Kunci memuat versi → data lama otomatis tak terpakai; tidak ada sheet yang diubah.
// =====================================================================
/** Baris Penyelesaian & NilaiEntri satu pengguna (semua kursus), ringkas, dari cache berversi */
function lmsRekamUser_(uid) {
  uid = String(uid || '');
  if (_LMS['rk' + uid]) return _LMS['rk' + uid];
  var key = 'lmsRk_' + uid + '_' + ver_('lmsr') + '_' + ver_('lmsu_' + uid), rk = CacheX.get(key);   // tidak ikut 'lms': edit struktur guru tidak membuat cache siswa dingin
  if (!rk) {
    rk = { s: {}, n: {} };
    DB.all('Penyelesaian').forEach(function (r) { if (r.user_id === uid) (rk.s[r.kursus_id] = rk.s[r.kursus_id] || {})[r.modul_id] = r.status; });
    if (SCHEMA.NilaiEntri) DB.all('NilaiEntri').forEach(function (e) {
      if (e.user_id === uid) (rk.n[e.kursus_id] = rk.n[e.kursus_id] || {})[e.item_ref] = { nilai: e.nilai === '' ? '' : num_(e.nilai), maks: num_(e.nilai_maks, 100), timpa: e.timpa === 'YA', catatan: e.catatan, sumber: e.sumber, waktu: e.waktu };
    });
    CacheX.put(key, rk, 21600);
  }
  return (_LMS['rk' + uid] = rk);
}
/** Tandai cache pengguna (& hitungan guru kursus itu) basi — dipanggil setiap menulis Penyelesaian/NilaiEntri */
function lmsUserBasi_(uid, kid) {
  if (uid) { bump_('lmsu_' + uid, true); delete _LMS['rk' + uid]; delete _LMS['st' + kid + '|' + uid]; delete _LMS['vis' + kid + '|' + uid]; }
  if (kid) lmsAggBasi_(kid);
}
function lmsAggBasi_(kid) { if (kid) { bump_('lmsg_' + kid, true); delete _LMS['agg' + kid]; } }
/** Peta modul_id → baris modul (cache, ikut versi 'lms'). Fallback ke sheet bila belum ada. */
function lmsPetaModul_() {
  return _LMS.m2k || (_LMS.m2k = cached_('lmsM2K_' + ver_('lms'), 3600, function () {
    var o = {}; DB.all('KursusModul').forEach(function (m) { o[m.modul_id] = m.kursus_id; }); return o;
  }));
}
function lmsModulKursus_(mid) {
  var kid = lmsPetaModul_()[mid];
  if (kid) { var s = lmsStruktur_(kid), m = s && s.modul.filter(function (x) { return x.modul_id === mid; })[0]; if (m) return m; }
  return DB.find('KursusModul', 'modul_id', mid);
}
function lmsKursusSemua_() { return _LMS.ks || (_LMS.ks = cached_('lmsKS_' + ver_('lms'), 3600, function () { return DB.all('Kursus'); })); }
/** Hitungan guru per kursus: perlu dinilai & jumlah selesai per modul */
function lmsAgregatGuru_(s) {
  var kid = s.kursus.kursus_id;
  if (_LMS['agg' + kid]) return _LMS['agg' + kid];
  return (_LMS['agg' + kid] = cached_('lmsAgg_' + kid + '_' + ver_('lms') + '_' + ver_('lmsg_' + kid) + '_' + ver_('lmsgAll'), 21600, function () {
    var perlu = typeof lmsPerluDinilai_ === 'function' ? lmsPerluDinilai_(s) : {}, selesai = {};
    DB.all('Penyelesaian').forEach(function (r) { if (r.kursus_id === kid && r.status !== 'gagal') selesai[r.modul_id] = (selesai[r.modul_id] || 0) + 1; });
    return { perlu: perlu, selesai: selesai };
  }));
}
/** Setelah aksi TULIS LMS sukses → hitungan guru kursus terkait basi (kiriman, nilai, forum, glosarium, dst.) */
var LMS_AKSI_TULIS = /^(lms|kuis|tugas|forum|wiki|glos|ws|pel|ub|kv|nilai|soal|rubrik)\./;
lmsKait_('setelahTulis', function (aksi, ctx, d, out) {
  if (!LMS_AKSI_TULIS.test(aksi)) return;
  d = d || {};
  var kid = d.kursus_id || '';
  if (!kid && d.modul_id) { var m = lmsModulKursus_(d.modul_id); kid = m ? m.kursus_id : ''; }
  if (kid) lmsAggBasi_(kid); else bump_('lmsgAll', true);           // tidak diketahui kursusnya → semua hitungan guru basi
  // tulis-tembus: struktur kursus yang baru diubah guru langsung dibangun ulang & di-cache di sini
  // (di dalam lock, data segar) → siswa berikutnya tidak menunggu pembacaan ulang sheet
  if (/^lms\./.test(aksi)) { try { lmsPetaModul_(); lmsKursusSemua_(); if (kid) lmsStruktur_(kid); } catch (e) { console.error('lms warm: ' + e.message); } }
});
/** Warmup (trigger 1 menit & ?w=): struktur kursus aktif + peta modul tetap hangat di cache */
lmsKait_('warm', function (step, scope) {
  if (scope === 'pub') return;
  step('lms', function () { lmsPetaModul_(); lmsKursusSemua_().forEach(function (k) { if (k.status === 'Aktif') lmsStruktur_(k.kursus_id); }); });
});
/**
 * Jalankan dari editor HANYA bila data LMS diubah LANGSUNG di spreadsheet (bukan lewat aplikasi).
 * Semua cache LMS (struktur, progres & nilai siswa, hitungan guru) dibangun ulang pada permintaan berikutnya.
 * Tidak menulis ke spreadsheet.
 */
function segarkanCacheLms() {
  resetMemo_(); bump_('lms'); bump_('lmsr'); bump_('lmsgAll'); bump_('adm');
  Logger.log('✅ Cache LMS disegarkan. Perubahan langsung di spreadsheet kini terbaca oleh guru & siswa.');
}

if (typeof pasangEkstensi_ === 'function' && typeof SCHEMA !== 'undefined') pasangEkstensi_();

;
// ==== LmsAktivitas.gs ====
/**
 * =====================================================================
 *  SIAKAD SISWA v3.0 — LmsAktivitas.gs : Aktivitas Pembelajaran
 *  Kuis (7 tipe soal, acak, batas waktu, nilai otomatis — tiket bertanda tangan,
 *  tanpa kunci server saat mengerjakan), Tugas (+rubrik/panduan penilaian, kelompok),
 *  Forum lanjutan (lampiran, tanya-jawab, rating guru), Wiki (versi & pemulihan),
 *  Glosarium, Workshop (penilaian sejawat), Pelajaran interaktif bercabang,
 *  Umpan balik & survei, Kelas virtual (Google Meet / Zoom / BigBlueButton / Teams).
 * =====================================================================
 */
var EXT = (typeof EXT !== 'undefined' && EXT) || { schema: {}, seed: [], routes: [], tick: [], reset: [], hooks: {} };
var LMS_TABEL_ANAK = (typeof LMS_TABEL_ANAK !== 'undefined' && LMS_TABEL_ANAK) || [];

Object.assign(EXT.schema, {
  BankSoal:          { key: 'soal_id', prefix: 'SOL', cols: ['soal_id', 'kursus_id', 'kategori', 'tipe', 'teks', 'data', 'skor', 'umpan_balik', 'pemilik', 'dibuat_pada', 'diperbarui_pada'] },
  KuisPercobaan:     { key: 'percobaan_id', prefix: 'KPC', cols: ['percobaan_id', 'modul_id', 'kursus_id', 'user_id', 'no', 'mulai', 'selesai', 'durasi_detik', 'jawaban', 'rincian', 'nilai', 'nilai_maks', 'status', 'terlambat', 'dinilai_oleh', 'dinilai_pada'] },
  TugasKirim:        { key: 'kirim_id', prefix: 'TGS', cols: ['kirim_id', 'modul_id', 'kursus_id', 'user_id', 'grup_id', 'teks', 'berkas', 'status', 'dibuka_pada', 'dikirim_pada', 'terlambat', 'durasi_detik', 'nilai', 'rincian_nilai', 'umpan_balik', 'dinilai_oleh', 'dinilai_pada', 'percobaan'] },
  ForumDiskusi:      { key: 'diskusi_id', prefix: 'FDS', cols: ['diskusi_id', 'modul_id', 'kursus_id', 'judul', 'user_id', 'grup_id', 'disematkan', 'terkunci', 'dibuat_pada', 'terakhir_pada', 'jml_balasan'] },
  ForumPost:         { key: 'post_id', prefix: 'FPS', cols: ['post_id', 'diskusi_id', 'modul_id', 'kursus_id', 'induk_id', 'user_id', 'isi', 'berkas', 'nilai', 'dinilai_oleh', 'dibuat_pada', 'diedit_pada', 'dihapus'] },
  WikiHalaman:       { key: 'halaman_id', prefix: 'WKH', cols: ['halaman_id', 'modul_id', 'kursus_id', 'grup_id', 'pemilik', 'judul', 'isi', 'versi', 'diedit_oleh', 'diedit_pada', 'dibuat_pada'] },
  WikiRiwayat:       { key: 'riwayat_id', prefix: 'WKR', cols: ['riwayat_id', 'halaman_id', 'modul_id', 'kursus_id', 'versi', 'isi', 'oleh', 'waktu'] },
  GlosariumEntri:    { key: 'entri_id', prefix: 'GLS', cols: ['entri_id', 'modul_id', 'kursus_id', 'istilah', 'alias', 'definisi', 'user_id', 'status', 'dibuat_pada', 'diperbarui_pada'] },
  WorkshopKirim:     { key: 'kirim_id', prefix: 'WSK', cols: ['kirim_id', 'modul_id', 'kursus_id', 'user_id', 'judul', 'isi', 'berkas', 'dikirim_pada', 'nilai_kirim', 'nilai_menilai', 'nilai_akhir'] },
  WorkshopNilai:     { key: 'penilaian_id', prefix: 'WSN', cols: ['penilaian_id', 'modul_id', 'kursus_id', 'kirim_id', 'penilai_id', 'skor', 'komentar', 'total', 'waktu'] },
  LessonProgres:     { key: 'progres_id', prefix: 'LSP', cols: ['progres_id', 'modul_id', 'kursus_id', 'user_id', 'percobaan', 'state', 'nilai', 'selesai', 'mulai', 'diperbarui_pada'] },
  UmpanBalikJawaban: { key: 'jawaban_id', prefix: 'UBJ', cols: ['jawaban_id', 'modul_id', 'kursus_id', 'responden', 'nama', 'jawaban', 'waktu'] },
  KelasVirtualHadir: { key: 'hadir_id', prefix: 'KVH', cols: ['hadir_id', 'modul_id', 'kursus_id', 'user_id', 'peran', 'waktu'] }
});
['BankSoal', 'KuisPercobaan', 'TugasKirim', 'ForumDiskusi', 'ForumPost', 'WikiHalaman', 'WikiRiwayat', 'GlosariumEntri', 'WorkshopKirim', 'WorkshopNilai', 'LessonProgres', 'UmpanBalikJawaban', 'KelasVirtualHadir']
  .forEach(function (t) { if (t !== 'BankSoal' && LMS_TABEL_ANAK.indexOf(t) === -1) LMS_TABEL_ANAK.push(t); });

/** Rahasia platform kelas virtual — tampil otomatis di menu Keamanan (tersimpan di Script Properties) */
var KV_RAHASIA = {
  ZOOM_ACCOUNT_ID:    { label: 'Zoom — Account ID (Server-to-Server OAuth)', pola: /^[A-Za-z0-9_-]{6,80}$/, pesan: 'Account ID Zoom tidak valid.' },
  ZOOM_CLIENT_ID:     { label: 'Zoom — Client ID', pola: /^[A-Za-z0-9_-]{6,80}$/, pesan: 'Client ID Zoom tidak valid.' },
  ZOOM_CLIENT_SECRET: { label: 'Zoom — Client Secret', pola: /^[^\s]{8,200}$/, pesan: 'Client Secret Zoom tidak valid.' },
  BBB_URL:            { label: 'BigBlueButton — URL API (…/bigbluebutton/)', pola: /^https:\/\/[^\s]+\/bigbluebutton\/?$/, pesan: 'URL BBB harus https dan berakhiran /bigbluebutton/' },
  BBB_SECRET:         { label: 'BigBlueButton — Shared Secret', pola: /^[^\s]{16,200}$/, pesan: 'Shared secret BBB tidak valid.' }
};
EXT.reset.push(function () { if (typeof RAHASIA_DASHBOARD !== 'undefined') Object.keys(KV_RAHASIA).forEach(function (k) { if (!RAHASIA_DASHBOARD[k]) RAHASIA_DASHBOARD[k] = KV_RAHASIA[k]; }); });

// ---------------------------------------------------------------------
// 0. UTILITAS BERSAMA
// ---------------------------------------------------------------------
function aktAkses_(ctx, mid, tipe, butuh) {
  var a = lmsAksesModul_(ctx, mid, butuh);
  if (a.err) return a;
  if (tipe && a.m.tipe !== tipe) return { err: fail_('Jenis aktivitas tidak sesuai.') };
  return a;
}
function aktMs_(t) { return t ? new Date(String(t).length === 16 ? t + ':00+07:00' : t).getTime() : 0; }
function aktCatatNilai_(a, uid, nilai, sumber) { if (typeof nilaiCatat_ === 'function') nilaiCatat_(a.m.kursus_id, a.m.modul_id, uid, nilai, num_(a.m.nilai_maks, 100) || 100, sumber || 'otomatis'); }
function aktSpam_(ctx, teks, jenis) { return typeof spamCek_ === 'function' ? spamCek_(ctx, teks, jenis) : ''; }
function aktUnggah_(list, maks, awalan) {
  var out = [];
  (list || []).slice(0, maks || 5).forEach(function (b) { var x = lmsSimpanBerkas_(b, awalan); if (x) out.push(x); });
  return out;
}
function aktNotif_(rows) { if (typeof notifApp_ === 'function' && rows.length) notifApp_(rows); }
function aktSemuaGrup_(a) { return a.kelola || (a.m.mode_grup || a.s.kursus.mode_grup) !== 'terpisah'; }
function aktModeGrup_(a) { return a.m.mode_grup || a.s.kursus.mode_grup || 'tanpa'; }

// =====================================================================
// 1. KUIS
// =====================================================================
var SOAL_TIPE = { pg: 'Pilihan ganda', pgk: 'Pilihan ganda kompleks', bs: 'Benar / Salah', cocok: 'Mencocokkan', singkat: 'Jawaban singkat', esai: 'Esai', dragdrop: 'Seret & lepas ke teks' };

/** Validasi data soal → {data} atau {err} */
function soalNorm_(tipe, x) {
  x = x || {};
  switch (tipe) {
    case 'pg': case 'pgk': {
      var opsi = (x.opsi || []).filter(function (o) { return String(o.teks || '').trim(); }).slice(0, 10).map(function (o, i) { return { id: o.id || ('o' + (i + 1)), teks: lmsTeks_(o.teks, 1000), benar: !!o.benar, umpan: lmsTeks_(o.umpan, 500) }; });
      if (opsi.length < 2) return { err: 'Minimal 2 pilihan jawaban.' };
      var nb = opsi.filter(function (o) { return o.benar; }).length;
      if (tipe === 'pg' && nb !== 1) return { err: 'Pilihan ganda harus memiliki tepat 1 jawaban benar.' };
      if (tipe === 'pgk' && nb < 1) return { err: 'Tandai minimal 1 jawaban benar.' };
      return { data: { opsi: opsi } };
    }
    case 'bs': return { data: { benar: x.benar === true || x.benar === 'benar' || x.benar === 'true' } };
    case 'cocok': {
      var p = (x.pasangan || []).filter(function (o) { return String(o.kiri || '').trim() && String(o.kanan || '').trim(); }).slice(0, 12).map(function (o) { return { kiri: lmsTeks_(o.kiri, 300), kanan: lmsTeks_(o.kanan, 300) }; });
      if (p.length < 2) return { err: 'Minimal 2 pasangan.' };
      return { data: { pasangan: p, pengecoh: (x.pengecoh || []).map(function (s) { return lmsTeks_(s, 300); }).filter(String).slice(0, 6) } };
    }
    case 'singkat': {
      var j = (x.jawaban || []).filter(function (o) { return String(o.teks || '').trim(); }).slice(0, 10).map(function (o) { return { teks: lmsTeks_(o.teks, 200), nilai: Math.max(0, Math.min(100, num_(o.nilai, 100))) }; });
      if (!j.length) return { err: 'Isi minimal 1 jawaban yang diterima.' };
      return { data: { jawaban: j, toleransi: Math.max(0, num_(x.toleransi)), huruf_besar: !!x.huruf_besar } };
    }
    case 'esai': return { data: { panduan: lmsTeks_(x.panduan, 3000), min_kata: Math.max(0, num_(x.min_kata)) } };
    case 'dragdrop': {
      var teks = lmsTeks_(x.teks, 3000), pil = (x.pilihan || []).map(function (s) { return lmsTeks_(s, 120); }).filter(String).slice(0, 20);
      var gaps = (teks.match(/\[\[(\d+)\]\]/g) || []).map(function (g) { return Number(g.replace(/\D/g, '')); });
      if (!gaps.length) return { err: 'Tulis teks dengan tempat kosong [[1]], [[2]] … yang merujuk nomor pilihan benar.' };
      if (gaps.some(function (n) { return n < 1 || n > pil.length; })) return { err: 'Nomor di dalam [[ ]] harus merujuk ke nomor pilihan yang ada.' };
      return { data: { teks: teks, pilihan: pil } };
    }
  }
  return { err: 'Tipe soal tidak dikenal.' };
}
function apiSoalList(ctx, d) {
  var uid = ctx.session.uid, sa = ctx.session.role === 'superadmin', kelola = {};
  DB.all('Kursus').forEach(function (k) { if (sa || lmsIds_(k.pengajar).indexOf(uid) > -1) kelola[k.kursus_id] = k.nama; });
  var rows = DB.all('BankSoal').filter(function (q) { return (sa || q.pemilik === uid || kelola[q.kursus_id]) && (!d.kursus_id || q.kursus_id === d.kursus_id || (!q.kursus_id && q.pemilik === uid)); });
  var dipakai = {};
  DB.all('KursusModul').forEach(function (m) { if (m.tipe === 'kuis') (lmsJson_(m.konten, {}).soal || []).forEach(function (s) { dipakai[s.soal_id] = (dipakai[s.soal_id] || 0) + 1; }); });
  return ok_({ soal: rows.map(function (q) { return { soal_id: q.soal_id, kursus_id: q.kursus_id, kursus: kelola[q.kursus_id] || '', kategori: q.kategori, tipe: q.tipe, teks: q.teks, data: lmsJson_(q.data, {}), skor: num_(q.skor, 1), umpan_balik: q.umpan_balik, milikSaya: q.pemilik === uid, dipakai: dipakai[q.soal_id] || 0, diperbarui_pada: q.diperbarui_pada }; }),
    tipe: SOAL_TIPE, kategori: Object.keys(rows.reduce(function (o, q) { if (q.kategori) o[q.kategori] = 1; return o; }, {})).sort() });
}
function apiSoalSave(ctx, d) {
  var list = d.soal ? (Array.isArray(d.soal) ? d.soal : [d.soal]) : [];
  if (!list.length || list.length > 200) return fail_('Kirim 1–200 soal.');
  var uid = ctx.session.uid, now = nowIso_(), ins = [], upd = [];
  for (var i = 0; i < list.length; i++) {
    var q = list[i], tipe = SOAL_TIPE[q.tipe] ? q.tipe : '';
    if (!tipe) return fail_('Soal #' + (i + 1) + ': pilih tipe soal.');
    var teks = lmsTeks_(q.teks, 8000).trim();
    if (!teks && tipe !== 'dragdrop') return fail_('Soal #' + (i + 1) + ': teks pertanyaan kosong.');
    var n = soalNorm_(tipe, q.data); if (n.err) return fail_('Soal #' + (i + 1) + ': ' + n.err);
    if (q.kursus_id) { var ak = lmsAkses_(ctx, q.kursus_id, 'kelola'); if (ak.err) return ak.err; }
    var row = { kursus_id: lmsTeks_(q.kursus_id, 20), kategori: lmsTeks_(q.kategori, 80), tipe: tipe, teks: teks || '(isi bagian yang kosong)', data: JSON.stringify(n.data), skor: Math.max(0.5, num_(q.skor, 1)), umpan_balik: lmsTeks_(q.umpan_balik, 2000), diperbarui_pada: now };
    if (q.soal_id) {
      var lama = DB.find('BankSoal', 'soal_id', q.soal_id);
      if (!lama) return fail_('Soal ' + q.soal_id + ' tidak ditemukan.');
      if (lama.pemilik !== uid && ctx.session.role !== 'superadmin' && !(lama.kursus_id && !lmsAkses_(ctx, lama.kursus_id, 'kelola').err)) return fail_('Anda tidak dapat mengubah soal milik guru lain.');
      row.soal_id = q.soal_id; upd.push(row);
    } else { row.pemilik = uid; row.dibuat_pada = now; ins.push(row); }
  }
  if (ins.length) { var ids = reserveIds_('BankSoal', ins.length); ins.forEach(function (r, x) { r.soal_id = ids[x]; }); DB.appendBatch('BankSoal', ins); }
  DB.updateBatch('BankSoal', 'soal_id', upd);
  return ok_({ ids: ins.concat(upd).map(function (r) { return r.soal_id; }) }, (ins.length ? ins.length + ' soal baru' : '') + (ins.length && upd.length ? ', ' : '') + (upd.length ? upd.length + ' soal diperbarui' : '') + ' di bank soal.');
}
function apiSoalHapus(ctx, d) {
  var ids = lmsIds_(d.ids || d.soal_id), uid = ctx.session.uid, sa = ctx.session.role === 'superadmin';
  var boleh = DB.all('BankSoal').filter(function (q) { return ids.indexOf(q.soal_id) > -1 && (sa || q.pemilik === uid); }).map(function (q) { return q.soal_id; });
  if (!boleh.length) return fail_('Tidak ada soal milik Anda yang dipilih.');
  DB.deleteWhere('BankSoal', 'soal_id', boleh);
  return ok_(null, boleh.length + ' soal dihapus dari bank. Kuis yang memakainya akan melewati soal tersebut.');
}

/** Tampilan soal untuk siswa (tanpa kunci jawaban) */
function soalTampil_(q, urut, skor) {
  var d = lmsJson_(q.data, {}), v = { id: q.soal_id, tipe: q.tipe, teks: q.teks, skor: skor };
  if (q.tipe === 'pg' || q.tipe === 'pgk') {
    var byId = {}; d.opsi.forEach(function (o) { byId[o.id] = o; });
    v.opsi = (urut || d.opsi.map(function (o) { return o.id; })).map(function (id) { return byId[id] ? { id: id, teks: byId[id].teks } : null; }).filter(Boolean);
    v.multi = q.tipe === 'pgk';
  } else if (q.tipe === 'cocok') {
    var kanan = d.pasangan.map(function (p, i) { return { id: 'k' + i, teks: p.kanan }; }).concat((d.pengecoh || []).map(function (t, i) { return { id: 'x' + i, teks: t }; }));
    var bk = {}; kanan.forEach(function (k) { bk[k.id] = k; });
    v.kiri = d.pasangan.map(function (p) { return p.kiri; });
    v.kanan = (urut || kanan.map(function (k) { return k.id; })).map(function (id) { return bk[id]; }).filter(Boolean);
  } else if (q.tipe === 'dragdrop') {
    v.bagian = String(d.teks).split(/(\[\[\d+\]\])/).map(function (p, i) { var m = p.match(/^\[\[(\d+)\]\]$/); return m ? { gap: 'g' + i } : { t: p }; });
    var pl = d.pilihan.map(function (t, i) { return { id: 'p' + (i + 1), teks: t }; }), bp = {}; pl.forEach(function (p) { bp[p.id] = p; });
    v.pilihan = (urut || pl.map(function (p) { return p.id; })).map(function (id) { return bp[id]; }).filter(Boolean);
  } else if (q.tipe === 'esai') v.min_kata = d.min_kata || 0;
  return v;
}
function soalUrutAcak_(q, acak) {
  var d = lmsJson_(q.data, {});
  if (q.tipe === 'pg' || q.tipe === 'pgk') { var ids = d.opsi.map(function (o) { return o.id; }); return acak ? lmsAcak_(ids) : ids; }
  if (q.tipe === 'cocok') return lmsAcak_(d.pasangan.map(function (p, i) { return 'k' + i; }).concat((d.pengecoh || []).map(function (t, i) { return 'x' + i; })));
  if (q.tipe === 'dragdrop') return lmsAcak_(d.pilihan.map(function (t, i) { return 'p' + (i + 1); }));
  return null;
}
function normJawab_(s, besar) { s = String(s == null ? '' : s).trim().replace(/\s+/g, ' '); return besar ? s : s.toLowerCase(); }
/** Nilai satu soal → {skor, maks, benar: true|false|null(manual), kunci} */
function soalNilai_(q, jwb, maks) {
  var d = lmsJson_(q.data, {}), out = { skor: 0, maks: maks, benar: false };
  switch (q.tipe) {
    case 'pg': { var o = d.opsi.filter(function (x) { return x.benar; })[0]; out.benar = !!o && jwb === o.id; out.skor = out.benar ? maks : 0; out.kunci = o ? o.id : ''; break; }
    case 'pgk': {
      var pilih = Array.isArray(jwb) ? jwb : [], nb = 0, ns = 0, bd = 0, sd = 0;
      d.opsi.forEach(function (x) { if (x.benar) { nb++; if (pilih.indexOf(x.id) > -1) bd++; } else { ns++; if (pilih.indexOf(x.id) > -1) sd++; } });
      var f = Math.max(0, (nb ? bd / nb : 0) - (ns ? sd / ns : 0));
      out.skor = round1_(f * maks); out.benar = f >= 0.999; out.kunci = d.opsi.filter(function (x) { return x.benar; }).map(function (x) { return x.id; }); break;
    }
    case 'bs': { var v = jwb === true || jwb === 'benar' || jwb === 'true'; out.benar = (jwb !== undefined && jwb !== null && jwb !== '') && v === !!d.benar; out.skor = out.benar ? maks : 0; out.kunci = !!d.benar; break; }
    case 'cocok': {
      var map = jwb && typeof jwb === 'object' ? jwb : {}, cocok = 0;
      d.pasangan.forEach(function (p, i) { if (map[i] === 'k' + i || map[String(i)] === 'k' + i) cocok++; });
      out.skor = round1_(cocok / d.pasangan.length * maks); out.benar = cocok === d.pasangan.length;
      out.kunci = d.pasangan.map(function (p, i) { return 'k' + i; }); break;
    }
    case 'singkat': {
      var s = normJawab_(jwb, d.huruf_besar), best = 0;
      if (s) d.jawaban.forEach(function (a) {
        var k = normJawab_(a.teks, d.huruf_besar), ok = false;
        if (d.toleransi && !isNaN(Number(s.replace(',', '.'))) && !isNaN(Number(k.replace(',', '.')))) ok = Math.abs(Number(s.replace(',', '.')) - Number(k.replace(',', '.'))) <= d.toleransi;
        else if (k.indexOf('*') > -1) ok = new RegExp('^' + k.split('*').map(function (p) { return p.replace(/[.+?^${}()|[\]\\]/g, '\\$&'); }).join('.*') + '$').test(s);
        else ok = s === k;
        if (ok) best = Math.max(best, a.nilai);
      });
      out.skor = round1_(best / 100 * maks); out.benar = best >= 100; out.kunci = d.jawaban.filter(function (a) { return a.nilai >= 100; }).map(function (a) { return a.teks; }); break;
    }
    case 'esai': out.benar = null; out.skor = 0; out.manual = true; break;
    case 'dragdrop': {
      var parts = String(d.teks).split(/(\[\[\d+\]\])/), isi = jwb && typeof jwb === 'object' ? jwb : {}, tot = 0, ok2 = 0, kunci = {};
      parts.forEach(function (p, i) { var m = p.match(/^\[\[(\d+)\]\]$/); if (m) { tot++; kunci['g' + i] = 'p' + m[1]; if (isi['g' + i] === 'p' + m[1]) ok2++; } });
      out.skor = tot ? round1_(ok2 / tot * maks) : 0; out.benar = ok2 === tot; out.kunci = kunci; break;
    }
  }
  return out;
}
/** Tiket percobaan kuis: payload ditandatangani HMAC (secret sesi) — server tidak perlu menyimpan apa pun saat siswa mengerjakan */
function kuisTiket_(p) { var body = b64u_(Utilities.newBlob(JSON.stringify(p)).getBytes()); return body + '.' + sign_('K.' + body); }
function kuisBacaTiket_(t) {
  try {
    var parts = String(t || '').split('.');
    if (parts.length !== 2 || !samaAman_(sign_('K.' + parts[0]), parts[1])) return null;
    var b = parts[0]; while (b.length % 4) b += '=';
    return JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(b)).getDataAsString());
  } catch (e) { return null; }
}
function kuisPercobaanUser_(mid, uid) { return DB.filter('KuisPercobaan', function (p) { return p.modul_id === mid && p.user_id === uid; }).sort(function (a, b) { return num_(a.no) - num_(b.no); }); }
function kuisSoalMap_(k) {
  var ids = {}; (k.soal || []).forEach(function (s) { ids[s.soal_id] = s.skor; });
  var map = {}; DB.all('BankSoal').forEach(function (q) { if (ids[q.soal_id] !== undefined) map[q.soal_id] = q; });
  return map;
}
function apiKuisInfo(ctx, d) {
  var a = aktAkses_(ctx, d.modul_id, 'kuis'); if (a.err) return a.err;
  var k = a.konten, now = Date.now(), buka = aktMs_(a.m.buka), tutup = aktMs_(a.m.tutup);
  var out = { modul: lmsModulPublik_(a.m, a.kelola), buka: a.m.buka, tutup: a.m.tutup, sudahBuka: !buka || now >= buka, sudahTutup: !!tutup && now > tutup };
  if (a.kelola) {
    var map = kuisSoalMap_(k);
    out.soal = (k.soal || []).map(function (s) { var q = map[s.soal_id]; return q ? { soal_id: q.soal_id, tipe: q.tipe, teks: q.teks, kategori: q.kategori, skor: s.skor, data: lmsJson_(q.data, {}) } : { soal_id: s.soal_id, hilang: true, skor: s.skor }; });
    out.percobaan = DB.filter('KuisPercobaan', function (p) { return p.modul_id === a.m.modul_id; }).length;
    return ok_(out);
  }
  var cb = kuisPercobaanUser_(a.m.modul_id, a.uid), jalan = CacheService.getScriptCache().get('kj_' + a.m.modul_id + '_' + a.uid);
  out.percobaan = cb.map(function (p) { return kuisRingkas_(p, a, false); });
  out.sisa = num_(k.percobaan_maks) ? Math.max(0, num_(k.percobaan_maks) - cb.length) : null;
  out.berjalan = !!jalan;
  out.nilaiAkhir = a.st.nilai[a.m.modul_id] === undefined ? null : a.st.nilai[a.m.modul_id];
  return ok_(out);
}
function kuisRingkas_(p, a, rinci) {
  var o = { percobaan_id: p.percobaan_id, no: num_(p.no), mulai: p.mulai, selesai: p.selesai, durasi_detik: num_(p.durasi_detik), nilai: p.nilai === '' ? null : num_(p.nilai), nilai_maks: num_(p.nilai_maks), status: p.status, terlambat: p.terlambat === 'YA' };
  o.persen = o.nilai === null || !o.nilai_maks ? null : round1_(o.nilai / o.nilai_maks * 100);
  return o;
}
function kuisBolehLihatJawaban_(a) {
  var tj = a.konten.tampil_jawaban || 'langsung';
  if (a.kelola || tj === 'langsung') return true;
  if (tj === 'setelah_tutup') { var t = aktMs_(a.m.tutup); return !!t && Date.now() > t; }
  return false;
}
function apiKuisMulai(ctx, d) {
  var a = aktAkses_(ctx, d.modul_id, 'kuis'); if (a.err) return a.err;
  var k = a.konten, m = a.m, now = Date.now(), c = CacheService.getScriptCache(), ck = 'kj_' + m.modul_id + '_' + a.uid;
  if (!(k.soal || []).length) return fail_('Kuis belum memiliki soal.');
  if (!a.kelola) {
    if (m.buka && now < aktMs_(m.buka)) return fail_('Kuis belum dibuka. Dibuka ' + String(m.buka).replace('T', ' ') + '.');
    var lanjut = c.get(ck), t0 = lanjut ? kuisBacaTiket_(lanjut) : null;
    if (t0) {
      if (!t0.dl || now < t0.dl + 90000) return kuisResponMulai_(a, lanjut, t0, true);
      withLock_(function () { kuisFinalisasi_(a, t0, lmsJson_(c.get('kw_' + hashKecil_(lanjut)), {}) || {}, true); return ok_(); });   // waktu habis → nilai otomatis jawaban tersimpan
      c.remove(ck);
    }
    if (m.tutup && now > aktMs_(m.tutup)) return fail_('Kuis sudah ditutup.');
    var cb = kuisPercobaanUser_(m.modul_id, a.uid);
    if (num_(k.percobaan_maks) && cb.length >= num_(k.percobaan_maks)) return fail_('Kesempatan mengerjakan sudah habis (' + k.percobaan_maks + '×).');
  }
  var map = kuisSoalMap_(k), daftar = (k.soal || []).filter(function (s) { return map[s.soal_id]; });
  if (!daftar.length) return fail_('Soal kuis tidak ditemukan di bank soal.');
  if (num_(k.ambil_acak) && num_(k.ambil_acak) < daftar.length) daftar = lmsAcak_(daftar).slice(0, num_(k.ambil_acak));
  else if (k.acak_soal) daftar = lmsAcak_(daftar);
  var dl = 0;
  if (num_(k.waktu_menit)) dl = now + num_(k.waktu_menit) * 60000;
  if (m.tutup && !a.kelola) dl = dl ? Math.min(dl, aktMs_(m.tutup)) : aktMs_(m.tutup);
  var p = { m: m.modul_id, u: a.uid, n: a.kelola ? 0 : kuisPercobaanUser_(m.modul_id, a.uid).length + 1, t0: now, dl: dl, pv: a.kelola ? 1 : 0, r: acak_(6),
    q: daftar.map(function (s) { return { i: s.soal_id, s: num_(s.skor, 1), o: soalUrutAcak_(map[s.soal_id], k.acak_opsi !== false) }; }) };
  var tiket = kuisTiket_(p);
  if (!a.kelola) c.put(ck, tiket, Math.min(21600, Math.max(600, Math.ceil(((dl || now + 3 * 3600e3) - now) / 1000) + 900)));
  lmsLog_(ctx, 'aksi', 'kuis:mulai', m.modul_id, 0, m.judul + (a.kelola ? ' (pratinjau)' : ' percobaan ' + p.n));
  return kuisResponMulai_(a, tiket, p, false);
}
function kuisResponMulai_(a, tiket, p, lanjut) {
  var map = kuisSoalMap_(a.konten), simpan = lanjut ? (lmsJson_(CacheService.getScriptCache().get('kw_' + hashKecil_(tiket)), {}) || {}) : {};
  return ok_({ tiket: tiket, no: p.n, mulai: p.t0, batas: p.dl, sekarang: Date.now(), pratinjau: !!p.pv, lanjut: lanjut, jawaban: simpan,
    soal: p.q.map(function (x) { return map[x.i] ? soalTampil_(map[x.i], x.o, x.s) : null; }).filter(Boolean), judul: a.m.judul }, lanjut ? 'Melanjutkan percobaan yang belum selesai.' : 'Selamat mengerjakan!');
}
/** Simpan otomatis jawaban (cache — tanpa kunci & tanpa tulis sheet) */
function apiKuisSimpan(ctx, d) {
  var p = kuisBacaTiket_(d.tiket);
  if (!p || p.u !== ctx.session.uid) return fail_('Tiket kuis tidak sah.');
  if (p.pv) return ok_({ disimpan: false });
  if (p.dl && Date.now() > p.dl + 90000) return fail_('Waktu pengerjaan sudah habis.', { code: 'WAKTU' });
  var s = JSON.stringify(d.jawaban || {});
  if (s.length > 90000) return fail_('Jawaban terlalu panjang.');
  CacheService.getScriptCache().put('kw_' + hashKecil_(d.tiket), s, 21600);
  return ok_({ disimpan: true, sekarang: Date.now() });
}
function kuisFinalisasi_(a, p, jawaban, otomatis) {
  var map = kuisSoalMap_(a.konten), rincian = {}, total = 0, maks = 0, manual = false, now = Date.now();
  p.q.forEach(function (x) {
    var q = map[x.i]; if (!q) return;
    var r = soalNilai_(q, jawaban[x.i], x.s);
    rincian[x.i] = { skor: r.skor, maks: r.maks, benar: r.benar, manual: !!r.manual };
    total += r.skor; maks += r.maks; if (r.manual) manual = true;
  });
  var terlambat = p.dl && now > p.dl + 90000;
  var res = { nilaiRaw: round1_(total), maks: maks, persen: maks ? round1_(total / maks * 100) : 0, manual: manual, rincian: rincian, durasi: Math.round((Math.min(now, p.dl ? p.dl + 90000 : now) - p.t0) / 1000), terlambat: !!terlambat };
  if (p.pv) return res;
  var ada = DB.filter('KuisPercobaan', function (r) { return r.modul_id === p.m && r.user_id === p.u && num_(r.no) === p.n; })[0];
  if (ada) { res.duplikat = true; res.percobaan_id = ada.percobaan_id; return res; }
  var id = reserveIds_('KuisPercobaan', 1)[0];
  DB.appendBatch('KuisPercobaan', [{ percobaan_id: id, modul_id: p.m, kursus_id: a.m.kursus_id, user_id: p.u, no: p.n, mulai: new Date(p.t0).toISOString(), selesai: new Date(now).toISOString(),
    durasi_detik: res.durasi, jawaban: JSON.stringify(jawaban).substring(0, 45000), rincian: JSON.stringify(rincian), nilai: res.nilaiRaw, nilai_maks: maks,
    status: manual ? 'perlu_dinilai' : 'selesai', terlambat: terlambat || otomatis ? 'YA' : 'TIDAK', dinilai_oleh: '', dinilai_pada: '' }]);
  res.percobaan_id = id;
  if (typeof lmsAggBasi_ === 'function') lmsAggBasi_(a.m.kursus_id);   // v3.1: hitungan "perlu dinilai" guru
  kuisPerbaruiNilai_(a, p.u);
  if (typeof lmsTandai_ === 'function') lmsTandai_(a.m.kursus_id, a.m.modul_id, p.u, 'kirim');
  return res;
}
/** Agregasi nilai kuis seorang siswa (metode nilai) → buku nilai + penyelesaian */
function kuisPerbaruiNilai_(a, uid) {
  var cb = kuisPercobaanUser_(a.m.modul_id, uid).filter(function (p) { return p.status === 'selesai'; });
  if (!cb.length) return;
  var pers = cb.map(function (p) { return num_(p.nilai_maks) ? num_(p.nilai) / num_(p.nilai_maks) * 100 : 0; }), metode = a.konten.metode_nilai || 'tertinggi', v;
  if (metode === 'terakhir') v = pers[pers.length - 1];
  else if (metode === 'pertama') v = pers[0];
  else if (metode === 'rata') v = pers.reduce(function (s, x) { return s + x; }, 0) / pers.length;
  else v = Math.max.apply(null, pers);
  var nm = num_(a.m.nilai_maks, 100) || 100;
  aktCatatNilai_(a, uid, round1_(v / 100 * nm));
  if (typeof lmsTandai_ === 'function') lmsTandai_(a.m.kursus_id, a.m.modul_id, uid, 'nilai', round1_(v));
}
function apiKuisKirim(ctx, d) {
  var p = kuisBacaTiket_(d.tiket);
  if (!p || p.u !== ctx.session.uid) return fail_('Tiket kuis tidak sah atau sudah kedaluwarsa.');
  var a = aktAkses_(ctx, p.m, 'kuis'); if (a.err) return a.err;
  var c = CacheService.getScriptCache(), jw = d.jawaban || {};
  if (p.dl && Date.now() > p.dl + 90000) jw = lmsJson_(c.get('kw_' + hashKecil_(d.tiket)), {}) || jw;   // terlambat: pakai jawaban tersimpan terakhir
  var r = kuisFinalisasi_(a, p, jw, false);
  if (!p.pv) { c.remove('kj_' + p.m + '_' + p.u); c.remove('kw_' + hashKecil_(d.tiket)); }
  lmsLog_(ctx, 'aksi', 'kuis:kirim', p.m, r.durasi, a.m.judul + ' nilai ' + r.persen + '%');
  var lihat = kuisBolehLihatJawaban_(a), out = { nilai: r.nilaiRaw, maks: r.maks, persen: r.persen, manual: r.manual, durasi_detik: r.durasi, terlambat: r.terlambat, pratinjau: !!p.pv, duplikat: !!r.duplikat, lihatJawaban: lihat };
  if (lihat) out.ulasan = kuisUlasan_(a, p.q.map(function (x) { return x.i; }), jw, r.rincian, p.q);
  return ok_(out, r.manual ? 'Jawaban terkirim. Soal esai akan dinilai guru.' : 'Jawaban terkirim. Nilai Anda ' + r.persen + '.');
}
function kuisUlasan_(a, ids, jawaban, rincian, qmeta) {
  var map = kuisSoalMap_(a.konten), urut = {}; (qmeta || []).forEach(function (x) { urut[x.i] = x; });
  return ids.map(function (id) {
    var q = map[id]; if (!q) return null;
    var d = lmsJson_(q.data, {}), r = rincian[id] || {}, v = soalTampil_(q, urut[id] ? urut[id].o : null, r.maks);
    v.jawaban = jawaban[id] === undefined ? null : jawaban[id]; v.skorDapat = r.skor; v.benar = r.benar; v.manual = !!r.manual; v.umpan_balik = q.umpan_balik;
    v.kunci = soalNilai_(q, null, 1).kunci;
    if (q.tipe === 'pg' || q.tipe === 'pgk') v.umpanOpsi = d.opsi.reduce(function (o, x) { if (x.umpan) o[x.id] = x.umpan; return o; }, {});
    if (q.tipe === 'esai') { v.panduan = a.kelola ? d.panduan : ''; v.komentar = r.komentar || ''; }
    return v;
  }).filter(Boolean);
}
function apiKuisUlasan(ctx, d) {
  var p0 = DB.find('KuisPercobaan', 'percobaan_id', d.percobaan_id); if (!p0) return fail_('Percobaan tidak ditemukan.');
  var a = aktAkses_(ctx, p0.modul_id, 'kuis'); if (a.err) return a.err;
  if (!a.kelola && p0.user_id !== a.uid) return fail_('Akses ditolak.', { code: 'FORBIDDEN' });
  var out = kuisRingkas_(p0, a); out.nama = lmsNama_(p0.user_id);
  out.lihatJawaban = kuisBolehLihatJawaban_(a);
  var jw = lmsJson_(p0.jawaban, {}) || {}, rin = lmsJson_(p0.rincian, {}) || {};
  if (out.lihatJawaban) out.ulasan = kuisUlasan_(a, Object.keys(rin), jw, rin, null);
  return ok_(out);
}
function apiKuisPercobaanList(ctx, d) {
  var a = aktAkses_(ctx, d.modul_id, 'kuis', 'kelola'); if (a.err) return a.err;
  var rows = DB.filter('KuisPercobaan', function (p) { return p.modul_id === a.m.modul_id; });
  var siswa = lmsSiswa_(a.s), by = {};
  rows.forEach(function (p) { (by[p.user_id] = by[p.user_id] || []).push(kuisRingkas_(p, a)); });
  var statSoal = {};
  rows.forEach(function (p) { var rin = lmsJson_(p.rincian, {}) || {}; Object.keys(rin).forEach(function (id) { var s = statSoal[id] = statSoal[id] || { n: 0, skor: 0, maks: 0, benar: 0 }; s.n++; s.skor += num_(rin[id].skor); s.maks += num_(rin[id].maks); if (rin[id].benar) s.benar++; }); });
  var map = kuisSoalMap_(a.konten), akhir = {};
  if (SCHEMA.NilaiEntri) DB.all('NilaiEntri').forEach(function (n) { if (n.item_ref === a.m.modul_id && n.nilai !== '') akhir[n.user_id] = num_(n.nilai); });
  return ok_({ modul: lmsModulPublik_(a.m, true),
    siswa: siswa.map(function (uid) { var l = (by[uid] || []).sort(function (x, y) { return x.no - y.no; }); return { uid: uid, nama: lmsNama_(uid), percobaan: l, nilai: akhir[uid] === undefined ? null : akhir[uid] }; }),
    perluDinilai: rows.filter(function (p) { return p.status === 'perlu_dinilai'; }).length,
    analisis: Object.keys(statSoal).map(function (id) { var s = statSoal[id], q = map[id]; return { soal_id: id, teks: q ? q.teks : '(soal dihapus)', tipe: q ? q.tipe : '', n: s.n, persenBenar: s.n ? Math.round(s.benar / s.n * 100) : 0, rataSkor: s.maks ? Math.round(s.skor / s.maks * 100) : 0 }; }) });
}
/** Guru menilai soal esai: d.nilai = {soal_id: skor}, d.komentar = {soal_id: teks} */
function apiKuisNilaiEsai(ctx, d) {
  var p0 = DB.find('KuisPercobaan', 'percobaan_id', d.percobaan_id); if (!p0) return fail_('Percobaan tidak ditemukan.');
  var a = aktAkses_(ctx, p0.modul_id, 'kuis', 'kelola'); if (a.err) return a.err;
  var rin = lmsJson_(p0.rincian, {}) || {}, total = 0, maks = 0, masihManual = false;
  Object.keys(rin).forEach(function (id) {
    var r = rin[id];
    if (d.nilai && d.nilai[id] !== undefined && d.nilai[id] !== '') { var v = num_(d.nilai[id]); if (v >= 0 && v <= r.maks) { r.skor = round1_(v); r.manual = false; r.benar = v >= r.maks; r.dinilai = true; } }
    if (d.komentar && d.komentar[id] !== undefined) r.komentar = lmsTeks_(d.komentar[id], 2000);
    if (r.manual) masihManual = true;
    total += num_(r.skor); maks += num_(r.maks);
  });
  DB.updateBatch('KuisPercobaan', 'percobaan_id', [{ percobaan_id: p0.percobaan_id, rincian: JSON.stringify(rin), nilai: round1_(total), status: masihManual ? 'perlu_dinilai' : 'selesai', dinilai_oleh: ctx.session.uid, dinilai_pada: nowIso_() }]);
  if (!masihManual) {
    kuisPerbaruiNilai_(a, p0.user_id);
    aktNotif_([{ user_id: p0.user_id, judul: 'Kuis dinilai', pesan: '"' + a.m.judul + '" sudah dinilai guru: ' + round1_(total) + ' dari ' + maks + '.', tipe: 'success', link: 'aktivitas/' + a.m.modul_id }]);
  }
  return ok_({ nilai: round1_(total), maks: maks, selesai: !masihManual }, masihManual ? 'Tersimpan. Masih ada esai yang belum dinilai.' : 'Penilaian selesai & masuk buku nilai.');
}

// =====================================================================
// 2. TUGAS
// =====================================================================
function tugasKirimanSaya_(a, uid) {
  var kel = !!a.konten.kelompok, g = kel ? lmsGrupUser_(a.s, uid)[0] : null;
  var rows = DB.filter('TugasKirim', function (t) { return t.modul_id === a.m.modul_id && (kel && g ? t.grup_id === g.grup_id : t.user_id === uid); });
  return { row: rows.sort(function (x, y) { return num_(y.percobaan) - num_(x.percobaan); })[0] || null, grup: g };
}
function tugasPublik_(t) {
  if (!t) return null;
  return { kirim_id: t.kirim_id, user_id: t.user_id, nama: lmsNama_(t.user_id), grup_id: t.grup_id, teks: t.teks, berkas: lmsJson_(t.berkas, []) || [], status: t.status, dibuka_pada: t.dibuka_pada,
    dikirim_pada: t.dikirim_pada, terlambat: t.terlambat === 'YA', durasi_detik: num_(t.durasi_detik), nilai: t.nilai === '' ? null : num_(t.nilai), rincian_nilai: lmsJson_(t.rincian_nilai, null),
    umpan_balik: t.umpan_balik, dinilai_oleh: t.dinilai_oleh ? lmsNama_(t.dinilai_oleh) : '', dinilai_pada: t.dinilai_pada, percobaan: num_(t.percobaan, 1) };
}
function tugasRubrik_(a) { var id = a.konten.rubrik_id; if (!id || !SCHEMA.Rubrik) return null; var r = DB.find('Rubrik', 'rubrik_id', id); return r ? { rubrik_id: r.rubrik_id, nama: r.nama, jenis: r.jenis, kriteria: lmsJson_(r.kriteria, []) } : null; }
function apiTugasGet(ctx, d) {
  var a = aktAkses_(ctx, d.modul_id, 'tugas'); if (a.err) return a.err;
  var out = { modul: lmsModulPublik_(a.m, a.kelola), rubrik: tugasRubrik_(a), sekarang: nowIso_() };
  if (a.kelola) return ok_(out);
  var x = tugasKirimanSaya_(a, a.uid);
  if (a.konten.kelompok && !x.grup) out.tanpaGrup = true;
  if (!x.row && !out.tanpaGrup) {                                        // catat waktu pertama dibuka (durasi pengerjaan)
    withLock_(function () {
      var y = tugasKirimanSaya_(a, a.uid); if (y.row) { x = y; return ok_(); }
      DB.appendBatch('TugasKirim', [{ kirim_id: reserveIds_('TugasKirim', 1)[0], modul_id: a.m.modul_id, kursus_id: a.m.kursus_id, user_id: a.uid, grup_id: x.grup ? x.grup.grup_id : '', teks: '', berkas: '[]', status: 'draf', dibuka_pada: nowIso_(), dikirim_pada: '', terlambat: '', durasi_detik: '', nilai: '', rincian_nilai: '', umpan_balik: '', dinilai_oleh: '', dinilai_pada: '', percobaan: 1 }]);
      x = tugasKirimanSaya_(a, a.uid); return ok_();
    });
  }
  out.kiriman = tugasPublik_(x.row);
  out.grup = x.grup ? { grup_id: x.grup.grup_id, nama: x.grup.nama, anggota: lmsIds_(x.grup.anggota).map(lmsNama_) } : null;
  return ok_(out);
}
function apiTugasKirim(ctx, d) {
  var a = aktAkses_(ctx, d.modul_id, 'tugas'); if (a.err) return a.err;
  if (a.kelola) return fail_('Pengiriman tugas hanya untuk siswa.');
  var k = a.konten, m = a.m, now = Date.now();
  if (m.buka && now < aktMs_(m.buka)) return fail_('Pengumpulan belum dibuka.');
  var telat = !!m.tutup && now > aktMs_(m.tutup);
  if (telat && k.terlambat_boleh === false && d.final) return fail_('Batas waktu pengumpulan sudah lewat.');
  var x = tugasKirimanSaya_(a, a.uid);
  if (k.kelompok && !x.grup) return fail_('Tugas kelompok: Anda belum masuk grup mana pun. Hubungi guru.');
  var row = x.row;
  if (row && row.status === 'dinilai') return fail_('Tugas sudah dinilai. Minta guru membuka kembali bila perlu revisi.');
  var teks = lmsTeks_(d.teks, 50000);
  if (k.tipe_kirim === 'berkas' && teks) teks = '';
  var spam = teks ? aktSpam_(ctx, teks, 'tugas') : ''; if (spam) return fail_(spam);
  var berkas = (row ? lmsJson_(row.berkas, []) : []).filter(function (f) { return (d.hapusBerkas || []).indexOf(f.id) === -1; });
  if (k.tipe_kirim !== 'teks') {
    var sisa = num_(k.maks_berkas, 3) - berkas.length;
    if ((d.unggah || []).length > sisa) return fail_('Maksimal ' + k.maks_berkas + ' berkas.');
    try { berkas = berkas.concat(aktUnggah_(d.unggah, sisa, 'tugas_' + a.uid)); } catch (e) { return fail_(e.message); }
  }
  if (d.final) {
    if (k.tipe_kirim === 'teks' && !teks.trim()) return fail_('Isi jawaban teks terlebih dulu.');
    if (k.tipe_kirim === 'berkas' && !berkas.length) return fail_('Unggah minimal 1 berkas.');
    if (k.tipe_kirim === 'keduanya' && !teks.trim() && !berkas.length) return fail_('Isi teks atau unggah berkas.');
  }
  var p = { teks: teks, berkas: JSON.stringify(berkas), user_id: a.uid };
  if (d.final) {
    p.status = 'terkirim'; p.dikirim_pada = nowIso_(); p.terlambat = telat ? 'YA' : 'TIDAK';
    var dibuka = row && row.dibuka_pada ? new Date(row.dibuka_pada).getTime() : now;
    p.durasi_detik = Math.max(0, Math.round((now - dibuka) / 1000));
  }
  if (row) { p.kirim_id = row.kirim_id; DB.updateBatch('TugasKirim', 'kirim_id', [p]); }
  else { p.kirim_id = reserveIds_('TugasKirim', 1)[0]; Object.assign(p, { modul_id: m.modul_id, kursus_id: m.kursus_id, grup_id: x.grup ? x.grup.grup_id : '', status: p.status || 'draf', dibuka_pada: nowIso_(), percobaan: 1 }); DB.appendBatch('TugasKirim', [p]); }
  if (d.final) {
    var anggota = k.kelompok && x.grup ? lmsIds_(x.grup.anggota) : [a.uid];
    anggota.forEach(function (u) { lmsTandai_(m.kursus_id, m.modul_id, u, 'kirim'); });
    aktNotif_(lmsPengajar_(a.s).slice(0, 5).map(function (u) { return { user_id: u, judul: 'Tugas dikumpulkan', pesan: lmsNama_(a.uid) + ' mengumpulkan "' + m.judul + '"' + (telat ? ' (terlambat)' : '') + '.', tipe: 'info', link: 'aktivitas/' + m.modul_id }; }));
    lmsLog_(ctx, 'aksi', 'tugas:kirim', m.modul_id, num_(p.durasi_detik), m.judul);
  }
  var t = DB.find('TugasKirim', 'kirim_id', p.kirim_id);
  return ok_({ kiriman: tugasPublik_(t) }, d.final ? (telat ? 'Tugas terkirim (melewati batas waktu).' : 'Tugas berhasil dikumpulkan.') : 'Draf tersimpan.');
}
function apiTugasList(ctx, d) {
  var a = aktAkses_(ctx, d.modul_id, 'tugas', 'kelola'); if (a.err) return a.err;
  var rows = DB.filter('TugasKirim', function (t) { return t.modul_id === a.m.modul_id; });
  var out = { modul: lmsModulPublik_(a.m, true), rubrik: tugasRubrik_(a) };
  if (a.konten.kelompok) {
    out.kelompok = a.s.grup.map(function (g) { var r = rows.filter(function (t) { return t.grup_id === g.grup_id; }).sort(function (x, y) { return num_(y.percobaan) - num_(x.percobaan); })[0]; return { grup_id: g.grup_id, nama: g.nama, anggota: lmsIds_(g.anggota).map(function (u) { return { uid: u, nama: lmsNama_(u) }; }), kiriman: tugasPublik_(r) }; });
  } else {
    var by = {}; rows.forEach(function (t) { if (!by[t.user_id] || num_(t.percobaan) > num_(by[t.user_id].percobaan)) by[t.user_id] = t; });
    out.siswa = lmsSiswa_(a.s).map(function (uid) { return { uid: uid, nama: lmsNama_(uid), kiriman: tugasPublik_(by[uid]) }; });
  }
  return ok_(out);
}
/** Hitung nilai dari rubrik/panduan: pilih = {kriteria_id: indeks_level | skor} */
function rubrikHitung_(rub, pilih, nilaiMaks) {
  var tot = 0, maks = 0, rinci = {};
  (rub.kriteria || []).forEach(function (kr) {
    if (rub.jenis === 'panduan') { var mx = num_(kr.maks, 10), v = Math.max(0, Math.min(mx, num_(pilih[kr.id]))); tot += v; maks += mx; rinci[kr.id] = { skor: v }; }
    else {
      var lv = kr.level || [], mx2 = lv.reduce(function (m, l) { return Math.max(m, num_(l.skor)); }, 0), idx = pilih[kr.id];
      var l = idx !== undefined && idx !== '' && lv[Number(idx)] ? lv[Number(idx)] : null;
      tot += l ? num_(l.skor) : 0; maks += mx2; rinci[kr.id] = { level: l ? Number(idx) : null, skor: l ? num_(l.skor) : 0 };
    }
  });
  return { nilai: maks ? round1_(tot / maks * nilaiMaks) : 0, skor: tot, maks: maks, rinci: rinci };
}
function apiTugasNilai(ctx, d) {
  var t = DB.find('TugasKirim', 'kirim_id', d.kirim_id); if (!t) return fail_('Kiriman tidak ditemukan.');
  var a = aktAkses_(ctx, t.modul_id, 'tugas', 'kelola'); if (a.err) return a.err;
  var nm = num_(a.m.nilai_maks, 100) || 100;
  if (d.kembalikan) {
    DB.updateBatch('TugasKirim', 'kirim_id', [{ kirim_id: t.kirim_id, status: 'draf', umpan_balik: lmsTeks_(d.umpan_balik, 5000), percobaan: num_(t.percobaan, 1) + 1 }]);
    aktNotif_([{ user_id: t.user_id, judul: 'Tugas perlu revisi', pesan: '"' + a.m.judul + '" dikembalikan guru untuk diperbaiki.', tipe: 'warning', link: 'aktivitas/' + a.m.modul_id }]);
    return ok_(null, 'Tugas dikembalikan untuk revisi.');
  }
  var nilai, rinci = null, rub = tugasRubrik_(a);
  if (rub && d.rubrik) { var h = rubrikHitung_(rub, d.rubrik, nm); nilai = h.nilai; rinci = { rubrik_id: rub.rubrik_id, pilih: d.rubrik, skor: h.skor, maks: h.maks, rinci: h.rinci }; }
  else { if (d.nilai === '' || d.nilai === undefined || isNaN(Number(d.nilai))) return fail_('Isi nilai.'); nilai = Number(d.nilai); }
  if (nilai < 0 || nilai > nm) return fail_('Nilai harus 0–' + nm + '.');
  DB.updateBatch('TugasKirim', 'kirim_id', [{ kirim_id: t.kirim_id, status: 'dinilai', nilai: round1_(nilai), rincian_nilai: rinci ? JSON.stringify(rinci) : '', umpan_balik: lmsTeks_(d.umpan_balik, 5000), dinilai_oleh: ctx.session.uid, dinilai_pada: nowIso_() }]);
  var penerima = t.grup_id ? lmsIds_((a.s.grup.filter(function (g) { return g.grup_id === t.grup_id; })[0] || {}).anggota) : [t.user_id];
  if (!penerima.length) penerima = [t.user_id];
  penerima.forEach(function (u) { aktCatatNilai_(a, u, round1_(nilai), 'tugas'); lmsTandai_(a.m.kursus_id, a.m.modul_id, u, 'nilai', round1_(nilai / nm * 100)); });
  aktNotif_(penerima.map(function (u) { return { user_id: u, judul: 'Tugas dinilai', pesan: '"' + a.m.judul + '": ' + round1_(nilai) + ' / ' + nm + (d.umpan_balik ? ' — ada umpan balik guru.' : '.'), tipe: 'success', link: 'aktivitas/' + a.m.modul_id }; }));
  return ok_({ nilai: round1_(nilai) }, 'Nilai disimpan untuk ' + penerima.length + ' siswa & masuk buku nilai.');
}

// =====================================================================
// 3. FORUM DISKUSI LANJUTAN
// =====================================================================
function forumBolehLihatDiskusi_(a, dk) {
  if (a.kelola || !dk.grup_id || aktModeGrup_(a) !== 'terpisah') return true;
  return a.st.grup.indexOf(dk.grup_id) > -1;
}
function forumSudahPosting_(diskusiId, uid) { return DB.all('ForumPost').some(function (p) { return p.diskusi_id === diskusiId && p.user_id === uid && p.dihapus !== 'YA'; }); }
function forumSatu_(a) {
  var dk = DB.filter('ForumDiskusi', function (x) { return x.modul_id === a.m.modul_id; })[0];
  if (dk) return dk;
  withLock_(function () {
    if (DB.filter('ForumDiskusi', function (x) { return x.modul_id === a.m.modul_id; }).length) return ok_();
    DB.appendBatch('ForumDiskusi', [{ diskusi_id: reserveIds_('ForumDiskusi', 1)[0], modul_id: a.m.modul_id, kursus_id: a.m.kursus_id, judul: a.m.judul, user_id: lmsPengajar_(a.s)[0] || a.uid, grup_id: '', disematkan: 'YA', terkunci: 'TIDAK', dibuat_pada: nowIso_(), terakhir_pada: nowIso_(), jml_balasan: 0 }]);
    return ok_();
  });
  return DB.filter('ForumDiskusi', function (x) { return x.modul_id === a.m.modul_id; })[0];
}
function apiForumList(ctx, d) {
  var a = aktAkses_(ctx, d.modul_id, 'forum'); if (a.err) return a.err;
  var k = a.konten, out = { modul: lmsModulPublik_(a.m, a.kelola), bolehBuat: a.kelola || (k.jenis !== 'berita' && k.jenis !== 'satu'), grupSaya: a.st ? a.st.grup : [], grup: a.s.grup.map(function (g) { return { grup_id: g.grup_id, nama: g.nama }; }) };
  if (k.jenis === 'satu') { var one = forumSatu_(a); out.satu = one ? one.diskusi_id : ''; }
  var posts = DB.filter('ForumPost', function (p) { return p.modul_id === a.m.modul_id && p.dihapus !== 'YA'; }), cnt = {}, last = {};
  posts.forEach(function (p) { cnt[p.diskusi_id] = (cnt[p.diskusi_id] || 0) + 1; if (!last[p.diskusi_id] || p.dibuat_pada > last[p.diskusi_id].dibuat_pada) last[p.diskusi_id] = p; });
  out.diskusi = DB.filter('ForumDiskusi', function (x) { return x.modul_id === a.m.modul_id; }).filter(function (x) { return forumBolehLihatDiskusi_(a, x); })
    .map(function (x) { var l = last[x.diskusi_id]; return { diskusi_id: x.diskusi_id, judul: x.judul, user_id: x.user_id, nama: lmsNama_(x.user_id), grup_id: x.grup_id, disematkan: x.disematkan === 'YA', terkunci: x.terkunci === 'YA', dibuat_pada: x.dibuat_pada, terakhir_pada: l ? l.dibuat_pada : x.dibuat_pada, terakhir_oleh: l ? lmsNama_(l.user_id) : '', jml_post: cnt[x.diskusi_id] || 0 }; })
    .sort(function (x, y) { return (y.disematkan ? 1 : 0) - (x.disematkan ? 1 : 0) || String(y.terakhir_pada).localeCompare(String(x.terakhir_pada)); });
  if (a.kelola && k.dinilai) {
    var per = {}; posts.forEach(function (p) { if (p.nilai !== '') (per[p.user_id] = per[p.user_id] || []).push(num_(p.nilai)); });
    out.nilaiSiswa = Object.keys(per).map(function (u) { return { uid: u, nama: lmsNama_(u), jml: per[u].length, nilai: forumAgregat_(per[u], k.agregasi, num_(a.m.nilai_maks, 100)) }; });
  }
  return ok_(out);
}
function forumAgregat_(arr, cara, maks) {
  if (!arr.length) return null;
  if (cara === 'maks') return Math.max.apply(null, arr);
  if (cara === 'jumlah') return Math.min(maks, arr.reduce(function (s, x) { return s + x; }, 0));
  return round1_(arr.reduce(function (s, x) { return s + x; }, 0) / arr.length);
}
function apiForumDiskusi(ctx, d) {
  var dk = DB.find('ForumDiskusi', 'diskusi_id', d.diskusi_id); if (!dk) return fail_('Diskusi tidak ditemukan.');
  var a = aktAkses_(ctx, dk.modul_id, 'forum'); if (a.err) return a.err;
  if (!forumBolehLihatDiskusi_(a, dk)) return fail_('Diskusi ini khusus grup lain.', { code: 'FORBIDDEN' });
  var k = a.konten, posts = DB.filter('ForumPost', function (p) { return p.diskusi_id === dk.diskusi_id; }).sort(function (x, y) { return String(x.dibuat_pada).localeCompare(String(y.dibuat_pada)); });
  var tersembunyi = k.jenis === 'tanya_jawab' && !a.kelola && !forumSudahPosting_(dk.diskusi_id, a.uid);
  var pertama = posts[0] ? posts[0].post_id : '';
  lmsLog_(ctx, 'aksi', 'forum:baca', dk.diskusi_id, 0, dk.judul);
  return ok_({ diskusi: { diskusi_id: dk.diskusi_id, modul_id: dk.modul_id, judul: dk.judul, terkunci: dk.terkunci === 'YA', disematkan: dk.disematkan === 'YA', nama: lmsNama_(dk.user_id) },
    modul: { modul_id: a.m.modul_id, judul: a.m.judul, jenis: k.jenis, dinilai: !!k.dinilai, nilai_maks: num_(a.m.nilai_maks), lampiran: k.lampiran !== false }, kelola: a.kelola, saya: a.uid,
    tanyaJawabTerkunci: tersembunyi,
    post: posts.filter(function (p) { return !tersembunyi || p.post_id === pertama || p.user_id === a.uid; }).map(function (p) {
      var del = p.dihapus === 'YA';
      return { post_id: p.post_id, induk_id: p.induk_id, user_id: p.user_id, nama: lmsNama_(p.user_id), peran: (userIdx_()[p.user_id] || {}).r || '', isi: del ? '' : p.isi, dihapus: del,
        berkas: del ? [] : (lmsJson_(p.berkas, []) || []), dibuat_pada: p.dibuat_pada, diedit_pada: p.diedit_pada,
        nilai: (a.kelola || p.user_id === a.uid) && p.nilai !== '' ? num_(p.nilai) : null };
    }) });
}
function forumSimpanPost_(ctx, a, dk, induk, isi, unggah) {
  var berkas = [];
  if ((unggah || []).length) { if (a.konten.lampiran === false) throw new Error('Lampiran tidak diizinkan di forum ini.'); berkas = aktUnggah_(unggah, 3, 'forum'); }
  var id = reserveIds_('ForumPost', 1)[0], now = nowIso_();
  DB.appendBatch('ForumPost', [{ post_id: id, diskusi_id: dk.diskusi_id, modul_id: dk.modul_id, kursus_id: dk.kursus_id, induk_id: induk || '', user_id: ctx.session.uid, isi: isi, berkas: JSON.stringify(berkas), nilai: '', dinilai_oleh: '', dibuat_pada: now, diedit_pada: '', dihapus: '' }]);
  DB.updateBatch('ForumDiskusi', 'diskusi_id', [{ diskusi_id: dk.diskusi_id, terakhir_pada: now, jml_balasan: DB.filter('ForumPost', function (p) { return p.diskusi_id === dk.diskusi_id; }).length - 1 }]);
  lmsTandai_(a.m.kursus_id, a.m.modul_id, ctx.session.uid, 'kirim');
  return id;
}
function apiForumBuat(ctx, d) {
  var a = aktAkses_(ctx, d.modul_id, 'forum'); if (a.err) return a.err;
  var k = a.konten;
  if (!a.kelola && (k.jenis === 'berita' || k.jenis === 'satu')) return fail_('Hanya pengajar yang dapat membuat topik di forum ini.');
  var judul = lmsTeks_(d.judul, 200).trim(), isi = lmsTeks_(d.isi, 20000).trim();
  if (!judul || !isi) return fail_('Judul dan isi diskusi wajib diisi.');
  var spam = aktSpam_(ctx, judul + '\n' + isi, 'forum'); if (spam) return fail_(spam);
  var grup = '';
  if (aktModeGrup_(a) !== 'tanpa') { grup = a.kelola ? lmsTeks_(d.grup_id, 20) : (a.st.grup[0] || ''); }
  var did = reserveIds_('ForumDiskusi', 1)[0], now = nowIso_();
  var dk = { diskusi_id: did, modul_id: a.m.modul_id, kursus_id: a.m.kursus_id, judul: judul, user_id: a.uid, grup_id: grup, disematkan: 'TIDAK', terkunci: 'TIDAK', dibuat_pada: now, terakhir_pada: now, jml_balasan: 0 };
  DB.appendBatch('ForumDiskusi', [dk]);
  try { forumSimpanPost_(ctx, a, dk, '', isi, d.unggah); } catch (e) { DB.deleteWhere('ForumDiskusi', 'diskusi_id', [did]); return fail_(e.message); }
  if (k.jenis === 'berita') aktNotif_(lmsSiswa_(a.s).slice(0, 300).map(function (u) { return { user_id: u, judul: 'Pengumuman: ' + a.s.kursus.nama, pesan: judul, tipe: 'info', link: 'aktivitas/' + a.m.modul_id }; }));
  lmsLog_(ctx, 'aksi', 'forum:buat', did, 0, judul);
  return ok_({ diskusi_id: did }, 'Topik diskusi dibuat.');
}
function apiForumBalas(ctx, d) {
  var dk = DB.find('ForumDiskusi', 'diskusi_id', d.diskusi_id); if (!dk) return fail_('Diskusi tidak ditemukan.');
  var a = aktAkses_(ctx, dk.modul_id, 'forum'); if (a.err) return a.err;
  if (!forumBolehLihatDiskusi_(a, dk)) return fail_('Diskusi ini khusus grup lain.', { code: 'FORBIDDEN' });
  if (dk.terkunci === 'YA' && !a.kelola) return fail_('Diskusi sudah dikunci pengajar.');
  if (a.konten.jenis === 'berita' && !a.kelola) return fail_('Forum pengumuman hanya bisa dibalas pengajar.');
  var isi = lmsTeks_(d.isi, 20000).trim(); if (!isi) return fail_('Tulis balasan terlebih dulu.');
  var spam = aktSpam_(ctx, isi, 'forum'); if (spam) return fail_(spam);
  var induk = d.induk_id && DB.find('ForumPost', 'post_id', d.induk_id);
  var id; try { id = forumSimpanPost_(ctx, a, dk, induk ? induk.post_id : '', isi, d.unggah); } catch (e) { return fail_(e.message); }
  var tuju = {}; if (dk.user_id !== a.uid) tuju[dk.user_id] = 1; if (induk && induk.user_id !== a.uid) tuju[induk.user_id] = 1;
  aktNotif_(Object.keys(tuju).map(function (u) { return { user_id: u, judul: 'Balasan baru di forum', pesan: lmsNama_(a.uid) + ' membalas "' + dk.judul + '".', tipe: 'info', link: 'aktivitas/' + dk.modul_id }; }));
  return ok_({ post_id: id }, 'Balasan terkirim.');
}
function apiForumEdit(ctx, d) {
  var p = DB.find('ForumPost', 'post_id', d.post_id); if (!p) return fail_('Postingan tidak ditemukan.');
  var a = aktAkses_(ctx, p.modul_id, 'forum'); if (a.err) return a.err;
  var milik = p.user_id === a.uid;
  if (!milik && !a.kelola) return fail_('Anda hanya dapat mengubah postingan sendiri.');
  if (d.hapus) { DB.updateBatch('ForumPost', 'post_id', [{ post_id: p.post_id, dihapus: 'YA', diedit_pada: nowIso_() }]); return ok_(null, 'Postingan dihapus.'); }
  if (milik && !a.kelola && Date.now() - new Date(p.dibuat_pada).getTime() > 30 * 60000) return fail_('Postingan hanya bisa diubah 30 menit setelah dikirim.');
  var isi = lmsTeks_(d.isi, 20000).trim(); if (!isi) return fail_('Isi tidak boleh kosong.');
  var spam = aktSpam_(ctx, isi, 'forum-edit'); if (spam) return fail_(spam);
  DB.updateBatch('ForumPost', 'post_id', [{ post_id: p.post_id, isi: isi, diedit_pada: nowIso_() }]);
  return ok_(null, 'Postingan diperbarui.');
}
function apiForumKelola(ctx, d) {
  var dk = DB.find('ForumDiskusi', 'diskusi_id', d.diskusi_id); if (!dk) return fail_('Diskusi tidak ditemukan.');
  var a = aktAkses_(ctx, dk.modul_id, 'forum', 'kelola'); if (a.err) return a.err;
  if (d.hapus) { lmsHapusKolom_('ForumPost', 'diskusi_id', dk.diskusi_id); DB.deleteWhere('ForumDiskusi', 'diskusi_id', [dk.diskusi_id]); return ok_(null, 'Diskusi dihapus.'); }
  var p = { diskusi_id: dk.diskusi_id };
  if (d.sematkan !== undefined) p.disematkan = d.sematkan ? 'YA' : 'TIDAK';
  if (d.kunci !== undefined) p.terkunci = d.kunci ? 'YA' : 'TIDAK';
  DB.updateBatch('ForumDiskusi', 'diskusi_id', [p]);
  return ok_(null, 'Diskusi diperbarui.');
}
/** Guru memberi nilai postingan; nilai forum siswa = agregasi (rata/maks/jumlah) → buku nilai */
function apiForumNilai(ctx, d) {
  var p = DB.find('ForumPost', 'post_id', d.post_id); if (!p) return fail_('Postingan tidak ditemukan.');
  var a = aktAkses_(ctx, p.modul_id, 'forum', 'kelola'); if (a.err) return a.err;
  if (!a.konten.dinilai) return fail_('Penilaian belum diaktifkan di pengaturan forum ini.');
  var nm = num_(a.m.nilai_maks, 100) || 100, v = d.nilai === '' || d.nilai === null ? '' : Number(d.nilai);
  if (v !== '' && (isNaN(v) || v < 0 || v > nm)) return fail_('Nilai 0–' + nm + '.');
  DB.updateBatch('ForumPost', 'post_id', [{ post_id: p.post_id, nilai: v === '' ? '' : round1_(v), dinilai_oleh: ctx.session.uid }]);
  var arr = DB.filter('ForumPost', function (x) { return x.modul_id === p.modul_id && x.user_id === p.user_id && x.nilai !== '' && x.dihapus !== 'YA'; }).map(function (x) { return num_(x.nilai); });
  var ag = forumAgregat_(arr, a.konten.agregasi, nm);
  if (ag !== null) { aktCatatNilai_(a, p.user_id, ag, 'forum'); lmsTandai_(a.m.kursus_id, a.m.modul_id, p.user_id, 'nilai', round1_(ag / nm * 100)); }
  return ok_({ nilaiForum: ag }, 'Nilai postingan disimpan. Nilai forum ' + lmsNama_(p.user_id) + ': ' + (ag === null ? '-' : ag));
}

// =====================================================================
// 4. WIKI (catatan kolaboratif berversi)
// =====================================================================
function wikiLingkup_(a, d) {
  var mode = a.konten.mode || 'kolaboratif', mg = aktModeGrup_(a), out = { grup_id: '', pemilik: '' };
  if (mode === 'individu') out.pemilik = a.kelola ? (d.pemilik || a.uid) : a.uid;
  if (mg !== 'tanpa') out.grup_id = a.kelola ? (d.grup_id || '') : (a.st.grup[0] || '');
  return out;
}
function wikiBolehEdit_(a, lk) {
  if (a.kelola) return true;
  if ((a.konten.mode || 'kolaboratif') === 'individu') return lk.pemilik === a.uid;
  if (aktModeGrup_(a) !== 'tanpa' && lk.grup_id && a.st.grup.indexOf(lk.grup_id) === -1) return false;
  return true;
}
function wikiHalaman_(a, lk) { return DB.filter('WikiHalaman', function (h) { return h.modul_id === a.m.modul_id && String(h.grup_id) === String(lk.grup_id) && String(h.pemilik) === String(lk.pemilik); }); }
function apiWikiGet(ctx, d) {
  var a = aktAkses_(ctx, d.modul_id, 'wiki'); if (a.err) return a.err;
  var lk = wikiLingkup_(a, d), semua = wikiHalaman_(a, lk), judul = lmsTeks_(d.judul, 100) || a.konten.halaman_awal || 'Beranda';
  var h = semua.filter(function (x) { return lower_(x.judul) === lower_(judul); })[0];
  var out = { modul: lmsModulPublik_(a.m, a.kelola), lingkup: lk, bolehEdit: wikiBolehEdit_(a, lk), judul: h ? h.judul : judul,
    halaman: h ? { halaman_id: h.halaman_id, judul: h.judul, isi: h.isi, versi: num_(h.versi, 1), diedit_oleh: lmsNama_(h.diedit_oleh), diedit_pada: h.diedit_pada } : null,
    daftar: semua.map(function (x) { return { judul: x.judul, versi: num_(x.versi, 1), diedit_pada: x.diedit_pada }; }).sort(function (x, y) { return x.judul.localeCompare(y.judul); }) };
  if (a.kelola) {
    out.grup = a.s.grup.map(function (g) { return { grup_id: g.grup_id, nama: g.nama }; });
    if ((a.konten.mode || 'kolaboratif') === 'individu') out.siswa = lmsSiswa_(a.s).map(function (u) { return { uid: u, nama: lmsNama_(u) }; });
  }
  return ok_(out);
}
function apiWikiSimpan(ctx, d) {
  var a = aktAkses_(ctx, d.modul_id, 'wiki'); if (a.err) return a.err;
  var lk = wikiLingkup_(a, d);
  if (!wikiBolehEdit_(a, lk)) return fail_('Anda tidak dapat mengubah wiki ini.');
  var judul = lmsTeks_(d.judul, 100).trim(), isi = lmsTeks_(d.isi, 45000);
  if (!judul) return fail_('Judul halaman wajib diisi.');
  var spam = aktSpam_(ctx, isi, 'wiki'); if (spam) return fail_(spam);
  var h = wikiHalaman_(a, lk).filter(function (x) { return lower_(x.judul) === lower_(judul); })[0], now = nowIso_();
  if (h) {
    if (num_(d.versi) !== num_(h.versi, 1)) return fail_('Halaman ini baru saja diubah oleh ' + lmsNama_(h.diedit_oleh) + '. Muat ulang untuk melihat versi terbaru, lalu gabungkan perubahan Anda.', { code: 'KONFLIK', isi: h.isi, versi: num_(h.versi, 1) });
    if (h.isi === isi) return ok_({ versi: num_(h.versi, 1) }, 'Tidak ada perubahan.');
    DB.appendBatch('WikiRiwayat', [{ riwayat_id: reserveIds_('WikiRiwayat', 1)[0], halaman_id: h.halaman_id, modul_id: h.modul_id, kursus_id: h.kursus_id, versi: num_(h.versi, 1), isi: h.isi, oleh: h.diedit_oleh, waktu: h.diedit_pada }]);
    DB.updateBatch('WikiHalaman', 'halaman_id', [{ halaman_id: h.halaman_id, isi: isi, versi: num_(h.versi, 1) + 1, diedit_oleh: a.uid, diedit_pada: now }]);
  } else {
    DB.appendBatch('WikiHalaman', [{ halaman_id: reserveIds_('WikiHalaman', 1)[0], modul_id: a.m.modul_id, kursus_id: a.m.kursus_id, grup_id: lk.grup_id, pemilik: lk.pemilik, judul: judul, isi: isi, versi: 1, diedit_oleh: a.uid, diedit_pada: now, dibuat_pada: now }]);
  }
  lmsTandai_(a.m.kursus_id, a.m.modul_id, a.uid, 'kirim');
  lmsLog_(ctx, 'aksi', 'wiki:simpan', a.m.modul_id, 0, judul);
  return ok_({ versi: h ? num_(h.versi, 1) + 1 : 1 }, 'Halaman wiki disimpan.');
}
function apiWikiRiwayat(ctx, d) {
  var h = DB.find('WikiHalaman', 'halaman_id', d.halaman_id); if (!h) return fail_('Halaman tidak ditemukan.');
  var a = aktAkses_(ctx, h.modul_id, 'wiki'); if (a.err) return a.err;
  var lk = { grup_id: h.grup_id, pemilik: h.pemilik };
  if (!a.kelola && ((a.konten.mode === 'individu' && h.pemilik !== a.uid) || (aktModeGrup_(a) === 'terpisah' && h.grup_id && a.st.grup.indexOf(h.grup_id) === -1))) return fail_('Akses ditolak.', { code: 'FORBIDDEN' });
  var rows = DB.filter('WikiRiwayat', function (r) { return r.halaman_id === h.halaman_id; }).sort(function (x, y) { return num_(y.versi) - num_(x.versi); });
  return ok_({ halaman: { halaman_id: h.halaman_id, judul: h.judul, versi: num_(h.versi, 1), isi: h.isi, oleh: lmsNama_(h.diedit_oleh), waktu: h.diedit_pada }, bolehEdit: wikiBolehEdit_(a, lk),
    riwayat: rows.map(function (r) { return { versi: num_(r.versi), isi: r.isi, oleh: lmsNama_(r.oleh), waktu: r.waktu }; }) });
}
function apiWikiPulihkan(ctx, d) {
  var h = DB.find('WikiHalaman', 'halaman_id', d.halaman_id); if (!h) return fail_('Halaman tidak ditemukan.');
  var a = aktAkses_(ctx, h.modul_id, 'wiki'); if (a.err) return a.err;
  if (!wikiBolehEdit_(a, { grup_id: h.grup_id, pemilik: h.pemilik })) return fail_('Anda tidak dapat mengubah wiki ini.');
  var r = DB.filter('WikiRiwayat', function (x) { return x.halaman_id === h.halaman_id && num_(x.versi) === num_(d.versi); })[0];
  if (!r) return fail_('Versi tidak ditemukan.');
  return apiWikiSimpan(ctx, { modul_id: h.modul_id, judul: h.judul, isi: r.isi, versi: num_(h.versi, 1), grup_id: h.grup_id, pemilik: h.pemilik });
}

// =====================================================================
// 5. GLOSARIUM (kamus istilah kelas)
// =====================================================================
function glosPublik_(e) { return { entri_id: e.entri_id, istilah: e.istilah, alias: e.alias, definisi: e.definisi, user_id: e.user_id, nama: lmsNama_(e.user_id), status: e.status, dibuat_pada: e.dibuat_pada }; }
function apiGlosList(ctx, d) {
  var a = aktAkses_(ctx, d.modul_id, 'glosarium'); if (a.err) return a.err;
  var q = lower_(d.cari || ''), huruf = String(d.huruf || '').toUpperCase();
  var rows = DB.filter('GlosariumEntri', function (e) { return e.modul_id === a.m.modul_id && (a.kelola || e.status === 'Disetujui' || e.user_id === a.uid); })
    .filter(function (e) { return !q || lower_(e.istilah + ' ' + e.alias + ' ' + e.definisi).indexOf(q) > -1; })
    .filter(function (e) { return !huruf || String(e.istilah).trim().charAt(0).toUpperCase() === huruf; })
    .sort(function (x, y) { return String(x.istilah).localeCompare(String(y.istilah), 'id'); });
  return ok_({ modul: lmsModulPublik_(a.m, a.kelola), kelola: a.kelola, bolehTambah: a.kelola || a.konten.siswa_boleh !== false, entri: rows.map(function (e) { var o = glosPublik_(e); o.milik = e.user_id === a.uid; return o; }),
    menunggu: a.kelola ? rows.filter(function (e) { return e.status === 'Menunggu'; }).length : 0 });
}
function apiGlosSimpan(ctx, d) {
  var a = aktAkses_(ctx, d.modul_id, 'glosarium'); if (a.err) return a.err;
  if (!a.kelola && a.konten.siswa_boleh === false) return fail_('Hanya pengajar yang dapat menambah istilah.');
  var istilah = lmsTeks_(d.istilah, 120).trim(), def = lmsTeks_(d.definisi, 8000).trim();
  if (!istilah || !def) return fail_('Istilah dan definisi wajib diisi.');
  var spam = aktSpam_(ctx, istilah + ' ' + def, 'glosarium'); if (spam) return fail_(spam);
  var lama = d.entri_id ? DB.find('GlosariumEntri', 'entri_id', d.entri_id) : null;
  if (lama && lama.user_id !== a.uid && !a.kelola) return fail_('Anda hanya dapat mengubah entri sendiri.');
  var dup = DB.filter('GlosariumEntri', function (e) { return e.modul_id === a.m.modul_id && lower_(e.istilah) === lower_(istilah) && (!lama || e.entri_id !== lama.entri_id); })[0];
  if (dup) return fail_('Istilah "' + istilah + '" sudah ada di glosarium.');
  var status = a.kelola || !a.konten.persetujuan ? 'Disetujui' : 'Menunggu', now = nowIso_();
  if (lama) DB.updateBatch('GlosariumEntri', 'entri_id', [{ entri_id: lama.entri_id, istilah: istilah, alias: lmsTeks_(d.alias, 200), definisi: def, status: a.kelola ? lama.status : status, diperbarui_pada: now }]);
  else DB.appendBatch('GlosariumEntri', [{ entri_id: reserveIds_('GlosariumEntri', 1)[0], modul_id: a.m.modul_id, kursus_id: a.m.kursus_id, istilah: istilah, alias: lmsTeks_(d.alias, 200), definisi: def, user_id: a.uid, status: status, dibuat_pada: now, diperbarui_pada: now }]);
  if (!lama) lmsTandai_(a.m.kursus_id, a.m.modul_id, a.uid, 'kirim');
  return ok_(null, status === 'Menunggu' ? 'Istilah dikirim & menunggu persetujuan guru.' : 'Istilah disimpan di glosarium.');
}
function apiGlosKelola(ctx, d) {
  var e = DB.find('GlosariumEntri', 'entri_id', d.entri_id); if (!e) return fail_('Entri tidak ditemukan.');
  var a = aktAkses_(ctx, e.modul_id, 'glosarium'); if (a.err) return a.err;
  if (d.hapus) { if (e.user_id !== a.uid && !a.kelola) return fail_('Akses ditolak.'); DB.deleteWhere('GlosariumEntri', 'entri_id', [e.entri_id]); return ok_(null, 'Entri dihapus.'); }
  if (!a.kelola) return fail_('Hanya pengajar yang dapat menyetujui entri.');
  DB.updateBatch('GlosariumEntri', 'entri_id', [{ entri_id: e.entri_id, status: d.setuju === false ? 'Menunggu' : 'Disetujui' }]);
  if (d.setuju !== false) aktNotif_([{ user_id: e.user_id, judul: 'Istilah disetujui', pesan: '"' + e.istilah + '" kini tampil di glosarium kelas.', tipe: 'success', link: 'aktivitas/' + e.modul_id }]);
  return ok_(null, d.setuju === false ? 'Entri dikembalikan ke status menunggu.' : 'Entri disetujui.');
}

// =====================================================================
// 6. WORKSHOP (penilaian sejawat)
// =====================================================================
var WS_FASE = ['penyiapan', 'pengiriman', 'penilaian', 'evaluasi', 'selesai'];
function wsAlokasi_(kiriman, n) {
  // setiap kiriman mendapat n penilai berbeda (bukan pemilik), beban merata
  var penulis = kiriman.map(function (k) { return k.user_id; }), beban = {}, out = {};
  penulis.forEach(function (u) { beban[u] = 0; });
  lmsAcak_(kiriman).forEach(function (k) {
    var calon = lmsAcak_(penulis.filter(function (u) { return u !== k.user_id; })).sort(function (x, y) { return beban[x] - beban[y]; }).slice(0, Math.min(n, penulis.length - 1));
    calon.forEach(function (u) { beban[u]++; });
    out[k.kirim_id] = calon;
  });
  return out;
}
function wsSimpanKonten_(a, patch) {
  var k = Object.assign({}, a.konten, patch);
  DB.updateBatch('KursusModul', 'modul_id', [{ modul_id: a.m.modul_id, konten: JSON.stringify(k), diperbarui_pada: nowIso_() }]);
  lmsSegarkan_(); a.konten = k;
}
function apiWsGet(ctx, d) {
  var a = aktAkses_(ctx, d.modul_id, 'workshop'); if (a.err) return a.err;
  var k = a.konten, kir = DB.filter('WorkshopKirim', function (x) { return x.modul_id === a.m.modul_id; }), nil = DB.filter('WorkshopNilai', function (x) { return x.modul_id === a.m.modul_id; });
  var out = { modul: lmsModulPublik_(a.m, a.kelola), fase: k.fase || 'penyiapan', kriteria: k.kriteria || [], petunjuk_kirim: k.petunjuk_kirim, petunjuk_nilai: k.petunjuk_nilai, bobot_kirim: k.bobot_kirim, bobot_menilai: k.bobot_menilai };
  var alok = k.alokasi || {};
  if (a.kelola) {
    out.kiriman = kir.map(function (x) {
      var pn = nil.filter(function (n) { return n.kirim_id === x.kirim_id; });
      return { kirim_id: x.kirim_id, uid: x.user_id, nama: lmsNama_(x.user_id), judul: x.judul, isi: x.isi, berkas: lmsJson_(x.berkas, []), dikirim_pada: x.dikirim_pada,
        penilai: (alok[x.kirim_id] || []).map(function (u) { var z = pn.filter(function (n) { return n.penilai_id === u; })[0]; return { uid: u, nama: lmsNama_(u), total: z ? num_(z.total) : null }; }),
        penilaianGuru: (pn.filter(function (n) { return n.penilai_id === a.uid; })[0] || {}).total || null, rata: pn.length ? round1_(pn.reduce(function (s, n) { return s + num_(n.total); }, 0) / pn.length) : null,
        nilai_kirim: x.nilai_kirim === '' ? null : num_(x.nilai_kirim), nilai_menilai: x.nilai_menilai === '' ? null : num_(x.nilai_menilai), nilai_akhir: x.nilai_akhir === '' ? null : num_(x.nilai_akhir) };
    });
    out.jml_siswa = lmsSiswa_(a.s).length;
    return ok_(out);
  }
  var mine = kir.filter(function (x) { return x.user_id === a.uid; })[0];
  out.kirimanSaya = mine ? { kirim_id: mine.kirim_id, judul: mine.judul, isi: mine.isi, berkas: lmsJson_(mine.berkas, []), dikirim_pada: mine.dikirim_pada, nilai_kirim: mine.nilai_kirim === '' ? null : num_(mine.nilai_kirim), nilai_menilai: mine.nilai_menilai === '' ? null : num_(mine.nilai_menilai), nilai_akhir: mine.nilai_akhir === '' ? null : num_(mine.nilai_akhir) } : null;
  var no = 0;
  out.tugasNilai = Object.keys(alok).filter(function (kid) { return alok[kid].indexOf(a.uid) > -1; }).map(function (kid) {
    var x = kir.filter(function (y) { return y.kirim_id === kid; })[0]; if (!x) return null;
    var z = nil.filter(function (n) { return n.kirim_id === kid && n.penilai_id === a.uid; })[0];
    return { kirim_id: kid, label: 'Karya #' + (++no), judul: x.judul, isi: x.isi, berkas: lmsJson_(x.berkas, []), sudah: !!z, skor: z ? lmsJson_(z.skor, {}) : {}, komentar: z ? z.komentar : '' };
  }).filter(Boolean);
  if (mine && (out.fase === 'evaluasi' || out.fase === 'selesai')) {
    out.diterima = nil.filter(function (n) { return n.kirim_id === mine.kirim_id; }).map(function (n, i) { return { label: n.penilai_id === a.uid ? 'Penilaian diri' : (lmsPengajar_(a.s).indexOf(n.penilai_id) > -1 ? 'Guru' : 'Teman #' + (i + 1)), skor: lmsJson_(n.skor, {}), komentar: n.komentar, total: num_(n.total) }; });
  }
  return ok_(out);
}
function apiWsKirim(ctx, d) {
  var a = aktAkses_(ctx, d.modul_id, 'workshop'); if (a.err) return a.err;
  if (a.kelola) return fail_('Pengiriman karya hanya untuk siswa.');
  if ((a.konten.fase || 'penyiapan') !== 'pengiriman') return fail_('Workshop sedang tidak dalam fase pengiriman.');
  var judul = lmsTeks_(d.judul, 200).trim(), isi = lmsTeks_(d.isi, 30000);
  if (!judul) return fail_('Judul karya wajib diisi.');
  var spam = aktSpam_(ctx, isi, 'workshop'); if (spam) return fail_(spam);
  var mine = DB.filter('WorkshopKirim', function (x) { return x.modul_id === a.m.modul_id && x.user_id === a.uid; })[0];
  var berkas = (mine ? lmsJson_(mine.berkas, []) : []).filter(function (f) { return (d.hapusBerkas || []).indexOf(f.id) === -1; });
  try { berkas = berkas.concat(aktUnggah_(d.unggah, Math.max(0, 3 - berkas.length), 'workshop')); } catch (e) { return fail_(e.message); }
  if (!isi.trim() && !berkas.length) return fail_('Isi karya atau unggah berkas.');
  var row = { judul: judul, isi: isi, berkas: JSON.stringify(berkas), dikirim_pada: nowIso_() };
  if (mine) { row.kirim_id = mine.kirim_id; DB.updateBatch('WorkshopKirim', 'kirim_id', [row]); }
  else { Object.assign(row, { kirim_id: reserveIds_('WorkshopKirim', 1)[0], modul_id: a.m.modul_id, kursus_id: a.m.kursus_id, user_id: a.uid, nilai_kirim: '', nilai_menilai: '', nilai_akhir: '' }); DB.appendBatch('WorkshopKirim', [row]); }
  lmsTandai_(a.m.kursus_id, a.m.modul_id, a.uid, 'kirim');
  return ok_(null, 'Karya terkirim. Anda dapat memperbaruinya selama fase pengiriman.');
}
function apiWsNilai(ctx, d) {
  var x = DB.find('WorkshopKirim', 'kirim_id', d.kirim_id); if (!x) return fail_('Karya tidak ditemukan.');
  var a = aktAkses_(ctx, x.modul_id, 'workshop'); if (a.err) return a.err;
  var fase = a.konten.fase || 'penyiapan', alok = (a.konten.alokasi || {})[x.kirim_id] || [];
  if (!a.kelola) {
    if (fase !== 'penilaian') return fail_('Penilaian sejawat hanya dibuka pada fase penilaian.');
    if (alok.indexOf(a.uid) === -1) return fail_('Karya ini tidak dialokasikan kepada Anda.');
  } else if (fase !== 'penilaian' && fase !== 'evaluasi') return fail_('Guru dapat menilai pada fase penilaian atau evaluasi.');
  var tot = 0, mx = 0, skor = {};
  (a.konten.kriteria || []).forEach(function (kr) { var v = Math.max(0, Math.min(num_(kr.maks), num_((d.skor || {})[kr.id]))); skor[kr.id] = v; tot += v; mx += num_(kr.maks); });
  var persen = mx ? round1_(tot / mx * 100) : 0, ada = DB.filter('WorkshopNilai', function (n) { return n.kirim_id === x.kirim_id && n.penilai_id === a.uid; })[0];
  var row = { skor: JSON.stringify(skor), komentar: lmsTeks_(d.komentar, 3000), total: persen, waktu: nowIso_() };
  if (ada) { row.penilaian_id = ada.penilaian_id; DB.updateBatch('WorkshopNilai', 'penilaian_id', [row]); }
  else { Object.assign(row, { penilaian_id: reserveIds_('WorkshopNilai', 1)[0], modul_id: x.modul_id, kursus_id: x.kursus_id, kirim_id: x.kirim_id, penilai_id: a.uid }); DB.appendBatch('WorkshopNilai', [row]); }
  return ok_({ total: persen }, 'Penilaian tersimpan (' + persen + '%).');
}
/** Hitung nilai workshop: kiriman (rata penilaian, guru berbobot 3) + akurasi menilai */
function wsHitung_(a) {
  var k = a.konten, kir = DB.filter('WorkshopKirim', function (x) { return x.modul_id === a.m.modul_id; }), nil = DB.filter('WorkshopNilai', function (x) { return x.modul_id === a.m.modul_id; });
  var guru = lmsPengajar_(a.s).concat(Object.keys(userIdx_()).filter(function (u) { return userIdx_()[u].r === 'superadmin'; })), rataKir = {};
  kir.forEach(function (x) {
    var pn = nil.filter(function (n) { return n.kirim_id === x.kirim_id; }), s = 0, w = 0;
    pn.forEach(function (n) { var bw = guru.indexOf(n.penilai_id) > -1 ? 3 : 1; s += num_(n.total) * bw; w += bw; });
    rataKir[x.kirim_id] = w ? s / w : null;
  });
  var akurasi = {};
  nil.forEach(function (n) { if (guru.indexOf(n.penilai_id) > -1 || rataKir[n.kirim_id] === null) return; (akurasi[n.penilai_id] = akurasi[n.penilai_id] || []).push(Math.abs(num_(n.total) - rataKir[n.kirim_id])); });
  var alok = k.alokasi || {}, peserta = {};
  kir.forEach(function (x) { peserta[x.user_id] = 1; });
  Object.keys(alok).forEach(function (kid) { alok[kid].forEach(function (u) { peserta[u] = 1; }); });
  var nm = num_(a.m.nilai_maks, 100) || 100, bk = num_(k.bobot_kirim, 80), bn = num_(k.bobot_menilai, 20), upd = [];
  Object.keys(peserta).forEach(function (uid) {
    var x = kir.filter(function (y) { return y.user_id === uid; })[0];
    var nk = x && rataKir[x.kirim_id] !== null ? rataKir[x.kirim_id] * bk / 100 : 0;
    var dev = akurasi[uid], nn = dev && dev.length ? Math.max(0, 100 - 2 * dev.reduce(function (s, v) { return s + v; }, 0) / dev.length) * bn / 100 : 0;
    var akhir = round1_((nk + nn) / 100 * nm);
    if (x) upd.push({ kirim_id: x.kirim_id, nilai_kirim: round1_(nk), nilai_menilai: round1_(nn), nilai_akhir: akhir });
    aktCatatNilai_(a, uid, akhir, 'workshop');
    lmsTandai_(a.m.kursus_id, a.m.modul_id, uid, 'nilai', round1_(akhir / nm * 100));
  });
  DB.updateBatch('WorkshopKirim', 'kirim_id', upd);
  return Object.keys(peserta).length;
}
function apiWsFase(ctx, d) {
  var a = aktAkses_(ctx, d.modul_id, 'workshop', 'kelola'); if (a.err) return a.err;
  var fase = String(d.fase || ''); if (WS_FASE.indexOf(fase) === -1) return fail_('Fase tidak dikenal.');
  var msg = 'Fase workshop: ' + fase + '.';
  if (fase === 'penilaian' && !(a.konten.alokasi && Object.keys(a.konten.alokasi).length && !d.alokasiUlang)) {
    var kir = DB.filter('WorkshopKirim', function (x) { return x.modul_id === a.m.modul_id; });
    if (kir.length < 2) return fail_('Minimal 2 karya terkirim untuk memulai penilaian sejawat.');
    wsSimpanKonten_(a, { fase: fase, alokasi: wsAlokasi_(kir, num_(a.konten.jml_penilai, 2)) });
    msg = 'Penilaian sejawat dimulai — setiap karya mendapat ' + Math.min(num_(a.konten.jml_penilai, 2), kir.length - 1) + ' penilai.';
    var penilai = {}; Object.keys(a.konten.alokasi).forEach(function (kid) { a.konten.alokasi[kid].forEach(function (u) { penilai[u] = 1; }); });
    aktNotif_(Object.keys(penilai).map(function (u) { return { user_id: u, judul: 'Saatnya menilai karya teman', pesan: 'Workshop "' + a.m.judul + '" memasuki fase penilaian.', tipe: 'info', link: 'aktivitas/' + a.m.modul_id }; }));
  } else wsSimpanKonten_(a, { fase: fase });
  if (fase === 'evaluasi' || fase === 'selesai') { var n = wsHitung_(a); msg += ' Nilai ' + n + ' peserta dihitung & masuk buku nilai.'; }
  return ok_({ fase: fase }, msg);
}

// =====================================================================
// 7. PELAJARAN INTERAKTIF (lesson bercabang, dinilai di server)
// =====================================================================
function pelHalTampil_(h, kelola) {
  if (!h) return null;
  var v = { id: h.id, judul: h.judul, tipe: h.tipe, isi: h.isi };
  if (h.tipe === 'soal') v.opsi = h.opsi.map(function (o) { return kelola ? o : { teks: o.teks }; });
  else v.tombol = (h.tombol && h.tombol.length ? h.tombol : [{ label: 'Lanjut', ke: 'lanjut' }]).map(function (t) { return { label: t.label }; });
  return v;
}
function pelTarget_(hal, idx, ke) {
  if (!ke || ke === 'lanjut') return idx + 1 < hal.length ? hal[idx + 1].id : 'akhir';
  if (ke === 'ulang') return hal[idx].id;
  if (ke === 'akhir') return 'akhir';
  if (ke === 'sebelum') return idx > 0 ? hal[idx - 1].id : hal[0].id;
  return hal.some(function (h) { return h.id === ke; }) ? ke : (idx + 1 < hal.length ? hal[idx + 1].id : 'akhir');
}
function pelKunci_(mid, uid) { return 'pel_' + mid + '_' + uid; }
function apiPelMulai(ctx, d) {
  var a = aktAkses_(ctx, d.modul_id, 'pelajaran'); if (a.err) return a.err;
  var hal = a.konten.halaman || [];
  if (a.kelola && !d.pratinjau) return ok_({ modul: lmsModulPublik_(a.m, true), halaman: hal, kelola: true, ringkasan: pelRingkasGuru_(a) });
  var rows = DB.filter('LessonProgres', function (p) { return p.modul_id === a.m.modul_id && p.user_id === a.uid; }).sort(function (x, y) { return num_(x.percobaan) - num_(y.percobaan); });
  var c = CacheService.getScriptCache(), key = pelKunci_(a.m.modul_id, a.uid), st = a.kelola ? null : lmsJson_(c.get(key), null);
  if (st && d.ulang) st = null;
  if (!st) {
    var maks = num_(a.konten.percobaan_maks), selesai = rows.filter(function (r) { return r.selesai === 'YA'; }).length;
    if (!a.kelola && !d.mulaiBaru && rows.length && rows[rows.length - 1].selesai === 'YA' && !d.ulang) {
      return ok_({ modul: lmsModulPublik_(a.m, false), selesai: true, nilai: num_(rows[rows.length - 1].nilai), terbaik: Math.max.apply(null, rows.map(function (r) { return num_(r.nilai); })), percobaan: selesai, sisa: maks ? Math.max(0, maks - selesai) : null });
    }
    if (!a.kelola && maks && selesai >= maks) return fail_('Kesempatan mengulang sudah habis.');
    st = { p: rows.length + 1, hal: hal[0] ? hal[0].id : 'akhir', jalur: [], benar: 0, dijawab: 0, t0: Date.now() };
  }
  if (!a.kelola) c.put(key, JSON.stringify(st), 21600);
  var idx = hal.map(function (h) { return h.id; }).indexOf(st.hal);
  return ok_({ modul: lmsModulPublik_(a.m, false), halaman: pelHalTampil_(hal[idx], false), posisi: idx + 1, total: hal.length, benar: st.benar, dijawab: st.dijawab, pratinjau: a.kelola });
}
function pelRingkasGuru_(a) {
  var rows = DB.filter('LessonProgres', function (p) { return p.modul_id === a.m.modul_id; }), by = {};
  rows.forEach(function (r) { var b = by[r.user_id] = by[r.user_id] || { uid: r.user_id, nama: lmsNama_(r.user_id), percobaan: 0, terbaik: null, terakhir: '' }; b.percobaan++; if (r.selesai === 'YA') b.terbaik = Math.max(b.terbaik || 0, num_(r.nilai)); b.terakhir = r.diperbarui_pada; });
  return Object.keys(by).map(function (u) { return by[u]; });
}
/** Jawab / lanjut: d.pilihan (indeks opsi) untuk halaman soal, d.tombol (indeks) untuk halaman konten */
function apiPelJawab(ctx, d) {
  var a = aktAkses_(ctx, d.modul_id, 'pelajaran'); if (a.err) return a.err;
  var hal = a.konten.halaman || [], c = CacheService.getScriptCache(), key = pelKunci_(a.m.modul_id, a.uid);
  var st = a.kelola ? (lmsJson_(d.st, null) || { p: 0, hal: d.halaman_id, jalur: [], benar: 0, dijawab: 0, t0: Date.now() }) : lmsJson_(c.get(key), null);
  if (!st) return fail_('Sesi pelajaran berakhir. Mulai lagi dari awal.', { code: 'ULANG' });
  if (d.halaman_id && st.hal !== d.halaman_id && !a.kelola) return fail_('Halaman tidak sesuai urutan. Muat ulang pelajaran.', { code: 'ULANG' });
  var ids = hal.map(function (h) { return h.id; }), idx = ids.indexOf(st.hal), h = hal[idx];
  if (!h) return fail_('Halaman tidak ditemukan.');
  var umpan = null, benar = null, ke;
  if (h.tipe === 'soal') {
    var o = h.opsi[Number(d.pilihan)]; if (!o) return fail_('Pilih salah satu jawaban.');
    st.dijawab++; if (o.benar) st.benar++;
    benar = !!o.benar; umpan = o.umpan || (o.benar ? 'Jawaban benar!' : 'Jawaban belum tepat.');
    ke = pelTarget_(hal, idx, o.lompat);
  } else {
    var tb = (h.tombol && h.tombol.length ? h.tombol : [{ ke: 'lanjut' }])[Number(d.tombol) || 0] || { ke: 'lanjut' };
    ke = pelTarget_(hal, idx, tb.ke);
  }
  st.jalur.push(h.id); st.hal = ke;
  if (ke === 'akhir') {
    var nilai = st.dijawab ? round1_(st.benar / st.dijawab * 100) : 100, durasi = Math.round((Date.now() - (st.t0 || Date.now())) / 1000);
    if (!a.kelola) {
      withLock_(function () {
        DB.appendBatch('LessonProgres', [{ progres_id: reserveIds_('LessonProgres', 1)[0], modul_id: a.m.modul_id, kursus_id: a.m.kursus_id, user_id: a.uid, percobaan: st.p, state: JSON.stringify({ jalur: st.jalur.slice(-100), benar: st.benar, dijawab: st.dijawab, durasi: durasi }), nilai: nilai, selesai: 'YA', mulai: new Date(st.t0).toISOString(), diperbarui_pada: nowIso_() }]);
        var semua = DB.filter('LessonProgres', function (p) { return p.modul_id === a.m.modul_id && p.user_id === a.uid && p.selesai === 'YA'; }).map(function (p) { return num_(p.nilai); });
        var terbaik = Math.max.apply(null, semua), nm = num_(a.m.nilai_maks, 100) || 100;
        aktCatatNilai_(a, a.uid, round1_(terbaik / 100 * nm), 'pelajaran');
        lmsTandai_(a.m.kursus_id, a.m.modul_id, a.uid, 'nilai', terbaik);
        return ok_();
      });
      c.remove(key);
      lmsLog_(ctx, 'aksi', 'pelajaran:selesai', a.m.modul_id, durasi, a.m.judul + ' nilai ' + nilai);
    }
    return ok_({ selesai: true, nilai: nilai, benar: st.benar, dijawab: st.dijawab, umpan: umpan, jawabanBenar: benar, lulus: nilai >= num_(a.konten.nilai_min, 70) });
  }
  if (!a.kelola) c.put(key, JSON.stringify(st), 21600);
  var ni = ids.indexOf(ke);
  return ok_({ selesai: false, umpan: umpan, jawabanBenar: benar, halaman: pelHalTampil_(hal[ni], false), posisi: ni + 1, total: hal.length, benar: st.benar, dijawab: st.dijawab, st: a.kelola ? st : undefined });
}

// =====================================================================
// 8. UMPAN BALIK & SURVEI
// =====================================================================
function ubResponden_(a, uid) { return a.konten.anonim ? 'ANON:' + sign_('UB.' + a.m.modul_id + '.' + uid).substring(0, 22) : uid; }
function apiUbGet(ctx, d) {
  var a = aktAkses_(ctx, d.modul_id, 'umpanbalik'); if (a.err) return a.err;
  var rows = DB.filter('UmpanBalikJawaban', function (j) { return j.modul_id === a.m.modul_id; });
  var out = { modul: lmsModulPublik_(a.m, a.kelola), pertanyaan: a.konten.pertanyaan || [], anonim: !!a.konten.anonim, pengantar: a.konten.pengantar, jml: rows.length };
  if (!a.kelola) {
    var mine = rows.filter(function (j) { return j.responden === ubResponden_(a, a.uid); })[0];
    out.sudah = !!mine; out.jawabanSaya = mine && !a.konten.anonim ? lmsJson_(mine.jawaban, {}) : null;
    out.bolehLihatHasil = !!a.konten.tampil_hasil && !!mine;
    out.dibuka = !a.m.buka || Date.now() >= aktMs_(a.m.buka); out.ditutup = !!a.m.tutup && Date.now() > aktMs_(a.m.tutup);
  } else out.jml_siswa = lmsSiswa_(a.s).length;
  return ok_(out);
}
function apiUbKirim(ctx, d) {
  var a = aktAkses_(ctx, d.modul_id, 'umpanbalik'); if (a.err) return a.err;
  if (a.kelola) return fail_('Survei diisi oleh siswa.');
  if (a.m.buka && Date.now() < aktMs_(a.m.buka)) return fail_('Survei belum dibuka.');
  if (a.m.tutup && Date.now() > aktMs_(a.m.tutup)) return fail_('Survei sudah ditutup.');
  var resp = ubResponden_(a, a.uid);
  if (DB.filter('UmpanBalikJawaban', function (j) { return j.modul_id === a.m.modul_id && j.responden === resp; }).length) return fail_('Anda sudah mengisi survei ini. Terima kasih!');
  var jw = d.jawaban || {}, bersih = {};
  for (var i = 0; i < (a.konten.pertanyaan || []).length; i++) {
    var q = a.konten.pertanyaan[i], v = jw[q.id];
    if (q.tipe === 'skala') { v = num_(v); if (v < 1 || v > 5) v = ''; }
    else if (q.tipe === 'pilihan') { if (q.opsi.indexOf(v) === -1) v = ''; }
    else if (q.tipe === 'pilihanganda') { v = (Array.isArray(v) ? v : []).filter(function (x) { return q.opsi.indexOf(x) > -1; }); if (!v.length) v = ''; }
    else v = lmsTeks_(v, 3000).trim();
    if (q.wajib && (v === '' || v === null)) return fail_('Pertanyaan wajib belum dijawab: "' + q.teks + '"');
    if (v !== '') bersih[q.id] = v;
  }
  DB.appendBatch('UmpanBalikJawaban', [{ jawaban_id: reserveIds_('UmpanBalikJawaban', 1)[0], modul_id: a.m.modul_id, kursus_id: a.m.kursus_id, responden: resp, nama: a.konten.anonim ? '' : lmsNama_(a.uid), jawaban: JSON.stringify(bersih), waktu: nowIso_() }]);
  lmsTandai_(a.m.kursus_id, a.m.modul_id, a.uid, 'kirim');
  return ok_(null, 'Terima kasih! Jawaban Anda tersimpan' + (a.konten.anonim ? ' secara anonim.' : '.'));
}
function apiUbHasil(ctx, d) {
  var a = aktAkses_(ctx, d.modul_id, 'umpanbalik'); if (a.err) return a.err;
  var rows = DB.filter('UmpanBalikJawaban', function (j) { return j.modul_id === a.m.modul_id; });
  if (!a.kelola) {
    if (!a.konten.tampil_hasil) return fail_('Hasil survei tidak dibagikan kepada siswa.');
    if (!rows.some(function (j) { return j.responden === ubResponden_(a, a.uid); })) return fail_('Isi survei dulu untuk melihat hasil.');
  }
  var hasil = (a.konten.pertanyaan || []).map(function (q) {
    var o = { id: q.id, tipe: q.tipe, teks: q.teks, n: 0 };
    if (q.tipe === 'skala') { o.dist = [0, 0, 0, 0, 0]; var s = 0; rows.forEach(function (r) { var v = num_((lmsJson_(r.jawaban, {}) || {})[q.id]); if (v >= 1 && v <= 5) { o.dist[v - 1]++; s += v; o.n++; } }); o.rata = o.n ? round1_(s / o.n) : null; }
    else if (q.tipe === 'pilihan' || q.tipe === 'pilihanganda') { o.hitung = {}; q.opsi.forEach(function (x) { o.hitung[x] = 0; }); rows.forEach(function (r) { var v = (lmsJson_(r.jawaban, {}) || {})[q.id]; if (v === undefined) return; o.n++; (Array.isArray(v) ? v : [v]).forEach(function (x) { if (o.hitung[x] !== undefined) o.hitung[x]++; }); }); }
    else { o.teksJawaban = rows.map(function (r) { var v = (lmsJson_(r.jawaban, {}) || {})[q.id]; return v ? { nama: a.kelola && !a.konten.anonim ? r.nama : '', teks: v } : null; }).filter(Boolean); o.n = o.teksJawaban.length; }
    return o;
  });
  return ok_({ jml: rows.length, anonim: !!a.konten.anonim, hasil: hasil, jml_siswa: a.kelola ? lmsSiswa_(a.s).length : null,
    responden: a.kelola && !a.konten.anonim ? rows.map(function (r) { return { nama: r.nama, waktu: r.waktu, jawaban: lmsJson_(r.jawaban, {}) }; }) : null });
}

// =====================================================================
// 9. KELAS VIRTUAL — Google Meet (Calendar API), Zoom (S2S OAuth), BigBlueButton, Teams/lainnya (tautan)
// =====================================================================
function kvPlatformSiap_() {
  return { meet: true, zoom: !!(prop_('ZOOM_ACCOUNT_ID') && prop_('ZOOM_CLIENT_ID') && prop_('ZOOM_CLIENT_SECRET')), bbb: !!(prop_('BBB_URL') && prop_('BBB_SECRET')), teams: false, lain: false };
}
/** Referensi CalendarApp agar Apps Script meminta izin kalender (dibutuhkan untuk membuat Google Meet) */
function kvIzinKalender_() { return CalendarApp.getDefaultCalendar().getId(); }
function kvIso_(mulai, tambahMenit) { var t = mulai ? aktMs_(mulai) : Date.now() + 10 * 60000; return Utilities.formatDate(new Date(t + (tambahMenit || 0) * 60000), APP.TZ, "yyyy-MM-dd'T'HH:mm:ssXXX"); }
function kvBuatRapat_(platform, o) {
  try {
    if (platform === 'meet') {
      if (typeof ScriptApp.getOAuthToken !== 'function') return { err: 'Pembuatan Google Meet otomatis hanya tersedia di server Apps Script.' };
      var body = { summary: lmsTeks_(o.judul, 200) || 'Kelas Virtual', start: { dateTime: kvIso_(o.mulai), timeZone: APP.TZ }, end: { dateTime: kvIso_(o.mulai, o.durasi || 60), timeZone: APP.TZ },
        conferenceData: { createRequest: { requestId: Utilities.getUuid(), conferenceSolutionKey: { type: 'hangoutsMeet' } } } };
      var r = UrlFetchApp.fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1', { method: 'post', contentType: 'application/json', headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, payload: JSON.stringify(body), muteHttpExceptions: true });
      var j = JSON.parse(r.getContentText() || '{}');
      if (r.getResponseCode() >= 300 || !j.hangoutLink) return { err: 'Google Meet gagal dibuat' + (j.error ? ': ' + j.error.message : '') + '. Jalankan setupV30() sekali di editor untuk memberi izin kalender.' };
      return { link: j.hangoutLink, meeting_id: j.id };
    }
    if (platform === 'zoom') {
      if (!kvPlatformSiap_().zoom) return { err: 'Zoom belum dihubungkan. Isi Account ID, Client ID & Client Secret di menu Keamanan.' };
      var tok = kvZoomToken_(); if (tok.err) return tok;
      var rz = UrlFetchApp.fetch('https://api.zoom.us/v2/users/me/meetings', { method: 'post', contentType: 'application/json', headers: { Authorization: 'Bearer ' + tok.token }, muteHttpExceptions: true,
        payload: JSON.stringify({ topic: lmsTeks_(o.judul, 200) || 'Kelas Virtual', type: 2, start_time: kvIso_(o.mulai), duration: o.durasi || 60, timezone: APP.TZ, settings: { join_before_host: false, waiting_room: true, mute_upon_entry: true } }) });
      var jz = JSON.parse(rz.getContentText() || '{}');
      if (rz.getResponseCode() >= 300 || !jz.join_url) return { err: 'Rapat Zoom gagal dibuat' + (jz.message ? ': ' + jz.message : '') + '.' };
      return { link: jz.join_url, meeting_id: String(jz.id || ''), kata_sandi: jz.password || '' };
    }
    if (platform === 'bbb') {
      if (!kvPlatformSiap_().bbb) return { err: 'BigBlueButton belum dihubungkan. Isi URL API & Shared Secret di menu Keamanan.' };
      return { link: '', meeting_id: 'siakad-' + acak_(10, 'abcdefghjkmnpqrstuvwxyz23456789'), kunci_moderator: acak_(12), kunci_peserta: acak_(12) };
    }
  } catch (e) { return { err: 'Gagal menghubungi layanan rapat: ' + e.message }; }
  return { err: 'Platform ini memakai tautan manual — tempel tautan rapatnya.' };
}
function kvZoomToken_() {
  var c = CacheService.getScriptCache(), t = c.get('zoom_tok');
  if (t) return { token: t };
  var r = UrlFetchApp.fetch('https://zoom.us/oauth/token?grant_type=account_credentials&account_id=' + encodeURIComponent(prop_('ZOOM_ACCOUNT_ID')), { method: 'post', muteHttpExceptions: true,
    headers: { Authorization: 'Basic ' + Utilities.base64Encode(prop_('ZOOM_CLIENT_ID') + ':' + prop_('ZOOM_CLIENT_SECRET')) } });
  var j = JSON.parse(r.getContentText() || '{}');
  if (!j.access_token) return { err: 'Token Zoom ditolak — periksa kredensial Server-to-Server OAuth.' };
  c.put('zoom_tok', j.access_token, Math.max(60, Math.min(3000, num_(j.expires_in, 3600) - 300)));
  return { token: j.access_token };
}
function kvBbbUrl_(call, params) {
  var q = Object.keys(params).map(function (k) { return k + '=' + encodeURIComponent(params[k]).replace(/%20/g, '+'); }).join('&');
  var cs = bytesToHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, call + q + prop_('BBB_SECRET'), Utilities.Charset.UTF_8));
  return String(prop_('BBB_URL')).replace(/\/?$/, '/') + 'api/' + call + '?' + q + '&checksum=' + cs;
}
function apiKvGabung(ctx, d) {
  var a = aktAkses_(ctx, d.modul_id, 'kelasvirtual'); if (a.err) return a.err;
  var k = a.konten, url = k.link;
  if (k.platform === 'bbb') {
    if (!kvPlatformSiap_().bbb || !k.meeting_id) return fail_('Kelas BigBlueButton belum siap. Minta guru menyimpan ulang aktivitas setelah BBB dihubungkan.');
    try {
      UrlFetchApp.fetch(kvBbbUrl_('create', { name: a.m.judul, meetingID: k.meeting_id, attendeePW: k.kunci_peserta, moderatorPW: k.kunci_moderator, record: 'true', duration: String(k.durasi || 60) }), { muteHttpExceptions: true });
    } catch (e) {}
    url = kvBbbUrl_('join', { fullName: lmsNama_(a.uid), meetingID: k.meeting_id, password: a.kelola ? k.kunci_moderator : k.kunci_peserta, userID: a.uid });
  }
  if (!url) return fail_('Tautan kelas virtual belum diisi guru.');
  withLock_(function () {
    var hari = today_(), ada = DB.filter('KelasVirtualHadir', function (h) { return h.modul_id === a.m.modul_id && h.user_id === a.uid && String(h.waktu).substring(0, 10) === hari; }).length;
    if (!ada) DB.appendBatch('KelasVirtualHadir', [{ hadir_id: reserveIds_('KelasVirtualHadir', 1)[0], modul_id: a.m.modul_id, kursus_id: a.m.kursus_id, user_id: a.uid, peran: a.kelola ? 'pengajar' : 'siswa', waktu: nowIso_() }]);
    if (!a.kelola) lmsTandai_(a.m.kursus_id, a.m.modul_id, a.uid, 'lihat');
    return ok_();
  });
  lmsLog_(ctx, 'aksi', 'kelasvirtual:gabung', a.m.modul_id, 0, a.m.judul + ' (' + k.platform + ')');
  return ok_({ url: url, platform: k.platform, kata_sandi: k.platform === 'zoom' ? k.kata_sandi : '' }, 'Membuka kelas virtual…');
}
function apiKvHadir(ctx, d) {
  var a = aktAkses_(ctx, d.modul_id, 'kelasvirtual', 'kelola'); if (a.err) return a.err;
  var rows = DB.filter('KelasVirtualHadir', function (h) { return h.modul_id === a.m.modul_id; });
  var siswa = lmsSiswa_(a.s), hadir = {};
  rows.forEach(function (h) { (hadir[h.user_id] = hadir[h.user_id] || []).push(h.waktu); });
  return ok_({ modul: lmsModulPublik_(a.m, true), siswa: siswa.map(function (u) { return { uid: u, nama: lmsNama_(u), hadir: hadir[u] || [] }; }), jml_hadir: siswa.filter(function (u) { return hadir[u]; }).length });
}

/** Jumlah item yang perlu dinilai per modul (badge di halaman kursus guru) */
function lmsPerluDinilai_(s) {
  var kid = s.kursus.kursus_id, out = {};
  DB.all('KuisPercobaan').forEach(function (p) { if (p.kursus_id === kid && p.status === 'perlu_dinilai') out[p.modul_id] = (out[p.modul_id] || 0) + 1; });
  DB.all('TugasKirim').forEach(function (t) { if (t.kursus_id === kid && t.status === 'terkirim') out[t.modul_id] = (out[t.modul_id] || 0) + 1; });
  DB.all('GlosariumEntri').forEach(function (e) { if (e.kursus_id === kid && e.status === 'Menunggu') out[e.modul_id] = (out[e.modul_id] || 0) + 1; });
  return out;
}

// ---------------------------------------------------------------------
// RUTE
// ---------------------------------------------------------------------
EXT.routes.push(function (add) {
  add('soal.list', apiSoalList, 'guru');
  add('soal.save', apiSoalSave, 'guru', true);
  add('soal.hapus', apiSoalHapus, 'guru', true, { audit: true });
  add('kuis.info', apiKuisInfo, 'any');
  add('kuis.mulai', apiKuisMulai, 'any');
  add('kuis.simpan', apiKuisSimpan, 'any');
  add('kuis.kirim', apiKuisKirim, 'any', true);
  add('kuis.ulasan', apiKuisUlasan, 'any');
  add('kuis.percobaan', apiKuisPercobaanList, 'guru');
  add('kuis.nilaiEsai', apiKuisNilaiEsai, 'guru', true);
  add('tugas.get', apiTugasGet, 'any');
  add('tugas.kirim', apiTugasKirim, 'siswa', true);
  add('tugas.list', apiTugasList, 'guru');
  add('tugas.nilai', apiTugasNilai, 'guru', true, { audit: true });
  add('forum.list', apiForumList, 'any');
  add('forum.diskusi', apiForumDiskusi, 'any');
  add('forum.buat', apiForumBuat, 'any', true);
  add('forum.balas', apiForumBalas, 'any', true);
  add('forum.edit', apiForumEdit, 'any', true);
  add('forum.kelola', apiForumKelola, 'guru', true);
  add('forum.nilai', apiForumNilai, 'guru', true);
  add('wiki.get', apiWikiGet, 'any');
  add('wiki.simpan', apiWikiSimpan, 'any', true);
  add('wiki.riwayat', apiWikiRiwayat, 'any');
  add('wiki.pulihkan', apiWikiPulihkan, 'any', true);
  add('glos.list', apiGlosList, 'any');
  add('glos.simpan', apiGlosSimpan, 'any', true);
  add('glos.kelola', apiGlosKelola, 'any', true);
  add('ws.get', apiWsGet, 'any');
  add('ws.kirim', apiWsKirim, 'siswa', true);
  add('ws.nilai', apiWsNilai, 'any', true);
  add('ws.fase', apiWsFase, 'guru', true, { audit: true });
  add('pel.mulai', apiPelMulai, 'any');
  add('pel.jawab', apiPelJawab, 'any');
  add('ub.get', apiUbGet, 'any');
  add('ub.kirim', apiUbKirim, 'siswa', true);
  add('ub.hasil', apiUbHasil, 'any');
  add('kv.gabung', apiKvGabung, 'any');
  add('kv.hadir', apiKvHadir, 'guru');
});
(EXT.hooks.demoClear = EXT.hooks.demoClear || []).push(function () {
  var sh = getSheet_('BankSoal'), last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, sh.getLastColumn()).clearContent();
  invalidateRows_('BankSoal');
});

if (typeof pasangEkstensi_ === 'function' && typeof SCHEMA !== 'undefined') pasangEkstensi_();

;
// ==== LmsNilai.gs ====
/**
 * =====================================================================
 *  SIAKAD SISWA v3.0 — LmsNilai.gs : Buku Nilai (Gradebook), Rubrik, Skala
 *  - Item nilai = aktivitas berbobot (kuis, tugas, forum, workshop, pelajaran) + item manual
 *  - Kategori berbobot (%), buang nilai terendah, nilai timpa (override) guru
 *  - Skala nilai (huruf/predikat), statistik, data ekspor Excel
 *  - Terpisah dari Nilai Raport; guru dapat "Kirim ke Nilai Raport" (harian/UTS/UAS)
 *  - Pustaka rubrik & panduan penilaian untuk tugas esai/proyek
 * =====================================================================
 */
var EXT = (typeof EXT !== 'undefined' && EXT) || { schema: {}, seed: [], routes: [], tick: [], reset: [], hooks: {} };
var LMS_TABEL_ANAK = (typeof LMS_TABEL_ANAK !== 'undefined' && LMS_TABEL_ANAK) || [];

Object.assign(EXT.schema, {
  NilaiKategori: { key: 'kategori_id', prefix: 'NKT', cols: ['kategori_id', 'kursus_id', 'nama', 'bobot', 'buang_terendah', 'urutan'] },
  NilaiItem:     { key: 'item_id', prefix: 'NIT', cols: ['item_id', 'kursus_id', 'kategori_id', 'nama', 'nilai_maks', 'bobot', 'urutan', 'dibuat_pada'] },
  NilaiEntri:    { key: 'entri_id', prefix: 'NEN', cols: ['entri_id', 'kursus_id', 'item_ref', 'user_id', 'nilai', 'nilai_maks', 'sumber', 'timpa', 'catatan', 'oleh', 'waktu'] },
  SkalaNilai:    { key: 'skala_id', prefix: 'SKL', cols: ['skala_id', 'nama', 'rentang', 'dibuat_oleh', 'dibuat_pada'] },
  Rubrik:        { key: 'rubrik_id', prefix: 'RBK', cols: ['rubrik_id', 'nama', 'jenis', 'kriteria', 'pemilik', 'dibuat_pada', 'diperbarui_pada'] }
});
['NilaiKategori', 'NilaiItem', 'NilaiEntri'].forEach(function (t) { if (LMS_TABEL_ANAK.indexOf(t) === -1) LMS_TABEL_ANAK.push(t); });

// ---------------------------------------------------------------------
// 1. CATAT NILAI (dipanggil aktivitas) & PERHITUNGAN
// ---------------------------------------------------------------------
/** Upsert nilai satu item. Nilai timpa guru (timpa = YA) tidak ditimpa nilai otomatis. Harus di bawah lock. */
function nilaiCatat_(kid, ref, uid, nilai, maks, sumber) {
  var ada = DB.filter('NilaiEntri', function (e) { return e.kursus_id === kid && e.item_ref === ref && e.user_id === uid; })[0];
  if (ada && ada.timpa === 'YA' && sumber !== 'manual') return false;
  var row = { kursus_id: kid, item_ref: ref, user_id: uid, nilai: nilai === '' || nilai === null ? '' : round1_(num_(nilai)), nilai_maks: num_(maks, 100) || 100, sumber: sumber || 'otomatis', waktu: nowIso_() };
  if (ada) { row.entri_id = ada.entri_id; DB.updateBatch('NilaiEntri', 'entri_id', [row]); }
  else { row.entri_id = reserveIds_('NilaiEntri', 1)[0]; row.timpa = 'TIDAK'; row.catatan = ''; row.oleh = ''; DB.appendBatch('NilaiEntri', [row]); }
  if (typeof _LMS !== 'undefined') delete _LMS['st' + kid + '|' + uid];
  if (typeof lmsUserBasi_ === 'function') lmsUserBasi_(uid, kid);   // v3.1
  return true;
}
function nilaiItems_(s) {
  var kid = s.kursus.kursus_id, items = [];
  s.modul.forEach(function (m) {
    if (!LMS_DINILAI[m.tipe] || num_(m.nilai_maks) <= 0) return;
    items.push({ ref: m.modul_id, nama: m.judul, tipe: m.tipe, kategori_id: m.kategori_id || '', maks: num_(m.nilai_maks), bobot: num_(m.bobot, 1), otomatis: true, seksi_id: m.seksi_id, urutan: num_(m.urutan) });
  });
  (s.nilaiItem || DB.filter('NilaiItem', function (i) { return i.kursus_id === kid; })).forEach(function (i) {   // v3.1: dari struktur cache
    items.push({ ref: i.item_id, nama: i.nama, tipe: 'manual', kategori_id: i.kategori_id || '', maks: num_(i.nilai_maks, 100) || 100, bobot: num_(i.bobot, 1), otomatis: false, urutan: 1000 + num_(i.urutan) });
  });
  var urutSeksi = {}; s.seksi.forEach(function (x) { urutSeksi[x.seksi_id] = num_(x.no); });
  return items.sort(function (a, b) { return (a.otomatis ? urutSeksi[a.seksi_id] || 0 : 999) - (b.otomatis ? urutSeksi[b.seksi_id] || 0 : 999) || a.urutan - b.urutan; });
}
function nilaiKategori_(kid) { var st = typeof lmsStruktur_ === 'function' ? lmsStruktur_(kid) : null; return (st && st.nilaiKat ? st.nilaiKat.slice() : DB.filter('NilaiKategori', function (c) { return c.kursus_id === kid; })).sort(function (a, b) { return num_(a.urutan) - num_(b.urutan); }); }
/** Hitung total (0–100) dari peta nilai {ref: {nilai, maks}} */
function nilaiHitung_(items, kats, peta) {
  var defs = kats.map(function (c) { return { id: c.kategori_id, bobot: num_(c.bobot), buang: num_(c.buang_terendah) }; });
  var sumB = defs.reduce(function (s, c) { return s + c.bobot; }, 0), ids = {};
  defs.forEach(function (c) { ids[c.id] = 1; });
  defs.push({ id: '', bobot: defs.length ? Math.max(0, 100 - sumB) : 100, buang: 0 });
  var perKat = {}, tot = 0, w = 0;
  defs.forEach(function (c) {
    var arr = items.filter(function (it) { return (ids[it.kategori_id] ? it.kategori_id : '') === c.id; }).map(function (it) {
      var e = peta[it.ref]; if (!e || e.nilai === '' || e.nilai === null || e.nilai === undefined) return null;
      return { p: num_(e.nilai) / (num_(e.maks || it.maks) || 1) * 100, w: it.bobot };
    }).filter(Boolean);
    if (c.buang && arr.length > c.buang) arr = arr.sort(function (x, y) { return x.p - y.p; }).slice(c.buang);
    var sw = arr.reduce(function (s, x) { return s + x.w; }, 0);
    var v = sw ? arr.reduce(function (s, x) { return s + x.p * x.w; }, 0) / sw : null;
    perKat[c.id] = v === null ? null : round1_(v);
    if (v !== null && c.bobot > 0) { tot += v * c.bobot; w += c.bobot; }
  });
  return { total: w ? round1_(tot / w) : null, perKategori: perKat };
}
function nilaiPetaUser_(kid) {
  var peta = {};
  DB.all('NilaiEntri').forEach(function (e) { if (e.kursus_id === kid) (peta[e.user_id] = peta[e.user_id] || {})[e.item_ref] = { nilai: e.nilai === '' ? '' : num_(e.nilai), maks: num_(e.nilai_maks, 100), timpa: e.timpa === 'YA', catatan: e.catatan, sumber: e.sumber, waktu: e.waktu }; });
  return peta;
}
/** Total nilai kursus seorang siswa (dipakai kriteria kelulusan) */
function lmsTotalSiswa_(s, uid) {
  var kid = s.kursus.kursus_id, peta = typeof lmsRekamUser_ === 'function' ? (lmsRekamUser_(uid).n[kid] || {}) : ((nilaiPetaUser_(kid)[uid]) || {});   // v3.1
  return nilaiHitung_(nilaiItems_(s), nilaiKategori_(kid), peta).total;
}
// ---------------------------------------------------------------------
// 2. SKALA NILAI
// ---------------------------------------------------------------------
function skalaBawaan_() {
  var kkm = num_(setting_('KKM', 70), 70);
  return { skala_id: 'BAWAAN', nama: 'Bawaan sekolah (KKM ' + kkm + ')', rentang: [{ min: 90, huruf: 'A', predikat: 'Sangat Baik' }, { min: 80, huruf: 'B', predikat: 'Baik' }, { min: kkm, huruf: 'C', predikat: 'Cukup' }, { min: 0, huruf: 'D', predikat: 'Perlu Bimbingan' }] };
}
function skalaSemua_() { return [skalaBawaan_()].concat(DB.all('SkalaNilai').map(function (x) { return { skala_id: x.skala_id, nama: x.nama, rentang: lmsJson_(x.rentang, []) }; })); }
function skalaUntuk_(id) { return skalaSemua_().filter(function (x) { return x.skala_id === id; })[0] || skalaBawaan_(); }
function skalaHuruf_(skala, v) {
  if (v === null || v === undefined || v === '') return null;
  var r = (skala.rentang || []).slice().sort(function (a, b) { return num_(b.min) - num_(a.min); });
  for (var i = 0; i < r.length; i++) if (num_(v) >= num_(r[i].min)) return { huruf: r[i].huruf, predikat: r[i].predikat };
  return r.length ? { huruf: r[r.length - 1].huruf, predikat: r[r.length - 1].predikat } : null;
}

// ---------------------------------------------------------------------
// 3. BUKU NILAI
// ---------------------------------------------------------------------
function apiNilaiBuku(ctx, d) {
  var a = lmsAkses_(ctx, d.kursus_id, 'kelola'); if (a.err) return a.err;
  var s = a.s, kid = s.kursus.kursus_id, items = nilaiItems_(s), kats = nilaiKategori_(kid), peta = nilaiPetaUser_(kid), skala = skalaUntuk_(s.kursus.skala_id);
  var kls = lmsKelasUid_(), kelasNama = {}; DB.all('Kelas').forEach(function (k) { kelasNama[k.kelas_id] = k.nama_kelas; });
  var baris = lmsSiswa_(s).map(function (uid) {
    var p = peta[uid] || {}, h = nilaiHitung_(items, kats, p);
    return { uid: uid, nama: lmsNama_(uid), kelas: kelasNama[kls[uid]] || '', kelas_id: kls[uid] || '', nilai: p, total: h.total, perKategori: h.perKategori, skala: skalaHuruf_(skala, h.total) };
  });
  var stat = {};
  items.forEach(function (it) {
    var v = baris.map(function (b) { var e = b.nilai[it.ref]; return e && e.nilai !== '' ? num_(e.nilai) / (num_(e.maks) || it.maks) * 100 : null; }).filter(function (x) { return x !== null; });
    stat[it.ref] = v.length ? { n: v.length, rata: round1_(v.reduce(function (x, y) { return x + y; }, 0) / v.length), min: round1_(Math.min.apply(null, v)), maks: round1_(Math.max.apply(null, v)) } : { n: 0 };
  });
  var tot = baris.map(function (b) { return b.total; }).filter(function (x) { return x !== null; });
  lmsLog_(ctx, 'aksi', 'bukunilai', kid, 0, s.kursus.nama);
  return ok_({ kursus: lmsKursusRingkas_(s.kursus, { skala_id: s.kursus.skala_id || 'BAWAAN', tampil_nilai: s.kursus.tampil_nilai || 'YA', syarat_lulus: lmsJson_(s.kursus.syarat_lulus, {}) }),
    items: items, kategori: kats.map(function (c) { return { kategori_id: c.kategori_id, nama: c.nama, bobot: num_(c.bobot), buang_terendah: num_(c.buang_terendah) }; }),
    bobotSisa: Math.max(0, 100 - kats.reduce(function (x, c) { return x + num_(c.bobot); }, 0)),
    baris: baris, statistik: stat, rataKelas: tot.length ? round1_(tot.reduce(function (x, y) { return x + y; }, 0) / tot.length) : null, skala: skala, skalaSemua: skalaSemua_(),
    kkm: num_(setting_('KKM', 70), 70), semester: setting_('SEMESTER', ''), tahun_ajaran: setting_('TAHUN_AJARAN', '') });
}
function apiNilaiSaya(ctx, d) {
  var a = lmsAkses_(ctx, d.kursus_id); if (a.err) return a.err;
  if (a.kelola) return fail_('Gunakan Buku Nilai untuk melihat nilai seluruh siswa.');
  var s = a.s, kid = s.kursus.kursus_id;
  if ((s.kursus.tampil_nilai || 'YA') === 'TIDAK') return ok_({ disembunyikan: true, kursus: lmsKursusRingkas_(s.kursus) });
  var vis = lmsModulTerlihat_(s, lmsStatus_(s, a.uid));
  var items = nilaiItems_(s).filter(function (it) { return !it.otomatis || vis[it.ref]; }), kats = nilaiKategori_(kid), p = nilaiPetaUser_(kid)[a.uid] || {};
  var h = nilaiHitung_(nilaiItems_(s), kats, p), skala = skalaUntuk_(s.kursus.skala_id);
  return ok_({ kursus: lmsKursusRingkas_(s.kursus), items: items.map(function (it) { var e = p[it.ref]; return Object.assign({}, it, { nilai: e && e.nilai !== '' ? num_(e.nilai) : null, catatan: e ? e.catatan : '', persen: e && e.nilai !== '' ? round1_(num_(e.nilai) / (num_(e.maks) || it.maks) * 100) : null }); }),
    kategori: kats.map(function (c) { return { kategori_id: c.kategori_id, nama: c.nama, bobot: num_(c.bobot), nilai: h.perKategori[c.kategori_id] }; }), lainnya: h.perKategori[''],
    total: h.total, skala: skalaHuruf_(skala, h.total), kkm: num_(setting_('KKM', 70), 70), progres: lmsEvalLulus_(s, a.uid) });
}
function apiNilaiKategoriSave(ctx, d) {
  var a = lmsAkses_(ctx, d.kursus_id, 'kelola'); if (a.err) return a.err;
  var kid = a.s.kursus.kursus_id, ada = {}; nilaiKategori_(kid).forEach(function (c) { ada[c.kategori_id] = c; });
  var list = (d.kategori || []).filter(function (c) { return String(c.nama || '').trim(); });
  var tot = list.reduce(function (s, c) { return s + Math.max(0, num_(c.bobot)); }, 0);
  if (tot > 100) return fail_('Total bobot kategori ' + tot + '% melebihi 100%.');
  var ins = [], upd = [];
  list.forEach(function (c, i) {
    var row = { nama: lmsTeks_(c.nama, 80), bobot: Math.max(0, num_(c.bobot)), buang_terendah: Math.max(0, Math.min(10, num_(c.buang_terendah))), urutan: i + 1 };
    if (c.kategori_id && ada[c.kategori_id]) { row.kategori_id = c.kategori_id; upd.push(row); } else { row.kursus_id = kid; ins.push(row); }
  });
  if (ins.length) { var ids = reserveIds_('NilaiKategori', ins.length); ins.forEach(function (r, i) { r.kategori_id = ids[i]; }); DB.appendBatch('NilaiKategori', ins); }
  DB.updateBatch('NilaiKategori', 'kategori_id', upd);
  var hapus = lmsIds_(d.hapus).filter(function (id) { return ada[id]; });
  if (hapus.length) {
    DB.deleteWhere('NilaiKategori', 'kategori_id', hapus);
    DB.updateBatch('KursusModul', 'modul_id', a.s.modul.filter(function (m) { return hapus.indexOf(m.kategori_id) > -1; }).map(function (m) { return { modul_id: m.modul_id, kategori_id: '' }; }));
    DB.updateBatch('NilaiItem', 'item_id', DB.filter('NilaiItem', function (i) { return i.kursus_id === kid && hapus.indexOf(i.kategori_id) > -1; }).map(function (i) { return { item_id: i.item_id, kategori_id: '' }; }));
  }
  if (d.penempatan) {                                   // {ref: kategori_id} — termasuk kategori baru via nama "#n"
    var semuaKat = {}; nilaiKategori_(kid).forEach(function (c) { semuaKat[c.kategori_id] = 1; });
    var mUp = [], iUp = [];
    Object.keys(d.penempatan).forEach(function (ref) {
      var cid = d.penempatan[ref]; if (cid && !semuaKat[cid]) cid = '';
      if (a.s.modul.some(function (m) { return m.modul_id === ref; })) mUp.push({ modul_id: ref, kategori_id: cid }); else iUp.push({ item_id: ref, kategori_id: cid });
    });
    DB.updateBatch('KursusModul', 'modul_id', mUp); DB.updateBatch('NilaiItem', 'item_id', iUp);
  }
  if (d.bobotItem) {
    DB.updateBatch('KursusModul', 'modul_id', Object.keys(d.bobotItem).filter(function (ref) { return a.s.modul.some(function (m) { return m.modul_id === ref; }); }).map(function (ref) { return { modul_id: ref, bobot: Math.max(0, num_(d.bobotItem[ref], 1)) }; }));
  }
  if (d.skala_id !== undefined || d.tampil_nilai !== undefined) {
    var p = { kursus_id: kid };
    if (d.skala_id !== undefined) p.skala_id = d.skala_id === 'BAWAAN' ? '' : lmsTeks_(d.skala_id, 20);
    if (d.tampil_nilai !== undefined) p.tampil_nilai = d.tampil_nilai === 'TIDAK' ? 'TIDAK' : 'YA';
    DB.updateBatch('Kursus', 'kursus_id', [p]);
  }
  lmsSegarkan_();
  return ok_(null, 'Pengaturan buku nilai disimpan.');
}
function apiNilaiItemSave(ctx, d) {
  var a = lmsAkses_(ctx, d.kursus_id, 'kelola'); if (a.err) return a.err;
  var nama = lmsTeks_(d.nama, 120).trim(); if (!nama) return fail_('Nama item nilai wajib diisi.');
  var row = { nama: nama, nilai_maks: Math.max(1, Math.min(1000, num_(d.nilai_maks, 100))), kategori_id: lmsTeks_(d.kategori_id, 20), bobot: Math.max(0, num_(d.bobot, 1)) };
  if (d.item_id) { row.item_id = d.item_id; DB.updateBatch('NilaiItem', 'item_id', [row]); }
  else { row.item_id = reserveIds_('NilaiItem', 1)[0]; row.kursus_id = a.s.kursus.kursus_id; row.urutan = DB.filter('NilaiItem', function (i) { return i.kursus_id === row.kursus_id; }).length + 1; row.dibuat_pada = nowIso_(); DB.appendBatch('NilaiItem', [row]); }
  lmsSegarkan_();                                                  // v3.1: metadata nilai ada di cache struktur
  return ok_({ item_id: row.item_id }, 'Item nilai "' + nama + '" disimpan.');
}
function apiNilaiItemHapus(ctx, d) {
  var a = lmsAkses_(ctx, d.kursus_id, 'kelola'); if (a.err) return a.err;
  var it = DB.find('NilaiItem', 'item_id', d.item_id); if (!it || it.kursus_id !== a.s.kursus.kursus_id) return fail_('Item tidak ditemukan.');
  lmsHapusKolom_('NilaiEntri', 'item_ref', it.item_id);
  DB.deleteWhere('NilaiItem', 'item_id', [it.item_id]);
  lmsSegarkan_();                                                  // v3.1
  return ok_(null, 'Item nilai dihapus.');
}
/** Simpan nilai manual: d.entri = [{uid, ref, nilai ('' = kosongkan), catatan, lepasTimpa}] */
function apiNilaiEntriSave(ctx, d) {
  var a = lmsAkses_(ctx, d.kursus_id, 'kelola'); if (a.err) return a.err;
  var s = a.s, kid = s.kursus.kursus_id, items = {}, siswa = {};
  nilaiItems_(s).forEach(function (it) { items[it.ref] = it; });
  lmsSiswa_(s).forEach(function (u) { siswa[u] = 1; });
  var ada = {}; DB.all('NilaiEntri').forEach(function (e) { if (e.kursus_id === kid) ada[e.item_ref + '|' + e.user_id] = e; });
  var ins = [], upd = [], n = 0, now = nowIso_();
  for (var i = 0; i < (d.entri || []).length; i++) {
    var e = d.entri[i], it = items[e.ref];
    if (!it || !siswa[e.uid]) continue;
    var v = e.nilai === '' || e.nilai === null || e.nilai === undefined ? '' : Number(e.nilai);
    if (v !== '' && (isNaN(v) || v < 0 || v > it.maks)) return fail_('Nilai ' + lmsNama_(e.uid) + ' untuk "' + it.nama + '" harus 0–' + it.maks + '.');
    var lama = ada[e.ref + '|' + e.uid];
    var row = { nilai: v === '' ? '' : round1_(v), nilai_maks: it.maks, sumber: 'manual', timpa: it.otomatis ? (e.lepasTimpa ? 'TIDAK' : 'YA') : 'TIDAK', catatan: lmsTeks_(e.catatan !== undefined ? e.catatan : (lama ? lama.catatan : ''), 500), oleh: ctx.session.uid, waktu: now };
    if (lama) { row.entri_id = lama.entri_id; upd.push(row); } else { Object.assign(row, { kursus_id: kid, item_ref: e.ref, user_id: e.uid }); ins.push(row); }
    n++;
    if (it.otomatis && v !== '' && !e.lepasTimpa) lmsTandai_(kid, e.ref, e.uid, 'nilai', round1_(v / it.maks * 100));
  }
  if (ins.length) { var ids = reserveIds_('NilaiEntri', ins.length); ins.forEach(function (r, x) { r.entri_id = ids[x]; }); DB.appendBatch('NilaiEntri', ins); }
  DB.updateBatch('NilaiEntri', 'entri_id', upd);
  if (typeof _LMS !== 'undefined') Object.keys(_LMS).forEach(function (k) { if (k.indexOf('st') === 0) delete _LMS[k]; });
  (d.entri || []).forEach(function (e) { if (siswa[e.uid] && typeof lmsUserBasi_ === 'function') lmsUserBasi_(e.uid, kid); });   // v3.1
  lmsSiswa_(s).forEach(function (u) { if ((d.entri || []).some(function (e) { return e.uid === u; })) lmsCekLulus_(kid, u); });
  var res = ok_(null, n + ' nilai disimpan di buku nilai.');
  res.auditDetail = 'Buku nilai ' + kid + ': ' + n + ' entri manual';
  return res;
}
function apiSkalaSave(ctx, d) {
  var nama = lmsTeks_(d.nama, 80).trim(); if (!nama) return fail_('Nama skala wajib diisi.');
  var r = (d.rentang || []).filter(function (x) { return String(x.huruf || '').trim() !== ''; }).map(function (x) { return { min: Math.max(0, Math.min(100, num_(x.min))), huruf: lmsTeks_(x.huruf, 10), predikat: lmsTeks_(x.predikat, 60) }; }).sort(function (a, b) { return b.min - a.min; });
  if (r.length < 2) return fail_('Skala minimal 2 tingkat.');
  if (r[r.length - 1].min !== 0) return fail_('Tingkat terendah harus dimulai dari 0.');
  if (d.skala_id && d.skala_id !== 'BAWAAN') DB.updateBatch('SkalaNilai', 'skala_id', [{ skala_id: d.skala_id, nama: nama, rentang: JSON.stringify(r) }]);
  else DB.appendBatch('SkalaNilai', [{ skala_id: reserveIds_('SkalaNilai', 1)[0], nama: nama, rentang: JSON.stringify(r), dibuat_oleh: ctx.session.uid, dibuat_pada: nowIso_() }]);
  return ok_({ skalaSemua: skalaSemua_() }, 'Skala nilai "' + nama + '" disimpan.');
}

// ---------------------------------------------------------------------
// 4. KIRIM KE NILAI RAPORT (opsional — modul raport lama tidak berubah)
// ---------------------------------------------------------------------
function raportBaris_(a, d) {
  var s = a.s, kid = s.kursus.kursus_id, kolom = { nilai_harian: 1, nilai_uts: 1, nilai_uas: 1 }[d.kolom] ? d.kolom : '';
  if (!kolom) return { err: 'Pilih kolom raport tujuan (Harian / UTS / UAS).' };
  var mapel = lmsTeks_(d.mapel || s.kursus.mapel, 80); if (!mapel) return { err: 'Pilih mata pelajaran raport.' };
  var items = nilaiItems_(s), kats = nilaiKategori_(kid), peta = nilaiPetaUser_(kid), kls = lmsKelasUid_(), ux = userIdx_();
  var ta = setting_('TAHUN_AJARAN', ''), sem = setting_('SEMESTER', ''), lama = {};
  DB.all('Nilai').forEach(function (n) { if (String(n.tahun_ajaran) === ta && String(n.semester) === sem && lower_(n.mata_pelajaran) === lower_(mapel)) lama[n.NIS] = n; });
  var baris = lmsSiswa_(s).filter(function (u) { return !d.kelas_id || kls[u] === d.kelas_id; }).map(function (uid) {
    var h = nilaiHitung_(items, kats, peta[uid] || {}), v = d.sumber && d.sumber !== 'total' ? h.perKategori[d.sumber] : h.total;
    var nis = ux[uid] ? ux[uid].f : '', l = lama[nis] || {};
    return { uid: uid, NIS: nis, nama: lmsNama_(uid), kelas_id: kls[uid] || '', baru: v === null || v === undefined ? null : Math.round(v), lama: l[kolom] === undefined ? '' : l[kolom] };
  });
  return { baris: baris, kolom: kolom, mapel: mapel, ta: ta, sem: sem };
}
function apiRaportPratinjau(ctx, d) {
  var a = lmsAkses_(ctx, d.kursus_id, 'kelola'); if (a.err) return a.err;
  var r = raportBaris_(a, d); if (r.err) return fail_(r.err);
  return ok_(r);
}
function apiRaportKirim(ctx, d) {
  var a = lmsAkses_(ctx, d.kursus_id, 'kelola'); if (a.err) return a.err;
  var r = raportBaris_(a, d); if (r.err) return fail_(r.err);
  var siswaMap = {}; DB.all('Siswa').forEach(function (x) { siswaMap[String(x.NIS)] = x; });
  var lama = {}; DB.all('Nilai').forEach(function (n) { lama[nilaiKey_(n)] = n; });
  var rows = [];
  r.baris.forEach(function (b) {
    if (b.baru === null || !siswaMap[b.NIS]) return;
    var s = siswaMap[b.NIS], key = [s.NIS, lower_(r.mapel), r.sem, r.ta].join('|'), l = lama[key] || {};
    var row = { NIS: s.NIS, kelas_id: s.kelas_id, mata_pelajaran: l.mata_pelajaran || r.mapel, guru_id: l.guru_id || ctx.session.ref || '', semester: r.sem, tahun_ajaran: r.ta,
      nilai_harian: l.nilai_harian === undefined ? '' : l.nilai_harian, nilai_uts: l.nilai_uts === undefined ? '' : l.nilai_uts, nilai_uas: l.nilai_uas === undefined ? '' : l.nilai_uas, catatan: l.catatan || '', diperbarui_pada: nowIso_() };
    row[r.kolom] = Math.max(0, Math.min(100, b.baru));
    row.nilai_akhir = hitungAkhir_(row.nilai_harian, row.nilai_uts, row.nilai_uas);
    row.predikat = predikat_(row.nilai_akhir);
    rows.push(row);
  });
  if (!rows.length) return fail_('Belum ada nilai yang bisa dikirim.');
  DB.upsert('Nilai', nilaiKey_, rows);
  bump_('nilai');
  var res = ok_({ jumlah: rows.length }, rows.length + ' nilai dikirim ke raport (' + { nilai_harian: 'Harian', nilai_uts: 'UTS', nilai_uas: 'UAS' }[r.kolom] + ' — ' + r.mapel + ').');
  res.auditDetail = 'Kirim buku nilai ' + a.s.kursus.kursus_id + ' → raport ' + r.kolom + ' ' + r.mapel + ' (' + rows.length + ')';
  return res;
}

// ---------------------------------------------------------------------
// 5. RUBRIK & PANDUAN PENILAIAN
// ---------------------------------------------------------------------
function rubrikPublik_(r, uid) { return { rubrik_id: r.rubrik_id, nama: r.nama, jenis: r.jenis, kriteria: lmsJson_(r.kriteria, []), milikSaya: r.pemilik === uid, pemilik: lmsNama_(r.pemilik), diperbarui_pada: r.diperbarui_pada }; }
function apiRubrikList(ctx, d) {
  var dipakai = {};
  DB.all('KursusModul').forEach(function (m) { if (m.tipe === 'tugas') { var id = lmsJson_(m.konten, {}).rubrik_id; if (id) dipakai[id] = (dipakai[id] || 0) + 1; } });
  return ok_({ rubrik: DB.all('Rubrik').map(function (r) { return Object.assign(rubrikPublik_(r, ctx.session.uid), { dipakai: dipakai[r.rubrik_id] || 0 }); }) });
}
function apiRubrikSave(ctx, d) {
  var nama = lmsTeks_(d.nama, 120).trim(); if (!nama) return fail_('Nama rubrik wajib diisi.');
  var jenis = d.jenis === 'panduan' ? 'panduan' : 'rubrik', kr;
  if (jenis === 'rubrik') {
    kr = (d.kriteria || []).filter(function (k) { return String(k.nama || '').trim(); }).slice(0, 15).map(function (k, i) {
      return { id: k.id || ('C' + (i + 1)), nama: lmsTeks_(k.nama, 200), level: (k.level || []).filter(function (l) { return String(l.deskripsi || '').trim() !== '' || l.skor !== ''; }).slice(0, 6).map(function (l) { return { deskripsi: lmsTeks_(l.deskripsi, 400), skor: Math.max(0, num_(l.skor)) }; }) };
    }).filter(function (k) { return k.level.length >= 2; });
    if (!kr.length) return fail_('Rubrik minimal 1 kriteria dengan 2 tingkat (level) skor.');
  } else {
    kr = (d.kriteria || []).filter(function (k) { return String(k.nama || '').trim(); }).slice(0, 20).map(function (k, i) { return { id: k.id || ('C' + (i + 1)), nama: lmsTeks_(k.nama, 200), deskripsi: lmsTeks_(k.deskripsi, 800), maks: Math.max(1, num_(k.maks, 10)) }; });
    if (!kr.length) return fail_('Panduan penilaian minimal 1 kriteria.');
  }
  var now = nowIso_();
  if (d.rubrik_id) {
    var lama = DB.find('Rubrik', 'rubrik_id', d.rubrik_id); if (!lama) return fail_('Rubrik tidak ditemukan.');
    if (lama.pemilik !== ctx.session.uid && ctx.session.role !== 'superadmin') return fail_('Hanya pembuat rubrik yang dapat mengubahnya. Gunakan "Duplikat".');
    DB.updateBatch('Rubrik', 'rubrik_id', [{ rubrik_id: lama.rubrik_id, nama: nama, jenis: jenis, kriteria: JSON.stringify(kr), diperbarui_pada: now }]);
    return ok_({ rubrik_id: lama.rubrik_id }, 'Rubrik diperbarui.');
  }
  var id = reserveIds_('Rubrik', 1)[0];
  DB.appendBatch('Rubrik', [{ rubrik_id: id, nama: nama, jenis: jenis, kriteria: JSON.stringify(kr), pemilik: ctx.session.uid, dibuat_pada: now, diperbarui_pada: now }]);
  return ok_({ rubrik_id: id }, (jenis === 'rubrik' ? 'Rubrik' : 'Panduan penilaian') + ' "' + nama + '" dibuat.');
}
function apiRubrikHapus(ctx, d) {
  var r = DB.find('Rubrik', 'rubrik_id', d.rubrik_id); if (!r) return fail_('Rubrik tidak ditemukan.');
  if (r.pemilik !== ctx.session.uid && ctx.session.role !== 'superadmin') return fail_('Hanya pembuat rubrik yang dapat menghapusnya.');
  var pakai = DB.all('KursusModul').filter(function (m) { return m.tipe === 'tugas' && lmsJson_(m.konten, {}).rubrik_id === r.rubrik_id; }).length;
  if (pakai) return fail_('Rubrik dipakai oleh ' + pakai + ' tugas. Ganti rubrik di tugas tersebut dulu.');
  DB.deleteWhere('Rubrik', 'rubrik_id', [r.rubrik_id]);
  return ok_(null, 'Rubrik dihapus.');
}

EXT.routes.push(function (add) {
  add('nilai.buku', apiNilaiBuku, 'guru');
  add('nilai.saya', apiNilaiSaya, 'siswa');
  add('nilai.kategori.save', apiNilaiKategoriSave, 'guru', true, { audit: true });
  add('nilai.item.save', apiNilaiItemSave, 'guru', true);
  add('nilai.item.hapus', apiNilaiItemHapus, 'guru', true);
  add('nilai.entri.save', apiNilaiEntriSave, 'guru', true, { audit: true });
  add('nilai.skala.save', apiSkalaSave, 'guru', true);
  add('nilai.raport.pratinjau', apiRaportPratinjau, 'guru');
  add('nilai.raport.kirim', apiRaportKirim, 'guru', true, { audit: true });
  add('rubrik.list', apiRubrikList, 'guru');
  add('rubrik.save', apiRubrikSave, 'guru', true);
  add('rubrik.hapus', apiRubrikHapus, 'guru', true);
});
(EXT.hooks.demoClear = EXT.hooks.demoClear || []).push(function () {
  ['NilaiEntri', 'SkalaNilai', 'Rubrik'].forEach(function (n) { var sh = getSheet_(n), last = sh.getLastRow(); if (last > 1) sh.getRange(2, 1, last - 1, sh.getLastColumn()).clearContent(); invalidateRows_(n); });
});

if (typeof pasangEkstensi_ === 'function' && typeof SCHEMA !== 'undefined') pasangEkstensi_();

;
// ==== Pesan.gs ====
/**
 * =====================================================================
 *  SIAKAD SISWA v3.0 — Pesan.gs : Pesan Instan Privat (1:1)
 *  - Guru ↔ siswa, antar guru, antar siswa (dapat dimatikan Super Admin)
 *  - Isi pesan TERENKRIPSI di sheet (enkripsi_ di Keamanan.gs, kunci di Script Properties)
 *  - Polling hemat: versi per pengguna di cache → server hanya membaca sheet bila ada pesan baru
 *  - Anti-spam (batas laju, duplikat, kata terlarang), blokir pengguna, hapus pesan sendiri
 * =====================================================================
 */
var EXT = (typeof EXT !== 'undefined' && EXT) || { schema: {}, seed: [], routes: [], tick: [], reset: [], hooks: {} };

Object.assign(EXT.schema, {
  Percakapan:  { key: 'percakapan_id', prefix: 'PCK', cols: ['percakapan_id', 'anggota', 'dibuat_pada', 'terakhir_pada', 'terakhir_dari', 'cuplikan', 'jml_pesan'] },
  Pesan:       { key: 'pesan_id', prefix: 'PSN', cols: ['pesan_id', 'percakapan_id', 'dari', 'isi', 'waktu', 'dihapus'] },
  PesanStatus: { key: 'kunci', cols: ['kunci', 'percakapan_id', 'user_id', 'terakhir_baca'] },
  PesanBlokir: { key: 'blokir_id', prefix: 'PBK', cols: ['blokir_id', 'user_id', 'target', 'waktu'] }
});
EXT.seed.push(['PESAN_ANTAR_SISWA', 'YA', 'YA/TIDAK — siswa boleh mengirim pesan ke sesama siswa sekelas']);

function psnAnggota_(a, b) { return [a, b].sort().join(','); }
function psnEnk_(t) { return typeof enkripsi_ === 'function' ? enkripsi_(t) : t; }
function psnDek_(t) { return typeof dekripsi_ === 'function' ? dekripsi_(t) : t; }
function psnVersiNaik_(uids) { var c = CacheService.getScriptCache(), v = String(Date.now()); uids.forEach(function (u) { c.put('pv_' + u, v, 21600); }); }
function psnVersi_(uid) { var c = CacheService.getScriptCache(), v = c.get('pv_' + uid); if (!v) { v = String(Date.now()); c.put('pv_' + uid, v, 21600); } return v; }
function psnKelas_(uid) { return typeof lmsKelasUid_ === 'function' ? lmsKelasUid_()[uid] : (userIdx_()[uid] || {}).k; }
function psnDiblokir_(a, b) { return DB.all('PesanBlokir').some(function (x) { return (x.user_id === a && x.target === b) || (x.user_id === b && x.target === a); }); }
/** Bolehkah 'dari' mengirim pesan ke 'ke'? → '' atau alasan */
function psnBoleh_(dari, ke) {
  var ux = userIdx_(), a = ux[dari], b = ux[ke];
  if (!b || !b.a) return 'Penerima tidak ditemukan atau nonaktif.';
  if (dari === ke) return 'Tidak dapat mengirim pesan ke diri sendiri.';
  if (a.r === 'siswa' && b.r === 'siswa') {
    if (setting_('PESAN_ANTAR_SISWA', 'YA') !== 'YA') return 'Pesan antar siswa dinonaktifkan sekolah.';
    if (psnKelas_(dari) !== psnKelas_(ke)) return 'Siswa hanya dapat mengirim pesan ke teman sekelas.';
  }
  if (psnDiblokir_(dari, ke)) return 'Percakapan ini diblokir.';
  return '';
}
function psnLawan_(p, uid) { return lmsIdsP_(p.anggota).filter(function (x) { return x !== uid; })[0] || uid; }
function lmsIdsP_(s) { return String(s || '').split(',').filter(String); }
function psnStatusSaya_(uid) { var o = {}; DB.all('PesanStatus').forEach(function (s) { if (s.user_id === uid) o[s.percakapan_id] = s.terakhir_baca; }); return o; }
function psnDaftar_(uid) {
  var baca = psnStatusSaya_(uid), ux = userIdx_();
  return DB.all('Percakapan').filter(function (p) { return lmsIdsP_(p.anggota).indexOf(uid) > -1; }).map(function (p) {
    var l = psnLawan_(p, uid), u = ux[l] || {};
    return { percakapan_id: p.percakapan_id, lawan: { uid: l, nama: u.n || l, peran: u.r || '' }, terakhir_pada: p.terakhir_pada, terakhir_dari: p.terakhir_dari === uid ? 'saya' : 'lawan',
      cuplikan: String(psnDek_(p.cuplikan) || '').substring(0, 90), belum: p.terakhir_dari !== uid && String(p.terakhir_pada) > String(baca[p.percakapan_id] || '') };
  }).sort(function (a, b) { return String(b.terakhir_pada).localeCompare(String(a.terakhir_pada)); });
}
function apiPesanDaftar(ctx, d) {
  var uid = ctx.session.uid, list = psnDaftar_(uid);
  return ok_({ percakapan: list, belum: list.filter(function (x) { return x.belum; }).length, v: psnVersi_(uid), antarSiswa: setting_('PESAN_ANTAR_SISWA', 'YA') === 'YA' });
}
function psnTandaiBaca_(pid, uid) {
  var k = pid + '|' + uid, ada = DB.find('PesanStatus', 'kunci', k), t = nowIso_();
  if (ada) DB.updateBatch('PesanStatus', 'kunci', [{ kunci: k, terakhir_baca: t }]);
  else DB.appendBatch('PesanStatus', [{ kunci: k, percakapan_id: pid, user_id: uid, terakhir_baca: t }]);
}
function psnPesanPublik_(m, uid) {
  var del = m.dihapus === 'YA';
  return { pesan_id: m.pesan_id, dari: m.dari === uid ? 'saya' : 'lawan', isi: del ? '' : psnDek_(m.isi), waktu: m.waktu, dihapus: del, bolehHapus: m.dari === uid && !del && Date.now() - new Date(m.waktu).getTime() < 3600e3 };
}
/** Buka percakapan: d.percakapan_id atau d.dengan (uid lawan). Menandai sudah dibaca. */
function apiPesanBuka(ctx, d) {
  var uid = ctx.session.uid, p = null;
  if (d.percakapan_id) { p = DB.find('Percakapan', 'percakapan_id', d.percakapan_id); if (!p || lmsIdsP_(p.anggota).indexOf(uid) === -1) return fail_('Percakapan tidak ditemukan.'); }
  else if (d.dengan) p = DB.all('Percakapan').filter(function (x) { return x.anggota === psnAnggota_(uid, d.dengan); })[0] || null;
  var lawanId = p ? psnLawan_(p, uid) : d.dengan, lw = userIdx_()[lawanId];
  if (!lw) return fail_('Pengguna tidak ditemukan.');
  var pesan = p ? DB.filter('Pesan', function (m) { return m.percakapan_id === p.percakapan_id; }).sort(function (a, b) { return String(a.waktu).localeCompare(String(b.waktu)); }) : [];
  if (d.sebelum) pesan = pesan.filter(function (m) { return String(m.waktu) < String(d.sebelum); });
  var lebih = pesan.length > 60;
  pesan = pesan.slice(-60);
  if (p && p.terakhir_dari !== uid) withLock_(function () { psnTandaiBaca_(p.percakapan_id, uid); return ok_(); });
  var blokirSaya = DB.all('PesanBlokir').some(function (x) { return x.user_id === uid && x.target === lawanId; });
  return ok_({ percakapan_id: p ? p.percakapan_id : '', lawan: { uid: lawanId, nama: lw.n, peran: lw.r }, pesan: pesan.map(function (m) { return psnPesanPublik_(m, uid); }), lebih: lebih,
    bolehKirim: !psnBoleh_(uid, lawanId), alasan: psnBoleh_(uid, lawanId), diblokir: blokirSaya, v: psnVersi_(uid) });
}
function apiPesanKirim(ctx, d) {
  var uid = ctx.session.uid, ke = d.ke, p = null;
  if (d.percakapan_id) { p = DB.find('Percakapan', 'percakapan_id', d.percakapan_id); if (!p || lmsIdsP_(p.anggota).indexOf(uid) === -1) return fail_('Percakapan tidak ditemukan.'); ke = psnLawan_(p, uid); }
  var alasan = psnBoleh_(uid, ke); if (alasan) return fail_(alasan);
  var isi = String(d.isi || '').trim().substring(0, 2000);
  if (!isi) return fail_('Tulis pesan terlebih dulu.');
  var spam = typeof spamCek_ === 'function' ? spamCek_(ctx, isi, 'pesan') : ''; if (spam) return fail_(spam);
  if (!p) p = DB.all('Percakapan').filter(function (x) { return x.anggota === psnAnggota_(uid, ke); })[0] || null;
  var now = nowIso_(), id = reserveIds_('Pesan', 1)[0];
  if (!p) { p = { percakapan_id: reserveIds_('Percakapan', 1)[0], anggota: psnAnggota_(uid, ke), dibuat_pada: now, terakhir_pada: now, terakhir_dari: uid, cuplikan: '', jml_pesan: 0 }; DB.appendBatch('Percakapan', [p]); }
  DB.appendBatch('Pesan', [{ pesan_id: id, percakapan_id: p.percakapan_id, dari: uid, isi: psnEnk_(isi), waktu: now, dihapus: '' }]);
  DB.updateBatch('Percakapan', 'percakapan_id', [{ percakapan_id: p.percakapan_id, terakhir_pada: now, terakhir_dari: uid, cuplikan: psnEnk_(isi.substring(0, 90)), jml_pesan: num_(p.jml_pesan) + 1 }]);
  psnTandaiBaca_(p.percakapan_id, uid);
  psnVersiNaik_([uid, ke]);
  if (typeof catatAktivitas_ === 'function') catatAktivitas_(ctx, 'aksi', 'pesan:kirim', p.percakapan_id, 0, 'ke ' + lmsNamaP_(ke));
  return ok_({ percakapan_id: p.percakapan_id, pesan: { pesan_id: id, dari: 'saya', isi: isi, waktu: now, dihapus: false, bolehHapus: true }, v: psnVersi_(uid) });
}
function lmsNamaP_(uid) { var u = userIdx_()[uid]; return u ? u.n : uid; }
/** Polling hemat: kembali cepat bila versi tidak berubah */
function apiPesanPoll(ctx, d) {
  var uid = ctx.session.uid, v = psnVersi_(uid);
  if (d.v && String(d.v) === v) return ok_({ sama: true, v: v });
  var list = psnDaftar_(uid), out = { sama: false, v: v, belum: list.filter(function (x) { return x.belum; }).length, percakapan: list.slice(0, 50) };
  if (d.percakapan_id) {
    var p = DB.find('Percakapan', 'percakapan_id', d.percakapan_id);
    if (p && lmsIdsP_(p.anggota).indexOf(uid) > -1) {
      out.baru = DB.filter('Pesan', function (m) { return m.percakapan_id === p.percakapan_id && (!d.sejak || String(m.waktu) > String(d.sejak)); }).sort(function (a, b) { return String(a.waktu).localeCompare(String(b.waktu)); }).slice(-60).map(function (m) { return psnPesanPublik_(m, uid); });
      if (p.terakhir_dari !== uid) withLock_(function () { psnTandaiBaca_(p.percakapan_id, uid); return ok_(); });
    }
  }
  return ok_(out);
}
/** Daftar orang yang boleh dihubungi (dengan pencarian) */
function apiPesanKontak(ctx, d) {
  var uid = ctx.session.uid, me = ctx.session.role, ux = userIdx_(), q = lower_(d.cari || ''), kelasNama = {};
  DB.all('Kelas').forEach(function (k) { kelasNama[k.kelas_id] = k.nama_kelas; });
  var out = Object.keys(ux).filter(function (id) {
    var u = ux[id]; if (!u.a || id === uid) return false;
    if (q && lower_(u.n + ' ' + u.e).indexOf(q) === -1) return false;
    if (me === 'siswa' && u.r === 'siswa') return setting_('PESAN_ANTAR_SISWA', 'YA') === 'YA' && psnKelas_(id) === psnKelas_(uid);
    return true;
  }).map(function (id) { var u = ux[id], k = u.r === 'siswa' ? psnKelas_(id) : ''; return { uid: id, nama: u.n, peran: u.r, kelas: k ? (kelasNama[k] || k) : '' }; })
    .sort(function (a, b) { return (a.peran === 'siswa' ? 1 : 0) - (b.peran === 'siswa' ? 1 : 0) || a.nama.localeCompare(b.nama); });
  return ok_({ kontak: out.slice(0, 80), total: out.length });
}
function apiPesanHapus(ctx, d) {
  var m = DB.find('Pesan', 'pesan_id', d.pesan_id); if (!m) return fail_('Pesan tidak ditemukan.');
  if (m.dari !== ctx.session.uid) return fail_('Anda hanya dapat menghapus pesan sendiri.');
  if (Date.now() - new Date(m.waktu).getTime() > 3600e3) return fail_('Pesan hanya dapat dihapus dalam 1 jam setelah dikirim.');
  DB.updateBatch('Pesan', 'pesan_id', [{ pesan_id: m.pesan_id, dihapus: 'YA', isi: '' }]);
  var p = DB.find('Percakapan', 'percakapan_id', m.percakapan_id);
  if (p) psnVersiNaik_(lmsIdsP_(p.anggota));
  return ok_(null, 'Pesan dihapus untuk semua.');
}
function apiPesanBlokir(ctx, d) {
  var uid = ctx.session.uid, ada = DB.all('PesanBlokir').filter(function (x) { return x.user_id === uid && x.target === d.uid; });
  if (d.blokir === false) { if (ada.length) DB.deleteWhere('PesanBlokir', 'blokir_id', ada.map(function (x) { return x.blokir_id; })); return ok_(null, 'Blokir dibuka.'); }
  if (!userIdx_()[d.uid]) return fail_('Pengguna tidak ditemukan.');
  if (userIdx_()[d.uid].r !== 'siswa' && ctx.session.role === 'siswa') return fail_('Pesan dari guru/Super Admin tidak dapat diblokir.');
  if (!ada.length) DB.appendBatch('PesanBlokir', [{ blokir_id: reserveIds_('PesanBlokir', 1)[0], user_id: uid, target: d.uid, waktu: nowIso_() }]);
  return ok_(null, 'Pengguna diblokir. Ia tidak dapat mengirim pesan kepada Anda.');
}

EXT.routes.push(function (add) {
  add('pesan.daftar', apiPesanDaftar, 'any');
  add('pesan.buka', apiPesanBuka, 'any');
  add('pesan.kirim', apiPesanKirim, 'any', true);
  add('pesan.poll', apiPesanPoll, 'any');
  add('pesan.kontak', apiPesanKontak, 'any');
  add('pesan.hapus', apiPesanHapus, 'any', true);
  add('pesan.blokir', apiPesanBlokir, 'any', true);
});
(EXT.hooks.demoClear = EXT.hooks.demoClear || []).push(function () {
  ['Percakapan', 'Pesan', 'PesanStatus', 'PesanBlokir'].forEach(function (n) { var sh = getSheet_(n), last = sh.getLastRow(); if (last > 1) sh.getRange(2, 1, last - 1, sh.getLastColumn()).clearContent(); invalidateRows_(n); });
});

if (typeof pasangEkstensi_ === 'function' && typeof SCHEMA !== 'undefined') pasangEkstensi_();

;
// ==== Keamanan.gs ====
/**
 * =====================================================================
 *  SIAKAD SISWA v3.0 — Keamanan.gs : Pelacakan, Keamanan Tingkat Tinggi, Login Google Super Admin
 *  - Log aktivitas: login, halaman yang diakses (+durasi), aksi penting (kuis/tugas/forum)
 *  - Anti-spam: batas laju per pengguna, konten duplikat, batas tautan, kata terlarang
 *  - Enkripsi data (pesan privat): aliran kunci HMAC-SHA256 + MAC, kunci di Script Properties
 *  - Pembatasan IP: Apps Script tidak bisa melihat IP, jadi IP asli diteruskan oleh proxy
 *    Cloudflare Worker yang menandatangani (HMAC) ip|waktu|hash-isi. Tanpa proxy → fitur nonaktif.
 *  - Sesi aman: batas tidak aktif (idle), keluarkan semua, riwayat login + perangkat + IP
 *  - Google OAuth 2.0 untuk Super Admin: ID token diverifikasi di server (aud = GOOGLE_CLIENT_ID
 *    dari Script Properties), mode "sandi / keduanya / wajib Google", pemulihan via resetSuperAdmin()
 *  Kebijakan keamanan disimpan di Script Properties (KEAMANAN_V3) — tidak bisa diubah lewat Sheets.
 * =====================================================================
 */
var EXT = (typeof EXT !== 'undefined' && EXT) || { schema: {}, seed: [], routes: [], tick: [], reset: [], hooks: {} };
function kamKait_(nama, fn) { (EXT.hooks[nama] = EXT.hooks[nama] || []).push(fn); }

Object.assign(EXT.schema, {
  LogAktivitas: { key: 'log_id', prefix: 'LAK', cols: ['log_id', 'waktu', 'user_id', 'nama', 'peran', 'jenis', 'halaman', 'objek', 'durasi_detik', 'kunjungan', 'ip', 'perangkat', 'detail'] }
});
var KAM_RAHASIA = {
  GOOGLE_CLIENT_ID: { label: 'Google OAuth — Client ID (login Super Admin)', pola: /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/, pesan: 'Client ID harus berbentuk 1234…-xxxx.apps.googleusercontent.com' },
  IP_PROXY_SECRET:  { label: 'Secret proxy IP (Cloudflare Worker)', pola: /^[A-Za-z0-9_\-]{32,128}$/, pesan: 'Secret proxy 32–128 karakter (huruf, angka, - atau _).' }
};
EXT.reset.push(function () { if (typeof RAHASIA_DASHBOARD !== 'undefined') Object.keys(KAM_RAHASIA).forEach(function (k) { if (!RAHASIA_DASHBOARD[k]) RAHASIA_DASHBOARD[k] = KAM_RAHASIA[k]; }); _KAM = null; });
EXT.seed.push(['LOG_SIMPAN_HARI', '60', 'Lama penyimpanan log aktivitas (hari) — baris lebih lama dihapus otomatis']);

var KAM_BAWAAN = { ipMode: 'mati', ipDaftar: [], ipWajibProxy: true, rateMenit: 150, idleMenit: 0, saLoginMode: 'sandi',
  spamMenit: 8, pesanMenit: 25, spamLink: 3, kataTerlarang: [], lacakHalaman: true };
var _KAM = null;
function kamKebijakan_() { if (_KAM) return _KAM; _KAM = Object.assign({}, KAM_BAWAAN, lmsJsonK_(prop_('KEAMANAN_V3')) || {}); return _KAM; }
function lmsJsonK_(s) { try { return s ? JSON.parse(s) : null; } catch (e) { return null; } }
function kamSimpanKebijakan_(p) { var b = Object.assign({}, kamKebijakan_(), p); setProp_('KEAMANAN_V3', JSON.stringify(b)); _KAM = b; return b; }

// ---------------------------------------------------------------------
// 1. ENKRIPSI DATA (dipakai pesan privat) — kunci ENC_KEY hanya di Script Properties
// ---------------------------------------------------------------------
function kamKunci_() { var k = prop_('ENC_KEY'); if (!k) { k = acak_(64); setProp_('ENC_KEY', k); } return k; }
function kamAliran_(key, iv, data) {
  var out = new Array(data.length);
  for (var i = 0, blok = 0; i < data.length; blok++) {
    var ks = Utilities.computeHmacSha256Signature(iv + ':' + blok, key);
    for (var j = 0; j < 32 && i < data.length; j++, i++) out[i] = data[i] ^ ks[j];
  }
  return out;
}
/** Enkripsi terautentikasi: 'e1.<iv>.<ciphertext>.<mac>' */
function enkripsi_(teks) {
  if (teks === '' || teks === null || teks === undefined) return '';
  var key = kamKunci_(), iv = acak_(16), ct = b64u_(kamAliran_(key, iv, Utilities.newBlob(String(teks)).getBytes()));
  var mac = b64u_(Utilities.computeHmacSha256Signature('MAC.' + iv + '.' + ct, key)).substring(0, 22);
  return 'e1.' + iv + '.' + ct + '.' + mac;
}
function dekripsi_(s) {
  s = String(s || '');
  if (s.indexOf('e1.') !== 0) return s;
  try {
    var p = s.split('.'), key = kamKunci_();
    if (p.length !== 4 || !samaAman_(b64u_(Utilities.computeHmacSha256Signature('MAC.' + p[1] + '.' + p[2], key)).substring(0, 22), p[3])) return '[pesan rusak / kunci berubah]';
    var b = p[2]; while (b.length % 4) b += '=';
    return Utilities.newBlob(kamAliran_(key, p[1], Utilities.base64DecodeWebSafe(b))).getDataAsString();
  } catch (e) { return '[pesan tidak dapat dibuka]'; }
}
kamKait_('setupRahasia', function () { kamKunci_(); });

// ---------------------------------------------------------------------
// 2. IP DARI PROXY BERTANDA TANGAN
// ---------------------------------------------------------------------
/** {ip, sah} — sah hanya bila tanda tangan proxy cocok & waktu ≤ 5 menit */
function kamIp_() {
  if (_REQ && _REQ._ip) return _REQ._ip;
  var p = (_REQ && _REQ.p) || {}, out = { ip: '', sah: false, ada: !!p.__ip }, sec = p.__ip ? prop_('IP_PROXY_SECRET') : '';
  if (sec && p.__ip && p.__ts && p.__sig) {
    var ts = Number(p.__ts), bh = bytesToHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(_REQ.raw || ''), Utilities.Charset.UTF_8));
    var ok = Math.abs(Date.now() - ts) < 300000 && samaAman_(bytesToHex_(Utilities.computeHmacSha256Signature(String(p.__ip) + '|' + ts + '|' + bh, sec)), String(p.__sig).toLowerCase());
    if (ok) out = { ip: String(p.__ip).substring(0, 45), sah: true, ada: true };
  }
  if (_REQ) _REQ._ip = out;
  return out;
}
function kamIpBagian_(ip) {
  ip = String(ip || '').trim();
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return { v: 4, b: ip.split('.').map(Number) };
  if (ip.indexOf(':') > -1) {
    var sisi = ip.split('::'), kiri = sisi[0] ? sisi[0].split(':') : [], kanan = sisi.length > 1 && sisi[1] ? sisi[1].split(':') : [];
    var isi = []; for (var i = 0; i < 8 - kiri.length - kanan.length; i++) isi.push('0');
    var g = (sisi.length > 1 ? kiri.concat(isi, kanan) : kiri).map(function (x) { return parseInt(x || '0', 16); });
    if (g.length !== 8 || g.some(isNaN)) return null;
    var b = []; g.forEach(function (x) { b.push(x >> 8, x & 255); });
    return { v: 6, b: b };
  }
  return null;
}
/** Cocokkan IP dengan daftar "1.2.3.4", "10.0.0.0/8", "2001:db8::/32" */
function kamIpCocok_(ip, daftar) {
  var a = kamIpBagian_(ip); if (!a) return false;
  return (daftar || []).some(function (e) {
    var p = String(e).trim().split('/'), n = kamIpBagian_(p[0]); if (!n || n.v !== a.v) return false;
    var bits = p[1] === undefined ? n.b.length * 8 : Math.max(0, Math.min(n.b.length * 8, Number(p[1])));
    for (var i = 0; i < n.b.length && bits > 0; i++, bits -= 8) {
      var mask = bits >= 8 ? 255 : (255 << (8 - bits)) & 255;
      if ((a.b[i] & mask) !== (n.b[i] & mask)) return false;
    }
    return true;
  });
}
function kamPeranDibatasi_(peran, pol) {
  if (pol.ipMode === 'mati' || !(pol.ipDaftar || []).length || !prop_('IP_PROXY_SECRET')) return false;
  if (pol.ipMode === 'sa') return peran === 'superadmin';
  if (pol.ipMode === 'staf') return peran !== 'siswa';
  return pol.ipMode === 'semua';
}
function kamCekIp_(peran) {
  var pol = kamKebijakan_();
  if (!kamPeranDibatasi_(peran, pol)) return null;
  var ip = kamIp_();
  if (!ip.sah) return pol.ipWajibProxy ? fail_('Akses ' + ROLES[peran] + ' hanya diizinkan melalui jaringan resmi sekolah (alamat aplikasi proxy).', { code: 'IP' }) : null;
  if (!kamIpCocok_(ip.ip, pol.ipDaftar)) return fail_('Akses ditolak dari jaringan ini (IP ' + ip.ip + '). Hubungi Super Admin.', { code: 'IP' });
  return null;
}

// ---------------------------------------------------------------------
// 3. GERBANG PER PERMINTAAN: batas laju, batas IP, sesi idle
// ---------------------------------------------------------------------
var KAM_LATAR = { 'notif.drain': 1, 'track.kirim': 1, 'pesan.poll': 1, 'kuis.simpan': 1 };
function kamTokenTerbit_(t) { try { var b = String(t || '').split('.')[0]; while (b.length % 4) b += '='; return Number(JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(b)).getDataAsString()).i) || 0; } catch (e) { return 0; } }
kamKait_('gerbang', function (ctx, r, body) {
  var pol = kamKebijakan_(), c = CacheService.getScriptCache(), menit = Math.floor(Date.now() / 60000);
  // batas laju: per pengguna (atau per IP terverifikasi untuk rute publik)
  var ip = kamIp_(), id = ctx.session ? 'u' + ctx.session.uid : (ip.sah ? 'i' + ip.ip : '');
  if (id && r.name !== 'notif.drain') {
    var k = 'rl_' + menit + '_' + id, n = Number(c.get(k) || 0) + 1;
    c.put(k, String(n), 70);
    if (n > num_(pol.rateMenit, 150)) {
      if (n === num_(pol.rateMenit, 150) + 1) catatAktivitas_(ctx, 'keamanan', 'batas-laju', r.name, 0, 'Melebihi ' + pol.rateMenit + ' permintaan/menit');
      return fail_('Terlalu banyak permintaan dalam 1 menit. Tunggu sebentar lalu coba lagi.', { code: 'RATE', retryable: false });
    }
  }
  if (!ctx.session) return null;
  var tolak = kamCekIp_(ctx.session.role);
  if (tolak) return tolak;
  if (num_(pol.idleMenit) > 0) {
    var ik = 'idl_' + hashKecil_(body.token), ada = c.get(ik), ttl = Math.min(21600, num_(pol.idleMenit) * 60);
    if (!ada && Date.now() - kamTokenTerbit_(body.token) > ttl * 1000) return fail_('Sesi berakhir karena tidak ada aktivitas selama ' + pol.idleMenit + ' menit. Silakan login ulang.', { code: 'AUTH' });
    if (!KAM_LATAR[r.name] || !ada) c.put(ik, '1', ttl);
  }
  return null;
});
kamKait_('login', function (u, ctx, d) {
  var pol = kamKebijakan_();
  if (u.role === 'superadmin' && pol.saLoginMode === 'google') { catatAktivitas_({ session: { uid: u.user_id, role: u.role } }, 'login_ditolak', 'login', 'sandi', 0, 'Mode wajib Google'); return fail_('Super Admin wajib masuk dengan tombol "Masuk dengan Google".', { code: 'GOOGLE' }); }
  var t = kamCekIp_(u.role);
  if (t) catatAktivitas_({ session: { uid: u.user_id, role: u.role } }, 'login_ditolak', 'login', 'ip', 0, t.message);
  return t;
});
kamKait_('loginOk', function (u, ctx, cara) {
  var ip = kamIp_();
  catatAktivitas_({ session: { uid: u.user_id, role: u.role }, dev: ctx && ctx.dev }, 'login', 'login', cara || 'sandi', 0, (cara === 'google' ? 'Google OAuth' : 'Sandi') + (ip.sah ? ' • IP ' + ip.ip : ''));
});
kamKait_('loginGagal', function (id, u) {
  catatAktivitas_({ session: u ? { uid: u.user_id, role: u.role } : null }, 'login_gagal', 'login', '', 0, u ? 'Sandi salah' : 'Akun tidak dikenal: ' + String(id).replace(/^(.{3}).*(@.*)?$/, '$1***$2'));
});
/** resetSuperAdmin(): pastikan pemulihan selalu bisa — buka mode Google wajib & batas IP Super Admin */
kamKait_('resetSA', function () {
  var pol = kamKebijakan_(), ubah = {};
  if (pol.saLoginMode === 'google') ubah.saLoginMode = 'keduanya';
  if (pol.ipMode !== 'mati') ubah.ipMode = 'mati';
  if (Object.keys(ubah).length) { kamSimpanKebijakan_(ubah); Logger.log('   🔓 Pemulihan: ' + (ubah.saLoginMode ? 'login sandi Super Admin dibuka kembali; ' : '') + (ubah.ipMode ? 'pembatasan IP dimatikan sementara.' : '')); }
});
function bukaBatasIP() { kamSimpanKebijakan_({ ipMode: 'mati' }); Logger.log('🔓 Pembatasan IP dimatikan. Aktifkan lagi dari menu Keamanan Lanjutan setelah memastikan proxy & daftar IP benar.'); }

// ---------------------------------------------------------------------
// 4. ANTI-SPAM (forum, pesan, wiki, glosarium, tugas)
// ---------------------------------------------------------------------
function spamCek_(ctx, teks, jenis) {
  var pol = kamKebijakan_(), c = CacheService.getScriptCache(), uid = ctx.session.uid, siswa = ctx.session.role === 'siswa';
  var grup = jenis === 'pesan' ? 'pesan' : 'konten', batas = jenis === 'pesan' ? num_(pol.pesanMenit, 25) : num_(pol.spamMenit, 8);
  var k = 'sp_' + grup + '_' + Math.floor(Date.now() / 60000) + '_' + uid, n = Number(c.get(k) || 0) + 1;
  c.put(k, String(n), 70);
  if (siswa && n > batas && jenis !== 'wiki') { catatAktivitas_(ctx, 'spam', jenis, '', 0, 'Batas ' + batas + '/menit'); return 'Anda mengirim terlalu cepat. Tunggu 1 menit sebelum mengirim lagi.'; }
  var t = String(teks || '');
  if (t.length > 20) {
    var hk = 'spd_' + grup + '_' + uid, h = hashKecil_(t.trim().toLowerCase());
    if (c.get(hk) === h && jenis !== 'wiki' && jenis !== 'forum-edit') return 'Konten yang sama baru saja Anda kirim.';
    c.put(hk, h, 600);
  }
  if (siswa) {
    var link = (t.match(/https?:\/\/|www\./gi) || []).length;
    if (link > num_(pol.spamLink, 3)) { catatAktivitas_(ctx, 'spam', jenis, '', 0, link + ' tautan'); return 'Terlalu banyak tautan (maksimal ' + pol.spamLink + ').'; }
  }
  var low = t.toLowerCase(), kata = (pol.kataTerlarang || []).filter(function (w) { w = String(w).trim().toLowerCase(); return w && new RegExp('(^|[^a-z0-9])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z0-9]|$)').test(low); });
  if (kata.length) { catatAktivitas_(ctx, 'spam', jenis, '', 0, 'Kata terlarang'); return 'Pesan mengandung kata yang tidak diizinkan di lingkungan sekolah.'; }
  return '';
}

// ---------------------------------------------------------------------
// 5. LOG AKTIVITAS — antrean cache, ditulis pekerja menit (jalur baca tidak menulis sheet)
// ---------------------------------------------------------------------
function catatAktivitas_(ctx, jenis, halaman, objek, durasi, detail, kunjungan) {
  try {
    var ses = ctx && ctx.session, u = ses ? (userIdx_()[ses.uid] || {}) : {}, ip = kamIp_();
    var row = [nowIso_(), ses ? ses.uid : '', u.n || '', ses ? ses.role : '', jenis, lmsTeksK_(halaman, 80), lmsTeksK_(objek, 60), Math.max(0, Math.round(num_(durasi))), kunjungan || 1, ip.sah ? ip.ip : '', lmsTeksK_(ctx && ctx.dev, 30), lmsTeksK_(detail, 300)];
    var lock = _IN_LOCK ? null : LockService.getScriptLock();
    if (lock && !lock.tryLock(400)) return;
    try {
      var c = CacheService.getScriptCache(), q = JSON.parse(c.get('lakq') || '[]');
      q.push(row);
      if (q.length >= 250 || JSON.stringify(q).length > 90000) { kamTulisLog_(q); c.remove('lakq'); }
      else c.put('lakq', JSON.stringify(q), 21600);
    } finally { if (lock) lock.releaseLock(); }
  } catch (e) { console.warn('log aktivitas: ' + e.message); }
}
function lmsTeksK_(v, n) { return String(v == null ? '' : v).substring(0, n); }
function kamTulisLog_(q) {
  if (!q.length) return;
  var ids = reserveIds_('LogAktivitas', q.length), cols = SCHEMA.LogAktivitas.cols;
  DB.appendBatch('LogAktivitas', q.map(function (r, i) { var o = { log_id: ids[i] }; cols.slice(1).forEach(function (c, j) { o[c] = r[j]; }); return o; }));
}
/** Pekerja menit: tulis antrean + pangkas log lama sekali sehari */
EXT.tick.push(function () {
  var c = CacheService.getScriptCache(), q = JSON.parse(c.get('lakq') || '[]');
  if (q.length) { kamTulisLog_(q); c.remove('lakq'); }
  var hari = today_();
  if (propFresh_('LOG_PANGKAS') !== hari) {
    setProp_('LOG_PANGKAS', hari);
    var batas = Utilities.formatDate(new Date(Date.now() - num_(setting_('LOG_SIMPAN_HARI', 60), 60) * 864e5), APP.TZ, "yyyy-MM-dd'T'HH:mm:ss");
    var lama = DB.all('LogAktivitas').filter(function (r) { return String(r.waktu) < batas; }).map(function (r) { return r.log_id; });
    if (lama.length) DB.deleteWhere('LogAktivitas', 'log_id', lama);
  }
});
/** Pelacakan halaman dari browser: ev = [{p: halaman, d: durasi detik, n: kunjungan, o: objek}] (≤ 40) */
function apiTrackKirim(ctx, d) {
  if (!kamKebijakan_().lacakHalaman) return ok_({ diterima: 0 });
  var ev = (d.ev || []).slice(0, 40).filter(function (e) { return e && e.p && /^[a-z0-9\-_/.:]{1,80}$/i.test(String(e.p)); });
  ev.forEach(function (e) { catatAktivitas_(ctx, 'halaman', e.p, e.o || '', Math.min(4 * 3600, num_(e.d)), '', Math.max(1, Math.min(500, num_(e.n, 1)))); });
  return ok_({ diterima: ev.length });
}
/** Baca log dari bawah sheet (terbaru dulu) sampai melewati tanggal awal — tanpa membaca seluruh sheet */
function kamBacaLog_(dari, maks) {
  var sh = getSheet_('LogAktivitas'), last = sh.getLastRow(), cols = SCHEMA.LogAktivitas.cols, h = DB.headers_(sh), out = [], blok = 4000;
  var pos = last;
  while (pos > 1 && out.length < maks) {
    var awal = Math.max(2, pos - blok + 1), v = sh.getRange(awal, 1, pos - awal + 1, h.length).getValues(), stop = false;
    for (var i = v.length - 1; i >= 0; i--) {
      var o = {}; h.forEach(function (k, j) { o[k] = v[i][j] instanceof Date ? v[i][j].toISOString() : v[i][j]; });
      if (dari && String(o.waktu) < dari) { stop = true; break; }
      out.push(o); if (out.length >= maks) break;
    }
    if (stop) break;
    pos = awal - 1;
  }
  var q = JSON.parse(CacheService.getScriptCache().get('lakq') || '[]').map(function (r) { var o = {}; cols.slice(1).forEach(function (c, j) { o[c] = r[j]; }); o.log_id = '(antrean)'; return o; });
  return q.reverse().concat(out);
}
function apiLogAktivitas(ctx, d) {
  var dari = /^\d{4}-\d{2}-\d{2}$/.test(d.dari) ? d.dari : today_(), sampai = /^\d{4}-\d{2}-\d{2}$/.test(d.sampai) ? d.sampai : today_();
  var rows = kamBacaLog_(dari, 15000).filter(function (r) { var t = String(r.waktu).substring(0, 10); return t >= dari && t <= sampai; })
    .filter(function (r) { return (!d.uid || r.user_id === d.uid) && (!d.peran || r.peran === d.peran) && (!d.jenis || r.jenis === d.jenis); });
  var ux = userIdx_(), per = {};
  rows.forEach(function (r) {
    if (!r.user_id) return;
    var p = per[r.user_id] = per[r.user_id] || { uid: r.user_id, nama: r.nama || (ux[r.user_id] || {}).n || r.user_id, peran: r.peran, login: 0, gagal: 0, durasi: 0, kunjungan: 0, aksi: 0, halaman: {}, terakhir: '' };
    if (r.jenis === 'login') p.login++;
    else if (r.jenis === 'login_gagal' || r.jenis === 'login_ditolak') p.gagal++;
    else if (r.jenis === 'halaman') { p.durasi += num_(r.durasi_detik); p.kunjungan += num_(r.kunjungan, 1); p.halaman[r.halaman] = (p.halaman[r.halaman] || 0) + num_(r.durasi_detik); }
    else p.aksi++;
    if (String(r.waktu) > p.terakhir) p.terakhir = r.waktu;
  });
  var lastLogin = {}; DB.all('Users').forEach(function (u) { lastLogin[u.user_id] = u.last_login; });
  var seen = typeof seenAll_ === 'function' ? seenAll_(ux) : {};
  var ringkas = Object.keys(per).map(function (u) { var p = per[u]; p.teratas = Object.keys(p.halaman).sort(function (a, b) { return p.halaman[b] - p.halaman[a]; }).slice(0, 3); delete p.halaman; p.last_login = lastLogin[u] || ''; p.online = !!(seen[u] && Date.now() - seen[u].t < 300000); return p; })
    .sort(function (a, b) { return String(b.terakhir).localeCompare(String(a.terakhir)); });
  var hitung = {}; rows.forEach(function (r) { hitung[r.jenis] = (hitung[r.jenis] || 0) + 1; });
  return ok_({ dari: dari, sampai: sampai, total: rows.length, jenis: hitung, ringkas: ringkas, baris: rows.slice(0, 1500),
    durasiTugas: kamDurasiTugas_(dari, sampai, d.uid) });
}
/** Durasi pengerjaan kuis & tugas (dari data aktivitas) */
/** v3.1: tanggal lokal (WIB) dari ISO — percobaan kuis disimpan dalam UTC, jadi 00.00–07.00 WIB tidak lagi jatuh ke hari kemarin */
function kamTglLokal_(iso) { if (!iso) return ''; var d = new Date(iso); return isNaN(d.getTime()) ? String(iso).substring(0, 10) : Utilities.formatDate(d, APP.TZ, 'yyyy-MM-dd'); }
function kamDurasiTugas_(dari, sampai, uid) {
  var out = [], judul = {}; DB.all('KursusModul').forEach(function (m) { judul[m.modul_id] = m.judul; });
  if (SCHEMA.KuisPercobaan) DB.all('KuisPercobaan').forEach(function (p) { var t = kamTglLokal_(p.selesai); if (t >= dari && t <= sampai && (!uid || p.user_id === uid)) out.push({ jenis: 'Kuis', judul: judul[p.modul_id] || p.modul_id, uid: p.user_id, nama: lmsNama_(p.user_id), durasi_detik: num_(p.durasi_detik), waktu: p.selesai, nilai: p.nilai_maks ? round1_(num_(p.nilai) / num_(p.nilai_maks) * 100) : null }); });
  if (SCHEMA.TugasKirim) DB.all('TugasKirim').forEach(function (k) { var t = kamTglLokal_(k.dikirim_pada); if (k.dikirim_pada && t >= dari && t <= sampai && (!uid || k.user_id === uid)) out.push({ jenis: 'Tugas', judul: judul[k.modul_id] || k.modul_id, uid: k.user_id, nama: lmsNama_(k.user_id), durasi_detik: num_(k.durasi_detik), waktu: k.dikirim_pada, nilai: k.nilai === '' ? null : num_(k.nilai) }); });
  return out.sort(function (a, b) { return String(b.waktu).localeCompare(String(a.waktu)); }).slice(0, 300);
}

// ---------------------------------------------------------------------
// 6. LOGIN GOOGLE OAUTH 2.0 — SUPER ADMIN
// ---------------------------------------------------------------------
function kamVerifikasiGoogle_(idToken) {
  var cid = prop_('GOOGLE_CLIENT_ID');
  if (!cid) return { err: 'Login Google belum dikonfigurasi (GOOGLE_CLIENT_ID kosong).' };
  if (!/^[A-Za-z0-9._\-]{100,4096}$/.test(String(idToken || ''))) return { err: 'Token Google tidak valid.' };
  var r = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken), { muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) return { err: 'Token Google tidak valid atau kedaluwarsa.' };
  var p = JSON.parse(r.getContentText() || '{}');
  if (p.aud !== cid) return { err: 'Token Google bukan untuk aplikasi ini.' };
  if (['accounts.google.com', 'https://accounts.google.com'].indexOf(p.iss) === -1) return { err: 'Penerbit token tidak dikenal.' };
  if (String(p.email_verified) !== 'true') return { err: 'Email Google belum terverifikasi.' };
  if (Number(p.exp) * 1000 < Date.now()) return { err: 'Token Google kedaluwarsa.' };
  return { email: lower_(p.email), nama: p.name || '', foto: p.picture || '' };
}
function apiLoginGoogle(ctx, d) {
  var pol = kamKebijakan_();
  if (pol.saLoginMode === 'sandi') return fail_('Login Google untuk Super Admin belum diaktifkan.');
  var g = kamVerifikasiGoogle_(d.credential);
  if (g.err) { catatAktivitas_(ctx, 'login_gagal', 'login', 'google', 0, g.err); return fail_(g.err); }
  var u = DB.all('Users').filter(function (x) { return lower_(x.email) === g.email; })[0];
  if (!u || u.role !== 'superadmin') { catatAktivitas_(ctx, 'login_gagal', 'login', 'google', 0, 'Bukan Super Admin: ' + g.email.replace(/^(.{3}).*(@.*)$/, '$1***$2')); return fail_('Akun Google ' + g.email + ' tidak terdaftar sebagai Super Admin.'); }
  if (String(u.status_aktif).toUpperCase() !== 'YA') return fail_('Akun Super Admin dinonaktifkan.');
  var kunci = Number(prop_('SA_KUNCI_' + u.user_id) || 0);
  if (kunci > Date.now()) return fail_('Akun Super Admin dikunci sementara. Jalankan resetSuperAdmin() dari editor bila perlu.');
  var ipTolak = kamCekIp_('superadmin'); if (ipTolak) return ipTolak;
  setProp_('SA_GOOGLE_OK_' + u.user_id, String(Date.now()));
  var now = Date.now(), ttl = APP.SA_TTL_MS;
  var token = signToken_({ e: lower_(u.email), r: u.role, f: String(u.ref_id), u: u.user_id, i: now, x: now + ttl });
  touchLastLogin_(u);
  queueLog_([lower_(u.email), u.role, 'LOGIN_GOOGLE', '', '']);
  extSemua_('loginOk', u, ctx, 'google');
  var sess = { email: lower_(u.email), role: u.role, ref: String(u.ref_id), uid: u.user_id }, fakeCtx = { session: sess, user: userIdx_()[u.user_id], dev: ctx.dev || '' };
  markSeen_(fakeCtx);
  return ok_({ token: token, role: u.role, email: lower_(u.email), nama: u.nama, ref: String(u.ref_id), hak: String(u.hak_akses || ''), wajibGantiSandi: false, exp: now + ttl,
    boot: apiGuruBootstrap(fakeCtx, {}).data }, 'Selamat datang, ' + u.nama + '! (Google)');
}
kamKait_('publik', function (out) {
  var pol = kamKebijakan_(), cid = prop_('GOOGLE_CLIENT_ID');
  out.googleSa = !!cid && pol.saLoginMode !== 'sandi';
  out.googleClientId = out.googleSa ? cid : '';                // Client ID memang publik (dibutuhkan Google Identity Services)
  out.saLoginMode = pol.saLoginMode;
});

// ---------------------------------------------------------------------
// 7. PENGATURAN KEAMANAN LANJUTAN (Super Admin)
// ---------------------------------------------------------------------
function apiKeamananGet(ctx, d) {
  var pol = kamKebijakan_(), ip = kamIp_(), c = CacheService.getScriptCache();
  var sa = DB.all('Users').filter(function (u) { return u.role === 'superadmin'; }).map(function (u) { return { uid: u.user_id, nama: u.nama, email: u.email, google: !!prop_('SA_GOOGLE_OK_' + u.user_id), aktif: u.status_aktif === 'YA' }; });
  var log = kamBacaLog_(Utilities.formatDate(new Date(Date.now() - 864e5), APP.TZ, "yyyy-MM-dd'T'HH:mm:ss"), 4000);
  var gagal = log.filter(function (r) { return r.jenis === 'login_gagal' || r.jenis === 'login_ditolak'; });
  return ok_({ kebijakan: pol, googleClientId: !!prop_('GOOGLE_CLIENT_ID'), proxySecret: !!prop_('IP_PROXY_SECRET'), ipSekarang: ip, saGoogleSaya: !!prop_('SA_GOOGLE_OK_' + ctx.session.uid),
    superadmin: sa, enkripsi: !!prop_('ENC_KEY'), sesiJam: APP.TOKEN_TTL_MS / 3600e3, saSesiJam: APP.SA_TTL_MS / 3600e3,
    statistik24j: { login: log.filter(function (r) { return r.jenis === 'login'; }).length, gagal: gagal.length, spam: log.filter(function (r) { return r.jenis === 'spam'; }).length, batasLaju: log.filter(function (r) { return r.jenis === 'keamanan'; }).length },
    gagalTerakhir: gagal.slice(0, 20).map(function (r) { return { waktu: r.waktu, nama: r.nama, detail: r.detail, ip: r.ip }; }) });
}
function apiKeamananSimpan(ctx, d) {
  var p = d.kebijakan || {}, lama = kamKebijakan_(), baru = {};
  if (p.ipMode !== undefined) baru.ipMode = { mati: 1, sa: 1, staf: 1, semua: 1 }[p.ipMode] ? p.ipMode : 'mati';
  if (p.ipDaftar !== undefined) {
    var daftar = (Array.isArray(p.ipDaftar) ? p.ipDaftar : String(p.ipDaftar).split(/[\s,;]+/)).map(function (x) { return String(x).trim(); }).filter(String).slice(0, 100);
    var salah = daftar.filter(function (x) { var q = x.split('/'); return !kamIpBagian_(q[0]) || (q[1] !== undefined && !/^\d{1,3}$/.test(q[1])); });
    if (salah.length) return fail_('Format IP tidak valid: ' + salah.slice(0, 3).join(', '));
    baru.ipDaftar = daftar;
  }
  if (p.ipWajibProxy !== undefined) baru.ipWajibProxy = !!p.ipWajibProxy;
  if (p.rateMenit !== undefined) baru.rateMenit = Math.max(30, Math.min(1000, num_(p.rateMenit, 150)));
  if (p.idleMenit !== undefined) baru.idleMenit = Math.max(0, Math.min(360, num_(p.idleMenit)));
  if (p.spamMenit !== undefined) baru.spamMenit = Math.max(1, Math.min(60, num_(p.spamMenit, 8)));
  if (p.pesanMenit !== undefined) baru.pesanMenit = Math.max(1, Math.min(120, num_(p.pesanMenit, 25)));
  if (p.spamLink !== undefined) baru.spamLink = Math.max(0, Math.min(20, num_(p.spamLink, 3)));
  if (p.kataTerlarang !== undefined) baru.kataTerlarang = (Array.isArray(p.kataTerlarang) ? p.kataTerlarang : String(p.kataTerlarang).split(/[\n,]+/)).map(function (w) { return String(w).trim().toLowerCase(); }).filter(String).slice(0, 200);
  if (p.lacakHalaman !== undefined) baru.lacakHalaman = !!p.lacakHalaman;
  if (p.saLoginMode !== undefined) {
    baru.saLoginMode = { sandi: 1, keduanya: 1, google: 1 }[p.saLoginMode] ? p.saLoginMode : 'sandi';
    if (baru.saLoginMode !== 'sandi' && !prop_('GOOGLE_CLIENT_ID')) return fail_('Isi GOOGLE_CLIENT_ID di menu Keamanan terlebih dulu.');
    if (baru.saLoginMode === 'google' && !prop_('SA_GOOGLE_OK_' + ctx.session.uid)) return fail_('Demi mencegah terkunci: pilih "Sandi atau Google", lalu keluar dan masuk sekali dengan Google. Setelah berhasil, mode "Wajib Google" bisa diaktifkan.');
  }
  // cegah Super Admin mengunci dirinya sendiri dari jaringan saat ini
  var uji = Object.assign({}, lama, baru);
  if (kamPeranDibatasi_('superadmin', uji)) {
    var ip = kamIp_();
    if (!ip.sah) return fail_('Pembatasan IP untuk Super Admin hanya bisa diaktifkan saat Anda membuka aplikasi lewat alamat proxy (agar IP Anda terbaca & terverifikasi).');
    if (!kamIpCocok_(ip.ip, uji.ipDaftar)) return fail_('IP Anda saat ini (' + ip.ip + ') tidak ada di daftar — Anda akan terkunci. Tambahkan IP ini dulu.');
  }
  kamSimpanKebijakan_(baru);
  var res = ok_({ kebijakan: kamKebijakan_() }, 'Kebijakan keamanan disimpan.');
  res.auditDetail = 'Keamanan: ' + Object.keys(baru).join(', ');
  return res;
}
/** Keluarkan semua sesi seorang pengguna (dipakai dari Log Aktivitas) */
function apiKeamananKeluarkan(ctx, d) {
  var u = DB.find('Users', 'user_id', d.uid); if (!u) return fail_('Akun tidak ditemukan.');
  revokeAll_(lower_(u.email));
  catatAktivitas_(ctx, 'keamanan', 'keluarkan-sesi', u.user_id, 0, 'Semua sesi ' + u.nama + ' diakhiri');
  return ok_(null, 'Semua sesi ' + u.nama + ' diakhiri.');
}

EXT.routes.push(function (add) {
  add('login.google', apiLoginGoogle, 'public');
  add('track.kirim', apiTrackKirim, 'any');
  add('log.aktivitas', apiLogAktivitas, 'sa', false, { ttl: 30 });
  add('keamanan.get', apiKeamananGet, 'sa');
  add('keamanan.simpan', apiKeamananSimpan, 'sa', true, { audit: true });
  add('keamanan.keluarkan', apiKeamananKeluarkan, 'sa', true, { audit: true });
});
kamKait_('demoClear', function () { var sh = getSheet_('LogAktivitas'), last = sh.getLastRow(); if (last > 1) sh.getRange(2, 1, last - 1, sh.getLastColumn()).clearContent(); invalidateRows_('LogAktivitas'); CacheService.getScriptCache().remove('lakq'); });

if (typeof pasangEkstensi_ === 'function' && typeof SCHEMA !== 'undefined') pasangEkstensi_();

;
// ==== Branding.gs ====
/**
 * =====================================================================
 *  SIAKAD SISWA v3.0 — Branding.gs : Kustomisasi White-Label
 *  Nama aplikasi, tagline, logo (unggah seperti thumbnail), warna utama, teks kaki.
 *  Disimpan di sheet Config (bukan rahasia). Logo kecil disimpan sebagai data URL agar
 *  tampil seketika & tetap jalan di mode demo; logo besar disimpan di Drive (tautan publik).
 * =====================================================================
 */
var EXT = (typeof EXT !== 'undefined' && EXT) || { schema: {}, seed: [], routes: [], tick: [], reset: [], hooks: {} };
EXT.seed.push(
  ['APP_NAMA', 'SIAKAD SISWA', 'Nama aplikasi (white-label) — tampil di login, menu, judul tab'],
  ['APP_TAGLINE', 'Sistem Informasi Akademik Siswa', 'Tagline / slogan di bawah nama aplikasi'],
  ['APP_LOGO', '', 'Logo aplikasi (diunggah dari menu Branding)'],
  ['APP_WARNA', '#1E3A5F', 'Warna utama aplikasi (hex)'],
  ['APP_FOOTER', '', 'Teks kaki halaman login (kosong = bawaan)']
);
var BRAND_BAWAAN = { nama: 'SIAKAD SISWA', tagline: 'Sistem Informasi Akademik Siswa', logo: '', warna: '#1E3A5F', footer: '' };
function brandData_(cfg) {
  cfg = cfg || settings_();
  return { nama: cfg.APP_NAMA || BRAND_BAWAAN.nama, tagline: cfg.APP_TAGLINE || BRAND_BAWAAN.tagline, logo: cfg.APP_LOGO || '', warna: /^#[0-9a-fA-F]{6}$/.test(cfg.APP_WARNA || '') ? cfg.APP_WARNA : BRAND_BAWAAN.warna, footer: cfg.APP_FOOTER || '' };
}
(EXT.hooks.publik = EXT.hooks.publik || []).push(function (out, cfg) { out.brand = brandData_(cfg); });
(EXT.hooks.cfg = EXT.hooks.cfg || []).push(function (o, c) { var b = brandData_(c); o.APP_NAMA = b.nama; o.APP_TAGLINE = b.tagline; o.APP_LOGO = b.logo; o.APP_WARNA = b.warna; o.APP_FOOTER = b.footer; o.PESAN_ANTAR_SISWA = c.PESAN_ANTAR_SISWA || 'YA'; });

function apiBrandGet(ctx, d) { return ok_(brandData_()); }
function apiBrandSimpan(ctx, d) {
  var nama = String(d.nama || '').trim().substring(0, 40), tagline = String(d.tagline || '').trim().substring(0, 90);
  if (!nama) return fail_('Nama aplikasi wajib diisi.');
  var warna = /^#[0-9a-fA-F]{6}$/.test(d.warna || '') ? d.warna : BRAND_BAWAAN.warna;
  var pasang = { APP_NAMA: nama, APP_TAGLINE: tagline, APP_WARNA: warna, APP_FOOTER: String(d.footer || '').trim().substring(0, 120) };
  if (d.hapusLogo) pasang.APP_LOGO = '';
  else if (d.logo && d.logo.data) {
    var mime = String(d.logo.mime || '').toLowerCase();
    if (!/^image\/(png|jpeg|webp|svg\+xml|gif)$/.test(mime)) return fail_('Logo harus berupa gambar PNG, JPG, WEBP, GIF, atau SVG.');
    var b64 = String(d.logo.data).replace(/^data:[^,]+,/, ''), ukuran = Math.floor(b64.length * 3 / 4);
    if (ukuran > 1048576) return fail_('Ukuran logo maksimal 1 MB.');
    if (mime === 'image/svg+xml') {
      var svg = Utilities.newBlob(Utilities.base64Decode(b64)).getDataAsString();
      if (/<script|on\w+\s*=|javascript:|<foreignObject/i.test(svg)) return fail_('Logo SVG mengandung skrip — gunakan SVG biasa atau PNG.');
    }
    var dataUrl = 'data:' + mime + ';base64,' + b64;
    if (dataUrl.length <= 45000) pasang.APP_LOGO = dataUrl;
    else {
      var f = saveBase64File_(CONFIG.ASET_FOLDER || CONFIG.ROOT_FOLDER_ID, 'logo-aplikasi-' + Date.now() + '.' + (mime.split('/')[1] || 'png').replace('svg+xml', 'svg').replace('jpeg', 'jpg'), mime, b64);
      shareLink_(f);
      pasang.APP_LOGO = 'https://drive.google.com/thumbnail?id=' + f.getId() + '&sz=w512';
    }
  }
  saveSettings_(pasang);
  var res = ok_(brandData_(), 'Branding aplikasi disimpan. Semua pengguna melihat tampilan baru saat memuat ulang.');
  res.auditDetail = 'Branding: ' + nama + (pasang.APP_LOGO !== undefined ? (pasang.APP_LOGO ? ' + logo baru' : ' (logo dihapus)') : '');
  return res;
}
EXT.routes.push(function (add) {
  add('brand.get', apiBrandGet, 'public');
  add('brand.simpan', apiBrandSimpan, 'sa', true, { audit: true });
});

if (typeof pasangEkstensi_ === 'function' && typeof SCHEMA !== 'undefined') pasangEkstensi_();

;
// ==== Laporan.gs ====
/**
 * =====================================================================
 *  SIAKAD SISWA v3.1 — Laporan.gs : Data Rekap Absensi & Nilai (berkas PDF/Excel)
 *  Server hanya MENGHITUNG & mengirim data rekap (1 kali baca sheet, di-cache).
 *  Berkas PDF (jsPDF) & Excel .xlsx (ExcelJS) dibuat di browser → tanpa kuota Drive,
 *  tanpa menulis apa pun ke spreadsheet. Logika hari efektif sama dengan menu Laporan:
 *  hari efektif = tanggal kelas itu punya catatan absensi; tanpa catatan = Alpha.
 * =====================================================================
 */
var EXT = (typeof EXT !== 'undefined' && EXT) || { schema: {}, seed: [], routes: [], tick: [], reset: [], hooks: {} };
EXT.seed.push(
  ['KEPALA_SEKOLAH', '', 'Nama kepala sekolah (penanda tangan laporan PDF)'],
  ['NIP_KEPALA_SEKOLAH', '', 'NIP kepala sekolah (penanda tangan laporan PDF)'],
  ['KOTA_LAPORAN', '', 'Kota pada tanggal tanda tangan laporan (kosong = diambil dari alamat sekolah)']
);
var LAP_KONFIG = /^(KEPALA_SEKOLAH|NIP_KEPALA_SEKOLAH|KOTA_LAPORAN)$/;

function lapTgl_(s, def) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? String(s) : def; }
function lapSekolah_() {
  var c = settings_(), alamat = c.ALAMAT_SEKOLAH || '';
  var kota = c.KOTA_LAPORAN || (String(alamat).split(',').map(function (x) { return x.trim(); }).filter(Boolean).pop() || '').replace(/\d+/g, '').trim();
  return { nama: c.NAMA_SEKOLAH || APP.NAME, alamat: alamat, logo: c.APP_LOGO || c.LOGO_URL || '', kota: kota,
    kepala: c.KEPALA_SEKOLAH || '', nip_kepala: c.NIP_KEPALA_SEKOLAH || '', tahun_ajaran: c.TAHUN_AJARAN || '', semester: c.SEMESTER || '',
    kkm: num_(c.KKM, 70), batas_hadir: num_(c.BATAS_KEHADIRAN, 75), bobot: { harian: num_(c.BOBOT_HARIAN, 40), uts: num_(c.BOBOT_UTS, 30), uas: num_(c.BOBOT_UAS, 30) },
    semester_mulai: c.SEMESTER_MULAI || '', semester_selesai: c.SEMESTER_SELESAI || '', aplikasi: c.APP_NAMA || APP.NAME };
}

/**
 * laporan.rekap — d: { jenis: absensi|nilai|lengkap, kelas_id?, NIS?, dari?, sampai?, tahun_ajaran?, semester? }
 * Hasil: identitas sekolah, kelas (+wali), siswa, rekap absensi (kode harian ringkas), nilai per mapel + peringkat.
 */
function apiLaporanRekap(ctx, d) {
  var sk = lapSekolah_(), jenis = /^(absensi|nilai|lengkap)$/.test(d.jenis) ? d.jenis : 'lengkap';
  var hariIni = today_(), semSelesai = lapTgl_(sk.semester_selesai, hariIni);
  var dari = lapTgl_(d.dari, lapTgl_(sk.semester_mulai, hariIni.substring(0, 8) + '01'));
  var sampai = lapTgl_(d.sampai, semSelesai < hariIni ? semSelesai : hariIni);
  if (dari > sampai) return fail_('Tanggal awal periode harus sebelum tanggal akhir.');
  var ta = String(d.tahun_ajaran || sk.tahun_ajaran), sem = String(d.semester || sk.semester);
  var nisReq = String(d.NIS || '').trim(), kelasReq = String(d.kelas_id || '').trim();

  var siswa = DB.all('Siswa').filter(function (s) {
    if (nisReq) return String(s.NIS) === nisReq;
    return (s.status || 'Aktif') === 'Aktif' && (!kelasReq || s.kelas_id === kelasReq);
  });
  if (!siswa.length) return fail_(nisReq ? 'Siswa dengan NIS ' + nisReq + ' tidak ditemukan.' : 'Tidak ada siswa aktif pada pilihan ini.');
  var kelasMap = {}, guruMap = {};
  DB.all('Kelas').forEach(function (k) { kelasMap[k.kelas_id] = k; });
  DB.all('Guru').forEach(function (g) { guruMap[g.NUPTK] = g; });
  siswa.sort(function (a, b) {
    var ka = (kelasMap[a.kelas_id] || {}).nama_kelas || a.kelas_id, kb = (kelasMap[b.kelas_id] || {}).nama_kelas || b.kelas_id;
    return String(ka).localeCompare(String(kb), 'id') || String(a.nama_lengkap).localeCompare(String(b.nama_lengkap), 'id');
  });
  var nisSet = {}, kelasIds = [];
  siswa.forEach(function (s) { nisSet[s.NIS] = s; if (kelasIds.indexOf(s.kelas_id) === -1) kelasIds.push(s.kelas_id); });
  var kelas = kelasIds.map(function (id) {
    var k = kelasMap[id] || { kelas_id: id, nama_kelas: id }, w = guruMap[k.wali_kelas_id] || {};
    return { kelas_id: id, nama_kelas: k.nama_kelas || id, jenjang: k.jenjang || '', tingkat: k.tingkat || '', wali: w.nama_lengkap || '', wali_nuptk: w.NUPTK || '' };
  });
  var out = { jenis: jenis, sekolah: sk, periode: { dari: dari, sampai: sampai }, tahun_ajaran: ta, semester: sem, perorangan: !!nisReq, dibuat: nowIso_(),
    pembuat: (userIdx_()[ctx.session.uid] || {}).n || ctx.session.email, kelas: kelas,
    siswa: siswa.map(function (s) { return { NIS: s.NIS, NISN: s.NISN || '', nama: s.nama_lengkap, jk: s.jenis_kelamin || '', kelas_id: s.kelas_id, jenjang: s.jenjang || '',
      tempat_lahir: s.tempat_lahir || '', tanggal_lahir: s.tanggal_lahir || '', nama_ortu: s.nama_ortu || '', kode_kartu: s.barcode_id || '' }; }) };

  // ------------------------------------------------ ABSENSI (1× baca sheet)
  if (jenis !== 'nilai') {
    var hariKelas = {}, rec = {};
    DB.all('Absensi').forEach(function (a) {
      var t = String(a.tanggal); if (t < dari || t > sampai) return;
      var s = nisSet[a.NIS], k = a.kelas_id || (s && s.kelas_id) || '-';
      if (kelasIds.indexOf(k) === -1 && !s) return;
      (hariKelas[k] = hariKelas[k] || {})[t] = 1;
      if (s) (rec[a.NIS] = rec[a.NIS] || {})[t] = a;
    });
    var hari = {}; kelasIds.forEach(function (k) { hari[k] = Object.keys(hariKelas[k] || {}).sort(); });
    var rekap = {}, kode = {}, log = {};
    siswa.forEach(function (s) {
      var days = hari[s.kelas_id] || [], r = { H: 0, T: 0, I: 0, S: 0, A: 0, hari: days.length }, kd = '';
      days.forEach(function (t) {
        var a = (rec[s.NIS] || {})[t], st = a ? String(a.status || '').charAt(0).toUpperCase() : 'A';
        if (!/^[HISA]$/.test(st)) st = 'A';
        var tl = st === 'H' && a && String(a.terlambat).toUpperCase() === 'YA';
        r[st]++; if (tl) r.T++;
        kd += tl ? 'T' : st;
      });
      // catatan di luar hari efektif kelas (mis. pindah kelas) tetap dihitung
      Object.keys(rec[s.NIS] || {}).forEach(function (t) { if (days.indexOf(t) === -1) { var a = rec[s.NIS][t], st = String(a.status || '').charAt(0).toUpperCase(); if (/^[HISA]$/.test(st)) { r[st]++; r.hari++; } } });
      r.persen = r.hari ? round1_(r.H / r.hari * 100) : null;
      rekap[s.NIS] = r; kode[s.NIS] = kd;
      if (nisReq) log[s.NIS] = days.map(function (t) { var a = (rec[s.NIS] || {})[t]; return a ? { tanggal: t, status: a.status, jam: String(a.jam || '').substring(0, 5), metode: a.metode || '', keterangan: a.keterangan || '', terlambat: String(a.terlambat).toUpperCase() === 'YA' } : { tanggal: t, status: 'Alpha', jam: '', metode: '', keterangan: 'Tanpa keterangan (tidak tercatat)', terlambat: false }; });
    });
    out.absensi = { hari: hari, rekap: rekap, kode: kode, log: log };
  }

  // ------------------------------------------------ NILAI (raport: harian, UTS, UAS, akhir, predikat)
  if (jenis !== 'absensi') {
    var urutMapel = [], kodeMapel = {}, mapel = [], baris = {}, kelasRank = {};
    DB.all('Mapel').forEach(function (m) { urutMapel.push(m.nama); if (m.kode) kodeMapel[m.nama] = String(m.kode); });
    DB.all('Nilai').forEach(function (n) {
      if (String(n.tahun_ajaran) !== ta || String(n.semester) !== sem) return;
      var s = nisSet[n.NIS], mp = String(n.mata_pelajaran || ''); if (!mp) return;
      // peringkat dihitung terhadap seluruh kelas yang sama (bukan hanya siswa terpilih)
      if (n.nilai_akhir !== '' && (s || kelasIds.indexOf(n.kelas_id) > -1)) { var kr = kelasRank[n.kelas_id || (s && s.kelas_id)] = kelasRank[n.kelas_id || (s && s.kelas_id)] || {}; var x = kr[n.NIS] = kr[n.NIS] || [0, 0]; x[0] += num_(n.nilai_akhir); x[1]++; }
      if (!s) return;
      if (mapel.indexOf(mp) === -1) mapel.push(mp);
      (baris[n.NIS] = baris[n.NIS] || {})[mp] = { harian: n.nilai_harian === '' ? '' : num_(n.nilai_harian), uts: n.nilai_uts === '' ? '' : num_(n.nilai_uts), uas: n.nilai_uas === '' ? '' : num_(n.nilai_uas),
        akhir: n.nilai_akhir === '' ? '' : num_(n.nilai_akhir), predikat: n.predikat || predikat_(n.nilai_akhir === '' ? '' : num_(n.nilai_akhir)), catatan: n.catatan || '' };
    });
    mapel.sort(function (a, b) { var ia = urutMapel.indexOf(a), ib = urutMapel.indexOf(b); return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || a.localeCompare(b, 'id'); });
    var peringkat = {}, jmlKelas = {};
    Object.keys(kelasRank).forEach(function (k) {
      var list = Object.keys(kelasRank[k]).map(function (nis) { return { nis: nis, rata: kelasRank[k][nis][0] / kelasRank[k][nis][1] }; }).sort(function (a, b) { return b.rata - a.rata; });
      jmlKelas[k] = list.length;
      list.forEach(function (x, i) { if (nisSet[x.nis] && (nisSet[x.nis].kelas_id === k || !peringkat[x.nis])) peringkat[x.nis] = { ke: i + 1, dari: list.length, rata: round1_(x.rata) }; });
    });
    out.nilai = { mapel: mapel, kode: kodeMapel, baris: baris, peringkat: peringkat };
  }
  return ok_(out);
}

/** Penanda tangan bawaan (Super Admin) — disimpan di sheet Config (baris yang sudah ada) */
function apiLaporanTtd(ctx, d) {
  var clean = {};
  Object.keys(d || {}).forEach(function (k) { if (LAP_KONFIG.test(k)) clean[k] = String(d[k] || '').trim().substring(0, 120); });
  if (!Object.keys(clean).length) return fail_('Tidak ada yang disimpan.');
  saveSettings_(clean);
  return ok_(clean, 'Penanda tangan laporan disimpan.');
}

EXT.routes.push(function (add) {
  add('laporan.rekap', apiLaporanRekap, 'guru', false, { ttl: 300 });     // cache 5 menit, basi otomatis saat ada data baru
  add('laporan.ttd', apiLaporanTtd, 'sa', true, { audit: true });
});


/**
 * UPDATE KE v3.1 — jalankan SEKALI dari editor (opsional, aman diulang).
 * Hanya menambah 3 baris pengaturan penanda tangan laporan di sheet Config (bila belum ada),
 * memanaskan cache, lalu menampilkan cek performa. Tidak mengubah data yang sudah ada.
 */
function setupV31() {
  resetMemo_();
  if (!prop_('SPREADSHEET_ID')) { Logger.log('⚠️ Belum ada setup. Jalankan setupAppEnvironment() dulu.'); return; }
  Logger.log('🔧 Update ke v' + APP.VERSION + ' (Turbo LMS, Laporan PDF/Excel, QR Code) ...');
  upgradeSchema(true);
  try { Logger.log('🔥 Warmup: ' + warmCaches_('setup')); } catch (e) { Logger.log('⚠️ Warmup: ' + e.message); }
  setProp_('V31_SIAP', APP.VERSION);
  Logger.log('✅ Selesai. Lanjutkan: Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy.');
  if (typeof cekPerforma === 'function') cekPerforma();
}
if (typeof pasangEkstensi_ === 'function' && typeof SCHEMA !== 'undefined') pasangEkstensi_();

;
// ==== LmsDemo.gs ====
/**
 * =====================================================================
 *  SIAKAD SISWA v3.0 — LmsDemo.gs : DATA CONTOH LMS (OPSIONAL)
 *  Dipakai otomatis bila data contoh sekolah terpasang (setupAppEnvironment / setupV30).
 *  Boleh tidak ditempel di server produksi — semua modul tetap berjalan tanpa file ini.
 * =====================================================================
 */
var EXT = (typeof EXT !== 'undefined' && EXT) || { schema: {}, seed: [], routes: [], tick: [], reset: [], hooks: {} };
(EXT.hooks.seedDemo = EXT.hooks.seedDemo || []).push(function (rnd) { seedDemoV3_(rnd); });

function seedDemoV3_(rnd) {
  rnd = rnd || prng_(20261015);
  if (DB.all('Kursus').length) return;
  var base = new Date(), now = nowIso_();
  var iso = function (hari, jam) { return Utilities.formatDate(new Date(base.getTime() - hari * 864e5 - (jam || 0) * 3600e3), APP.TZ, "yyyy-MM-dd'T'HH:mm:ssXXX"); };
  var lokal = function (hari, jamStr) { return Utilities.formatDate(new Date(base.getTime() + hari * 864e5), APP.TZ, 'yyyy-MM-dd') + 'T' + (jamStr || '07:00'); };
  var by = {}; DB.all('Users').forEach(function (u) { by[lower_(u.email)] = u; });
  var guru = by['guru@sekolah.sch.id'], mul = by['mulyadi@sekolah.sch.id'], sa = by['admin@sekolah.sch.id'], siswaU = by['siswa@sekolah.sch.id'];
  if (!guru || !siswaU) return;
  var G = guru.user_id, AH = siswaU.user_id;
  var kls1 = DB.all('Users').filter(function (u) { return u.role === 'siswa' && u.kelas_id === 'KLS000001' && u.status_aktif === 'YA'; }).map(function (u) { return u.user_id; });
  var lain = kls1.filter(function (u) { return u !== AH; });
  function J(o) { return JSON.stringify(o); }
  function pilih(arr) { return arr[Math.floor(rnd() * arr.length)]; }

  // ------------------------------------------------------------ Rubrik & panduan penilaian
  var rbIds = reserveIds_('Rubrik', 2);
  DB.appendBatch('Rubrik', [
    { rubrik_id: rbIds[0], nama: 'Rubrik Poster Kesehatan', jenis: 'rubrik', pemilik: G, dibuat_pada: now, diperbarui_pada: now, kriteria: J([
      { id: 'C1', nama: 'Ketepatan isi', level: [{ deskripsi: 'Banyak konsep keliru', skor: 1 }, { deskripsi: 'Sebagian kecil keliru', skor: 2 }, { deskripsi: 'Benar, kurang lengkap', skor: 3 }, { deskripsi: 'Benar & lengkap', skor: 4 }] },
      { id: 'C2', nama: 'Desain visual', level: [{ deskripsi: 'Sulit dibaca', skor: 1 }, { deskripsi: 'Cukup rapi', skor: 2 }, { deskripsi: 'Menarik', skor: 3 }, { deskripsi: 'Sangat menarik & komunikatif', skor: 4 }] },
      { id: 'C3', nama: 'Pesan pencegahan', level: [{ deskripsi: 'Tidak ada', skor: 1 }, { deskripsi: 'Umum', skor: 2 }, { deskripsi: 'Jelas', skor: 3 }, { deskripsi: 'Jelas, konkret & berbasis data', skor: 4 }] },
      { id: 'C4', nama: 'Sumber rujukan', level: [{ deskripsi: 'Tanpa sumber', skor: 1 }, { deskripsi: '1 sumber', skor: 2 }, { deskripsi: '2 sumber', skor: 3 }, { deskripsi: '≥3 sumber kredibel', skor: 4 }] }]) },
    { rubrik_id: rbIds[1], nama: 'Panduan Penilaian Esai Singkat', jenis: 'panduan', pemilik: G, dibuat_pada: now, diperbarui_pada: now, kriteria: J([
      { id: 'C1', nama: 'Gagasan utama', deskripsi: 'Tesis jelas di paragraf pertama', maks: 10 }, { id: 'C2', nama: 'Argumen & bukti', deskripsi: 'Minimal 2 alasan didukung fakta', maks: 15 }, { id: 'C3', nama: 'Bahasa', deskripsi: 'Ejaan & kalimat efektif', maks: 5 }]) }
  ]);

  // ------------------------------------------------------------ KURSUS 1: Biologi (format Topik)
  var K1 = reserveIds_('Kursus', 3), k1 = K1[0], k2 = K1[1], k3 = K1[2];
  var ta = setting_('SEMESTER_MULAI', today_());
  DB.appendBatch('Kursus', [
    { kursus_id: k1, kode: 'BIO-XII-3', nama: 'Biologi XII — Sistem Peredaran Darah', ringkasan: 'Kursus daring Bab 3: struktur jantung & pembuluh darah, komponen darah, kelainan sistem peredaran, dan proyek kampanye kesehatan. Selesaikan kuis, tugas poster, dan pelajaran interaktif untuk lulus kursus.',
      mapel: 'Biologi', kelas_ids: 'KLS000001', pengajar: G, format: 'topik', tgl_mulai: ta, jml_seksi: 3, warna: '#0F766E', status: 'Aktif', mode_grup: 'tanpa', syarat_lulus: '', skala_id: '', tampil_nilai: 'YA', dibuat_oleh: G, dibuat_pada: iso(20), diperbarui_pada: now },
    { kursus_id: k2, kode: 'MAT-XII', nama: 'Matematika Wajib XII — Limit & Turunan', ringkasan: 'Kursus mingguan: materi, latihan, dan kuis setiap pekan.', mapel: 'Matematika Wajib', kelas_ids: 'KLS000001', pengajar: mul ? mul.user_id : G,
      format: 'mingguan', tgl_mulai: ta, jml_seksi: 6, warna: '#1D4ED8', status: 'Aktif', mode_grup: 'tanpa', syarat_lulus: '{}', skala_id: '', tampil_nilai: 'YA', dibuat_oleh: mul ? mul.user_id : G, dibuat_pada: iso(30), diperbarui_pada: now },
    { kursus_id: k3, kode: 'KLUB-SAINS', nama: 'Klub Sains — Ruang Diskusi', ringkasan: 'Ruang kolaborasi lintas kelas untuk berbagi eksperimen, ide lomba, dan tanya-jawab sains.', mapel: '', kelas_ids: 'KLS000001,KLS000002', pengajar: G,
      format: 'sosial', tgl_mulai: ta, jml_seksi: 0, warna: '#7C3AED', status: 'Aktif', mode_grup: 'tanpa', syarat_lulus: '{}', skala_id: '', tampil_nilai: 'TIDAK', dibuat_oleh: G, dibuat_pada: iso(25), diperbarui_pada: now }
  ]);
  var S = reserveIds_('KursusSeksi', 4 + 7 + 1);
  var seksi = [
    [S[0], k1, 0, 'Umum', 'Pengumuman, silabus, dan jadwal kelas virtual.', ''],
    [S[1], k1, 1, 'Topik 1 · Jantung & Pembuluh Darah', 'Struktur jantung, jenis pembuluh darah, dan komponen darah.', ''],
    [S[2], k1, 2, 'Topik 2 · Kelainan Sistem Peredaran Darah', 'Hipertensi, anemia, dan gaya hidup sehat.', 'KUIS1'],
    [S[3], k1, 3, 'Topik 3 · Proyek Akhir', 'Esai mini penilaian sejawat & evaluasi pembelajaran.', '']
  ];
  for (var w = 0; w <= 6; w++) seksi.push([S[4 + w], k2, w, w === 0 ? 'Umum' : lmsJudulPekan_(ta, w), w === 1 ? 'Konsep limit fungsi aljabar.' : '', '']);
  seksi.push([S[11], k3, 0, 'Ruang Diskusi Kelas', 'Bebas berdiskusi — jaga etika & sopan santun.', '']);
  var M = reserveIds_('KursusModul', 30), mi = 0, mods = [];
  function mod(kid, sid, urut, tipe, judul, desk, konten, opt) {
    opt = opt || {};
    var id = M[mi++];
    mods.push({ modul_id: id, kursus_id: kid, seksi_id: sid, urutan: urut, tipe: tipe, judul: judul, deskripsi: desk || '', konten: J(konten), tampil: 'YA', syarat: opt.syarat ? J(opt.syarat) : '',
      penyelesaian: J(opt.selesai || { mode: LMS_SELESAI_BAWAAN[tipe] }), grouping_id: opt.grouping || '', mode_grup: opt.mode_grup || '', nilai_maks: opt.nilai || 0, kategori_id: opt.kat || '', bobot: opt.bobot || 1,
      buka: opt.buka || '', tutup: opt.tutup || '', dibuat_oleh: G, dibuat_pada: iso(18), diperbarui_pada: now });
    return id;
  }
  var mBerita = mod(k1, S[0], 1, 'forum', 'Pengumuman Kursus', '', { jenis: 'berita', lampiran: true }, { selesai: { mode: 'tidak' } });
  mod(k1, S[0], 2, 'label', 'Label', '', { isi: '👋 Selamat datang di kursus **Biologi XII**! Kerjakan aktivitas secara berurutan. Topik 2 terbuka setelah nilai **Kuis 1 ≥ 60**.', gaya: 'info' }, { selesai: { mode: 'tidak' } });
  var mSilabus = mod(k1, S[0], 3, 'halaman', 'Silabus & Tata Tertib Kelas Daring', 'Baca sebelum memulai.', { isi: '## Tujuan Pembelajaran\n1. Menjelaskan struktur & fungsi jantung serta pembuluh darah.\n2. Membedakan peredaran darah besar dan kecil.\n3. Menganalisis kelainan sistem peredaran darah dan cara pencegahannya.\n\n## Penilaian\n- Kuis & latihan **40%**\n- Tugas & proyek **40%**\n- Partisipasi forum **20%**\n\n## Tata tertib\n- Kirim tugas sebelum batas waktu.\n- Gunakan bahasa yang sopan di forum.\n- Plagiarisme = nilai 0.' }, { selesai: { mode: 'lihat' } });
  var mKv = mod(k1, S[0], 4, 'kelasvirtual', 'Kelas Virtual: Pembahasan Kuis 1', 'Sesi tatap maya via Google Meet.', { platform: 'meet', link: 'https://meet.google.com/abc-defg-hij', mulai: lokal(1, '09:00'), durasi: 60, rekaman: '', catatan: 'Siapkan pertanyaan tentang soal yang sulit.' });
  var mPdf = mod(k1, S[1], 1, 'berkas', 'Modul Sistem Peredaran Darah (PDF)', 'Bacaan utama Topik 1.', { berkas: { id: '', nama: 'peredaran-darah.pdf', mime: 'application/pdf', ukuran: 4800, url: 'demo/peredaran-darah.pdf' }, tampil: 'sematkan' });
  var mVid = mod(k1, S[1], 2, 'url', 'Video: Cara Kerja Jantung Manusia', 'Tonton sebelum mengerjakan pelajaran interaktif.', { url: 'https://www.youtube.com/results?search_query=cara+kerja+jantung+manusia', buka: 'tab' });
  var mFolder = mod(k1, S[1], 3, 'folder', 'Lembar Kerja Praktikum', 'Unduh LKS & format laporan.', { berkas: [{ id: '', nama: 'LKS-Praktikum-Denyut-Nadi.pdf', mime: 'application/pdf', ukuran: 4800, url: 'demo/peredaran-darah.pdf' }, { id: '', nama: 'Format-Laporan-Praktikum.pdf', mime: 'application/pdf', ukuran: 4800, url: 'demo/peredaran-darah.pdf' }] });
  var mPel = mod(k1, S[1], 4, 'pelajaran', 'Pelajaran Interaktif: Perjalanan Sel Darah Merah', 'Ikuti perjalanan eritrosit — jawaban salah membawa Anda ke halaman penguatan.', { nilai_min: 70, percobaan_maks: 0, halaman: [
    { id: 'H1', judul: 'Berangkat dari Ventrikel Kiri', tipe: 'konten', isi: 'Kamu adalah **sel darah merah** yang baru saja diisi oksigen di paru-paru. Sekarang kamu berada di **ventrikel kiri** — bilik jantung dengan dinding paling tebal.', opsi: [], tombol: [{ label: 'Lanjut', ke: 'lanjut' }] },
    { id: 'H2', judul: 'Pintu keluar', tipe: 'soal', isi: 'Ventrikel kiri berkontraksi! Melalui pembuluh apa kamu keluar dari jantung?', tombol: [], opsi: [{ teks: 'Aorta', benar: true, lompat: 'H4', umpan: 'Tepat! Aorta adalah arteri terbesar.' }, { teks: 'Vena cava superior', benar: false, lompat: 'H3', umpan: 'Vena cava justru membawa darah MASUK ke jantung.' }, { teks: 'Arteri pulmonalis', benar: false, lompat: 'H3', umpan: 'Arteri pulmonalis keluar dari ventrikel KANAN menuju paru-paru.' }] },
    { id: 'H3', judul: 'Penguatan: Arteri vs Vena', tipe: 'konten', isi: '- **Arteri** membawa darah *keluar* dari jantung.\n- **Vena** membawa darah *masuk* ke jantung.\n- Dari ventrikel kiri → **aorta** → seluruh tubuh.', opsi: [], tombol: [{ label: 'Coba lagi', ke: 'H2' }] },
    { id: 'H4', judul: 'Di kapiler jaringan', tipe: 'soal', isi: 'Kamu tiba di kapiler otot kaki. Zat apa yang kamu lepaskan ke sel-sel otot?', tombol: [], opsi: [{ teks: 'Oksigen', benar: true, lompat: 'lanjut', umpan: 'Benar! Oksigen dilepas, karbon dioksida diikat.' }, { teks: 'Karbon dioksida', benar: false, lompat: 'lanjut', umpan: 'Kebalikannya — CO₂ justru kamu angkut dari jaringan.' }, { teks: 'Hormon insulin', benar: false, lompat: 'lanjut', umpan: 'Eritrosit tidak mengangkut insulin.' }] },
    { id: 'H5', judul: 'Pulang ke jantung', tipe: 'konten', isi: 'Kamu kembali melalui **vena cava** ke **atrium kanan**, siap menuju paru-paru lagi. Satu putaran peredaran darah besar selesai! 🎉', opsi: [], tombol: [{ label: 'Selesai', ke: 'akhir' }] }] },
    { nilai: 100, kat: 'KAT1', selesai: { mode: 'lulus', nilai_min: 70 } });

  // Bank soal Biologi
  var soal = [
    ['pg', 'Bilik jantung yang memompa darah ke seluruh tubuh adalah…', { opsi: [{ id: 'o1', teks: 'Atrium kanan', benar: false }, { id: 'o2', teks: 'Atrium kiri', benar: false }, { id: 'o3', teks: 'Ventrikel kanan', benar: false, umpan: 'Ventrikel kanan memompa ke paru-paru.' }, { id: 'o4', teks: 'Ventrikel kiri', benar: true, umpan: 'Benar — dindingnya paling tebal.' }] }, 1, 'Jantung'],
    ['pgk', 'Manakah yang termasuk pembuluh darah? (pilih semua yang benar)', { opsi: [{ id: 'o1', teks: 'Arteri', benar: true }, { id: 'o2', teks: 'Vena', benar: true }, { id: 'o3', teks: 'Kapiler', benar: true }, { id: 'o4', teks: 'Alveolus', benar: false }, { id: 'o5', teks: 'Bronkus', benar: false }] }, 2, 'Pembuluh'],
    ['bs', 'Vena pulmonalis membawa darah kaya oksigen dari paru-paru ke jantung.', { benar: true }, 1, 'Pembuluh'],
    ['cocok', 'Cocokkan komponen darah dengan fungsinya.', { pasangan: [{ kiri: 'Eritrosit', kanan: 'Mengangkut oksigen' }, { kiri: 'Leukosit', kanan: 'Melawan infeksi' }, { kiri: 'Trombosit', kanan: 'Pembekuan darah' }, { kiri: 'Plasma darah', kanan: 'Mengangkut sari makanan' }], pengecoh: ['Menghasilkan hormon'] }, 2, 'Darah'],
    ['singkat', 'Protein pengikat oksigen yang memberi warna merah pada eritrosit disebut…', { jawaban: [{ teks: 'hemoglobin', nilai: 100 }, { teks: 'haemoglobin', nilai: 100 }, { teks: 'hb', nilai: 80 }] }, 1, 'Darah'],
    ['dragdrop', 'Lengkapi alur peredaran darah kecil berikut.', { teks: 'Darah dari seluruh tubuh masuk ke [[1]] melalui vena cava, lalu dipompa dari [[2]] menuju paru-paru.', pilihan: ['atrium kanan', 'ventrikel kanan', 'ventrikel kiri', 'atrium kiri'] }, 2, 'Jantung'],
    ['esai', 'Jelaskan perbedaan peredaran darah besar dan peredaran darah kecil!', { panduan: 'Skor penuh bila menyebut: jalur (ventrikel kiri→tubuh vs ventrikel kanan→paru), fungsi, dan pembuluh yang dilalui.' }, 3, 'Jantung'],
    ['pg', 'Tekanan darah normal orang dewasa adalah sekitar…', { opsi: [{ id: 'o1', teks: '120/80 mmHg', benar: true }, { id: 'o2', teks: '90/40 mmHg', benar: false }, { id: 'o3', teks: '160/100 mmHg', benar: false }, { id: 'o4', teks: '200/120 mmHg', benar: false }] }, 1, 'Kelainan']
  ];
  var mat = [
    ['pg', 'Nilai dari lim(x→∞) (3x² + 2x)/(x² − 5) adalah…', { opsi: [{ id: 'o1', teks: '0', benar: false }, { id: 'o2', teks: '2', benar: false }, { id: 'o3', teks: '3', benar: true }, { id: 'o4', teks: '∞', benar: false }] }, 1, 'Limit'],
    ['pg', 'lim(x→∞) (2x + 1)/(x² + 4) = …', { opsi: [{ id: 'o1', teks: '0', benar: true }, { id: 'o2', teks: '1/2', benar: false }, { id: 'o3', teks: '2', benar: false }, { id: 'o4', teks: '∞', benar: false }] }, 1, 'Limit'],
    ['singkat', 'Turunan pertama dari f(x) = x³ adalah…', { jawaban: [{ teks: '3x^2', nilai: 100 }, { teks: '3x²', nilai: 100 }, { teks: '3 x^2', nilai: 100 }] }, 1, 'Turunan']
  ];
  var sid = reserveIds_('BankSoal', soal.length + mat.length);
  var soalRows = soal.map(function (q, i) { return { soal_id: sid[i], kursus_id: k1, kategori: q[4], tipe: q[0], teks: q[1], data: J(q[2]), skor: q[3], umpan_balik: i === 0 ? 'Ingat: ventrikel kiri → aorta → seluruh tubuh.' : '', pemilik: G, dibuat_pada: iso(19), diperbarui_pada: iso(19) }; })
    .concat(mat.map(function (q, i) { return { soal_id: sid[soal.length + i], kursus_id: k2, kategori: q[4], tipe: q[0], teks: q[1], data: J(q[2]), skor: q[3], umpan_balik: '', pemilik: mul ? mul.user_id : G, dibuat_pada: iso(28), diperbarui_pada: iso(28) }; }));
  DB.appendBatch('BankSoal', soalRows);
  var kuisKonten = { soal: soal.slice(0, 7).map(function (q, i) { return { soal_id: sid[i], skor: q[3] }; }), ambil_acak: 0, acak_soal: true, acak_opsi: true, waktu_menit: 20, percobaan_maks: 2, metode_nilai: 'tertinggi', tampil_jawaban: 'langsung', nilai_lulus: 70, petunjuk: 'Kerjakan mandiri. Waktu 20 menit, 2 kali kesempatan, nilai tertinggi yang dipakai.' };
  var mKuis = mod(k1, S[1], 5, 'kuis', 'Kuis 1: Jantung, Pembuluh & Komponen Darah', '7 soal: pilihan ganda, kompleks, benar-salah, mencocokkan, isian singkat, seret-lepas, dan esai.', kuisKonten, { nilai: 100, kat: 'KAT1', selesai: { mode: 'nilai' } });
  var mGlos = mod(k1, S[1], 6, 'glosarium', 'Kamus Istilah Peredaran Darah', 'Tambahkan istilah baru — akan ditinjau guru.', { siswa_boleh: true, persetujuan: true });
  // Topik 2 (terkunci sampai Kuis 1 ≥ 60)
  seksi[2][5] = J({ op: 'semua', aturan: [{ tipe: 'nilai_min', modul_id: mKuis, nilai: 60 }], sembunyi: false });
  var mTugas = mod(k1, S[2], 1, 'tugas', 'Tugas: Poster Pencegahan Hipertensi', 'Buat poster digital kampanye pencegahan hipertensi untuk remaja.', { tipe_kirim: 'keduanya', maks_berkas: 2, terlambat_boleh: true, rubrik_id: rbIds[0], kelompok: false, petunjuk: '1. Ukuran A4 (PNG/PDF).\n2. Cantumkan minimal 2 sumber.\n3. Dinilai dengan **Rubrik Poster Kesehatan** (lihat di bawah).' },
    { nilai: 100, kat: 'KAT2', selesai: { mode: 'kirim' }, tutup: lokal(7, '23:59') });
  var mForum = mod(k1, S[2], 2, 'forum', 'Diskusi: Gaya Hidup Sehat untuk Jantung', 'Bagikan kebiasaan sehat & tanggapi minimal 1 teman. Postingan dinilai guru (0–10).', { jenis: 'umum', dinilai: true, agregasi: 'rata', lampiran: true, petunjuk: '' }, { nilai: 10, kat: 'KAT3', selesai: { mode: 'kirim' } });
  var mWiki = mod(k1, S[2], 3, 'wiki', 'Wiki Kelompok: Ringkasan Kelainan Peredaran Darah', 'Susun ringkasan bersama anggota kelompok (setiap kelompok punya wiki sendiri).', { mode: 'kolaboratif', halaman_awal: 'Beranda' }, { mode_grup: 'terpisah', selesai: { mode: 'kirim' } });
  // Topik 3
  var mWs = mod(k1, S[3], 1, 'workshop', 'Workshop: Esai Mini "Mengapa Donor Darah Penting?"', 'Kirim esai 150–250 kata, lalu nilai 2 karya teman dengan kriteria yang sama.', { fase: 'penilaian', kriteria: [{ id: 'K1', deskripsi: 'Gagasan utama jelas', maks: 10 }, { id: 'K2', deskripsi: 'Argumen didukung fakta', maks: 10 }, { id: 'K3', deskripsi: 'Bahasa efektif', maks: 5 }], jml_penilai: 2, bobot_kirim: 80, bobot_menilai: 20, petunjuk_kirim: 'Tulis esai langsung di kotak isian.', petunjuk_nilai: 'Nilai secara objektif & beri komentar membangun.', alokasi: null },
    { nilai: 100, kat: 'KAT2', selesai: { mode: 'kirim' }, syarat: { op: 'semua', aturan: [{ tipe: 'tanggal_mulai', tgl: lokal(-10, '07:00') }], sembunyi: false } });
  var mUb = mod(k1, S[3], 2, 'umpanbalik', 'Survei: Evaluasi Pembelajaran Bab 3', 'Anonim — bantu guru memperbaiki pembelajaran.', { anonim: true, tampil_hasil: true, pengantar: 'Jawaban Anda anonim. Terima kasih atas masukannya!', pertanyaan: [
    { id: 'Q1', tipe: 'skala', teks: 'Materi bab ini mudah dipahami', opsi: [], wajib: true }, { id: 'Q2', tipe: 'skala', teks: 'Guru menjelaskan dengan jelas', opsi: [], wajib: true },
    { id: 'Q3', tipe: 'pilihan', teks: 'Aktivitas paling menarik', opsi: ['Video', 'Pelajaran interaktif', 'Kuis', 'Diskusi forum', 'Workshop'], wajib: true },
    { id: 'Q4', tipe: 'pilihanganda', teks: 'Media yang membantu belajar (boleh lebih dari satu)', opsi: ['Modul PDF', 'Video', 'Kelas virtual', 'Glosarium'], wajib: false },
    { id: 'Q5', tipe: 'teks', teks: 'Saran untuk guru', opsi: [], wajib: false }] });
  var mWeb = mod(k1, S[3], 3, 'web', 'Simulasi Interaktif: Tekanan Darah', 'Halaman web eksternal yang disematkan.', { url: 'https://phet.colorado.edu/id/', buka: 'sematkan', tinggi: 560 });
  // Kursus 2 (mingguan) & 3 (sosial)
  var m2Hal = mod(k2, S[5], 1, 'halaman', 'Materi: Konsep Limit Fungsi', '', { isi: '## Limit Fungsi\nLimit menggambarkan nilai yang **didekati** fungsi ketika x mendekati suatu bilangan.\n\n**Contoh:** lim(x→2) (x² − 4)/(x − 2) = lim(x→2) (x + 2) = 4' }, { selesai: { mode: 'lihat' } });
  var m2Kuis = mod(k2, S[5], 2, 'kuis', 'Latihan Limit Pekan 1', '', { soal: mat.map(function (q, i) { return { soal_id: sid[soal.length + i], skor: 1 }; }), ambil_acak: 0, acak_soal: false, acak_opsi: true, waktu_menit: 10, percobaan_maks: 0, metode_nilai: 'tertinggi', tampil_jawaban: 'langsung', nilai_lulus: 70 }, { nilai: 100 });
  var m2Tgs = mod(k2, S[6], 1, 'tugas', 'Latihan Soal Limit Tak Hingga', '', { tipe_kirim: 'teks', maks_berkas: 1, terlambat_boleh: true, rubrik_id: '', kelompok: false, petunjuk: 'Kerjakan 5 soal di buku paket hlm. 112.' }, { nilai: 100, tutup: lokal(10, '23:59') });
  var m3Forum = mod(k3, S[11], 1, 'forum', 'Forum Kelas', '', { jenis: 'umum', lampiran: true }, { selesai: { mode: 'tidak' } });
  seksi = seksi.map(function (x) { return { seksi_id: x[0], kursus_id: x[1], no: x[2], judul: x[3], ringkasan: x[4], tampil: 'YA', syarat: x[5] === 'KUIS1' ? '' : x[5], diperbarui_pada: now }; });
  DB.appendBatch('KursusSeksi', seksi);
  DB.appendBatch('KursusModul', mods);

  // Kategori & item nilai
  var kat = reserveIds_('NilaiKategori', 3);
  DB.appendBatch('NilaiKategori', [{ kategori_id: kat[0], kursus_id: k1, nama: 'Kuis & Latihan', bobot: 40, buang_terendah: 0, urutan: 1 }, { kategori_id: kat[1], kursus_id: k1, nama: 'Tugas & Proyek', bobot: 40, buang_terendah: 0, urutan: 2 }, { kategori_id: kat[2], kursus_id: k1, nama: 'Partisipasi Forum', bobot: 20, buang_terendah: 0, urutan: 3 }]);
  DB.updateBatch('KursusModul', 'modul_id', mods.filter(function (m) { return /^KAT\d$/.test(m.kategori_id); }).map(function (m) { return { modul_id: m.modul_id, kategori_id: kat[Number(m.kategori_id.slice(3)) - 1] }; }));
  var itemPrak = reserveIds_('NilaiItem', 1)[0];
  DB.appendBatch('NilaiItem', [{ item_id: itemPrak, kursus_id: k1, kategori_id: kat[1], nama: 'Praktikum Denyut Nadi (luring)', nilai_maks: 100, bobot: 1, urutan: 1, dibuat_pada: iso(10) }]);
  DB.updateBatch('Kursus', 'kursus_id', [{ kursus_id: k1, syarat_lulus: J({ modul_ids: [mSilabus, mKuis, mPel, mTugas], nilai_min: 70 }) }]);
  DB.updateBatch('KursusSeksi', 'seksi_id', [{ seksi_id: S[2], syarat: J({ op: 'semua', aturan: [{ tipe: 'nilai_min', modul_id: mKuis, nilai: 60 }], sembunyi: false }) }]);

  // Grup & pengelompokan (4 kelompok)
  var grp = reserveIds_('KursusGrup', 4), urutG = [AH].concat(lain), anggota = [[], [], [], []];
  urutG.forEach(function (u, i) { anggota[i % 4].push(u); });
  DB.appendBatch('KursusGrup', grp.map(function (g, i) { return { grup_id: g, kursus_id: k1, nama: 'Kelompok ' + (i + 1), deskripsi: 'Kelompok proyek', anggota: anggota[i].join(','), dibuat_pada: iso(15) }; }));
  var grg = reserveIds_('KursusGrouping', 1)[0];
  DB.appendBatch('KursusGrouping', [{ grouping_id: grg, kursus_id: k1, nama: 'Kelompok Proyek Bab 3', grup_ids: grp.join(','), dibuat_pada: iso(15) }]);
  lmsSegarkan_();

  // ------------------------------------------------------------ Aktivitas siswa
  var mRow = function (id) { return DB.find('KursusModul', 'modul_id', id); };
  var mk = mRow(mKuis), aK = { m: mk, konten: lmsJson_(mk.konten, {}) }, qmap = {};
  DB.all('BankSoal').forEach(function (q) { qmap[q.soal_id] = q; });
  var kp = [], ids = reserveIds_('KuisPercobaan', 12);
  lain.slice(0, 12).forEach(function (uid, i) {
    var p = 0.45 + rnd() * 0.5, jw = {}, rin = {}, tot = 0, mx = 0, manual = false;
    aK.konten.soal.forEach(function (s) {
      var q = qmap[s.soal_id], kunci = soalNilai_(q, null, 1).kunci, benar = rnd() < p;
      if (q.tipe === 'pg') jw[q.soal_id] = benar ? kunci : 'o1';
      else if (q.tipe === 'pgk') jw[q.soal_id] = benar ? kunci : ['o1', 'o4'];
      else if (q.tipe === 'bs') jw[q.soal_id] = benar ? true : false;
      else if (q.tipe === 'cocok') jw[q.soal_id] = benar ? { 0: 'k0', 1: 'k1', 2: 'k2', 3: 'k3' } : { 0: 'k1', 1: 'k0', 2: 'k2', 3: 'k3' };
      else if (q.tipe === 'singkat') jw[q.soal_id] = benar ? 'hemoglobin' : 'hematin';
      else if (q.tipe === 'dragdrop') { var kk = {}; Object.keys(kunci).forEach(function (g, j) { kk[g] = benar || j ? kunci[g] : 'p3'; }); jw[q.soal_id] = kk; }
      else if (q.tipe === 'esai') jw[q.soal_id] = 'Peredaran darah besar dimulai dari ventrikel kiri menuju seluruh tubuh, sedangkan peredaran darah kecil dari ventrikel kanan menuju paru-paru.';
      var r = soalNilai_(q, jw[q.soal_id], s.skor);
      if (r.manual) { if (i < 9) { r.skor = Math.round(1 + rnd() * 2); r.manual = false; r.dinilai = true; } else manual = true; }
      rin[q.soal_id] = { skor: r.skor, maks: r.maks, benar: r.benar, manual: !!r.manual }; tot += r.skor; mx += r.maks;
    });
    var dur = 360 + Math.floor(rnd() * 700);
    kp.push({ percobaan_id: ids[i], modul_id: mKuis, kursus_id: k1, user_id: uid, no: 1, mulai: iso(6 - (i % 5), 2), selesai: iso(6 - (i % 5), 2 - dur / 3600), durasi_detik: dur, jawaban: J(jw), rincian: J(rin), nilai: round1_(tot), nilai_maks: mx,
      status: manual ? 'perlu_dinilai' : 'selesai', terlambat: 'TIDAK', dinilai_oleh: manual ? '' : G, dinilai_pada: manual ? '' : iso(4) });
  });
  DB.appendBatch('KuisPercobaan', kp);
  lain.slice(0, 12).forEach(function (uid) { kuisPerbaruiNilai_(aK, uid); });
  // Tugas poster (rubrik)
  var mt = mRow(mTugas), aT = { m: mt, konten: lmsJson_(mt.konten, {}) }, rub = { jenis: 'rubrik', kriteria: lmsJson_(DB.find('Rubrik', 'rubrik_id', rbIds[0]).kriteria, []) };
  var tk = [], tids = reserveIds_('TugasKirim', 10);
  lain.slice(0, 10).forEach(function (uid, i) {
    var status = i < 6 ? 'dinilai' : i < 9 ? 'terkirim' : 'draf', pilihR = {}, h = null;
    if (status === 'dinilai') { rub.kriteria.forEach(function (kr) { pilihR[kr.id] = Math.min(3, Math.floor(1 + rnd() * 3.2)); }); h = rubrikHitung_(rub, pilihR, 100); }
    tk.push({ kirim_id: tids[i], modul_id: mTugas, kursus_id: k1, user_id: uid, grup_id: '', teks: status === 'draf' ? 'Draf ide poster…' : 'Poster saya berjudul "Kurangi Garam, Jaga Tekanan". Isinya 4 tips: batasi garam ≤ 5 g/hari, olahraga 30 menit, kelola stres, dan cek tekanan darah rutin. Sumber: Kemenkes RI, WHO.',
      berkas: J(status === 'draf' ? [] : [{ id: '', nama: 'poster-hipertensi.pdf', mime: 'application/pdf', ukuran: 4800, url: 'demo/peredaran-darah.pdf' }]), status: status, dibuka_pada: iso(5, 3), dikirim_pada: status === 'draf' ? '' : iso(3 - (i % 3), 1),
      terlambat: status === 'draf' ? '' : (i === 8 ? 'YA' : 'TIDAK'), durasi_detik: status === 'draf' ? '' : 3600 + Math.floor(rnd() * 7200), nilai: h ? h.nilai : '', rincian_nilai: h ? J({ rubrik_id: rbIds[0], pilih: pilihR, skor: h.skor, maks: h.maks, rinci: h.rinci }) : '',
      umpan_balik: h ? pilih(['Desain menarik, tambahkan data prevalensi.', 'Pesan jelas & sumber lengkap. Bagus!', 'Perbaiki ukuran huruf agar mudah dibaca.']) : '', dinilai_oleh: h ? G : '', dinilai_pada: h ? iso(1) : '', percobaan: 1 });
  });
  DB.appendBatch('TugasKirim', tk);
  tk.forEach(function (t) { if (t.status !== 'draf') lmsTandai_(k1, mTugas, t.user_id, 'kirim'); if (t.status === 'dinilai') { nilaiCatat_(k1, mTugas, t.user_id, t.nilai, 100, 'tugas'); } });
  // Forum diskusi
  var fd = reserveIds_('ForumDiskusi', 4), fp = reserveIds_('ForumPost', 14), pi = 0, posts = [];
  DB.appendBatch('ForumDiskusi', [
    { diskusi_id: fd[0], modul_id: mBerita, kursus_id: k1, judul: 'Jadwal Kelas Virtual & Batas Tugas Poster', user_id: G, grup_id: '', disematkan: 'YA', terkunci: 'TIDAK', dibuat_pada: iso(9), terakhir_pada: iso(9), jml_balasan: 0 },
    { diskusi_id: fd[1], modul_id: mForum, kursus_id: k1, judul: 'Kebiasaan sarapan yang baik untuk jantung?', user_id: lain[0], grup_id: '', disematkan: 'TIDAK', terkunci: 'TIDAK', dibuat_pada: iso(4), terakhir_pada: iso(1), jml_balasan: 3 },
    { diskusi_id: fd[2], modul_id: mForum, kursus_id: k1, judul: 'Olahraga apa yang paling efektif menurunkan tekanan darah?', user_id: lain[1], grup_id: '', disematkan: 'TIDAK', terkunci: 'TIDAK', dibuat_pada: iso(3), terakhir_pada: iso(0, 5), jml_balasan: 2 },
    { diskusi_id: fd[3], modul_id: m3Forum, kursus_id: k3, judul: 'Ide lomba KIR: alat ukur denyut nadi sederhana', user_id: lain[2], grup_id: '', disematkan: 'TIDAK', terkunci: 'TIDAK', dibuat_pada: iso(6), terakhir_pada: iso(2), jml_balasan: 2 }
  ]);
  function post(did, mid, kid, induk, uid, isi, hari, nilai) { var id = fp[pi++]; posts.push({ post_id: id, diskusi_id: did, modul_id: mid, kursus_id: kid, induk_id: induk, user_id: uid, isi: isi, berkas: '[]', nilai: nilai === undefined ? '' : nilai, dinilai_oleh: nilai === undefined ? '' : G, dibuat_pada: iso(hari), diedit_pada: '', dihapus: '' }); return id; }
  post(fd[0], mBerita, k1, '', G, 'Assalamualaikum. **Kelas virtual** pembahasan Kuis 1 dilaksanakan besok pukul 09.00 via Google Meet (tautan di bagian Umum). Tugas poster dikumpulkan paling lambat pekan depan.', 9);
  var f1 = post(fd[1], mForum, k1, '', lain[0], 'Menurut saya sarapan oatmeal + buah lebih baik daripada gorengan karena rendah lemak jenuh. Ada yang punya ide lain?', 4, 8);
  post(fd[1], mForum, k1, f1, lain[3], 'Setuju! Saya biasanya tambah telur rebus untuk protein. Garamnya juga dibatasi.', 3, 7);
  post(fd[1], mForum, k1, f1, lain[4], 'Kalau tidak sempat, minimal minum air putih dan pisang. Pisang tinggi kalium yang baik untuk tekanan darah.', 2, 9);
  post(fd[1], mForum, k1, f1, G, 'Bagus sekali diskusinya. Kalium memang membantu menyeimbangkan natrium. 👍', 1);
  var f2 = post(fd[2], mForum, k1, '', lain[1], 'Saya baca olahraga aerobik seperti jalan cepat 30 menit/hari bisa menurunkan tekanan sistolik 5–8 mmHg. Sumber: WHO.', 3, 8);
  post(fd[2], mForum, k1, f2, lain[5], 'Bersepeda juga termasuk aerobik ya? Saya tiap sore bersepeda ke rumah nenek 😄', 1);
  post(fd[2], mForum, k1, f2, lain[6], 'Iya, bersepeda termasuk. Yang penting rutin minimal 150 menit per minggu.', 0, 6);
  var f3 = post(fd[3], m3Forum, k3, '', lain[2], 'Bagaimana kalau kita buat pengukur denyut nadi dari sensor cahaya HP + aplikasi sederhana?', 6);
  post(fd[3], m3Forum, k3, f3, G, 'Ide menarik! Coba pelajari prinsip fotopletismografi (PPG). Saya bisa bantu cari referensinya.', 4);
  post(fd[3], m3Forum, k3, f3, AH, 'Saya mau ikut tim! Saya bisa bantu desain posternya.', 2);
  DB.appendBatch('ForumPost', posts);
  var per = {}; posts.forEach(function (p) { if (p.modul_id === mForum) { lmsTandai_(k1, mForum, p.user_id, 'kirim'); if (p.nilai !== '') (per[p.user_id] = per[p.user_id] || []).push(Number(p.nilai)); } });
  Object.keys(per).forEach(function (u) { nilaiCatat_(k1, mForum, u, forumAgregat_(per[u], 'rata', 10), 10, 'forum'); });
  // Wiki kelompok 1 (2 versi)
  var wk = reserveIds_('WikiHalaman', 2);
  DB.appendBatch('WikiHalaman', [
    { halaman_id: wk[0], modul_id: mWiki, kursus_id: k1, grup_id: grp[0], pemilik: '', judul: 'Beranda', isi: '# Ringkasan Kelompok 1\n- [[Hipertensi]]\n- [[Anemia]]\n- Penyakit jantung koroner (belum ditulis)\n\n_Pembagian tugas_: hipertensi (Ahmad), anemia (' + lmsNama_(anggota[0][1] || AH) + ').', versi: 2, diedit_oleh: anggota[0][1] || AH, diedit_pada: iso(1), dibuat_pada: iso(3) },
    { halaman_id: wk[1], modul_id: mWiki, kursus_id: k1, grup_id: grp[0], pemilik: '', judul: 'Anemia', isi: '## Anemia\nKondisi kadar **hemoglobin** di bawah normal.\n\n**Penyebab umum:** kekurangan zat besi, vitamin B12, perdarahan.\n\n**Pencegahan:** konsumsi sayur hijau, daging merah, dan tablet tambah darah sesuai anjuran.', versi: 1, diedit_oleh: anggota[0][1] || AH, diedit_pada: iso(2), dibuat_pada: iso(2) }
  ]);
  DB.appendBatch('WikiRiwayat', [{ riwayat_id: reserveIds_('WikiRiwayat', 1)[0], halaman_id: wk[0], modul_id: mWiki, kursus_id: k1, versi: 1, isi: '# Ringkasan Kelompok 1\n- Hipertensi\n- Anemia', oleh: AH, waktu: iso(3) }]);
  lmsTandai_(k1, mWiki, anggota[0][1] || AH, 'kirim');
  // Glosarium
  var gl = [['Aorta', 'Arteri terbesar yang membawa darah kaya oksigen dari ventrikel kiri ke seluruh tubuh.', G, 'Disetujui'], ['Eritrosit', 'Sel darah merah; mengandung hemoglobin untuk mengangkut oksigen.', G, 'Disetujui'],
    ['Hipertensi', 'Tekanan darah tinggi, umumnya ≥ 140/90 mmHg.', lain[0], 'Disetujui'], ['Katup trikuspidalis', 'Katup antara atrium kanan dan ventrikel kanan.', lain[3], 'Disetujui'],
    ['Kapiler', 'Pembuluh darah terkecil tempat pertukaran zat antara darah dan jaringan.', G, 'Disetujui'], ['Trombosit', 'Keping darah yang berperan dalam pembekuan darah.', lain[4], 'Disetujui'], ['Sistole', 'Fase kontraksi jantung saat darah dipompa keluar.', lain[7], 'Menunggu']];
  var gid = reserveIds_('GlosariumEntri', gl.length);
  DB.appendBatch('GlosariumEntri', gl.map(function (g, i) { return { entri_id: gid[i], modul_id: mGlos, kursus_id: k1, istilah: g[0], alias: '', definisi: g[1], user_id: g[2], status: g[3], dibuat_pada: iso(8 - i), diperbarui_pada: iso(8 - i) }; }));
  gl.forEach(function (g) { if (g[2] !== G) lmsTandai_(k1, mGlos, g[2], 'kirim'); });
  // Workshop: 6 karya + alokasi + sebagian penilaian
  var wsk = reserveIds_('WorkshopKirim', 6), wkir = [];
  lain.slice(0, 6).forEach(function (uid, i) { wkir.push({ kirim_id: wsk[i], modul_id: mWs, kursus_id: k1, user_id: uid, judul: pilih(['Setetes Darah, Sejuta Harapan', 'Donor Darah: Kecil bagi Kita, Besar bagi Mereka', 'Mengapa Saya Akan Menjadi Pendonor']), isi: 'Donor darah sangat penting karena stok darah di PMI sering menipis, terutama saat hari raya. Satu kantong darah dapat menyelamatkan hingga tiga nyawa. Selain itu, donor rutin membantu tubuh memproduksi sel darah baru…', berkas: '[]', dikirim_pada: iso(5 - i % 3), nilai_kirim: '', nilai_menilai: '', nilai_akhir: '' }); });
  DB.appendBatch('WorkshopKirim', wkir);
  var alok = wsAlokasi_(wkir, 2), wn = [], wni = reserveIds_('WorkshopNilai', 8), wnx = 0;
  Object.keys(alok).forEach(function (kid) { alok[kid].forEach(function (u) { if (wnx < 8) { var sk = { K1: 6 + Math.floor(rnd() * 5), K2: 5 + Math.floor(rnd() * 6), K3: 3 + Math.floor(rnd() * 3) }, t = sk.K1 + sk.K2 + sk.K3; wn.push({ penilaian_id: wni[wnx++], modul_id: mWs, kursus_id: k1, kirim_id: kid, penilai_id: u, skor: J(sk), komentar: pilih(['Argumen kuat, tambahkan data PMI.', 'Bahasanya runtut. Mantap!', 'Paragraf penutup bisa diperkuat.']), total: round1_(t / 25 * 100), waktu: iso(1) }); } }); });
  DB.appendBatch('WorkshopNilai', wn);
  DB.updateBatch('KursusModul', 'modul_id', [{ modul_id: mWs, konten: J(Object.assign(lmsJson_(mRow(mWs).konten, {}), { alokasi: alok })) }]);
  wkir.forEach(function (x) { lmsTandai_(k1, mWs, x.user_id, 'kirim'); });
  // Pelajaran interaktif: 8 siswa selesai
  var lp = reserveIds_('LessonProgres', 8);
  DB.appendBatch('LessonProgres', lain.slice(0, 8).map(function (uid, i) { var b = i % 3 === 0 ? 1 : 2; return { progres_id: lp[i], modul_id: mPel, kursus_id: k1, user_id: uid, percobaan: 1, state: J({ jalur: ['H1', 'H2', 'H4', 'H5'], benar: b, dijawab: 2, durasi: 240 + i * 30 }), nilai: b * 50, selesai: 'YA', mulai: iso(4, 2), diperbarui_pada: iso(4, 1) }; }));
  lain.slice(0, 8).forEach(function (uid, i) { var v = (i % 3 === 0 ? 1 : 2) * 50; nilaiCatat_(k1, mPel, uid, v, 100, 'pelajaran'); lmsTandai_(k1, mPel, uid, 'nilai', v); });
  // Survei anonim: 9 respons
  var ub = reserveIds_('UmpanBalikJawaban', 9), aU = { m: mRow(mUb), konten: lmsJson_(mRow(mUb).konten, {}) };
  DB.appendBatch('UmpanBalikJawaban', lain.slice(0, 9).map(function (uid, i) { return { jawaban_id: ub[i], modul_id: mUb, kursus_id: k1, responden: ubResponden_(aU, uid), nama: '', waktu: iso(2 - i % 2),
    jawaban: J({ Q1: 3 + Math.floor(rnd() * 3), Q2: 4 + Math.floor(rnd() * 2), Q3: pilih(['Video', 'Pelajaran interaktif', 'Kuis', 'Diskusi forum']), Q4: ['Modul PDF', 'Video'].slice(0, 1 + i % 2), Q5: i % 3 === 0 ? pilih(['Tambah video animasi', 'Kuisnya seru!', 'Kelas virtual lebih sering']) : '' }) }; }));
  lain.slice(0, 9).forEach(function (uid) { lmsTandai_(k1, mUb, uid, 'kirim'); });
  // Silabus dilihat, praktikum luring
  lain.slice(0, 14).forEach(function (uid) { lmsTandai_(k1, mSilabus, uid, 'lihat'); lmsTandai_(k1, mPdf, uid, 'lihat'); });
  lain.forEach(function (uid) { nilaiCatat_(k1, itemPrak, uid, 70 + Math.floor(rnd() * 26), 100, 'manual'); });
  // Kursus 2: beberapa percobaan latihan
  var mk2 = mRow(m2Kuis), a2 = { m: mk2, konten: lmsJson_(mk2.konten, {}) }, kp2 = reserveIds_('KuisPercobaan', 6);
  DB.appendBatch('KuisPercobaan', lain.slice(0, 6).map(function (uid, i) { var b = 1 + i % 3; return { percobaan_id: kp2[i], modul_id: m2Kuis, kursus_id: k2, user_id: uid, no: 1, mulai: iso(3, 1), selesai: iso(3, 0.9), durasi_detik: 300 + i * 20, jawaban: '{}', rincian: '{}', nilai: b, nilai_maks: 3, status: 'selesai', terlambat: 'TIDAK', dinilai_oleh: '', dinilai_pada: '' }; }));
  lain.slice(0, 6).forEach(function (uid) { kuisPerbaruiNilai_(a2, uid); });
  lmsSegarkan_();

  // ------------------------------------------------------------ Pesan (terenkripsi)
  var pck = reserveIds_('Percakapan', 3), psn = [], pids = reserveIds_('Pesan', 7), px = 0;
  function msg(pidx, dari, isi, hari) { psn.push({ pesan_id: pids[px++], percakapan_id: pck[pidx], dari: dari, isi: enkripsi_(isi), waktu: iso(hari), dihapus: '' }); }
  msg(0, AH, 'Assalamualaikum Pak, untuk tugas poster boleh dalam bentuk infografis digital?', 1.2);
  msg(0, G, 'Waalaikumsalam Ahmad. Boleh, yang penting ukuran A4 dan cantumkan sumbernya ya.', 1.1);
  msg(0, G, 'Jangan lupa kerjakan Kuis 1 dulu supaya Topik 2 terbuka. 🙂', 0.2);
  msg(1, lain[0], 'Mad, kelompok kita bagi tugas wiki ya. Kamu bagian hipertensi?', 0.8);
  msg(1, AH, 'Siap! Nanti malam saya tulis.', 0.7);
  msg(2, sa ? sa.user_id : G, 'Pak Hartono, mohon rekap nilai kursus Biologi dikirim ke raport sebelum akhir bulan.', 2);
  msg(2, G, 'Baik, akan saya kirim lewat tombol "Kirim ke Nilai Raport".', 1.9);
  DB.appendBatch('Pesan', psn);
  var pkRows = [[0, [AH, G], 'Jangan lupa kerjakan Kuis 1 dulu supaya Topik 2 terbuka. 🙂', G, 0.2], [1, [AH, lain[0]], 'Siap! Nanti malam saya tulis.', AH, 0.7], [2, [sa ? sa.user_id : G, G], 'Baik, akan saya kirim lewat tombol "Kirim ke Nilai Raport".', G, 1.9]];
  DB.appendBatch('Percakapan', pkRows.map(function (r) { return { percakapan_id: pck[r[0]], anggota: r[1].slice().sort().join(','), dibuat_pada: iso(2), terakhir_pada: iso(r[4]), terakhir_dari: r[3], cuplikan: enkripsi_(r[2]), jml_pesan: psn.filter(function (m) { return m.percakapan_id === pck[r[0]]; }).length }; }));
  DB.appendBatch('PesanStatus', [{ kunci: pck[1] + '|' + AH, percakapan_id: pck[1], user_id: AH, terakhir_baca: iso(0.7) }, { kunci: pck[0] + '|' + G, percakapan_id: pck[0], user_id: G, terakhir_baca: iso(0.2) }]);

  // ------------------------------------------------------------ Log aktivitas contoh (login & halaman)
  var log = [], lid, halaman = ['dashboard', 'kursus', 'aktivitas', 'nilai', 'materi', 'absensi', 'pesan'];
  var aktor = [[G, 'guru', guru.nama], [AH, 'siswa', siswaU.nama]].concat(lain.slice(0, 8).map(function (u) { return [u, 'siswa', lmsNama_(u)]; }));
  aktor.forEach(function (a, i) {
    [1, 0].forEach(function (hari) {
      log.push({ waktu: iso(hari, 6 - i * 0.2), user_id: a[0], nama: a[2], peran: a[1], jenis: 'login', halaman: 'login', objek: 'sandi', durasi_detik: 0, kunjungan: 1, ip: '', perangkat: 'D' + (1000 + i), detail: 'Sandi' });
      halaman.slice(0, 3 + (i % 4)).forEach(function (h, j) { log.push({ waktu: iso(hari, 5.8 - i * 0.2 - j * 0.1), user_id: a[0], nama: a[2], peran: a[1], jenis: 'halaman', halaman: h, objek: '', durasi_detik: 60 + Math.floor(rnd() * 900), kunjungan: 1 + Math.floor(rnd() * 4), ip: '', perangkat: 'D' + (1000 + i), detail: '' }); });
    });
  });
  log.push({ waktu: iso(0, 3), user_id: '', nama: '', peran: '', jenis: 'login_gagal', halaman: 'login', objek: '', durasi_detik: 0, kunjungan: 1, ip: '', perangkat: '', detail: 'Akun tidak dikenal: adm***@gmail.com' });
  lid = reserveIds_('LogAktivitas', log.length); log.forEach(function (r, i) { r.log_id = lid[i]; });
  log.sort(function (a, b) { return String(a.waktu).localeCompare(String(b.waktu)); });
  DB.appendBatch('LogAktivitas', log);
  setProp_('V3_SIAP', APP.VERSION);
  bump_('lms'); bump_('lmsr');
}

if (typeof pasangEkstensi_ === 'function' && typeof SCHEMA !== 'undefined') pasangEkstensi_();
