# Laporan scaffold desktop NXBooth

Tanggal: 2026-10-08. Status keseluruhan **PARTIAL** untuk aplikasi event production; scope scaffold software **PASS**. Pengujian hardware ditunda sesuai permintaan pengguna karena lingkungan ini VPS.

## Hasil implementasi

Source baru terisolasi di [`desktop/`](../desktop/README.md), memakai Electron + React/Vite dan adapter C#/.NET 10 JSON-lines. Backend web existing tetap dipakai dan tidak dimigrasikan.

- UI pilih mode/desain, capture, review, retake, actual backend processing, preview result dan simulasi cetak.
- Panel operator dengan PIN dari environment, pemilihan foto simulasi dan recovery/tutup sesi.
- Adapter kamera menyalin fixture JPEG/PNG operator ke file baru; setiap capture berlabel simulasi. Mode hardware yang belum tersedia gagal secara eksplisit.
- SQLite metadata lokal, file foto terpisah, operation key tetap untuk reserve/upload/generation, hash capture/result, jurnal cetak dan recovery interrupted state.
- Credential sesi terpisah dari database/renderer; safeStorage digunakan jika encryption tersedia. Linux tanpa secret store aman hanya menyimpan credential dalam memori. DPAPI Windows belum diuji pada VPS Linux.
- IPC renderer terbatas, validasi command dan sender, sandbox/context isolation, CSP dan custom protocol, blok navigation/pop-up/permission.
- Generation hanya memakai status/hasil backend nyata pada runtime aplikasi. Backend belum dikonfigurasi berarti capture/review lokal saja. Test fixture server di automated tests bukan generation AI production.

## Gateway dan media

| Jenis request | Tujuan |
| --- | --- |
| Katalog, reserve session, claim, generate, status, signed-URL metadata | `api-nxbooth.gennexbyte.com` — JSON saja |
| File capture multipart | `media-nxbooth.gennexbyte.com` |
| Hasil foto | Signed GET `storage-nxbooth.gennexbyte.com` atau fallback result endpoint media |

Client media menolak tujuan/route di luar allowlist, redirect, file bukan JPEG/PNG dan response terlalu besar. Cookie sesi tidak dikirim ke storage. Client kontrol menolak route media/binary payload. Signed URL tidak diberikan pada renderer atau disimpan sebagai preview pelanggan.

## Validasi aktual

| Pemeriksaan | Hasil |
| --- | --- |
| `.NET build` Release Linux | **PASS**, 0 warning, 0 error |
| `npm run build` | **PASS**, React/Vite production bundle |
| `PHBO_DOTNET=... npm test` | **PASS**, 7 integration tests |
| `PHBO_DOTNET=... xvfb-run -a npm run test:ui` | **PASS**, Electron nyata di Linux |
| `PHBO_DOTNET=... npm run package:win` | **PASS**, frontend + self-contained adapter win-x64 + portable ZIP |
| Katalog live HTTPS lewat ControlClient | **PASS**, frames 35, templates 15, experiences 44 saat diperiksa; tanpa API key/paid generation |
| Eksekusi portable ZIP di Windows | **PENDING**, memerlukan PC Windows |
| Kamera Canon EOS 2000D USB dan printer Epson/Canon fisik | **PENDING** sesuai permintaan pengguna |
| Desktop → production generation → hasil → cetak fisik | **PENDING**, tidak dijalankan pada tahap ini |

Tes integrasi menguji: SQLite reopen/recovery, ambiguous print menjadi `UNKNOWN`, adapter .NET nyata dengan fixture, penolakan path/ID salah, physical-mode error, pemisahan HTTP JSON/multipart/signed download, generation `FAILED` tanpa output, pencegahan cetak ulang, retake, backend tidak tersedia, penolakan redirect/non-image, dan recovery tanpa credential.

Tes Electron menguji node/process renderer tidak tersedia, capture/review, error backend tanpa hasil/cetak, PIN salah/benar serta reset sesi. Masalah startup ESM yang ditemukan saat tes sudah diperbaiki dan dites ulang. Test Linux memakai `--no-sandbox` untuk launcher CI, sementara preferensi renderer tetap `sandbox:true`.

Tidak ada perubahan container, port, Cloudflare, gateway atau backend production pada tahap desktop ini. Semua HTTP fixture untuk integration tests lokal dan dibersihkan setelah tes.

## Paket dan cara mencoba

Portable ZIP unsigned dibuat sebagai build artifact lokal, tidak dimasukkan Git. Lokasi final artifact dan SHA-256 dicatat bersama file build di `/srv/photobooth/cache/desktop-scaffold-20261008/`. Baca [`desktop/README.md`](../desktop/README.md) untuk build, environment operator/API key, simulasi dan langkah mencoba di Windows. ZIP harus diekstrak lengkap; adapter .NET sudah disertakan.

## Batas dan pekerjaan berikutnya

Ini belum aplikasi siap event. Canon EDSDK/live view, driver/spooler printer lintas merek, koneksi/reconnect hardware, media 4R/crop/borderless, layout dua strip pada satu lembar 4R, physical print status, retention foto otomatis, event binding, UI preview katalog, reprint operator dan installer signed belum diimplementasikan/divalidasi. Print simulasi hanya jurnal `SIMULATED`, tidak mengirim job fisik. Master preview belum menjadi raster cetak 4R tervalidasi.

Recovery claim masih memiliki batas existing API: jika claim sudah dikonsumsi tetapi cookie tidak sampai ke desktop, server dapat mengembalikan `SESSION_ALREADY_CLAIMED`; operator harus meninjau sesi. App menyimpan cookie sebelum parsing body untuk mengurangi risiko, tanpa menjanjikan recovery pada response yang hilang sepenuhnya.

Tahap ini berhenti setelah scaffold tervalidasi dan dokumentasi dipublikasikan. Tahap hardware/event acceptance dilakukan pada PC Windows setelah perangkat tersedia.
