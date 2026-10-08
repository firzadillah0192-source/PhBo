# NXBooth desktop — tahap scaffold

Target Windows x64. Electron + React/Vite untuk UI/orchestrator, C#/.NET 10 untuk adapter perangkat lokal, SQLite (sql.js) untuk jurnal metadata. Foto berupa file lokal, bukan blob database. Tahap ini tidak mengganti backend web/VPS.

**Status:** simulasi kamera dan cetak; belum integrasi EDSDK/Windows spooler. Simulasi kamera menyalin foto JPEG/PNG pilihan operator. Generation tetap meminta hasil backend; tidak ada hasil AI buatan lokal/placeholder. Endpoint uji pada automated tests memakai HTTP fixture server, bukan provider production.

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
$env:PHBO_DEVICE_MODE = 'simulated'
# Isi PIN operator milik Anda melalui environment process, jangan commit secret.
$env:PHBO_OPERATOR_PIN = '<PIN operator>'
# Opsional untuk capture/review lokal; wajib untuk mengirim ke backend.
$env:PHBO_KIOSK_API_KEY = '<credential kiosk>'
npm start
```

`.env.example` hanya referensi; aplikasi **tidak otomatis memuat file .env**. Jangan memakai `VITE_*` untuk secret. Buka Operator, masukkan PIN, pilih foto simulasi. Pilih mode/desain, capture, review/retake, proses. Tanpa API key, capture/review bisa berjalan tetapi generation mengembalikan `BACKEND_NOT_CONFIGURED`. Katalog diambil saat startup, sehingga restart diperlukan setelah perubahan konektivitas/config.

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
```

Linux headless: `xvfb-run -a npm run test:ui`. `PHBO_DOTNET` bisa menunjuk SDK portable. Tes UI menjalankan Electron nyata dengan profil/foto sementara; flag test diabaikan dalam packaged app. `--no-sandbox` pada test Linux hanya untuk launch CI root; konfigurasi renderer tetap `sandbox:true`, `contextIsolation:true`, `nodeIntegration:false`.

## Recovery dan batas tahap

- Jurnal menyimpan foto yang diterima, hash, ID sesi/job, operation key stabil dan status print. Saat restart, upload/processing yang terputus menjadi `RECOVERY_REQUIRED`.
- Recovery operator memakai operation key sesi yang sama. Tidak membuat job generation baru jika ID job sudah tercatat. Generation `FAILED` tetap gagal; tombol recovery tidak memberi kuota gratis/new generation.
- Credential sesi disimpan terpisah memakai Electron `safeStorage` pada Windows. Linux tanpa secret-store yang aman hanya menggunakan memori; sesi online tidak dapat dipulihkan setelah restart. API key/PIN berasal dari environment, bukan SQLite/renderer.
- Claim yang sudah dikonsumsi server tetapi response/cookie hilang memerlukan tindakan operator (`SESSION_ALREADY_CLAIMED`); belum ada endpoint pemulihan credential. Cookie diterima disimpan sebelum body response diproses.
- Print `SUBMITTING` yang terputus menjadi `UNKNOWN`; tidak otomatis dicetak ulang. Print simulasi selalu `SIMULATED`, tidak pernah `PRINTED`.
- Tidak ada live view, Canon EDSDK, discovery printer, Windows spooler, profil media/raster 4R tervalidasi, dua strip pada satu lembar 4R, reprint operator, offline composition, auto-retention, event binding atau installer signed pada tahap ini. Preview adalah hasil master backend; bukan bukti layout fisik siap cetak. Kode tidak mengirim pekerjaan ke printer nyata.
- Foto dan credential lokal belum memiliki penghapusan otomatis. Gunakan data uji nonpribadi selama scaffold dan hapus profil data uji setelah evaluasi.
- Akun/credential produksi, PC Windows dan perangkat fisik tetap diperlukan untuk acceptance end-to-end. VPS hanya membangun/menguji scaffold.

## Struktur

```text
src/                  UI capture/review/processing/result dan panel operator
electron/             shell, preload IPC terbatas, safeStorage, orchestrator wiring
shared/               journal SQLite, bridge stdio, runtime sesi, control/media clients
native/KioskBridge/   adapter C# JSON-lines v1, simulated camera/printer
tests/                integration tests dan actual Electron UI smoke
scripts/              Windows portable packaging
```

Adapter protocol v1: `{version:1,id,method,params}` → `{version:1,id,ok,result|error}`. Command `devices.status`, `camera.setFixture`, `camera.capture`, `printer.submit`. Path hanya dihasilkan/ditentukan trusted process, tidak diberikan pelanggan. Mode hardware tanpa implementasi mengembalikan `CAMERA_NOT_CONNECTED` / `PRINTER_NOT_CONNECTED`.

Rujukan: [Electron security](https://www.electronjs.org/docs/latest/tutorial/security), [arsitektur desktop](../docs/DESKTOP_KIOSK_PLAN.md), [gateway](../docs/PHBO_API_GATEWAY_ARCHITECTURE.md).
