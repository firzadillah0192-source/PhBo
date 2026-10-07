# Gateway kontrol dan jalur media PhBo — kandidat tahap 2

Status: API kiosk native `/api/v1` dan gateway sudah dipasang di production pada 2026-10-07. Lihat [laporan deployment](../docs/GATEWAY_DEPLOYMENT.md). Web `/api`, admin, frontend dan deployment live tetap menggunakan jalur existing. Queue PostgreSQL tetap aktif; desktop dan hardware belum dikerjakan.

## Jalur request

- Control NGINX: metadata kiosk, reserve session, claim, generation/status, katalog dan signed URL. Maksimum body 32 KiB; mutation wajib `application/json`. Allowlist path menolak upload, image/download serta route lain. Rate limit awal 20 request/detik/IP dengan burst 40; sesuaikan berdasarkan pengukuran.
- Media NGINX: proses berbeda, untuk upload sesi dan fallback download image. Maksimum total multipart 50 MiB dan maksimal 4 koneksi/IP. API membatasi masing-masing file/jumlah dan memakai validasi decode existing; buffer memory API masih digunakan, belum streaming sampai storage.
- MinIO signed GET: client mengunduh langsung dari URL HTTPS storage. Endpoint `/url` JSON melewati control. Kedaluwarsa URL diperbarui tanpa generation ulang. Signing adapter existing tidak diubah.

`control.conf` dan `media.conf` memakai upstream DNS `photobooth-api:8081`. `compose.yml` adalah konfigurasi kandidat dengan port localhost 20251/20252 pada network dedicated `photobooth-gateway-network`; bukan override production. `/gateway/health` dan `/media/health` hanya readiness NGINX. `/api/health` pada control memeriksa dependency API.

Request ID dibuat NGINX dan diteruskan API; API memvalidasi ID atau menghasilkan UUID untuk direct request. ID belum diteruskan ke queue/worker. Log akses hanya request ID, method, status, bytes respons dan durasi, tanpa path/query/header/body/credential. Error log runtime NGINX dinonaktifkan untuk mencegah URI bertoken masuk log; hasil `nginx -t` dan startup tetap diperiksa. Tidak auto-retry mutation upstream (`proxy_next_upstream off`).

Dokumentasi acuan: [NGINX proxy module](https://nginx.org/en/docs/http/ngx_http_proxy_module.html), [NGINX rate limiting](https://nginx.org/en/docs/http/ngx_http_limit_req_module.html).

## Kontrak desktop baru

1. Trusted process desktop menghasilkan secret `claimToken` dengan 32 byte random kriptografis, base64url tanpa padding (43 karakter). Persist secret dan operation key sebelum request, memakai credential store Windows; renderer tidak menerima secret/API key.
2. `POST <control>/api/v1/kiosk/sessions`, header `X-API-Key`, `Idempotency-Key`, body JSON `{ "claimToken": "<secret-desktop>", "event": "<optional-slug>" }`. Respons 201 `{data:{id,code,status,expiresAt,uploadPath}}`. Status awal `UPLOADING`, belum boleh generation/claim. Secret disimpan sebagai hash saja; respons replay tidak memerlukan secret server plaintext.
3. `POST <media><uploadPath>` (path `/api/v1/kiosk/session/:code/upload`), header `X-API-Key`, `X-Kiosk-Upload-Token` berisi secret yang sama, `Idempotency-Key` untuk upload; multipart hanya field file `image` (1–4 file), tanpa field event. Grant diperiksa sebelum parsing file. Event berasal dari sesi server.
4. Respons 200 `{data:...}` adalah metadata sesi aktif/foto tervalidasi. Replay file sama mengembalikan photo ID yang sama. Seluruh byte file, urutan, MIME dan filename harus tetap untuk retry. Key sama dengan payload berbeda -> 409. Key baru tidak mengganti foto yang sudah commit -> 409. Session expired -> 410. Grant sesi lain -> 403.
5. Akses sesudah upload mengikuti kontrak claim existing: `POST <control>/api/v1/photo-sessions/:code/claim` body `{token:claimToken}` -> cookie `photo_session`. Trusted client menyimpan cookie per sesi dan mengirimkannya secara eksplisit pada control/media API; jangan mengandalkan cookie browser lintas hostname. URL signed MinIO tidak menerima cookie/credential kiosk.
6. Generation/status memakai endpoint `/api/v1/generations` existing melalui control. Endpoint hasil `/url` memberi signed URL atau fallback. Untuk URL fallback relatif `/api/v1/photos/:id` dan `/api/v1/results/:id/image|download`, resolve terhadap media base URL, bukan control. Allowlist destination HTTPS diterapkan trusted client saat implementasi desktop.

Secret upload sama dengan claim token pada tahap kompatibilitas ini, dan masih memerlukan API key untuk upload. Desktop QR tamu tetap di luar tahap ini; ownership desktop/QR harus dirancang terpisah sebelum diaktifkan. Jika respons claim hilang sesudah cookie dibuat dan client belum menyimpannya, recovery cookie belum ditangani oleh perubahan ini. Jangan otomatis membuat session baru atau memakai QR pelanggan untuk menutup gap tersebut.

## Idempotency dan crash

Migration `backend-express/migrations/001_kiosk_transfer_requests.sql` menambah metadata key/hash/session saja pada API Express target; tidak menulis binary/secret. Reserve memakai advisory lock transaksional dan grant kuota sekali. Upload memakai row lock sesi; activation, attached photo IDs dan key commit atomik. Request retry sesudah restart membaca database, bukan cache proses.

Upload transaction mempunyai `maxWait` 20 detik dan timeout 120 detik. Jika antrean lock/normalisasi/storage melampaui batas, client merekonsiliasi lewat reserve replay (`status`) dan mencoba ulang operasi yang sama. Timeout tidak otomatis berarti gagal commit. Ini desain awal satu PC/event, belum bukti kapasitas banyak kiosk.

Penyimpanan foto existing terjadi di luar transaksi activation. Gangguan sesudah sebagian file tersimpan dapat meninggalkan row/object orphan; retry tetap tidak menggandakan foto yang attached pada sesi, tetapi orphan mengikuti cleanup/retention upload existing. Sebelum production, verifikasi housekeeping aktif, biaya storage, durasi transaksi dan kapasitas connection pool. Append/replace foto pada sesi ACTIVE tidak tersedia.

Endpoint gabungan `POST /api/v1/photo-sessions` dan `/upload-image` tetap kompatibel di API/media; endpoint tersebut tidak memperoleh idempotency baru dan tidak diteruskan control. Tidak mengalihkan web existing ke allowlist kiosk ini.

## Pengujian terisolasi

Prasyarat: dependency Node backend tersedia, Docker, image `nginx:1.28-alpine`, `node:24-bookworm-slim`, `postgres:16-alpine`. Fixture compose mengikat folder dependency lokal `/opt/photobooth/backend-express/node_modules`; pada mesin lain ubah mount dan sediakan dependency yang sesuai tanpa menyentuh database live.

```sh
docker network create photobooth-gateway-network
docker compose -f api-gateway/compose.yml config --quiet
docker compose -f api-gateway/compose.integration.yml config --quiet
docker compose -f api-gateway/compose.yml up -d
docker compose -f api-gateway/compose.integration.yml up -d postgres
docker compose -f api-gateway/compose.yml exec -T control nginx -t
docker compose -f api-gateway/compose.yml exec -T media nginx -t
docker compose -f api-gateway/compose.integration.yml run --rm --use-aliases api-tests
npm test --prefix backend-express
./backend-express/node_modules/.bin/tsc --noEmit -p backend-express/tsconfig.json
docker compose -f api-gateway/compose.yml ps
docker compose -f api-gateway/compose.yml logs --tail 30
docker compose -f api-gateway/compose.integration.yml down
docker compose -f api-gateway/compose.yml down
docker network rm photobooth-gateway-network
```

Database test `nxbooth_express_gateway_test` memakai tmpfs dan tidak mempublikasikan port. Password compose hanya fixture disposable, bukan credential production. `--use-aliases` diperlukan agar upstream `photobooth-api` resolve ke container tes. Jangan menghubungkan container fixture ke network production. Folder symlink dependency lokal dalam checkout tidak masuk commit.

Tes DB mencakup reserve/upload paralel, replay sesudah service restart, payload conflict, rollback I/O, expiry, ownership dan compatibility existing. Tes HTTP memakai API Express nyata dengan PostgreSQL disposable serta dua proses NGINX: reserve -> upload -> claim -> download, generation enqueue/status, media-route rejection, body/type limit, request ID, control saat multipart ditahan. Input dan result fixture sintetis berlabel tes; tidak membuktikan provider AI, kualitas foto, printer atau SDK kamera.

## Publikasi HTTPS dan Cloudflare

PC event di luar jaringan VPS membutuhkan URL HTTPS yang dapat dijangkau. Cloudflare adalah edge di depan gateway, bukan pengganti NGINX yang memisahkan kontrol dan media. Pilihan yang belum diputuskan: DNS proxied menuju HTTPS origin VPS, atau Cloudflare Tunnel (`cloudflared`) dengan koneksi keluar dari VPS. Tunnel direkomendasikan untuk review karena dapat mempublikasikan layanan tanpa membuka port inbound baru; belum dipasang pada tahap kandidat ini.

| Hostname contoh, belum didaftarkan | Tujuan |
| --- | --- |
| `api.<domain>` | NGINX control -> API PhBo JSON |
| `media.<domain>` | NGINX media terpisah -> API upload/fallback download |
| `storage.<domain>` | Endpoint HTTPS MinIO untuk signed GET private object |

Bytes foto boleh melewati edge Cloudflare sesuai konfigurasi layanan/limit yang diuji, tetapi tetap bypass **proses gateway kontrol**. Signed storage URL harus dibuat untuk hostname/metode/object yang benar, bukan diubah host-nya sesudah ditandatangani. Bucket tetap private; publikasi hostname storage tidak membuat objek bebas diakses. Rancangan ini tidak mempublikasikan PostgreSQL, Redis atau console/admin MinIO.

Sebelum memilih opsi, review domain milik pengguna, setup Cloudflare/TLS yang sudah ada, limit upload/timeout paket, cache bypass untuk API/private media, serta penanganan client IP/rate limit jika berada di belakang edge. Config kandidat saat ini menganggap koneksi client langsung; jangan promote tanpa menyesuaikan trust chain. Tidak mengubah DNS, tunnel, firewall atau shared reverse proxy pada tahap ini.

Referensi resmi: [Cloudflare proxied DNS](https://developers.cloudflare.com/dns/proxy-status/), [Cloudflare Tunnel dan koneksi outbound](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/).

## Checklist sebelum promotion live

1. Bangun release API yang memasukkan perubahan ini **dan** perubahan production lain yang masih belum masuk main. Checkout kandidat tidak boleh langsung menggantikan image production yang lebih baru.
2. Review domain/TLS/control/media/storage public URL dan CORS. Entry kandidat menerima client langsung dan menimpa forwarded headers; jika ditempatkan di belakang TLS edge, trust chain dan scheme harus disesuaikan hanya untuk proxy tepercaya. API memerlukan `TRUST_PROXY=true` untuk satu hop tepercaya dan private upstream.
3. Backup metadata, lalu apply migration SQL dengan tooling release Express yang disepakati (`psql`/runner pada database target); migration idempotent. Kandidat belum menjalankan migration di database live. Jangan menganggap `pnpm db:migrate` kandidat mengelola migration SQL ini.
4. Jalankan `docker compose config`, `nginx -t`, health dependency, tes credential/event, upload nyata EOS 2000D, signed MinIO GET expiry/ownership dan concurrent transfer/control pada release target.
5. Arahkan client desktop ke dua base URL setelah tes lulus. Web existing tetap kompatibel; mapping `/api` web/core/admin memerlukan tahap compatibility sendiri, bukan wildcard proxy.
6. Rollback: kembalikan client ke URL/release sebelumnya, hentikan entrypoint kandidat dan pulihkan image API sebelumnya. Tabel tambahan dapat tetap ada karena tidak mengubah tabel existing; jangan menghapus sesi/foto aktif sebagai rollback.

Deployment native gateway sudah lulus validasi jaringan dan synthetic smoke test yang dicatat pada laporan deployment. Uji foto EOS 2000D, kapasitas event dan recovery desktop tetap pending. Checklist ini tetap digunakan untuk release berikutnya.
