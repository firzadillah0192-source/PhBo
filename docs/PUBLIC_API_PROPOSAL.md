# Proposal — NXBooth Public API dan API Explorer

Status: PROPOSAL UNTUK REVIEW OWNER — 2026-10-18. Menjawab deliverable pertama di
`docs/PUBLIC_API_INBOX.md`. Tidak ada kode, schema, IAM MinIO, key, generate
berbayar, commit atau deploy yang dibuat. Dokumen ini hanya hasil inspeksi
source dan runtime read-only. Setelah review, tugas berhenti sampai owner
memutuskan butir di bagian 9.

Tanda: **[V]** terverifikasi dari source/runtime sesi ini, **[A]** asumsi atau
usulan, **[?]** belum diverifikasi.

## 1. Temuan inspeksi

1. **`/api/v1` sudah dipakai.** Native kiosk dan desktop memakai prefix itu
   (`migration-app.ts:67-70`: `nativeKioskRoutes`, device, update, diagnostics) **[V]**.
   Public API tidak boleh memakai `/api/v1`. Usulan namespace: `/api/public/v1` **[A]**.
2. **Alur customer sudah hampir cukup.** `POST /api/uploads` (multer, validasi,
   `UPLOAD_MAX_BYTES` 12 MB, dimensi maks 8000), `POST /api/generations`
   (202 + job), `GET /api/generations/:id`, `GET /api/results/:id[/image|/download]`,
   katalog `GET /api/templates`, `/api/experiences` **[V]**. Public API sebaiknya
   fasad tipis di atas service yang sama, bukan engine kedua.
3. **Identitas hanya cookie.** Controller memanggil `accounts.resolve(req.cookies)`
   dan semua kepemilikan (`upload`, `job`, `result`) berbasis `account_id`
   atau `guest_id` **[V]**. Belum ada autentikasi bearer/API key untuk akun
   customer. Satu-satunya API key yang ada adalah `KIOSK_API_KEY` bersama dan
   `ADMIN_API_KEY`, keduanya bukan per tenant **[V]**. Key integrasi harus baru.
4. **Idempotency sudah ada.** `generationRequest()` memakai header
   `Idempotency-Key`, scope `account:<id>`, hash input dinormalisasi; retry sama
   mengembalikan job lama, input beda dengan key sama ditolak **[V]**. Bisa dipakai
   langsung dengan scope akun pemilik key.
5. **Charge dan refund sudah ada** (`generation_credit_charges`, reservasi wallet,
   refund saat FAILED, laporan di `credit_charge`) **[V]**. Sedang berubah:
   `backend/migrations/024_subscription_v2.sql` (milik Codex, belum diterapkan)
   menambah wallet AI/Classic, `retention_days`, `storage_reserved` per job **[V]**.
   Public API wajib dibangun di atas wallet yang berlaku saat implementasi,
   jangan menduplikasi logika kredit.
6. **Respons status membocorkan `provider` dan `model`.** `CustomerGenerationService.status()`
   mengembalikan `provider: job.provider, model: job.model` **[V]** (`customer-generation.service.ts`,
   fungsi `status`). Ini bertentangan dengan AGENTS.md ("never expose prompts, model IDs or
   provider names to customers") dan **tidak boleh diwariskan** ke Public API.
   Tidak saya ubah di sini. Codex menyatakan akan menghapusnya dari status
   customer v2 (file `customer-generation.service.ts` miliknya). Respons Public API
   tetap memakai DTO sendiri tanpa field itu.
7. **Layout object MinIO tidak memuat tenant.** Referensi tersimpan:
   `minio://results/<2hex>/<id>.png`, `minio://uploads/<2hex>/<id>.jpg`, dan
   `.../events/<slug>/...` **[V]** (`native-object-storage.service.ts`). Semua akun
   berbagi prefix yang sama dan prefix diturunkan dari id acak, bukan pemilik.
   Konsekuensi: **policy IAM berbasis prefix tidak bisa memisahkan tenant pada
   objek yang ada.** Ini menentukan desain S3 (bagian 6).
8. **Signed URL tersedia tapi mati.** `MINIO_SIGNED_URLS_ENABLED` default `false`,
   TTL 1-3600 s (default 300) **[V]**. Dibutuhkan origin publik MinIO bila diaktifkan.
9. **MinIO**: `aistor-server`, image `quay.io/minio/aistor/minio:latest`, versi
   `RELEASE.2026-09-19T17-05-25Z`, port host 9000/9001 mendengarkan di semua
   interface **[V]**. Keterjangkauan dari internet (firewall/reverse proxy) tidak
   saya periksa **[?]**. Kapabilitas IAM AIStor pada versi ini belum dicocokkan
   dengan dokumentasi resmi pada sesi ini **[?]**.
10. **Retensi web** saat ini tetap 14 hari (`WEB_RESULT_RETENTION_DAYS`) **[V]**;
    v2 menggantinya per paket 7-90 hari (belum aktif).
11. **Katalog**: BASIC memakai `/api/templates` (`NxTemplate`, 5 tema x 3 varian),
    ADVANCED memakai `/api/experiences` + frame style + ornamen, CLASSIC memakai
    `/api/classic/layouts` **[V]**. `basic_available`, `enabled`, `sort_order` ada.

## 2. Ruang lingkup MVP yang diusulkan

Dalam MVP: katalog template BASIC (dan ADVANCED bila owner setuju), upload input,
create job, status, hasil, folder/daftar hasil milik tenant, key management di
web, halaman Developer + Explorer.

Di luar MVP: custom prompt, Custom Creation, CLASSIC publik, discovery model/provider,
sub-user/end-customer, webhook, URL input arbitrer (risiko SSRF), S3 langsung
(fase 2, bagian 6), tarif khusus developer.

## 3. Model identitas dan key

- **Tenant = akun NXBooth yang sudah ada** (`accounts`), MVP satu tenant per akun
  **[A]**. Saldo, wallet, retensi, dan hasil memakai akun itu. Tidak ada workspace
  baru dan tidak ada service baru.
- **API key** dibuat dari web (Account Center > Developer). Format
  `nxb_live_<id>_<secret>` **[A]**; secret 256-bit acak. Simpan hanya
  `HMAC-SHA256(server_pepper, secret)` + `prefix` + metadata; secret ditampilkan
  sekali. Pepper di env baru (`.env.example` saja), bukan di DB.
- Autentikasi: `Authorization: Bearer nxb_...`. Middleware key mengisi
  `CustomerIdentity` sintetis `{account, guest: null}` lalu service yang ada
  dipakai apa adanya, jadi aturan kepemilikan tidak diduplikasi.
- Key tidak pernah menerima cookie dan tidak bisa memanggil rute admin/akun/pembayaran.
- Lifecycle: nama, scope, `last_used_at`, hitungan pemakaian, `expires_at`,
  rotasi (key baru dulu, lama dicabut), revoke langsung (cek DB per request, atau
  cache <= 30 detik **[A]**). Log hanya `prefix`, tidak pernah secret.

### Scope

| Scope | Boleh |
| --- | --- |
| `catalog:read` | GET template/experience, kontrak input |
| `inputs:write` | POST upload input tervalidasi |
| `generations:create` | POST generation (berbayar) |
| `generations:read` | GET status job |
| `results:read` | GET metadata/URL hasil dan daftar hasil |
| `usage:read` | GET saldo dan pemakaian key |

Tidak ada scope admin, billing, atau hapus akun. Key read-only = tanpa `inputs:write`
dan `generations:create`. Hapus hasil lewat API: tidak di MVP **[A]**.

## 4. Kontrak endpoint (ringkas; OpenAPI penuh jadi artefak implementasi)

Base: `https://<host>/api/public/v1`. Error mengikuti bentuk yang ada:
`{ "detail": { "error_code", "message" } }` **[V]**.

| Method | Path | Scope | Catatan |
| --- | --- | --- | --- |
| GET | `/templates` | catalog:read | id stabil, mode, nama, preview, `credit_cost`, kebutuhan input |
| GET | `/templates/{id}` | catalog:read | kontrak input: jumlah foto, format, ukuran, dimensi |
| POST | `/inputs` | inputs:write | multipart, 1 file, jenis/ukuran divalidasi seperti `/api/uploads`; mengembalikan `input_id` |
| POST | `/generations` | generations:create | wajib `Idempotency-Key`; body `{template_id, input_id, folder_id?, event_name?}`; 202 `{job_id, state}` |
| GET | `/generations/{id}` | generations:read | `state` QUEUED/PROCESSING/COMPLETED/FAILED, `result_id`, `error_code`, `credit_charge`, header `Retry-After` |
| GET | `/results` | results:read | paginasi cursor, filter folder/tanggal |
| GET | `/results/{id}` | results:read | metadata, `expires_at`, ukuran, dimensi |
| GET | `/results/{id}/download` | results:read | stream via NXBooth, atau 302 ke signed URL berumur pendek |
| GET | `/usage` | usage:read | saldo, pemakaian per key |

Aturan:
- Respons memakai DTO publik sendiri. **Tanpa** `provider`, `model`, prompt,
  `engine_config`, path MinIO, atau token claim.
- `credit_cost` ditampilkan pada katalog. Kode yang live masih menghitung harga
  BASIC dari token provider setelah selesai (`priceCompletedGeneration`) **[V]**.
  Per 2026-10-18 Codex melaporkan subscription v2 memakai harga tetap: Standard
  50 dan Fast 100 kredit AI (Low), Classic 10 kredit Classic, dua mata uang
  terpisah **[V dari pesan Codex; kode/SQL 024 belum live]**. Maka `credit_cost`
  per template = harga jalur (lane) yang dipakai, dan Public API menunggu v2 aktif
  agar biaya terlihat pasti sebelum submit. Jalur mana yang dipakai API:
  bagian 9, butir 3.
- Rate limit per key dan per tenant (pakai `NativeRateLimitService` bila cocok
  **[A]**), `429` + `Retry-After`. Batas job aktif bersamaan per tenant.
- CORS: Public API dirancang server-to-server; origin browser tidak diizinkan
  secara default sehingga key tidak tersimpan di bundle publik.
- Versi: `/v1` stabil; field baru bersifat additive; breaking change = `/v2`.

## 5. Alur request-job-storage

```
Integrator            NXBooth API (migration-server)        Worker / Helper          MinIO
   | GET /templates ------->|                                    |                     |
   | POST /inputs --------->| validasi MIME/ukuran/dimensi ----------------------------> put uploads/..
   |<-- input_id            |                                    |                     |
   | POST /generations ---->| cek key+scope, Idempotency-Key     |                     |
   |   (Idempotency-Key)    | reservasi kredit (wallet), job QUEUED                    |
   |<-- 202 job_id          | enqueue (Redis; PG sumber kebenaran)-->|                  |
   | GET /generations/id -->|                                    | PROCESSING ->       |
   |   poll (>=2-3 s)       |                                    | provider (9router)  |
   |                        |                                    | put results/.. ---->|
   |<-- COMPLETED,result_id | charge settle / FAILED -> refund   |                     |
   | GET /results/id/download -> stream atau signed URL (TTL pendek) ------------------>|
```

Poll interval awal 3 s dengan backoff sampai 10 s; webhook bertanda tangan
ditunda ke fase 3 **[A]**. Retry identik (key sama, input sama) mengembalikan job
yang sama tanpa charge kedua; key sama dengan input beda ditolak dengan
`409 IDEMPOTENCY_CONFLICT` **[V]** (`customer-generation.model.ts:40`). Job gagal direfund oleh jalur yang ada.

## 6. Storage dan akses S3

Persyaratan owner: S3 langsung, hanya baca, internet-accessible, per tenant.
Temuan 7 menunjukkan objek yang ada tidak punya prefix per tenant.

| Opsi | Isolasi tenant | Dampak | Penilaian |
| --- | --- | --- | --- |
| A. Hanya API + signed URL/stream | Aplikasi (cek `account_id`) | Tidak ada perubahan MinIO; butuh `MINIO_SIGNED_URLS_ENABLED` dan origin publik | MVP, **tidak** memenuhi S3 langsung |
| B. Prefix ekspor per tenant: runtime NXBooth menyalin hasil ke `exports/<tenant>/...`; IAM user read-only dibatasi prefix itu | S3-native | Perubahan IAM/policy MinIO bersama (butuh persetujuan), dobel byte storage, retensi/hapus harus menyapu salinan | Memenuhi S3 langsung; **rekomendasi fase 2** |
| C. Re-key semua objek ke `tenant/...` | S3-native | Memecah semua referensi `minio://...`, claim/QR, backfill besar | Ditolak |
| D. Bucket per tenant | Fisik | Biaya operasional, manajemen bucket massal | Tidak dibenarkan oleh skala saat ini |

Rekomendasi: **MVP = opsi A. Fase 2 = opsi B** setelah owner menyetujui
pembuatan IAM user/policy di `aistor-server` dan kebijakan hitungan kuota untuk
salinan. IAM per-user otomatis untuk setiap pendaftar (usulan owner sebelumnya)
tidak direkomendasikan; provisioning saat integrasi diaktifkan lebih kecil dan
reversibel. Kapabilitas policy AIStor pada versi 2026-09-19 harus dicocokkan
dengan dokumentasi resmi sebelum fase 2 **[?]**. S3 read-only tidak boleh
write/delete; upload input memakai `/inputs`, bukan S3 write. Kredensial S3 dan
API key adalah secret berbeda.

## 7. Perubahan data (usulan, belum diterapkan)

SQL additive baru di `backend/migrations/` (nomor menyusul setelah 024), diterapkan
manual setelah backup dan persetujuan:

- `integration_api_keys`: `id`, `account_id`, `name`, `prefix`, `secret_hash`,
  `scopes`, `created_at`, `expires_at`, `revoked_at`, `last_used_at`.
- `integration_api_key_usage`: hitungan harian per key (request, job, kredit).
- `integration_inputs` atau penandaan sumber di `uploads`: menandai upload dari
  jalur integrasi (opsional **[A]**).
- Folder (`folder_id`) bergantung pada `USER_PHOTO_STORAGE_INBOX.md` dan **tidak**
  boleh dibangun dua kali. MVP Public API bisa berjalan tanpa folder
  (daftar hasil per tenant) lalu mengikuti skema folder saat itu disetujui.

Tidak ada `prisma migrate`/`db push` (AGENTS.md).

## 8. UI Developer dan API Explorer

- Halaman dokumentasi publik `/developers` (tanpa login): quickstart
  (template -> input -> generate -> poll -> ambil), autentikasi, scope,
  idempotency, rate limit, retensi, kode error, contoh cURL / Node (server) / Python,
  dan (fase 2) contoh S3 read-only.
- Manajemen key di Account Center: buat, beri nama, lihat pemakaian, rotasi, cabut;
  secret ditampilkan sekali.
- Explorer: pilih endpoint, isi parameter, pratinjau request, lihat respons.
  Mode "contoh" berlabel jelas dan tidak memanggil server. Mode "live"
  memakai key yang ditempel pengguna **hanya di memori halaman** (tidak di URL,
  analytics, localStorage, atau cookie). `POST /generations` live menampilkan
  biaya dan butuh konfirmasi eksplisit; tidak ada generate saat halaman dibuka.
- OpenAPI dihasilkan dari skema zod yang sama dengan route (satu sumber kebenaran)
  atau diuji kontraknya terhadap route **[A]**, agar dokumen tidak menyimpang.

## 9. Keputusan yang dibutuhkan dari owner

1. Namespace `/api/public/v1` dan penolakan memakai `/api/v1`: setuju?
2. MVP satu tenant per akun tanpa sub-user: setuju? Pemilik hasil = akun pemilik key.
3. Billing: harga v2 sudah tetap per jalur (Standard 50 / Fast 100 kredit AI).
   Jalur mana yang dipakai API: Standard saja, atau pemanggil boleh memilih
   `lane` (Fast = lebih mahal)? Memakai wallet v2 akun apa adanya, atau paket
   developer terpisah? Apakah akses API gratis untuk paket Free? Kredit
   Sandbox tidak boleh dipakai (aturan Codex: Sandbox tidak mengaktifkan wallet
   produksi).
4. Scope template: BASIC saja, atau BASIC + ADVANCED?
5. ~~Respons `provider`/`model` di web customer~~ — Codex akan menghapusnya dari
   status customer v2 (telemetri admin tetap). Tersisa: konfirmasi owner dan
   apakah jalur non-v2 (rute lama) ikut dibersihkan.
6. S3 langsung: sepakat MVP opsi A lalu fase 2 opsi B? Jika B, siapa yang
   menyetujui perubahan IAM di MinIO bersama, dan apakah salinan ekspor dihitung
   ke kuota?
7. Keterjangkauan internet MinIO (9000) dan origin publik signed URL: siapa yang
   mengatur reverse proxy/firewall (di luar scope agent tanpa persetujuan)?
8. Webhook: fase 3 atau tidak sama sekali?
9. Siapa yang mengimplementasikan (Claude/Codex)? Area berbagi dengan
   subscription v2 dan folder storage (file account/credit/generation) yang
   sedang dikerjakan Codex.

## 10. Rencana bertahap

| Fase | Isi | Butuh persetujuan |
| --- | --- | --- |
| 0 | Review proposal ini, jawab bagian 9 | Owner |
| 1 | SQL key tables, middleware key, DTO + route `/api/public/v1`, rate limit, OpenAPI, test kontrak | SQL + backup, deploy API |
| 2 | UI key management + halaman Developer/Explorer | Deploy web |
| 3 | Signed URL delivery, lalu S3 read-only (opsi B), webhook bila diminta | IAM MinIO, kuota, deploy |

## 11. Rencana acceptance (semua di DB/storage disposable, bukan produksi)

- Dua tenant: key A tidak bisa membaca input/job/result tenant B (ID ditebak = 404).
- Key tanpa `generations:create` ditolak membuat job; key generate tidak bisa
  mengakses rute admin/akun/pembayaran.
- Key dicabut/kedaluwarsa ditolak segera; rotasi tidak memutus key lama sebelum dicabut.
- Secret tidak muncul di log, respons ulang, URL, atau analytics.
- Upload invalid (MIME/ukuran/dimensi/HEIC rusak) ditolak; file orphan dibersihkan.
- Retry dengan `Idempotency-Key` yang sama tidak membuat job/charge kedua;
  input berbeda dengan key sama ditolak.
- Saldo habis, kuota penuh, dan job gagal (refund) terdefinisi dan teruji.
- Respons tidak memuat `provider`, `model`, prompt, path MinIO.
- Hasil yang melewati retensi tidak bisa diambil via API maupun signed URL baru.
- Rate limit per key dan batas job bersamaan ditegakkan (`429` + `Retry-After`).
- Kompatibilitas: web customer, kiosk (`/api/v1`), QR claim, dan desktop tidak berubah.
- Fase 2 S3: write/delete/list lintas tenant ditolak; hanya objek ekspor tenant terbaca.
- Generate nyata satu kali, dengan persetujuan owner, memakai engine/template server yang benar.

## 12. Batas dokumen ini

Tidak membaca byte foto atau data pelanggan, tidak memanggil provider, tidak
menyentuh MinIO IAM atau bucket, tidak menjalankan SQL, tidak commit. Perubahan
kerja lain (subscription v2, Duitku, desktop, Lab) tetap utuh dan tidak disentuh.
