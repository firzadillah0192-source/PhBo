# NXBooth — Canon 2000D + Epson L8050

Paket portable Windows 11 x64. Ekstrak **seluruh ZIP**, jangan menjalankan EXE di dalam ZIP. .NET sudah disertakan. Paket belum ditandatangani digital.

Driver resmi: [Canon EOS Webcam Utility](https://www.usa.canon.com/digital-cameras/eos-webcam-utility/download) dan [Epson L8050](https://www.epson.co.id/Printer-InkTank/L-Series/Epson-L8050/s/SPT_C11CK37501).

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
