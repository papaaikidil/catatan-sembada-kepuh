/* Sembada Kepuh - pencatatan lokasi produksi utama Sembada Karya Wangi.
 * Turunan Catatan Sembada: alat suling, karyawan, dan pengguna bisa ditambah/dikurangi dari aplikasi,
 * serta warna, ukuran, dan tata letak bisa diatur. Semua catatan masuk ke Google Sheet lewat Apps Script.
 * Isian disimpan dulu di HP (antrian), lalu dikirim begitu ada sinyal. */
(function () {
  'use strict';

  var KONF = window.KEPUH_CONFIG || {};
  var API = KONF.API_URL || '';
  var VERSI = KONF.VERSI || '1.0.0';
  var NAMA_APP = 'Sembada Kepuh';
  var DI_APK = /CatatanSembadaKepuhApp/.test(navigator.userAgent);
  var app = document.getElementById('app');

  // ------------------------------------------------------------ penyimpanan di HP
  var AWALAN = 'kepuh.';
  function simpan(k, v) { try { localStorage.setItem(AWALAN + k, JSON.stringify(v)); } catch (e) { /* abaikan */ } }
  function ambil(k, d) {
    try { var v = localStorage.getItem(AWALAN + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; }
  }
  function buang(k) { try { localStorage.removeItem(AWALAN + k); } catch (e) { /* abaikan */ } }
  function buangAwalan(a) {
    try {
      var hapus = [];
      for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k && k.indexOf(AWALAN + a) === 0) hapus.push(k); }
      hapus.forEach(function (k) { localStorage.removeItem(k); });
    } catch (e) { /* abaikan */ }
  }

  var sesi = ambil('sesi', null);          // {token, akses}
  var konfig = ambil('konfig', null);      // data induk, tampilan, judul kolom
  var antrian = ambil('antrian', []);      // isian yang belum terkirim
  var mengirim = false;
  var promptPasang = null;
  var sedangDiubah = null;                 // catatan yang sedang diubah
  var jumlahRiwayat = {};
  var drafTampilan = null;                 // pratinjau di layar Tampilan (belum disimpan)

  // ------------------------------------------------------------ alat bantu
  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c];
    });
  }
  function salin(o) { return JSON.parse(JSON.stringify(o)); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function hariIni() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function tglIndo(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    return m ? m[3] + '/' + m[2] + '/' + m[1] : (iso || '');
  }
  var HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  var BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  var BULAN_PANJANG = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  function namaHari(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? HARI[new Date(+m[1], +m[2] - 1, +m[3]).getDay()] : ''; }
  function rp(n) {
    if (n === null || n === undefined || n === '' || isNaN(n)) return '–';
    return (n < 0 ? '-' : '') + 'Rp' + Math.round(Math.abs(n)).toLocaleString('id-ID');
  }
  function ang(n, d) {
    if (n === null || n === undefined || n === '' || isNaN(n)) return '–';
    return Number(n).toLocaleString('id-ID', {maximumFractionDigits: d === undefined ? 2 : d});
  }
  function idBaru() {
    var s = '';
    if (window.crypto && crypto.getRandomValues) {
      var a = new Uint8Array(8);
      crypto.getRandomValues(a);
      for (var i = 0; i < a.length; i++) s += ('0' + a[i].toString(16)).slice(-2);
      return s;
    }
    return (Date.now().toString(36) + Math.random().toString(36).slice(2) + '0000000000').slice(0, 16);
  }
  function toast(pesan, lama) {
    var t = document.getElementById('toast');
    t.textContent = pesan; t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.hidden = true; }, lama || 3200);
  }
  function q(akar, sel) { return (akar || document).querySelector(sel); }
  function qa(akar, sel) { return [].slice.call((akar || document).querySelectorAll(sel)); }
  function nilaiRadio(akar, nama) { var el = qa(akar, 'input[name="' + nama + '"]').filter(function (x) { return x.checked; })[0]; return el ? el.value : ''; }
  function nilaiCentang(akar, nama) { return qa(akar, 'input[name="' + nama + '"]').filter(function (x) { return x.checked; }).map(function (x) { return x.value; }); }
  function angkaBulat(s) { var t = String(s === undefined || s === null ? '' : s).replace(/[^\d]/g, ''); return t ? parseInt(t, 10) : NaN; }
  function angkaDesimal(s, ribuan) {
    var t = String(s || '').trim().replace(/\s/g, '');
    if (!t) return NaN;
    if (t.indexOf('.') >= 0 && t.indexOf(',') >= 0) t = t.replace(/\./g, '').replace(',', '.');   // 1.075,5
    else if (ribuan && /^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');                    // 1.075 (berat)
    else t = t.replace(',', '.');
    return /^\d+(\.\d+)?$/.test(t) ? parseFloat(t) : NaN;
  }

  var JALUR = {
    daun: '<path d="M11 20A7 7 0 0 1 4 13c0-5 4-9 16-10-1 12-5 16-9 17Z"/><path d="M4 21c3-6 7-9 11-11"/>',
    api: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.4-.5-2-1-3-1.1-2.1-.2-4 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.2.4-2.3 1-3a2.5 2.5 0 0 0 2.5 2.5Z"/>',
    tetes: '<path d="M12 2.7s6 6.4 6 11.3a6 6 0 0 1-12 0c0-4.9 6-11.3 6-11.3Z"/>',
    orang: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.5a6.5 6.5 0 0 1 3.5 5.5"/>',
    keranjang: '<path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 8H6"/><circle cx="10" cy="20.5" r="1"/><circle cx="17" cy="20.5" r="1"/>',
    dompet: '<path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h14a2 2 0 0 1 2 2v3h-4a2 2 0 0 0 0 4h4v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5"/>',
    rumah: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1Z"/>',
    grafik: '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-6"/>',
    jam: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    akun: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    kembali: '<path d="m15 18-6-6 6-6"/>',
    muat: '<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/>',
    centang: '<path d="m5 12 5 5 9-10"/>',
    awan: '<path d="M17.5 19H8a5 5 0 1 1 1-9.9A6 6 0 0 1 20.6 11 4 4 0 0 1 17.5 19Z"/><path d="M12 12v4M12 18.5v.01"/>',
    atur: '<path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4"/>',
    tambah: '<path d="M12 5v14M5 12h14"/>',
    naik: '<path d="m18 15-6-6-6 6"/>',
    turun: '<path d="m6 9 6 6 6-6"/>',
    pensil: '<path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
    sampah: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
    palet: '<circle cx="13.5" cy="6.5" r="1.5"/><circle cx="17.5" cy="10.5" r="1.5"/><circle cx="8.5" cy="7.5" r="1.5"/><circle cx="6.5" cy="12.5" r="1.5"/><path d="M12 2a10 10 0 0 0 0 20c.9 0 1.6-.7 1.6-1.6 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1 0-.9.7-1.6 1.6-1.6H16a6 6 0 0 0 6-6c0-4.9-4.5-8.6-10-8.6Z"/>',
    kunci: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    ketel: '<path d="M9 3h6M10 3v6L4.5 19a2 2 0 0 0 1.8 3h11.4a2 2 0 0 0 1.8-3L14 9V3"/><path d="M7 15h10"/>',
    tag: '<path d="M12.6 2.6A2 2 0 0 0 11.2 2H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.7 8.7a2.4 2.4 0 0 0 3.4 0l6.6-6.6a2.4 2.4 0 0 0 0-3.4Z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
    daftar: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    kotak: '<path d="M21 8 12 3 3 8v8l9 5 9-5Z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
    kalender: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    mata: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>'
  };
  function ikon(n, tebal) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + (tebal || 2) +
      '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (JALUR[n] || '') + '</svg>';
  }

  // ------------------------------------------------------------ API
  function panggil(aksi, data, batasMs) {
    if (!API) return Promise.reject(new Error('Aplikasi belum tersambung ke Google Sheet. Hubungi Mas Wildan.'));
    var isi = {aksi: aksi, token: sesi ? sesi.token : ''};
    Object.keys(data || {}).forEach(function (k) { isi[k] = data[k]; });
    var ctrl = window.AbortController ? new AbortController() : null;
    var t = setTimeout(function () { if (ctrl) ctrl.abort(); }, batasMs || 30000);
    return fetch(API, {method: 'POST', body: JSON.stringify(isi), redirect: 'follow', signal: ctrl ? ctrl.signal : undefined})
      .then(function (res) {
        if (!res.ok) { var e = new Error('Server membalas ' + res.status + '.'); e.jaringan = true; throw e; }
        return res.json();
      })
      .catch(function (e) {
        if (e.jaringan || e.name === 'AbortError' || e instanceof TypeError) {
          var g = new Error('Tidak ada sinyal atau server sedang lambat.'); g.jaringan = true; throw g;
        }
        throw e;
      })
      .then(function (r) {
        if (r && r.kode === 'SESI' && aksi !== 'masuk') keluar('Sesi berakhir. Silakan masuk lagi.');
        else if (r && r.kode === 'GANTI' && sesi) {
          sesi.akses.wajibGanti = true; simpan('sesi', sesi);
          if (location.hash !== '#/sandi') location.hash = '#/sandi';
        }
        return r;
      })
      .finally(function () { clearTimeout(t); });
  }

  // ------------------------------------------------------------ akses & data induk
  var URUTAN_TAB = ['Ambil Bahan', 'Produksi Suling', 'Saring Minyak', 'Absensi', 'Penjualan', 'Kas'];
  var TAB_KELOMPOK = {'Produksi Suling': true, 'Absensi': true};
  var URUT_PERAN = ['Penyuling', 'Pengumpul', 'Cadangan', 'Lainnya'];

  function akses() { return (sesi && sesi.akses) || {}; }
  function admin() { return !!akses().admin; }
  function pemilik() { return !!akses().pemilik; }
  function boleh(tab) { return (akses().tab || []).indexOf(tab) >= 0; }

  function daftarInduk(tab, semua) {
    var d = (konfig && konfig.master && konfig.master[tab]) || [];
    return semua ? d : d.filter(function (m) { return m.aktif; });
  }
  function nilaiInduk(tab, h, semua) { return daftarInduk(tab, semua).map(function (m) { return m.nilai[h]; }); }
  function cariInduk(tab, h, v) { return daftarInduk(tab, true).filter(function (m) { return m.nilai[h] === v; })[0]; }
  function karyawanPeran(peran) {
    return daftarInduk('Karyawan').filter(function (m) { return !peran || peran.indexOf(m.nilai['Peran']) >= 0; })
      .map(function (m) { return m.nilai['Nama']; });
  }
  function pilihanDaftar(d) {
    return daftarInduk('Pilihan').filter(function (m) { return m.nilai['Daftar'] === d; }).map(function (m) { return m.nilai['Pilihan']; });
  }
  function tarifUntuk(peran) {
    return daftarInduk('Tarif Upah').filter(function (t) {
      var u = t.nilai['Untuk peran'];
      return u === 'Semua' || u === peran || peran === 'Cadangan' || peran === 'Lainnya' || !peran;
    });
  }
  // Semua upah dari absensi: upah tarif + (untuk pilihan suling) jumlah sulingan × upah per sulingan orangnya.
  function upahTarif(pilihan, nama) {
    var t = cariInduk('Tarif Upah', 'Pilihan', pilihan);
    if (!t) return 0;
    var n = Number(t.nilai['Jumlah sulingan']) || 0;
    var k = n > 0 && nama ? cariInduk('Karyawan', 'Nama', nama) : null;
    return (Number(t.nilai['Upah (Rp)']) || 0) + (k ? n * (Number(k.nilai['Upah per sulingan (Rp)']) || 0) : 0);
  }
  function tarifMasuk(pilihan) { var t = cariInduk('Tarif Upah', 'Pilihan', pilihan); return t ? t.nilai['Jenis'] === 'Masuk' : false; }

  function opsiBidang(b) {
    if (b.opsi) return b.opsi.slice();
    switch (b.sumber) {
      case 'pengumpul': return karyawanPeran(['Pengumpul', 'Cadangan']);
      case 'operator': return karyawanPeran(['Penyuling', 'Cadangan']);
      case 'karyawan': return karyawanPeran();
      case 'karyawanSemua': return nilaiInduk('Karyawan', 'Nama', true);
      case 'alatSaring': return nilaiInduk('Alat Suling', 'Nama alat').concat(['Gabungan']);
      case 'alatSemua': return nilaiInduk('Alat Suling', 'Nama alat', true);
      case 'tarifSemua': return nilaiInduk('Tarif Upah', 'Pilihan', true);
      case 'produk': return nilaiInduk('Produk', 'Produk');
      case 'kategori': return nilaiInduk('Kategori Kas', 'Kategori');
      case 'produkMinyak':
        var kg = daftarInduk('Produk').filter(function (m) { return m.nilai['Satuan'] === 'kg'; }).map(function (m) { return m.nilai['Produk']; });
        var bukanHidrosol = kg.filter(function (n) { return !/hidrosol/i.test(n); });
        return bukanHidrosol.length ? bukanHidrosol : kg;
    }
    if (b.daftar) return pilihanDaftar(b.daftar);
    return [];
  }

  // ------------------------------------------------------------ tampilan (warna, ukuran, tata letak)
  var PRESET = [
    {k: 'sembada', nama: 'Hijau Sembada', kepala: '#1B4331', aksen: '#2D7C5B'},
    {k: 'daun', nama: 'Hijau daun', kepala: '#2F5D1E', aksen: '#4C8B2B'},
    {k: 'laut', nama: 'Hijau laut', kepala: '#134E4A', aksen: '#0F766E'},
    {k: 'biru', nama: 'Biru', kepala: '#1D3E66', aksen: '#2F6497'},
    {k: 'ungu', nama: 'Ungu lavender', kepala: '#3F2E5C', aksen: '#6B4FA0'},
    {k: 'cokelat', nama: 'Cokelat kayu', kepala: '#4A3423', aksen: '#8A5A2B'},
    {k: 'bata', nama: 'Merah bata', kepala: '#6B2318', aksen: '#A63D2A'},
    {k: 'arang', nama: 'Abu arang', kepala: '#2B2F33', aksen: '#4B5563'}
  ];
  var TAMPILAN_BAWAAN = {
    warna: 'sembada', kepala: '#1B4331', aksen: '#2D7C5B', mode: 'otomatis', huruf: 'normal', sudut: 'bulat',
    kepadatan: 'lega', beranda: 2, logo: true, ringkas: true, ringkasAngka: ['penjualan', 'laba', 'minyak', 'totalUpah'],
    upahBeranda: true, stokBeranda: 'semua', menu: [], namaMenu: {}, form: {}
  };
  var ANGKA = {
    penjualan: {l: 'Penjualan', f: function (m) { return rp(m.penjualan); }, b: 'penjualan'},
    laba: {l: 'Laba usaha', f: function (m) { return rp(m.laba); }, merah: function (m) { return m.laba < 0; }, b: 'laba'},
    minyak: {l: 'Minyak dihasilkan', f: function (m) { return ang(m.minyak) + ' kg'; }, b: 'minyak'},
    minyakPerSulingan: {l: 'Minyak per sulingan', f: function (m) { return m.minyakPerSulingan === null ? '–' : ang(m.minyakPerSulingan, 3) + ' kg'; }},
    sulingan: {l: 'Sulingan', f: function (m) { return ang(m.sulingan, 0) + ' kali'; }, b: 'sulingan'},
    bahanKg: {l: 'Bahan masuk', f: function (m) { return ang(m.bahanKg, 0) + ' kg'; }},
    hargaBahan: {l: 'Harga bahan/kg', f: function (m) { return rp(m.hargaBahan); }},
    biayaPerKg: {l: 'Biaya per kg minyak', f: function (m) { return rp(m.biayaPerKg); }},
    totalUpah: {l: 'Total upah', f: function (m) { return rp(m.totalUpah); }},
    belumLunas: {l: 'Belum lunas', f: function (m) { return rp(m.belumLunas); }, merah: function (m) { return m.belumLunas > 0; }},
    hariKosong: {l: 'Hari alat kosong', f: function (m) { return ang(m.hariKosong, 0) + ' hari'; }, merah: function (m) { return m.hariKosong >= 2; }}
  };
  var URUT_ANGKA = ['penjualan', 'laba', 'minyak', 'minyakPerSulingan', 'sulingan', 'bahanKg', 'hargaBahan', 'biayaPerKg', 'totalUpah', 'belumLunas', 'hariKosong'];

  function tampilanPusat() {
    var t = Object.assign(salin(TAMPILAN_BAWAAN), (konfig && konfig.tampilan) || {});
    ['menu', 'ringkasAngka'].forEach(function (k) { if (!Array.isArray(t[k])) t[k] = salin(TAMPILAN_BAWAAN[k]); });
    ['namaMenu', 'form'].forEach(function (k) { if (!t[k] || typeof t[k] !== 'object') t[k] = {}; });
    return t;
  }
  function tampilanHp() { return ambil('tampilanHp', {huruf: '', mode: ''}); }
  function tampilanAktif() {
    var t = drafTampilan ? Object.assign(salin(TAMPILAN_BAWAAN), drafTampilan) : tampilanPusat();
    var hp = tampilanHp();
    if (hp.huruf) t.huruf = hp.huruf;
    if (hp.mode) t.mode = hp.mode;
    return t;
  }

  function hexKeRgb(h) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(h || '').trim());
    if (!m) return null;
    var n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgbKeHex(c) { return '#' + c.map(function (x) { return ('0' + Math.round(Math.max(0, Math.min(255, x))).toString(16)).slice(-2); }).join(''); }
  function campur(a, b, t) {
    var x = hexKeRgb(a), y = hexKeRgb(b);
    if (!x || !y) return a;
    return rgbKeHex([0, 1, 2].map(function (i) { return x[i] + (y[i] - x[i]) * t; }));
  }
  function terangnya(h) {
    var c = hexKeRgb(h) || [0, 0, 0];
    var l = c.map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
  }
  function teksDi(h) { return terangnya(h) > 0.21 ? '#1C2420' : '#FFFFFF'; }

  var mediaGelap = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function terapkanTampilan() {
    var t = tampilanAktif();
    var r = document.documentElement;
    if (t.mode === 'terang') r.setAttribute('data-theme', 'light');
    else if (t.mode === 'gelap') r.setAttribute('data-theme', 'dark');
    else r.removeAttribute('data-theme');
    var gelap = t.mode === 'gelap' || (t.mode !== 'terang' && !!(mediaGelap && mediaGelap.matches));
    var kepala = hexKeRgb(t.kepala) ? t.kepala : TAMPILAN_BAWAAN.kepala;
    var aksen = hexKeRgb(t.aksen) ? t.aksen : TAMPILAN_BAWAAN.aksen;
    if (gelap) { kepala = campur(kepala, '#000000', 0.35); aksen = campur(aksen, '#FFFFFF', 0.3); }
    var s = r.style;
    s.setProperty('--kepala', kepala);
    s.setProperty('--di-kepala', teksDi(kepala));
    s.setProperty('--aksen', aksen);
    s.setProperty('--di-aksen', teksDi(aksen));
    s.setProperty('--aksen-muda', campur(aksen, gelap ? '#1A211D' : '#FFFFFF', gelap ? 0.78 : 0.86));
    r.setAttribute('data-huruf', t.huruf || 'normal');
    r.setAttribute('data-sudut', t.sudut || 'bulat');
    r.setAttribute('data-kepadatan', t.kepadatan || 'lega');
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', kepala);
    try { if (window.KepuhAndroid && window.KepuhAndroid.warnaBilah) window.KepuhAndroid.warnaBilah(kepala); } catch (e) { /* abaikan */ }
  }
  if (mediaGelap && mediaGelap.addEventListener) mediaGelap.addEventListener('change', terapkanTampilan);

  function labelTab(tab, t) {
    t = t || tampilanAktif();
    var n = (t.namaMenu || {})[FORM[tab].kunci];
    return n && String(n).trim() ? String(n).trim() : tab;
  }
  function menuTerurut(t) {
    t = t || tampilanAktif();
    var urut = (t.menu || []).map(function (m) { return m.k; });
    var posisi = function (tab) { var i = urut.indexOf(FORM[tab].kunci); return i < 0 ? 100 + URUTAN_TAB.indexOf(tab) : i; };
    return URUTAN_TAB.slice().sort(function (a, b) { return posisi(a) - posisi(b); }).map(function (tab) {
      var m = (t.menu || []).filter(function (x) { return x.k === FORM[tab].kunci; })[0];
      return {tab: tab, k: FORM[tab].kunci, label: labelTab(tab, t), tampil: !m || m.tampil !== false};
    });
  }
  function kunciB(b) { return b.k || b.h; }
  function bidangUrut(tab, t) {
    t = t || tampilanAktif();
    var f = (t.form || {})[FORM[tab].kunci] || {};
    var urut = f.urutan || [], semb = f.sembunyi || [];
    var asli = FORM[tab].bidang;
    var posisi = function (b) { var i = urut.indexOf(kunciB(b)); return i < 0 ? 100 + asli.indexOf(b) : i; };
    return asli.slice().sort(function (a, b) { return posisi(a) - posisi(b); }).map(function (b) {
      return {b: b, tampil: b.wajib !== false || semb.indexOf(kunciB(b)) < 0};
    });
  }
  function bidangTampil(tab) { return bidangUrut(tab).filter(function (x) { return x.tampil && dikenalServer(tab, x.b); }).map(function (x) { return x.b; }); }
  // Isian baru hanya muncul kalau Apps Script sudah mengenal kolomnya (aman saat Apps Script belum diperbarui).
  function dikenalServer(tab, b) {
    var kepala = (konfig && konfig.kepala && konfig.kepala[tab]) || [];
    return !b.h || !!b.k || !kepala.length || kepala.indexOf(b.h) >= 0;
  }

  // ------------------------------------------------------------ definisi formulir
  // h = judul kolom di Google Sheet (harus sama persis). k = bidang khusus (kisi alat / orang).
  var FORM = {
    'Ambil Bahan': {
      kunci: 'ambil', ikon: 'daun', ket: 'Satu isian untuk satu trip.',
      bidang: [
        {j: 'tanggal', h: 'Tanggal'},
        {j: 'centang', h: 'Pengumpul', sumber: 'pengumpul', lainnya: true, bantuan: 'Pilih semua yang ikut trip ini.'},
        {j: 'centang', h: 'Daerah', daftar: 'Daerah', lainnya: true},
        {j: 'pilih', h: 'Kondisi bahan', daftar: 'Kondisi bahan'},
        {j: 'desimal', h: 'Berat bahan (kg)', ribuan: true, bantuan: 'Hasil timbang, contoh 1075.'},
        {j: 'rupiah', h: 'Uang dibawa (Rp)'},
        {j: 'rupiah', h: 'Uang sisa (Rp)', bantuan: 'Uang yang kembali setelah beli bahan.'},
        {j: 'rupiah', h: 'Biaya lain di jalan (Rp)', bawaan: '0', bantuan: 'Es, tali rafia, tambal ban. Isi 0 kalau tidak ada.'},
        {j: 'teks', h: 'Keterangan biaya lain', wajib: false},
        {j: 'paragraf', h: 'Keterangan', wajib: false, bantuan: 'Isi kalau ada yang tidak seperti biasa: harga bahan naik, bahan basah, ganti daerah, pikap bermasalah.'}
      ],
      pratinjau: function (n) {
        if (n['Uang dibawa (Rp)'] === undefined) return null;
        var beli = (n['Uang dibawa (Rp)'] || 0) - (n['Uang sisa (Rp)'] || 0) - (n['Biaya lain di jalan (Rp)'] || 0);
        var baris = ['Uang beli bahan: ' + rp(beli)];
        if (n['Berat bahan (kg)'] > 0) baris.push('Harga bahan per kg: ' + rp(beli / n['Berat bahan (kg)']));
        return baris;
      },
      cek: function (n) {
        var s = [];
        if (n['Uang sisa (Rp)'] > n['Uang dibawa (Rp)']) s.push(['Uang sisa (Rp)', 'Uang sisa lebih besar dari uang yang dibawa.']);
        if (n['Berat bahan (kg)'] === 0) s.push(['Berat bahan (kg)', 'Berat tidak boleh 0.']);
        return s;
      }
    },
    'Produksi Suling': {
      kunci: 'suling', ikon: 'api', ket: 'Sekali sehari untuk semua alat suling.',
      bidang: [
        {j: 'tanggal', h: 'Tanggal'},
        {j: 'gridAlat', k: '_alat', label: 'Alat suling', bantuan: 'Isi jumlah sulingan tiap alat. Alat yang tidak jalan pilih 0.'},
        {j: 'paragraf', h: 'Keterangan', wajib: false, bantuan: 'Isi kalau ada alat rusak, bahan habis, atau hujan.'}
      ],
      susun: susunProduksi,
      pratinjau: function (n, s) {
        if (!s || !s.baris.length) return null;
        var total = 0, upah = 0, jalan = 0;
        s.baris.forEach(function (r) { total += r['Jumlah sulingan']; if (r['Jumlah sulingan'] > 0) jalan++; });
        return ['Total ' + total + ' sulingan dari ' + jalan + ' alat yang jalan', 'Upah operator dicatat lewat Absensi (1x/2x/3x suling).'];
      },
      baris: function (r) {
        return [r['Alat suling'], r['Jumlah sulingan'] + ' sulingan' + (r['Operator'] ? ' · ' + r['Operator'] : '') + (r['Kondisi alat'] ? ' · ' + r['Kondisi alat'] : '')];
      }
    },
    'Saring Minyak': {
      kunci: 'saring', ikon: 'tetes', ket: 'Setiap kali menyaring minyak.',
      bidang: [
        {j: 'tanggal', h: 'Tanggal saring'},
        {j: 'pilih', h: 'Alat suling', sumber: 'alatSaring', bantuan: 'Pilih Gabungan kalau minyak dari beberapa alat dicampur.'},
        {j: 'pilih', h: 'Produk', sumber: 'produkMinyak', wajib: false, bawaanPertama: true, bantuan: 'Minyak ini menambah stok produk yang mana.'},
        {j: 'angka', h: 'Jumlah sulingan yang disaring', bantuan: 'Berapa kali suling sejak saringan terakhir.'},
        {j: 'desimal', h: 'Minyak (kg)', bantuan: 'Contoh 3,28 atau 3.28.'},
        {j: 'desimal', h: 'Hidrosol diambil (liter)', wajib: false},
        {j: 'pilih', h: 'Kondisi bahan', daftar: 'Kondisi bahan'},
        {j: 'desimal', h: 'Stok minyak di gudang (kg)', wajib: false, bantuan: 'Timbang semua minyak yang ada setelah disaring.'},
        {j: 'paragraf', h: 'Keterangan', wajib: false, bantuan: 'Isi kalau minyak lebih sedikit, bahan terlalu kering atau basah, atau alat bocor.'}
      ],
      pratinjau: function (n) {
        if (!(n['Jumlah sulingan yang disaring'] > 0) || n['Minyak (kg)'] === undefined) return null;
        return ['Minyak per sulingan: ' + ang(n['Minyak (kg)'] / n['Jumlah sulingan yang disaring'], 3) + ' kg'];
      },
      cek: function (n) { return n['Jumlah sulingan yang disaring'] === 0 ? [['Jumlah sulingan yang disaring', 'Tidak boleh 0.']] : []; }
    },
    'Absensi': {
      kunci: 'absensi', ikon: 'orang', ket: 'Sekali sehari untuk semua karyawan.',
      bidang: [
        {j: 'tanggal', h: 'Tanggal'},
        {j: 'gridOrang', k: '_orang', label: 'Kehadiran', bantuan: 'Semua upah dihitung dari pilihan di sini. Operator suling pilih 1x, 2x, atau 3x suling.'},
        {j: 'kerjaLain', k: '_kerjaLain', label: 'Kerja lain dengan upah khusus', wajib: false},
        {j: 'paragraf', h: 'Keterangan', wajib: false, bantuan: 'Isi kalau ada yang izin, sakit, pulang lebih awal, atau hujan.'}
      ],
      susun: susunAbsensi,
      pratinjau: function (n, s) {
        if (!s || !s.baris.length) return null;
        var total = 0, masuk = 0;
        s.baris.forEach(function (r) {
          if (r['Kehadiran']) { total += upahTarif(r['Kehadiran'], r['Nama']); if (tarifMasuk(r['Kehadiran'])) masuk++; }
          total += r['Upah kerja lain (Rp)'] || 0;
        });
        return [masuk + ' orang masuk', 'Perkiraan upah absensi & kerja lain: ' + rp(total)];
      },
      baris: function (r) {
        var t = [];
        if (r['Kehadiran']) t.push(r['Kehadiran']);
        if (r['Pekerjaan lain']) t.push(r['Pekerjaan lain'] + ' ' + rp(r['Upah kerja lain (Rp)']));
        return [r['Nama'], t.join(' · ')];
      }
    },
    'Penjualan': {
      kunci: 'jual', ikon: 'keranjang', ket: 'Satu isian untuk satu produk.',
      bidang: [
        {j: 'tanggal', h: 'Tanggal'},
        {j: 'pilih', h: 'Pembeli', daftar: 'Pembeli', lainnya: true},
        {j: 'pilih', h: 'Produk', sumber: 'produk'},
        {j: 'desimal', h: 'Jumlah', bantuan: 'kg untuk minyak, liter untuk hidrosol.'},
        {j: 'rupiah', h: 'Harga satuan (Rp)', bantuan: 'Harga per kg atau per liter. Terisi otomatis dari harga biasa produk.'},
        {j: 'pilih', h: 'Status bayar', daftar: 'Status bayar'},
        {j: 'teks', h: 'Pengiriman', wajib: false},
        {j: 'paragraf', h: 'Keterangan', wajib: false, bantuan: 'Isi kalau harga beda dari biasanya, dibayar sebagian, atau ada potongan.'}
      ],
      pratinjau: function (n) {
        if (!(n['Jumlah'] > 0) || !(n['Harga satuan (Rp)'] > 0)) return null;
        var p = cariInduk('Produk', 'Produk', n['Produk']);
        return [ang(n['Jumlah']) + ' ' + (p ? p.nilai['Satuan'] : '') + ' × ' + rp(n['Harga satuan (Rp)']) + ' = ' + rp(n['Jumlah'] * n['Harga satuan (Rp)'])];
      },
      cek: function (n) {
        var s = [];
        if (n['Jumlah'] === 0) s.push(['Jumlah', 'Jumlah tidak boleh 0.']);
        if (n['Harga satuan (Rp)'] === 0) s.push(['Harga satuan (Rp)', 'Harga tidak boleh 0.']);
        return s;
      }
    },
    'Kas': {
      kunci: 'kas', ikon: 'dompet', ket: 'Uang keluar atau masuk di luar bahan, upah, dan penjualan.',
      bidang: [
        {j: 'tanggal', h: 'Tanggal'},
        {j: 'daftar', h: 'Kategori', sumber: 'kategori'},
        {j: 'rupiah', h: 'Jumlah (Rp)'},
        {j: 'teks', h: 'Keterangan', bantuan: 'Untuk apa uangnya, contoh: kayu bakar 1 pikap.'}
      ],
      pratinjau: function (n) {
        if (!n['Kategori'] || !(n['Jumlah (Rp)'] > 0)) return null;
        var k = cariInduk('Kategori Kas', 'Kategori', n['Kategori']);
        return [((k && k.nilai['Arah'] === 'Masuk') ? 'Uang masuk ' : 'Uang keluar ') + rp(n['Jumlah (Rp)'])];
      },
      cek: function (n) { return n['Jumlah (Rp)'] === 0 ? [['Jumlah (Rp)', 'Jumlah tidak boleh 0.']] : []; }
    }
  };

  // Formulir ubah satu baris untuk catatan yang diisi bersama (per alat / per orang).
  var FORM_UBAH = {
    'Produksi Suling': [
      {j: 'tanggal', h: 'Tanggal'},
      {j: 'pilih', h: 'Alat suling', sumber: 'alatSemua'},
      {j: 'pilih', h: 'Operator', sumber: 'operator', wajib: false, kosong: 'Tanpa operator'},
      {j: 'angka', h: 'Jumlah sulingan'},
      {j: 'pilih', h: 'Kondisi alat', daftar: 'Kondisi alat', wajib: false, kosong: 'Tidak diisi'},
      {j: 'paragraf', h: 'Keterangan', wajib: false}
    ],
    'Absensi': [
      {j: 'tanggal', h: 'Tanggal'},
      {j: 'pilih', h: 'Nama', sumber: 'karyawanSemua'},
      {j: 'pilih', h: 'Kehadiran', sumber: 'tarifSemua', wajib: false, kosong: 'Tidak diisi'},
      {j: 'teks', h: 'Pekerjaan lain', wajib: false},
      {j: 'rupiah', h: 'Upah kerja lain (Rp)', wajib: false},
      {j: 'paragraf', h: 'Keterangan', wajib: false}
    ]
  };

  function tabDariKunci(k) { return URUTAN_TAB.filter(function (t) { return FORM[t].kunci === k; })[0]; }

  // Menyusun baris Produksi Suling dari kisi alat.
  function susunProduksi(mentah) {
    var g = mentah['_alat'] || {};
    var baris = [], salah = [];
    Object.keys(g).forEach(function (nama) {
      var v = g[nama];
      if (v.n === '' || v.n === undefined) return;
      var n = angkaBulat(v.n);
      if (isNaN(n)) { salah.push(['_alat|' + nama, 'Tulis jumlah sulingan dengan angka.']); return; }
      if (n > 0 && !v.op) { salah.push(['_alat|' + nama, 'Pilih operatornya.']); return; }
      var r = {'Alat suling': nama, 'Jumlah sulingan': n};
      if (v.op) r['Operator'] = v.op;
      if (v.k) r['Kondisi alat'] = v.k;
      baris.push(r);
    });
    if (!baris.length && !salah.length) salah.push(['_alat', 'Isi minimal satu alat suling.']);
    return {baris: baris, salah: salah};
  }

  // Menyusun baris Absensi dari kisi orang dan kerja lain.
  function susunAbsensi(mentah) {
    var g = mentah['_orang'] || {}, kl = mentah['_kerjaLain'] || {};
    var per = {}, urut = [], salah = [];
    var orang = function (nama) { if (!per[nama]) { per[nama] = {'Nama': nama}; urut.push(nama); } return per[nama]; };
    Object.keys(g).forEach(function (nama) { if (g[nama]) orang(nama)['Kehadiran'] = g[nama]; });
    if (kl.ada === 'Ya') {
      var kerja = String(kl.kerja || '').trim();
      if (!kerja) salah.push(['_kerjaLain', 'Tulis pekerjaannya.']);
      if (!(kl.siapa || []).length) salah.push(['_kerjaLain', 'Pilih siapa saja yang ikut.']);
      (kl.siapa || []).forEach(function (nama) {
        var u = angkaBulat((kl.upah || {})[nama]);
        if (isNaN(u) || u <= 0) { salah.push(['_kerjaLain', 'Isi upah kerja lain untuk ' + nama + '.']); return; }
        var r = orang(nama);
        r['Pekerjaan lain'] = kerja;
        r['Upah kerja lain (Rp)'] = u;
      });
    }
    var baris = urut.map(function (n) { return per[n]; });
    if (!baris.length && !salah.length) salah.push(['_orang', 'Isi minimal satu orang.']);
    return {baris: baris, salah: salah};
  }

  // ------------------------------------------------------------ antrian kirim
  function simpanAntrian() { simpan('antrian', antrian); perbaruiLencana(); perbaruiKotakStok(); }

  function kirimAntrian() {
    if (mengirim || !sesi || !antrian.length || akses().wajibGanti) return Promise.resolve();
    var siap = antrian.filter(function (a) { return a.status !== 'galat'; });
    if (!siap.length) return Promise.resolve();
    mengirim = true; perbaruiStatus();
    var terkirim = 0;
    var urut = siap.reduce(function (p, item) {
      return p.then(function (lanjut) {
        if (lanjut === false) return false;
        var data = {tab: item.tab, id: item.id, nilai: item.nilai};
        if (item.baris) data.baris = item.baris;
        return panggil('simpan', data).then(function (r) {
          if (r && r.ok) {
            antrian = antrian.filter(function (a) { return a.id !== item.id; });
            terkirim++; simpanAntrian(); return true;
          }
          if (r && (r.kode === 'SESI' || r.kode === 'GANTI')) return false;
          item.status = 'galat'; item.galat = (r && r.galat) || 'Ditolak server.'; simpanAntrian(); return true;
        }, function (e) {
          if (e.jaringan) return false;
          item.status = 'galat'; item.galat = e.message; simpanAntrian(); return true;
        });
      });
    }, Promise.resolve(true));
    return urut.then(function () {
      mengirim = false;
      if (terkirim) {
        toast(terkirim === 1 ? 'Catatan terkirim ke Google Sheet.' : terkirim + ' catatan terkirim ke Google Sheet.');
        buang('ringkasan');
        if (document.getElementById('kotak-ringkas')) {
          muatRingkasan().then(function (r) {
            var el = document.getElementById('kotak-ringkas');
            if (el) el.innerHTML = htmlRingkasMini(r);
          }, function () { /* coba lagi nanti */ });
        } else if (document.getElementById('kotak-stok')) muatStok();
      }
      perbaruiStatus();
      if (location.hash === '#/antrian') tampilkan();
    });
  }

  function perbaruiLencana() {
    var el = document.querySelector('.nav .lencana');
    var n = antrian.length;
    if (el) { el.textContent = n; el.hidden = !n; }
  }

  function htmlStatus() {
    var galat = antrian.filter(function (a) { return a.status === 'galat'; }).length;
    var tunggu = antrian.length - galat;
    if (galat) return '<button class="status galat" data-ke="#/antrian">' + ikon('awan') + galat + ' catatan gagal dikirim. Ketuk untuk melihat.</button>';
    if (tunggu) {
      var teks = mengirim ? 'Mengirim ' + tunggu + ' catatan…' : (navigator.onLine ? tunggu + ' catatan menunggu dikirim.' : 'Tanpa sinyal. ' + tunggu + ' catatan tersimpan di HP.');
      return '<button class="status tunggu" data-ke="#/antrian">' + ikon('awan') + esc(teks) + '</button>';
    }
    return '<div class="status aman">' + ikon('centang', 2.4) + 'Semua catatan sudah terkirim.</div>';
  }
  function perbaruiStatus() {
    var el = document.getElementById('kotak-status');
    if (el) el.innerHTML = htmlStatus();
    perbaruiLencana();
  }

  // ------------------------------------------------------------ kerangka layar
  function kerangka(judul, sub, isi, opsi) {
    opsi = opsi || {};
    var t = tampilanAktif();
    var kiri = opsi.kembali ? '<button class="tombol-ikon" data-ke="' + opsi.kembali + '" aria-label="Kembali">' + ikon('kembali', 2.2) + '</button>'
      : (t.logo !== false ? '<img class="logo-kecil" src="logo.png" alt="">' : '');
    var kanan = opsi.kanan || (opsi.muat ? '<button class="tombol-ikon" id="tombol-muat" aria-label="Muat ulang">' + ikon('muat') + '</button>' : '');
    var html = '<header class="kepala">' + kiri + '<h1>' + esc(judul) + (sub ? '<span class="kecil">' + esc(sub) + '</span>' : '') + '</h1>' + kanan + '</header>' +
      '<main class="isi">' + isi + '</main>';
    if (!opsi.tanpaNav) html += navBawah(opsi.aktif);
    app.innerHTML = html;
    window.scrollTo(0, 0);
  }

  function navBawah(aktif) {
    var item = [['#/', 'Beranda', 'rumah', 'beranda']];
    if (admin()) item.push(['#/ringkasan', 'Ringkasan', 'grafik', 'ringkasan']);
    item.push(['#/terbaru', 'Riwayat', 'jam', 'terbaru']);
    if (admin()) item.push(['#/kelola', 'Kelola', 'atur', 'kelola']);
    item.push(['#/akun', 'Akun', 'akun', 'akun']);
    return '<nav class="nav">' + item.map(function (i) {
      var lencana = i[3] === 'beranda' ? '<span class="lencana"' + (antrian.length ? '' : ' hidden') + '>' + antrian.length + '</span>' : '';
      return '<a href="' + i[0] + '" class="' + (aktif === i[3] ? 'aktif' : '') + '">' + ikon(i[2]) + i[1] + lencana + '</a>';
    }).join('') + '</nav>';
  }

  function bukaLembar(html) {
    var div = document.createElement('div');
    div.className = 'tirai';
    div.innerHTML = '<div class="lembar" role="dialog" aria-modal="true">' + html + '</div>';
    document.body.appendChild(div);
    div.addEventListener('click', function (ev) { if (ev.target === div) div.remove(); });
    return div;
  }

  // ------------------------------------------------------------ layar: masuk & sandi
  function layarMasuk(pesan, namaDiketik) {
    var namaTerakhir = namaDiketik || ambil('penggunaTerakhir', '');
    app.innerHTML = '<div class="layar-masuk">' +
      '<img class="logo" src="logo.png" alt="Logo Sembada Karya Wangi">' +
      '<h1>' + esc(NAMA_APP) + '</h1>' +
      '<p>Masuk dengan nama pengguna dan sandi dari Mas Wildan.</p>' +
      '<form id="form-masuk" class="tumpuk">' +
      '<input class="masukan" id="pengguna" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="Nama pengguna" aria-label="Nama pengguna" value="' + esc(namaTerakhir) + '">' +
      '<div class="sandi-baris"><input class="masukan" id="sandi" name="password" type="password" autocomplete="current-password" placeholder="Sandi" aria-label="Sandi">' +
      '<button type="button" class="tombol kedua" id="lihat-sandi" aria-label="Tampilkan sandi">' + ikon('mata') + '</button></div>' +
      (pesan ? '<div class="galat-kartu">' + esc(pesan) + '</div>' : '') +
      '<button class="tombol utama penuh" type="submit">Masuk</button>' +
      '</form>' +
      (!API ? '<p style="margin-top:20px">Aplikasi belum tersambung ke Google Sheet.</p>' : '') +
      '</div>';
    var inPengguna = document.getElementById('pengguna'), inSandi = document.getElementById('sandi');
    (namaTerakhir ? inSandi : inPengguna).focus();
    document.getElementById('lihat-sandi').addEventListener('click', function () {
      inSandi.type = inSandi.type === 'password' ? 'text' : 'password';
    });
    document.getElementById('form-masuk').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var pengguna = inPengguna.value.trim().toLowerCase(), sandi = inSandi.value;
      if (!pengguna || !sandi) { toast('Isi nama pengguna dan sandi.'); return; }
      var tombol = ev.target.querySelector('button[type=submit]');
      tombol.disabled = true; tombol.textContent = 'Memeriksa…';
      panggil('masuk', {pengguna: pengguna, sandi: sandi}).then(function (r) {
        if (!r.ok) { layarMasuk(r.galat || 'Nama pengguna atau sandi salah.', pengguna); return; }
        sesi = {token: r.token, akses: r.akses};
        simpan('sesi', sesi);
        simpan('penggunaTerakhir', pengguna);
        return muatKonfig().then(function () {
          location.hash = r.akses.wajibGanti ? '#/sandi' : '#/';
          tampilkan();
          kirimAntrian();
        });
      }).catch(function (e) { layarMasuk(e.message, pengguna); });
    });
  }

  function keluar(pesan, kabariServer) {
    if (kabariServer && sesi) panggil('keluar', {}).catch(function () { /* abaikan */ });
    sesi = null; buang('sesi'); buang('ringkasan'); buangAwalan('terbaru.');
    drafTampilan = null;
    terapkanTampilan();
    layarMasuk(pesan);
  }

  function muatKonfig() {
    return panggil('config').then(function (r) {
      if (r && r.ok) {
        konfig = r; simpan('konfig', r);
        if (sesi) { sesi.akses = r.akses; simpan('sesi', sesi); }
        terapkanTampilan();
      }
      return r;
    });
  }

  function layarSandi() {
    var paksa = !!akses().wajibGanti;
    var bidang = [
      {j: 'sandi', h: 'Sandi lama', label: paksa ? 'Sandi sementara' : 'Sandi lama', tipe: 'password'},
      {j: 'sandi', h: 'Sandi baru', tipe: 'password', bantuan: 'Minimal 6 huruf atau angka. Simpan baik-baik.'},
      {j: 'sandi', h: 'Ulangi sandi baru', tipe: 'password'}
    ];
    var isi = (paksa ? '<div class="pratinjau awas">Akun ini masih memakai sandi sementara. Ganti dulu sebelum mulai mencatat.</div>' : '') +
      '<form id="formulir" novalidate>' + bidang.map(function (b, i) { return htmlBidang(b, i, {}, 'b'); }).join('') + '</form>' +
      (paksa ? '<button class="tombol kedua penuh" id="keluar-paksa" style="margin-top:8px">Keluar</button>' : '');
    kerangka('Ganti sandi', akses().nama || '', isi, {kembali: paksa ? '' : '#/akun', tanpaNav: true});
    app.insertAdjacentHTML('beforeend', '<div class="aksi-bawah"><button class="tombol utama" id="tombol-simpan" type="button">Simpan sandi baru</button></div>');
    var form = document.getElementById('formulir');
    var kp = document.getElementById('keluar-paksa');
    if (kp) kp.addEventListener('click', function () { keluar('', true); });
    document.getElementById('tombol-simpan').addEventListener('click', function () {
      var h = bacaIsian(bidang, false, 'b', form);
      var n = h.nilai, salah = h.salah;
      if (!salah.length && String(n['Sandi baru']).length < 6) salah.push(['Sandi baru', 'Minimal 6 huruf atau angka.']);
      if (!salah.length && n['Sandi baru'] !== n['Ulangi sandi baru']) salah.push(['Ulangi sandi baru', 'Tidak sama dengan sandi baru.']);
      tandaiSalah(salah, form);
      if (salah.length) return;
      var tombol = this;
      tombol.disabled = true; tombol.textContent = 'Menyimpan…';
      panggil('sandiUbah', {sandiLama: n['Sandi lama'], sandiBaru: n['Sandi baru']}).then(function (r) {
        tombol.disabled = false; tombol.textContent = 'Simpan sandi baru';
        if (!r.ok) { toast(r.galat || 'Gagal mengganti sandi.', 5000); return; }
        sesi.token = r.token; sesi.akses = r.akses; simpan('sesi', sesi);
        toast('Sandi sudah diganti.');
        location.hash = '#/';
        kirimAntrian();
      }, function (e) {
        tombol.disabled = false; tombol.textContent = 'Simpan sandi baru';
        toast(e.jaringan ? 'Perlu sinyal untuk mengganti sandi.' : e.message, 5000);
      });
    });
  }

  // ------------------------------------------------------------ layar: ganti nama pengguna sendiri
  var POLA_PENGGUNA = /^[a-z0-9._-]{3,30}$/;
  var BANTUAN_PENGGUNA = '3–30 huruf kecil, angka, titik, atau garis bawah. Tanpa spasi. Contoh: wildan atau mandor.kepuh';
  function apiBaru() { return !!(konfig && konfig.versiApi >= 2); }
  var PESAN_API_LAMA = 'Fitur ini butuh Apps Script versi baru. Tempel ulang kode.gs terbaru di Apps Script, lalu Terapkan > Kelola deployment > Versi baru.';

  function layarNamaPengguna() {
    var bidang = [
      {j: 'teks', h: 'Nama pengguna baru', polos: true, bantuan: BANTUAN_PENGGUNA},
      {j: 'sandi', h: 'Sandi', label: 'Sandi saat ini', tipe: 'password', bantuan: 'Untuk memastikan ini memang Anda.'}
    ];
    var isi = '<div class="kartu" style="margin-bottom:16px"><div class="info-baris"><span>Nama pengguna sekarang</span><b>' + esc(akses().pengguna) + '</b></div></div>' +
      (apiBaru() ? '' : '<div class="pratinjau awas">' + esc(PESAN_API_LAMA) + '</div>') +
      '<form id="formulir" novalidate>' + bidang.map(function (b, i) { return htmlBidang(b, i, {}, 'b'); }).join('') + '</form>' +
      '<p class="redup" style="font-size:.8125rem">HP lain yang sedang masuk dengan akun ini tetap masuk. Mulai sekarang, masuk memakai nama pengguna baru.</p>';
    kerangka('Ganti nama pengguna', akses().nama || '', isi, {kembali: '#/akun', tanpaNav: true});
    app.insertAdjacentHTML('beforeend', '<div class="aksi-bawah"><button class="tombol utama" id="tombol-simpan" type="button">Simpan nama pengguna</button></div>');
    var form = document.getElementById('formulir');
    pasangFormDinamis(form);
    document.getElementById('tombol-simpan').addEventListener('click', function () {
      var h = bacaIsian(bidang, false, 'b', form);
      var n = h.nilai, salah = h.salah;
      var baru = String(n['Nama pengguna baru'] || '').toLowerCase();
      if (baru && !POLA_PENGGUNA.test(baru)) salah.push(['Nama pengguna baru', BANTUAN_PENGGUNA]);
      else if (baru && baru === akses().pengguna) salah.push(['Nama pengguna baru', 'Sama dengan nama pengguna sekarang.']);
      tandaiSalah(salah, form);
      if (salah.length) return;
      var tombol = this;
      tombol.disabled = true; tombol.textContent = 'Menyimpan…';
      panggil('namaPenggunaUbah', {penggunaBaru: baru, sandi: n['Sandi']}).then(function (r) {
        tombol.disabled = false; tombol.textContent = 'Simpan nama pengguna';
        if (!r.ok) { toast(/tidak dikenal/i.test(r.galat || '') ? PESAN_API_LAMA : (r.galat || 'Gagal menyimpan.'), 6000); return; }
        sesi.akses = r.akses; simpan('sesi', sesi);
        simpan('penggunaTerakhir', baru);
        toast('Nama pengguna sekarang "' + baru + '". Pakai nama ini saat masuk.', 5000);
        location.hash = '#/akun';
      }, function (e) {
        tombol.disabled = false; tombol.textContent = 'Simpan nama pengguna';
        toast(e.jaringan ? 'Perlu sinyal untuk mengganti nama pengguna.' : e.message, 5000);
      });
    });
  }

  // ------------------------------------------------------------ stok realtime
  var PESAN_STOK_LAMA = 'Stok realtime butuh Apps Script versi baru. Tempel ulang kode.gs terbaru di Apps Script, lalu Terapkan > Kelola deployment > Versi baru.';

  function lihatStok() {
    if (!sesi || !konfig || !(konfig.versiApi >= 3)) return false;
    var m = tampilanAktif().stokBeranda || 'semua';
    if (m === 'sembunyi') return false;
    return admin() || m === 'semua';
  }

  // Stok dari server ditambah catatan Saring/Penjualan yang masih menunggu di HP, jadi langsung berubah saat dicatat.
  function stokDenganAntrian(s) {
    var x = salin(s);
    var tunda = 0;
    var cari = function (nama) {
      var p = x.produk.filter(function (q) { return q.produk === nama; })[0];
      if (!p) {
        var m = cariInduk('Produk', 'Produk', nama);
        p = {produk: nama, satuan: m ? m.nilai['Satuan'] : '', stok: 0, masukMinggu: 0, keluarMinggu: 0};
        x.produk.push(p);
      }
      return p;
    };
    var bawaan = x.bawaan || {};
    antrian.forEach(function (a) {
      var n = a.nilai || {}, kena = false, p;
      if (a.tab === 'Saring Minyak') {
        var nama = n['Produk'] || bawaan.minyak;
        var ini = (n['Tanggal saring'] || '') >= (x.mingguMulai || '');
        if (nama && n['Minyak (kg)'] > 0) { p = cari(nama); p.stok += n['Minyak (kg)']; if (ini) p.masukMinggu += n['Minyak (kg)']; kena = true; }
        if (bawaan.hidrosol && n['Hidrosol diambil (liter)'] > 0) {
          p = cari(bawaan.hidrosol); p.stok += n['Hidrosol diambil (liter)']; if (ini) p.masukMinggu += n['Hidrosol diambil (liter)']; kena = true;
        }
        if (nama && n['Stok minyak di gudang (kg)'] !== undefined) { cari(nama).stok = n['Stok minyak di gudang (kg)']; kena = true; }
      } else if (a.tab === 'Penjualan' && n['Produk'] && n['Jumlah'] > 0) {
        p = cari(n['Produk']); p.stok -= n['Jumlah'];
        if ((n['Tanggal'] || '') >= (x.mingguMulai || '')) p.keluarMinggu += n['Jumlah'];
        kena = true;
      }
      if (kena) tunda++;
    });
    x.produk.forEach(function (q) {
      ['stok', 'masukMinggu', 'keluarMinggu'].forEach(function (k) { q[k] = Math.round((q[k] || 0) * 1000) / 1000; });
    });
    x.tunda = tunda;
    return x;
  }

  function htmlStok(s, lengkap) {
    var judul = function (kanan) {
      return '<div class="kepala-kartu"><h2>Stok sekarang</h2>' + (kanan ? '<small>' + kanan + '</small>' : '') + '</div>';
    };
    var opname = admin() ? '<button class="tautan" data-opname="1">Sesuaikan dengan hasil timbang ›</button>' : '';
    if (!s) return '<div class="kartu kartu-stok">' + judul('') + '<div class="memuat">Memuat stok…</div></div>';
    var x = stokDenganAntrian(s);
    var jam = String(s.waktu || '').slice(-5).replace(':', '.');
    var kanan = '<span class="titik-langsung"></span>' + (jam ? 'diperbarui ' + esc(jam) : 'langsung');
    if (!x.produk.length) {
      return '<div class="kartu kartu-stok">' + judul(kanan) +
        '<p class="catatan-stok" style="margin-top:0">Belum ada stok tercatat. Stok bertambah dari Saring Minyak dan berkurang dari Penjualan.' +
        (admin() ? ' Untuk stok yang sudah ada di gudang, isi lewat tombol di bawah.' : '') + '</p>' + opname + '</div>';
    }
    var kotak = x.produk.map(function (p) {
      var minus = p.stok < -0.0005;
      var gerak = (p.masukMinggu || p.keluarMinggu) ? '+' + ang(p.masukMinggu, 2) + ' / −' + ang(p.keluarMinggu, 2) + ' minggu ini' : 'tidak ada gerak minggu ini';
      var ketuk = admin() ? ' bisa-ketuk" role="button" tabindex="0" data-stok-rinci="' + esc(p.produk) + '"' : '"';
      return '<div class="angka' + ketuk + '><span>' + esc(p.produk) + '</span><b class="' + (minus ? 'minus' : '') + '">' + esc(ang(p.stok, 2) + ' ' + (p.satuan || '')) + '</b>' +
        '<small class="ket-stok">' + esc(gerak) + '</small></div>';
    }).join('');
    var rinci = '';
    if (lengkap) {
      var totalNilai = 0, adaNilai = false;
      rinci = '<div class="daftar-baris"><div class="daftar-judul">Timbang terakhir &amp; nilai stok</div>' + x.produk.map(function (p) {
        if (p.nilai) { totalNilai += p.nilai; adaNilai = true; }
        var ket = p.timbang ? tglIndo(p.timbang) + (p.selisihTimbang !== null && p.selisihTimbang !== undefined ?
          ' · selisih ' + (p.selisihTimbang > 0 ? '+' : '') + ang(p.selisihTimbang, 2) + ' ' + (p.satuan || '') : '') : 'belum pernah ditimbang ulang';
        return '<div class="baris-angka"><span>' + esc(p.produk) + '<small>' + esc(ket) + '</small></span><b>' + (p.nilai ? esc(rp(p.nilai)) : '') + '</b></div>';
      }).join('') +
        (adaNilai ? '<div class="baris-angka total"><span>Perkiraan nilai stok<small>dari harga biasa di Kelola > Produk</small></span><b>' + esc(rp(totalNilai)) + '</b></div>' : '') +
        '</div>';
    }
    var minus = x.produk.some(function (p) { return p.stok < -0.0005; });
    return '<div class="kartu kartu-stok">' + judul(kanan) + '<div class="angka-grid">' + kotak + '</div>' + rinci +
      (x.tunda ? '<p class="catatan-stok">Termasuk ' + x.tunda + ' catatan yang belum terkirim.</p>' : '') +
      (minus ? '<p class="catatan-stok merah">Stok minus: ada saring yang belum dicatat, atau perlu timbang ulang.</p>' : '') +
      opname + '</div>';
  }

  function perbaruiKotakStok() {
    var el = document.getElementById('kotak-stok');
    var s = ambil('stok', null);
    if (el && s) el.innerHTML = htmlStok(s, el.dataset.lengkap === '1');
  }

  function muatStok() {
    if (!sesi || !konfig || !(konfig.versiApi >= 3)) return Promise.resolve(null);
    return panggil('stok', {}, 20000).then(function (r) {
      if (r && r.ok) { simpan('stok', r.stok); perbaruiKotakStok(); return r.stok; }
      return null;
    }, function () { return null; });
  }

  // Menyetel stok sama dengan hasil timbang di gudang (opname).
  function lembarOpname() {
    if (!admin()) return;
    if (antrian.some(function (a) { return a.tab === 'Saring Minyak' || a.tab === 'Penjualan'; })) {
      toast('Ada catatan saring/penjualan yang belum terkirim. Kirim dulu supaya selisihnya tepat.', 5000);
      kirimAntrian();
      return;
    }
    var s = ambil('stok', null) || {produk: []};
    var nama = daftarInduk('Produk').map(function (m) { return m.nilai['Produk']; });
    s.produk.forEach(function (p) { if (nama.indexOf(p.produk) < 0) nama.push(p.produk); });
    if (!nama.length) { toast('Belum ada produk. Tambahkan di Kelola > Produk.'); return; }
    var bidang = [{j: 'tanggal', h: 'Tanggal', bantuan: 'Tanggal menimbang.'}].concat(nama.map(function (n) {
      var p = s.produk.filter(function (q) { return q.produk === n; })[0];
      var m = cariInduk('Produk', 'Produk', n);
      var sat = (p && p.satuan) || (m ? m.nilai['Satuan'] : '');
      return {j: 'desimal', h: 'stok|' + n, label: n + (sat ? ' (' + sat + ')' : ''), wajib: false,
        bantuan: 'Di aplikasi: ' + (p ? ang(p.stok, 2) + ' ' + sat : 'belum ada') + '. Kosongkan kalau tidak ditimbang.'};
    }), [{j: 'teks', h: 'Keterangan', wajib: false}]);
    var div = bukaLembar('<h2>Sesuaikan stok</h2><p class="sub">Isi hasil timbang di gudang. Stok di aplikasi disetel sama dengan angka ini, dan selisihnya dicatat di tab Penyesuaian Stok.</p>' +
      '<form novalidate>' + bidang.map(function (b, i) { return htmlBidang(b, i, {}, 'o'); }).join('') + '</form>' +
      '<div class="baris-tombol"><button class="tombol kedua" data-aksi="batal">Batal</button><button class="tombol utama" data-aksi="simpan">Simpan</button></div>');
    var form = q(div, 'form');
    pasangFormDinamis(form);
    div.addEventListener('click', function (ev) {
      var a = ev.target.closest('[data-aksi]');
      if (!a) return;
      if (a.dataset.aksi === 'batal') { div.remove(); return; }
      var h = bacaIsian(bidang, false, 'o', form);
      var baris = nama.map(function (n) { return {produk: n, stok: h.nilai['stok|' + n]}; }).filter(function (b) { return b.stok !== undefined; });
      var salah = h.salah.slice();
      if (!salah.length && !baris.length) salah.push(['stok|' + nama[0], 'Isi hasil timbang minimal satu produk.']);
      tandaiSalah(salah, form);
      if (salah.length) return;
      a.disabled = true; a.textContent = 'Menyimpan…';
      panggil('stokSesuaikan', {tanggal: h.nilai['Tanggal'], baris: baris, keterangan: h.nilai['Keterangan'] || ''}).then(function (r) {
        a.disabled = false; a.textContent = 'Simpan';
        if (!r.ok) { toast(/tidak dikenal/i.test(r.galat || '') ? PESAN_STOK_LAMA : (r.galat || 'Gagal menyimpan.'), 6000); return; }
        div.remove();
        simpan('stok', r.stok); buang('ringkasan');
        perbaruiKotakStok();
        toast('Stok disesuaikan. ' + r.hasil.map(function (x) {
          return x.produk + ': selisih ' + (x.selisih > 0 ? '+' : '') + ang(x.selisih, 2) + ' ' + x.satuan;
        }).join('; '), 6000);
      }, function (e) {
        a.disabled = false; a.textContent = 'Simpan';
        toast(e.jaringan ? 'Perlu sinyal untuk menyesuaikan stok.' : e.message, 5000);
      });
    });
  }

  // ------------------------------------------------------------ layar: beranda
  function layarBeranda() {
    var t = tampilanAktif();
    var kolom = [1, 2, 3].indexOf(Number(t.beranda)) >= 0 ? Number(t.beranda) : 2;
    var menu = menuTerurut().filter(function (m) { return m.tampil && boleh(m.tab); });
    var tombol = menu.map(function (m) {
      var f = FORM[m.tab];
      return '<a class="tombol-catatan" href="#/isi/' + f.kunci + '"><span class="lingkar">' + ikon(f.ikon) + '</span>' +
        '<span class="teks-tombol"><b>' + esc(m.label) + '</b><small>' + esc(f.ket) + '</small></span></a>';
    }).join('');
    var isi = '<div id="kotak-status">' + htmlStatus() + '</div>';
    var adaStok = lihatStok();
    if (adaStok) isi += '<div id="kotak-stok">' + htmlStok(ambil('stok', null), false) + '</div>';
    else if (admin() && konfig && !(konfig.versiApi >= 3) && (t.stokBeranda || 'semua') !== 'sembunyi') isi += '<div class="pratinjau awas">' + esc(PESAN_STOK_LAMA) + '</div>';
    if (admin() && t.ringkas !== false) isi += '<div id="kotak-ringkas">' + htmlRingkasMini(ambil('ringkasan', null)) + '</div>';
    isi += '<div class="judul-bagian">Isi catatan</div>' +
      (menu.length ? '<div class="grid-catatan k' + kolom + '">' + tombol + '</div>' : '<div class="kosong">Akun ini belum diberi akses ke catatan mana pun.</div>');
    kerangka(NAMA_APP, 'Masuk sebagai ' + (akses().nama || ''), isi, {aktif: 'beranda'});
    if (!admin() || t.ringkas === false) { if (adaStok) muatStok(); return; }
    var kotak = document.getElementById('kotak-ringkas');
    kotak.addEventListener('change', function (ev) {
      if (ev.target.id !== 'pilih-minggu') return;
      simpan('mingguDipilih', ev.target.value);
      kotak.innerHTML = htmlRingkasMini(ambil('ringkasan', null));
    });
    muatRingkasan().then(function (r) {
      var el = document.getElementById('kotak-ringkas');
      if (el && r) el.innerHTML = htmlRingkasMini(r);
      if (!r.stok && adaStok) muatStok();
    }, function () { /* tetap pakai data tersimpan */ });
  }

  // ---- pilihan minggu & bulan
  function pecah(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? {y: +m[1], m: +m[2], d: +m[3]} : null; }
  function labelMinggu(mg) {
    var a = pecah(mg.mulai), b = pecah(mg.sampai);
    if (!a || !b) return mg.mulai + ' – ' + mg.sampai;
    if (a.m === b.m && a.y === b.y) return a.d + '–' + b.d + ' ' + BULAN[b.m - 1] + ' ' + b.y;
    return a.d + ' ' + BULAN[a.m - 1] + (a.y !== b.y ? ' ' + a.y : '') + ' – ' + b.d + ' ' + BULAN[b.m - 1] + ' ' + b.y;
  }
  function labelBulan(bl) { var m = /^(\d{4})-(\d{2})$/.exec(bl.bulan || ''); return m ? BULAN_PANJANG[+m[2] - 1] + ' ' + m[1] : (bl.bulan || ''); }
  function indeksPilihan(daftar, kunci, cocok) {
    var simpanan = ambil(kunci, '');
    for (var i = 0; i < daftar.length; i++) if (cocok(daftar[i]) === simpanan) return i;
    return 0;
  }
  function selectMinggu(daftar, idx) {
    return '<select class="masukan pilih-periode" id="pilih-minggu" aria-label="Pilih minggu">' + daftar.map(function (m, i) {
      return '<option value="' + esc(m.mulai) + '"' + (i === idx ? ' selected' : '') + '>' + esc(labelMinggu(m)) + (i === 0 ? ' (minggu ini)' : '') + '</option>';
    }).join('') + '</select>';
  }
  function banding(a, b) {
    // Persen hanya bermakna kalau minggu sebelumnya positif (laba minus atau nol membuat persen menyesatkan).
    if (typeof a !== 'number' || typeof b !== 'number' || !(b > 0) || a < 0) return '';
    var x = (a - b) / Math.abs(b);
    return '<small class="banding ' + (x >= 0 ? 'naik' : 'turun') + '">' + (x >= 0 ? '▲ ' : '▼ ') + Math.round(Math.abs(x) * 100) + '% dari minggu sebelumnya</small>';
  }
  // rinci = kunci rincian; per = 'm' (minggu) atau 'b' (bulan). Kotak dengan rincian bisa diketuk.
  function kotakAngka(label, nilai, merah, tambahan, rinci, per) {
    var kelas = (merah ? 'minus ' : '') + (String(nilai).length > 9 ? 'panjang' : '');
    var ketuk = rinci ? ' bisa-ketuk" role="button" tabindex="0" data-rinci="' + esc(rinci) + '" data-per="' + esc(per || 'm') + '"' : '"';
    return '<div class="angka' + ketuk + '><span>' + esc(label) + '</span><b class="' + kelas.trim() + '">' + esc(nilai) + '</b>' + (tambahan || '') + '</div>';
  }
  function kotakDari(kunci, m, sebelum, per) {
    var a = ANGKA[kunci];
    if (!a) return '';
    return kotakAngka(a.l, a.f(m), a.merah ? a.merah(m) : false, a.b && sebelum ? banding(m[a.b], sebelum[a.b]) : '', RINCI[kunci] ? kunci : '', per || 'm');
  }

  function htmlUpah(m, berjalan) {
    var orang = m.orang || [];
    if (!orang.length) return '<div class="daftar-baris"><div class="daftar-judul">Upah per orang</div><p class="catatan">Belum ada absensi atau produksi di minggu ini.</p></div>';
    var total = 0;
    var baris = orang.map(function (o) {
      total += o.total || 0;
      return brs(o.nama, [o.peran, o.hariMasuk + ' hari kerja'].filter(function (x) { return x; }).join(' · '), rp(o.total), {gaji: o.nama, per: 'm'});
    }).join('');
    return '<div class="daftar-baris"><div class="daftar-judul">Upah per orang (untuk gajian)' + (berjalan ? ' · sampai hari ini' : '') + '</div>' + baris +
      '<div class="baris-angka total"><span>Total</span><b>' + esc(rp(total)) + '</b></div>' +
      '<p class="catatan">Ketuk nama untuk melihat kerjanya per hari dan upahnya. Bonus yang dicatat di Kas belum termasuk.</p></div>';
  }

  function htmlAlat(m) {
    var alat = m.alat || [];
    if (!alat.length) return '';
    return '<div class="daftar-baris"><div class="daftar-judul">Per alat suling</div>' + alat.map(function (a) {
      var rinci = [];
      if (!a.sulingan && !a.hariJalan && !a.hariKosong) rinci.push('belum ada catatan minggu ini');
      else {
        if (a.operator) rinci.push(a.operator);
        rinci.push(a.hariKosong ? a.hariKosong + ' hari kosong' : 'jalan terus');
      }
      if (a.minyakPerSulingan) rinci.push(ang(a.minyakPerSulingan, 3) + ' kg/sulingan');
      return '<div class="baris-angka"><span>' + esc(a.nama) + '<small>' + esc(rinci.join(' · ')) + '</small></span><b>' + ang(a.sulingan, 0) + ' sulingan</b></div>';
    }).join('') + '</div>';
  }

  function htmlRingkasMini(r) {
    if (!r || !r.minggu || !r.minggu.length) return '';
    var t = tampilanAktif();
    var daftar = r.minggu;
    var idx = indeksPilihan(daftar, 'mingguDipilih', function (m) { return m.mulai; });
    var m = daftar[idx], sebelum = daftar[idx + 1];
    konteksRinci.m = m;
    var perlu = (r.peringatan || []).filter(function (p) { return p.status !== 'Aman'; }).length;
    var angka = (t.ringkasAngka || []).filter(function (k) { return ANGKA[k]; });
    return '<div class="kartu"><h2>Ringkasan minggu</h2>' + selectMinggu(daftar, idx) +
      '<p class="sub">' + (idx === 0 ? 'Data sampai ' + esc(tglIndo(r.dataSampai) || '–') : 'Minggu yang sudah lewat') + '</p>' +
      (angka.length ? '<div class="angka-grid">' + angka.map(function (k) { return kotakDari(k, m, sebelum); }).join('') + '</div>' : '') +
      (t.upahBeranda !== false ? htmlUpah(m, idx === 0) : '') +
      (perlu ? '<button class="status galat" style="margin:12px 0 0" data-ke="#/ringkasan">' + ikon('awan') + perlu + ' hal perlu ditangani</button>' : '') +
      '<button class="tautan" data-ke="#/ringkasan">Lihat ringkasan lengkap ›</button></div>';
  }

  function muatRingkasan() {
    return panggil('ringkasan').then(function (r) {
      if (r && r.ok) {
        simpan('ringkasan', r);
        if (r.stok) { simpan('stok', r.stok); perbaruiKotakStok(); }
        return r;
      }
      throw new Error((r && r.galat) || 'Gagal memuat ringkasan.');
    });
  }

  // ------------------------------------------------------------ rincian kartu laporan
  var konteksRinci = {m: null, b: null};
  var cacheRinci = {};
  var HARI_PENDEK = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
  function tglPendek(iso) {
    var p = pecah(iso);
    return p ? HARI_PENDEK[new Date(p.y, p.m - 1, p.d).getDay()] + ' ' + pad(p.d) + '/' + pad(p.m) : (iso || '');
  }
  function n0(v) { var x = Number(v); return isFinite(x) ? x : 0; }
  function brs(judul, sub, nilai, opsi) {
    opsi = opsi || {};
    var tag = opsi.gaji ? 'button' : 'div';
    var attr = opsi.gaji ? ' type="button" data-gaji="' + esc(opsi.gaji) + '" data-per="' + esc(opsi.per || 'm') + '"' : '';
    return '<' + tag + ' class="baris-angka' + (opsi.kelas ? ' ' + opsi.kelas : '') + (opsi.gaji ? ' baris-ketuk' : '') + '"' + attr + '><span>' + esc(judul) +
      (sub ? '<small>' + esc(sub) + '</small>' : '') + '</span><b>' + esc(nilai) + (opsi.gaji ? ' ›' : '') + '</b></' + tag + '>';
  }
  function bagian(judul, isi) { return '<div class="daftar-baris"><div class="daftar-judul">' + esc(judul) + '</div>' + isi + '</div>'; }
  function kosongTeks(t) { return '<p class="catatan">' + esc(t) + '</p>'; }
  function kasProduksi(kat) { var k = cariInduk('Kategori Kas', 'Kategori', kat); return k ? k.nilai['Masuk biaya produksi'] !== 'Tidak' : true; }
  function sulinganTarif(pilihan) { var t = cariInduk('Tarif Upah', 'Pilihan', pilihan); return t ? n0(t.nilai['Jumlah sulingan']) : 0; }

  function periodeDari(per) {
    if (per === 'b') {
      var b = konteksRinci.b;
      if (!b) return null;
      var y = +b.bulan.slice(0, 4), mo = +b.bulan.slice(5, 7);
      return {mulai: b.bulan + '-01', sampai: b.bulan + '-' + pad(new Date(y, mo, 0).getDate()), label: labelBulan(b), o: b};
    }
    var m = konteksRinci.m;
    return m ? {mulai: m.mulai, sampai: m.sampai, label: labelMinggu(m), o: m} : null;
  }

  // Semua catatan satu periode. Apps Script versi 5 punya aksi khusus; versi lama memakai Riwayat (300 catatan terakhir per jenis).
  function muatRincian(mulai, sampai) {
    var kunci = mulai + '|' + sampai;
    var c = cacheRinci[kunci];
    if (c && Date.now() - c.waktu < 60000) return Promise.resolve(c.data);
    var janji = (konfig && konfig.versiApi >= 5) ? panggil('rincian', {mulai: mulai, sampai: sampai}).then(function (r) {
      if (!r || !r.ok) throw new Error((r && r.galat) || 'Gagal memuat rincian.');
      return r;
    }) : muatRincianLama(mulai, sampai);
    return janji.then(function (d) {
      cacheRinci[kunci] = {waktu: Date.now(), data: d};
      simpan('rincian.terakhir', {kunci: kunci, data: d});
      return d;
    }, function (e) {
      var simpanan = ambil('rincian.terakhir', null);
      if (simpanan && simpanan.kunci === kunci) return simpanan.data;
      throw e;
    });
  }
  function muatRincianLama(mulai, sampai) {
    var peta = {ambil: ['Ambil Bahan', 'Tanggal'], produksi: ['Produksi Suling', 'Tanggal'], saring: ['Saring Minyak', 'Tanggal saring'],
      absensi: ['Absensi', 'Tanggal'], penjualan: ['Penjualan', 'Tanggal'], kas: ['Kas', 'Tanggal']};
    var nama = Object.keys(peta), terbatas = false;
    return Promise.all(nama.map(function (k) {
      return panggil('terbaru', {tab: peta[k][0], n: 300}).then(function (r) {
        if (!r || !r.ok) throw new Error((r && r.galat) || 'Gagal memuat rincian.');
        var rows = r.data.map(function (d) { var o = salin(d.nilai); o.t = String(o[peta[k][1]] || ''); return o; });
        if (r.total > r.data.length && rows.length && rows[rows.length - 1].t > mulai) terbatas = true;
        return rows.filter(function (o) { return o.t >= mulai && o.t <= sampai; }).reverse();
      });
    })).then(function (hasil) {
      var d = {mulai: mulai, sampai: sampai, stok: [], terbatas: terbatas};
      nama.forEach(function (k, i) { d[k] = hasil[i]; });
      return d;
    });
  }

  function daftarPenjualan(rows) {
    return rows.map(function (r) {
      return brs(tglPendek(r.t) + ' · ' + r['Pembeli'], ang(r['Jumlah']) + ' ' + (r['Satuan'] || '') + ' ' + r['Produk'] + ' × ' + rp(r['Harga satuan (Rp)']) +
        (r['Status bayar'] ? ' · ' + r['Status bayar'] : ''), rp(r['Total (Rp)']));
    }).join('');
  }
  function daftarKas(rows) {
    return rows.map(function (r) { return brs(tglPendek(r.t) + ' · ' + r['Kategori'], r['Keterangan'] || '', rp(r['Jumlah (Rp)'])); }).join('');
  }
  function daftarAmbil(rows, hargaDulu) {
    return rows.map(function (r) {
      var kg = ang(r['Berat bahan (kg)'], 0) + ' kg', harga = rp(r['Harga bahan per kg (Rp)']) + '/kg';
      var sub = [r['Daerah'], r['Kondisi bahan'], hargaDulu ? kg + ' · beli ' + rp(r['Uang beli bahan (Rp)']) : harga].filter(function (x) { return x; }).join(' · ');
      return brs(tglPendek(r.t) + ' · ' + (r['Pengumpul'] || ''), sub, hargaDulu ? harga : kg);
    }).join('');
  }
  function total(rows, h) { return rows.reduce(function (s, r) { return s + n0(r[h]); }, 0); }
  function rinciBiaya(o, denganPenjualan) {
    return bagian('Perhitungan', (denganPenjualan ? brs('Penjualan', '', rp(o.penjualan)) : '') +
      brs((denganPenjualan ? '− ' : '') + 'Beli bahan', ang(o.trip, 0) + ' trip · ' + ang(o.bahanKg, 0) + ' kg', rp(o.beliBahan)) +
      brs((denganPenjualan ? '− ' : '') + 'Biaya di jalan', 'saat ambil bahan', rp(o.biayaJalan)) +
      brs((denganPenjualan ? '− ' : '') + 'Upah karyawan', 'dari Absensi', rp(o.totalUpah)) +
      brs((denganPenjualan ? '− ' : '') + 'Biaya operasional', 'Kas yang masuk biaya produksi', rp(o.operasional)) +
      (denganPenjualan ? brs('= Laba usaha', '', rp(o.laba), {kelas: 'total'}) : brs('= Biaya produksi', '', rp(o.biayaProduksi), {kelas: 'total'})));
  }
  function upahPerOrang(d, per) {
    var peta = {}, urut = [];
    d.absensi.forEach(function (r) {
      var n = r['Nama'];
      if (!n) return;
      if (!peta[n]) { peta[n] = {nama: n, peran: r['Peran'], total: 0, hari: {}}; urut.push(n); }
      var u = n0(r['Upah absensi (Rp)']) + n0(r['Upah kerja lain (Rp)']);
      peta[n].total += u;
      if (tarifMasuk(r['Kehadiran']) || u > 0) peta[n].hari[r.t] = true;
    });
    var URUT = {'Penyuling': 1, 'Pengumpul': 2, 'Cadangan': 3};
    var semua = urut.map(function (n) { return peta[n]; }).sort(function (a, b) {
      return (URUT[a.peran] || 9) - (URUT[b.peran] || 9) || (a.nama < b.nama ? -1 : 1);
    });
    if (!semua.length) return kosongTeks('Belum ada absensi di periode ini.');
    var jml = 0;
    return bagian('Per orang (ketuk untuk rincian)', semua.map(function (o) {
      jml += o.total;
      return brs(o.nama, [o.peran, Object.keys(o.hari).length + ' hari kerja'].filter(function (x) { return x; }).join(' · '), rp(o.total), {gaji: o.nama, per: per});
    }).join('') + brs('Total', '', rp(jml), {kelas: 'total'}));
  }

  // Definisi rincian tiap kartu. isi(o, d, per): d = catatan periode (null selagi dimuat).
  var RINCI = {
    penjualan: {judul: 'Penjualan', data: true, nilai: function (o) { return rp(o.penjualan); },
      ket: 'Semua penjualan di periode ini, lunas maupun belum.',
      isi: function (o, d) {
        if (!d) return '';
        return d.penjualan.length ? bagian('Daftar penjualan', daftarPenjualan(d.penjualan) + brs('Total', '', rp(total(d.penjualan, 'Total (Rp)')), {kelas: 'total'}))
          : kosongTeks('Belum ada penjualan di periode ini.');
      }},
    laba: {judul: 'Laba usaha', data: true, nilai: function (o) { return rp(o.laba); },
      ket: 'Laba usaha = penjualan − biaya produksi. Uang pribadi atau modal di Kas tidak ikut dihitung.',
      isi: function (o, d) {
        var kas = d ? d.kas.filter(function (r) { return r['Arah'] !== 'Masuk' && kasProduksi(r['Kategori']); }) : [];
        return rinciBiaya(o, true) + (kas.length ? bagian('Biaya operasional dari Kas', daftarKas(kas)) : '');
      }},
    biayaProduksi: {judul: 'Biaya produksi', data: true, nilai: function (o) { return rp(o.biayaProduksi); },
      ket: 'Semua biaya untuk menghasilkan minyak: bahan, perjalanan, upah, dan operasional.',
      isi: function (o, d) {
        var kas = d ? d.kas.filter(function (r) { return r['Arah'] !== 'Masuk' && kasProduksi(r['Kategori']); }) : [];
        return rinciBiaya(o, false) + (kas.length ? bagian('Biaya operasional dari Kas', daftarKas(kas)) : '');
      }},
    minyak: {judul: 'Minyak dihasilkan', data: true, nilai: function (o) { return ang(o.minyak) + ' kg'; },
      ket: 'Dari catatan Saring Minyak.',
      isi: function (o, d) {
        if (!d) return '';
        return d.saring.length ? bagian('Per saring', d.saring.map(function (r) {
          var sub = [n0(r['Jumlah sulingan yang disaring']) + ' sulingan', r['Produk'], n0(r['Hidrosol diambil (liter)']) ? 'hidrosol ' + ang(r['Hidrosol diambil (liter)']) + ' l' : '']
            .filter(function (x) { return x; }).join(' · ');
          return brs(tglPendek(r.t) + ' · ' + r['Alat suling'], sub, ang(r['Minyak (kg)'], 2) + ' kg');
        }).join('') + brs('Total', '', ang(total(d.saring, 'Minyak (kg)'), 2) + ' kg', {kelas: 'total'})) : kosongTeks('Belum ada saring minyak di periode ini.');
      }},
    minyakPerSulingan: {judul: 'Minyak per sulingan', data: true, nilai: function (o) { return o.minyakPerSulingan === null ? '–' : ang(o.minyakPerSulingan, 3) + ' kg'; },
      ket: function (o) { return 'Minyak disaring ÷ sulingan yang disaring = ' + ang(o.minyak, 2) + ' kg ÷ ' + ang(o.sulinganDisaring, 0) + ' sulingan.'; },
      isi: function (o, d) {
        if (!d) return '';
        var peta = {}, urut = [];
        d.saring.forEach(function (r) {
          var a = r['Alat suling'] || '–';
          if (!peta[a]) { peta[a] = {kg: 0, n: 0}; urut.push(a); }
          peta[a].kg += n0(r['Minyak (kg)']); peta[a].n += n0(r['Jumlah sulingan yang disaring']);
        });
        return urut.length ? bagian('Per alat', urut.map(function (a) {
          var x = peta[a];
          return brs(a, ang(x.kg, 2) + ' kg dari ' + ang(x.n, 0) + ' sulingan', x.n ? ang(x.kg / x.n, 3) + ' kg' : '–');
        }).join('')) : kosongTeks('Belum ada saring minyak di periode ini.');
      }},
    sulingan: {judul: 'Sulingan', data: true, nilai: function (o) { return ang(o.sulingan, 0) + ' kali'; },
      ket: 'Dari Produksi Suling. Upah operator dihitung dari Absensi.',
      isi: function (o, d) {
        if (!d) return '';
        var hari = {}, urut = [];
        d.produksi.forEach(function (r) { if (!hari[r.t]) { hari[r.t] = []; urut.push(r.t); } hari[r.t].push(r); });
        return urut.length ? bagian('Per hari', urut.map(function (t) {
          var jml = 0;
          var sub = hari[t].map(function (r) {
            jml += n0(r['Jumlah sulingan']);
            return r['Alat suling'] + ' ' + n0(r['Jumlah sulingan']) + 'x' + (r['Operator'] ? ' (' + r['Operator'] + ')' : '');
          }).join(' · ');
          return brs(tglPendek(t), sub, jml + ' kali');
        }).join('') + brs('Total', '', ang(total(d.produksi, 'Jumlah sulingan'), 0) + ' kali', {kelas: 'total'})) : kosongTeks('Belum ada produksi suling di periode ini.');
      }},
    bahanKg: {judul: 'Bahan masuk', data: true, nilai: function (o) { return ang(o.bahanKg, 0) + ' kg'; },
      ket: 'Dari catatan Ambil Bahan, satu baris per trip.',
      isi: function (o, d) {
        if (!d) return '';
        return d.ambil.length ? bagian('Per trip', daftarAmbil(d.ambil, false) + brs('Total', d.ambil.length + ' trip', ang(total(d.ambil, 'Berat bahan (kg)'), 0) + ' kg', {kelas: 'total'}))
          : kosongTeks('Belum ada ambil bahan di periode ini.');
      }},
    hargaBahan: {judul: 'Harga bahan per kg', data: true, nilai: function (o) { return rp(o.hargaBahan); },
      ket: function (o) { return 'Uang beli bahan ÷ berat bahan = ' + rp(o.beliBahan) + ' ÷ ' + ang(o.bahanKg, 0) + ' kg.'; },
      isi: function (o, d) {
        if (!d) return '';
        return d.ambil.length ? bagian('Per trip', daftarAmbil(d.ambil, true)) : kosongTeks('Belum ada ambil bahan di periode ini.');
      }},
    biayaPerKg: {judul: 'Biaya per kg minyak', data: false, nilai: function (o) { return rp(o.biayaPerKg); },
      ket: function (o) { return 'Biaya produksi ÷ minyak dihasilkan = ' + rp(o.biayaProduksi) + ' ÷ ' + ang(o.minyak, 2) + ' kg. Bandingkan dengan harga jual per kg.'; },
      isi: function (o) { return rinciBiaya(o, false); }},
    totalUpah: {judul: 'Total upah', data: true, nilai: function (o) { return rp(o.totalUpah); },
      ket: 'Semua upah dari Absensi: tarif harian/trip/suling ditambah kerja lain.',
      isi: function (o, d, per) { return d ? upahPerOrang(d, per) : ''; }},
    belumLunas: {judul: 'Belum lunas', data: true, nilai: function (o) { return rp(o.belumLunas); },
      ket: 'Penjualan di periode ini yang status bayarnya belum Lunas.',
      isi: function (o, d) {
        if (!d) return '';
        var rows = d.penjualan.filter(function (r) { return r['Status bayar'] && r['Status bayar'] !== 'Lunas'; });
        return rows.length ? bagian('Perlu ditagih', daftarPenjualan(rows)) : kosongTeks('Semua penjualan di periode ini sudah lunas.');
      }},
    hariKosong: {judul: 'Hari alat kosong', data: true, nilai: function (o) { return ang(o.hariKosong, 0) + ' hari'; },
      ket: 'Dihitung dari hari-hari yang sudah ada catatan Produksi Suling. Alat dianggap kosong kalau hari itu tidak nyuling.',
      isi: function (o, d) {
        if (!d) return '';
        var hari = [], jalan = {};
        d.produksi.forEach(function (r) {
          if (hari.indexOf(r.t) < 0) hari.push(r.t);
          if (n0(r['Jumlah sulingan']) > 0) jalan[r['Alat suling'] + '|' + r.t] = true;
        });
        if (!hari.length) return kosongTeks('Belum ada produksi suling di periode ini.');
        hari.sort();
        var semuaHari = [];
        for (var t = hari[0]; t <= hari[hari.length - 1]; t = geserTgl(t, 1)) semuaHari.push(t);
        var alat = (o.alat || []).map(function (a) { return a.nama; });
        d.produksi.forEach(function (r) { if (alat.indexOf(r['Alat suling']) < 0) alat.push(r['Alat suling']); });
        return bagian('Per alat', alat.map(function (a) {
          var kosong = semuaHari.filter(function (t) { return !jalan[a + '|' + t]; });
          return brs(a, kosong.length ? kosong.map(tglPendek).join(', ') : 'jalan setiap hari', kosong.length + ' hari');
        }).join(''));
      }},
    kasKeluarLain: {judul: 'Kas keluar lain', data: true, nilai: function (o) { return rp(o.kasKeluarLain); },
      ket: 'Uang keluar yang bukan biaya produksi, misalnya diambil pemilik.',
      isi: function (o, d) {
        if (!d) return '';
        var rows = d.kas.filter(function (r) { return r['Arah'] !== 'Masuk' && !kasProduksi(r['Kategori']); });
        return rows.length ? bagian('Daftar', daftarKas(rows)) : kosongTeks('Tidak ada di periode ini.');
      }},
    kasMasukLain: {judul: 'Kas masuk lain', data: true, nilai: function (o) { return rp(o.kasMasukLain); },
      ket: 'Uang masuk selain penjualan, misalnya setoran modal.',
      isi: function (o, d) {
        if (!d) return '';
        var rows = d.kas.filter(function (r) { return r['Arah'] === 'Masuk'; });
        return rows.length ? bagian('Daftar', daftarKas(rows)) : kosongTeks('Tidak ada di periode ini.');
      }}
  };
  function geserTgl(iso, n) { var p = pecah(iso); var x = new Date(p.y, p.m - 1, p.d + n); return x.getFullYear() + '-' + pad(x.getMonth() + 1) + '-' + pad(x.getDate()); }
  function catatanTerbatas(d) {
    return d && d.terbatas ? '<p class="catatan">Sebagian catatan lama mungkin belum tampil. Perbarui Apps Script ke versi terbaru untuk rincian lengkap.</p>' : '';
  }

  function lembarRinci(judul, sub, nilai, ket, isi) {
    var div = bukaLembar('<h2>' + esc(judul) + '</h2><p class="sub">' + esc(sub) + '</p>' +
      '<div class="nilai-besar">' + esc(nilai) + '</div>' + (ket ? '<p class="ket-rinci">' + esc(ket) + '</p>' : '') +
      '<div class="isi-rinci">' + isi + '</div>' +
      '<div class="baris-tombol"><button class="tombol kedua" data-aksi="tutup">Tutup</button></div>');
    div.addEventListener('click', function (ev) { if (ev.target.closest('[data-aksi="tutup"]')) div.remove(); });
    return div;
  }
  function isiLembar(div, html) { var el = q(div, '.isi-rinci'); if (el) el.innerHTML = html; }

  function bukaRincian(kunci, per) {
    var P = periodeDari(per), R = RINCI[kunci];
    if (!P || !R) return;
    var ket = typeof R.ket === 'function' ? R.ket(P.o) : R.ket;
    var div = lembarRinci(R.judul, P.label, R.nilai(P.o), ket, R.isi(P.o, null, per) + (R.data ? '<div class="memuat">Memuat rincian…</div>' : ''));
    if (!R.data) return;
    muatRincian(P.mulai, P.sampai).then(function (d) { isiLembar(div, R.isi(P.o, d, per) + catatanTerbatas(d)); },
      function (e) { isiLembar(div, R.isi(P.o, null, per) + '<div class="galat-kartu">' + esc(e.jaringan ? 'Perlu sinyal untuk memuat rincian.' : e.message) + '</div>'); });
  }

  // Gaji satu orang: kerja per hari dan upahnya selama periode.
  function htmlGaji(nama, d) {
    var hari = {};
    var ambilHari = function (t) { return hari[t] || (hari[t] = {prod: []}); };
    d.absensi.forEach(function (r) { if (r['Nama'] === nama) ambilHari(r.t).abs = r; });
    d.produksi.forEach(function (r) { if (r['Operator'] === nama && n0(r['Jumlah sulingan']) > 0) ambilHari(r.t).prod.push(r); });
    var jml = 0, hk = 0, sul = 0;
    var rows = Object.keys(hari).sort().map(function (t) {
      var h = hari[t], a = h.abs, ket = [], upah = 0;
      if (a) {
        var ua = n0(a['Upah absensi (Rp)']), ul = n0(a['Upah kerja lain (Rp)']);
        upah = ua + ul;
        if (a['Kehadiran']) ket.push(a['Kehadiran'] + (ua ? ' ' + rp(ua) : ''));
        if (a['Pekerjaan lain']) ket.push('kerja lain: ' + a['Pekerjaan lain'] + ' ' + rp(ul));
        if (a['Keterangan']) ket.push(a['Keterangan']);
        if (tarifMasuk(a['Kehadiran']) || upah > 0) hk++;
        sul += sulinganTarif(a['Kehadiran']);
      } else {
        ket.push('belum diabsen, upah belum terhitung');
      }
      if (h.prod.length) ket.push('produksi: ' + h.prod.map(function (p) { return p['Alat suling'] + ' ' + n0(p['Jumlah sulingan']) + 'x'; }).join(', '));
      jml += upah;
      return brs(tglPendek(t), ket.join(' · '), rp(upah), {kelas: a ? '' : 'baris-awas'});
    });
    if (!rows.length) return {html: kosongTeks('Tidak ada catatan untuk ' + nama + ' di periode ini.'), total: 0};
    var ringkas = [hk + ' hari kerja'];
    if (sul) ringkas.push(sul + ' sulingan');
    return {html: bagian('Per hari', rows.join('') + brs('Total', ringkas.join(' · '), rp(jml), {kelas: 'total'})), total: jml};
  }

  function bukaGaji(nama, per) {
    var P = periodeDari(per);
    if (!P) return;
    var k = cariInduk('Karyawan', 'Nama', nama);
    var o = per === 'm' && P.o.orang ? P.o.orang.filter(function (x) { return x.nama === nama; })[0] : null;
    var info = [k ? k.nilai['Peran'] : (o ? o.peran : ''), k && n0(k.nilai['Upah per sulingan (Rp)']) > 0 ? rp(k.nilai['Upah per sulingan (Rp)']) + ' per sulingan' : '']
      .filter(function (x) { return x; }).join(' · ');
    var div = lembarRinci(nama, P.label + (info ? ' · ' + info : ''), o ? rp(o.total) : '…',
      'Upah per hari dari Absensi. Catatan nyuling dari Produksi Suling ikut ditampilkan untuk dicocokkan.', '<div class="memuat">Memuat rincian…</div>');
    muatRincian(P.mulai, P.sampai).then(function (d) {
      var g = htmlGaji(nama, d);
      isiLembar(div, g.html + catatanTerbatas(d));
      var nb = q(div, '.nilai-besar');
      if (nb) nb.textContent = rp(g.total);
    }, function (e) { isiLembar(div, '<div class="galat-kartu">' + esc(e.jaringan ? 'Perlu sinyal untuk memuat rincian.' : e.message) + '</div>'); });
  }

  // Gerak stok satu produk minggu ini.
  function bukaRincianStok(produk) {
    var s = ambil('stok', null);
    if (!s) return;
    var p = stokDenganAntrian(s).produk.filter(function (x) { return x.produk === produk; })[0] || {stok: 0, satuan: ''};
    var mulai = s.mingguMulai || hariIni(), sampai = hariIni();
    var sat = p.satuan || '';
    var ket = 'Masuk dari Saring Minyak, keluar dari Penjualan, dan disetel ulang saat timbang.' +
      (p.timbang ? ' Timbang terakhir ' + tglIndo(p.timbang) + (p.selisihTimbang !== null && p.selisihTimbang !== undefined ? ', selisih ' + ang(p.selisihTimbang, 2) + ' ' + sat : '') + '.' : '');
    var div = lembarRinci(produk, 'Gerak stok minggu ini', ang(p.stok, 2) + ' ' + sat, ket, '<div class="memuat">Memuat rincian…</div>');
    muatRincian(mulai, sampai).then(function (d) {
      var bawaan = s.bawaan || {}, gerak = [];
      d.saring.forEach(function (r) {
        var nama = r['Produk'] || bawaan.minyak;
        if (nama === produk && r['Minyak (kg)'] !== '') gerak.push({t: r.t, j: 'Saring · ' + r['Alat suling'], n: '+' + ang(r['Minyak (kg)'], 2)});
        if (bawaan.hidrosol === produk && n0(r['Hidrosol diambil (liter)']) > 0) gerak.push({t: r.t, j: 'Hidrosol · ' + r['Alat suling'], n: '+' + ang(r['Hidrosol diambil (liter)'], 2)});
        if (nama === produk && r['Stok minyak di gudang (kg)'] !== '' && r['Stok minyak di gudang (kg)'] !== undefined) gerak.push({t: r.t, j: 'Timbang setelah saring', n: '= ' + ang(r['Stok minyak di gudang (kg)'], 2)});
      });
      d.penjualan.forEach(function (r) { if (r['Produk'] === produk) gerak.push({t: r.t, j: 'Jual · ' + r['Pembeli'], n: '−' + ang(r['Jumlah'], 2)}); });
      (d.stok || []).forEach(function (r) {
        if (r['Produk'] === produk) gerak.push({t: r.t, j: 'Timbang ulang' + (r['Selisih'] !== '' ? ' (selisih ' + ang(r['Selisih'], 2) + ')' : ''), n: '= ' + ang(r['Stok fisik'], 2)});
      });
      gerak.sort(function (a, b) { return a.t < b.t ? -1 : a.t > b.t ? 1 : 0; });
      isiLembar(div, gerak.length ? bagian('Gerak minggu ini', gerak.map(function (x) { return brs(tglPendek(x.t), x.j, x.n + ' ' + sat); }).join(''))
        : kosongTeks('Tidak ada gerak stok minggu ini.'));
    }, function (e) { isiLembar(div, '<div class="galat-kartu">' + esc(e.jaringan ? 'Perlu sinyal untuk memuat rincian.' : e.message) + '</div>'); });
  }

  // ------------------------------------------------------------ layar: ringkasan
  function layarRingkasan() {
    if (!admin()) { location.hash = '#/'; return; }
    var tersimpan = ambil('ringkasan', null);
    kerangka('Ringkasan', 'Dihitung dari Google Sheet', tersimpan ? htmlRingkasan(tersimpan) : '<div class="memuat">Memuat ringkasan…</div>', {aktif: 'ringkasan', muat: true});
    var isi = document.querySelector('.isi');
    isi.addEventListener('change', function (ev) {
      if (ev.target.id === 'pilih-minggu') simpan('mingguDipilih', ev.target.value);
      else if (ev.target.id === 'pilih-bulan') simpan('bulanDipilih', ev.target.value);
      else return;
      isi.innerHTML = htmlRingkasan(ambil('ringkasan', null));
    });
    var muat = function () {
      muatRingkasan().then(function (r) {
        if (location.hash !== '#/ringkasan') return;
        isi.innerHTML = htmlRingkasan(r);
      }, function (e) {
        if (location.hash !== '#/ringkasan') return;
        if (!tersimpan) isi.innerHTML = '<div class="galat-kartu">' + esc(e.message) + '</div>';
        else toast(e.message);
      });
    };
    document.getElementById('tombol-muat').addEventListener('click', function () { toast('Memuat ulang…', 1500); muat(); });
    muat();
  }

  function htmlRingkasan(r) {
    if (!r || !r.minggu) return '';
    var p = (r.peringatan || []).map(function (x) {
      var kelas = x.status === 'Aman' ? 'aman' : (x.status === 'ISI' ? 'isi' : 'perlu');
      return '<div class="peringatan"><span class="chip-status ' + kelas + '">' + esc(x.status || '–') + '</span><div><p>' + esc(x.hal) +
        (x.nilai ? ': <b>' + esc(x.nilai) + '</b>' : '') + '</p>' + (x.saran ? '<p class="saran">' + esc(x.saran) + '</p>' : '') + '</div></div>';
    }).join('');

    var dm = r.minggu;
    var im = indeksPilihan(dm, 'mingguDipilih', function (m) { return m.mulai; });
    var m = dm[im], ms = dm[im + 1];
    konteksRinci.m = m;
    var minggu = m ? '<div class="kartu"><h2>Minggu</h2>' + selectMinggu(dm, im) +
      (ms ? '<p class="sub">Panah membandingkan dengan minggu sebelumnya (' + esc(labelMinggu(ms)) + ').</p>' : '<p class="sub"></p>') +
      '<p class="sub" style="margin-top:-6px">Ketuk kartu untuk melihat rinciannya.</p>' +
      '<div class="angka-grid">' + URUT_ANGKA.map(function (k) { return kotakDari(k, m, ms, 'm'); }).join('') + '</div>' +
      htmlAlat(m) + htmlUpah(m, im === 0) + '</div>' : '';

    var db = r.bulan || [];
    var ib = indeksPilihan(db, 'bulanDipilih', function (x) { return x.bulan; });
    var b = db[ib];
    konteksRinci.b = b;
    var bulan = b ? '<div class="kartu"><h2>Bulan</h2><select class="masukan pilih-periode" id="pilih-bulan" aria-label="Pilih bulan">' +
      db.map(function (x, i) { return '<option value="' + esc(x.bulan) + '"' + (i === ib ? ' selected' : '') + '>' + esc(labelBulan(x)) + (i === 0 ? ' (bulan ini)' : '') + '</option>'; }).join('') +
      '</select><div class="angka-grid">' +
      kotakAngka('Penjualan', rp(b.penjualan), false, '', 'penjualan', 'b') + kotakAngka('Laba usaha', rp(b.laba), b.laba < 0, '', 'laba', 'b') +
      kotakAngka('Minyak dihasilkan', ang(b.minyak) + ' kg', false, '', 'minyak', 'b') + kotakAngka('Sulingan', ang(b.sulingan, 0) + ' kali', false, '', 'sulingan', 'b') +
      kotakAngka('Biaya produksi', rp(b.biayaProduksi), false, '', 'biayaProduksi', 'b') + kotakAngka('Total upah', rp(b.totalUpah), false, '', 'totalUpah', 'b') +
      kotakAngka('Kas keluar lain', rp(b.kasKeluarLain), false, '', 'kasKeluarLain', 'b') + kotakAngka('Kas masuk lain', rp(b.kasMasukLain), false, '', 'kasMasukLain', 'b') +
      '</div></div>' : '';

    var stok = r.stok ? '<div id="kotak-stok" data-lengkap="1">' + htmlStok(r.stok, true) + '</div>'
      : '<div class="pratinjau awas">' + esc(PESAN_STOK_LAMA) + '</div>';
    return '<p class="sub" style="margin:0 0 12px;color:var(--teks-2)">Data sampai ' + esc(tglIndo(r.dataSampai) || '–') + '. Rincian lengkap ada di tab Rekap pada Google Sheet.</p>' +
      stok + minggu + bulan + '<div class="judul-bagian">Peringatan (kondisi terbaru)</div><div class="kartu">' + (p || '<div class="kosong">Tidak ada peringatan.</div>') +
      (pemilik() ? '<button class="tautan" data-ke="#/batas">Atur batas peringatan ›</button>' : '') + '</div>';
  }

  // ------------------------------------------------------------ bidang formulir
  function htmlBidang(b, i, draf, px) {
    px = px || 'b';
    if (b.j === 'gridAlat') return htmlGridAlat(b, i, draf, px);
    if (b.j === 'gridOrang') return htmlGridOrang(b, i, draf, px);
    if (b.j === 'kerjaLain') return htmlKerjaLain(b, i, draf, px);
    var id = px + i;
    var wajib = b.wajib !== false;
    var label = b.label || b.h;
    var kepala = '<span class="label">' + esc(label) + (wajib || b.bawaanPertama ? '' : ' <span class="opsional">(boleh kosong)</span>') + '</span>' +
      (b.bantuan ? '<div class="bantuan">' + esc(b.bantuan) + '</div>' : '');
    var d = draf[b.h];
    var isi = '';
    if (b.j === 'tanggal') {
      var awal = d !== undefined ? d : (wajib ? hariIni() : '');
      isi = '<input class="masukan" type="date" name="' + id + '" value="' + esc(awal) + '" max="' + hariIni() + '">';
    } else if (b.j === 'pilih' || b.j === 'centang') {
      isi = htmlChips(b, id, d);
    } else if (b.j === 'daftar') {
      var opsi = opsiBidang(b);
      if (d && opsi.indexOf(d) < 0) opsi.push(d);
      isi = '<select class="masukan" name="' + id + '"><option value="">Pilih…</option>' + opsi.map(function (o) {
        return '<option' + (d === o ? ' selected' : '') + '>' + esc(o) + '</option>';
      }).join('') + '</select>';
    } else if (b.j === 'rupiah' || b.j === 'angka') {
      var v = d !== undefined ? d : (b.bawaan || '');
      isi = '<input class="masukan" type="text" inputmode="numeric" name="' + id + '" value="' + esc(v) + '" placeholder="' + (b.j === 'rupiah' ? 'contoh 250000' : '') + '">' +
        (b.j === 'rupiah' ? '<div class="petunjuk-angka" id="' + id + '_pet"></div>' : '');
    } else if (b.j === 'desimal') {
      isi = '<input class="masukan" type="text" inputmode="decimal" name="' + id + '" value="' + esc(d === undefined ? '' : d) + '">';
    } else if (b.j === 'teks') {
      isi = '<input class="masukan" type="text" name="' + id + '" value="' + esc(d || '') + '" autocomplete="off"' +
        (b.polos ? ' autocapitalize="none" spellcheck="false"' : '') + '>';
    } else if (b.j === 'sandi') {
      isi = '<input class="masukan" type="' + (b.tipe || 'text') + '" name="' + id + '" value="' + esc(d || '') + '" autocomplete="new-password" autocapitalize="none" spellcheck="false">';
    } else if (b.j === 'paragraf') {
      isi = '<textarea class="masukan" name="' + id + '">' + esc(d || '') + '</textarea>';
    }
    return '<div class="bidang" id="' + id + '" data-h="' + esc(b.h) + '">' + kepala + isi + '<div class="pesan-salah" hidden></div></div>';
  }

  function htmlChips(b, nama, d, opsiPaksa) {
    var tipe = b.j === 'centang' ? 'checkbox' : 'radio';
    var pilihan = (opsiPaksa || opsiBidang(b)).slice();
    var terpilih = Array.isArray(d) ? d : (d !== undefined && d !== null && d !== '' ? [String(d)] : []);
    if (!terpilih.length && b.bawaanPertama && pilihan.length) terpilih = [pilihan[0]];
    var asing = terpilih.filter(function (v) { return pilihan.indexOf(v) < 0; });
    var lainTeks = '';
    if (b.lainnya) lainTeks = asing.join(', ');
    else asing.forEach(function (v) { pilihan.push(v); });   // nilai lama tetap terlihat
    var label = b.label || b.h || '';
    if (!pilihan.length && !b.lainnya) return '<div class="galat-kartu">Daftar pilihan kosong. Tambahkan di menu Kelola, lalu buka Akun > Perbarui data.</div>';
    var lainDipilih = !!lainTeks || (b.lainnya && !pilihan.length);
    var html = '<div class="chips">';
    if (b.kosong !== undefined) {
      html += '<label class="chip lewati"><input type="radio" name="' + nama + '" value=""' + (terpilih.length ? '' : ' checked') + '><span>' + esc(b.kosong) + '</span></label>';
    }
    html += pilihan.map(function (o) {
      return '<label class="chip"><input type="' + tipe + '" name="' + nama + '" value="' + esc(o) + '"' + (terpilih.indexOf(o) >= 0 ? ' checked' : '') + '><span>' + esc(o) + '</span></label>';
    }).join('');
    if (b.lainnya) {
      html += '<label class="chip"><input type="' + tipe + '" name="' + nama + '" value="__lain"' + (lainDipilih ? ' checked' : '') + '><span>Lainnya…</span></label>';
    }
    html += '</div>';
    if (b.lainnya) {
      html += '<input class="masukan lainnya-teks" id="' + nama + '_lt" placeholder="Tulis ' + esc(label.toLowerCase()) + ' lainnya" value="' + esc(lainTeks) + '"' + (lainDipilih ? '' : ' hidden') + '>';
    }
    return html;
  }

  // Kisi alat suling: satu kotak per alat aktif.
  function htmlGridAlat(b, i, draf, px) {
    var id = px + i;
    var alat = daftarInduk('Alat Suling');
    var d = draf[b.k] || {};
    var kepala = '<span class="label">' + esc(b.label) + '</span>' + (b.bantuan ? '<div class="bantuan">' + esc(b.bantuan) + '</div>' : '');
    if (!alat.length) {
      return '<div class="bidang" id="' + id + '" data-h="' + esc(b.k) + '">' + kepala + '<div class="galat-kartu">Belum ada alat suling aktif. Tambahkan di Kelola > Alat suling.</div></div>';
    }
    var ops = opsiBidang({sumber: 'operator'});
    var kondisi = pilihanDaftar('Kondisi alat');
    var jumlah = ['0', '1', '2', '3'];
    var kotak = alat.map(function (a, j) {
      var nama = a.nilai['Nama alat'];
      var v = d[nama] || {};
      var nm = id + '_a' + j;
      var nVal = v.n === undefined || v.n === null ? '' : String(v.n);
      var nLain = nVal !== '' && jumlah.indexOf(nVal) < 0;
      var opVal = v.op !== undefined ? v.op : (a.nilai['Operator tetap'] || '');
      var kVal = v.k !== undefined ? v.k : (kondisi[0] || '');
      var chipJumlah = '<div class="chips"><label class="chip lewati"><input type="radio" name="' + nm + '_n" value=""' + (nVal === '' ? ' checked' : '') + '><span>Tidak diisi</span></label>' +
        jumlah.map(function (x) {
          return '<label class="chip"><input type="radio" name="' + nm + '_n" value="' + x + '"' + (nVal === x ? ' checked' : '') + '><span>' + (x === '0' ? '0 · tidak jalan' : x) + '</span></label>';
        }).join('') +
        '<label class="chip"><input type="radio" name="' + nm + '_n" value="__lain"' + (nLain ? ' checked' : '') + '><span>Lainnya…</span></label></div>' +
        '<input class="masukan lainnya-teks" id="' + nm + '_n_lt" inputmode="numeric" placeholder="Jumlah sulingan" value="' + esc(nLain ? nVal : '') + '"' + (nLain ? '' : ' hidden') + '>';
      var opsiOp = ops.slice();
      if (opVal && opsiOp.indexOf(opVal) < 0) opsiOp.push(opVal);
      var chipOp = opsiOp.length ? '<div class="chips">' + opsiOp.map(function (o) {
        return '<label class="chip"><input type="radio" name="' + nm + '_op" value="' + esc(o) + '"' + (opVal === o ? ' checked' : '') + '><span>' + esc(o) + '</span></label>';
      }).join('') + '</div>' : '<div class="galat-kartu">Belum ada karyawan penyuling atau cadangan.</div>';
      var chipK = kondisi.length ? '<div class="chips">' + kondisi.map(function (o) {
        return '<label class="chip"><input type="radio" name="' + nm + '_k" value="' + esc(o) + '"' + (kVal === o ? ' checked' : '') + '><span>' + esc(o) + '</span></label>';
      }).join('') + '</div>' : '';
      return '<div class="kisi-alat" data-px="' + nm + '" data-h="' + esc(b.k + '|' + nama) + '">' +
        '<div class="kisi-judul"><b>' + esc(nama) + '</b>' + (a.nilai['Operator tetap'] ? '<span class="kecil">operator tetap: ' + esc(a.nilai['Operator tetap']) + '</span>' : '') + '</div>' +
        '<div class="sub-label">Jumlah sulingan</div>' + chipJumlah +
        '<div class="kisi-rinci"' + (nVal === '' ? ' hidden' : '') + '>' +
        '<div class="sub-label">Operator</div>' + chipOp +
        (chipK ? '<div class="sub-label">Kondisi alat</div>' + chipK : '') + '</div>' +
        '<div class="pesan-salah" hidden></div></div>';
    }).join('');
    return '<div class="bidang" id="' + id + '" data-h="' + esc(b.k) + '">' + kepala + kotak + '<div class="pesan-salah" hidden></div></div>';
  }

  function bacaGridAlat(b, i, px, akar) {
    var id = px + i, out = {};
    daftarInduk('Alat Suling').forEach(function (a, j) {
      var nm = id + '_a' + j;
      var n = nilaiRadio(akar, nm + '_n');
      if (n === '__lain') n = ((q(akar, '#' + nm + '_n_lt') || {}).value || '').trim();
      out[a.nilai['Nama alat']] = {n: n, op: nilaiRadio(akar, nm + '_op'), k: nilaiRadio(akar, nm + '_k')};
    });
    return out;
  }

  // Kisi absensi: semua karyawan aktif, dikelompokkan per peran.
  function htmlGridOrang(b, i, draf, px) {
    var id = px + i;
    var d = draf[b.k] || {};
    var orang = daftarInduk('Karyawan');
    var kepala = '<span class="label">' + esc(b.label) + '</span>' + (b.bantuan ? '<div class="bantuan">' + esc(b.bantuan) + '</div>' : '');
    if (!orang.length) {
      return '<div class="bidang" id="' + id + '" data-h="' + esc(b.k) + '">' + kepala + '<div class="galat-kartu">Belum ada karyawan aktif. Tambahkan di Kelola > Karyawan.</div></div>';
    }
    var html = URUT_PERAN.map(function (peran) {
      var anggota = orang.map(function (o, j) { return {o: o, j: j}; }).filter(function (x) { return x.o.nilai['Peran'] === peran; });
      if (!anggota.length) return '';
      var tarif = tarifUntuk(peran);
      var cepat = tarif.filter(function (t) { return t.nilai['Jenis'] === 'Masuk'; })[0];
      return '<div class="kelompok-orang"><div class="kelompok-judul"><span>' + esc(peran) + ' · ' + anggota.length + ' orang</span>' +
        (cepat ? '<button type="button" class="tombol-kecil" data-isi-semua="' + esc(peran) + '" data-nilai="' + esc(cepat.nilai['Pilihan']) + '">Semua yang kosong: ' + esc(cepat.nilai['Pilihan']) + '</button>' : '') + '</div>' +
        anggota.map(function (x) {
          var nama = x.o.nilai['Nama'];
          var nm = id + '_o' + x.j;
          var v = d[nama] || '';
          var opsi = tarif.map(function (t) { return t.nilai['Pilihan']; });
          if (v && opsi.indexOf(v) < 0) opsi.push(v);
          return '<div class="baris-kisi" data-peran="' + esc(peran) + '" data-h="' + esc(b.k + '|' + nama) + '"><div class="nama">' + esc(nama) + '</div><div class="chips">' +
            '<label class="chip lewati"><input type="radio" name="' + nm + '" value=""' + (v ? '' : ' checked') + '><span>Tidak diisi</span></label>' +
            opsi.map(function (o) {
              return '<label class="chip"><input type="radio" name="' + nm + '" value="' + esc(o) + '"' + (v === o ? ' checked' : '') + '><span>' + esc(o) + '</span></label>';
            }).join('') + '</div><div class="pesan-salah" hidden></div></div>';
        }).join('') + '</div>';
    }).join('');
    return '<div class="bidang" id="' + id + '" data-h="' + esc(b.k) + '">' + kepala + html + '<div class="pesan-salah" hidden></div></div>';
  }

  function bacaGridOrang(b, i, px, akar) {
    var id = px + i, out = {};
    daftarInduk('Karyawan').forEach(function (o, j) { out[o.nilai['Nama']] = nilaiRadio(akar, id + '_o' + j); });
    return out;
  }

  function htmlKerjaLain(b, i, draf, px) {
    var id = px + i;
    var d = draf[b.k] || {};
    var orang = daftarInduk('Karyawan');
    var ada = d.ada === 'Ya';
    var siapa = d.siapa || [];
    var upah = d.upah || {};
    return '<div class="bidang bidang-kerja-lain" id="' + id + '" data-px="' + id + '" data-h="' + esc(b.k) + '">' +
      '<span class="label">Ada kerja lain dengan upah khusus?</span><div class="bantuan">Pekerjaan di luar tarif biasa, misalnya tambal kolam atau angkut kayu.</div>' +
      '<div class="chips">' + ['Tidak', 'Ya'].map(function (x) {
        return '<label class="chip"><input type="radio" name="' + id + '_ada" value="' + x + '"' + ((ada ? 'Ya' : 'Tidak') === x ? ' checked' : '') + '><span>' + x + '</span></label>';
      }).join('') + '</div>' +
      '<div class="kerja-lain"' + (ada ? '' : ' hidden') + '>' +
      '<div class="sub-label">Pekerjaan</div><input class="masukan" type="text" name="' + id + '_kerja" value="' + esc(d.kerja || '') + '" placeholder="Contoh: tambal kolam" autocomplete="off">' +
      '<div class="sub-label">Siapa saja</div><div class="chips">' + orang.map(function (o) {
        var n = o.nilai['Nama'];
        return '<label class="chip"><input type="checkbox" name="' + id + '_siapa" value="' + esc(n) + '"' + (siapa.indexOf(n) >= 0 ? ' checked' : '') + '><span>' + esc(n) + '</span></label>';
      }).join('') + '</div>' +
      '<div class="sub-label">Upah per orang</div>' + orang.map(function (o, j) {
        var n = o.nilai['Nama'];
        return '<div class="upah-orang" data-nama="' + esc(n) + '"' + (siapa.indexOf(n) >= 0 ? '' : ' hidden') + '><span>' + esc(n) + '</span>' +
          '<input class="masukan" type="text" inputmode="numeric" name="' + id + '_u' + j + '" value="' + esc(upah[n] || '') + '" placeholder="Rp"></div>';
      }).join('') +
      '</div><div class="pesan-salah" hidden></div></div>';
  }

  function bacaKerjaLain(b, i, px, akar) {
    var id = px + i;
    var upah = {};
    daftarInduk('Karyawan').forEach(function (o, j) {
      var el = q(akar, '[name="' + id + '_u' + j + '"]');
      if (el && el.value) upah[o.nilai['Nama']] = el.value;
    });
    return {ada: nilaiRadio(akar, id + '_ada') || 'Tidak', kerja: ((q(akar, '[name="' + id + '_kerja"]') || {}).value || ''),
      siapa: nilaiCentang(akar, id + '_siapa'), upah: upah};
  }

  // Nilai mentah (untuk draf), dikunci dengan judul kolom / kunci bidang khusus.
  function bacaMentah(bidang, px, akar) {
    var out = {};
    bidang.forEach(function (b, i) {
      var id = px + i;
      if (b.j === 'gridAlat') { out[b.k] = bacaGridAlat(b, i, px, akar); return; }
      if (b.j === 'gridOrang') { out[b.k] = bacaGridOrang(b, i, px, akar); return; }
      if (b.j === 'kerjaLain') { out[b.k] = bacaKerjaLain(b, i, px, akar); return; }
      if (b.j === 'pilih' || b.j === 'centang') {
        var dipilih = qa(akar, 'input[name="' + id + '"]').filter(function (x) { return x.checked; }).map(function (x) {
          return x.value === '__lain' ? (((q(akar, '#' + id + '_lt') || {}).value) || '').trim() : x.value;
        }).filter(function (v) { return v; });
        out[b.h] = b.j === 'centang' ? dipilih : (dipilih[0] || '');
      } else {
        var el = q(akar, '[name="' + id + '"]');
        if (el) out[b.h] = el.value;
      }
    });
    return out;
  }

  // Membaca isian menjadi nilai siap kirim. diam = true: tanpa pesan salah (untuk pratinjau).
  function bacaIsian(bidang, diam, px, akar) {
    var mentah = bacaMentah(bidang, px, akar);
    var nilai = {}, salah = [];
    bidang.forEach(function (b) {
      if (!b.h || b.k) return;
      var v = mentah[b.h];
      var wajib = b.wajib !== false;
      var kosong = v === undefined || v === '' || (Array.isArray(v) && !v.length);
      if (kosong) { if (wajib) salah.push([b.h, (b.j === 'pilih' || b.j === 'centang') ? 'Pilih salah satu.' : 'Wajib diisi.']); return; }
      if (b.j === 'rupiah' || b.j === 'angka') {
        var x = angkaBulat(v);
        if (isNaN(x)) { salah.push([b.h, 'Tulis angka saja.']); return; }
        nilai[b.h] = x;
      } else if (b.j === 'desimal') {
        var y = angkaDesimal(v, b.ribuan);
        if (isNaN(y)) { salah.push([b.h, 'Tulis angka, contoh 3,28.']); return; }
        nilai[b.h] = y;
      } else if (b.j === 'tanggal') {
        if (v > hariIni()) { salah.push([b.h, 'Tanggal tidak boleh setelah hari ini.']); return; }
        nilai[b.h] = v;
      } else if (b.j === 'sandi') {
        nilai[b.h] = v;
      } else if (typeof v === 'string') {
        nilai[b.h] = v.trim();
      } else {
        nilai[b.h] = v;
      }
    });
    return {nilai: nilai, salah: diam ? [] : salah, mentah: mentah};
  }

  function tandaiSalah(salah, akar) {
    akar = akar || document;
    qa(akar, '[data-h]').forEach(function (el) {
      el.classList.remove('salah');
      var p = q(el, ':scope > .pesan-salah'); if (p) { p.hidden = true; p.textContent = ''; }
    });
    var pertama = null;
    salah.forEach(function (s) {
      var el = qa(akar, '[data-h]').filter(function (x) { return x.dataset.h === s[0]; })[0];
      if (!el) return;
      el.hidden = false;
      el.classList.add('salah');
      var p = q(el, ':scope > .pesan-salah');
      if (p && p.hidden) { p.hidden = false; p.textContent = s[1]; }
      if (!pertama) pertama = el;
    });
    if (pertama && pertama.scrollIntoView) pertama.scrollIntoView({behavior: 'smooth', block: 'center'});
  }

  // Menampilkan/menyembunyikan bagian formulir sesuai pilihan (Lainnya…, rincian alat, kerja lain).
  function segarkanTampilanForm(akar) {
    qa(akar, 'input[value="__lain"]').forEach(function (c) {
      var lt = q(akar, '#' + c.name + '_lt');
      if (lt) lt.hidden = !c.checked;
    });
    qa(akar, '.kisi-alat').forEach(function (kot) {
      var n = nilaiRadio(kot, kot.dataset.px + '_n');
      var rinci = q(kot, '.kisi-rinci');
      if (rinci) rinci.hidden = n === '';
    });
    qa(akar, '.bidang-kerja-lain').forEach(function (bd) {
      var px = bd.dataset.px;
      var kl = q(bd, '.kerja-lain');
      if (kl) kl.hidden = nilaiRadio(bd, px + '_ada') !== 'Ya';
      var siapa = nilaiCentang(bd, px + '_siapa');
      qa(bd, '.upah-orang').forEach(function (u) { u.hidden = siapa.indexOf(u.dataset.nama) < 0; });
    });
  }

  function pasangFormDinamis(akar, segarkan) {
    var hapusSalah = function (t) {
      var b = t.closest && t.closest('[data-h]');
      if (!b) return;
      b.classList.remove('salah');
      var p = q(b, ':scope > .pesan-salah'); if (p) { p.hidden = true; p.textContent = ''; }
    };
    akar.addEventListener('input', function (ev) { hapusSalah(ev.target); if (segarkan) segarkan(); });
    akar.addEventListener('change', function (ev) {
      var t = ev.target;
      hapusSalah(t);
      segarkanTampilanForm(akar);
      if (t.value === '__lain' && t.checked) { var lt = q(akar, '#' + t.name + '_lt'); if (lt) lt.focus(); }
      if (segarkan) segarkan();
    });
    akar.addEventListener('click', function (ev) {
      var tb = ev.target.closest && ev.target.closest('[data-isi-semua]');
      if (!tb) return;
      var nilai = tb.dataset.nilai;
      var n = 0;
      qa(akar, '.baris-kisi').filter(function (r) { return r.dataset.peran === tb.dataset.isiSemua; }).forEach(function (r) {
        var radios = qa(r, 'input[type=radio]');
        var dipilih = radios.filter(function (x) { return x.checked; })[0];
        if (dipilih && dipilih.value) return;
        var target = radios.filter(function (x) { return x.value === nilai; })[0];
        if (target) { target.checked = true; n++; hapusSalah(target); }
      });
      toast(n ? n + ' orang diisi "' + nilai + '".' : 'Semua sudah terisi.', 2000);
      if (segarkan) segarkan();
    });
  }

  function tampilNilai(b, v) {
    if (Array.isArray(v)) return v.join(', ');
    if (b.j === 'rupiah') return rp(v);
    if (b.j === 'desimal' || b.j === 'angka') return ang(v, 3);
    if (b.j === 'tanggal') return tglIndo(v);
    return String(v);
  }

  function konfirmasi(tab, bidang, nilai, baris, lanjut, labelKirim, pratinjau) {
    var isi = bidang.filter(function (b) { return b.h && !b.k && nilai[b.h] !== undefined && nilai[b.h] !== ''; }).map(function (b) {
      return '<li><span>' + esc(b.label || b.h) + '</span><b>' + esc(tampilNilai(b, nilai[b.h])) + '</b></li>';
    }).join('');
    if (baris && FORM[tab].baris) {
      isi += baris.map(function (r) { var x = FORM[tab].baris(r); return '<li><span>' + esc(x[0]) + '</span><b>' + esc(x[1]) + '</b></li>'; }).join('');
    }
    var div = bukaLembar('<h2>Periksa lagi</h2><p class="sub">' + esc(labelTab(tab)) + '</p>' +
      '<ul class="ringkas">' + isi + '</ul>' +
      (pratinjau ? '<div class="pratinjau">' + pratinjau.map(function (x) { return '<div>' + esc(x) + '</div>'; }).join('') + '</div>' : '') +
      '<div class="baris-tombol"><button class="tombol kedua" data-aksi="ubah">Ubah</button><button class="tombol utama" data-aksi="kirim">' + esc(labelKirim || 'Benar, simpan') + '</button></div>');
    div.addEventListener('click', function (ev) {
      var a = ev.target.closest('[data-aksi]');
      if (a && a.dataset.aksi === 'ubah') { div.remove(); return; }
      if (a && a.dataset.aksi === 'kirim') { div.remove(); lanjut(); }
    });
  }

  // ------------------------------------------------------------ layar: isi formulir
  // Formulir isi baru, atau ubah catatan lama (ubah = {tab, id, nilai}).
  function layarIsi(kunci, ubah) {
    var tab = tabDariKunci(kunci);
    if (!tab || (!boleh(tab) && !(ubah && admin()))) { location.hash = '#/'; return; }
    if (ubah && ubah.tab !== tab) ubah = null;
    var kembali = ubah ? '#/terbaru/' + kunci : '#/';
    if (!konfig || !konfig.master) {
      kerangka(labelTab(tab), '', '<div class="galat-kartu">Daftar pilihan belum termuat. Sambungkan ke internet sekali, lalu buka lagi.</div>' +
        '<div style="margin-top:12px"><button class="tombol utama penuh" id="coba-muat">Muat daftar pilihan</button></div>', {kembali: kembali, tanpaNav: true});
      document.getElementById('coba-muat').addEventListener('click', function () {
        muatKonfig().then(function () { tampilkan(); }, function (e) { toast(e.message); });
      });
      return;
    }
    var bidang = ubah ? (FORM_UBAH[tab] || FORM[tab].bidang).filter(function (b) { return dikenalServer(tab, b); }) : bidangTampil(tab);
    var draf = ubah ? mentahDariNilai(bidang, ubah.nilai) : ambil('draf.' + kunci, {});
    var html = (ubah ? '<div class="pratinjau awas">Mengubah catatan yang sudah masuk Google Sheet. Perubahan dicatat di tab Log Aplikasi.</div>' : '') +
      bidang.map(function (b, i) { return htmlBidang(b, i, draf, 'b'); }).join('') +
      '<div class="pratinjau" id="pratinjau" hidden></div>';
    var tglLama = ubah ? (ubah.nilai['Tanggal'] || ubah.nilai['Tanggal saring'] || '') : '';
    kerangka(ubah ? 'Ubah ' + labelTab(tab) : labelTab(tab), ubah ? 'Catatan tanggal ' + tglIndo(tglLama) : FORM[tab].ket,
      '<form id="formulir" novalidate>' + html + '</form>', {kembali: kembali, tanpaNav: true});
    app.insertAdjacentHTML('beforeend', '<div class="aksi-bawah"><button class="tombol kedua" id="tombol-kosong" type="button">' + (ubah ? 'Batal' : 'Kosongkan') + '</button>' +
      '<button class="tombol utama" id="tombol-simpan" type="button">' + (ubah ? 'Simpan perubahan' : 'Simpan') + '</button></div>');

    var form = document.getElementById('formulir');
    var hitung = function (diam) {
      var h = bacaIsian(bidang, diam, 'b', form);
      var s = (!ubah && FORM[tab].susun) ? FORM[tab].susun(h.mentah) : null;
      return {h: h, s: s};
    };
    var segarkan = function () {
      var x = hitung(true);
      var p = FORM[tab].pratinjau ? FORM[tab].pratinjau(x.h.nilai, x.s) : null;
      var kotak = document.getElementById('pratinjau');
      kotak.hidden = !p; kotak.innerHTML = p ? p.map(function (t) { return '<div>' + esc(t) + '</div>'; }).join('') : '';
      bidang.forEach(function (b, i) {
        if (b.j !== 'rupiah') return;
        var pet = document.getElementById('b' + i + '_pet');
        if (pet) pet.textContent = x.h.nilai[b.h] > 0 ? rp(x.h.nilai[b.h]) : '';
      });
      if (!ubah) simpan('draf.' + kunci, x.h.mentah);
    };
    pasangFormDinamis(form, segarkan);
    // Harga satuan terisi otomatis dari harga biasa produk.
    form.addEventListener('change', function (ev) {
      if (tab !== 'Penjualan' || ev.target.type !== 'radio') return;
      var iP = bidang.map(kunciB).indexOf('Produk'), iH = bidang.map(kunciB).indexOf('Harga satuan (Rp)');
      if (iP < 0 || iH < 0 || ev.target.name !== 'b' + iP) return;
      var p = cariInduk('Produk', 'Produk', ev.target.value);
      var harga = form.querySelector('[name="b' + iH + '"]');
      if (p && p.nilai['Harga biasa (Rp)'] && harga && !harga.value) { harga.value = p.nilai['Harga biasa (Rp)']; segarkan(); }
    });
    segarkanTampilanForm(form);
    segarkan();

    document.getElementById('tombol-kosong').addEventListener('click', function () {
      if (ubah) { location.hash = kembali; return; }
      if (!confirm('Kosongkan semua isian di formulir ini?')) return;
      buang('draf.' + kunci); layarIsi(kunci);
    });
    document.getElementById('tombol-simpan').addEventListener('click', function () {
      var x = hitung(false);
      var nilai = x.h.nilai;
      var salah = x.h.salah.concat(x.s ? x.s.salah : []).concat(FORM[tab].cek && !x.s ? FORM[tab].cek(nilai) : []);
      tandaiSalah(salah, form);
      if (salah.length) { toast('Ada isian yang perlu diperbaiki.'); return; }
      var tombolSimpan = document.getElementById('tombol-simpan');
      var pratinjau = FORM[tab].pratinjau ? FORM[tab].pratinjau(nilai, x.s) : null;

      if (ubah) {
        // Kirim semua kolom formulir: yang kosong ikut dikosongkan di Sheet.
        var nilaiUbah = {};
        bidang.forEach(function (b) { if (b.h && !b.k) nilaiUbah[b.h] = nilai[b.h] !== undefined ? nilai[b.h] : ''; });
        konfirmasi(tab, bidang, nilai, null, function () {
          tombolSimpan.disabled = true; tombolSimpan.textContent = 'Menyimpan…';
          panggil('ubah', {tab: tab, id: ubah.id, nilai: nilaiUbah}).then(function (r) {
            if (r && r.ok) { sedangDiubah = null; buang('ringkasan'); toast('Catatan sudah diperbarui di Google Sheet.'); location.hash = kembali; return; }
            tombolSimpan.disabled = false; tombolSimpan.textContent = 'Simpan perubahan';
            toast((r && r.galat) || 'Gagal menyimpan perubahan.', 6000);
            if (r && r.kode === 'BERUBAH') { sedangDiubah = null; location.hash = kembali; }
          }, function (e) {
            tombolSimpan.disabled = false; tombolSimpan.textContent = 'Simpan perubahan';
            toast(e.jaringan ? 'Perlu sinyal untuk mengubah catatan. Coba lagi nanti.' : e.message, 6000);
          });
        }, 'Benar, simpan perubahan', pratinjau);
        return;
      }

      var kirim = function () {
        konfirmasi(tab, bidang, nilai, x.s ? x.s.baris : null, function () {
          var item = {id: idBaru(), tab: tab, nilai: nilai, waktu: Date.now(), status: 'menunggu'};
          if (x.s) item.baris = x.s.baris;
          antrian.push(item);
          simpanAntrian();
          buang('draf.' + kunci);
          location.hash = '#/';
          toast(navigator.onLine ? 'Tersimpan. Sedang dikirim…' : 'Tersimpan di HP. Akan dikirim saat ada sinyal.');
          kirimAntrian();
        }, null, pratinjau);
      };
      if (x.s && cekDobelAntrian(tab, nilai, x.s.baris) === false) return;
      kirim();
    });
  }

  // Isian per alat / per orang untuk tanggal yang sama yang masih menunggu di HP.
  function cekDobelAntrian(tab, nilai, baris) {
    var kunciNama = tab === 'Absensi' ? 'Nama' : 'Alat suling';
    var nama = baris.map(function (r) { return r[kunciNama]; });
    var dobel = antrian.some(function (a) {
      return a.tab === tab && a.nilai['Tanggal'] === nilai['Tanggal'] && (a.baris || []).some(function (r) { return nama.indexOf(r[kunciNama]) >= 0; });
    });
    if (!dobel) return true;
    return confirm(labelTab(tab) + ' tanggal ' + tglIndo(nilai['Tanggal']) + ' untuk ' + (tab === 'Absensi' ? 'orang' : 'alat') +
      ' yang sama sudah tersimpan di HP ini dan menunggu dikirim.\n\nTetap simpan?');
  }

  // Nilai dari Sheet menjadi isian formulir (untuk mode ubah).
  function mentahDariNilai(bidang, nilai) {
    var out = {};
    bidang.forEach(function (b) {
      if (!b.h) return;
      var v = nilai[b.h];
      if (v === undefined || v === null || v === '') return;
      if (b.j === 'centang') out[b.h] = String(v).split(',').map(function (x) { return x.trim(); }).filter(function (x) { return x; });
      else if (b.j === 'desimal') out[b.h] = String(v).replace('.', ',');
      else out[b.h] = String(v);
    });
    return out;
  }

  // ------------------------------------------------------------ layar: riwayat
  function formatNilai(h, v) {
    if (v === '' || v === null || v === undefined) return '';
    if (/\(Rp\)$/.test(h)) return rp(Number(v));
    if (/\(kg\)$/.test(h)) return ang(Number(v), 3) + ' kg';
    if (/\(liter\)$/.test(h)) return ang(Number(v)) + ' liter';
    if (/^Tanggal/.test(h) && /^\d{4}-\d{2}-\d{2}$/.test(v)) return tglIndo(v);
    if (typeof v === 'number') return ang(v, 3);
    return String(v);
  }

  function layarTerbaru(kunci) {
    var tabBoleh = menuTerurut().map(function (m) { return m.tab; }).filter(function (t) { return boleh(t) || admin(); });
    var tab = tabDariKunci(kunci);
    if (tabBoleh.indexOf(tab) < 0) tab = tabBoleh[0];
    if (!tab) { kerangka('Riwayat', '', '<div class="kosong">Tidak ada catatan.</div>', {aktif: 'terbaru'}); return; }
    var k = FORM[tab].kunci;
    var kelompok = !!TAB_KELOMPOK[tab];
    var n = jumlahRiwayat[k] || (kelompok ? 60 : 15);
    var pilih = '<div class="pilih-tab">' + tabBoleh.map(function (t) {
      return '<button data-ke="#/terbaru/' + FORM[t].kunci + '" class="' + (t === tab ? 'aktif' : '') + '">' + esc(labelTab(t)) + '</button>';
    }).join('') + '</div>';
    var tunggu = antrian.filter(function (a) { return a.tab === tab; });
    var htmlTunggu = tunggu.length ? '<div class="pratinjau awas">' + tunggu.length + ' catatan ' + esc(labelTab(tab)) + ' masih di HP, belum masuk Sheet.</div>' : '';
    var cache = ambil('terbaru.' + k, null);
    var data = cache;
    kerangka('Riwayat', 'Catatan terakhir di Google Sheet', pilih + htmlTunggu + '<div id="daftar-entri">' +
      (cache ? htmlEntri(tab, cache) : '<div class="memuat">Memuat…</div>') + '</div>', {aktif: 'terbaru', muat: true});
    var pilihTab = document.querySelector('.pilih-tab .aktif');
    if (pilihTab && pilihTab.scrollIntoView) pilihTab.scrollIntoView({block: 'nearest', inline: 'center'});
    var muat = function () {
      panggil('terbaru', {tab: tab, n: n}).then(function (r) {
        if (!r.ok) throw new Error(r.galat || 'Gagal memuat.');
        data = r;
        simpan('terbaru.' + k, r);
        var el = document.getElementById('daftar-entri');
        if (el && location.hash.indexOf('#/terbaru') === 0) el.innerHTML = htmlEntri(tab, r);
      }).catch(function (e) {
        var el = document.getElementById('daftar-entri');
        if (!el) return;
        if (cache) toast(e.message + ' Menampilkan data terakhir yang tersimpan.');
        else el.innerHTML = '<div class="galat-kartu">' + esc(e.message) + '</div>';
      });
    };
    document.getElementById('tombol-muat').addEventListener('click', function () { toast('Memuat ulang…', 1500); muat(); });
    var wadah = document.getElementById('daftar-entri');
    var ambilData = function (el) { return data && data.data ? data.data[Number(el.dataset.idx)] : null; };
    wadah.addEventListener('click', function (ev) {
      if (ev.target.closest('[data-lebih]')) { jumlahRiwayat[k] = Math.min(n + (kelompok ? 80 : 20), 300); layarTerbaru(k); return; }
      var tUbah = ev.target.closest('[data-ubah]'), tHapus = ev.target.closest('[data-hapus]');
      if (tUbah) {
        var du = ambilData(tUbah);
        if (!du) return;
        sedangDiubah = {tab: tab, id: du.id, nilai: du.nilai};
        location.hash = '#/ubah/' + k;
        return;
      }
      if (tHapus) {
        var dh = ambilData(tHapus);
        if (!dh) return;
        var judul = tHapus.dataset.judul || '';
        tanyaHapus(labelTab(tab), judul, function () {
          tHapus.disabled = true;
          panggil('hapus', {tab: tab, id: dh.id}).then(function (r) {
            if (r && r.ok) { toast('Catatan dihapus dari Google Sheet.'); buang('ringkasan'); muat(); return; }
            toast((r && r.galat) || 'Gagal menghapus.', 6000); muat();
          }, function (e) {
            tHapus.disabled = false;
            toast(e.jaringan ? 'Perlu sinyal untuk menghapus catatan.' : e.message, 6000);
          });
        });
        return;
      }
      var baris = ev.target.closest('[data-idx]');
      if (baris) { var d = ambilData(baris); if (d) tampilRincian(tab, data.kepala, d); }
    });
    muat();
  }

  function tombolKelola(idx, judul) {
    if (!admin()) return '';
    return '<button class="tombol-ikon" data-ubah="1" data-idx="' + idx + '" aria-label="Ubah">' + ikon('pensil') + '</button>' +
      '<button class="tombol-ikon hapus" data-hapus="1" data-idx="' + idx + '" data-judul="' + esc(judul) + '" aria-label="Hapus">' + ikon('sampah') + '</button>';
  }

  function htmlEntri(tab, r) {
    if (!r.data || !r.data.length) return '<div class="kosong">Belum ada catatan.</div>';
    var html = TAB_KELOMPOK[tab] ? htmlEntriKelompok(tab, r) : r.data.map(function (d, idx) {
      var v = d.nilai;
      var g = function (h) { return v[h] === undefined || v[h] === null ? '' : v[h]; };
      var f = function (h) { return esc(formatNilai(h, g(h))); };
      var judul = '', baris = [], ket = g('Keterangan');
      if (tab === 'Ambil Bahan') {
        judul = tglIndo(g('Tanggal')) + ' · ' + g('Pengumpul');
        baris.push(f('Berat bahan (kg)') + ' · ' + f('Kondisi bahan'));
        baris.push('Beli bahan ' + f('Uang beli bahan (Rp)') + ' · ' + f('Harga bahan per kg (Rp)') + '/kg');
        baris.push('<span class="redup">' + f('Daerah') + '</span>');
      } else if (tab === 'Saring Minyak') {
        judul = tglIndo(g('Tanggal saring')) + ' · ' + g('Alat suling');
        baris.push(f('Minyak (kg)') + ' dari ' + f('Jumlah sulingan yang disaring') + ' sulingan (' + f('Minyak per sulingan (kg)') + '/sulingan)');
        if (g('Produk')) baris.push(f('Produk'));
        baris.push('Bahan: ' + f('Kondisi bahan') + (g('Hidrosol diambil (liter)') !== '' ? ' · hidrosol ' + f('Hidrosol diambil (liter)') : ''));
      } else if (tab === 'Penjualan') {
        judul = tglIndo(g('Tanggal')) + ' · ' + g('Pembeli');
        baris.push(f('Jumlah') + ' ' + f('Satuan') + ' ' + f('Produk'));
        baris.push(f('Harga satuan (Rp)') + ' × ' + f('Jumlah') + ' = <b>' + f('Total (Rp)') + '</b> · ' + f('Status bayar'));
      } else if (tab === 'Kas') {
        judul = tglIndo(g('Tanggal')) + ' · ' + g('Kategori');
        baris.push((g('Arah') === 'Masuk' ? 'Masuk ' : 'Keluar ') + '<b>' + f('Jumlah (Rp)') + '</b>');
        if (ket) { baris.push(esc(ket)); ket = ''; }
      }
      return '<div class="kartu entri bisa-ketuk" data-idx="' + idx + '" role="button" tabindex="0">' +
        '<h3><span>' + esc(judul) + '</span><small>' + esc(g('Dicatat oleh')) + ' ›</small></h3>' +
        baris.map(function (x) { return '<p>' + x + '</p>'; }).join('') +
        (ket ? '<div class="ket">' + esc(ket) + '</div>' : '') +
        (admin() ? '<div class="aksi-entri"><button class="tombol kedua" data-ubah="1" data-idx="' + idx + '">Ubah</button>' +
          '<button class="tombol bahaya" data-hapus="1" data-idx="' + idx + '" data-judul="' + esc(judul) + '">Hapus</button></div>' : '') +
        '</div>';
    }).join('');
    if (r.total > r.data.length && r.data.length < 300) html += '<button class="tombol kedua penuh" style="margin-top:12px" data-lebih="1">Tampilkan lebih banyak</button>';
    return html;
  }

  // Produksi Suling & Absensi: satu kartu per tanggal.
  function htmlEntriKelompok(tab, r) {
    var grup = [];
    r.data.forEach(function (d, idx) {
      var t = d.nilai['Tanggal'];
      var g = grup[grup.length - 1];
      if (!g || g.tgl !== t) { g = {tgl: t, item: []}; grup.push(g); }
      g.item.unshift({d: d, idx: idx});     // dalam satu tanggal: urutan seperti saat diisi
    });
    return grup.map(function (g) {
      var ket = [], total = 0, totalUpah = 0, oleh = [];
      var baris = g.item.map(function (x) {
        var v = x.d.nilai;
        if (v['Keterangan'] && ket.indexOf(v['Keterangan']) < 0) ket.push(v['Keterangan']);
        if (v['Dicatat oleh'] && oleh.indexOf(v['Dicatat oleh']) < 0) oleh.push(v['Dicatat oleh']);
        var nama, rinci;
        if (tab === 'Produksi Suling') {
          nama = v['Alat suling'];
          total += Number(v['Jumlah sulingan']) || 0;
          rinci = (Number(v['Jumlah sulingan']) || 0) + ' sulingan' + (v['Operator'] ? ' · ' + v['Operator'] : '') + (v['Kondisi alat'] ? ' · ' + v['Kondisi alat'] : '');
        } else {
          nama = v['Nama'];
          var u = (Number(v['Upah absensi (Rp)']) || 0) + (Number(v['Upah kerja lain (Rp)']) || 0);
          totalUpah += u;
          var bag = [];
          if (v['Kehadiran']) bag.push(v['Kehadiran']);
          if (v['Pekerjaan lain']) bag.push(v['Pekerjaan lain']);
          if (u) bag.push(rp(u));
          rinci = bag.join(' · ');
        }
        return '<div class="baris-entri" data-idx="' + x.idx + '"><div class="teks"><b>' + esc(nama) + '</b><span class="redup">' + esc(rinci) + '</span></div>' +
          tombolKelola(x.idx, tglIndo(g.tgl) + ' · ' + nama) + '</div>';
      }).join('');
      var ringkas = tab === 'Produksi Suling' ? 'Total ' + total + ' sulingan' : g.item.length + ' orang · upah ' + rp(totalUpah);
      return '<div class="kartu entri"><h3><span>' + esc(namaHari(g.tgl) + ', ' + tglIndo(g.tgl)) + '</span><small>' + esc(oleh.join(', ')) + '</small></h3>' + baris +
        '<div class="ringkas-kartu">' + esc(ringkas) + '</div>' +
        (ket.length ? '<div class="ket">' + esc(ket.join(' | ')) + '</div>' : '') + '</div>';
    }).join('');
  }

  // Rincian satu catatan, hanya untuk dibaca.
  function tampilRincian(tab, kepala, d) {
    var LABEL = {'Waktu kirim': 'Waktu dikirim'};
    var isi = (kepala || Object.keys(d.nilai)).map(function (h) {
      if (!h || h === 'ID' || h === 'ID isian') return '';
      var v = formatNilai(h, d.nilai[h]);
      if (v === '') return '';
      return '<li><span>' + esc(LABEL[h] || h) + '</span><b>' + esc(v) + '</b></li>';
    }).join('');
    var tgl = d.nilai['Tanggal'] || d.nilai['Tanggal saring'] || '';
    var div = bukaLembar('<h2>Rincian ' + esc(labelTab(tab)) + '</h2><p class="sub">' + esc(tglIndo(tgl)) + ' · hanya untuk dibaca</p>' +
      '<ul class="rincian">' + isi + '</ul><div class="baris-tombol"><button class="tombol kedua" data-aksi="tutup">Tutup</button></div>');
    div.addEventListener('click', function (ev) { if (ev.target.closest('[data-aksi="tutup"]')) div.remove(); });
  }

  function tanyaHapus(judulTab, judul, lanjut) {
    var div = bukaLembar('<h2>Hapus catatan ini?</h2><p class="sub">' + esc(judulTab) + ' · ' + esc(judul) + '</p>' +
      '<p style="margin:0 0 16px;font-size:.875rem">Catatan akan hilang dari Google Sheet dan rekap ikut berubah. Isinya tetap tersimpan di tab Log Aplikasi kalau perlu dikembalikan.</p>' +
      '<div class="baris-tombol"><button class="tombol kedua" data-aksi="batal">Batal</button><button class="tombol bahaya" data-aksi="hapus">Ya, hapus</button></div>');
    div.addEventListener('click', function (ev) {
      var a = ev.target.closest('[data-aksi]');
      if (a && a.dataset.aksi === 'batal') { div.remove(); return; }
      if (a && a.dataset.aksi === 'hapus') { div.remove(); lanjut(); }
    });
  }

  // ------------------------------------------------------------ layar: antrian
  function layarAntrian() {
    var isi = antrian.length ? antrian.map(function (a) {
      var tgl = a.nilai['Tanggal'] || a.nilai['Tanggal saring'] || '';
      var info = a.baris ? a.baris.length + ' baris: ' + a.baris.slice(0, 3).map(function (r) { return r['Nama'] || r['Alat suling']; }).join(', ') + (a.baris.length > 3 ? ', …' : '')
        : Object.keys(a.nilai).filter(function (h) { return !/^Tanggal/.test(h); }).slice(0, 3).map(function (h) {
          var v = a.nilai[h]; return Array.isArray(v) ? v.join(', ') : v;
        }).join(' · ');
      return '<div class="kartu entri"><h3><span>' + esc(labelTab(a.tab)) + ' · ' + esc(tglIndo(tgl)) + '</span><small>' + (a.status === 'galat' ? 'Gagal' : 'Menunggu') + '</small></h3>' +
        '<p class="redup">' + esc(info) + '</p>' +
        (a.galat ? '<div class="galat-kartu" style="margin-top:8px">' + esc(a.galat) + '</div>' : '') +
        '<div class="aksi-entri"><button class="tombol kedua" data-ulang="' + esc(a.id) + '">Kirim ulang</button>' +
        '<button class="tombol bahaya" data-hapus-antrian="' + esc(a.id) + '">Hapus</button></div></div>';
    }).join('') : '<div class="kosong">Tidak ada catatan yang menunggu. Semua sudah masuk Google Sheet.</div>';
    kerangka('Belum terkirim', antrian.length + ' catatan', isi, {kembali: '#/', aktif: 'beranda'});
    app.querySelector('.isi').addEventListener('click', function (ev) {
      var u = ev.target.closest('[data-ulang]'), h = ev.target.closest('[data-hapus-antrian]');
      if (u) {
        antrian.forEach(function (a) { if (a.id === u.dataset.ulang) { a.status = 'menunggu'; a.galat = ''; } });
        simpanAntrian(); toast('Mengirim…', 1500);
        kirimAntrian().then(layarAntrian);
      }
      if (h && confirm('Hapus catatan ini dari HP? Catatan yang dihapus tidak akan masuk Google Sheet.')) {
        antrian = antrian.filter(function (a) { return a.id !== h.dataset.hapusAntrian; });
        simpanAntrian(); layarAntrian();
      }
    });
  }

  // ------------------------------------------------------------ layar: akun
  function layarAkun() {
    var a = akses();
    var isi = '<div class="kartu">' +
      '<div class="info-baris"><span>Nama</span><b>' + esc(a.nama) + '</b></div>' +
      '<div class="info-baris"><span>Nama pengguna</span><b>' + esc(a.pengguna) + '</b></div>' +
      '<div class="info-baris"><span>Peran</span><b>' + esc(a.peran) + (a.admin && !a.pemilik ? ' (boleh mengatur)' : '') + '</b></div>' +
      '<div class="info-baris"><span>Boleh mengisi</span><b>' + esc((a.tab || []).length === URUTAN_TAB.length ? 'Semua catatan' : (a.tab || []).map(function (t) { return labelTab(t); }).join(', ') || '–') + '</b></div>' +
      '<div class="info-baris"><span>Belum terkirim</span><b>' + antrian.length + ' catatan</b></div>' +
      '<div class="info-baris"><span>Versi aplikasi</span><b>' + esc(VERSI) + (DI_APK ? ' (APK)' : '') + '</b></div>' +
      '</div><div class="tumpuk" style="margin-top:16px">' +
      '<button class="tombol kedua penuh" data-ke="#/sandi">' + ikon('kunci') + 'Ganti sandi</button>' +
      '<button class="tombol kedua penuh" data-ke="#/namapengguna">' + ikon('akun') + 'Ganti nama pengguna</button>' +
      '<button class="tombol kedua penuh" data-ke="#/tampilan">' + ikon('palet') + (a.pemilik ? 'Tampilan & tata letak' : 'Ukuran huruf & mode gelap') + '</button>' +
      '<button class="tombol kedua penuh" id="perbarui">' + ikon('muat') + 'Perbarui data (nama, alat, pilihan)</button>' +
      (promptPasang && !DI_APK ? '<button class="tombol utama penuh" id="pasang">Pasang aplikasi di HP ini</button>' : '') +
      '<button class="tombol bahaya penuh" id="keluar">Keluar</button></div>';
    kerangka('Akun', '', isi, {aktif: 'akun'});
    document.getElementById('perbarui').addEventListener('click', function (ev) {
      var t = ev.currentTarget;
      t.disabled = true; t.lastChild.textContent = 'Memuat…';
      muatKonfig().then(function (r) { toast(r && r.ok ? 'Data sudah diperbarui.' : (r && r.galat) || 'Gagal.'); layarAkun(); },
        function (e) { toast(e.message); layarAkun(); });
    });
    var ps = document.getElementById('pasang');
    if (ps) ps.addEventListener('click', function () { promptPasang.prompt(); promptPasang = null; });
    document.getElementById('keluar').addEventListener('click', function () {
      if (antrian.length && !confirm('Masih ada ' + antrian.length + ' catatan belum terkirim. Tetap keluar? Catatan tetap tersimpan di HP dan terkirim setelah masuk lagi.')) return;
      keluar('', true);
    });
  }

  // ------------------------------------------------------------ layar: kelola (data induk)
  var MENU_KELOLA = [
    {tab: 'Alat Suling', ikon: 'ketel', ket: function () { return daftarInduk('Alat Suling').length + ' alat aktif'; }},
    {tab: 'Karyawan', ikon: 'orang', ket: function () { return daftarInduk('Karyawan').length + ' orang aktif'; }},
    {tab: 'Tarif Upah', ikon: 'tag', ket: function () { return 'Pilihan saat absensi dan upahnya'; }},
    {tab: 'Pilihan', ikon: 'daftar', ket: function () { return 'Daerah, kondisi bahan & alat, pembeli, status bayar'; }},
    {tab: 'Produk', ikon: 'kotak', ket: function () { return 'Produk yang dijual dan harga biasanya'; }},
    {tab: 'Kategori Kas', ikon: 'dompet', ket: function () { return 'Jenis uang keluar dan masuk'; }}
  ];
  function skema(tab) { return konfig && konfig.skema ? konfig.skema[tab] : null; }
  function tabMaster(kunci) { var s = konfig && konfig.skema; if (!s) return ''; return Object.keys(s).filter(function (t) { return s[t].kunci === kunci; })[0] || ''; }

  function layarKelola() {
    if (!admin()) { location.hash = '#/'; return; }
    if (!konfig || !konfig.skema) {
      kerangka('Kelola', '', '<div class="memuat">Memuat…</div>', {aktif: 'kelola'});
      muatKonfig().then(function () { if (location.hash === '#/kelola') layarKelola(); }, function (e) { toast(e.message); });
      return;
    }
    var adaKolomUpah = (skema('Karyawan').kolom || []).some(function (c) { return c.h === 'Upah per sulingan (Rp)'; });
    var tanpaUpah = adaKolomUpah ? daftarInduk('Karyawan').filter(function (k) {
      return k.nilai['Peran'] === 'Penyuling' && !(Number(k.nilai['Upah per sulingan (Rp)']) > 0);
    }).length : 0;
    var kartu = function (href, judul, ik, ket, lencana) {
      return '<a class="kartu menu-kelola" href="' + href + '"><div class="baris"><span class="lingkar">' + ikon(ik) + '</span><span><b>' + esc(judul) +
        (lencana || '') + '</b><small>' + esc(ket) + '</small></span><span class="panah">›</span></div></a>';
    };
    var isi = '<div class="judul-bagian" style="margin-top:4px">Data yang dipakai di formulir</div>' +
      MENU_KELOLA.map(function (m) {
        var sk = skema(m.tab);
        var lencana = m.tab === 'Karyawan' && tanpaUpah ? '<span class="lencana-kecil merah">' + tanpaUpah + ' belum ada upah suling</span>' : '';
        return kartu('#/kelola/' + sk.kunci, sk.judul, m.ikon, m.ket(), lencana);
      }).join('');
    if (pemilik()) {
      isi += '<div class="judul-bagian">Aplikasi</div>' +
        kartu('#/pengguna', 'Pengguna & sandi', 'kunci', 'Tambah orang lain dengan nama pengguna dan sandi sendiri') +
        kartu('#/tampilan', 'Tampilan & tata letak', 'palet', 'Warna, ukuran huruf, urutan menu dan isian formulir') +
        kartu('#/batas', 'Batas peringatan', 'awan', 'Kapan peringatan muncul di Ringkasan') +
        '<div class="kartu"><div class="bidang" style="margin:0"><span class="label">Awal minggu untuk rekap & gajian</span>' +
        '<select class="masukan" id="awal-minggu">' + HARI.map(function (h) {
          return '<option' + (konfig.pengaturan && konfig.pengaturan.awalMinggu === h ? ' selected' : '') + '>' + h + '</option>';
        }).join('') + '</select></div></div>';
    }
    kerangka('Kelola', 'Alat, karyawan, tarif, dan pengaturan', isi, {aktif: 'kelola', muat: true});
    document.getElementById('tombol-muat').addEventListener('click', function () {
      toast('Memuat ulang…', 1500);
      muatKonfig().then(function () { if (location.hash === '#/kelola') layarKelola(); }, function (e) { toast(e.message); });
    });
    var am = document.getElementById('awal-minggu');
    if (am) am.addEventListener('change', function () {
      var nilai = am.value;
      am.disabled = true;
      panggil('pengaturanSimpan', {awalMinggu: nilai}).then(function (r) {
        am.disabled = false;
        if (!r.ok) { toast(r.galat || 'Gagal menyimpan.'); return; }
        buang('ringkasan'); buang('mingguDipilih');
        toast('Minggu sekarang mulai hari ' + nilai + '.');
        muatKonfig();
      }, function (e) { am.disabled = false; toast(e.jaringan ? 'Perlu sinyal untuk menyimpan.' : e.message); });
    });
  }

  function ketInduk(tab, m) {
    var v = m.nilai;
    switch (tab) {
      case 'Alat Suling':
        return v['Operator tetap'] ? 'Operator tetap: ' + v['Operator tetap'] : 'Belum ada operator tetap';
      case 'Karyawan':
        return [v['Peran'], Number(v['Upah per sulingan (Rp)']) > 0 ? rp(v['Upah per sulingan (Rp)']) + '/sulingan' : (v['Peran'] === 'Penyuling' && v['Upah per sulingan (Rp)'] !== undefined ? 'upah per sulingan belum diisi' : ''),
          v['No HP'], m.aktif ? '' : (v['Tanggal keluar'] ? 'keluar ' + tglIndo(v['Tanggal keluar']) : 'tidak aktif')].filter(function (x) { return x; }).join(' · ');
      case 'Tarif Upah':
        var n = Number(v['Jumlah sulingan']) || 0;
        return [v['Untuk peran'], n > 0 ? rp(v['Upah (Rp)']) + ' + ' + n + ' × upah per sulingan orangnya' : rp(v['Upah (Rp)']), v['Jenis']].join(' · ');
      case 'Produk': return [v['Satuan'], v['Harga biasa (Rp)'] !== '' && v['Harga biasa (Rp)'] !== undefined ? rp(v['Harga biasa (Rp)']) + '/' + v['Satuan'] : ''].filter(function (x) { return x; }).join(' · ');
      case 'Kategori Kas': return [v['Arah'], v['Masuk biaya produksi'] === 'Ya' ? 'biaya produksi' : 'bukan biaya produksi'].join(' · ');
    }
    return '';
  }

  function layarMaster(kunci) {
    var tab = tabMaster(kunci);
    if (!admin() || !tab) { location.hash = '#/kelola'; return; }
    var sk = skema(tab);
    var semua = daftarInduk(tab, true);
    var kel = sk.kelompok;
    var opsiKel = kel ? sk.kolom.filter(function (c) { return c.h === kel; })[0].opsi : null;
    var kelAktif = kel ? ambil('kelompok.' + kunci, opsiKel[0]) : '';
    if (kel && opsiKel.indexOf(kelAktif) < 0) kelAktif = opsiKel[0];
    var dalam = semua.filter(function (m) { return !kel || m.nilai[kel] === kelAktif; });
    var aktif = dalam.filter(function (m) { return m.aktif; }), mati = dalam.filter(function (m) { return !m.aktif; });
    var item = function (m, i, bisaUrut) {
      return '<div class="item-induk" data-id="' + esc(m.id) + '">' +
        (bisaUrut ? '<div class="tombol-urut"><button data-naik="' + i + '" aria-label="Naikkan"' + (i === 0 ? ' disabled' : '') + '>' + ikon('naik', 2.4) + '</button>' +
          '<button data-turun="' + i + '" aria-label="Turunkan"' + (i === aktif.length - 1 ? ' disabled' : '') + '>' + ikon('turun', 2.4) + '</button></div>' : '') +
        '<div class="teks" data-edit="' + esc(m.id) + '"><b>' + esc(m.nilai[sk.utama]) + '</b>' + (ketInduk(tab, m) ? '<small>' + esc(ketInduk(tab, m)) + '</small>' : '') + '</div>' +
        '<button class="tombol-ikon" style="background:var(--latar);color:var(--teks-2)" data-edit="' + esc(m.id) + '" aria-label="Ubah">' + ikon('pensil') + '</button></div>';
    };
    var bantuan = {
      'Alat Suling': 'Alat aktif muncul di formulir Produksi Suling. Alat yang tidak dipakai lagi cukup dinonaktifkan; catatan lamanya tetap ada.',
      'Karyawan': 'Karyawan aktif muncul di absensi dan pilihan operator. Untuk yang nyuling, isi upah per sulingan. Yang keluar cukup ditandai keluar; catatan lamanya tetap ada.',
      'Tarif Upah': 'Semua upah dihitung dari absensi memakai tarif ini. Pilihan suling (1x/2x/3x) = upah di sini (misalnya uang makan) + jumlah sulingan × upah per sulingan orangnya di Kelola > Karyawan. Mengubah tarif tidak mengubah catatan lama.',
      'Pilihan': 'Pilihan yang muncul di formulir. Panah mengatur urutan tampilnya.',
      'Produk': 'Produk yang muncul di formulir Penjualan.',
      'Kategori Kas': 'Kategori yang muncul di formulir Kas.'
    }[tab] || '';
    var isi = (kel ? '<div class="pilih-tab">' + opsiKel.map(function (o) {
      return '<button data-kel="' + esc(o) + '" class="' + (o === kelAktif ? 'aktif' : '') + '">' + esc(o) + '</button>';
    }).join('') + '</div>' : '') +
      '<p class="sub" style="margin:0 0 12px;color:var(--teks-2);font-size:.8125rem">' + esc(bantuan) + '</p>' +
      '<div class="kartu">' + (aktif.length ? aktif.map(function (m, i) { return item(m, i, true); }).join('') : '<div class="kosong">Belum ada. Ketuk + untuk menambah.</div>') + '</div>' +
      '<button class="tombol utama penuh" style="margin-top:12px" id="tambah-induk">' + ikon('tambah', 2.4) + 'Tambah ' + esc((kel ? kelAktif : sk.judul).toLowerCase()) + '</button>' +
      (mati.length ? '<div class="judul-bagian">Tidak aktif (' + mati.length + ')</div><div class="kartu">' + mati.map(function (m, i) { return item(m, i, false); }).join('') + '</div>' : '');
    kerangka(sk.judul, aktif.length + ' aktif', isi, {kembali: '#/kelola', tanpaNav: true,
      kanan: '<button class="tombol-ikon" id="tambah-atas" aria-label="Tambah">' + ikon('tambah', 2.4) + '</button>'});
    var buka = function (m) { lembarInduk(tab, m, kelAktif, function () { if (location.hash === '#/kelola/' + kunci) layarMaster(kunci); }); };
    document.getElementById('tambah-induk').addEventListener('click', function () { buka(null); });
    document.getElementById('tambah-atas').addEventListener('click', function () { buka(null); });
    app.querySelector('.isi').addEventListener('click', function (ev) {
      var k = ev.target.closest('[data-kel]');
      if (k) { simpan('kelompok.' + kunci, k.dataset.kel); layarMaster(kunci); return; }
      var e = ev.target.closest('[data-edit]');
      if (e) { buka(semua.filter(function (m) { return m.id === e.dataset.edit; })[0]); return; }
      var naik = ev.target.closest('[data-naik]'), turun = ev.target.closest('[data-turun]');
      if (!naik && !turun) return;
      var i = Number((naik || turun).dataset[naik ? 'naik' : 'turun']);
      var j = naik ? i - 1 : i + 1;
      if (j < 0 || j >= aktif.length) return;
      var ids = aktif.map(function (m) { return m.id; });
      var tmp = ids[i]; ids[i] = ids[j]; ids[j] = tmp;
      // Ubah urutan di HP dulu supaya terasa cepat, lalu simpan ke Sheet.
      var daftar = konfig.master[tab];
      var dipindah = ids.map(function (id) { return daftar.filter(function (m) { return m.id === id; })[0]; });
      konfig.master[tab] = dipindah.concat(daftar.filter(function (m) { return ids.indexOf(m.id) < 0; }));
      simpan('konfig', konfig);
      layarMaster(kunci);
      panggil('masterUrut', {tab: tab, ids: ids}).then(function (r) {
        if (!r.ok) { toast(r.galat || 'Gagal menyimpan urutan.'); muatKonfig().then(function () { if (location.hash === '#/kelola/' + kunci) layarMaster(kunci); }); }
      }, function (er) { toast(er.jaringan ? 'Urutan belum tersimpan: perlu sinyal.' : er.message); });
    });
  }

  function lembarInduk(tab, m, kelAwal, selesai) {
    var sk = skema(tab);
    var bidang = sk.kolom.map(function (c) {
      var b = {h: c.h, j: c.j, wajib: !!c.wajib, bantuan: c.bantuan};
      if (c.opsi) { b.opsi = c.opsi; b.j = 'pilih'; }
      if (c.j === 'karyawan') { b.j = 'pilih'; b.sumber = 'operator'; b.kosong = 'Tidak ada'; b.wajib = false; }
      return b;
    });
    var draf = {};
    if (m) {
      sk.kolom.forEach(function (c) {
        var v = m.nilai[c.h];
        if (v === '' || v === null || v === undefined) return;
        draf[c.h] = c.j === 'desimal' ? String(v).replace('.', ',') : String(v);
      });
    } else if (sk.kelompok && kelAwal) {
      draf[sk.kelompok] = kelAwal;
    }
    var gantiNama = m && (tab === 'Karyawan' || tab === 'Alat Suling' || tab === 'Tarif Upah');
    var tombolStatus = '';
    if (m) {
      tombolStatus = '<div class="baris-tombol">' + (m.aktif
        ? '<button class="tombol bahaya" data-aksi="mati">' + (tab === 'Karyawan' ? 'Tandai sudah keluar' : 'Nonaktifkan') + '</button>'
        : '<button class="tombol kedua" data-aksi="hidup">Aktifkan lagi</button>') + '</div>';
    }
    var div = bukaLembar('<h2>' + (m ? 'Ubah ' : 'Tambah ') + esc(sk.judul.toLowerCase()) + '</h2>' +
      (gantiNama ? '<p class="sub">Kalau nama diganti, catatan lama ikut diganti supaya rekap tetap utuh.</p>' : '<p class="sub"></p>') +
      '<form novalidate class="form-induk">' + bidang.map(function (b, i) { return htmlBidang(b, i, draf, 'm'); }).join('') + '</form>' +
      '<div class="baris-tombol"><button class="tombol kedua" data-aksi="batal">Batal</button><button class="tombol utama" data-aksi="simpan">Simpan</button></div>' + tombolStatus);
    var form = q(div, 'form');
    pasangFormDinamis(form);
    segarkanTampilanForm(form);
    div.addEventListener('click', function (ev) {
      var a = ev.target.closest('[data-aksi]');
      if (!a) return;
      if (a.dataset.aksi === 'batal') { div.remove(); return; }
      if (a.dataset.aksi === 'simpan') {
        var h = bacaIsian(bidang, false, 'm', form);
        tandaiSalah(h.salah, form);
        if (h.salah.length) return;
        a.disabled = true; a.textContent = 'Menyimpan…';
        panggil('masterSimpan', {tab: tab, id: m ? m.id : '', nilai: h.nilai}).then(function (r) {
          a.disabled = false; a.textContent = 'Simpan';
          if (!r.ok) { toast(r.galat || 'Gagal menyimpan.', 5000); return; }
          div.remove();
          toast(r.catatanDiganti ? 'Tersimpan. ' + r.catatanDiganti + ' catatan lama ikut diganti.' : 'Tersimpan.');
          if (r.catatanDiganti) { buang('ringkasan'); buangAwalan('terbaru.'); }
          muatKonfig().then(selesai, function () { selesai(); });
        }, function (e) {
          a.disabled = false; a.textContent = 'Simpan';
          toast(e.jaringan ? 'Perlu sinyal untuk menyimpan.' : e.message, 5000);
        });
      }
      if (a.dataset.aksi === 'mati' || a.dataset.aksi === 'hidup') {
        var hidup = a.dataset.aksi === 'hidup';
        var nama = m.nilai[sk.utama];
        if (!hidup && !confirm(tab === 'Karyawan' ? 'Tandai ' + nama + ' sudah keluar hari ini? Namanya tidak muncul lagi di formulir. Catatan lamanya tetap ada.'
          : 'Nonaktifkan ' + nama + '? Tidak muncul lagi di formulir. Catatan lamanya tetap ada.')) return;
        a.disabled = true;
        panggil('masterAktif', {tab: tab, id: m.id, aktif: hidup, tanggalKeluar: hariIni()}).then(function (r) {
          if (!r.ok) { a.disabled = false; toast(r.galat || 'Gagal.'); return; }
          div.remove();
          toast(hidup ? nama + ' aktif lagi.' : nama + ' dinonaktifkan.');
          muatKonfig().then(selesai, function () { selesai(); });
        }, function (e) { a.disabled = false; toast(e.jaringan ? 'Perlu sinyal.' : e.message); });
      }
    });
  }

  // ------------------------------------------------------------ layar: pengguna (pemilik)
  var PERAN_PENGGUNA = ['Pemilik', 'Pencatat', 'Mandor', 'Lainnya'];

  function layarPengguna() {
    if (!pemilik()) { location.hash = '#/kelola'; return; }
    kerangka('Pengguna & sandi', 'Siapa saja yang bisa masuk', '<div id="daftar-pengguna"><div class="memuat">Memuat…</div></div>', {kembali: '#/kelola', tanpaNav: true,
      kanan: '<button class="tombol-ikon" id="tambah-pengguna" aria-label="Tambah pengguna">' + ikon('tambah', 2.4) + '</button>'});
    var daftar = [];
    var tulis = function () {
      var el = document.getElementById('daftar-pengguna');
      if (!el) return;
      el.innerHTML = '<div class="kartu">' + daftar.map(function (p, i) {
        var hak = p.boleh === 'Semua' ? 'semua catatan' : (p.boleh.length ? p.boleh.join(', ') : 'belum ada catatan');
        return '<div class="item-induk"><div class="teks" data-i="' + i + '"><b>' + esc(p.nama) + (p.saya ? ' (Anda)' : '') +
          (p.aktif ? '' : '<span class="lencana-kecil merah">nonaktif</span>') + (p.mengatur && p.peran !== 'Pemilik' ? '<span class="lencana-kecil hijau">mengatur</span>' : '') + '</b>' +
          '<small>' + esc(p.pengguna + ' · ' + p.peran + ' · ' + hak) + '</small>' +
          '<small>' + esc(p.terakhir ? 'Terakhir masuk ' + p.terakhir : 'Belum pernah masuk') + '</small></div>' +
          '<button class="tombol-ikon" style="background:var(--latar);color:var(--teks-2)" data-i="' + i + '" aria-label="Ubah">' + ikon('pensil') + '</button></div>';
      }).join('') + '</div>' +
        '<button class="tombol utama penuh" style="margin-top:12px" id="tambah-bawah">' + ikon('tambah', 2.4) + 'Tambah pengguna</button>' +
        '<p class="redup" style="font-size:.8125rem;margin-top:12px">Setiap orang masuk dengan nama pengguna dan sandinya sendiri. Nama mereka tercatat di kolom "Dicatat oleh". Kalau sandi diganti atau akun dinonaktifkan, HP yang sedang masuk dengan akun itu langsung keluar.</p>';
      document.getElementById('tambah-bawah').addEventListener('click', function () { lembarPengguna(null, muat); });
    };
    var muat = function () {
      panggil('penggunaDaftar').then(function (r) {
        if (!r.ok) throw new Error(r.galat || 'Gagal memuat pengguna.');
        daftar = r.daftar;
        tulis();
      }).catch(function (e) {
        var el = document.getElementById('daftar-pengguna');
        if (el) el.innerHTML = '<div class="galat-kartu">' + esc(e.message) + '</div>';
      });
    };
    document.getElementById('tambah-pengguna').addEventListener('click', function () { lembarPengguna(null, muat); });
    document.getElementById('daftar-pengguna').addEventListener('click', function (ev) {
      var el = ev.target.closest('[data-i]');
      if (el) lembarPengguna(daftar[Number(el.dataset.i)], muat);
    });
    muat();
  }

  function lembarPengguna(p, selesai) {
    var bidang = [{j: 'teks', h: 'Nama', bantuan: 'Nama yang tercatat di kolom "Dicatat oleh".'}];
    if (!p) bidang.push({j: 'teks', h: 'Nama pengguna', polos: true, bantuan: 'Dipakai saat masuk. Huruf kecil tanpa spasi, contoh: sri atau mandor.kepuh'});
    else if (apiBaru()) bidang.push({j: 'teks', h: 'Nama pengguna', polos: true, bantuan: 'Dipakai saat masuk. Kalau diganti, beri tahu orangnya. HP yang sedang masuk tetap masuk.'});
    bidang = bidang.concat([
      {j: 'pilih', h: 'Peran', opsi: PERAN_PENGGUNA, bantuan: 'Pemilik boleh semuanya, termasuk mengatur pengguna dan tampilan.'},
      {j: 'centang', h: 'Boleh mengisi', opsi: URUTAN_TAB, wajib: false, bantuan: 'Catatan yang boleh diisi orang ini.'},
      {j: 'pilih', h: 'Boleh mengatur', opsi: ['Ya', 'Tidak'], bantuan: 'Ya = boleh melihat ringkasan, mengubah atau menghapus catatan, dan mengatur alat, karyawan, tarif.'},
      {j: 'pilih', h: 'Aktif', opsi: ['Ya', 'Tidak']},
      {j: 'sandi', h: 'Sandi', label: p ? 'Sandi baru' : 'Sandi', wajib: !p,
        bantuan: p ? 'Isi hanya kalau mau mengganti sandinya. Minimal 6 huruf atau angka.' : 'Minimal 6 huruf atau angka. Berikan ke orangnya.'},
      {j: 'pilih', h: 'Minta ganti sandi saat masuk', opsi: ['Ya', 'Tidak']}
    ]);
    var draf = p ? {'Nama': p.nama, 'Nama pengguna': p.pengguna, 'Peran': p.peran, 'Boleh mengisi': p.boleh === 'Semua' ? URUTAN_TAB.slice() : p.boleh,
      'Boleh mengatur': p.mengatur ? 'Ya' : 'Tidak', 'Aktif': p.aktif ? 'Ya' : 'Tidak', 'Minta ganti sandi saat masuk': 'Tidak'}
      : {'Peran': 'Pencatat', 'Boleh mengisi': URUTAN_TAB.slice(), 'Boleh mengatur': 'Tidak', 'Aktif': 'Ya', 'Minta ganti sandi saat masuk': 'Tidak'};
    var div = bukaLembar('<h2>' + (p ? 'Ubah ' + esc(p.nama) : 'Tambah pengguna') + '</h2><p class="sub">' + (p ? 'Nama pengguna: ' + esc(p.pengguna) : 'Untuk pencatat, mandor, atau keluarga') + '</p>' +
      '<form novalidate>' + bidang.map(function (b, i) { return htmlBidang(b, i, draf, 'u'); }).join('') + '</form>' +
      '<div class="baris-tombol"><button class="tombol kedua" data-aksi="batal">Batal</button><button class="tombol utama" data-aksi="simpan">Simpan</button></div>');
    var form = q(div, 'form');
    pasangFormDinamis(form);
    div.addEventListener('click', function (ev) {
      var a = ev.target.closest('[data-aksi]');
      if (!a) return;
      if (a.dataset.aksi === 'batal') { div.remove(); return; }
      var h = bacaIsian(bidang, false, 'u', form);
      var n = h.nilai, salah = h.salah;
      if (n['Nama pengguna'] && !POLA_PENGGUNA.test(n['Nama pengguna'].toLowerCase())) salah.push(['Nama pengguna', BANTUAN_PENGGUNA]);
      if (n['Sandi'] && n['Sandi'].length < 6) salah.push(['Sandi', 'Minimal 6 huruf atau angka.']);
      tandaiSalah(salah, form);
      if (salah.length) return;
      var bolehIsi = n['Boleh mengisi'] || [];
      var data = {baru: !p, pengguna: p ? p.pengguna : n['Nama pengguna'].toLowerCase(), nama: n['Nama'], peran: n['Peran'],
        boleh: bolehIsi.length === URUTAN_TAB.length ? 'Semua' : bolehIsi, mengatur: n['Boleh mengatur'] === 'Ya', aktif: n['Aktif'] === 'Ya',
        wajibGanti: n['Minta ganti sandi saat masuk'] === 'Ya'};
      if (n['Sandi']) data.sandiBaru = n['Sandi'];
      var namaBaru = p && n['Nama pengguna'] ? n['Nama pengguna'].toLowerCase() : '';
      if (namaBaru && namaBaru !== p.pengguna) data.penggunaBaru = namaBaru; else namaBaru = '';
      a.disabled = true; a.textContent = 'Menyimpan…';
      panggil('penggunaSimpan', data).then(function (r) {
        a.disabled = false; a.textContent = 'Simpan';
        if (!r.ok) { toast(r.galat || 'Gagal menyimpan.', 5000); return; }
        div.remove();
        toast(!p ? 'Pengguna ditambahkan. Berikan nama pengguna dan sandinya ke orangnya.'
          : namaBaru ? 'Nama pengguna ' + p.nama + ' sekarang "' + namaBaru + '". Beri tahu orangnya.' : 'Pengguna diperbarui.', 5000);
        if (p && p.saya) { if (namaBaru) simpan('penggunaTerakhir', namaBaru); muatKonfig(); }
        selesai();
      }, function (e) {
        a.disabled = false; a.textContent = 'Simpan';
        toast(e.jaringan ? 'Perlu sinyal untuk menyimpan.' : e.message, 5000);
      });
    });
  }

  // ------------------------------------------------------------ layar: batas peringatan (pemilik)
  var ATURAN_BATAS = [
    {k: 'alatKosong', judul: 'Alat suling tidak jalan', ket: 'Muncul kalau satu alat tidak nyuling sebanyak ini dalam seminggu.',
      isian: [{f: 'hari', label: 'Kosong minimal', satuan: 'hari', jenis: 'bulat'}]},
    {k: 'cocokAbsensi', judul: 'Absensi suling tidak cocok dengan produksi',
      ket: 'Operator tercatat nyuling di Produksi tapi belum diabsen, atau jumlah sulingannya beda.'},
    {k: 'upahSuling', judul: 'Upah per sulingan belum diisi', ket: 'Penyuling yang belum punya upah per sulingan di Kelola > Karyawan.'},
    {k: 'belumLunas', judul: 'Penjualan belum lunas', ket: 'Muncul kalau total yang belum dibayar mencapai batas ini.',
      isian: [{f: 'minimal', label: 'Mulai dari', satuan: 'Rp', jenis: 'rupiah'},
        {f: 'lewatHari', label: 'Hanya yang sudah lewat', satuan: 'hari', jenis: 'bulat', bantuan: 'Isi 0 supaya semua penjualan belum lunas dihitung.'}]},
    {k: 'minyakTurun', judul: 'Minyak per sulingan turun', ket: 'Dibanding rata-rata 4 minggu sebelumnya.',
      isian: [{f: 'persen', label: 'Turun lebih dari', satuan: '%', jenis: 'bulat'}]},
    {k: 'hargaNaik', judul: 'Harga bahan naik', ket: 'Dibanding harga bahan per kg minggu lalu, atau di atas harga tertentu.',
      isian: [{f: 'persen', label: 'Naik lebih dari', satuan: '%', jenis: 'bulat'},
        {f: 'maksimal', label: 'Atau di atas', satuan: 'Rp/kg', jenis: 'rupiah', bantuan: 'Isi 0 kalau tidak dipakai.'}]},
    {k: 'stokMinus', judul: 'Stok minus', ket: 'Biasanya karena ada saring yang belum dicatat.'},
    {k: 'stokRendah', judul: 'Stok minyak menipis', ket: 'Untuk produk dengan satuan kg.',
      isian: [{f: 'kg', label: 'Di bawah', satuan: 'kg', jenis: 'desimal'}]}
  ];
  var BATAS_BAWAAN = {alatKosong: {aktif: true, hari: 2}, cocokAbsensi: {aktif: true}, upahSuling: {aktif: true},
    belumLunas: {aktif: true, minimal: 1, lewatHari: 0}, minyakTurun: {aktif: true, persen: 15},
    hargaNaik: {aktif: true, persen: 15, maksimal: 0}, stokMinus: {aktif: true}, stokRendah: {aktif: false, kg: 5}};

  function layarBatas() {
    if (!pemilik()) { location.hash = '#/kelola'; return; }
    var baru = !!(konfig && konfig.versiApi >= 6 && konfig.pengaturan && konfig.pengaturan.batas);
    var batas = salin(baru ? konfig.pengaturan.batas : BATAS_BAWAAN);
    var tulis = function () {
      var html = (baru ? '' : '<div class="pratinjau awas">Pengaturan ini butuh Apps Script versi baru. Tempel ulang kode.gs terbaru di Apps Script, lalu Terapkan > Kelola deployment > Versi baru.</div>') +
        '<p class="sub" style="margin:0 0 12px;color:var(--teks-2);font-size:.8125rem">Atur kapan peringatan muncul di Ringkasan. Matikan yang tidak perlu supaya peringatan yang penting tidak tenggelam.</p>' +
        ATURAN_BATAS.map(function (a) {
          var b = batas[a.k], nyala = b.aktif !== false;
          return '<div class="kartu kartu-batas' + (nyala ? '' : ' mati') + '" data-k="' + a.k + '"><div class="kepala-batas"><div><h2>' + esc(a.judul) + '</h2>' +
            (a.ket ? '<p class="sub">' + esc(a.ket) + '</p>' : '') + '</div>' +
            '<button type="button" class="saklar' + (nyala ? ' nyala' : '') + '" data-saklar="' + a.k + '">' + (nyala ? 'Aktif' : 'Mati') + '</button></div>' +
            (a.isian || []).map(function (x) {
              var v = b[x.f];
              var tampil = x.jenis === 'desimal' ? String(v).replace('.', ',') : String(v);
              return '<div class="isian-batas"><label for="bt-' + a.k + '-' + x.f + '">' + esc(x.label) + '</label>' +
                '<div class="masukan-satuan"><input class="masukan" id="bt-' + a.k + '-' + x.f + '" data-k="' + a.k + '" data-f="' + x.f + '" data-jenis="' + x.jenis + '"' +
                ' inputmode="' + (x.jenis === 'desimal' ? 'decimal' : 'numeric') + '" value="' + esc(tampil) + '"' + (nyala ? '' : ' disabled') + '><span>' + esc(x.satuan) + '</span></div>' +
                (x.bantuan ? '<div class="bantuan">' + esc(x.bantuan) + '</div>' : '') + '</div>';
            }).join('') + '</div>';
        }).join('');
      kerangka('Batas peringatan', 'Untuk Ringkasan dan tab Ringkasan di Sheet', html, {kembali: '#/kelola', tanpaNav: true});
      app.insertAdjacentHTML('beforeend', '<div class="aksi-bawah"><button class="tombol kedua" id="batas-bawaan" type="button">Kembalikan bawaan</button>' +
        '<button class="tombol utama" id="batas-simpan" type="button"' + (baru ? '' : ' disabled') + '>Simpan</button></div>');
      document.getElementById('batas-bawaan').addEventListener('click', function () {
        if (!confirm('Kembalikan semua batas peringatan ke bawaan? Belum tersimpan sampai menekan Simpan.')) return;
        batas = salin(BATAS_BAWAAN); tulis();
      });
      document.getElementById('batas-simpan').addEventListener('click', simpanBatas);
      app.querySelector('.isi').addEventListener('click', function (ev) {
        var t = ev.target.closest('[data-saklar]');
        if (!t) return;
        bacaIsianBatas();
        var b = batas[t.dataset.saklar];
        b.aktif = b.aktif === false;
        var y = window.scrollY;
        tulis();
        window.scrollTo(0, y);
      });
    };
    var bacaIsianBatas = function () {
      var salah = '';
      qa(app, 'input[data-f]').forEach(function (el) {
        var v = el.dataset.jenis === 'desimal' ? angkaDesimal(el.value) : angkaBulat(el.value);
        if (isNaN(v)) { if (!salah) salah = 'Isi angka di "' + el.closest('.isian-batas').querySelector('label').textContent + '".'; return; }
        batas[el.dataset.k][el.dataset.f] = v;
      });
      return salah;
    };
    var simpanBatas = function () {
      var salah = bacaIsianBatas();
      if (salah) { toast(salah, 4000); return; }
      var tombol = document.getElementById('batas-simpan');
      tombol.disabled = true; tombol.textContent = 'Menyimpan…';
      panggil('pengaturanSimpan', {batas: batas}).then(function (r) {
        tombol.disabled = false; tombol.textContent = 'Simpan';
        if (!r.ok) { toast(r.galat || 'Gagal menyimpan.', 5000); return; }
        konfig.pengaturan.batas = r.batas || batas; simpan('konfig', konfig);
        buang('ringkasan');
        toast('Batas peringatan disimpan.');
        location.hash = '#/ringkasan';
      }, function (e) {
        tombol.disabled = false; tombol.textContent = 'Simpan';
        toast(e.jaringan ? 'Perlu sinyal untuk menyimpan.' : e.message, 5000);
      });
    };
    tulis();
  }

  // ------------------------------------------------------------ layar: tampilan & tata letak
  function pilihanChip(nama, opsi, nilai, judul, bantuan) {
    return '<div class="bidang"><span class="label">' + esc(judul) + '</span>' + (bantuan ? '<div class="bantuan">' + esc(bantuan) + '</div>' : '') +
      '<div class="chips">' + opsi.map(function (o) {
        return '<label class="chip"><input type="radio" name="' + nama + '" value="' + esc(o[0]) + '"' + (String(nilai) === String(o[0]) ? ' checked' : '') + '><span>' + esc(o[1]) + '</span></label>';
      }).join('') + '</div></div>';
  }

  function layarTampilan(pertahankanGulir) {
    var pusat = pemilik();
    if (pusat && !drafTampilan) drafTampilan = tampilanPusat();
    terapkanTampilan();
    var t = pusat ? drafTampilan : tampilanPusat();
    var hp = tampilanHp();
    var formAktif = ambil('formTampilan', 'ambil');
    if (!tabDariKunci(formAktif)) formAktif = 'ambil';
    var html = '<div class="kartu"><h2>Hanya di HP ini</h2><p class="sub">Untuk kenyamanan membaca di HP ini saja.</p>' +
      pilihanChip('hp-huruf', [['', 'Ikuti pusat'], ['kecil', 'Kecil'], ['normal', 'Normal'], ['besar', 'Besar'], ['sangat-besar', 'Sangat besar']], hp.huruf, 'Ukuran huruf') +
      pilihanChip('hp-mode', [['', 'Ikuti pusat'], ['terang', 'Terang'], ['gelap', 'Gelap'], ['otomatis', 'Ikuti HP']], hp.mode, 'Mode warna') + '</div>';
    if (pusat) {
      var presetAktif = PRESET.filter(function (p) { return p.k === t.warna; })[0];
      html += '<div class="judul-bagian">Untuk semua pengguna</div>' +
        '<div class="kartu"><h2>Warna</h2><p class="sub">Warna kepala dan tombol. Langsung terlihat sebagai contoh.</p>' +
        '<div class="contoh-tampilan"><div class="ck">' + esc(NAMA_APP) + '</div><div class="ci"><span class="tombol utama" style="min-height:2.5rem;padding:.375rem .875rem">Simpan</span>' +
        '<label class="chip"><input type="radio" checked disabled><span>Terpilih</span></label><label class="chip"><input type="radio" disabled><span>Pilihan</span></label></div></div>' +
        '<div class="swatch-grid" style="margin-top:12px">' + PRESET.map(function (p) {
          return '<button type="button" class="swatch' + (presetAktif && presetAktif.k === p.k ? ' aktif' : '') + '" data-preset="' + p.k + '"><span class="warna"><i style="background:' + p.kepala + '"></i><i style="background:' + p.aksen + '"></i></span>' + esc(p.nama) + '</button>';
        }).join('') + '</div>' +
        '<div class="warna-sendiri"><label>Warna kepala<input type="color" id="warna-kepala" value="' + esc(t.kepala) + '"></label>' +
        '<label>Warna tombol<input type="color" id="warna-aksen" value="' + esc(t.aksen) + '"></label></div></div>' +

        '<div class="kartu"><h2>Bentuk & ukuran</h2><p class="sub">Bawaan untuk semua HP.</p>' +
        pilihanChip('t-mode', [['otomatis', 'Ikuti HP'], ['terang', 'Terang'], ['gelap', 'Gelap']], t.mode, 'Mode warna') +
        pilihanChip('t-huruf', [['kecil', 'Kecil'], ['normal', 'Normal'], ['besar', 'Besar'], ['sangat-besar', 'Sangat besar']], t.huruf, 'Ukuran huruf') +
        pilihanChip('t-sudut', [['bulat', 'Bulat'], ['sedang', 'Sedikit bulat'], ['kotak', 'Kotak']], t.sudut, 'Sudut kotak dan tombol') +
        pilihanChip('t-kepadatan', [['lega', 'Lega'], ['rapat', 'Rapat']], t.kepadatan, 'Jarak antar isian', 'Rapat = lebih banyak isian terlihat dalam satu layar.') +
        pilihanChip('t-logo', [['ya', 'Tampil'], ['tidak', 'Sembunyi']], t.logo === false ? 'tidak' : 'ya', 'Logo di kepala') + '</div>' +

        '<div class="kartu"><h2>Beranda</h2><p class="sub">Susunan halaman pertama.</p>' +
        pilihanChip('t-beranda', [['1', 'Daftar'], ['2', 'Kotak 2 kolom'], ['3', 'Kotak 3 kolom']], t.beranda, 'Tata letak menu catatan') +
        pilihanChip('t-ringkas', [['ya', 'Tampil'], ['tidak', 'Sembunyi']], t.ringkas === false ? 'tidak' : 'ya', 'Ringkasan minggu di beranda', 'Hanya terlihat oleh pengguna yang boleh mengatur.') +
        '<div class="bidang"><span class="label">Angka di ringkasan beranda</span><div class="chips">' + URUT_ANGKA.map(function (k) {
          return '<label class="chip"><input type="checkbox" name="t-angka" value="' + k + '"' + ((t.ringkasAngka || []).indexOf(k) >= 0 ? ' checked' : '') + '><span>' + esc(ANGKA[k].l) + '</span></label>';
        }).join('') + '</div></div>' +
        pilihanChip('t-upah', [['ya', 'Tampil'], ['tidak', 'Sembunyi']], t.upahBeranda === false ? 'tidak' : 'ya', 'Upah per orang di beranda') +
        pilihanChip('t-stok', [['semua', 'Semua pengguna'], ['admin', 'Hanya yang boleh mengatur'], ['sembunyi', 'Sembunyi']], t.stokBeranda || 'semua',
          'Stok di beranda', 'Stok tetap terlihat di Ringkasan untuk yang boleh mengatur.') + '</div>' +

        '<div class="kartu"><h2>Menu catatan</h2><p class="sub">Urutan, nama, dan menu yang tampil di beranda. Menu yang disembunyikan tidak muncul untuk semua pengguna.</p>' +
        menuTerurut(t).map(function (m, i, arr) {
          return '<div class="baris-atur"><div class="tombol-urut"><button data-menu-naik="' + i + '"' + (i === 0 ? ' disabled' : '') + ' aria-label="Naikkan">' + ikon('naik', 2.4) + '</button>' +
            '<button data-menu-turun="' + i + '"' + (i === arr.length - 1 ? ' disabled' : '') + ' aria-label="Turunkan">' + ikon('turun', 2.4) + '</button></div>' +
            '<div class="nama"><input class="masukan nama-menu" data-k="' + m.k + '" value="' + esc(m.label) + '" aria-label="Nama menu ' + esc(m.tab) + '">' +
            (m.label !== m.tab ? '<small>Nama asli: ' + esc(m.tab) + '</small>' : '') + '</div>' +
            '<button type="button" class="saklar' + (m.tampil ? ' nyala' : '') + '" data-menu-saklar="' + m.k + '">' + (m.tampil ? 'Tampil' : 'Sembunyi') + '</button></div>';
        }).join('') + '</div>' +

        '<div class="kartu"><h2>Tata letak formulir</h2><p class="sub">Urutan isian dan isian yang boleh disembunyikan. Isian wajib selalu tampil.</p>' +
        '<div class="pilih-tab">' + URUTAN_TAB.map(function (tab) {
          return '<button type="button" data-form="' + FORM[tab].kunci + '" class="' + (FORM[tab].kunci === formAktif ? 'aktif' : '') + '">' + esc(labelTab(tab, t)) + '</button>';
        }).join('') + '</div>' +
        bidangUrut(tabDariKunci(formAktif), t).map(function (x, i, arr) {
          var b = x.b, wajib = b.wajib !== false;
          return '<div class="baris-atur"><div class="tombol-urut"><button data-bidang-naik="' + i + '"' + (i === 0 ? ' disabled' : '') + ' aria-label="Naikkan">' + ikon('naik', 2.4) + '</button>' +
            '<button data-bidang-turun="' + i + '"' + (i === arr.length - 1 ? ' disabled' : '') + ' aria-label="Turunkan">' + ikon('turun', 2.4) + '</button></div>' +
            '<div class="nama">' + esc(b.label || b.h) + (wajib ? '<small>wajib diisi</small>' : '') + '</div>' +
            '<button type="button" class="saklar' + (x.tampil ? ' nyala' : '') + '" data-bidang-saklar="' + esc(kunciB(b)) + '"' + (wajib ? ' disabled' : '') + '>' + (x.tampil ? 'Tampil' : 'Sembunyi') + '</button></div>';
        }).join('') + '</div>';
    } else {
      html += '<p class="redup" style="font-size:.8125rem;margin-top:12px">Warna dan tata letak untuk semua pengguna diatur oleh pemilik.</p>';
    }
    var y = pertahankanGulir ? window.scrollY : 0;
    kerangka('Tampilan', pusat ? 'Warna, ukuran, dan tata letak' : 'Ukuran huruf dan mode warna', html, {kembali: pusat ? '#/kelola' : '#/akun', tanpaNav: true});
    window.scrollTo(0, y);
    var berubah = pusat && JSON.stringify(drafTampilan) !== JSON.stringify(tampilanPusat());
    if (pusat) {
      app.insertAdjacentHTML('beforeend', '<div class="aksi-bawah"><button class="tombol kedua" id="tampilan-bawaan" type="button">Kembalikan bawaan</button>' +
        '<button class="tombol utama" id="tampilan-simpan" type="button"' + (berubah ? '' : ' disabled') + '>' + (berubah ? 'Simpan untuk semua' : 'Tersimpan') + '</button></div>');
    }
    var isi = app.querySelector('.isi');
    var ulang = function () { terapkanTampilan(); layarTampilan(true); };
    var t2 = drafTampilan;
    isi.addEventListener('change', function (ev) {
      var el = ev.target, nama = el.name;
      if (nama === 'hp-huruf' || nama === 'hp-mode') {
        var h = tampilanHp(); h[nama === 'hp-huruf' ? 'huruf' : 'mode'] = el.value; simpan('tampilanHp', h); ulang(); return;
      }
      if (!pusat) return;
      if (nama === 't-mode') t2.mode = el.value;
      else if (nama === 't-huruf') t2.huruf = el.value;
      else if (nama === 't-sudut') t2.sudut = el.value;
      else if (nama === 't-kepadatan') t2.kepadatan = el.value;
      else if (nama === 't-logo') t2.logo = el.value === 'ya';
      else if (nama === 't-beranda') t2.beranda = Number(el.value);
      else if (nama === 't-ringkas') t2.ringkas = el.value === 'ya';
      else if (nama === 't-upah') t2.upahBeranda = el.value === 'ya';
      else if (nama === 't-stok') t2.stokBeranda = el.value;
      else if (nama === 't-angka') t2.ringkasAngka = nilaiCentang(isi, 't-angka');
      else if (el.classList.contains('nama-menu')) {
        t2.namaMenu = t2.namaMenu || {};
        var v = el.value.trim();
        if (!v || v === tabDariKunci(el.dataset.k)) delete t2.namaMenu[el.dataset.k]; else t2.namaMenu[el.dataset.k] = v.slice(0, 40);
      } else if (el.id === 'warna-kepala' || el.id === 'warna-aksen') {
        t2[el.id === 'warna-kepala' ? 'kepala' : 'aksen'] = el.value; t2.warna = 'sendiri';
      } else return;
      ulang();
    });
    isi.addEventListener('input', function (ev) {
      if (!pusat || (ev.target.id !== 'warna-kepala' && ev.target.id !== 'warna-aksen')) return;
      t2[ev.target.id === 'warna-kepala' ? 'kepala' : 'aksen'] = ev.target.value; t2.warna = 'sendiri';
      terapkanTampilan();
    });
    isi.addEventListener('click', function (ev) {
      if (!pusat) return;
      var el;
      if ((el = ev.target.closest('[data-preset]'))) {
        var p = PRESET.filter(function (x) { return x.k === el.dataset.preset; })[0];
        t2.warna = p.k; t2.kepala = p.kepala; t2.aksen = p.aksen; ulang(); return;
      }
      var menu = menuTerurut(t2);
      if ((el = ev.target.closest('[data-menu-naik],[data-menu-turun]'))) {
        var i = Number(el.dataset.menuNaik !== undefined ? el.dataset.menuNaik : el.dataset.menuTurun);
        var j = el.dataset.menuNaik !== undefined ? i - 1 : i + 1;
        var tmp = menu[i]; menu[i] = menu[j]; menu[j] = tmp;
        t2.menu = menu.map(function (m) { return {k: m.k, tampil: m.tampil}; }); ulang(); return;
      }
      if ((el = ev.target.closest('[data-menu-saklar]'))) {
        t2.menu = menu.map(function (m) { return {k: m.k, tampil: m.k === el.dataset.menuSaklar ? !m.tampil : m.tampil}; }); ulang(); return;
      }
      if ((el = ev.target.closest('[data-form]'))) { simpan('formTampilan', el.dataset.form); ulang(); return; }
      var tab = tabDariKunci(formAktif);
      var urut = bidangUrut(tab, t2);
      var f = (t2.form = t2.form || {})[formAktif] = t2.form[formAktif] || {urutan: [], sembunyi: []};
      if ((el = ev.target.closest('[data-bidang-naik],[data-bidang-turun]'))) {
        var a = Number(el.dataset.bidangNaik !== undefined ? el.dataset.bidangNaik : el.dataset.bidangTurun);
        var c = el.dataset.bidangNaik !== undefined ? a - 1 : a + 1;
        var s = urut[a]; urut[a] = urut[c]; urut[c] = s;
        f.urutan = urut.map(function (x) { return kunciB(x.b); }); ulang(); return;
      }
      if ((el = ev.target.closest('[data-bidang-saklar]'))) {
        var kb = el.dataset.bidangSaklar;
        f.sembunyi = f.sembunyi || [];
        var ix = f.sembunyi.indexOf(kb);
        if (ix >= 0) f.sembunyi.splice(ix, 1); else f.sembunyi.push(kb);
        ulang();
      }
    });
    if (!pusat) return;
    document.getElementById('tampilan-bawaan').addEventListener('click', function () {
      if (!confirm('Kembalikan warna, ukuran, urutan menu, dan tata letak formulir ke bawaan? Belum tersimpan sampai menekan Simpan.')) return;
      drafTampilan = salin(TAMPILAN_BAWAAN); ulang();
    });
    document.getElementById('tampilan-simpan').addEventListener('click', function () {
      var tombol = this;
      tombol.disabled = true; tombol.textContent = 'Menyimpan…';
      var data = salin(drafTampilan);
      panggil('tampilanSimpan', {tampilan: data}).then(function (r) {
        if (!r.ok) { tombol.disabled = false; tombol.textContent = 'Simpan untuk semua'; toast(r.galat || 'Gagal menyimpan.'); return; }
        konfig.tampilan = data; simpan('konfig', konfig);
        toast('Tampilan disimpan. HP lain ikut berubah saat aplikasinya dibuka.', 4000);
        if (location.hash === '#/tampilan') ulang();
      }, function (e) {
        tombol.disabled = false; tombol.textContent = 'Simpan untuk semua';
        toast(e.jaringan ? 'Perlu sinyal untuk menyimpan.' : e.message);
      });
    });
  }

  // ------------------------------------------------------------ router
  function tampilkan() {
    var tirai = document.querySelector('.tirai'); if (tirai) tirai.remove();
    var h = location.hash || '#/';
    var bagian = h.replace(/^#\/?/, '').split('/');
    if (bagian[0] !== 'tampilan') drafTampilan = null;
    terapkanTampilan();
    if (!sesi) { layarMasuk(); return; }
    if (akses().wajibGanti && bagian[0] !== 'sandi') { location.hash = '#/sandi'; return; }
    switch (bagian[0]) {
      case 'isi': layarIsi(bagian[1]); break;
      case 'ubah':
        if (sedangDiubah && admin()) layarIsi(bagian[1], sedangDiubah); else location.hash = '#/terbaru/' + (bagian[1] || '');
        break;
      case 'terbaru': layarTerbaru(bagian[1]); break;
      case 'ringkasan': layarRingkasan(); break;
      case 'antrian': layarAntrian(); break;
      case 'akun': layarAkun(); break;
      case 'sandi': layarSandi(); break;
      case 'namapengguna': layarNamaPengguna(); break;
      case 'kelola': if (bagian[1]) layarMaster(bagian[1]); else layarKelola(); break;
      case 'pengguna': layarPengguna(); break;
      case 'tampilan': layarTampilan(); break;
      case 'batas': layarBatas(); break;
      default: layarBeranda();
    }
  }

  document.addEventListener('click', function (ev) {
    var el = ev.target.closest('[data-ke]');
    if (el) { ev.preventDefault(); location.hash = el.dataset.ke; return; }
    if (ev.target.closest('[data-opname]')) { lembarOpname(); return; }
    var r = ev.target.closest('[data-rinci]');
    if (r) { bukaRincian(r.dataset.rinci, r.dataset.per); return; }
    var g = ev.target.closest('[data-gaji]');
    if (g) { bukaGaji(g.dataset.gaji, g.dataset.per); return; }
    var st = ev.target.closest('[data-stok-rinci]');
    if (st) bukaRincianStok(st.dataset.stokRinci);
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Enter') return;
    var el = ev.target.closest && ev.target.closest('[data-rinci],[data-stok-rinci]');
    if (el && el === ev.target) el.click();
  });
  window.addEventListener('hashchange', tampilkan);
  window.addEventListener('online', function () { perbaruiStatus(); kirimAntrian(); });
  window.addEventListener('offline', perbaruiStatus);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) kirimAntrian(); });
  setInterval(function () { if (antrian.length) kirimAntrian(); }, 30000);
  // Stok di layar diperbarui sendiri setiap menit selama aplikasi terbuka (mengikuti catatan dari HP lain).
  setInterval(function () {
    if (document.hidden || !navigator.onLine || !sesi) return;
    var h = location.hash || '#/';
    if ((h === '#/' || h === '#/ringkasan') && document.getElementById('kotak-stok')) muatStok();
  }, 60000);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && sesi && document.getElementById('kotak-stok')) muatStok();
  });
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); promptPasang = e; });

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(function () { /* tetap jalan tanpa offline */ });
  }

  tampilkan();
  if (sesi) {
    muatKonfig().then(function () {
      var h = location.hash;
      if (!h || h === '#/' || (h.indexOf('#/isi/') === 0 && !document.getElementById('formulir'))) tampilkan();
    }, function () { /* pakai data tersimpan */ });
    kirimAntrian();
  }

  // Untuk pengujian otomatis.
  window.__kepuh = {susunProduksi: susunProduksi, susunAbsensi: susunAbsensi, angkaDesimal: angkaDesimal, campur: campur, teksDi: teksDi};
})();
