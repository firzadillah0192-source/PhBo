# NXBooth — Canon 2000D + Epson L8050
> **Alur baru:** pasang `NXBooth-Setup-x.y.z.exe`, buat PIN saat pertama dibuka, update dari Menu staf. Lihat [../docs/DESKTOP_UPDATE.md](../docs/DESKTOP_UPDATE.md). Langkah ZIP dan `Start-NXBooth.cmd` di bawah adalah alur lama.

Paket portable Windows 11 x64. Ekstrak **seluruh ZIP**, jangan menjalankan EXE di dalam ZIP. .NET sudah disertakan. Paket belum ditandatangani digital.

## Cepat: pasang di laptop Windows

Kebutuhan: Windows 11 x64, kabel USB data, Chrome atau Edge (untuk jalur browser).

| Yang dipasang | Untuk apa | Wajib |
| --- | --- | --- |
| Canon EOS Webcam Utility (lihat "Cara mengunduh Canon" di bawah) | Membuat EOS 2000D tampil sebagai webcam. Tidak perlu EOS Utility. | Ya, untuk kamera Canon |
| [Driver Epson L8050](https://www.epson.co.id/Printer-InkTank/L-Series/Epson-L8050/s/SPT_C11CK37501) | Printer dikenali Windows dan menerima job cetak | Ya, untuk cetak |
| Node.js 22.12+ dan .NET SDK 10 | Hanya jika membangun dari source | Tidak, paket ZIP sudah membawa .NET |

Tidak ada plugin lain. Canon EDSDK (shutter/JPEG asli) belum diimplementasikan, jadi foto diambil dari video webcam.

### Cara mengunduh Canon EOS Webcam Utility

Halaman Canon USA hanya untuk pelanggan di AS dan sekarang menawarkan versi Pro berlangganan, jadi dari Indonesia coba halaman berikut (urut). Canon memblokir unduhan otomatis; buka dari browser. Unduh hanya dari situs Canon.

1. [Canon Europe, EOS Webcam Utility](https://www.canon-europe.com/cameras/eos-webcam-utility/): daftar kompatibel mencantumkan EOS 2000D, tombol "Download for Windows". Versi yang ditawarkan bisa berlangganan; cek harganya.
2. [Canon Australia](https://www.canon.com.au/apps/eos-webcam-utility): dilaporkan gratis untuk Windows 10/11 64-bit. Belum diverifikasi dari server ini.
3. [Dukungan Canon USA, lokasi unduhan versi Pro](https://support.usa.canon.com/kb/s/article/ART176748).

Jika tidak ada yang bisa diunduh, webcam USB biasa tetap bisa dipakai untuk menguji alur sampai cetak. Aplikasi memakai kamera apa pun yang dikenali Windows.

**Dari paket ZIP** (`NXBooth Desktop-0.1.0-win.zip`, minta dari pemilik/VPS):
1. Cocokkan hash dengan `Get-FileHash "NXBooth Desktop-0.1.0-win.zip"` (nilainya dari pemberi paket).
2. Ekstrak seluruh ZIP ke folder biasa, mis. `C:\NXBooth`. Jangan jalankan dari dalam ZIP.
3. Klik dua kali **`Start-NXBooth.cmd`** (cara termudah; membuka blokir file dan melewati batasan policy PowerShell), lalu isi PIN operator. Alternatif: klik kanan `Start-NXBooth.ps1` → Run with PowerShell. Jika jendela langsung tertutup, buka PowerShell di folder itu dan jalankan `powershell -ExecutionPolicy Bypass -File .\Start-NXBooth.ps1`. Windows SmartScreen mungkin memperingatkan karena paket belum ditandatangani; pilih More info → Run anyway hanya jika file berasal dari pemilik.
4. Opsional, agar tombol proses terhubung ke backend: isi `PHBO_KIOSK_API_KEY` (credential kiosk dari pemilik) di sesi PowerShell yang sama sebelum menjalankan. Jangan di-commit atau dibagikan.

**Dari source** (di laptop, folder `desktop`):

```powershell
git clone git@github.com:firzadillah0192-source/PhBo.git
cd PhBo\desktop
npm ci
npm run bridge:build
npm run package:win   # hasil: release\NXBooth Desktop-0.1.0-win.zip
```

Atau jalankan langsung tanpa paket: lihat "Menjalankan dari source di Windows" di [README.md](README.md).


Driver resmi: Canon EOS Webcam Utility (lihat "Cara mengunduh Canon") dan [Epson L8050](https://www.epson.co.id/Printer-InkTank/L-Series/Epson-L8050/s/SPT_C11CK37501).

## Pasang perangkat

1. Pasang **Canon EOS Webcam Utility** resmi yang mendukung EOS 2000D (Rebel T7/1500D). Sambungkan USB, nyalakan kamera, tutup EOS Utility/Zoom atau aplikasi lain yang memakai kamera. Pilih EOS Webcam Utility di pilihan kamera bila diperlukan. Foto diambil dari video webcam; belum melalui shutter/JPEG asli EDSDK.
2. Pasang **driver Windows Epson L8050** resmi, sambungkan USB, lalu cetak test page Windows.
3. Dalam **Printing preferences** Epson: pilih kertas **4 × 6 inci / 10 × 15 cm / 4R**, **Borderless**, portrait, media yang sesuai dengan kertas foto, dan kualitas foto. Matikan ekspansi/pembesaran otomatis borderless jika driver menyediakan pilihan tersebut. Simpan sebagai pengaturan printer.
4. Jika ada beberapa printer L8050, tentukan nama persis lewat `$env:PHBO_PRINTER_NAME = 'nama printer Windows'` sebelum menjalankan aplikasi.

## Jalur browser (Chrome / Edge)

1. Klik kanan `Start-NXBooth.ps1` → **Run with PowerShell**, pilih PIN operator lokal. Aplikasi harus tetap terbuka untuk layanan cetak.
2. Di aplikasi: **Operator**, masukkan PIN, **Buka kiosk di browser**. Sign in dengan akun yang telah diberi akses kiosk.
3. Ambil **kode koneksi browser** dari panel Operator aplikasi. Di Operator kiosk web, tempel kode lalu hubungkan printer. Kode hanya berlaku selama aplikasi berjalan; setelah reload tab perlu hubungkan kembali.
4. Izinkan kamera dan akses jaringan lokal jika Chrome/Edge meminta. Layanan cetak hanya menerima origin `https://nxbooth.gennexbyte.com`, pada loopback PC ini; tidak dibuka ke internet.
5. Pilih Classic, isi nama event, ambil tiga pose, proses, lalu **Cetak foto**. Classic dicetak **dua strip 2 × 6 inci pada satu lembar 4R**; potong manual di tengah. Hasil AI memakai satu foto penuh yang dipaskan ke 4R tanpa crop.

Tombol cetak di web memerlukan rilis frontend kiosk printer. Jika belum muncul, rilis tersebut belum live.

## Jalur aplikasi Desktop

Capture webcam dan printer yang sama juga tersedia langsung di aplikasi. Untuk generation backend, jalur Desktop memakai **credential kiosk yang sudah ada**, bukan login Google browser. Konfigurasikan `PHBO_KIOSK_API_KEY` sebagai environment process sebelum launcher; jangan simpan di frontend, membagikannya, atau menyalin ke kode koneksi printer. Tanpa credential, capture/review lokal berjalan tetapi proses backend belum dapat dijalankan. Jalur browser memakai sign in web yang sudah tersedia.

## Periksa hasil pertama

- **Siap** berarti driver L8050 ditemukan, belum membuktikan kertas/ink/printer online.
- **Dikirim ke printer** berarti Windows menerima pekerjaan, bukan konfirmasi kertas sudah keluar. Periksa antrian Windows dan kertasnya.
- Bila pengiriman terputus atau status tidak pasti, aplikasi menahan cetak ulang agar tidak menggandakan hasil. Periksa antrian/kertas; jangan mengulang secara otomatis.
- Cetak satu hasil uji, ukur lebar/panjang strip dan periksa tepi, posisi foto, event, tanggal, serta QR. Scanner QR harus membuka hasil yang benar. Ukuran dan ekspansi borderless perlu diuji pada driver/kertas fisik Anda.

Pengujian di server mencakup UI webcam Electron, alur browser, layout matematis 4R, jurnal cetak dan simulasi adapter. **Canon/Epson fisik belum diuji di PC pengguna.** Foto lokal Desktop belum dihapus otomatis; kelola data uji di PC operator.
