// Uji kode.gs dengan Google Sheet tiruan. Jalankan: node tes/api_test.js
const assert = require('assert');
const { muatKode, formatTanggal } = require('./tiruan_gas');

const hariIni = formatTanggal(new Date(), 'yyyy-MM-dd');
const geser = (k, n) => new Date(Date.UTC(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10)) + n * 864e5).toISOString().slice(0, 10);
const hariKe = (k) => new Date(k + 'T00:00:00Z').getUTCDay();
const senin = geser(hariIni, -((hariKe(hariIni) - 1 + 7) % 7));   // awal minggu ini

let lulus = 0;
function uji(nama, f) { f(); lulus++; console.log('  ✓ ' + nama); }

const { ctx, ss, props, pemicu, panggil } = muatKode();
const tab = n => ss.getSheetByName(n);
const objek = n => { const sh = tab(n); const k = sh.data[0]; return sh.data.slice(1).filter(r => r.some(v => v !== '' && v !== undefined)).map(r => Object.fromEntries(k.map((h, j) => [h, r[j] === undefined ? '' : r[j]]))); };

console.log('Penyiapan sheet');
let sandiAwal;
uji('siapkanSheet membuat semua tab dan akun pemilik', () => {
  const pesan = ctx.siapkanSheet();
  ['Ringkasan', 'Ambil Bahan', 'Produksi Suling', 'Saring Minyak', 'Absensi', 'Penjualan', 'Kas', 'Rekap Mingguan', 'Rekap Bulanan',
    'Upah Mingguan', 'Rekap Alat', 'Alat Suling', 'Karyawan', 'Tarif Upah', 'Pilihan', 'Produk', 'Kategori Kas', 'Pengguna', 'Pengaturan']
    .forEach(n => assert.ok(tab(n), 'tab ' + n));
  assert.ok(!tab('Sheet1'), 'tab bawaan dibuang');
  assert.strictEqual(ss.sheets[0].nama, 'Ringkasan');
  assert.strictEqual(objek('Alat Suling').length, 4);
  assert.strictEqual(objek('Pengguna').length, 1);
  sandiAwal = /Sandi sementara: (\w+)/.exec(pesan)[1];
  assert.ok(objek('Pengaturan').find(r => r.Pengaturan === 'Sandi sementara pemilik').Nilai.includes(sandiAwal));
  assert.deepStrictEqual(pemicu, ['perbaruiLaporanTerjadwal']);
});
uji('siapkanSheet aman dijalankan dua kali', () => {
  const pesan = ctx.siapkanSheet();
  assert.ok(/Semua tab sudah ada/.test(pesan));
  assert.strictEqual(objek('Alat Suling').length, 4);
  assert.strictEqual(objek('Pengguna').length, 1);
  assert.strictEqual(pemicu.length, 1);
});

console.log('Masuk & sandi');
let token;
uji('sandi salah ditolak', () => {
  const r = panggil({ aksi: 'masuk', pengguna: 'wildan', sandi: 'salah' });
  assert.strictEqual(r.ok, false); assert.strictEqual(r.kode, 'SALAH');
});
uji('masuk dengan sandi sementara wajib ganti sandi', () => {
  const r = panggil({ aksi: 'masuk', pengguna: 'Wildan ', sandi: sandiAwal });
  assert.ok(r.ok, JSON.stringify(r)); assert.ok(r.akses.wajibGanti); assert.ok(r.akses.pemilik);
  token = r.token;
  const s = panggil({ aksi: 'simpan', token, tab: 'Kas', nilai: { Tanggal: hariIni } });
  assert.strictEqual(s.kode, 'GANTI');
  assert.ok(panggil({ aksi: 'config', token }).ok, 'config tetap boleh');
});
uji('ganti sandi memberi sesi baru dan menghapus sandi sementara', () => {
  assert.strictEqual(panggil({ aksi: 'sandiUbah', token, sandiLama: 'x', sandiBaru: 'rahasia1' }).ok, false);
  assert.strictEqual(panggil({ aksi: 'sandiUbah', token, sandiLama: sandiAwal, sandiBaru: '123' }).ok, false);
  const r = panggil({ aksi: 'sandiUbah', token, sandiLama: sandiAwal, sandiBaru: 'rahasia1' });
  assert.ok(r.ok, JSON.stringify(r));
  assert.strictEqual(panggil({ aksi: 'config', token }).kode, 'SESI', 'token lama mati');
  token = r.token;
  assert.ok(panggil({ aksi: 'config', token }).ok);
  assert.strictEqual(objek('Pengaturan').find(x => x.Pengaturan === 'Sandi sementara pemilik').Nilai, '');
  assert.ok(panggil({ aksi: 'masuk', pengguna: 'wildan', sandi: 'rahasia1' }).ok);
});
uji('terlalu banyak sandi salah mengunci sementara', () => {
  for (let i = 0; i < 5; i++) panggil({ aksi: 'masuk', pengguna: 'tamu', sandi: 'x' });
  assert.strictEqual(panggil({ aksi: 'masuk', pengguna: 'tamu', sandi: 'x' }).kode, 'KUNCI');
});

console.log('Data induk');
const tambah = (t, nilai) => { const r = panggil({ aksi: 'masterSimpan', token, tab: t, nilai }); assert.ok(r.ok, JSON.stringify(r)); return r.id; };
const KAR = [['Eko', 'Penyuling'], ['Gatot', 'Penyuling'], ['Sarno', 'Penyuling'], ['Yanto', 'Penyuling'], ['Rofik', 'Pengumpul'], ['Pak Muh', 'Pengumpul'], ['Dedi', 'Cadangan']];
const idKar = {};
uji('tambah karyawan, alat, dan tarif', () => {
  KAR.forEach(([n, p]) => { idKar[n] = tambah('Karyawan', { Nama: n, Peran: p, 'Tanggal masuk': '2026-01-05' }); });
  const r = panggil({ aksi: 'masterSimpan', token, tab: 'Karyawan', nilai: { Nama: 'eko', Peran: 'Penyuling' } });
  assert.strictEqual(r.ok, false, 'nama kembar ditolak');
  assert.strictEqual(panggil({ aksi: 'masterSimpan', token, tab: 'Karyawan', nilai: { Nama: 'Budi' } }).ok, false, 'peran wajib');
  const cfg = panggil({ aksi: 'config', token });
  const alat = cfg.master['Alat Suling'];
  ['Eko', 'Gatot', 'Sarno', 'Yanto'].forEach((op, i) => {
    const r2 = panggil({ aksi: 'masterSimpan', token, tab: 'Alat Suling', id: alat[i].id,
      nilai: Object.assign({}, alat[i].nilai, { 'Operator tetap': op, 'Upah per sulingan (Rp)': i === 3 ? 100000 : 90000 }) });
    assert.ok(r2.ok, JSON.stringify(r2));
  });
  assert.strictEqual(cfg.master.Karyawan.length, 7);
  assert.ok(cfg.skema && cfg.skema.Karyawan.kolom.length, 'skema terkirim ke admin');
  assert.strictEqual(objek('Karyawan')[0]['Tanggal masuk'] instanceof Date, true);
});
uji('alat suling bisa ditambah dan dikurangi', () => {
  const id5 = tambah('Alat Suling', { 'Nama alat': 'Alat 5', 'Upah per sulingan (Rp)': 90000 });
  let cfg = panggil({ aksi: 'config', token });
  assert.strictEqual(cfg.master['Alat Suling'].filter(a => a.aktif).length, 5);
  assert.ok(panggil({ aksi: 'masterAktif', token, tab: 'Alat Suling', id: id5, aktif: false }).ok);
  cfg = panggil({ aksi: 'config', token });
  assert.strictEqual(cfg.master['Alat Suling'].filter(a => a.aktif).length, 4);
  assert.strictEqual(cfg.master['Alat Suling'].length, 5, 'admin tetap melihat yang tidak aktif');
});
uji('urutan data induk bisa diatur', () => {
  const cfg = panggil({ aksi: 'config', token });
  const ids = cfg.master['Tarif Upah'].map(t => t.id).reverse();
  assert.ok(panggil({ aksi: 'masterUrut', token, tab: 'Tarif Upah', ids }).ok);
  const cfg2 = panggil({ aksi: 'config', token });
  assert.deepStrictEqual(cfg2.master['Tarif Upah'].map(t => t.id), ids);
});
uji('pilihan per daftar boleh kembar antar daftar', () => {
  tambah('Pilihan', { Daftar: 'Daerah', Pilihan: 'Kepuh' });
  tambah('Pilihan', { Daftar: 'Pembeli', Pilihan: 'Kepuh' });
  assert.strictEqual(panggil({ aksi: 'masterSimpan', token, tab: 'Pilihan', nilai: { Daftar: 'Daerah', Pilihan: 'kepuh' } }).ok, false);
});

console.log('Pencatatan');
const kirim = (t, nilai, baris, id) => panggil({ aksi: 'simpan', token, tab: t, id: id || ('id' + Math.random()).slice(0, 16), nilai, baris });
uji('ambil bahan menghitung uang beli dan harga per kg', () => {
  const r = kirim('Ambil Bahan', { Tanggal: senin, Pengumpul: ['Rofik', 'Pak Muh'], Daerah: ['Kepuh'], 'Kondisi bahan': 'Segar semua',
    'Berat bahan (kg)': 1000, 'Uang dibawa (Rp)': 1000000, 'Uang sisa (Rp)': 150000, 'Biaya lain di jalan (Rp)': 50000 }, null, 'AMBIL1');
  assert.ok(r.ok, JSON.stringify(r));
  const o = objek('Ambil Bahan')[0];
  assert.strictEqual(o['Uang beli bahan (Rp)'], 800000);
  assert.strictEqual(o['Harga bahan per kg (Rp)'], 800);
  assert.strictEqual(o['Pengumpul'], 'Rofik, Pak Muh');
  assert.strictEqual(o['Dicatat oleh'], 'Mas Wildan');
  assert.ok(o['Tanggal'] instanceof Date);
  assert.ok(kirim('Ambil Bahan', { Tanggal: senin }, null, 'AMBIL1').dobel, 'id sama tidak dobel');
  assert.strictEqual(objek('Ambil Bahan').length, 1);
});
uji('kolom asing ditolak', () => {
  const r = kirim('Kas', { Tanggal: hariIni, Kategori: 'Kayu bakar', 'Jumlah (Rp)': 1, Ngawur: 'x' });
  assert.strictEqual(r.ok, false);
});
uji('produksi suling: satu baris per alat dengan upah borongan', () => {
  const r = kirim('Produksi Suling', { Tanggal: senin, Keterangan: '' }, [
    { 'Alat suling': 'Alat 1', Operator: 'Eko', 'Jumlah sulingan': 2, 'Kondisi alat': 'Normal' },
    { 'Alat suling': 'Alat 2', Operator: 'Gatot', 'Jumlah sulingan': 1, 'Kondisi alat': 'Normal' },
    { 'Alat suling': 'Alat 3', Operator: '', 'Jumlah sulingan': 0, 'Kondisi alat': 'Ketel bocor' },
    { 'Alat suling': 'Alat 4', Operator: 'Yanto', 'Jumlah sulingan': 2, 'Kondisi alat': 'Normal' }], 'SULING1');
  assert.ok(r.ok, JSON.stringify(r));
  const rows = objek('Produksi Suling');
  assert.strictEqual(rows.length, 4);
  assert.strictEqual(rows[0]['Upah (Rp)'], 180000);
  assert.strictEqual(rows[3]['Upah (Rp)'], 200000);
  assert.strictEqual(rows[0]['ID'], 'SULING1-1');
  assert.strictEqual(rows[0]['ID isian'], 'SULING1');
});
uji('produksi suling: isian yang sama dilewati, yang berbeda ditolak', () => {
  const sama = kirim('Produksi Suling', { Tanggal: senin }, [{ 'Alat suling': 'Alat 1', Operator: 'Eko', 'Jumlah sulingan': 2 }]);
  assert.ok(sama.ok && sama.dobel, JSON.stringify(sama));
  const beda = kirim('Produksi Suling', { Tanggal: senin }, [{ 'Alat suling': 'Alat 1', Operator: 'Eko', 'Jumlah sulingan': 3 }]);
  assert.strictEqual(beda.kode, 'SUDAH');
  assert.ok(/Alat 1 sudah tercatat 2 sulingan/.test(beda.galat), beda.galat);
  assert.strictEqual(objek('Produksi Suling').length, 4);
  const hariKedua = kirim('Produksi Suling', { Tanggal: geser(senin, 1) }, [
    { 'Alat suling': 'Alat 1', Operator: 'Eko', 'Jumlah sulingan': 1 }, { 'Alat suling': 'Alat 2', Operator: 'Dedi', 'Jumlah sulingan': 2 }]);
  assert.ok(hariKedua.ok);
});
uji('absensi: satu baris per orang, upah dari tarif', () => {
  const r = kirim('Absensi', { Tanggal: senin }, [
    { Nama: 'Rofik', Kehadiran: '1 trip' }, { Nama: 'Pak Muh', Kehadiran: '2 trip' }, { Nama: 'Eko', Kehadiran: 'Masuk (upah dari sulingan)' },
    { Nama: 'Dedi', Kehadiran: 'Libur' }], 'ABSEN1');
  assert.ok(r.ok, JSON.stringify(r));
  const rows = objek('Absensi');
  assert.strictEqual(rows.length, 4);
  assert.strictEqual(rows.find(x => x.Nama === 'Rofik')['Upah absensi (Rp)'], 76000);
  assert.strictEqual(rows.find(x => x.Nama === 'Pak Muh')['Peran'], 'Pengumpul');
  assert.strictEqual(rows.find(x => x.Nama === 'Eko')['Upah absensi (Rp)'], 0);
});
uji('absensi: kerja lain digabung ke baris yang sama, bentrok ditolak', () => {
  const r = kirim('Absensi', { Tanggal: senin }, [{ Nama: 'Rofik', 'Pekerjaan lain': 'Tambal kolam', 'Upah kerja lain (Rp)': 50000 },
    { Nama: 'Gatot', 'Pekerjaan lain': 'Tambal kolam', 'Upah kerja lain (Rp)': 50000 }]);
  assert.ok(r.ok, JSON.stringify(r));
  assert.strictEqual(r.gabung, 1); assert.strictEqual(r.baris, 1);
  const rows = objek('Absensi');
  assert.strictEqual(rows.length, 5);
  const rofik = rows.find(x => x.Nama === 'Rofik');
  assert.strictEqual(rofik['Kehadiran'], '1 trip');
  assert.strictEqual(rofik['Upah kerja lain (Rp)'], 50000);
  const b = kirim('Absensi', { Tanggal: senin }, [{ Nama: 'Rofik', Kehadiran: '2 trip' }]);
  assert.strictEqual(b.kode, 'SUDAH');
  assert.ok(/Rofik sudah tercatat "1 trip"/.test(b.galat), b.galat);
});
uji('saring minyak per alat dan gabungan', () => {
  assert.ok(kirim('Saring Minyak', { 'Tanggal saring': geser(senin, 1), 'Alat suling': 'Alat 1', 'Jumlah sulingan yang disaring': 3,
    'Minyak (kg)': 3.3, 'Kondisi bahan': 'Segar semua' }).ok);
  assert.ok(kirim('Saring Minyak', { 'Tanggal saring': geser(senin, 1), 'Alat suling': 'Gabungan', 'Jumlah sulingan yang disaring': 5,
    'Minyak (kg)': 5, 'Kondisi bahan': 'Segar semua' }).ok);
  assert.strictEqual(objek('Saring Minyak')[0]['Minyak per sulingan (kg)'], 1.1);
});
uji('penjualan dan kas mengambil satuan dan arah dari data induk', () => {
  assert.ok(kirim('Penjualan', { Tanggal: geser(senin, 1), Pembeli: 'Kepuh', Produk: 'Minyak jeruk purut', Jumlah: 8, 'Harga satuan (Rp)': 450000,
    'Status bayar': 'Belum dibayar' }).ok);
  assert.ok(kirim('Kas', { Tanggal: senin, Kategori: 'Kayu bakar', 'Jumlah (Rp)': 200000, Keterangan: 'kayu' }).ok);
  assert.ok(kirim('Kas', { Tanggal: senin, Kategori: 'Diambil pemilik', 'Jumlah (Rp)': 500000, Keterangan: 'x' }).ok);
  const p = objek('Penjualan')[0];
  assert.strictEqual(p['Satuan'], 'kg'); assert.strictEqual(p['Total (Rp)'], 3600000);
  assert.strictEqual(objek('Kas')[0]['Arah'], 'Keluar');
});

console.log('Laporan');
let rk;
uji('ringkasan menghitung minggu, alat, dan upah per orang', () => {
  rk = panggil({ aksi: 'ringkasan', token });
  assert.ok(rk.ok, JSON.stringify(rk));
  const m = rk.minggu.find(x => x.mulai === senin);
  assert.ok(m, 'minggu ini ada');
  assert.strictEqual(m.trip, 1);
  assert.strictEqual(m.bahanKg, 1000);
  assert.strictEqual(m.sulingan, 8);
  assert.strictEqual(m.minyak, 8.3);
  assert.strictEqual(m.minyakPerSulingan, 1.038);
  assert.strictEqual(m.upahSuling, 180000 + 90000 + 0 + 200000 + 90000 + 180000);
  assert.strictEqual(m.upahAbsensi, 76000 + 126000);
  assert.strictEqual(m.upahLain, 100000);
  assert.strictEqual(m.operasional, 200000);
  assert.strictEqual(m.kasKeluarLain, 500000);
  assert.strictEqual(m.penjualan, 3600000);
  assert.strictEqual(m.belumLunas, 3600000);
  assert.strictEqual(m.biayaProduksi, 850000 + 740000 + 202000 + 100000 + 200000);
  assert.strictEqual(m.laba, 3600000 - m.biayaProduksi);
  const a1 = m.alat.find(a => a.nama === 'Alat 1');
  assert.strictEqual(a1.sulingan, 3); assert.strictEqual(a1.minyakPerSulingan, 1.1); assert.strictEqual(a1.operator, 'Eko');
  const a3 = m.alat.find(a => a.nama === 'Alat 3');
  assert.strictEqual(a3.hariKosong, 2, 'Alat 3 tidak jalan 2 hari');
  const dedi = m.orang.find(o => o.nama === 'Dedi');
  assert.strictEqual(dedi.sulingan, 2); assert.strictEqual(dedi.upahSuling, 180000); assert.strictEqual(dedi.peran, 'Cadangan');
  const rofik = m.orang.find(o => o.nama === 'Rofik');
  assert.strictEqual(rofik.total, 126000); assert.strictEqual(rofik.hariMasuk, 1);
  assert.strictEqual(m.orang[0].peran, 'Penyuling', 'penyuling di urutan atas');
  assert.ok(rk.peringatan.some(p => p.status === 'TAGIH'));
  assert.ok(rk.peringatan.some(p => /Alat 3 tidak jalan/.test(p.hal)));
});
uji('laporan ditulis ke tab sheet', () => {
  const rek = objek('Rekap Mingguan');
  assert.ok(rek.length >= 1);
  assert.strictEqual(rek[0]['Sulingan'], 8);
  assert.ok(objek('Upah Mingguan').some(r => r.Nama === 'Eko'));
  assert.strictEqual(objek('Rekap Alat').filter(r => +r['Minggu mulai'] === +rek[0]['Minggu mulai']).length, 4);
  assert.ok(tab('Ringkasan').data[0][0].includes('Kepuh'));
  assert.strictEqual(props.laporanKotor, undefined);
});
uji('ganti nama karyawan ikut mengganti catatan lama', () => {
  const r = panggil({ aksi: 'masterSimpan', token, tab: 'Karyawan', id: idKar['Pak Muh'], nilai: { Nama: 'Pak Muhammad', Peran: 'Pengumpul' } });
  assert.ok(r.ok && r.catatanDiganti >= 2, JSON.stringify(r));
  assert.strictEqual(objek('Ambil Bahan')[0]['Pengumpul'], 'Rofik, Pak Muhammad');
  assert.ok(objek('Absensi').some(x => x.Nama === 'Pak Muhammad'));
});

console.log('Riwayat, ubah, hapus');
uji('riwayat terurut tanggal terbaru', () => {
  const r = panggil({ aksi: 'terbaru', token, tab: 'Produksi Suling', n: 3 });
  assert.ok(r.ok); assert.strictEqual(r.data.length, 3); assert.strictEqual(r.total, 6);
  assert.strictEqual(r.data[0].nilai['Tanggal'], geser(senin, 1));
});
uji('ubah catatan menghitung ulang upah', () => {
  const r = panggil({ aksi: 'terbaru', token, tab: 'Produksi Suling', n: 10 });
  const x = r.data.find(d => d.nilai['Alat suling'] === 'Alat 3');
  const u = panggil({ aksi: 'ubah', token, tab: 'Produksi Suling', id: x.id, nilai: { 'Jumlah sulingan': 1, Operator: 'Sarno' } });
  assert.ok(u.ok, JSON.stringify(u));
  const row = objek('Produksi Suling').find(d => d.ID === x.id);
  assert.strictEqual(row['Upah (Rp)'], 90000);
  const bentrok = panggil({ aksi: 'ubah', token, tab: 'Produksi Suling', id: x.id, nilai: { 'Alat suling': 'Alat 1' } });
  assert.strictEqual(bentrok.ok, false, 'alat & tanggal kembar ditolak');
  assert.strictEqual(props.laporanKotor, '1');
});
uji('hapus catatan', () => {
  const r = panggil({ aksi: 'terbaru', token, tab: 'Kas', n: 10 });
  const n0 = objek('Kas').length;
  assert.ok(panggil({ aksi: 'hapus', token, tab: 'Kas', id: r.data[0].id }).ok);
  assert.strictEqual(objek('Kas').length, n0 - 1);
  assert.strictEqual(panggil({ aksi: 'hapus', token, tab: 'Kas', id: r.data[0].id }).kode, 'BERUBAH');
  assert.ok(tab('Log Aplikasi').tersembunyi);
});

console.log('Pengguna lain');
let tokenPencatat;
uji('pemilik menambah pencatat dengan akses terbatas', () => {
  const r = panggil({ aksi: 'penggunaSimpan', token, baru: true, pengguna: 'pencatat1', nama: 'Bu Sri', peran: 'Pencatat',
    boleh: ['Produksi Suling', 'Absensi'], mengatur: false, aktif: true, sandiBaru: 'kepuh123' });
  assert.ok(r.ok, JSON.stringify(r));
  assert.strictEqual(panggil({ aksi: 'penggunaSimpan', token, baru: true, pengguna: 'pencatat1', nama: 'X', sandiBaru: 'abcdef' }).ok, false);
  assert.strictEqual(panggil({ aksi: 'penggunaSimpan', token, baru: true, pengguna: 'Ada Spasi', nama: 'X', sandiBaru: 'abcdef' }).ok, false);
  const m = panggil({ aksi: 'masuk', pengguna: 'pencatat1', sandi: 'kepuh123' });
  assert.ok(m.ok); tokenPencatat = m.token;
  assert.deepStrictEqual(m.akses.tab, ['Produksi Suling', 'Absensi']);
  assert.strictEqual(m.akses.admin, false);
  const cfg = panggil({ aksi: 'config', token: tokenPencatat });
  assert.strictEqual(cfg.skema, null);
  assert.ok(cfg.master['Alat Suling'].every(a => a.aktif), 'pencatat hanya melihat yang aktif');
});
uji('pencatat tidak boleh mengatur atau mengisi di luar haknya', () => {
  const t = tokenPencatat;
  assert.strictEqual(panggil({ aksi: 'simpan', token: t, tab: 'Kas', nilai: { Tanggal: hariIni } }).ok, false);
  assert.strictEqual(panggil({ aksi: 'ringkasan', token: t }).ok, false);
  assert.strictEqual(panggil({ aksi: 'masterSimpan', token: t, tab: 'Karyawan', nilai: { Nama: 'X', Peran: 'Lainnya' } }).ok, false);
  assert.strictEqual(panggil({ aksi: 'penggunaDaftar', token: t }).ok, false);
  assert.strictEqual(panggil({ aksi: 'tampilanSimpan', token: t, tampilan: {} }).ok, false);
  assert.strictEqual(panggil({ aksi: 'hapus', token: t, tab: 'Absensi', id: 'x' }).ok, false);
  assert.ok(panggil({ aksi: 'terbaru', token: t, tab: 'Absensi' }).ok);
  assert.ok(panggil({ aksi: 'simpan', token: t, tab: 'Absensi', id: 'P1', nilai: { Tanggal: geser(senin, 2) }, baris: [{ Nama: 'Eko', Kehadiran: 'Libur' }] }).ok);
});
uji('reset sandi dan nonaktifkan memutus sesi pencatat', () => {
  assert.ok(panggil({ aksi: 'penggunaSimpan', token, pengguna: 'pencatat1', nama: 'Bu Sri', peran: 'Pencatat', boleh: 'Semua', mengatur: true, aktif: true }).ok);
  const cfg = panggil({ aksi: 'config', token: tokenPencatat });
  assert.strictEqual(cfg.akses.tab.length, 6, 'hak baru langsung berlaku'); assert.ok(cfg.akses.admin);
  assert.ok(panggil({ aksi: 'penggunaSimpan', token, pengguna: 'pencatat1', nama: 'Bu Sri', peran: 'Pencatat', boleh: 'Semua', aktif: true, sandiBaru: 'baru1234' }).ok);
  assert.strictEqual(panggil({ aksi: 'config', token: tokenPencatat }).kode, 'SESI');
  const m = panggil({ aksi: 'masuk', pengguna: 'pencatat1', sandi: 'baru1234' }); assert.ok(m.ok);
  assert.ok(panggil({ aksi: 'penggunaSimpan', token, pengguna: 'pencatat1', nama: 'Bu Sri', peran: 'Pencatat', boleh: 'Semua', aktif: false }).ok);
  assert.strictEqual(panggil({ aksi: 'config', token: m.token }).kode, 'SESI');
  assert.strictEqual(panggil({ aksi: 'masuk', pengguna: 'pencatat1', sandi: 'baru1234' }).ok, false);
});
uji('pemilik terakhir tidak bisa dinonaktifkan', () => {
  const r = panggil({ aksi: 'penggunaSimpan', token, pengguna: 'wildan', nama: 'Mas Wildan', peran: 'Pencatat', boleh: 'Semua', aktif: true });
  assert.strictEqual(r.ok, false);
  const d = panggil({ aksi: 'penggunaDaftar', token });
  assert.ok(d.ok); assert.ok(d.daftar.every(p => !('hash' in p) && !('garam' in p)));
});

console.log('Tampilan & pengaturan');
uji('tampilan disimpan untuk semua pengguna', () => {
  const t = { warna: '#123456', beranda: 3, menu: [{ k: 'kas', tampil: false }] };
  assert.ok(panggil({ aksi: 'tampilanSimpan', token, tampilan: t }).ok);
  assert.deepStrictEqual(panggil({ aksi: 'config', token }).tampilan, t);
});
uji('awal minggu bisa diganti', () => {
  assert.ok(panggil({ aksi: 'pengaturanSimpan', token, awalMinggu: 'Sabtu' }).ok);
  assert.strictEqual(panggil({ aksi: 'config', token }).pengaturan.awalMinggu, 'Sabtu');
  const r = panggil({ aksi: 'ringkasan', token });
  assert.ok(r.minggu.every(m => new Date(m.mulai + 'T00:00:00Z').getUTCDay() === 6));
  assert.ok(panggil({ aksi: 'pengaturanSimpan', token, awalMinggu: 'Senin' }).ok);
  assert.strictEqual(panggil({ aksi: 'pengaturanSimpan', token, awalMinggu: 'Senen' }).ok, false);
});
uji('daftar id anti-dobel tidak melewati batas 9 KB', () => {
  for (let i = 0; i < 350; i++) kirim('Kas', { Tanggal: hariIni, Kategori: 'Kayu bakar', 'Jumlah (Rp)': 1000 }, null, ('x' + i + '-' + 'a'.repeat(30)).slice(0, 36));
  assert.ok(props.idMasuk.length <= 8000);
});
uji('keluar menghapus sesi', () => {
  const m = panggil({ aksi: 'masuk', pengguna: 'wildan', sandi: 'rahasia1' });
  assert.ok(panggil({ aksi: 'keluar', token: m.token }).ok);
  assert.strictEqual(panggil({ aksi: 'config', token: m.token }).kode, 'SESI');
});

console.log('Ganti nama pengguna');
uji('pemilik mengganti nama pengguna orang lain, sesi HP-nya tetap jalan', () => {
  assert.ok(panggil({ aksi: 'penggunaSimpan', token, pengguna: 'pencatat1', nama: 'Bu Sri', peran: 'Pencatat', boleh: 'Semua', aktif: true, sandiBaru: 'sri12345' }).ok);
  const m = panggil({ aksi: 'masuk', pengguna: 'pencatat1', sandi: 'sri12345' });
  assert.ok(m.ok, JSON.stringify(m));
  const salah = panggil({ aksi: 'penggunaSimpan', token, pengguna: 'pencatat1', penggunaBaru: 'Bu Sri', nama: 'Bu Sri', peran: 'Pencatat', boleh: 'Semua', aktif: true });
  assert.strictEqual(salah.ok, false, 'spasi ditolak');
  assert.strictEqual(panggil({ aksi: 'penggunaSimpan', token, pengguna: 'pencatat1', penggunaBaru: 'wildan', nama: 'Bu Sri', peran: 'Pencatat', boleh: 'Semua', aktif: true }).ok, false, 'nama terpakai ditolak');
  const r = panggil({ aksi: 'penggunaSimpan', token, pengguna: 'pencatat1', penggunaBaru: 'Sri.Kepuh', nama: 'Bu Sri', peran: 'Pencatat', boleh: 'Semua', aktif: true });
  assert.ok(r.ok, JSON.stringify(r)); assert.strictEqual(r.pengguna, 'sri.kepuh');
  const cfg = panggil({ aksi: 'config', token: m.token });
  assert.ok(cfg.ok, 'sesi lama tetap berlaku'); assert.strictEqual(cfg.akses.pengguna, 'sri.kepuh');
  assert.strictEqual(panggil({ aksi: 'masuk', pengguna: 'pencatat1', sandi: 'sri12345' }).ok, false);
  assert.ok(panggil({ aksi: 'masuk', pengguna: 'sri.kepuh', sandi: 'sri12345' }).ok);
});
uji('pengguna mengganti nama penggunanya sendiri dengan sandi', () => {
  const m = panggil({ aksi: 'masuk', pengguna: 'wildan', sandi: 'rahasia1' });
  assert.strictEqual(panggil({ aksi: 'namaPenggunaUbah', token: m.token, penggunaBaru: 'mas.wildan', sandi: 'salah' }).galat, 'Sandi salah.');
  assert.strictEqual(panggil({ aksi: 'namaPenggunaUbah', token: m.token, penggunaBaru: 'sri.kepuh', sandi: 'rahasia1' }).ok, false);
  const r = panggil({ aksi: 'namaPenggunaUbah', token: m.token, penggunaBaru: 'mas.wildan', sandi: 'rahasia1' });
  assert.ok(r.ok, JSON.stringify(r)); assert.strictEqual(r.akses.pengguna, 'mas.wildan'); assert.ok(r.akses.pemilik);
  assert.ok(panggil({ aksi: 'penggunaDaftar', token }).daftar.some(p => p.pengguna === 'mas.wildan' && p.saya), 'token lain milik pemilik ikut pindah');
  assert.ok(panggil({ aksi: 'masuk', pengguna: 'mas.wildan', sandi: 'rahasia1' }).ok);
  assert.strictEqual(panggil({ aksi: 'masuk', pengguna: 'wildan', sandi: 'rahasia1' }).ok, false);
  assert.ok(tab('Log Aplikasi').data.some(r2 => r2[1] === 'Ganti nama pengguna' && r2[5] === 'mas.wildan'));
});
uji('nama pengguna berupa angka tetap teks', () => {
  assert.ok(panggil({ aksi: 'penggunaSimpan', token, baru: true, pengguna: '0812', nama: 'Tes', peran: 'Lainnya', boleh: [], aktif: true, sandiBaru: 'abcdef' }).ok);
  assert.ok(panggil({ aksi: 'masuk', pengguna: '0812', sandi: 'abcdef' }).ok);
});
uji('sandi sementara di Pengaturan ikut nama baru', () => {
  const k = muatKode(); k.ctx.siapkanSheet();
  const p = k.ctx.bacaPengguna_(k.ss)[0];
  assert.strictEqual(k.ctx.gantiNamaPengguna_(k.ss, p, 'pemilik', 'tes'), '');
  const nilai = k.ss.getSheetByName('Pengaturan').data.find(r => r[0] === 'Sandi sementara pemilik')[1];
  assert.ok(/^pemilik: \w+$/.test(nilai), nilai);
});

console.log('\n' + lulus + ' uji lulus.');
