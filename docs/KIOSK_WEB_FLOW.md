# Kiosk web: proses, UI retro, dan login Google

Update 2026-10-09. URL live: https://nxbooth.gennexbyte.com/kiosk

Status implementasi **PASS** untuk jalur aplikasi dan akses backend yang diuji. Acceptance login Google dengan akun pengguna dan generation AI production masih **PENDING**; tidak ada login impersonation atau paid generation production selama pengujian ini.

## Perilaku sekarang

- `/kiosk` dan semua subroute `/kiosk/*` membuka login/konfirmasi akses terlebih dahulu. Konten kiosk baru dimount setelah backend mengizinkan. Session Google yang masih sah bisa dilanjutkan lewat tombol konfirmasi.
- Login kiosk melalui Google SSO yang memverifikasi signature, audience dan verified email lewat GoogleVerifier existing. Saat ini hanya `firzadillah0192@gmail.com` diizinkan. Public web account/email password login saja tidak memberikan izin kiosk.
- Backend memberi cookie akses kiosk HttpOnly, Secure sesuai config production, SameSite=Lax, path `/api/kiosk`, ditandatangani dan terikat hash cookie sesi akun yang diterbitkan Google login. Setiap request juga memeriksa akun/sesi yang masih aktif dan allowlist. Cookie tanpa proof, proof dari sesi lain, akun lain, serta sesi invalid ditolak.
- Kontrol akses pengguna lain melalui admin belum dibuat pada tahap ini, sesuai “nanti” dari pengguna. Bootstrap allowlist satu email berada pada boundary `kiosk-web.routes.ts`, untuk diganti service permission admin pada tahap berikutnya. Semua admin lain tetap tidak otomatis memperoleh akses.
- UI memakai palet cream, orange, yellow, mint/pink/sky, font Baloo 2, garis tebal dan shadow sesuai tema retro web existing. Font existing direuse beserta OFL.
- Memilih Classic/Basic/Advanced membuka **modal desain di halaman yang sama**, bukan window/tab browser baru. Modal memakai title bar ala window, backdrop, keyboard/focus native dialog, tombol close/Escape. SSO mengikuti widget Google existing.
- Katalog berasal dari backend. Classic mengambil jumlah pose `shot_count` dari layout aktual; Basic memilih template, Advanced memilih experience dan frame style kompatibel.
- Kamera otomatis → live preview/countdown **5 detik** → foto otomatis (JPEG dari video kamera) → **popup review tiap pose** → Next/Retake → transfer foto backend otomatis setelah semua pose → generation → polling `QUEUED/PROCESSING/COMPLETED/FAILED` → preview result + QR public claim + download. Tidak ada tombol shutter, review atau proses manual dalam jalur normal.
- Basic/Advanced mengikuti quota/credit/account/provider existing. Kegagalan tidak menghasilkan gambar placeholder atau foto asli yang dilaporkan sebagai hasil AI.
- Double submit dicegah dengan lock synchronous; generation memakai Idempotency-Key existing; upload yang telah diterima direuse pada retry dalam sesi UI yang sama. Setelah job ID diterima, refresh/login ulang dapat melanjutkan polling pekerjaan itu, tanpa generation baru. State recovery generation menyimpan hanya ID job dan mode, bukan foto/token akun/signed URL. QR memakai token public claim di sessionStorage per hasil, sesuai alur delivery web existing, untuk reuse link setelah reload.
- Popup review menampilkan take terakhir. **Next (10)** menghitung mundur 10 detik; klik melanjutkan langsung, timeout melanjutkan otomatis. Untuk Classic, pose berikutnya kembali memakai countdown 5 detik. Setelah review pose terakhir, backend diproses otomatis.
- **Retake (3)** berarti tiga kali kesempatan mengulang **per pose** (take awal + maksimal tiga retake). Klik mengurangi sisa kesempatan dan mengulang countdown 5 detik; sisa nol membuat tombol disabled. Kesempatan kembali tiga saat lanjut ke pose berikutnya. Pose yang diterima tetap tersimpan.
- Keputusan Next/Retake/timeout dilindungi lock berdasarkan foto yang direview sehingga tidak memulai dua pose/proses. Countdown dibatalkan saat tahap berubah, kamera terputus atau komponen unmount. Error pengiriman masuk panel retry manual, tanpa loop request otomatis. Countdown tidak digunakan untuk memalsukan status generation.
- **Tidak ada pilihan upload/file picker di kiosk.** Foto hanya diambil langsung dari kamera. Transfer bytes foto ke backend tetap dilakukan internal setelah review pose terakhir diterima lewat Next atau timeout.
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
| Frontend snapshot production | **93 PASS**, 0 fail |
| Timer 5/10 detik, cancellation dan elapsed deadline | **3 PASS** unit fixtures |
| Seleksi Canon, fallback default/perangkat ketika Canon gagal, permission denial tanpa retry, cleanup stream, normalisasi no-crop/minimum zoom, driver rejection tidak memblokir kamera | **7 PASS** unit fixtures |
| Backend access + authorized controller routing + Google grant + QR claim fixtures | **5 PASS**, 0 fail |
| Browser fixtures 1440/390/320 px, source dan deployed bundle | **PASS** |
| Capture otomatis 5 detik, popup tiap pose, Next 10 detik timeout/klik, retake 3→0 dan reset per pose, auto-process, submit error tanpa auto-loop, video kamera browser (fake media device), JPEG asli hasil canvas dikirim, tanpa file input, stream berhenti saat review, modal same-window, semua mode payload, Classic count, result image decode, retry/reload existing job, FAILED tanpa output, session revocation, logout, duplicate click | **PASS** |
| Public HTTPS login popup dan widget Google sungguhan ter-render | **PASS** (tanpa login akun pribadi) |
| API production anonymous access/catalog/upload/generation/result | **PASS**, semuanya 401 |
| Homepage dan admin login existing | **PASS**, smoke render |
| API/web container healthy, real `/api/health` | **PASS** |
| Akun Google pengguna → generation production → hasil valid | **PENDING**, pengguna perlu login akun sendiri |
| Kamera/printer fisik | **PENDING**, ditunda sesuai keputusan pengguna |

Browser tests menggunakan fake media device Chromium untuk input kamera dan HTTP fixture termasuk login Google callback dan output PNG sintetis; itu menguji aplikasi, bukan bukti AI production. Backend auth fixtures menggunakan signed test-session/proof dan tidak membuat session atas nama pengguna production. Google verification existing dipakai langsung pada runtime; agent tidak memalsukan login pengguna.

Batas recovery: jika generation telah diterima tetapi response job ID hilang, page reload belum dapat memulihkan job tersebut otomatis. Retry dalam halaman memakai key/payload yang sama; operator sebaiknya tidak memulai sesi lain saat status request masih ambigu. Capture yang belum dikirim hanya ada di memori browser dan hilang saat refresh. Retention file/generation backend mengikuti kebijakan existing, tidak ditambah pada tahap ini.

## Deployment dan source

Release awal akses/proses `/srv/photobooth/releases/kiosk-flow-20261008T102632Z`; update kamera frontend `/srv/photobooth/releases/kiosk-flow-20261008T104019Z`; update capture/review otomatis `/srv/photobooth/releases/kiosk-flow-20261009T023143Z`; normalisasi preview webcam `/srv/photobooth/releases/kiosk-flow-20261009T023940Z`; QR hasil `/srv/photobooth/releases/kiosk-flow-20261009T025649Z`.
Images saat update otomatis: `photobooth-web:kiosk-flow-20261009T025649Z`; API existing `photobooth-express:credit-checkout-api-20261009T021554Z` dipertahankan.

Pada release awal hanya web/API container yang berubah. Update kamera, otomatis dan QR hanya mengganti web container; worker, gateway, image helper, database, Redis dan proyek lain tidak diubah. Tidak ada migration database atau secret baru. Google client ID dan konfigurasi sesi existing dipertahankan. Request ID middleware gateway tetap dibawa.

- UI: `frontend/src/components/kiosk/`, `kioskWebApi.js`, `kioskWebFlow.js`, `kioskCamera.js`, `kioskCountdown.js`.
- Backend: `backend-express/src/routes/kiosk-web.routes.ts`, mount di `migration-app.ts`.
- Tests: `backend-express/test/kiosk-web-access.test.ts`, `frontend/src/kioskWebFlow.test.js`, `kioskCamera.test.js`, `kioskCountdown.test.js`, `frontend/scripts/kiosk-flow-check.mjs`.
- Release: `scripts/deploy_kiosk_flow.py prepare|deploy|status|rollback`. Prepare mendukung pemasangan flow pertama di atas preview, serta update frontend dengan guard backend yang identik (image API dipertahankan). Build memakai snapshot/image live; patch backend hanya menambahkan guard/mount supaya fitur live lainnya dipertahankan.

Validasi update otomatis: `npm test`, `npm run build`, `node frontend/scripts/kiosk-flow-check.mjs` (source dan deployed, clock browser dipercepat untuk 5/10 detik), `python3 scripts/deploy_kiosk_flow.py prepare|deploy|status`, serta `/api/health`. Tidak ada backend/controller yang diubah pada update otomatis/QR; QR memakai controller existing dan tes akses diperluas menjadi 5 PASS.

Artefak screenshot/report update otomatis `/srv/photobooth/cache/kiosk-auto-check/` dan `/srv/photobooth/cache/kiosk-auto-deployed-check/`.

Laporan [preview sebelumnya](KIOSK_WEB_PREVIEW.md) adalah catatan historis; UI/proses/access kini mengikuti dokumen ini.

## Perbaikan live preview webcam (2026-10-09)

Pengguna melaporkan preview laptop/webcam USB terasa zoom. Diff update countdown tidak mengubah constraints sumber video atau menambahkan zoom, sehingga penyebab fisik belum dapat direproduksi di VPS. Pengaturan sebelumnya memakai negosiasi/default browser.

Perubahan `kioskCamera.js`: setiap request mengutamakan `resizeMode: none`. Setelah sumber final dipilih, hanya jika capability diiklankan, track meminta `resizeMode: none` secara exact dan zoom minimum yang didukung. Kamera tanpa kontrol tersebut tetap berfungsi; penolakan driver tidak menutup stream. Tidak memaksakan resolusi/aspect ratio baru atau mengubah pilihan Canon-first. [Capabilities browser](https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrack/getCapabilities) menentukan kontrol yang tersedia.

Preview CSS memakai tinggi otomatis sesuai video, `object-fit: contain`, posisi tengah, tanpa transform, serta batas tinggi layar; minimum tinggi yang memaksa elemen video menjadi lebih besar dihapus. File hasil capture tetap memakai seluruh dimensi frame video.

Validasi source dan deployed 1440/390/320 px memeriksa `getSettings().resizeMode === 'none'`, object-fit contain, transform none dan video berada di dalam container, kemudian menjalankan auto-capture/review/retake/process seperti biasa. Kamera browser adalah fake media device Chromium; ini belum memastikan persepsi zoom pada webcam pengguna. Acceptance webcam fisik setelah hard refresh masih **PENDING**. Bukti update ini di `/srv/photobooth/cache/kiosk-native-camera-check/` dan `/srv/photobooth/cache/kiosk-native-camera-deployed-check/`.

## QR hasil kiosk (2026-10-09)

QR sekarang otomatis muncul setelah hasil backend selesai. `KioskResultQr.jsx` meminta `POST /api/kiosk/web/results/:id/claim` dengan `kiosk: true`, lalu memakai `qr_payload` server untuk link `/r/:token`. Ini public result claim existing, bukan URL gambar yang memerlukan cookie operator. Tidak ada backend route/schema/gateway baru atau perubahan halaman public viewer. Phone membuka hasil melalui `/api/public/results/:token/image` tanpa login operator; expiry/revocation/deletion/payment checks tetap milik backend existing.

UI menampilkan QR, link foto dan masa berlaku backend. QR tidak dibuat dari placeholder jika request gagal. Tombol retry untuk kegagalan jaringan; 409/expiry menyediakan tombol eksplisit Buat QR baru. Expiry menyembunyikan QR lama. Refresh eksplisit mengikuti backend yang mengganti/revoke claim lama. Token link public (bukan credential akun operator) disimpan di sessionStorage per result untuk reuse setelah reload, sesuai mekanisme web existing; tidak ada foto atau password ditaruh di browser storage. Request yang bersamaan untuk hasil sama direuse supaya tidak menciptakan claim ganda.

Validasi: 4 unit tests claim (dedup/reuse, refresh/storage diblokir, kegagalan/retry, bentuk link/expiry), total snapshot frontend **93 PASS**, backend guard/controller **5 PASS**. Browser source/deployed 1440/390/320 px memeriksa QR, error/retry, expiry/refresh, reload reuse tanpa generation baru, dan fresh browser HP tanpa cookie operator. Screenshot QR didekode menggunakan OpenCV existing secara read-only dan menghasilkan URL public fixture yang tepat. Public production anonymous POST claim ditolak 401; health web/API healthy. Fixtures tidak membuat login atau claim production atas nama pengguna dan tidak memicu paid AI generation.

Commands: `npm test`, `npm run build`, `node --import tsx --test test/kiosk-web-access.test.ts`, `node frontend/scripts/kiosk-flow-check.mjs`, `python3 scripts/deploy_kiosk_flow.py prepare|deploy|status`. Artefak: `/srv/photobooth/cache/kiosk-qr-check/` dan `/srv/photobooth/cache/kiosk-qr-deployed-check/`. Capture/generation production dan scan dengan HP fisik pada event tetap membutuhkan acceptance pengguna.
