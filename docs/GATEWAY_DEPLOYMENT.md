# Deployment gateway PhBo — 2026-10-07

Status: **PASS untuk binding, routing Cloudflare, autentikasi, upload/replay dan signed download**. Ini belum menyatakan desktop, kamera, printer atau kapasitas event siap.

Pengguna telah mengatur tunnel ke IP LAN `192.168.18.12`, sehingga production gateway memakai binding host `0.0.0.0`, bukan loopback.

| Domain | Origin tunnel pengguna | Runtime |
| --- | --- | --- |
| `api-nxbooth.gennexbyte.com` | `http://192.168.18.12:20251` | `photobooth-control-gateway`, NGINX port 8080 |
| `media-nxbooth.gennexbyte.com` | `http://192.168.18.12:20252` | `photobooth-media-entry`, NGINX port 8080 |
| `storage-nxbooth.gennexbyte.com` | `http://192.168.18.12:9000` | MinIO API existing; private signed GET |

Production compose: [compose.production.yml](../api-gateway/compose.production.yml). Default `PHBO_BIND_ADDRESS=0.0.0.0`; kandidat/tes tetap default loopback dan dapat memakai override bind yang sama. Production menggunakan network PhBo existing `photobooth-net` dan upstream `photobooth-express:8081`; container gateway mempunyai restart policy `unless-stopped`.

## Release dan preservasi

Release runtime: `/srv/photobooth/releases/gateway-20261007T080958Z`. API image baru `photobooth-express:gateway-20261007T080958Z` dibuat di atas image aktif sebelumnya `photobooth-express:admin-signin-20261007T075808Z`. Hanya controller/service/model/route kiosk dan middleware request ID dipatch; source/runtime fitur lain pada image aktif dibawa kembali. Web, worker, image helper, database/Redis dan container proyek lain tidak direstart atau diganti. ID container selain API dibandingkan dengan snapshot sebelum deployment dan tidak berubah.

Database dibackup dengan `pg_dump` ke `database-before.sql` (mode 0600) sebelum migration metadata `001_kiosk_transfer_requests.sql`. Migration sudah diterapkan pada database target Express. Compose API dan gateway lolos `config --quiet`; NGINX control/media lolos `nginx -t`. Manifest, log build, override API, rollback dan snapshot konfigurasi gateway tersimpan dalam release runtime, tanpa memasukkan secret ke git.

API `MINIO_PUBLIC_ENDPOINT` diubah dari `storage.gennexbyte.com` menjadi `storage-nxbooth.gennexbyte.com`, port 443/SSL. URL ditandatangani untuk hostname baru; hostname tidak diganti setelah signing. Worker tetap memakai koneksi MinIO internal existing.

## Validasi actual

- `ss` dan Docker port mapping: `0.0.0.0:20251` serta `0.0.0.0:20252` listening; gateway dan media healthy.
- Health API melalui IP LAN dan domain HTTPS: HTTP 200, `status: ok`; database, Redis, storage dan queue `ok`.
- Health media dan storage melalui domain HTTPS: HTTP 200.
- Reserve/replay sesi melalui Cloudflare: session ID tetap; API key yang hilang ditolak 401.
- Upload/replay gambar sintetis berlabel smoke test melalui media: photo ID tetap.
- Multipart melalui domain API kontrol ditolak 415; foto tanpa akses cookie ditolak 401.
- Claim sesi, request signed URL melalui control, download object nyata melalui hostname storage baru: PASS.
- Tidak memanggil provider AI/generation berbayar pada smoke test. Dua sesi/file fixture, ledger grant dan object tes dibersihkan secara terarah setelah validasi; data pelanggan tidak disentuh.
- Health web/API existing sesudah perubahan tetap `ok`. Tidak mengubah tunnel, DNS, firewall atau reverse proxy global.

Client tes memakai `User-Agent: NXBoothDesktop/1.0` dan `Accept: application/json`. User-Agent bawaan Python mendapatkan penolakan edge Cloudflare 1010; identitas client aplikasi di atas lulus. Client desktop harus mengirim identitas aplikasi yang konsisten; jika client nyata terkena challenge, review rule Cloudflare khusus hostname API tanpa menonaktifkan proteksi seluruh domain.

## Rollback dan batas pekerjaan

Rollback API memakai compose files pada manifest release + `compose.rollback.yml`, dengan environment prerequisite yang sama dengan release sebelumnya. Hentikan hanya project gateway baru jika perlu; web/proyek lain tetap berjalan. Tabel metadata baru boleh tetap ada untuk kompatibilitas, tanpa menghapus sesi aktif. Database backup tersedia bila rollback data benar-benar diperlukan.

Mapping gateway saat ini khusus kiosk native; endpoint web/admin masih memakai entrypoint existing. Client IP/rate limits melewati tunnel perlu tuning pada load target, karena baseline memakai peer IP pada gateway. Uji hardware Windows, printer multi-merek, payload DSLR, generation nyata, retention/soak dan recovery cookie claim ambigu masih bagian tahap berikutnya.
