# NXBooth Desktop: panduan pemilik dan operator

Panduan ini menggantikan alur lama (ZIP + `Start-NXBooth.cmd`) di `WINDOWS_SETUP.md`. Driver kamera dan printer tetap seperti di sana.

## A. Sekali saja, oleh pemilik

1. **Beri akses staf.** Admin -> Admin Users -> tambahkan nama, **email akun NXBooth mereka**, role **Kiosk operator (desktop kiosk only)**. Orang ini hanya bisa mengaktifkan dan memakai kiosk, bukan membuka halaman admin. Pemilik (superadmin) otomatis boleh. Untuk mencabut akses: ubah menjadi **Disabled**; semua PC orang itu berhenti diizinkan pada permintaan berikutnya.
2. **Siapkan laptop Windows untuk build installer** (sekali): pasang Git, Node.js 22 atau lebih baru, dan .NET SDK 10. Lalu:
   ```powershell
   git clone git@github.com:firzadillah0192-source/PhBo.git
   cd PhBo\desktop
   npm ci
   ```
   Build tidak bisa dilakukan di server Linux (butuh Windows).

## Aturan nomor versi

Format `BESAR.SEDANG.KECIL`, misalnya `1.1.19`:

| Bagian | Naik kapan | Contoh |
| --- | --- | --- |
| **BESAR** (pertama) | Perubahan besar atau tidak kompatibel: desain ulang, alur baru, data lama harus dimigrasi | `1.1.19` -> `2.0.0` |
| **SEDANG** (kedua) | Pembaruan fitur, model, desain, dll | `1.1.19` -> `1.2.0` |
| **KECIL** (ketiga) | Perbaikan kecil / patching | `1.1.19` -> `1.1.20` |

Saat satu bagian naik, bagian di kanannya kembali ke 0. Versi pengembangan sekarang: **1.1.0** (mode event dan progres update); installer yang sudah dipublish saat handoff: **1.0.1**. Server menerima tiga angka (masing-masing sampai 4 digit) dan membandingkannya sebagai angka, jadi `1.10.0` lebih baru dari `1.9.0`. Saat mengubah versi di `desktop\package.json`, sinkronkan juga `package-lock.json`.

## B. Membuat installer (setiap rilis)

1. Naikkan nomor versi di `desktop\package.json` sesuai aturan di atas (misalnya `"version": "1.0.1"`). **Wajib naik**: kiosk hanya menawarkan update jika versi di server lebih baru dari versi terpasang.
2. Di folder `desktop`:
   ```powershell
   npm run package:win
   ```
   Hasil: `release\NXBooth-Setup-1.0.1.exe`.
3. Peringatan "Windows protected your PC" saat pertama menjalankan adalah normal (installer belum ditandatangani): klik **More info** lalu **Run anyway**. Penandatanganan sertifikat bersifat opsional, lihat `docs/DESKTOP_UPDATE.md`.

## C. Memasang di PC kiosk (instalasi pertama)

1. Salin `NXBooth-Setup-x.y.z.exe` ke PC kiosk dan jalankan. Terpasang per pengguna (tanpa UAC) dan membuat shortcut di Desktop dan Start Menu; aplikasi langsung terbuka.
2. Aplikasi menampilkan **kode**, misalnya `ABCD-2345`.
3. Dari HP atau PC lain, **sudah login ke NXBooth** dengan akun yang berperan Kiosk operator, buka `https://nxbooth.gennexbyte.com/kiosk-activate.html`, masukkan kode, periksa nama komputer, lalu **Izinkan**.
4. Dalam beberapa detik kiosk masuk sendiri. Kode berlaku 10 menit; jika habis, tekan **Buat kode baru**.
5. Aplikasi menawarkan **PIN kunci layar** (opsional, minimal 4 karakter). PIN ini hanya mencegah tamu membuka Menu staf; identitas tetap akun.
6. Sambungkan kamera dan printer, lalu cek di layar **Cek perangkat**.

Masuk bertahan sekitar 14 hari dan diperpanjang otomatis selama kiosk dipakai. Tanpa internet foto tetap bisa diambil; memproses foto dan update butuh internet.

## D. Mengirim update ke kiosk

1. Build installer baru (bagian B) dengan versi yang lebih tinggi.
2. Di server, publish: `python3 -I scripts/publish_desktop_update.py /path/NXBooth-Setup-1.0.1.exe --notes "Perbaikan kamera"`. Skrip menghitung hash, menaruh file di `/srv/photobooth/desktop-updates`, dan menyisakan 3 installer terakhir (`--keep N` untuk mengubah).
3. Di kiosk, **tidak ada sesi foto yang berjalan**: **Menu staf** -> (PIN) -> **Cek update** -> **Pasang versi x.y.z**. Mulai 1.1.0, aplikasi menampilkan tahap unduhan, progress bar, persen, dan MB terunduh/total. Setelah ukuran dan hash diperiksa (serta tanda tangan bila dikonfigurasi), tahap berubah menjadi Memasang. Aplikasi menutup setelah Windows menerima proses installer, lalu installer membuka aplikasi kembali. Jika installer gagal dijalankan, aplikasi tetap terbuka dan menampilkan error.

## Mode event online (v1.1.0)

1. Masuk akun, sambungkan webcam dan printer, lalu buka **Menu staf** (PIN bila dipasang).
2. Di **Mode event**, isi **Nama event** dan **Tanggal event**. Centang template yang boleh dipakai: Classic, Basic, Advanced, atau campurannya. Centang **Aktifkan mode event di kiosk ini**, lalu **Simpan mode event** dan **Tutup menu**. Pengaturan tersimpan di PC ini. Tutup sesi yang masih aktif sebelum mengaktifkan event.
3. Tamu menekan **Mulai**. Bila hanya satu template, langsung ke kamera; bila beberapa, tamu memilih template dulu. Kamera mengambil foto otomatis setelah hitung mundur **5 detik** per foto. Ada **4 detik** untuk **Ulangi foto ini** sebelum lanjut ke foto berikutnya.
4. Setelah semua foto selesai, aplikasi memproses otomatis, mengirim hasil ke printer, dan menampilkan QR unduhan. Bila printer tidak terdeteksi, layar menampilkan **Printer di luar jangkauan**; QR tetap tersedia. **Coba cetak lagi** dipakai setelah perangkat diperiksa.
5. **Mulai ulang** kembali ke layar awal tanpa PIN. Layar hasil juga kembali otomatis setelah **120 detik**. Jika koneksi terputus, gunakan **Coba lagi** atau **Mulai ulang** pada layar gagal. Di mode manual, tombol **Mulai ulang** juga tersedia setelah hasil selesai.
6. Untuk kembali ke mode manual, buka Menu staf, hilangkan centang **Aktifkan mode event di kiosk ini**, lalu simpan.

Mode event membutuhkan internet untuk proses dan QR. Basic/Advanced memakai kredit AI sesuai aturan server; Classic tidak memakai AI. Tanggal event ditampilkan di layar; tanggal yang dicetak pada frame Classic tetap mengikuti waktu pengambilan foto. Alur event sudah diuji dengan webcam browser. Integrasi Canon USB sedang dikerjakan di sesi terpisah dan masih memerlukan validasi gabungan serta tes perangkat Windows sebelum dinyatakan berfungsi.

### Apa yang terjadi pada versi lama dan datanya

- **Program lama otomatis diganti.** Installer menimpa versi terpasang; tidak ada dua salinan dan tidak perlu menghapus manual.
- **Data kiosk tetap ada**: jurnal sesi, foto lokal, login, dan PIN (di folder data pengguna aplikasi). Ini disengaja agar update tidak menghilangkan sesi atau membuat kiosk minta masuk lagi.
- **Installer hasil unduhan** dihapus otomatis saat aplikasi dibuka kembali. Di server, installer lama dipangkas oleh skrip publish.
- **Perubahan besar yang membutuhkan data lama dibersihkan** (misalnya struktur jurnal berubah) tidak terjadi otomatis. Bila rilis seperti itu muncul, rilis harus membawa kode migrasi atau langkah reset yang ditulis khusus. Sebagai pegangan: jangan menghapus folder data tanpa memastikan semua sesi sudah selesai.
- **Tidak ada update paksa.** Kiosk baru memperbarui diri saat staf menekan tombolnya. Kiosk yang belum diperbarui tetap bisa dipakai selama API masih kompatibel.
- **Rollback:** publish ulang installer versi sebelumnya dengan nomor versi **lebih tinggi** (misalnya isi sama dengan 1.0.0 tetapi diberi versi 1.0.2). Updater tidak menurunkan versi.

## Tes kamera Canon dan kirim log (v1.0.1)

Untuk menguji EOS 2000D langsung dari aplikasi (tanpa EOS Utility atau program terpisah): **Menu staf** -> **Tes kamera Canon**.

1. Kamera ON, mode foto (bukan Auto lock), kabel USB terhubung. Tutup EOS Utility, Zoom, dan aplikasi lain yang memakai kamera. Tidak boleh ada sesi foto yang berjalan.
2. Tes membaca daftar kamera lewat USB, mencoba live view (3 frame), lalu mengambil satu foto uji yang langsung dihapus. Tiap langkah tampil dengan OK/GAGAL, waktu (ms), dan kode error.
3. **Kirim log ke server** mengirim ringkasan: versi aplikasi, versi Windows, nama PC, status perangkat, hasil tes kamera (model, empat digit akhir serial), dan sisa `startup-error.log` bila ada. Tidak ada foto, token, atau cookie. Perlu sudah masuk akun.
4. Di server, laporan ada di `/srv/photobooth/desktop-diagnostics/YYYY-MM-DD.jsonl` (satu baris JSON per laporan, disimpan 30 hari, maksimum 2 MB per hari).

Bila kamera tidak ditemukan atau live view kosong, kirim log lalu beri tahu pengembang; jalur cadangan (digiCamControl) menyusul sesuai hasilnya.

## E. Kendala umum

| Gejala | Penyebab dan tindakan |
| --- | --- |
| Kode tidak ditemukan | Kedaluwarsa (10 menit) atau salah ketik. Buat kode baru di kiosk. |
| "Akun ini belum diizinkan" | Email belum diberi role Kiosk operator atau akun Disabled. |
| "Anda belum masuk" di halaman aktivasi | Login NXBooth dulu di browser yang sama, lalu buka halaman itu lagi. |
| Kiosk meminta masuk lagi / "sesi masuk berakhir" | Akun dicabut atau token habis. Menu staf -> Keluar -> Masuk, lalu setujui kode baru. |
| Update ditolak "selesaikan sesi dulu" | Tutup sesi foto yang sedang berjalan. |
| "File update rusak (hash tidak cocok)" | Unduhan terganggu. Coba lagi; bila berulang, publish ulang installer. |
| Tidak ada tombol Cek update aktif | Belum masuk akun. Masuk lewat Menu staf. |
| Menu staf terkunci dan PIN lupa | Pemilik: Menu staf tidak bisa dibuka tanpa PIN. Hapus data aplikasi pengguna itu (login perlu diulang) atau pasang ulang. |
