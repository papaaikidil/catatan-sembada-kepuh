// =====================================================================
// CATATAN SEMBADA KEPUH - API dan penyiapan Google Sheet
//
// PASANG SEKALI SAJA:
// 1. Buat Google Sheet baru bernama "Catatan Sembada Kepuh".
// 2. Menu Ekstensi > Apps Script. Hapus isi Code.gs, tempel seluruh file ini, lalu simpan.
// 3. Di atas, pilih fungsi "siapkanSheet", klik Jalankan, lalu izinkan akses.
//    Semua tab dibuat otomatis. Sandi sementara pemilik ada di tab Pengaturan.
// 4. Terapkan > Deployment baru > jenis "Aplikasi web"
//      Jalankan sebagai: Saya
//      Yang memiliki akses: Siapa saja
//    Salin alamat yang berakhiran /exec, lalu kirim ke Claude (atau isi di docs/config.js).
//
// KALAU KODE INI DIPERBARUI:
//    Terapkan > Kelola deployment > ikon pensil > Versi: "Versi baru" > Terapkan.
//    Alamat /exec tetap sama. Jalankan "siapkanSheet" sekali lagi kalau ada kolom baru.
//
// Laporan (Ringkasan, Rekap Mingguan, Rekap Bulanan, Upah Mingguan, Rekap Alat) dihitung ulang
// otomatis setiap jam, setiap kali ringkasan dibuka di aplikasi, dan lewat menu "Catatan Kepuh".
// =====================================================================

var KP_VERSI = 1;
var KP_ZONA = 'Asia/Jakarta';
var KP_LOG = 'Log Aplikasi';
var KP_SIMPAN_ID = 300;          // jumlah id isian terakhir yang diingat untuk mencegah catatan dobel
var KP_SESI_HARI = 180;          // sesi masuk berlaku selama ini kalau tidak dipakai
var KP_BATAS_GAGAL = 5;          // sandi salah sebanyak ini dalam 15 menit = nama pengguna dikunci sementara
var KP_PEMILIK_AWAL = 'wildan';

// ---------------------------------------------------------------- STRUKTUR TAB

var URUTAN_TAB = ['Ambil Bahan', 'Produksi Suling', 'Saring Minyak', 'Absensi', 'Penjualan', 'Kas'];

var TAB_DATA = {
  'Ambil Bahan': ['ID', 'Waktu kirim', 'Dicatat oleh', 'Tanggal', 'Pengumpul', 'Daerah', 'Kondisi bahan', 'Berat bahan (kg)',
    'Uang dibawa (Rp)', 'Uang sisa (Rp)', 'Biaya lain di jalan (Rp)', 'Keterangan biaya lain', 'Keterangan',
    'Uang beli bahan (Rp)', 'Harga bahan per kg (Rp)'],
  'Produksi Suling': ['ID', 'Waktu kirim', 'Dicatat oleh', 'Tanggal', 'Alat suling', 'Operator', 'Jumlah sulingan', 'Kondisi alat',
    'Keterangan', 'Upah per sulingan (Rp)', 'Upah (Rp)', 'ID isian'],
  'Saring Minyak': ['ID', 'Waktu kirim', 'Dicatat oleh', 'Tanggal saring', 'Alat suling', 'Jumlah sulingan yang disaring', 'Minyak (kg)',
    'Hidrosol diambil (liter)', 'Kondisi bahan', 'Stok minyak di gudang (kg)', 'Keterangan', 'Minyak per sulingan (kg)'],
  'Absensi': ['ID', 'Waktu kirim', 'Dicatat oleh', 'Tanggal', 'Nama', 'Peran', 'Kehadiran', 'Upah absensi (Rp)', 'Pekerjaan lain',
    'Upah kerja lain (Rp)', 'Keterangan', 'ID isian'],
  'Penjualan': ['ID', 'Waktu kirim', 'Dicatat oleh', 'Tanggal', 'Pembeli', 'Produk', 'Jumlah', 'Satuan', 'Harga satuan (Rp)', 'Total (Rp)',
    'Status bayar', 'Pengiriman', 'Keterangan'],
  'Kas': ['ID', 'Waktu kirim', 'Dicatat oleh', 'Tanggal', 'Kategori', 'Arah', 'Jumlah (Rp)', 'Keterangan']
};

// Kolom yang dihitung atau diisi otomatis (bukan isian aplikasi).
var TAB_HITUNG = {
  'Ambil Bahan': ['Uang beli bahan (Rp)', 'Harga bahan per kg (Rp)'],
  'Produksi Suling': ['Upah per sulingan (Rp)', 'Upah (Rp)', 'ID isian'],
  'Saring Minyak': ['Minyak per sulingan (kg)'],
  'Absensi': ['Peran', 'Upah absensi (Rp)', 'ID isian'],
  'Penjualan': ['Satuan', 'Total (Rp)'],
  'Kas': ['Arah']
};
var KOLOM_SISTEM = ['ID', 'Waktu kirim', 'Dicatat oleh'];

// Tab yang satu isiannya menjadi beberapa baris (satu baris per alat / per orang).
var TAB_KELOMPOK = {'Produksi Suling': true, 'Absensi': true};

function kolomTanggal_(tab) { return tab === 'Saring Minyak' ? 'Tanggal saring' : 'Tanggal'; }

function kolomInput_(tab) {
  return TAB_DATA[tab].filter(function (h) { return KOLOM_SISTEM.indexOf(h) < 0 && TAB_HITUNG[tab].indexOf(h) < 0; });
}

// ---------------------------------------------------------------- DATA INDUK (bisa diatur dari aplikasi)

var PERAN_KARYAWAN = ['Penyuling', 'Pengumpul', 'Cadangan', 'Lainnya'];
var DAFTAR_PILIHAN = ['Daerah', 'Kondisi bahan', 'Kondisi alat', 'Pembeli', 'Status bayar'];
var PERAN_PENGGUNA = ['Pemilik', 'Pencatat', 'Mandor', 'Lainnya'];

var MASTER = {
  'Alat Suling': {kunci: 'alat', judul: 'Alat suling', utama: 'Nama alat', kolom: [
    {h: 'Nama alat', j: 'teks', wajib: true, bantuan: 'Contoh: Alat 1, Ketel timur.'},
    {h: 'Operator tetap', j: 'karyawan', bantuan: 'Otomatis terpilih saat mengisi Produksi Suling. Boleh kosong.'},
    {h: 'Upah per sulingan (Rp)', j: 'rupiah', bantuan: 'Upah borongan operator untuk satu kali suling di alat ini.'},
    {h: 'Kapasitas (kg bahan)', j: 'desimal'},
    {h: 'Catatan', j: 'teks'}]},
  'Karyawan': {kunci: 'karyawan', judul: 'Karyawan', utama: 'Nama', keluar: true, kolom: [
    {h: 'Nama', j: 'teks', wajib: true},
    {h: 'Peran', j: 'pilih', opsi: PERAN_KARYAWAN, wajib: true, bantuan: 'Cadangan bisa dipilih sebagai operator suling maupun pengumpul.'},
    {h: 'No HP', j: 'teks'},
    {h: 'Tanggal masuk', j: 'tanggal'},
    {h: 'Catatan', j: 'teks'}]},
  'Tarif Upah': {kunci: 'tarif', judul: 'Tarif upah absensi', utama: 'Pilihan', kolom: [
    {h: 'Pilihan', j: 'teks', wajib: true, bantuan: 'Yang dipilih saat absensi, contoh: 1 trip, Kerja harian, Libur.'},
    {h: 'Untuk peran', j: 'pilih', opsi: ['Semua', 'Pengumpul', 'Penyuling'], wajib: true},
    {h: 'Upah (Rp)', j: 'rupiah', wajib: true},
    {h: 'Jenis', j: 'pilih', opsi: ['Masuk', 'Tidak masuk'], wajib: true, bantuan: 'Masuk = dihitung sebagai hari kerja.'}]},
  'Pilihan': {kunci: 'pilihan', judul: 'Daftar pilihan', utama: 'Pilihan', kelompok: 'Daftar', kolom: [
    {h: 'Daftar', j: 'pilih', opsi: DAFTAR_PILIHAN, wajib: true},
    {h: 'Pilihan', j: 'teks', wajib: true}]},
  'Produk': {kunci: 'produk', judul: 'Produk', utama: 'Produk', kolom: [
    {h: 'Produk', j: 'teks', wajib: true},
    {h: 'Satuan', j: 'pilih', opsi: ['kg', 'liter', 'botol', 'pcs'], wajib: true},
    {h: 'Harga biasa (Rp)', j: 'rupiah', bantuan: 'Otomatis terisi saat mencatat penjualan. Boleh kosong.'}]},
  'Kategori Kas': {kunci: 'kategori', judul: 'Kategori kas', utama: 'Kategori', kolom: [
    {h: 'Kategori', j: 'teks', wajib: true},
    {h: 'Arah', j: 'pilih', opsi: ['Keluar', 'Masuk'], wajib: true},
    {h: 'Masuk biaya produksi', j: 'pilih', opsi: ['Ya', 'Tidak'], wajib: true,
      bantuan: 'Ya = ikut dihitung sebagai biaya produksi di laporan. Tidak = uang pribadi, modal, dan sejenisnya.'}]}
};
var URUTAN_MASTER = ['Alat Suling', 'Karyawan', 'Tarif Upah', 'Pilihan', 'Produk', 'Kategori Kas'];

function kepalaMaster_(tab) {
  var k = ['ID'].concat(MASTER[tab].kolom.map(function (c) { return c.h; }));
  if (MASTER[tab].keluar) k.push('Tanggal keluar');
  return k.concat(['Urutan', 'Aktif']);
}

// Isi awal. Tarif upah dan upah per sulingan perlu dicek dan disesuaikan pemilik.
var BENIH = {
  'Alat Suling': [['Alat 1', '', 0, '', ''], ['Alat 2', '', 0, '', ''], ['Alat 3', '', 0, '', ''], ['Alat 4', '', 0, '', '']],
  'Karyawan': [],
  'Tarif Upah': [['1 trip', 'Pengumpul', 76000, 'Masuk'], ['2 trip', 'Pengumpul', 126000, 'Masuk'],
    ['Masuk (upah dari sulingan)', 'Penyuling', 0, 'Masuk'], ['Kerja harian', 'Semua', 100000, 'Masuk'],
    ['Libur', 'Semua', 0, 'Tidak masuk'], ['Izin', 'Semua', 0, 'Tidak masuk'], ['Sakit', 'Semua', 0, 'Tidak masuk']],
  'Pilihan': [['Kondisi bahan', 'Segar semua'], ['Kondisi bahan', 'Cuma sedikit yang kering'], ['Kondisi bahan', 'Setengah bagian kering'],
    ['Kondisi bahan', 'Agak kering semua'], ['Kondisi alat', 'Normal'], ['Kondisi alat', 'Ketel bocor'], ['Kondisi alat', 'Spiral bocor'],
    ['Kondisi alat', 'Tungku bermasalah'], ['Status bayar', 'Lunas'], ['Status bayar', 'Belum dibayar'], ['Status bayar', 'Dibayar sebagian']],
  'Produk': [['Minyak jeruk purut', 'kg', ''], ['Minyak batang jeruk purut', 'kg', ''], ['Hidrosol jeruk purut', 'liter', '']],
  'Kategori Kas': [['Bensin & transport', 'Keluar', 'Ya'], ['Kayu bakar', 'Keluar', 'Ya'], ['Perbaikan alat', 'Keluar', 'Ya'],
    ['Makan & minum pekerja', 'Keluar', 'Ya'], ['Bonus pekerja', 'Keluar', 'Ya'], ['Lain-lain operasional', 'Keluar', 'Ya'],
    ['Diambil pemilik', 'Keluar', 'Tidak'], ['Setoran modal dari pemilik', 'Masuk', 'Tidak'], ['Pemasukan lain', 'Masuk', 'Tidak']]
};

var KEPALA_PENGGUNA = ['Nama pengguna', 'Nama', 'Peran', 'Boleh mengisi', 'Boleh mengatur', 'Aktif', 'Wajib ganti sandi',
  'Sandi (terenkripsi)', 'Garam', 'Versi sesi', 'Terakhir masuk'];

var PENGATURAN_AWAL = [
  ['Nama usaha', 'Sembada Karya Wangi', ''],
  ['Lokasi', 'Kepuh', ''],
  ['Awal minggu', 'Senin', 'Hari pertama minggu untuk rekap dan gajian (Senin sampai Minggu).'],
  ['Tampilan', '{}', 'Diatur dari aplikasi (menu Kelola > Tampilan). Jangan diubah manual.'],
  ['Sandi sementara pemilik', '', 'Hilang otomatis setelah sandi diganti.']
];

var TAB_LAPORAN = ['Ringkasan', 'Rekap Mingguan', 'Rekap Bulanan', 'Upah Mingguan', 'Rekap Alat'];

// ---------------------------------------------------------------- PINTU MASUK WEB

function doGet() {
  return keluaranJson_({ok: true, pesan: 'API Catatan Sembada Kepuh aktif.', versi: KP_VERSI});
}

function doPost(e) {
  var hasil;
  try {
    var req = JSON.parse(e && e.postData ? e.postData.contents : '{}');
    hasil = layani_(bukaSheet_(), req);
  } catch (err) {
    hasil = {ok: false, galat: String(err && err.message ? err.message : err)};
  }
  return keluaranJson_(hasil);
}

function keluaranJson_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function bukaSheet_() {
  var id = PropertiesService.getScriptProperties().getProperty('idSheet');
  if (id) return SpreadsheetApp.openById(id);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Sheet belum disiapkan. Jalankan fungsi siapkanSheet di Apps Script.');
  return ss;
}

function layani_(ss, req) {
  var aksi = String(req.aksi || '');
  if (aksi === 'masuk') return masuk_(ss, req);

  var akses = cekSesi_(ss, req.token);
  if (!akses) return {ok: false, kode: 'SESI', galat: 'Sesi sudah berakhir. Silakan masuk lagi.'};
  if (aksi === 'keluar') return keluarSesi_(req.token);
  if (aksi === 'sandiUbah') return sandiUbah_(ss, akses, req);
  if (aksi === 'config') return config_(ss, akses);
  if (akses.wajibGanti) return {ok: false, kode: 'GANTI', galat: 'Ganti sandi sementara dulu sebelum mencatat.'};

  switch (aksi) {
    case 'simpan': return simpan_(ss, akses, req);
    case 'terbaru': return terbaru_(ss, akses, req);
    case 'ringkasan': return ringkasan_(ss, akses);
    case 'ubah': return ubah_(ss, akses, req);
    case 'hapus': return hapus_(ss, akses, req);
    case 'masterSimpan': return masterSimpan_(ss, akses, req);
    case 'masterAktif': return masterAktif_(ss, akses, req);
    case 'masterUrut': return masterUrut_(ss, akses, req);
    case 'penggunaDaftar': return penggunaDaftar_(ss, akses);
    case 'penggunaSimpan': return penggunaSimpan_(ss, akses, req);
    case 'tampilanSimpan': return tampilanSimpan_(ss, akses, req);
    case 'pengaturanSimpan': return pengaturanSimpan_(ss, akses, req);
  }
  return {ok: false, galat: 'Aksi tidak dikenal: ' + aksi};
}

// ---------------------------------------------------------------- ALAT BANTU SHEET

function tab_(ss, nama) {
  var sh = ss.getSheetByName(nama);
  if (!sh) throw new Error('Tab "' + nama + '" tidak ada. Jalankan siapkanSheet di Apps Script.');
  return sh;
}

// Membaca seluruh tab: {kepala, baris (mulai baris 2), sh}.
function bacaTabel_(sh) {
  var lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
  if (lastRow < 1 || lastCol < 1) return {sh: sh, kepala: [], baris: []};
  var semua = sh.getRange(1, 1, lastRow, lastCol).getValues();
  var kepala = semua[0].map(function (h) { return String(h).trim(); });
  var baris = semua.slice(1).filter(function (r) {
    return r.some(function (v) { return v !== '' && v !== null; });
  });
  // simpan nomor baris sebenarnya
  var nomor = [];
  for (var i = 1; i < semua.length; i++) {
    if (semua[i].some(function (v) { return v !== '' && v !== null; })) nomor.push(i + 1);
  }
  return {sh: sh, kepala: kepala, baris: baris, nomor: nomor};
}

function objekBaris_(kepala, row) {
  var o = {};
  for (var j = 0; j < kepala.length; j++) if (kepala[j]) o[kepala[j]] = row[j];
  return o;
}

function bacaObjek_(ss, nama) {
  var t = bacaTabel_(tab_(ss, nama));
  return t.baris.map(function (r, i) { var o = objekBaris_(t.kepala, r); o._baris = t.nomor[i]; return o; });
}

function adalahTanggal_(v) { return Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime()); }

// Tanggal apa pun menjadi 'yyyy-MM-dd' (WIB). Kosong kalau bukan tanggal.
function tglKunci_(v) {
  if (adalahTanggal_(v)) return Utilities.formatDate(v, KP_ZONA, 'yyyy-MM-dd');
  var s = String(v === null || v === undefined ? '' : v).trim();
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  return '';
}

function tglDariKunci_(k) { return Utilities.parseDate(k, KP_ZONA, 'yyyy-MM-dd'); }
function tglIndo_(k) { return k ? k.slice(8, 10) + '/' + k.slice(5, 7) + '/' + k.slice(0, 4) : ''; }

function angka_(v) {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  var s = String(v === null || v === undefined ? '' : v).replace(/[^\d,.\-]/g, '');
  if (!s) return 0;
  if (s.indexOf(',') >= 0 && s.indexOf('.') >= 0) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(',', '.');
  var n = parseFloat(s);
  return isFinite(n) ? n : 0;
}

function bulat_(n, d) { var f = Math.pow(10, d === undefined ? 2 : d); return Math.round(n * f) / f; }

function sekarangTeks_() { return Utilities.formatDate(new Date(), KP_ZONA, 'yyyy-MM-dd'); }

function idBaru_() { return Utilities.getUuid().replace(/-/g, '').slice(0, 16); }

function tandaiLaporanKotor_() {
  try { PropertiesService.getScriptProperties().setProperty('laporanKotor', '1'); } catch (e) { /* abaikan */ }
}

// ---------------------------------------------------------------- PENGATURAN

function bacaPengaturan_(ss) {
  var sh = ss.getSheetByName('Pengaturan');
  var out = {};
  if (!sh || sh.getLastRow() < 2) return out;
  sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(function (r) {
    var k = String(r[0]).trim();
    if (k) out[k] = r[1];
  });
  return out;
}

function tulisPengaturan_(ss, kunci, nilai) {
  var sh = tab_(ss, 'Pengaturan');
  var n = sh.getLastRow();
  var kunciAda = n >= 2 ? sh.getRange(2, 1, n - 1, 1).getValues().map(function (r) { return String(r[0]).trim(); }) : [];
  var i = kunciAda.indexOf(kunci);
  if (i >= 0) {
    var sel = sh.getRange(i + 2, 2);
    sel.setNumberFormat('@');
    sel.setValue(nilai);
  } else {
    sh.getRange(n + 1, 1, 1, 2).setValues([[kunci, nilai]]);
  }
}

var HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

function hariAwalMinggu_(peng) {
  var i = HARI.indexOf(String(peng['Awal minggu'] || 'Senin').trim());
  return i >= 0 ? i : 1;
}

function bacaTampilan_(peng) {
  try { return JSON.parse(String(peng['Tampilan'] || '{}')) || {}; } catch (e) { return {}; }
}

// ---------------------------------------------------------------- PENYIAPAN SHEET

function siapkanSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  PropertiesService.getScriptProperties().setProperty('idSheet', ss.getId());
  var hasil = siapkan_(ss);
  var pemicu = pasangPemicu_();
  var pesan = 'Sheet Catatan Sembada Kepuh siap.\n' +
    (hasil.dibuat.length ? 'Tab dibuat: ' + hasil.dibuat.join(', ') + '.\n' : 'Semua tab sudah ada.\n') +
    (hasil.sandi ? '\nAkun pemilik: ' + KP_PEMILIK_AWAL + '\nSandi sementara: ' + hasil.sandi + '\n(juga tertulis di tab Pengaturan, diganti saat pertama masuk)\n' : '') +
    (pemicu ? '' : '\nCatatan: pembaruan laporan otomatis setiap jam belum terpasang. Jalankan siapkanSheet sekali lagi.\n') +
    '\nLangkah berikutnya: Terapkan > Deployment baru > Aplikasi web.';
  Logger.log(pesan);
  try { SpreadsheetApp.getUi().alert(pesan); } catch (e) { /* dijalankan dari editor */ }
  return pesan;
}

function siapkan_(ss) {
  var dibuat = [];
  var siapkanTab = function (nama, kepala, format) {
    var sh = ss.getSheetByName(nama);
    var baru = !sh;
    if (baru) {
      sh = ss.insertSheet(nama);
      dibuat.push(nama);
      sh.getRange(1, 1, 1, kepala.length).setValues([kepala]);
    } else {
      // Tambahkan kolom yang belum ada di ujung kanan (untuk pembaruan versi).
      var lastCol = Math.max(sh.getLastColumn(), 1);
      var ada = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });
      var kurang = kepala.filter(function (h) { return ada.indexOf(h) < 0; });
      if (kurang.length) {
        var mulai = ada.filter(function (h) { return h; }).length ? sh.getLastColumn() + 1 : 1;
        sh.getRange(1, mulai, 1, kurang.length).setValues([kurang]);
      }
    }
    var kol = sh.getLastColumn();
    sh.getRange(1, 1, 1, kol).setFontWeight('bold').setBackground('#E5F2EA');
    sh.setFrozenRows(1);
    if (format) format(sh);
    return {sh: sh, baru: baru};
  };
  var formatKolom = function (sh) {
    var kepala = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    var n = Math.max(sh.getMaxRows() - 1, 1);
    kepala.forEach(function (h, j) {
      var f = formatAngka_(String(h));
      if (f) sh.getRange(2, j + 1, n, 1).setNumberFormat(f);
    });
  };

  siapkanTab('Ringkasan', ['Ringkasan', '', '']);
  URUTAN_TAB.forEach(function (t) {
    siapkanTab(t, TAB_DATA[t], function (sh) { formatKolom(sh); sh.hideColumns(1); });
  });
  TAB_LAPORAN.slice(1).forEach(function (t) { siapkanTab(t, ['(dihitung otomatis)']); });
  URUTAN_MASTER.forEach(function (t) {
    var r = siapkanTab(t, kepalaMaster_(t), function (sh) { formatKolom(sh); sh.hideColumns(1); });
    if (r.baru && BENIH[t].length) {
      var kepala = kepalaMaster_(t);
      var rows = BENIH[t].map(function (b, i) {
        var o = {'ID': idBaru_(), 'Urutan': i + 1, 'Aktif': 'Ya'};
        MASTER[t].kolom.forEach(function (c, j) { o[c.h] = b[j] === undefined ? '' : b[j]; });
        return kepala.map(function (h) { return o[h] === undefined ? '' : o[h]; });
      });
      r.sh.getRange(2, 1, rows.length, kepala.length).setValues(rows);
    }
  });
  var pg = siapkanTab('Pengguna', KEPALA_PENGGUNA, function (sh) {
    var k = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    ['Sandi (terenkripsi)', 'Garam', 'Versi sesi'].forEach(function (h) {
      var j = k.indexOf(h);
      if (j >= 0) sh.hideColumns(j + 1);
    });
  });
  var pengaturan = siapkanTab('Pengaturan', ['Pengaturan', 'Nilai', 'Keterangan']);
  var peng = bacaPengaturan_(ss);
  PENGATURAN_AWAL.forEach(function (p) {
    if (!(p[0] in peng)) {
      var n = pengaturan.sh.getLastRow();
      pengaturan.sh.getRange(n + 1, 1, 1, 3).setValues([p]);
    }
  });

  // Akun pemilik pertama.
  var sandi = '';
  if (bacaPengguna_(ss).length === 0) {
    sandi = sandiAcak_();
    var garam = idBaru_();
    var o = {'Nama pengguna': KP_PEMILIK_AWAL, 'Nama': 'Mas Wildan', 'Peran': 'Pemilik', 'Boleh mengisi': 'Semua',
      'Boleh mengatur': 'Ya', 'Aktif': 'Ya', 'Wajib ganti sandi': 'Ya', 'Sandi (terenkripsi)': hashSandi_(garam, sandi),
      'Garam': garam, 'Versi sesi': 1, 'Terakhir masuk': ''};
    var kp = pg.sh.getRange(1, 1, 1, pg.sh.getLastColumn()).getValues()[0];
    pg.sh.getRange(2, 1, 1, kp.length).setValues([kp.map(function (h) { return o[h] === undefined ? '' : o[h]; })]);
    tulisPengaturan_(ss, 'Sandi sementara pemilik', KP_PEMILIK_AWAL + ': ' + sandi);
  }

  // Urutan tab: Ringkasan, catatan harian, laporan, data induk, pengguna, pengaturan.
  var urutan = ['Ringkasan'].concat(URUTAN_TAB, TAB_LAPORAN.slice(1), URUTAN_MASTER, ['Pengguna', 'Pengaturan']);
  urutan.forEach(function (nama, i) {
    var sh = ss.getSheetByName(nama);
    if (!sh) return;
    try { ss.setActiveSheet(sh); ss.moveActiveSheet(i + 1); } catch (e) { /* abaikan */ }
  });
  // Buang tab kosong bawaan Google Sheet.
  ss.getSheets().forEach(function (sh) {
    if (urutan.indexOf(sh.getName()) < 0 && /^(Sheet|Lembar|Sheet ?)\d+$/.test(sh.getName()) && sh.getLastRow() === 0) {
      try { ss.deleteSheet(sh); } catch (e) { /* abaikan */ }
    }
  });
  try { perbaruiLaporan_(ss); } catch (e) { /* laporan menyusul */ }
  try { ss.setActiveSheet(ss.getSheetByName('Ringkasan')); } catch (e) { /* abaikan */ }
  return {dibuat: dibuat, sandi: sandi};
}

function formatAngka_(h) {
  if (/\(Rp\)$/.test(h)) return '"Rp"#,##0';
  if (/\((kg|liter)\)$/.test(h) || /\(kg bahan\)$/.test(h)) return '#,##0.00';
  if (/\(%\)$/.test(h)) return '0.0';
  if (/^(Tanggal|Minggu mulai|Sampai)/.test(h)) return 'dd/MM/yyyy';
  if (/^(Waktu kirim|Terakhir masuk)$/.test(h)) return 'dd/MM/yyyy HH:mm';
  if (h === 'Bulan') return 'MMMM yyyy';
  return '';
}

function sandiAcak_() {
  var huruf = 'abcdefghjkmnpqrstuvwxyz23456789';
  var s = '';
  for (var i = 0; i < 8; i++) s += huruf.charAt(Math.floor(Math.random() * huruf.length));
  return s;
}

function pasangPemicu_() {
  try {
    var ada = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'perbaruiLaporanTerjadwal'; });
    if (!ada) ScriptApp.newTrigger('perbaruiLaporanTerjadwal').timeBased().everyHours(1).create();
    return true;
  } catch (e) {
    return false;
  }
}

function onOpen() {
  try {
    SpreadsheetApp.getUi().createMenu('Catatan Kepuh')
      .addItem('Perbarui laporan sekarang', 'perbaruiLaporan')
      .addItem('Siapkan / perbaiki sheet', 'siapkanSheet')
      .addToUi();
  } catch (e) { /* abaikan */ }
  try {
    if (PropertiesService.getScriptProperties().getProperty('laporanKotor')) perbaruiLaporan_(SpreadsheetApp.getActiveSpreadsheet());
  } catch (e) { /* abaikan */ }
}

function perbaruiLaporan() {
  var ss = bukaSheet_();
  perbaruiLaporan_(ss);
  try { ss.toast('Laporan sudah diperbarui.'); } catch (e) { /* abaikan */ }
}

function perbaruiLaporanTerjadwal() {
  if (PropertiesService.getScriptProperties().getProperty('laporanKotor')) perbaruiLaporan_(bukaSheet_());
}

// ---------------------------------------------------------------- PENGGUNA & SESI

function normalNama_(s) { return String(s === null || s === undefined ? '' : s).trim().toLowerCase(); }

function hashSandi_(garam, sandi) {
  var teks = garam + ':' + String(sandi);
  var hasil = '';
  for (var i = 0; i < 100; i++) {
    hasil = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, teks, Utilities.Charset.UTF_8));
    teks = hasil + garam;
  }
  return hasil;
}

function bacaPengguna_(ss) {
  var sh = ss.getSheetByName('Pengguna');
  if (!sh) return [];
  var t = bacaTabel_(sh);
  var k = function (h) { return t.kepala.indexOf(h); };
  return t.baris.map(function (r, i) {
    var g = function (h) { var j = k(h); return j >= 0 ? r[j] : ''; };
    var boleh = String(g('Boleh mengisi')).trim();
    return {
      baris: t.nomor[i], pengguna: normalNama_(g('Nama pengguna')), nama: String(g('Nama')).trim(),
      peran: String(g('Peran')).trim() || 'Pencatat', boleh: boleh,
      mengatur: /^ya$/i.test(String(g('Boleh mengatur')).trim()), aktif: !/^tidak$/i.test(String(g('Aktif')).trim()),
      wajibGanti: /^ya$/i.test(String(g('Wajib ganti sandi')).trim()), hash: String(g('Sandi (terenkripsi)')),
      garam: String(g('Garam')), versi: Number(g('Versi sesi')) || 1, terakhir: g('Terakhir masuk')
    };
  }).filter(function (p) { return p.pengguna; });
}

function tulisPengguna_(ss, baris, nilai) {
  var sh = tab_(ss, 'Pengguna');
  var kepala = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (h) { return String(h).trim(); });
  if (!baris) {
    var row = kepala.map(function (h) { return nilai[h] === undefined ? '' : nilai[h]; });
    sh.getRange(sh.getLastRow() + 1, 1, 1, row.length).setValues([row]);
    return;
  }
  Object.keys(nilai).forEach(function (h) {
    var j = kepala.indexOf(h);
    if (j >= 0) sh.getRange(baris, j + 1).setValue(nilai[h]);
  });
}

function tabBoleh_(boleh) {
  if (/^semua$/i.test(boleh)) return URUTAN_TAB.slice();
  return String(boleh).split(',').map(function (t) { return t.trim(); }).filter(function (t) { return URUTAN_TAB.indexOf(t) >= 0; });
}

function aksesDari_(p) {
  var pemilik = p.peran === 'Pemilik';
  return {pengguna: p.pengguna, nama: p.nama || p.pengguna, peran: p.peran, tab: tabBoleh_(p.boleh),
    admin: pemilik || p.mengatur, pemilik: pemilik, wajibGanti: p.wajibGanti, baris: p.baris, versi: p.versi};
}

function kunciSesi_(token) {
  var d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(token), Utilities.Charset.UTF_8);
  return 'S_' + Utilities.base64Encode(d).replace(/[^A-Za-z0-9]/g, '').slice(0, 24);
}

function buatSesi_(p) {
  var token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  var hari = sekarangTeks_();
  PropertiesService.getScriptProperties().setProperty(kunciSesi_(token), JSON.stringify({u: p.pengguna, v: p.versi, t: hari, a: hari}));
  return token;
}

function cekSesi_(ss, token) {
  if (!token) return null;
  var props = PropertiesService.getScriptProperties();
  var kunci = kunciSesi_(token);
  var isi = props.getProperty(kunci);
  if (!isi) return null;
  var s;
  try { s = JSON.parse(isi); } catch (e) { return null; }
  var p = bacaPengguna_(ss).filter(function (x) { return x.pengguna === s.u; })[0];
  if (!p || !p.aktif || p.versi !== s.v) { props.deleteProperty(kunci); return null; }
  var hari = sekarangTeks_();
  if (s.a !== hari) { s.a = hari; props.setProperty(kunci, JSON.stringify(s)); }
  return aksesDari_(p);
}

function bersihkanSesi_() {
  var props = PropertiesService.getScriptProperties();
  var batas = new Date(Date.now() - KP_SESI_HARI * 86400000);
  var batasTeks = Utilities.formatDate(batas, KP_ZONA, 'yyyy-MM-dd');
  props.getKeys().forEach(function (k) {
    if (k.indexOf('S_') !== 0) return;
    try {
      var s = JSON.parse(props.getProperty(k));
      if (!s.a || s.a < batasTeks) props.deleteProperty(k);
    } catch (e) { props.deleteProperty(k); }
  });
}

function masuk_(ss, req) {
  var u = normalNama_(req.pengguna);
  var cache = CacheService.getScriptCache();
  var gagalSemua = Number(cache.get('gagalSemua') || 0);
  var gagalIni = Number(cache.get('gagal_' + u) || 0);
  if (gagalSemua >= 60 || gagalIni >= KP_BATAS_GAGAL) {
    return {ok: false, kode: 'KUNCI', galat: 'Terlalu banyak sandi salah. Coba lagi 15 menit lagi.'};
  }
  var p = bacaPengguna_(ss).filter(function (x) { return x.pengguna === u; })[0];
  if (!u || !p || !p.aktif || !p.garam || hashSandi_(p.garam, String(req.sandi || '')) !== p.hash) {
    cache.put('gagalSemua', String(gagalSemua + 1), 900);
    if (u) cache.put('gagal_' + u, String(gagalIni + 1), 900);
    return {ok: false, kode: 'SALAH', galat: 'Nama pengguna atau sandi salah.'};
  }
  bersihkanSesi_();
  var token = buatSesi_(p);
  tulisPengguna_(ss, p.baris, {'Terakhir masuk': new Date()});
  return {ok: true, token: token, akses: aksesDari_(p), versiApi: KP_VERSI};
}

function keluarSesi_(token) {
  PropertiesService.getScriptProperties().deleteProperty(kunciSesi_(token));
  return {ok: true};
}

function cekSandiBaru_(s) {
  s = String(s || '');
  if (s.length < 6) return 'Sandi minimal 6 huruf atau angka.';
  if (s.length > 64) return 'Sandi terlalu panjang.';
  return '';
}

function sandiUbah_(ss, akses, req) {
  var p = bacaPengguna_(ss).filter(function (x) { return x.pengguna === akses.pengguna; })[0];
  if (!p) return {ok: false, galat: 'Pengguna tidak ditemukan.'};
  if (hashSandi_(p.garam, String(req.sandiLama || '')) !== p.hash) return {ok: false, galat: 'Sandi lama salah.'};
  var cek = cekSandiBaru_(req.sandiBaru);
  if (cek) return {ok: false, galat: cek};
  if (String(req.sandiBaru) === String(req.sandiLama)) return {ok: false, galat: 'Sandi baru harus berbeda dari sandi lama.'};
  var garam = idBaru_();
  var versi = p.versi + 1;
  tulisPengguna_(ss, p.baris, {'Sandi (terenkripsi)': hashSandi_(garam, req.sandiBaru), 'Garam': garam, 'Versi sesi': versi,
    'Wajib ganti sandi': 'Tidak'});
  var peng = bacaPengaturan_(ss);
  if (String(peng['Sandi sementara pemilik'] || '').indexOf(p.pengguna + ':') === 0) tulisPengaturan_(ss, 'Sandi sementara pemilik', '');
  catatLog_(ss, 'Ganti sandi', 'Pengguna', p.baris, '', p.pengguna, akses.pengguna);
  p.versi = versi; p.wajibGanti = false;
  return {ok: true, token: buatSesi_(p), akses: aksesDari_(p)};
}

function penggunaDaftar_(ss, akses) {
  if (!akses.pemilik) return {ok: false, galat: 'Hanya pemilik yang boleh mengatur pengguna.'};
  return {ok: true, daftar: bacaPengguna_(ss).map(function (p) {
    return {pengguna: p.pengguna, nama: p.nama, peran: p.peran, boleh: /^semua$/i.test(p.boleh) ? 'Semua' : tabBoleh_(p.boleh),
      mengatur: p.mengatur || p.peran === 'Pemilik', aktif: p.aktif, wajibGanti: p.wajibGanti, saya: p.pengguna === akses.pengguna,
      terakhir: adalahTanggal_(p.terakhir) ? Utilities.formatDate(p.terakhir, KP_ZONA, 'dd/MM/yyyy HH:mm') : ''};
  })};
}

function penggunaSimpan_(ss, akses, req) {
  if (!akses.pemilik) return {ok: false, galat: 'Hanya pemilik yang boleh mengatur pengguna.'};
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var semua = bacaPengguna_(ss);
    var u = normalNama_(req.pengguna);
    var p = semua.filter(function (x) { return x.pengguna === u; })[0];
    var nama = String(req.nama || '').trim();
    var peran = PERAN_PENGGUNA.indexOf(req.peran) >= 0 ? req.peran : 'Pencatat';
    var boleh = req.boleh === 'Semua' ? 'Semua' : (req.boleh || []).filter(function (t) { return URUTAN_TAB.indexOf(t) >= 0; }).join(', ');
    var aktif = req.aktif !== false;
    if (!nama) return {ok: false, galat: 'Nama wajib diisi.'};

    if (req.baru) {
      if (!/^[a-z0-9._-]{3,30}$/.test(u)) return {ok: false, galat: 'Nama pengguna 3–30 huruf kecil, angka, titik, atau garis bawah. Tanpa spasi.'};
      if (p) return {ok: false, galat: 'Nama pengguna "' + u + '" sudah dipakai.'};
      var cek = cekSandiBaru_(req.sandiBaru);
      if (cek) return {ok: false, galat: cek};
      var garam = idBaru_();
      tulisPengguna_(ss, 0, {'Nama pengguna': u, 'Nama': nama, 'Peran': peran, 'Boleh mengisi': boleh, 'Boleh mengatur': req.mengatur ? 'Ya' : 'Tidak',
        'Aktif': aktif ? 'Ya' : 'Tidak', 'Wajib ganti sandi': req.wajibGanti ? 'Ya' : 'Tidak',
        'Sandi (terenkripsi)': hashSandi_(garam, req.sandiBaru), 'Garam': garam, 'Versi sesi': 1, 'Terakhir masuk': ''});
      catatLog_(ss, 'Tambah pengguna', 'Pengguna', '', '', u + ' (' + peran + ')', akses.pengguna);
      return {ok: true};
    }

    if (!p) return {ok: false, galat: 'Pengguna tidak ditemukan.'};
    var pemilikLain = semua.filter(function (x) { return x.peran === 'Pemilik' && x.aktif && x.pengguna !== u; }).length;
    if (p.peran === 'Pemilik' && p.aktif && (peran !== 'Pemilik' || !aktif) && pemilikLain === 0) {
      return {ok: false, galat: 'Harus ada minimal satu pemilik yang aktif.'};
    }
    var ubah = {'Nama': nama, 'Peran': peran, 'Boleh mengisi': boleh, 'Boleh mengatur': req.mengatur ? 'Ya' : 'Tidak', 'Aktif': aktif ? 'Ya' : 'Tidak'};
    if (req.sandiBaru) {
      var cek2 = cekSandiBaru_(req.sandiBaru);
      if (cek2) return {ok: false, galat: cek2};
      var garam2 = idBaru_();
      ubah['Sandi (terenkripsi)'] = hashSandi_(garam2, req.sandiBaru);
      ubah['Garam'] = garam2;
      ubah['Versi sesi'] = p.versi + 1;          // HP yang masuk dengan sandi lama diminta masuk lagi
      ubah['Wajib ganti sandi'] = req.wajibGanti ? 'Ya' : 'Tidak';
    }
    tulisPengguna_(ss, p.baris, ubah);
    catatLog_(ss, 'Ubah pengguna', 'Pengguna', p.baris, '', u + (req.sandiBaru ? ' (sandi diganti)' : ''), akses.pengguna);
    return {ok: true};
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------- DATA INDUK

function bacaMaster_(ss, tab) {
  var t = bacaTabel_(tab_(ss, tab));
  var utama = MASTER[tab].utama;
  return t.baris.map(function (r, i) {
    var o = objekBaris_(t.kepala, r);
    var nilai = {};
    MASTER[tab].kolom.forEach(function (c) {
      var v = o[c.h];
      if (c.j === 'tanggal') v = tglKunci_(v);
      else if (v === null || v === undefined) v = '';
      nilai[c.h] = typeof v === 'number' ? v : String(v).trim();
    });
    if (MASTER[tab].keluar) nilai['Tanggal keluar'] = tglKunci_(o['Tanggal keluar']);
    return {id: String(o['ID'] || ''), nilai: nilai, urutan: Number(o['Urutan']) || 9999, aktif: !/^tidak$/i.test(String(o['Aktif']).trim()),
      baris: t.nomor[i]};
  }).filter(function (m) { return m.nilai[utama] !== ''; })
    .sort(function (a, b) { return a.urutan - b.urutan; });
}

function masterAkses_(akses) { return akses.admin ? '' : 'Hanya pemilik atau pengguna yang boleh mengatur.'; }

function masterSimpan_(ss, akses, req) {
  var larang = masterAkses_(akses);
  if (larang) return {ok: false, galat: larang};
  var tab = String(req.tab || '');
  var def = MASTER[tab];
  if (!def) return {ok: false, galat: 'Data tidak dikenal.'};
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var semua = bacaMaster_(ss, tab);
    var nilai = {};
    for (var i = 0; i < def.kolom.length; i++) {
      var c = def.kolom[i];
      var v = req.nilai ? req.nilai[c.h] : '';
      if (v === undefined || v === null) v = '';
      if (c.j === 'rupiah' || c.j === 'desimal') v = v === '' ? '' : angka_(v);
      else v = String(v).trim();
      if (c.wajib && v === '') return {ok: false, galat: c.h + ' wajib diisi.'};
      if (c.opsi && v !== '' && c.opsi.indexOf(v) < 0) return {ok: false, galat: c.h + ' tidak dikenal: ' + v};
      if (c.j === 'tanggal' && v) v = tglKunci_(v) ? tglDariKunci_(tglKunci_(v)) : '';
      nilai[c.h] = v;
    }
    var utama = def.utama;
    var id = String(req.id || '');
    var lama = id ? semua.filter(function (m) { return m.id === id; })[0] : null;
    if (id && !lama) return {ok: false, galat: 'Data ini sudah tidak ada. Muat ulang.'};
    var kembar = semua.filter(function (m) {
      return m.id !== id && normalNama_(m.nilai[utama]) === normalNama_(nilai[utama]) &&
        (!def.kelompok || m.nilai[def.kelompok] === nilai[def.kelompok]);
    })[0];
    if (kembar) return {ok: false, galat: '"' + nilai[utama] + '" sudah ada' + (kembar.aktif ? '' : ' (tidak aktif, bisa diaktifkan lagi)') + '.'};

    var sh = tab_(ss, tab);
    var kepala = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (h) { return String(h).trim(); });
    if (lama) {
      Object.keys(nilai).forEach(function (h) {
        var j = kepala.indexOf(h);
        if (j >= 0) sh.getRange(lama.baris, j + 1).setValue(nilai[h]);
      });
      var namaLama = lama.nilai[utama], namaBaru = nilai[utama];
      var ganti = namaLama !== namaBaru ? gantiNamaDiCatatan_(ss, tab, namaLama, namaBaru) : 0;
      catatLog_(ss, 'Ubah data induk', tab, lama.baris, JSON.stringify(lama.nilai), JSON.stringify(nilai), akses.pengguna);
      if (ganti) tandaiLaporanKotor_();
      return {ok: true, id: id, catatanDiganti: ganti};
    }
    var o = {'ID': idBaru_(), 'Aktif': 'Ya', 'Urutan': semua.reduce(function (m, x) { return Math.max(m, x.urutan === 9999 ? 0 : x.urutan); }, 0) + 1};
    Object.keys(nilai).forEach(function (h) { o[h] = nilai[h]; });
    var row = kepala.map(function (h) { return o[h] === undefined ? '' : o[h]; });
    sh.getRange(sh.getLastRow() + 1, 1, 1, row.length).setValues([row]);
    catatLog_(ss, 'Tambah data induk', tab, '', '', JSON.stringify(nilai), akses.pengguna);
    return {ok: true, id: o['ID']};
  } finally {
    lock.releaseLock();
  }
}

// Kalau nama karyawan, alat, atau pilihan tarif diganti, catatan lama ikut diganti supaya rekap per orang/alat tetap utuh.
function gantiNamaDiCatatan_(ss, tab, lama, baru) {
  var target = [];
  if (tab === 'Karyawan') {
    target = [['Absensi', 'Nama', false], ['Produksi Suling', 'Operator', false], ['Ambil Bahan', 'Pengumpul', true], ['Alat Suling', 'Operator tetap', false]];
  } else if (tab === 'Alat Suling') {
    target = [['Produksi Suling', 'Alat suling', false], ['Saring Minyak', 'Alat suling', false]];
  } else if (tab === 'Tarif Upah') {
    target = [['Absensi', 'Kehadiran', false]];
  } else {
    return 0;
  }
  var jumlah = 0;
  target.forEach(function (tg) {
    var sh = ss.getSheetByName(tg[0]);
    if (!sh || sh.getLastRow() < 2) return;
    var kepala = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (h) { return String(h).trim(); });
    var j = kepala.indexOf(tg[1]);
    if (j < 0) return;
    var rg = sh.getRange(2, j + 1, sh.getLastRow() - 1, 1);
    var vals = rg.getValues();
    var berubah = false;
    vals.forEach(function (r) {
      var v = String(r[0]);
      if (tg[2]) {
        var bagian = v.split(',').map(function (x) { return x.trim(); });
        if (bagian.indexOf(lama) >= 0) {
          r[0] = bagian.map(function (x) { return x === lama ? baru : x; }).join(', ');
          berubah = true; jumlah++;
        }
      } else if (v === lama) {
        r[0] = baru; berubah = true; jumlah++;
      }
    });
    if (berubah) rg.setValues(vals);
  });
  return jumlah;
}

function masterAktif_(ss, akses, req) {
  var larang = masterAkses_(akses);
  if (larang) return {ok: false, galat: larang};
  var tab = String(req.tab || '');
  if (!MASTER[tab]) return {ok: false, galat: 'Data tidak dikenal.'};
  var m = bacaMaster_(ss, tab).filter(function (x) { return x.id === String(req.id || ''); })[0];
  if (!m) return {ok: false, galat: 'Data ini sudah tidak ada. Muat ulang.'};
  var sh = tab_(ss, tab);
  var kepala = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (h) { return String(h).trim(); });
  var aktif = req.aktif !== false;
  sh.getRange(m.baris, kepala.indexOf('Aktif') + 1).setValue(aktif ? 'Ya' : 'Tidak');
  if (MASTER[tab].keluar && kepala.indexOf('Tanggal keluar') >= 0) {
    var tk = aktif ? '' : tglDariKunci_(tglKunci_(req.tanggalKeluar) || sekarangTeks_());
    sh.getRange(m.baris, kepala.indexOf('Tanggal keluar') + 1).setValue(tk);
  }
  catatLog_(ss, aktif ? 'Aktifkan' : 'Nonaktifkan', tab, m.baris, '', m.nilai[MASTER[tab].utama], akses.pengguna);
  return {ok: true};
}

function masterUrut_(ss, akses, req) {
  var larang = masterAkses_(akses);
  if (larang) return {ok: false, galat: larang};
  var tab = String(req.tab || '');
  if (!MASTER[tab]) return {ok: false, galat: 'Data tidak dikenal.'};
  var ids = (req.ids || []).map(String);
  var semua = bacaMaster_(ss, tab);
  var sh = tab_(ss, tab);
  var kepala = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (h) { return String(h).trim(); });
  var kol = kepala.indexOf('Urutan') + 1;
  // Yang tidak disebut tetap di belakang dengan urutan lamanya.
  var sisa = semua.filter(function (m) { return ids.indexOf(m.id) < 0; });
  var urutan = ids.map(function (id) { return semua.filter(function (m) { return m.id === id; })[0]; })
    .filter(function (m) { return m; }).concat(sisa);
  urutan.forEach(function (m, i) { sh.getRange(m.baris, kol).setValue(i + 1); });
  return {ok: true};
}

// ---------------------------------------------------------------- CONFIG

function config_(ss, akses) {
  var peng = bacaPengaturan_(ss);
  var master = {};
  URUTAN_MASTER.forEach(function (t) {
    master[t] = bacaMaster_(ss, t).filter(function (m) { return akses.admin || m.aktif; })
      .map(function (m) { return {id: m.id, nilai: m.nilai, aktif: m.aktif}; });
  });
  var kepala = {};
  URUTAN_TAB.forEach(function (t) { kepala[t] = kolomInput_(t); });
  return {ok: true, versiApi: KP_VERSI, akses: akses, master: master, kepala: kepala,
    skema: akses.admin ? skemaMaster_() : null,
    pengaturan: {namaUsaha: String(peng['Nama usaha'] || ''), lokasi: String(peng['Lokasi'] || ''),
      awalMinggu: HARI[hariAwalMinggu_(peng)]},
    tampilan: bacaTampilan_(peng)};
}

function skemaMaster_() {
  var out = {};
  URUTAN_MASTER.forEach(function (t) {
    out[t] = {kunci: MASTER[t].kunci, judul: MASTER[t].judul, utama: MASTER[t].utama, kelompok: MASTER[t].kelompok || '',
      keluar: !!MASTER[t].keluar, kolom: MASTER[t].kolom};
  });
  return out;
}

function tampilanSimpan_(ss, akses, req) {
  if (!akses.pemilik) return {ok: false, galat: 'Hanya pemilik yang boleh mengubah tampilan untuk semua.'};
  var teks = JSON.stringify(req.tampilan || {});
  if (teks.length > 40000) return {ok: false, galat: 'Pengaturan tampilan terlalu besar.'};
  tulisPengaturan_(ss, 'Tampilan', teks);
  catatLog_(ss, 'Ubah tampilan', 'Pengaturan', '', '', teks.slice(0, 500), akses.pengguna);
  return {ok: true};
}

function pengaturanSimpan_(ss, akses, req) {
  if (!akses.pemilik) return {ok: false, galat: 'Hanya pemilik yang boleh mengubah pengaturan.'};
  if (req.awalMinggu !== undefined) {
    if (HARI.indexOf(req.awalMinggu) < 0) return {ok: false, galat: 'Hari tidak dikenal.'};
    tulisPengaturan_(ss, 'Awal minggu', req.awalMinggu);
    tandaiLaporanKotor_();
  }
  if (req.lokasi !== undefined) tulisPengaturan_(ss, 'Lokasi', String(req.lokasi).trim().slice(0, 60));
  return {ok: true};
}

// ---------------------------------------------------------------- SIMPAN CATATAN

function ubahNilai_(judul, v) {
  if (v === null || v === undefined) return '';
  if (Object.prototype.toString.call(v) === '[object Array]') {
    return v.map(function (x) { return String(x).trim(); }).filter(function (x) { return x; }).join(', ');
  }
  if (typeof v === 'number') return isFinite(v) ? v : '';
  var s = String(v).trim();
  if (/^Tanggal/.test(judul) && /^\d{4}-\d{2}-\d{2}$/.test(s)) return tglDariKunci_(s);
  return s;
}

// Peta nama -> data induk aktif maupun tidak (untuk hitungan otomatis).
function petaMaster_(ss, tab) {
  var peta = {};
  bacaMaster_(ss, tab).forEach(function (m) { peta[m.nilai[MASTER[tab].utama]] = m.nilai; });
  return peta;
}

// Mengisi kolom hitungan untuk satu baris (objek per judul kolom).
function lengkapiBaris_(tab, o, induk) {
  if (tab === 'Ambil Bahan') {
    var beli = angka_(o['Uang dibawa (Rp)']) - angka_(o['Uang sisa (Rp)']) - angka_(o['Biaya lain di jalan (Rp)']);
    o['Uang beli bahan (Rp)'] = beli;
    var berat = angka_(o['Berat bahan (kg)']);
    o['Harga bahan per kg (Rp)'] = berat > 0 ? bulat_(beli / berat, 0) : '';
  } else if (tab === 'Produksi Suling') {
    var alat = induk.alat[o['Alat suling']];
    if (o['Upah per sulingan (Rp)'] === undefined || o['Upah per sulingan (Rp)'] === '') {
      o['Upah per sulingan (Rp)'] = alat ? angka_(alat['Upah per sulingan (Rp)']) : 0;
    }
    o['Upah (Rp)'] = angka_(o['Jumlah sulingan']) * angka_(o['Upah per sulingan (Rp)']);
  } else if (tab === 'Saring Minyak') {
    var n = angka_(o['Jumlah sulingan yang disaring']);
    o['Minyak per sulingan (kg)'] = n > 0 ? bulat_(angka_(o['Minyak (kg)']) / n, 3) : '';
  } else if (tab === 'Absensi') {
    var k = induk.karyawan[o['Nama']];
    o['Peran'] = k ? k['Peran'] : (o['Peran'] || '');
    if (o['Upah absensi (Rp)'] === undefined || o['Upah absensi (Rp)'] === '') {
      var t = induk.tarif[o['Kehadiran']];
      o['Upah absensi (Rp)'] = o['Kehadiran'] ? (t ? angka_(t['Upah (Rp)']) : 0) : '';
    }
  } else if (tab === 'Penjualan') {
    var p = induk.produk[o['Produk']];
    if (!o['Satuan']) o['Satuan'] = p ? p['Satuan'] : '';
    o['Total (Rp)'] = angka_(o['Jumlah']) * angka_(o['Harga satuan (Rp)']);
  } else if (tab === 'Kas') {
    var kat = induk.kategori[o['Kategori']];
    o['Arah'] = kat ? kat['Arah'] : (o['Arah'] || 'Keluar');
  }
  return o;
}

function indukUntuk_(ss, tab) {
  var induk = {};
  if (tab === 'Produksi Suling') induk.alat = petaMaster_(ss, 'Alat Suling');
  if (tab === 'Absensi') { induk.karyawan = petaMaster_(ss, 'Karyawan'); induk.tarif = petaMaster_(ss, 'Tarif Upah'); }
  if (tab === 'Penjualan') induk.produk = petaMaster_(ss, 'Produk');
  if (tab === 'Kas') induk.kategori = petaMaster_(ss, 'Kategori Kas');
  return induk;
}

function kepalaTab_(sh) {
  return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (h) { return String(h).trim(); });
}

function simpan_(ss, akses, req) {
  var tab = String(req.tab || '');
  if (!TAB_DATA[tab]) return {ok: false, galat: 'Catatan tidak dikenal: ' + tab};
  if (akses.tab.indexOf(tab) < 0) return {ok: false, galat: 'Akun ini tidak boleh mengisi ' + tab + '.'};
  var id = String(req.id || '');
  var input = kolomInput_(tab);
  var bersama = req.nilai || {};
  var asing = Object.keys(bersama).filter(function (h) { return input.indexOf(h) < 0; });
  var barisReq = TAB_KELOMPOK[tab] ? (req.baris || []) : [bersama];
  if (TAB_KELOMPOK[tab]) {
    barisReq.forEach(function (b) {
      Object.keys(b).forEach(function (h) { if (input.indexOf(h) < 0 && asing.indexOf(h) < 0) asing.push(h); });
    });
  }
  if (asing.length) return {ok: false, galat: 'Kolom tidak dikenal di ' + tab + ': ' + asing.join(', ') + '. Perbarui aplikasi lalu kirim ulang.'};
  if (!barisReq.length) return {ok: false, galat: 'Tidak ada isian untuk disimpan.'};
  var kolTgl = kolomTanggal_(tab);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(bersama[kolTgl] || ''))) return {ok: false, galat: 'Tanggal wajib diisi.'};

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var props = PropertiesService.getScriptProperties();
    var ids = [];
    try { ids = JSON.parse(props.getProperty('idMasuk') || '[]'); } catch (e) { ids = []; }
    if (id && ids.indexOf(id) >= 0) return {ok: true, dobel: true};

    var sh = tab_(ss, tab);
    var kepala = kepalaTab_(sh);
    var induk = indukUntuk_(ss, tab);
    var waktu = new Date();
    var baru = barisReq.map(function (b, i) {
      var o = {};
      Object.keys(bersama).forEach(function (h) { o[h] = ubahNilai_(h, bersama[h]); });
      Object.keys(b).forEach(function (h) { o[h] = ubahNilai_(h, b[h]); });
      o['ID'] = (id || idBaru_()) + (TAB_KELOMPOK[tab] ? '-' + (i + 1) : '');
      o['Waktu kirim'] = waktu;
      o['Dicatat oleh'] = akses.nama;
      if (TAB_KELOMPOK[tab]) o['ID isian'] = id;
      return lengkapiBaris_(tab, o, induk);
    });

    var ubahLama = [];
    if (TAB_KELOMPOK[tab]) {
      var cek = cekKelompok_(sh, kepala, tab, baru);
      if (cek.galat) return {ok: false, kode: 'SUDAH', galat: cek.galat};
      baru = cek.baru;
      ubahLama = cek.ubah;
    }

    ubahLama.forEach(function (u) {
      sh.getRange(u.baris, 1, 1, kepala.length).setValues([kepala.map(function (h) { return u.o[h] === undefined ? '' : u.o[h]; })]);
    });
    if (baru.length) {
      var rows = baru.map(function (o) { return kepala.map(function (h) { return o[h] === undefined ? '' : o[h]; }); });
      sh.getRange(sh.getLastRow() + 1, 1, rows.length, kepala.length).setValues(rows);
    }
    SpreadsheetApp.flush();

    if (id) {
      ids.push(id);
      if (ids.length > KP_SIMPAN_ID) ids = ids.slice(ids.length - KP_SIMPAN_ID);
      // Batas Apps Script 9 KB per nilai: buang id tertua kalau terlalu panjang.
      while (JSON.stringify(ids).length > 8000) ids.shift();
      props.setProperty('idMasuk', JSON.stringify(ids));
    }
    tandaiLaporanKotor_();
    if (!baru.length && !ubahLama.length) return {ok: true, dobel: true};
    return {ok: true, baris: baru.length, gabung: ubahLama.length};
  } finally {
    lock.releaseLock();
  }
}

// Produksi Suling: satu alat satu baris per tanggal. Absensi: satu orang satu baris per tanggal.
// Isian yang sama persis dilewati. Absensi yang belum lengkap (misalnya baru kerja lain) digabung ke baris lama.
function cekKelompok_(sh, kepala, tab, baru) {
  var kunciNama = tab === 'Absensi' ? 'Nama' : 'Alat suling';
  var lama = bacaTabel_(sh);
  var peta = {};
  lama.baris.forEach(function (r, i) {
    var o = objekBaris_(lama.kepala, r);
    peta[tglKunci_(o['Tanggal']) + '|' + String(o[kunciNama]).trim()] = {o: o, baris: lama.nomor[i]};
  });
  var bentrok = [], tetap = [], ubah = [];
  var dalamIsian = {};
  baru.forEach(function (o) {
    var k = tglKunci_(o['Tanggal']) + '|' + String(o[kunciNama]).trim();
    if (dalamIsian[k]) { bentrok.push(o[kunciNama] + ' tertulis dua kali'); return; }
    dalamIsian[k] = true;
    var ada = peta[k];
    if (!ada) { tetap.push(o); return; }
    var a = ada.o;
    if (tab === 'Produksi Suling') {
      if (angka_(a['Jumlah sulingan']) === angka_(o['Jumlah sulingan']) && String(a['Operator'] || '') === String(o['Operator'] || '')) return;
      bentrok.push(o[kunciNama] + ' sudah tercatat ' + angka_(a['Jumlah sulingan']) + ' sulingan' + (a['Operator'] ? ' (' + a['Operator'] + ')' : ''));
      return;
    }
    // Absensi: gabungkan kalau tidak bertentangan.
    var gabung = {}, berubah = false, salah = [];
    Object.keys(a).forEach(function (h) { if (h !== '_baris') gabung[h] = a[h]; });
    if (o['Kehadiran']) {
      if (!a['Kehadiran']) { gabung['Kehadiran'] = o['Kehadiran']; gabung['Upah absensi (Rp)'] = o['Upah absensi (Rp)']; berubah = true; }
      else if (String(a['Kehadiran']) !== String(o['Kehadiran'])) salah.push('sudah tercatat "' + a['Kehadiran'] + '"');
    }
    if (o['Pekerjaan lain'] || angka_(o['Upah kerja lain (Rp)']) > 0) {
      if (!a['Pekerjaan lain'] && !(angka_(a['Upah kerja lain (Rp)']) > 0)) {
        gabung['Pekerjaan lain'] = o['Pekerjaan lain']; gabung['Upah kerja lain (Rp)'] = o['Upah kerja lain (Rp)']; berubah = true;
      } else if (String(a['Pekerjaan lain']) !== String(o['Pekerjaan lain']) || angka_(a['Upah kerja lain (Rp)']) !== angka_(o['Upah kerja lain (Rp)'])) {
        salah.push('kerja lain sudah tercatat');
      }
    }
    if (o['Keterangan'] && String(a['Keterangan'] || '').indexOf(String(o['Keterangan'])) < 0) {
      gabung['Keterangan'] = a['Keterangan'] ? a['Keterangan'] + ' | ' + o['Keterangan'] : o['Keterangan'];
      berubah = true;
    }
    if (salah.length) { bentrok.push(o[kunciNama] + ' ' + salah.join(', ')); return; }
    if (berubah) ubah.push({baris: ada.baris, o: gabung});
  });
  if (bentrok.length) {
    var tgl = tglIndo_(tglKunci_(baru[0]['Tanggal']));
    return {galat: tab + ' ' + tgl + ': ' + bentrok.join('; ') + '. Kalau salah, ubah lewat Riwayat.'};
  }
  return {baru: tetap, ubah: ubah};
}

// ---------------------------------------------------------------- RIWAYAT

function nilaiUntukAplikasi_(h, v) {
  if (adalahTanggal_(v)) {
    if (h === 'Waktu kirim') return Utilities.formatDate(v, KP_ZONA, 'dd/MM/yyyy HH:mm');
    return Utilities.formatDate(v, KP_ZONA, 'yyyy-MM-dd');
  }
  return v === null || v === undefined ? '' : v;
}

function terbaru_(ss, akses, req) {
  var tab = String(req.tab || '');
  if (!TAB_DATA[tab]) return {ok: false, galat: 'Catatan tidak dikenal.'};
  if (akses.tab.indexOf(tab) < 0 && !akses.admin) return {ok: false, galat: 'Akun ini tidak boleh melihat ' + tab + '.'};
  var n = Math.max(1, Math.min(Number(req.n) || 20, 300));
  var t = bacaTabel_(tab_(ss, tab));
  var kolTgl = kolomTanggal_(tab);
  var data = t.baris.map(function (r, i) {
    var o = objekBaris_(t.kepala, r);
    var nilai = {};
    t.kepala.forEach(function (h) { if (h) nilai[h] = nilaiUntukAplikasi_(h, o[h]); });
    return {id: String(o['ID'] || ''), urut: i, tgl: tglKunci_(o[kolTgl]), nilai: nilai};
  });
  data.sort(function (a, b) { return a.tgl < b.tgl ? 1 : a.tgl > b.tgl ? -1 : b.urut - a.urut; });
  return {ok: true, tab: tab, kepala: t.kepala, total: data.length, data: data.slice(0, n).map(function (d) { return {id: d.id, nilai: d.nilai}; })};
}

function cariBarisId_(sh, id) {
  if (!id) return 0;
  var kepala = kepalaTab_(sh);
  var j = kepala.indexOf('ID');
  if (j < 0 || sh.getLastRow() < 2) return 0;
  var ids = sh.getRange(2, j + 1, sh.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === id) return i + 2;
  return 0;
}

function ubah_(ss, akses, req) {
  if (!akses.admin) return {ok: false, galat: 'Hanya pemilik atau pengguna yang boleh mengatur yang bisa mengubah catatan.'};
  var tab = String(req.tab || '');
  if (!TAB_DATA[tab]) return {ok: false, galat: 'Catatan tidak dikenal.'};
  var input = kolomInput_(tab);
  var nilai = req.nilai || {};
  var asing = Object.keys(nilai).filter(function (h) { return input.indexOf(h) < 0; });
  if (asing.length) return {ok: false, galat: 'Kolom tidak dikenal: ' + asing.join(', ') + '.'};
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sh = tab_(ss, tab);
    var r = cariBarisId_(sh, String(req.id || ''));
    if (!r) return {ok: false, kode: 'BERUBAH', galat: 'Catatan ini sudah terhapus. Muat ulang Riwayat.'};
    var kepala = kepalaTab_(sh);
    var lamaRow = sh.getRange(r, 1, 1, kepala.length).getValues()[0];
    var lama = objekBaris_(kepala, lamaRow);
    var o = {};
    Object.keys(lama).forEach(function (h) { o[h] = lama[h]; });
    Object.keys(nilai).forEach(function (h) { o[h] = ubahNilai_(h, nilai[h]); });
    // Hitungan ikut tarif saat ini hanya kalau sumbernya berubah.
    if (tab === 'Produksi Suling' && o['Alat suling'] !== lama['Alat suling']) o['Upah per sulingan (Rp)'] = '';
    if (tab === 'Absensi' && o['Kehadiran'] !== lama['Kehadiran']) o['Upah absensi (Rp)'] = '';
    if (tab === 'Penjualan' && o['Produk'] !== lama['Produk']) o['Satuan'] = '';
    if (TAB_KELOMPOK[tab]) {
      var kunciNama = tab === 'Absensi' ? 'Nama' : 'Alat suling';
      var k = tglKunci_(o['Tanggal']) + '|' + o[kunciNama];
      var t = bacaTabel_(sh);
      var kembar = t.baris.some(function (row, i) {
        var x = objekBaris_(t.kepala, row);
        return t.nomor[i] !== r && tglKunci_(x['Tanggal']) + '|' + x[kunciNama] === k;
      });
      if (kembar) return {ok: false, galat: o[kunciNama] + ' sudah punya catatan lain di tanggal ' + tglIndo_(tglKunci_(o['Tanggal'])) + '.'};
    }
    lengkapiBaris_(tab, o, indukUntuk_(ss, tab));
    sh.getRange(r, 1, 1, kepala.length).setValues([kepala.map(function (h) { return o[h] === undefined ? '' : o[h]; })]);
    SpreadsheetApp.flush();
    catatLog_(ss, 'Ubah', tab, r, ringkasLog_(lama), ringkasLog_(o), akses.pengguna);
    tandaiLaporanKotor_();
    return {ok: true};
  } finally {
    lock.releaseLock();
  }
}

function hapus_(ss, akses, req) {
  if (!akses.admin) return {ok: false, galat: 'Hanya pemilik atau pengguna yang boleh mengatur yang bisa menghapus catatan.'};
  var tab = String(req.tab || '');
  if (!TAB_DATA[tab]) return {ok: false, galat: 'Catatan tidak dikenal.'};
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sh = tab_(ss, tab);
    var r = cariBarisId_(sh, String(req.id || ''));
    if (!r) return {ok: false, kode: 'BERUBAH', galat: 'Catatan ini sudah terhapus. Muat ulang Riwayat.'};
    var kepala = kepalaTab_(sh);
    var lama = objekBaris_(kepala, sh.getRange(r, 1, 1, kepala.length).getValues()[0]);
    sh.deleteRow(r);
    catatLog_(ss, 'Hapus', tab, r, ringkasLog_(lama), '', akses.pengguna);
    tandaiLaporanKotor_();
    return {ok: true};
  } finally {
    lock.releaseLock();
  }
}

function ringkasLog_(o) {
  var out = {};
  Object.keys(o).forEach(function (h) { if (h !== '_baris') out[h] = nilaiUntukAplikasi_(h, o[h]); });
  return JSON.stringify(out);
}

function catatLog_(ss, aksi, tab, baris, lama, baru, oleh) {
  try {
    var sh = ss.getSheetByName(KP_LOG);
    if (!sh) {
      sh = ss.insertSheet(KP_LOG);
      sh.getRange(1, 1, 1, 7).setValues([['Waktu', 'Aksi', 'Tab', 'Baris', 'Isi lama', 'Isi baru', 'Oleh']]);
      sh.setFrozenRows(1);
      sh.hideSheet();
    }
    sh.appendRow([new Date(), aksi, tab, baris, lama, baru, oleh]);
  } catch (e) {
    // Log gagal tidak boleh menggagalkan perubahan.
  }
}

// ---------------------------------------------------------------- LAPORAN

function tambahHari_(k, n) {
  var d = new Date(Date.UTC(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10)) + n * 86400000);
  return d.toISOString().slice(0, 10);
}
function hariKe_(k) { return new Date(Date.UTC(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10))).getUTCDay(); }
function mingguMulai_(k, awal) { return tambahHari_(k, -((hariKe_(k) - awal + 7) % 7)); }
function selisihHari_(a, b) {
  return Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 86400000);
}

function angkaKosong_() {
  return {trip: 0, bahanKg: 0, beliBahan: 0, biayaJalan: 0, sulingan: 0, sulinganDisaring: 0, minyak: 0, hidrosol: 0,
    upahAbsensi: 0, upahSuling: 0, upahLain: 0, operasional: 0, kasMasukLain: 0, kasKeluarLain: 0,
    terjualKg: 0, penjualan: 0, belumLunas: 0};
}

function turunan_(a) {
  a.hargaBahan = a.bahanKg > 0 ? bulat_(a.beliBahan / a.bahanKg, 0) : null;
  a.totalUpah = a.upahAbsensi + a.upahSuling + a.upahLain;
  a.biayaProduksi = a.beliBahan + a.biayaJalan + a.totalUpah + a.operasional;
  a.minyakPerSulingan = a.sulinganDisaring > 0 ? bulat_(a.minyak / a.sulinganDisaring, 3) : null;
  a.rendemen = a.bahanKg > 0 && a.minyak > 0 ? bulat_(a.minyak / a.bahanKg * 100, 2) : null;
  a.biayaPerKg = a.minyak > 0 ? bulat_(a.biayaProduksi / a.minyak, 0) : null;
  a.laba = a.penjualan - a.biayaProduksi;
  a.minyak = bulat_(a.minyak, 3);
  a.bahanKg = bulat_(a.bahanKg, 2);
  a.terjualKg = bulat_(a.terjualKg, 3);
  return a;
}

function hitungLaporan_(ss) {
  var peng = bacaPengaturan_(ss);
  var awal = hariAwalMinggu_(peng);
  var hariIni = sekarangTeks_();
  var d = {};
  URUTAN_TAB.forEach(function (t) { d[t] = bacaObjek_(ss, t); });
  var alatInduk = bacaMaster_(ss, 'Alat Suling');
  var karyawan = petaMaster_(ss, 'Karyawan');
  var tarif = petaMaster_(ss, 'Tarif Upah');
  var kategori = petaMaster_(ss, 'Kategori Kas');

  var minggu = {}, bulan = {};
  var mAlat = {}, mOrang = {};
  var tglMin = '', tglMaks = '', prodMin = '', prodMaks = '';
  var catatTgl = function (k) {
    if (!k) return;
    if (!tglMin || k < tglMin) tglMin = k;
    if (!tglMaks || k > tglMaks) tglMaks = k;
  };
  var tambah = function (k, f) {
    if (!k) return;
    catatTgl(k);
    var mg = mingguMulai_(k, awal);
    f(minggu[mg] || (minggu[mg] = angkaKosong_()));
    var bl = k.slice(0, 7);
    f(bulan[bl] || (bulan[bl] = angkaKosong_()));
  };
  var alatMinggu = function (mg, nama) {
    var m = mAlat[mg] || (mAlat[mg] = {});
    return m[nama] || (m[nama] = {nama: nama, sulingan: 0, hari: {}, upah: 0, minyak: 0, disaring: 0, operator: {}});
  };
  var orangMinggu = function (mg, nama) {
    var m = mOrang[mg] || (mOrang[mg] = {});
    return m[nama] || (m[nama] = {nama: nama, peran: karyawan[nama] ? karyawan[nama]['Peran'] : '', hari: {}, sulingan: 0,
      upahAbsensi: 0, upahSuling: 0, upahLain: 0});
  };

  d['Ambil Bahan'].forEach(function (r) {
    tambah(tglKunci_(r['Tanggal']), function (a) {
      a.trip++;
      a.bahanKg += angka_(r['Berat bahan (kg)']);
      a.beliBahan += angka_(r['Uang dibawa (Rp)']) - angka_(r['Uang sisa (Rp)']) - angka_(r['Biaya lain di jalan (Rp)']);
      a.biayaJalan += angka_(r['Biaya lain di jalan (Rp)']);
    });
  });
  d['Produksi Suling'].forEach(function (r) {
    var k = tglKunci_(r['Tanggal']);
    if (!k) return;
    var n = angka_(r['Jumlah sulingan']), upah = angka_(r['Upah (Rp)']);
    tambah(k, function (a) { a.sulingan += n; a.upahSuling += upah; });
    if (!prodMin || k < prodMin) prodMin = k;
    if (!prodMaks || k > prodMaks) prodMaks = k;
    var mg = mingguMulai_(k, awal);
    var al = alatMinggu(mg, String(r['Alat suling']).trim() || '(tanpa nama)');
    al.sulingan += n; al.upah += upah;
    if (n > 0) al.hari[k] = true;
    var op = String(r['Operator'] || '').trim();
    if (op) {
      al.operator[op] = (al.operator[op] || 0) + n;
      var or = orangMinggu(mg, op);
      or.sulingan += n; or.upahSuling += upah;
      if (n > 0) or.hari[k] = true;
    }
  });
  d['Saring Minyak'].forEach(function (r) {
    var k = tglKunci_(r['Tanggal saring']);
    if (!k) return;
    var minyak = angka_(r['Minyak (kg)']), n = angka_(r['Jumlah sulingan yang disaring']);
    tambah(k, function (a) { a.minyak += minyak; a.sulinganDisaring += n; a.hidrosol += angka_(r['Hidrosol diambil (liter)']); });
    var alat = String(r['Alat suling'] || '').trim();
    if (alat && alat !== 'Gabungan') {
      var al = alatMinggu(mingguMulai_(k, awal), alat);
      al.minyak += minyak; al.disaring += n;
    }
  });
  d['Absensi'].forEach(function (r) {
    var k = tglKunci_(r['Tanggal']);
    if (!k) return;
    var ua = angka_(r['Upah absensi (Rp)']), ul = angka_(r['Upah kerja lain (Rp)']);
    tambah(k, function (a) { a.upahAbsensi += ua; a.upahLain += ul; });
    var nama = String(r['Nama'] || '').trim();
    if (!nama) return;
    var or = orangMinggu(mingguMulai_(k, awal), nama);
    if (!or.peran) or.peran = String(r['Peran'] || '');
    or.upahAbsensi += ua; or.upahLain += ul;
    var t = tarif[r['Kehadiran']];
    var masuk = t ? t['Jenis'] === 'Masuk' : (ua > 0);
    if (masuk || ul > 0) or.hari[k] = true;
  });
  d['Penjualan'].forEach(function (r) {
    tambah(tglKunci_(r['Tanggal']), function (a) {
      var total = angka_(r['Total (Rp)']);
      a.penjualan += total;
      if (String(r['Satuan']).trim() === 'kg') a.terjualKg += angka_(r['Jumlah']);
      var st = String(r['Status bayar'] || '').trim();
      if (st && st !== 'Lunas') a.belumLunas += total;
    });
  });
  d['Kas'].forEach(function (r) {
    tambah(tglKunci_(r['Tanggal']), function (a) {
      var kat = kategori[r['Kategori']];
      var arah = String(r['Arah'] || (kat ? kat['Arah'] : 'Keluar'));
      var produksi = kat ? kat['Masuk biaya produksi'] !== 'Tidak' : arah === 'Keluar';
      var j = angka_(r['Jumlah (Rp)']);
      if (arah === 'Masuk') a.kasMasukLain += j;
      else if (produksi) a.operasional += j;
      else a.kasKeluarLain += j;
    });
  });

  // Daftar minggu dan bulan berurutan sampai hari ini, terbaru di depan.
  var daftarMinggu = [];
  var mulai = tglMin ? mingguMulai_(tglMin, awal) : mingguMulai_(hariIni, awal);
  var akhirMinggu = mingguMulai_(tglMaks && tglMaks > hariIni ? tglMaks : hariIni, awal);
  for (var mg = mulai; mg <= akhirMinggu; mg = tambahHari_(mg, 7)) daftarMinggu.push(mg);
  daftarMinggu.reverse();

  var alatAktif = alatInduk.filter(function (a) { return a.aktif; }).map(function (a) { return a.nilai['Nama alat']; });
  var hasilMinggu = daftarMinggu.map(function (mg) {
    var a = turunan_(minggu[mg] || angkaKosong_());
    a.mulai = mg;
    a.sampai = tambahHari_(mg, 6);
    // Hari yang dihitung untuk "alat kosong": dari catatan produksi pertama sampai terakhir di minggu ini.
    var dari = prodMin && prodMin > mg ? prodMin : mg;
    var sampai = prodMaks && prodMaks < a.sampai ? prodMaks : a.sampai;
    var jumlahHari = prodMin && sampai >= dari ? selisihHari_(dari, sampai) + 1 : 0;
    var petaAlat = mAlat[mg] || {};
    var namaAlat = alatAktif.slice();
    Object.keys(petaAlat).forEach(function (n) { if (namaAlat.indexOf(n) < 0) namaAlat.push(n); });
    a.alat = namaAlat.map(function (n) {
      var x = petaAlat[n] || {nama: n, sulingan: 0, hari: {}, upah: 0, minyak: 0, disaring: 0, operator: {}};
      var hariJalan = Object.keys(x.hari).filter(function (k) { return k >= dari && k <= sampai; }).length;
      var op = Object.keys(x.operator).sort(function (p, q) { return x.operator[q] - x.operator[p]; });
      return {nama: n, operator: op.join(', '), sulingan: x.sulingan, hariJalan: Object.keys(x.hari).length,
        hariKosong: Math.max(jumlahHari - hariJalan, 0), minyak: bulat_(x.minyak, 3), disaring: x.disaring,
        minyakPerSulingan: x.disaring > 0 ? bulat_(x.minyak / x.disaring, 3) : null, upah: x.upah};
    });
    a.hariKosong = a.alat.reduce(function (s, x) { return s + x.hariKosong; }, 0);
    var urutPeran = {'Penyuling': 1, 'Pengumpul': 2, 'Cadangan': 3, 'Lainnya': 4};
    a.orang = Object.keys(mOrang[mg] || {}).map(function (n) {
      var o = mOrang[mg][n];
      return {nama: n, peran: o.peran, hariMasuk: Object.keys(o.hari).length, sulingan: o.sulingan, upahAbsensi: o.upahAbsensi,
        upahSuling: o.upahSuling, upahLain: o.upahLain, total: o.upahAbsensi + o.upahSuling + o.upahLain};
    }).sort(function (p, q) {
      return (urutPeran[p.peran] || 9) - (urutPeran[q.peran] || 9) || (p.nama < q.nama ? -1 : 1);
    });
    return a;
  });

  var daftarBulan = [];
  var b0 = (tglMin || hariIni).slice(0, 7), b1 = (tglMaks && tglMaks > hariIni ? tglMaks : hariIni).slice(0, 7);
  for (var bl = b0; bl <= b1; bl = bulanBerikut_(bl)) daftarBulan.push(bl);
  daftarBulan.reverse();
  var hasilBulan = daftarBulan.map(function (bl) {
    var a = turunan_(bulan[bl] || angkaKosong_());
    a.bulan = bl;
    return a;
  });

  var hasil = {hariIni: hariIni, dataSampai: tglMaks, minggu: hasilMinggu, bulan: hasilBulan};
  hasil.peringatan = peringatan_(hasil, alatInduk, bacaMaster_(ss, 'Karyawan'), d);
  return hasil;
}

function bulanBerikut_(bl) {
  var y = +bl.slice(0, 4), m = +bl.slice(5, 7) + 1;
  if (m > 12) { m = 1; y++; }
  return y + '-' + ('0' + m).slice(-2);
}

function rp_(n) { return 'Rp' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }

function peringatan_(h, alatInduk, karyawan, d) {
  var out = [];
  var ini = h.minggu[0];
  var lalu = h.minggu[1];
  if (!karyawan.some(function (k) { return k.aktif; })) {
    out.push({status: 'ISI', hal: 'Daftar karyawan masih kosong', nilai: '', saran: 'Tambahkan karyawan di menu Kelola > Karyawan.'});
  }
  var tanpaTarif = alatInduk.filter(function (a) { return a.aktif && !(angka_(a.nilai['Upah per sulingan (Rp)']) > 0); })
    .map(function (a) { return a.nilai['Nama alat']; });
  if (tanpaTarif.length) {
    out.push({status: 'ISI', hal: 'Upah per sulingan belum diisi', nilai: tanpaTarif.join(', '),
      saran: 'Isi di Kelola > Alat suling, supaya upah borongan operator terhitung.'});
  }
  if (ini) {
    ini.alat.filter(function (a) { return a.hariKosong >= 2; }).forEach(function (a) {
      out.push({status: 'PERHATIAN', hal: a.nama + ' tidak jalan minggu ini', nilai: a.hariKosong + ' hari',
        saran: 'Cek alat, bahan, atau operatornya.'});
    });
  }
  var belum = d['Penjualan'].reduce(function (s, r) {
    var st = String(r['Status bayar'] || '').trim();
    return st && st !== 'Lunas' ? s + angka_(r['Total (Rp)']) : s;
  }, 0);
  if (belum > 0) out.push({status: 'TAGIH', hal: 'Penjualan belum lunas', nilai: rp_(belum), saran: 'Tagih, lalu ubah status bayar di Riwayat Penjualan.'});
  if (ini && h.minggu.length > 1 && ini.minyakPerSulingan) {
    var sebelum = h.minggu.slice(1, 5).map(function (m) { return m.minyakPerSulingan; }).filter(function (x) { return x; });
    if (sebelum.length) {
      var rata = sebelum.reduce(function (s, x) { return s + x; }, 0) / sebelum.length;
      if (ini.minyakPerSulingan < rata * 0.85) {
        out.push({status: 'PERHATIAN', hal: 'Minyak per sulingan turun', nilai: ini.minyakPerSulingan + ' kg (rata-rata ' + bulat_(rata, 2) + ' kg)',
          saran: 'Cek kondisi bahan (terlalu kering/basah) dan kebocoran alat.'});
      }
    }
  }
  if (ini && lalu && ini.hargaBahan && lalu.hargaBahan && ini.hargaBahan > lalu.hargaBahan * 1.15) {
    out.push({status: 'PERHATIAN', hal: 'Harga bahan per kg naik', nilai: rp_(ini.hargaBahan) + ' (minggu lalu ' + rp_(lalu.hargaBahan) + ')',
      saran: 'Bandingkan harga antar daerah di Riwayat Ambil Bahan.'});
  }
  if (!out.length) out.push({status: 'Aman', hal: 'Tidak ada yang perlu ditangani', nilai: '', saran: ''});
  return out;
}

function perbaruiLaporan_(ss) {
  var h = hitungLaporan_(ss);
  tulisLaporan_(ss, h);
  try { PropertiesService.getScriptProperties().deleteProperty('laporanKotor'); } catch (e) { /* abaikan */ }
  return h;
}

var KOLOM_REKAP = [
  ['Trip ambil bahan', 'trip'], ['Bahan masuk (kg)', 'bahanKg'], ['Uang beli bahan (Rp)', 'beliBahan'], ['Harga bahan per kg (Rp)', 'hargaBahan'],
  ['Biaya jalan (Rp)', 'biayaJalan'], ['Sulingan', 'sulingan'], ['Minyak (kg)', 'minyak'], ['Minyak per sulingan (kg)', 'minyakPerSulingan'],
  ['Rendemen kasar (%)', 'rendemen'], ['Hidrosol (liter)', 'hidrosol'], ['Upah absensi (Rp)', 'upahAbsensi'], ['Upah suling (Rp)', 'upahSuling'],
  ['Upah kerja lain (Rp)', 'upahLain'], ['Total upah (Rp)', 'totalUpah'], ['Biaya operasional (Rp)', 'operasional'],
  ['Biaya produksi (Rp)', 'biayaProduksi'], ['Biaya per kg minyak (Rp)', 'biayaPerKg'], ['Minyak terjual (kg)', 'terjualKg'],
  ['Penjualan (Rp)', 'penjualan'], ['Belum lunas (Rp)', 'belumLunas'], ['Laba usaha (Rp)', 'laba'],
  ['Kas masuk lain (Rp)', 'kasMasukLain'], ['Kas keluar lain (Rp)', 'kasKeluarLain']
];

function isiTabLaporan_(ss, nama, kepala, rows) {
  var sh = ss.getSheetByName(nama) || ss.insertSheet(nama);
  sh.clearContents();
  var semua = [kepala].concat(rows);
  sh.getRange(1, 1, semua.length, kepala.length).setValues(semua);
  sh.getRange(1, 1, 1, kepala.length).setFontWeight('bold').setBackground('#E5F2EA');
  sh.setFrozenRows(1);
  if (rows.length) {
    kepala.forEach(function (h, j) {
      var f = formatAngka_(h);
      if (f) sh.getRange(2, j + 1, rows.length, 1).setNumberFormat(f);
    });
  }
  return sh;
}

function tulisLaporan_(ss, h) {
  var tgl = function (k) { return k ? tglDariKunci_(k) : ''; };
  var nilai = function (v) { return v === null || v === undefined ? '' : v; };

  isiTabLaporan_(ss, 'Rekap Mingguan', ['Minggu mulai', 'Sampai'].concat(KOLOM_REKAP.map(function (k) { return k[0]; })),
    h.minggu.map(function (m) { return [tgl(m.mulai), tgl(m.sampai)].concat(KOLOM_REKAP.map(function (k) { return nilai(m[k[1]]); })); }));

  isiTabLaporan_(ss, 'Rekap Bulanan', ['Bulan'].concat(KOLOM_REKAP.map(function (k) { return k[0]; })),
    h.bulan.map(function (b) { return [tgl(b.bulan + '-01')].concat(KOLOM_REKAP.map(function (k) { return nilai(b[k[1]]); })); }));

  var upah = [];
  h.minggu.forEach(function (m) {
    m.orang.forEach(function (o) {
      upah.push([tgl(m.mulai), tgl(m.sampai), o.nama, o.peran, o.hariMasuk, o.sulingan, o.upahAbsensi, o.upahSuling, o.upahLain, o.total]);
    });
  });
  isiTabLaporan_(ss, 'Upah Mingguan', ['Minggu mulai', 'Sampai', 'Nama', 'Peran', 'Hari kerja', 'Sulingan', 'Upah absensi (Rp)',
    'Upah suling (Rp)', 'Upah kerja lain (Rp)', 'Total upah (Rp)'], upah);

  var alat = [];
  h.minggu.forEach(function (m) {
    m.alat.forEach(function (a) {
      alat.push([tgl(m.mulai), tgl(m.sampai), a.nama, a.operator, a.sulingan, a.hariJalan, a.hariKosong, a.minyak, a.disaring,
        nilai(a.minyakPerSulingan), a.upah]);
    });
  });
  isiTabLaporan_(ss, 'Rekap Alat', ['Minggu mulai', 'Sampai', 'Alat suling', 'Operator', 'Sulingan', 'Hari jalan', 'Hari kosong',
    'Minyak disaring (kg)', 'Sulingan disaring', 'Minyak per sulingan (kg)', 'Upah (Rp)'], alat);

  // Tab Ringkasan: angka minggu ini, bulan ini, dan peringatan.
  var sh = ss.getSheetByName('Ringkasan') || ss.insertSheet('Ringkasan');
  sh.clearContents();
  var m = h.minggu[0] || {}, b = h.bulan[0] || {};
  var baris = [
    ['Catatan Sembada Kepuh', '', ''],
    ['Diperbarui', Utilities.formatDate(new Date(), KP_ZONA, 'dd/MM/yyyy HH:mm'), ''],
    ['Data sampai', h.dataSampai ? tglIndo_(h.dataSampai) : 'belum ada catatan', ''],
    ['', '', ''],
    ['Angka', 'Minggu ini (' + tglIndo_(m.mulai) + ' – ' + tglIndo_(m.sampai) + ')', 'Bulan ini']
  ];
  [['Penjualan (Rp)', 'penjualan'], ['Laba usaha (Rp)', 'laba'], ['Minyak (kg)', 'minyak'], ['Sulingan', 'sulingan'],
    ['Minyak per sulingan (kg)', 'minyakPerSulingan'], ['Bahan masuk (kg)', 'bahanKg'], ['Harga bahan per kg (Rp)', 'hargaBahan'],
    ['Total upah (Rp)', 'totalUpah'], ['Biaya per kg minyak (Rp)', 'biayaPerKg'], ['Belum lunas (Rp)', 'belumLunas']].forEach(function (k) {
    baris.push([k[0], nilai(m[k[1]]), nilai(b[k[1]])]);
  });
  baris.push(['', '', '']);
  baris.push(['Peringatan', 'Nilai', 'Saran']);
  h.peringatan.forEach(function (p) { baris.push([(p.status === 'Aman' ? '' : p.status + ': ') + p.hal, p.nilai, p.saran]); });
  baris.push(['', '', '']);
  baris.push(['Rincian ada di tab Rekap Mingguan, Rekap Bulanan, Upah Mingguan, dan Rekap Alat.', '', '']);
  sh.getRange(1, 1, baris.length, 3).setValues(baris);
  sh.getRange(1, 1).setFontWeight('bold').setFontSize(14);
  sh.getRange(5, 1, 1, 3).setFontWeight('bold').setBackground('#E5F2EA');
  sh.getRange(17, 1, 1, 3).setFontWeight('bold').setBackground('#E5F2EA');
  for (var i = 6; i <= 15; i++) {
    var f = formatAngka_(String(baris[i - 1][0]));
    if (f) sh.getRange(i, 2, 1, 2).setNumberFormat(f);
  }
}

// ---------------------------------------------------------------- RINGKASAN UNTUK APLIKASI

function ringkasan_(ss, akses) {
  if (!akses.admin) return {ok: false, galat: 'Ringkasan hanya untuk pemilik atau pengguna yang boleh mengatur.'};
  var h;
  var lock = LockService.getScriptLock();
  var dapatKunci = lock.tryLock(20000);
  try {
    var kotor = PropertiesService.getScriptProperties().getProperty('laporanKotor');
    h = kotor && dapatKunci ? perbaruiLaporan_(ss) : hitungLaporan_(ss);
  } finally {
    if (dapatKunci) lock.releaseLock();
  }
  return {ok: true, hariIni: h.hariIni, dataSampai: h.dataSampai, minggu: h.minggu.slice(0, 26), bulan: h.bulan.slice(0, 12),
    peringatan: h.peringatan};
}
