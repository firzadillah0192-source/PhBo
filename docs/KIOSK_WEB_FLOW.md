# Kiosk web: proses, UI retro, dan login Google

Update 2026-10-08. URL live: https://nxbooth.gennexbyte.com/kiosk

Status implementasi **PASS** untuk jalur aplikasi dan akses backend yang diuji. Acceptance login Google dengan akun pengguna dan generation AI production masih **PENDING**; tidak ada login impersonation atau paid generation production selama pengujian ini.

## Perilaku sekarang

- `/kiosk` dan semua subroute `/kiosk/*` membuka login/konfirmasi akses terlebih dahulu. Konten kiosk baru dimount setelah backend mengizinkan. Session Google yang masih sah bisa dilanjutkan lewat tombol konfirmasi.
- Login kiosk melalui Google SSO yang memverifikasi signature, audience dan verified email lewat GoogleVerifier existing. Saat ini hanya `firzadillah0192@gmail.com` diizinkan. Public web account/email password login saja tidak memberikan izin kiosk.
- Backend memberi cookie akses kiosk HttpOnly, Secure sesuai config production, SameSite=Lax, path `/api/kiosk`, ditandatangani dan terikat hash cookie sesi akun yang diterbitkan Google login. Setiap request juga memeriksa akun/sesi yang masih aktif dan allowlist. Cookie tanpa proof, proof dari sesi lain, akun lain, serta sesi invalid ditolak.
- Kontrol akses pengguna lain melalui admin belum dibuat pada tahap ini, sesuai “nanti” dari pengguna. Bootstrap allowlist satu email berada pada boundary `kiosk-web.routes.ts`, untuk diganti service permission admin pada tahap berikutnya. Semua admin lain tetap tidak otomatis memperoleh akses.
- UI memakai palet cream, orange, yellow, mint/pink/sky, font Baloo 2, garis tebal dan shadow sesuai tema retro web existing. Font existing direuse beserta OFL.
- Memilih Classic/Basic/Advanced membuka **modal desain di halaman yang sama**, bukan window/tab browser baru. Modal memakai title bar ala window, backdrop, keyboard/focus native dialog, tombol close/Escape. SSO mengikuti widget Google existing.
- Katalog berasal dari backend. Classic mengambil jumlah pose `shot_count` dari layout aktual; Basic memilih template, Advanced memilih experience dan frame style kompatibel.
- Kamera otomatis → live preview → Ambil foto (JPEG dari video kamera) → review/retake → transfer foto backend → generation → polling `QUEUED/PROCESSING/COMPLETED/FAILED` → preview result + download. Tombol Proses foto sudah terhubung, bukan disabled preview lagi.
- Basic/Advanced mengikuti quota/credit/account/provider existing. Kegagalan tidak menghasilkan gambar placeholder atau foto asli yang dilaporkan sebagai hasil AI.
- Double submit dicegah dengan lock synchronous; generation memakai Idempotency-Key existing; upload yang telah diterima direuse pada retry dalam sesi UI yang sama. Setelah job ID diterima, refresh/login ulang dapat melanjutkan polling pekerjaan itu, tanpa generation baru. State yang disimpan hanya ID job dan mode, bukan foto/token/signed URL.
- **Tidak ada pilihan upload/file picker di kiosk.** Foto hanya diambil langsung dari kamera. Transfer bytes foto ke backend tetap dilakukan internal saat tombol Proses ditekan.
- Browser meminta izin kamera, lalu memprioritaskan input berlabel Canon/EOS Webcam bila tersedia. Jika tidak terdeteksi atau tidak dapat dibuka, kamera perangkat dipakai. Izin yang ditolak tidak diprompt berulang; UI meminta pengguna mengizinkan akses lalu mencoba lagi. Kamera dilepas ketika review, proses, reset, logout atau unmount. Track yang berakhir mencoba membuka kamera kembali.
- Deteksi ini memakai sumber video yang diekspos browser, bukan enumerasi perangkat USB Canon/EDSDK. EOS 2000D USB belum diuji sebagai browser video source. Adapter Canon desktop dan printer Windows tetap pending fisik. Browser membutuhkan HTTPS dan izin pengguna; lihat [MDN enumerateDevices](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/enumerateDevices).
- Logout operator mengakhiri sesi dan mengunci kiosk lagi.

## API dan arsitektur

`POST /api/kiosk/login/google`, `POST /api/kiosk/logout`, `GET /api/kiosk/access`.

Jalur aplikasi **terproteksi** memakai alias `/api/kiosk/web/` untuk katalog, upload, kiosk session, generation/status dan result/image/download. Guard dijalankan sebelum handler upload/generation/result. Handler/service/provider/worker existing direuse, tidak dibuat engine baru.

Ini adalah channel web dengan cookie same-origin existing. Desktop tetap menggunakan JSON `/api/v1` melalui `api-nxbooth.gennexbyte.com`, bytes melalui media/storage seperti sebelumnya. Gateway desktop tidak diperluas ke cookie auth `/api` pada tahap ini; tidak ada API key kiosk ditaruh di browser. Upload web mengikuti proxy web existing menuju storage backend, bukan NGINX control gateway yang dibatasi JSON.

Halaman utama, account, admin dan native `/api/v1` tidak diganti. Legacy subroute kiosk dirender lewat gate/flow baru agar tidak jatuh ke alur guest web lama. Claim phone `/claim/...` bukan portal operator kiosk dan tetap menggunakan ownership/claim token existing.

## Hasil tes aktual

| Check | Hasil |
| --- | --- |
| TypeScript build backend + Vite build | **PASS** |
| Frontend snapshot production | **79 PASS**, 0 fail |
| Seleksi Canon, fallback default/perangkat ketika Canon gagal, permission denial tanpa retry, cleanup stream | **5 PASS** unit fixtures |
| Backend access + authorized controller routing + Google grant fixtures | **4 PASS**, 0 fail |
| Browser fixtures 1440/390/320 px, source dan deployed bundle | **PASS** |
| Shutter dari video kamera browser (fake media device), JPEG asli hasil canvas dikirim, tanpa file input, stream berhenti saat review, modal same-window, semua mode payload, Classic count, result image decode, retry/reload existing job, FAILED tanpa output, session revocation, logout, duplicate click | **PASS** |
| Public HTTPS login popup dan widget Google sungguhan ter-render | **PASS** (tanpa login akun pribadi) |
| API production anonymous access/catalog/upload/generation/result | **PASS**, semuanya 401 |
| Homepage dan admin login existing | **PASS**, smoke render |
| API/web container healthy, real `/api/health` | **PASS** |
| Akun Google pengguna → generation production → hasil valid | **PENDING**, pengguna perlu login akun sendiri |
| Kamera/printer fisik | **PENDING**, ditunda sesuai keputusan pengguna |

Browser tests menggunakan fake media device Chromium untuk input kamera dan HTTP fixture termasuk login Google callback dan output PNG sintetis; itu menguji aplikasi, bukan bukti AI production. Backend auth fixtures menggunakan signed test-session/proof dan tidak membuat session atas nama pengguna production. Google verification existing dipakai langsung pada runtime; agent tidak memalsukan login pengguna.

Batas recovery: jika generation telah diterima tetapi response job ID hilang, page reload belum dapat memulihkan job tersebut otomatis. Retry dalam halaman memakai key/payload yang sama; operator sebaiknya tidak memulai sesi lain saat status request masih ambigu. Capture yang belum dikirim hanya ada di memori browser dan hilang saat refresh. Retention file/generation backend mengikuti kebijakan existing, tidak ditambah pada tahap ini.

## Deployment dan source

Release awal akses/proses `/srv/photobooth/releases/kiosk-flow-20261008T102632Z`; update kamera-only frontend `/srv/photobooth/releases/kiosk-flow-20261008T104019Z`.
Images `photobooth-web:kiosk-flow-20261008T104019Z` dan `photobooth-express:kiosk-flow-20261008T102632Z`.

Pada release awal hanya web/API container yang berubah. Update kamera hanya mengganti web container; worker, gateway, image helper, database, Redis dan proyek lain tidak diubah. Tidak ada migration database atau secret baru. Google client ID dan konfigurasi sesi existing dipertahankan. Request ID middleware gateway tetap dibawa.

- UI: `frontend/src/components/kiosk/`, `kioskWebApi.js`, `kioskWebFlow.js`, `kioskCamera.js`.
- Backend: `backend-express/src/routes/kiosk-web.routes.ts`, mount di `migration-app.ts`.
- Tests: `backend-express/test/kiosk-web-access.test.ts`, `frontend/src/kioskWebFlow.test.js`, `frontend/scripts/kiosk-flow-check.mjs`.
- Release: `scripts/deploy_kiosk_flow.py prepare|deploy|status|rollback`. Prepare mendukung pemasangan flow pertama di atas preview, serta update frontend dengan guard backend yang identik (image API dipertahankan). Build memakai snapshot/image live; patch backend hanya menambahkan guard/mount supaya fitur live lainnya dipertahankan.

Artefak screenshot/report `/srv/photobooth/cache/kiosk-flow-check/` dan `/srv/photobooth/cache/kiosk-flow-deployed-check/`.

Laporan [preview sebelumnya](KIOSK_WEB_PREVIEW.md) adalah catatan historis; UI/proses/access kini mengikuti dokumen ini.
