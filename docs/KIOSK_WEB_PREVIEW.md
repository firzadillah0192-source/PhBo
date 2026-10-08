# Preview web kiosk

Catatan historis tahap preview. Implementasi terkini sudah memiliki UI retro, login Google terproteksi, proses dan hasil backend; lihat [KIOSK_WEB_FLOW.md](KIOSK_WEB_FLOW.md).

Tanggal: 2026-10-08. Status **PASS** untuk preview tampilan yang diminta; hardware/generation pada preview belum aktif.

URL live: https://nxbooth.gennexbyte.com/kiosk

## Scope

Pengguna meminta versi web pada `/kiosk` agar tampilan dapat dinilai terlebih dahulu. Entry baru menangani hanya `/kiosk` dan `/kiosk/`. Route customer, admin, claim serta subroute kiosk existing tetap menggunakan aplikasi existing.

Tampilan menyediakan pilihan Classic/Basic/Advanced, indikator tiga tahap, area kamera placeholder berlabel, pilihan foto JPEG/PNG lokal, review, ganti foto, reset sesi, serta panel status operator dan tombol fullscreen browser. Classic preview memakai tiga pose. Ilustrasi kartu adalah dekorasi layout CSS, bukan hasil generation.

Foto dipilih dari file perangkat dan didecode browser. Batas 12 MB/foto dan 40 megapixel, JPEG/PNG saja. Object URL hanya ada di memori browser, dilepas saat retake/reset/unmount. Tidak disimpan pada localStorage/sessionStorage atau diunggah. Tombol Proses foto sengaja disabled dengan pesan generation belum terhubung; tidak ada sukses/hasil AI/cetak palsu.

Preview ini bukan UI bersama Electron atau implementasi kiosk event lengkap. Koneksi Canon USB/EDSDK, printer Windows, live view, katalog/desain backend, generation, hasil/download dan recovery produksi menunggu tahap integrasi setelah review tampilan. Panel operator preview tidak memiliki credential/PIN atau konfigurasi production. Format pada kartu adalah target planning; physical print belum divalidasi.

## Source dan deployment

- `frontend/src/components/kiosk/KioskEntry.jsx`: wrapper route exact dan listener browser navigation.
- `frontend/src/components/kiosk/KioskPreview.jsx`: interaksi lokal, validasi decode foto dan cleanup URL.
- `frontend/src/components/kiosk/kiosk-preview.css`: style terisolasi `.kv-*` dan responsive.
- `frontend/src/main.jsx`: memasang wrapper tanpa mengubah alur existing.
- `frontend/scripts/kiosk-preview-check.mjs`: browser acceptance preview.
- `scripts/deploy_kiosk_preview.py`: release frontend saja di atas snapshot/image frontend yang sedang live. Gunakan prepare/deploy/status/rollback. Prepare ini ditujukan untuk pemasangan wrapper pertama dan menolak entry yang tidak sesuai baseline.

Image deployed: `photobooth-web:kiosk-preview-20261008T094907Z`.
Release: `/srv/photobooth/releases/kiosk-preview-20261008T094907Z`.
Previous image: `photobooth-web:admin-signin-20261007T075808Z`.
Rollback: `python3 scripts/deploy_kiosk_preview.py rollback` (menggunakan pointer release lokal).

Deployment memakai snapshot frontend aktif agar perubahan web/admin yang sudah live tetap terbawa. Source build dan image production dites terpisah. Compose config valid; hanya container `photobooth-web` berubah. Network, volume, port 3000 dan konfigurasi reverse proxy tetap memakai deployment existing. Backend/gateway/Cloudflare tidak diubah.

## Validasi aktual

- Build Vite baru **PASS**.
- Suite frontend snapshot production: **73 PASS, 0 FAIL**.
- Browser source preview dan browser setelah deployment: **PASS** pada 1440, 1024, 390, 320 px.
- Pengujian mode, selected state, operator panel, error invalid photo, decode/preview gambar, gating jumlah foto, review, retake, tiga pose Classic, reset dan no horizontal overflow **PASS**.
- Preview `/kiosk` tidak membuat request `/api/*`, tidak menyimpan blob URL ke storage dan tidak menghasilkan JS runtime error pada tes **PASS**.
- Public HTTPS `/kiosk` render dan navigasi ke capture Advanced **PASS**.
- Existing homepage dan admin sign-in render **PASS** (smoke, bukan pengulangan seluruh alur generation/account).
- Container healthy dan real `/api/health` database/Redis/storage/queue `ok` **PASS**; health bukan bukti generation fisik/AI end-to-end.

Screenshots/report lokal: `/srv/photobooth/cache/kiosk-preview-check/` dan `/srv/photobooth/cache/kiosk-preview-live-check/`. Foto pada tes merupakan fixture sintetis 1 pixel, bukan data pelanggan.

Jalankan browser test dengan Playwright yang tersedia pada environment pengujian:

```bash
KIOSK_BASE=http://127.0.0.1:3000 \
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs \
PLAYWRIGHT_CHROMIUM=/path/to/chromium \
node frontend/scripts/kiosk-preview-check.mjs
```

`PLAYWRIGHT_MODULE`/`PLAYWRIGHT_CHROMIUM` opsional jika Playwright dan browser-nya sudah terpasang secara normal. Tes ini tidak mengirim generation/upload atau memakai API key. Tidak ada pengujian kamera USB/printer fisik pada VPS.
