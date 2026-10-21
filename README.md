# Catatan Sembada Kepuh

Aplikasi pencatatan harian lokasi produksi utama Sembada Karya Wangi (Kepuh): ambil bahan, produksi suling per alat, saring minyak, absensi, penjualan, dan kas.
Konsepnya sama dengan Catatan Sembada, tetapi semua catatan masuk ke **Google Sheet terpisah** ("Catatan Sembada Kepuh").

## Yang berbeda dari Catatan Sembada

- **Alat suling bisa ditambah, dikurangi, dan diurutkan** dari aplikasi (Kelola > Alat suling). Upah borongan per sulingan diatur per alat.
- **Karyawan bisa ditambah dan ditandai keluar** dari aplikasi (Kelola > Karyawan). Catatan lama tetap utuh; kalau nama diganti, catatan lama ikut diganti.
- **Masuk dengan nama pengguna dan sandi** masing-masing. Pemilik bisa menambah pengguna lain dan mengatur catatan apa saja yang boleh diisi (Kelola > Pengguna & sandi).
- **Tampilan dan tata letak bisa diatur** (Kelola > Tampilan & tata letak): warna, mode gelap, ukuran huruf, bentuk sudut, kerapatan, susunan beranda, angka ringkasan, urutan/nama/tampil menu, serta urutan dan isian formulir yang disembunyikan. Ukuran huruf dan mode gelap juga bisa diatur per HP.
- **Produksi Suling** diisi sekali sehari untuk semua alat (jumlah sulingan, operator, kondisi alat). **Absensi** diisi sekali sehari untuk semua karyawan, dengan tombol "isi semua" per kelompok.
- **Laporan dihitung otomatis** ke tab Ringkasan, Rekap Mingguan, Rekap Bulanan, Upah Mingguan, dan Rekap Alat.

## Isi repo

| Folder | Isi |
|---|---|
| `docs/` | Aplikasi web (dibuka di HP, bisa dipasang). Diterbitkan lewat GitHub Pages. |
| `apps-script/kode.gs` | API dan penyiapan Google Sheet. Ditempel di Apps Script milik Sheet "Catatan Sembada Kepuh". |
| `android/` | Pembungkus APK Android. Isinya hanya membuka aplikasi web, jadi perbaikan aplikasi tidak perlu pasang ulang APK. |
| `tes/` | Uji otomatis: `node tes/api_test.js` (logika Apps Script) dan `node tes/ui_test.js` (alur aplikasi di browser). |

## Pasang pertama kali

1. Buat Google Sheet baru bernama **Catatan Sembada Kepuh**.
2. Di Sheet itu: **Ekstensi > Apps Script**. Hapus isi `Code.gs`, tempel seluruh isi `apps-script/kode.gs`, simpan.
3. Pilih fungsi **siapkanSheet** di bagian atas, klik **Jalankan**, lalu izinkan akses. Semua tab dibuat otomatis.
   Akun pemilik: **wildan**. Sandi sementaranya tertulis di tab **Pengaturan** (diminta diganti saat pertama masuk).
4. **Terapkan > Deployment baru > Aplikasi web**. Jalankan sebagai: *Saya*. Yang memiliki akses: *Siapa saja*.
   Salin alamat yang berakhiran `/exec` ke `docs/config.js` (`API_URL`).
5. Di aplikasi: Kelola > Karyawan (masukkan semua karyawan), Kelola > Alat suling (operator tetap dan upah per sulingan), lalu cek Kelola > Tarif upah absensi.

## Memperbarui

- Ubah file di `docs/`, simpan ke cabang `main`. GitHub Pages memperbarui aplikasi dalam 1–2 menit; HP ikut terbarui saat aplikasi dibuka dengan sinyal.
- Kalau `kode.gs` berubah: tempel ulang di Apps Script, lalu **Terapkan > Kelola deployment > pensil > Versi baru > Terapkan**. Alamat `/exec` tetap sama.
- APK hanya perlu dirakit ulang kalau isi `android/` berubah (otomatis lewat GitHub Actions, hasilnya di Releases).

Catatan: kunci tanda tangan APK disimpan di repo supaya rakitan otomatis bisa memperbarui APK lama. APK ini tidak menyimpan data; semua data ada di Google Sheet dan dilindungi nama pengguna + sandi (sandi disimpan terenkripsi).
