# NXBooth desktop — Windows kiosk

Target Windows x64. Electron + React/Vite untuk UI/orchestrator, C#/.NET 10 untuk adapter perangkat lokal, SQLite (sql.js) untuk jurnal metadata. Foto berupa file lokal, bukan blob database. Tahap ini tidak mengganti backend web/VPS.

**Status:** capture webcam (Canon melalui EOS Webcam Utility), discovery Epson L8050 dan Windows spooler sudah diimplementasikan. Jalur Chrome/Edge memakai aplikasi lokal sebagai jembatan cetak; Desktop memakai adapter yang sama. EDSDK/shutter JPEG asli belum diimplementasikan. Software telah diuji di Linux dengan Electron webcam uji dan adapter simulasi; cetak fisik Windows belum diverifikasi.

Panduan operator lengkap: [WINDOWS_SETUP.md](WINDOWS_SETUP.md). Paket menyediakan `Start-NXBooth.ps1` untuk menjalankan hardware dengan PIN lokal. Driver resmi: [Canon EOS Webcam Utility](https://www.usa.canon.com/digital-cameras/eos-webcam-utility/download) dan [Epson L8050](https://www.epson.co.id/Printer-InkTank/L-Series/Epson-L8050/s/SPT_C11CK37501).

## Jalur jaringan

- JSON: `https://api-nxbooth.gennexbyte.com/api/v1/...`.
- Upload multipart: `https://media-nxbooth.gennexbyte.com/api/v1/kiosk/session/:code/upload`.
- Download foto: URL bertanda tangan dari `https://storage-nxbooth.gennexbyte.com` atau fallback endpoint media yang diizinkan.

Gateway tidak menerima bytes foto. Destination dipatok dalam trusted process; renderer tidak memiliki generic network/fs/child-process API. Download tidak mengikuti redirect atau mengirim cookie ke storage. Server hanya menerima metadata/file references.

## Menjalankan dari source di Windows

Pasang Node.js 22.12+ atau versi kompatibel Vite 8 dan .NET SDK 10. Dari folder `desktop`:

```powershell
npm ci
npm run bridge:build
npm run build
$env:PHBO_DEVICE_MODE = 'hardware' # gunakan simulated hanya untuk tes fixture
# Isi PIN operator milik Anda melalui environment process, jangan commit secret.
$env:PHBO_OPERATOR_PIN = '<PIN operator>'
# Opsional untuk capture/review lokal; wajib untuk mengirim ke backend.
$env:PHBO_KIOSK_API_KEY = '<credential kiosk>'
npm start
```

`.env.example` hanya referensi; aplikasi **tidak otomatis memuat file .env**. Jangan memakai `VITE_*` untuk secret. Buka Operator, masukkan PIN. Mode hardware membuka webcam saat capture; mode simulated memakai foto pilihan operator. Pilih mode/desain, capture, review/retake, proses. Tanpa API key, capture/review bisa berjalan tetapi generation mengembalikan `BACKEND_NOT_CONFIGURED`. Katalog diambil saat startup, sehingga restart diperlukan setelah perubahan konektivitas/config.

## Build portable Windows

```powershell
npm run package:win
```

Script membangun frontend, publish adapter `.NET` self-contained `win-x64`, lalu membuat ZIP Electron di `release/`. ZIP ini belum signed. Ekstrak seluruh folder sebelum menjalankan `NXBooth Desktop.exe`; jalankan dari PowerShell dengan environment yang sama. Portable ZIP adalah distribusi pengujian, belum installer event production. Tidak perlu .NET runtime pada komputer target karena sudah disertakan.

## Test

```powershell
npm run bridge:build
npm test
npm run build
npm run test:ui
npm run test:webcam-ui
```

Linux headless: `xvfb-run -a npm run test:ui`. `PHBO_DOTNET` bisa menunjuk SDK portable. Tes UI menjalankan Electron nyata dengan profil/foto sementara; flag test diabaikan dalam packaged app. `--no-sandbox` pada test Linux hanya untuk launch CI root; konfigurasi renderer tetap `sandbox:true`, `contextIsolation:true`, `nodeIntegration:false`.

## Recovery dan batas tahap

- Jurnal menyimpan foto yang diterima, hash, ID sesi/job, operation key stabil dan status print. Saat restart, upload/processing yang terputus menjadi `RECOVERY_REQUIRED`.
- Recovery operator memakai operation key sesi yang sama. Tidak membuat job generation baru jika ID job sudah tercatat. Generation `FAILED` tetap gagal; tombol recovery tidak memberi kuota gratis/new generation.
- Credential sesi disimpan terpisah memakai Electron `safeStorage` pada Windows. Linux tanpa secret-store yang aman hanya menggunakan memori; sesi online tidak dapat dipulihkan setelah restart. API key/PIN berasal dari environment, bukan SQLite/renderer.
- Claim yang sudah dikonsumsi server tetapi response/cookie hilang memerlukan tindakan operator (`SESSION_ALREADY_CLAIMED`); belum ada endpoint pemulihan credential. Cookie diterima disimpan sebelum body response diproses.
- Print `SUBMITTING` yang terputus menjadi `UNKNOWN`; tidak otomatis dicetak ulang. Print simulasi selalu `SIMULATED`, tidak pernah `PRINTED`.
- Windows mengirim hasil ke Epson L8050 melalui spooler: Classic dua strip 2×6 pada 4R, AI full-fit pada 4R. Status `ACCEPTED` berarti pengiriman, bukan kertas tercetak. Profil ukuran diuji secara matematis; driver/borderless dan hasil fisik masih perlu acceptance di Windows.
- Belum tersedia Canon EDSDK, reprint operator, offline composition, auto-retention lokal atau installer signed.
- Foto dan credential lokal belum memiliki penghapusan otomatis. Gunakan data uji nonpribadi selama scaffold dan hapus profil data uji setelah evaluasi.
- Akun/credential produksi, PC Windows dan perangkat fisik tetap diperlukan untuk acceptance end-to-end. VPS hanya membangun/menguji software; perangkat fisik berada di PC operator.

## Struktur

```text
src/                  UI capture/review/processing/result dan panel operator
electron/             shell, preload IPC terbatas, safeStorage, orchestrator wiring
shared/               journal SQLite, bridge stdio, runtime sesi, control/media clients
native/KioskBridge/   adapter C# JSON-lines v1, Windows L8050 printer + simulated devices
tests/                integration tests dan actual Electron UI smoke
scripts/              Windows portable packaging
```

Adapter protocol v1: `{version:1,id,method,params}` → `{version:1,id,ok,result|error}`. Command `devices.status`, `camera.setFixture`, `camera.capture`, `printer.submit`, `printer.plan`. Path hanya dihasilkan/ditentukan trusted process, tidak diberikan pelanggan. Capture hardware berjalan melalui webcam Electron, bukan `camera.capture` EDSDK. Adapter hardware non-Windows mengembalikan `PRINTER_NOT_CONNECTED`.

Jembatan browser: loopback `127.0.0.1:20253`, exact Host/Origin, Bearer acak per proses yang hanya muncul setelah PIN Operator. Endpoint `/v1/status`, `/v1/jobs/:resultId`, `/v1/print`; hanya bytes hasil dan profil tetap, tanpa path/URL arbitrer. Jurnal berbagi scope result ID untuk Desktop/browser; `SUBMITTING`/`UNKNOWN` menahan cetak ulang.

Rujukan: [Electron security](https://www.electronjs.org/docs/latest/tutorial/security), [arsitektur desktop](../docs/DESKTOP_KIOSK_PLAN.md), [gateway](../docs/PHBO_API_GATEWAY_ARCHITECTURE.md).
