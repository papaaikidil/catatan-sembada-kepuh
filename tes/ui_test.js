// Uji alur aplikasi di browser HP dengan Apps Script asli (kode.gs) di atas Google Sheet tiruan.
// Jalankan: node tes/ui_test.js   (gambar layar disimpan di folder OUT)
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { muatKode, formatTanggal } = require('./tiruan_gas');

const ASAL = 'https://papaaikidil.github.io/catatan-sembada-kepuh/';
const API = 'https://script.google.com/macros/s/TES-KEPUH/exec';
const OUT = process.env.OUT || '/tmp/kepuh-layar';
const DOCS = path.join(__dirname, '..', 'docs');
fs.mkdirSync(OUT, { recursive: true });

const server = muatKode();
const pesan = server.ctx.siapkanSheet();
const sandiAwal = /Sandi sementara: (\w+)/.exec(pesan)[1];
const hariIni = formatTanggal(new Date(), 'yyyy-MM-dd');
const kemarin = formatTanggal(new Date(Date.now() - 864e5), 'yyyy-MM-dd');
let jaringanMati = false;
const panggilan = [];

const objek = n => { const sh = server.ss.getSheetByName(n); const k = sh.data[0]; return sh.data.slice(1).filter(r => r.some(v => v !== '' && v !== undefined)).map(r => Object.fromEntries(k.map((h, j) => [h, r[j] === undefined ? '' : r[j]]))); };
const tunggu = ms => new Promise(r => setTimeout(r, ms));
let langkah = 0;
const cek = (nama) => { langkah++; console.log('  ✓ ' + nama); };

async function pasang(page) {
  await page.route(API + '**', async route => {
    if (jaringanMati) return route.abort('internetdisconnected');
    const req = JSON.parse(route.request().postData() || '{}');
    panggilan.push(req.aksi);
    const body = server.panggil(req);
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.route(ASAL + '**', async route => {
    const url = new URL(route.request().url());
    let f = url.pathname.replace('/catatan-sembada-kepuh/', '') || 'index.html';
    if (f === 'config.js') return route.fulfill({ contentType: 'application/javascript', body: `window.KEPUH_CONFIG={API_URL:'${API}',VERSI:'tes'};` });
    const p = path.join(DOCS, f);
    if (!fs.existsSync(p)) return route.fulfill({ status: 404, body: 'tidak ada' });
    const jenis = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' }[path.extname(p)] || 'application/octet-stream';
    await route.fulfill({ contentType: jenis, body: fs.readFileSync(p) });
  });
}

async function foto(page, nama, penuh) {
  await page.screenshot({ path: path.join(OUT, nama + '.png'), fullPage: !!penuh });
}
async function pilih(page, nama, nilai, akar) {
  const ok = await page.evaluate(([n, v, a]) => {
    const wadah = a ? document.querySelector(a) : document;
    const i = [...wadah.querySelectorAll('input[name="' + n + '"]')].find(x => x.value === v);
    if (!i) return false;
    i.closest('label').click();
    return true;
  }, [nama, nilai, akar || '']);
  assert.ok(ok, 'pilihan tidak ada: ' + nama + '=' + nilai);
}
async function isi(page, sel, nilai) { await page.fill(sel, ''); await page.fill(sel, String(nilai)); }
async function bidangNama(page, judul, akar) {
  // nama input untuk bidang dengan judul kolom tertentu
  return page.evaluate(([j, a]) => { const w = (a ? document.querySelector(a) : document); const b = [...w.querySelectorAll('.bidang[data-h]')].find(x => x.dataset.h === j); return b ? b.id : null; }, [judul, akar || '']);
}
async function simpanDanKonfirmasi(page) {
  await page.click('#tombol-simpan');
  await page.waitForSelector('.tirai [data-aksi="kirim"]');
  await foto(page, 'konfirmasi-' + langkah);
  await page.click('.tirai [data-aksi="kirim"]');
  await page.waitForFunction(() => location.hash === '#/');
  await page.waitForFunction(() => !JSON.parse(localStorage.getItem('kepuh.antrian') || '[]').length, null, { timeout: 8000 });
}

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block', locale: 'id-ID', timezoneId: 'Asia/Jakarta' });
  const page = await context.newPage();
  const galatHalaman = [];
  page.on('pageerror', e => galatHalaman.push(e.message));
  page.on('console', m => { if (m.type() === 'error') galatHalaman.push(m.text()); });
  page.on('dialog', d => d.accept());
  await pasang(page);

  console.log('Masuk');
  await page.goto(ASAL);
  await page.waitForSelector('#form-masuk');
  await foto(page, '01-masuk');
  await isi(page, '#pengguna', 'wildan');
  await isi(page, '#sandi', 'salah');
  await page.click('#form-masuk button[type=submit]');
  await page.waitForSelector('.galat-kartu');
  assert.ok((await page.textContent('.galat-kartu')).includes('salah'));
  await isi(page, '#sandi', sandiAwal);
  await page.click('#form-masuk button[type=submit]');
  await page.waitForFunction(() => location.hash === '#/sandi');
  await page.waitForSelector('#formulir');
  await foto(page, '02-wajib-ganti-sandi');
  cek('sandi sementara langsung diminta diganti');
  await isi(page, '[name=b0]', sandiAwal);
  await isi(page, '[name=b1]', 'kepuh2026');
  await isi(page, '[name=b2]', 'kepuh2027');
  await page.click('#tombol-simpan');
  await page.waitForSelector('.salah');
  await isi(page, '[name=b2]', 'kepuh2026');
  await page.click('#tombol-simpan');
  await page.waitForFunction(() => location.hash === '#/');
  await page.waitForSelector('.grid-catatan');
  cek('ganti sandi lalu masuk ke beranda');

  console.log('Kelola karyawan & alat');
  await page.click('.nav a[href="#/kelola"]');
  await page.waitForSelector('.menu-kelola');
  await foto(page, '03-kelola');
  await page.click('a[href="#/kelola/karyawan"]');
  await page.waitForSelector('#tambah-induk');
  for (const [nama, peran] of [['Eko', 'Penyuling'], ['Gatot', 'Penyuling'], ['Rofik', 'Pengumpul']]) {
    await page.click('#tambah-induk');
    await page.waitForSelector('.tirai form');
    await isi(page, '.tirai [name=m0]', nama);
    await pilih(page, 'm1', peran, '.tirai');
    await page.click('.tirai [data-aksi="simpan"]');
    await page.waitForFunction((n) => [...document.querySelectorAll('.item-induk b')].some(b => b.textContent === n) && !document.querySelector('.tirai'), nama);
  }
  // sisanya lewat API supaya cepat
  const token = await page.evaluate(() => JSON.parse(localStorage.getItem('kepuh.sesi')).token);
  [['Sarno', 'Penyuling'], ['Yanto', 'Penyuling'], ['Pak Muh', 'Pengumpul'], ['Dedi', 'Cadangan'], ['Bambang', 'Pengumpul']].forEach(([n, p]) => {
    assert.ok(server.panggil({ aksi: 'masterSimpan', token, tab: 'Karyawan', nilai: { Nama: n, Peran: p } }).ok);
  });
  await page.click('#tombol-muat').catch(() => {});
  await page.goto(ASAL + '#/kelola');
  await page.click('#tombol-muat');
  await tunggu(300);
  await page.goto(ASAL + '#/kelola/karyawan');
  await page.waitForFunction(() => document.querySelectorAll('.item-induk').length >= 8);
  await foto(page, '04-karyawan');
  // Bambang keluar
  await page.evaluate(() => [...document.querySelectorAll('.item-induk .teks')].find(x => x.querySelector('b').textContent === 'Bambang').click());
  await page.waitForSelector('.tirai [data-aksi="mati"]');
  await page.click('.tirai [data-aksi="mati"]');
  await page.waitForFunction(() => !document.querySelector('.tirai') && document.querySelectorAll('.judul-bagian').length === 1);
  assert.ok(objek('Karyawan').find(k => k.Nama === 'Bambang').Aktif === 'Tidak');
  cek('karyawan ditambah dan ditandai keluar dari aplikasi');

  await page.goto(ASAL + '#/kelola/alat');
  await page.waitForSelector('.item-induk');
  const ops = ['Eko', 'Gatot', 'Sarno', 'Yanto'];
  for (let i = 0; i < 4; i++) {
    await page.evaluate((i) => document.querySelectorAll('.kartu .item-induk .teks')[i].click(), i);
    await page.waitForSelector('.tirai form');
    await pilih(page, 'm1', ops[i], '.tirai');
    await isi(page, '.tirai [name=m2]', i === 3 ? '100000' : '90000');
    if (i === 0) await foto(page, '05-ubah-alat');
    await page.click('.tirai [data-aksi="simpan"]');
    await page.waitForFunction(() => !document.querySelector('.tirai'));
  }
  await page.click('#tambah-induk');
  await page.waitForSelector('.tirai form');
  await isi(page, '.tirai [name=m0]', 'Alat 5');
  await page.click('.tirai [data-aksi="simpan"]');
  await page.waitForFunction(() => [...document.querySelectorAll('.item-induk b')].some(b => b.textContent === 'Alat 5'));
  // urutan: Alat 5 dinaikkan satu
  await page.evaluate(() => { const b = [...document.querySelectorAll('[data-naik]')]; b[b.length - 1].click(); });
  await page.waitForFunction(() => [...document.querySelectorAll('.item-induk b')].map(b => b.textContent).join(',').startsWith('Alat 1,Alat 2,Alat 3,Alat 5'));
  await foto(page, '06-alat-suling');
  await tunggu(200);
  const urutanAlat = objek('Alat Suling').sort((a, b) => a.Urutan - b.Urutan).map(a => a['Nama alat']);
  assert.deepStrictEqual(urutanAlat.slice(0, 5), ['Alat 1', 'Alat 2', 'Alat 3', 'Alat 5', 'Alat 4']);
  // Alat 5 dinonaktifkan lagi
  await page.evaluate(() => [...document.querySelectorAll('.item-induk .teks')].find(x => x.querySelector('b').textContent === 'Alat 5').click());
  await page.click('.tirai [data-aksi="mati"]');
  await page.waitForFunction(() => !document.querySelector('.tirai') && /Tidak aktif/.test(document.body.textContent));
  cek('alat suling diubah, ditambah, diurutkan, dan dinonaktifkan');

  console.log('Produksi suling');
  await page.goto(ASAL + '#/isi/suling');
  await page.waitForSelector('.kisi-alat');
  assert.strictEqual(await page.locator('.kisi-alat').count(), 4, 'hanya alat aktif');
  await foto(page, '07-produksi-kosong');
  await pilih(page, 'b1_a0_n', '2');
  await pilih(page, 'b1_a1_n', '1');
  await pilih(page, 'b1_a2_n', '0');
  await pilih(page, 'b1_a2_k', 'Ketel bocor');
  // operator Alat 1 & 2 sudah terpilih otomatis dari operator tetap
  assert.strictEqual(await page.$eval('input[name="b1_a0_op"]:checked', e => e.value), 'Eko');
  await page.waitForSelector('#pratinjau:not([hidden])');
  const prat = await page.textContent('#pratinjau');
  assert.ok(/3 sulingan/.test(prat) && /270\.000/.test(prat), prat);
  await foto(page, '08-produksi-terisi', true);
  await simpanDanKonfirmasi(page);
  const prod = objek('Produksi Suling');
  assert.strictEqual(prod.length, 3);
  assert.strictEqual(prod[0]['Upah (Rp)'], 180000);
  assert.strictEqual(prod[2]['Kondisi alat'], 'Ketel bocor');
  assert.strictEqual(prod[0]['Dicatat oleh'], 'Mas Wildan');
  cek('produksi suling 3 alat tersimpan dengan upah borongan');

  await page.goto(ASAL + '#/isi/suling');
  await page.waitForSelector('.kisi-alat');
  await pilih(page, 'b1_a3_n', '2');
  await pilih(page, 'b1_a3_op', 'Dedi');
  await pilih(page, 'b1_a0_n', '3');
  await simpanDanKonfirmasi(page).catch(() => {});
  await page.goto(ASAL + '#/antrian');
  await page.waitForSelector('.galat-kartu');
  assert.ok(/Alat 1 sudah tercatat 2 sulingan/.test(await page.textContent('.galat-kartu')));
  await foto(page, '09-antrian-bentrok');
  await page.click('[data-hapus-antrian]');
  cek('isian bentrok tertahan di antrian dengan pesan jelas');

  console.log('Absensi');
  await page.goto(ASAL + '#/isi/absensi');
  await page.waitForSelector('.baris-kisi');
  await page.click('[data-isi-semua="Pengumpul"]');
  const namaOrang = await page.evaluate(() => JSON.parse(localStorage.getItem('kepuh.konfig')).master.Karyawan.filter(k => k.aktif).map(k => k.nilai.Nama));
  const j = n => namaOrang.indexOf(n);
  await pilih(page, 'b1_o' + j('Pak Muh'), '2 trip');
  await pilih(page, 'b1_o' + j('Eko'), 'Masuk (upah dari sulingan)');
  await pilih(page, 'b1_o' + j('Dedi'), 'Libur');
  await pilih(page, 'b2_ada', 'Ya');
  await isi(page, '[name=b2_kerja]', 'Tambal kolam');
  await pilih(page, 'b2_siapa', 'Gatot');
  await page.click('#tombol-simpan');
  await page.waitForSelector('.bidang-kerja-lain.salah');
  assert.ok(/upah kerja lain untuk Gatot/.test(await page.textContent('.bidang-kerja-lain .pesan-salah')));
  await isi(page, '[name=b2_u' + j('Gatot') + ']', '50000');
  await foto(page, '10-absensi', true);
  await simpanDanKonfirmasi(page);
  const abs = objek('Absensi');
  assert.strictEqual(abs.find(a => a.Nama === 'Rofik').Kehadiran, '1 trip');
  assert.strictEqual(abs.find(a => a.Nama === 'Pak Muh')['Upah absensi (Rp)'], 126000);
  assert.strictEqual(abs.find(a => a.Nama === 'Gatot')['Upah kerja lain (Rp)'], 50000);
  assert.ok(!abs.find(a => a.Nama === 'Bambang'), 'karyawan keluar tidak muncul');
  cek('absensi dengan isi cepat dan kerja lain tersimpan');

  console.log('Ambil bahan, saring, penjualan, kas');
  await page.goto(ASAL + '#/isi/ambil');
  await page.waitForSelector('#formulir');
  await pilih(page, 'b1', 'Rofik');
  await pilih(page, 'b1', 'Pak Muh');
  // daftar Daerah masih kosong: "Lainnya…" sudah tercentang dan kotak isiannya langsung terbuka
  assert.ok(await page.$eval('input[name=b2][value=__lain]', e => e.checked));
  await isi(page, '#b2_lt', 'Kepuh');
  await pilih(page, 'b3', 'Segar semua');
  await isi(page, '[name=b4]', '1.075');
  await isi(page, '[name=b5]', '1000000');
  await isi(page, '[name=b6]', '150000');
  await simpanDanKonfirmasi(page);
  const ab = objek('Ambil Bahan')[0];
  assert.strictEqual(ab['Berat bahan (kg)'], 1075);
  assert.strictEqual(ab['Daerah'], 'Kepuh');
  assert.strictEqual(ab['Uang beli bahan (Rp)'], 850000);
  cek('ambil bahan dengan daerah lainnya');

  await page.goto(ASAL + '#/isi/saring');
  await page.waitForSelector('#formulir');
  await pilih(page, 'b1', 'Alat 1');
  await isi(page, '[name=b2]', '2');
  await isi(page, '[name=b3]', '2,2');
  await pilih(page, 'b5', 'Segar semua');
  await simpanDanKonfirmasi(page);
  assert.strictEqual(objek('Saring Minyak')[0]['Minyak per sulingan (kg)'], 1.1);
  cek('saring minyak per alat');

  // produk punya harga biasa → harga terisi otomatis
  const produk = server.panggil({ aksi: 'config', token }).master.Produk[0];
  server.panggil({ aksi: 'masterSimpan', token, tab: 'Produk', id: produk.id, nilai: Object.assign({}, produk.nilai, { 'Harga biasa (Rp)': 450000 }) });
  server.panggil({ aksi: 'masterSimpan', token, tab: 'Pilihan', nilai: { Daftar: 'Pembeli', Pilihan: 'PT Haldin' } });
  await page.goto(ASAL + '#/akun');
  await page.click('#perbarui');
  await page.waitForSelector('#perbarui:not([disabled])');
  await page.goto(ASAL + '#/isi/jual');
  await page.waitForSelector('#formulir');
  await pilih(page, 'b1', 'PT Haldin');
  await pilih(page, 'b2', 'Minyak jeruk purut');
  assert.strictEqual(await page.inputValue('[name=b4]'), '450000');
  await isi(page, '[name=b3]', '8');
  await pilih(page, 'b5', 'Belum dibayar');
  await simpanDanKonfirmasi(page);
  assert.strictEqual(objek('Penjualan')[0]['Total (Rp)'], 3600000);
  await page.goto(ASAL + '#/isi/kas');
  await page.waitForSelector('#formulir');
  await page.selectOption('[name=b1]', 'Kayu bakar');
  await isi(page, '[name=b2]', '200000');
  await isi(page, '[name=b3]', 'kayu 1 pikap');
  await simpanDanKonfirmasi(page);
  assert.strictEqual(objek('Kas')[0]['Arah'], 'Keluar');
  cek('penjualan (harga otomatis) dan kas');

  console.log('Ringkasan & riwayat');
  await page.goto(ASAL + '#/');
  await page.waitForSelector('#kotak-ringkas .angka-grid');
  await foto(page, '11-beranda', true);
  await page.goto(ASAL + '#/ringkasan');
  await page.waitForSelector('.daftar-baris');
  const teksRingkasan = await page.textContent('.isi');
  assert.ok(/Alat 3/.test(teksRingkasan) && /Upah per orang/.test(teksRingkasan) && /TAGIH/.test(teksRingkasan), 'isi ringkasan');
  await page.click('details.lipat summary');
  await foto(page, '12-ringkasan', true);
  cek('ringkasan menampilkan per alat, upah per orang, dan peringatan');

  await page.goto(ASAL + '#/terbaru/absensi');
  await page.waitForSelector('.baris-entri');
  await foto(page, '13-riwayat-absensi', true);
  await page.evaluate(() => [...document.querySelectorAll('.baris-entri')].find(x => x.querySelector('b').textContent === 'Dedi').querySelector('[data-ubah]').click());
  await page.waitForSelector('#formulir');
  await pilih(page, 'b2', 'Kerja harian');
  await page.click('#tombol-simpan');
  await page.click('.tirai [data-aksi="kirim"]');
  await page.waitForFunction(() => location.hash === '#/terbaru/absensi');
  await tunggu(200);
  assert.strictEqual(objek('Absensi').find(a => a.Nama === 'Dedi')['Upah absensi (Rp)'], 100000);
  cek('riwayat dikelompokkan per tanggal dan catatan bisa diubah');

  console.log('Tampilan & tata letak');
  await page.goto(ASAL + '#/tampilan');
  await page.waitForSelector('.swatch');
  await page.click('[data-preset="biru"]');
  await pilih(page, 't-beranda', '3');
  await pilih(page, 't-sudut', 'sedang');
  await page.evaluate(() => { const el = document.querySelector('.nama-menu[data-k="ambil"]'); el.value = 'Bahan Masuk'; el.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.click('[data-menu-saklar="kas"]');
  await page.click('[data-menu-turun="0"]');
  await page.click('[data-form="ambil"]');
  await page.click('[data-bidang-saklar="Keterangan biaya lain"]');
  await foto(page, '14-tampilan', true);
  assert.strictEqual(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--kepala').trim().toLowerCase()), '#1d3e66');
  await page.click('#tampilan-simpan');
  await page.waitForFunction(() => document.querySelector('#tampilan-simpan').textContent === 'Tersimpan');
  const tSimpan = server.panggil({ aksi: 'config', token }).tampilan;
  assert.strictEqual(tSimpan.warna, 'biru');
  assert.strictEqual(tSimpan.namaMenu.ambil, 'Bahan Masuk');
  await page.goto(ASAL + '#/');
  await page.waitForSelector('.grid-catatan.k3');
  const menu = await page.$$eval('.tombol-catatan b', bs => bs.map(b => b.textContent));
  assert.ok(menu.indexOf('Kas') < 0, 'Kas disembunyikan');
  assert.strictEqual(menu[1], 'Bahan Masuk', 'Ambil Bahan diganti nama dan turun satu');
  await foto(page, '15-beranda-biru');
  await page.goto(ASAL + '#/isi/ambil');
  await page.waitForSelector('#formulir');
  assert.strictEqual(await page.$('[data-h="Keterangan biaya lain"]'), null, 'isian disembunyikan');
  cek('warna, tata letak beranda, nama & urutan menu, dan isian formulir bisa diatur');

  // per HP: huruf besar & gelap
  await page.goto(ASAL + '#/tampilan');
  await page.waitForSelector('.swatch');
  await pilih(page, 'hp-huruf', 'besar');
  await pilih(page, 'hp-mode', 'gelap');
  await page.goto(ASAL + '#/');
  await page.waitForSelector('.grid-catatan');
  assert.strictEqual(await page.evaluate(() => document.documentElement.dataset.huruf), 'besar');
  assert.strictEqual(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  await foto(page, '16-beranda-gelap-besar', true);
  await page.goto(ASAL + '#/tampilan');
  await pilih(page, 'hp-huruf', '');
  await pilih(page, 'hp-mode', '');
  cek('ukuran huruf dan mode gelap per HP');

  console.log('Pengguna lain');
  await page.goto(ASAL + '#/pengguna');
  await page.waitForSelector('#tambah-bawah');
  await page.click('#tambah-bawah');
  await page.waitForSelector('.tirai form');
  await isi(page, '.tirai [name=u0]', 'Bu Sri');
  await isi(page, '.tirai [name=u1]', 'sri');
  await pilih(page, 'u2', 'Pencatat', '.tirai');
  for (const t of ['Ambil Bahan', 'Saring Minyak', 'Penjualan', 'Kas']) await pilih(page, 'u3', t, '.tirai');
  await isi(page, '.tirai [name=u6]', 'sri123');
  await foto(page, '17-tambah-pengguna', true);
  await page.click('.tirai [data-aksi="simpan"]');
  await page.waitForFunction(() => /Bu Sri/.test(document.getElementById('daftar-pengguna').textContent));
  await foto(page, '18-pengguna');
  cek('pemilik menambah pencatat dengan sandi sendiri');

  await page.goto(ASAL + '#/akun');
  await page.click('#keluar');
  await page.waitForSelector('#form-masuk');
  await isi(page, '#pengguna', 'sri');
  await isi(page, '#sandi', 'sri123');
  await page.click('#form-masuk button[type=submit]');
  await page.waitForSelector('.grid-catatan');
  const menuSri = await page.$$eval('.tombol-catatan b', bs => bs.map(b => b.textContent));
  assert.deepStrictEqual(menuSri.sort(), ['Absensi', 'Produksi Suling']);
  assert.strictEqual(await page.$('.nav a[href="#/kelola"]'), null);
  assert.strictEqual(await page.$('#kotak-ringkas'), null);
  await foto(page, '19-beranda-pencatat');
  cek('pencatat hanya melihat catatan yang boleh diisi');

  // tanpa sinyal
  jaringanMati = true;
  await context.setOffline(true);
  await page.goto(ASAL + '#/isi/suling').catch(() => {});
  await page.evaluate(() => { location.hash = '#/isi/suling'; });
  await page.waitForSelector('.kisi-alat');
  await page.fill('[name=b0]', kemarin);
  await pilih(page, 'b1_a0_n', '1');
  await page.click('#tombol-simpan');
  await page.click('.tirai [data-aksi="kirim"]');
  await page.waitForSelector('.status.tunggu');
  await foto(page, '20-tanpa-sinyal');
  jaringanMati = false;
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForSelector('.status.aman');
  assert.ok(objek('Produksi Suling').some(r => r['Dicatat oleh'] === 'Bu Sri' && r['Jumlah sulingan'] === 1));
  cek('catatan tanpa sinyal tersimpan di HP lalu terkirim');

  // Kegagalan jaringan saat sengaja dibuat tanpa sinyal memang diharapkan.
  assert.deepStrictEqual(galatHalaman.filter(g => !/ERR_INTERNET_DISCONNECTED/.test(g)), [], 'tidak ada galat di halaman');
  await browser.close();
  console.log('\n' + langkah + ' langkah lulus. Gambar layar: ' + OUT);
})().catch(e => { console.error(e); process.exit(1); });
