# Laporan tahap 2 gateway PhBo — 2026-10-07

Status: **PASS untuk implementasi/pengujian kandidat kiosk; PARTIAL untuk promotion production**. Kode dibuat di checkout terpisah berdasarkan main, tidak menimpa perubahan workspace lain. Runtime web/API live tetap sehat; migration production, konfigurasi Cloudflare, queue, serta perangkat event tidak diubah.

## Perubahan

- Sesi kontrol JSON baru `POST /api/v1/kiosk/sessions`, idempotency persisten dan kuota/grant satu kali.
- Upload media baru `POST /api/v1/kiosk/session/:code/upload`, autentikasi API key + grant sesi sebelum multipart; commit atomik dan replay foto sama.
- Migration metadata `backend-express/migrations/001_kiosk_transfer_requests.sql`, diterapkan dua kali pada DB disposable untuk menguji reapplication.
- Dua proses NGINX terpisah: control allowlist JSON dan media upload/download; request ID, batas ukuran/koneksi, rate limit kontrol dan upstream retry dimatikan.
- Kontrak, cara tes, Cloudflare/DNS/Tunnel sebagai opsi review, promotion dan rollback tersedia di [README gateway](../api-gateway/README.md).

## Validasi aktual

| Pemeriksaan | Hasil |
| --- | --- |
| TypeScript `tsc --noEmit` | PASS |
| `npm test --prefix backend-express` | 110 PASS, 0 FAIL, 1 SKIP (roundtrip MinIO nyata) |
| DB-backed `generation-request.integration.test.ts` | PASS; generation/queue existing plus reserve/upload/ownership/recovery dan NGINX HTTP assertions |
| `docker compose config --quiet` dua compose kandidat | PASS |
| `nginx -t` control dan media | PASS |
| Health endpoint NGINX control/media | `status: ok`; kedua container healthy |
| NGINX -> Express -> PostgreSQL fixture | Reserve/upload/claim/download dan generation enqueue/status PASS |
| Route file melalui control / route kontrol melalui media | Ditolak; body/type limit dan request ID PASS |
| Control ketika multipart upload ditahan | Health berhasil sebelum transfer dilanjutkan |
| Retry paralel dan service restart | Satu reserved session/grant dan satu set attached photo IDs; conflict payload ditolak |
| Injected I/O failure | Activation/key upload rollback; reservation tetap bisa dilanjutkan |
| Health web/API production setelah pengujian | `status: ok`, dependency checks `ok`, queue `postgres` |
| `git diff --check` | PASS |

Container test PostgreSQL memakai tmpfs dan tidak expose port host. Gateway kandidat memakai port loopback 20251/20252 dan network `photobooth-gateway-network`, terpisah dari `photobooth-net` production. Container/network kandidat dibersihkan setelah validasi.

## Batas bukti dan sisa pekerjaan

Input/normalisasi/generation menggunakan fixture tes; tidak ada provider AI nyata dipanggil atau hasil sintetis dilaporkan sebagai produk sukses. Signed MinIO diuji oleh suite kontrak/unit; tes MinIO roundtrip nyata masih SKIP. Tes timeout/crash berupa injected I/O failure dan service reconstruction, bukan mematikan OS/container saat produksi.

Implementasi kandidat mencakup API kiosk native `/api/v1`; mapping web/core/admin belum dipindahkan. URL/domain/TLS/Cloudflare belum dikonfigurasi. Build deployment harus memasukkan perubahan production lain yang masih belum di main; jangan memakai image kandidat untuk mengganti release live secara langsung. SQL migration harus diterapkan pada release Express target sebelum endpoint baru dipakai.

Upload memory buffering dan transaksi sampai 120 detik perlu pengukuran pada JPEG DSLR, connection pool dan load target. Partial upload dapat meninggalkan orphan row/object yang dibersihkan retention existing; cleanup live belum diverifikasi. Recovery cookie claim jika respons hilang belum diselesaikan. Karena itu kandidat ini belum membuktikan desktop siap event.

Langkah berikut saat deployment diminta: review domain/trust chain dan release source, apply migration dengan backup, pasang control/media HTTPS pada jalur terpisah, uji private signed MinIO serta foto asli, lalu arahkan client desktop. Tidak melanjutkan ke implementasi desktop/hardware otomatis pada tahap ini.
