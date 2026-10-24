# Inbox — NXBooth Public API dan API Explorer

Status: REQUESTED / PLANNING ONLY — 2026-10-18. Owner meminta inbox untuk
dikerjakan oleh task Codex lain nanti. Tidak memulai implementasi, provisioning,
generate berbayar, perubahan schema, billing atau deployment pada task ini.

## Tujuan dari owner

NXBooth juga menyediakan layanan integrasi untuk developer, operator photobooth
lain, dan aplikasi pihak ketiga, bukan hanya pengguna melalui website NXBooth.
Ruang lingkup awal API publik:

1. Menemukan template yang tersedia dan melakukan generate menggunakan template.
2. Melihat status proses dan mengambil hasil generate.
3. Mengakses folder/storage dan mengambil foto yang diizinkan.
4. Satu halaman Developer/API Documentation dengan API Explorer, penjelasan cara
   mendapatkan kredensial, contoh request/response dan alur integrasi lengkap.

API publik berarti layanan dapat diakses integrator dari internet, dengan
autentikasi dan izin yang sesuai. Bukan membuka semua foto atau endpoint admin.
Provider, model ID internal, prompt server, dan secret upstream tetap privat.

## Kaitannya dengan inbox storage

Baca docs/USER_PHOTO_STORAGE_INBOX.md. Owner sebelumnya meminta akses S3 MinIO
langsung dengan kredensial baca saja per pengguna/integrasi; kebutuhan ini tetap
dicatat, ditambah API NXBooth untuk template dan generate. Bedakan dengan jelas:

- API key integrasi NXBooth: discovery template, pengiriman input generate,
  create job, status, hasil dan metadata folder sesuai scope.
- Kredensial S3: list/read objek yang diizinkan, tanpa write/delete.
- Share link/QR: akses penerima melalui token link, tanpa memberikan secret S3.

Larangan write pada akses storage tidak melarang create-generation melalui API
key dengan scope generate. Input foto untuk generation harus melalui jalur
upload/input khusus yang tervalidasi; jangan memberi akses S3 write umum sebagai
cara pintas. Foto hasil ditulis oleh runtime NXBooth, bukan kredensial S3 eksternal.

## Deliverable pertama agent berikutnya

Inspeksi implementasi dan runtime saat ini, lalu buat proposal reviewable:
kontrak OpenAPI, alur user/integrator, key scopes, kepemilikan hasil, diagram
request-job-storage, UI Developer/API Explorer, keputusan billing yang masih
terbuka, strategi kompatibilitas dan rencana acceptance. Setelah itu laporkan
dan berhenti untuk review owner sebelum keputusan arsitektur/schema/billing.

Jangan menganggap endpoint publik baru sudah tersedia. API produksi sekarang
memakai migration-app/server dan /api; jangan mengaktifkan upstream server.ts
atau upstream /api/v1. Namespace/versioning publik baru harus dirancang secara
eksplisit tanpa berbenturan dengan endpoint customer/admin yang sudah ada.

## Alur integrasi yang perlu didesain

1. Integrator memiliki akun/workspace pemilik saldo dan storage. Putuskan apakah
   workspace terpisah dibutuhkan; jangan menambah service atau schema otomatis.
2. Membuat, menamai, melihat pemakaian, merotasi dan mencabut API key dari web.
   Secret ditampilkan saat penerbitan saja, disimpan dengan mekanisme yang tepat,
   dan tidak dicatat di log. API key dan S3 key bukan secret yang sama.
3. GET katalog template dan kontrak input: ID stabil, mode, kebutuhan reference
   photos, format/ukuran yang diterima dan biaya kredit yang terlihat.
4. Mengirim foto input tervalidasi dan memilih template serta folder tujuan.
   URL input arbitrer, bila diusulkan, perlu evaluasi SSRF; tidak wajib untuk MVP.
5. Mengirim request generate ber-idempotency key; menerima job ID, bukan hasil
   palsu atau request sinkron panjang. Retry identik tidak menggandakan job/charge.
6. Poll status QUEUED/PROCESSING/COMPLETED/FAILED; tentukan polling interval,
   retry/backoff, error dan credit refund. Webhook bertanda tangan boleh menjadi
   opsi proposal, bukan otomatis requirement MVP.
7. Setelah COMPLETED, mendapatkan metadata, result ID, folder, expiry dan URL
   delivery terbatas waktu. S3 client juga dapat list/get objek yang diizinkan.

Template-based generation adalah scope awal. Konfirmasi BASIC versus ADVANCED
template mapping dari katalog yang benar-benar ada. Custom prompt, Custom
Creation, Classic generation publik dan semua model/provider discovery internal
tidak otomatis dibuka hanya karena API template tersedia.

## Halaman dokumentasi dan Explorer

- Jelaskan endpoint/base URL/version, autentikasi dan cara memperoleh API key,
  lokasi pengaturan S3 credential, bucket/prefix dan region jika diperlukan.
- Quickstart utuh: pilih template -> upload input -> submit -> poll -> ambil foto.
- Contoh cURL, JavaScript server-side dan Python, termasuk integrasi S3 read-only.
- OpenAPI yang konsisten dengan route/caller/error aktual, contoh body/response,
  pagination, scopes, idempotency, rate limit, expiry dan storage penuh.
- Explorer dengan pemilihan endpoint, input parameter, preview request dan response.
  Mock/example mode diberi label; live generate adalah tindakan berbayar yang
  disengaja dengan biaya terlihat. Jangan mengirim generate saat halaman dibuka.
- Jangan menyimpan API secret di URL, analytics atau storage browser persisten;
  kredensial S3 rahasia untuk integrasi server-side, bukan bundle publik.
- Tentukan UX akun developer, key management dan usage per key. Dokumentasi bisa
  dibaca publik; operasi dan data privat tetap memerlukan otorisasi.

## Kebijakan yang perlu diputuskan, bukan diasumsikan

- Apakah API memerlukan subscription tertentu atau paket developer terpisah?
- Tarif API dan pemilik kredit: gunakan konteks harga yang sudah dibahas tetapi
  jangan otomatis menjanjikan harga sama atau akses gratis untuk integrator.
- Apakah integrator boleh mengelola sub-user/end-customer; siapa pemilik hasil,
  share link, retention, quota, consent dan penghapusan? MVP bisa satu tenant.
- Rate/concurrency limits per key dan tenant, storage/add-on serta retensi yang
  berlaku. Semua request harus mengikuti saldo/otorisasi tenant sebenarnya.
- Penyimpanan input sementara, pembersihan upload yatim, penggunaan bandwidth
  download/S3 dan pengaruhnya pada biaya serta batas layanan.

## Acceptance dan batas operasional

Rancang tes disposable: dua tenant tidak dapat saling akses; key read-only tidak
bisa generate; key generate tidak mendapat admin; key dicabut/expired ditolak;
S3 write/delete ditolak; upload invalid ditolak; retry tidak double-charge;
saldo habis/quota penuh/retention deletion terdefinisi; job gagal direfund;
generate nyata memakai engine/template server yang benar; Explorer tidak membocorkan
secret; QR, web customer dan kiosk tetap kompatibel.

Ikuti AGENTS.md, cek git dan agent inbox; preserve semua dirty work. Baca skill
backend/frontend yang relevan dan MIGRATION/CUTOVER. Infrastruktur MinIO bersama
tidak boleh dimodifikasi dari planning ini. Schema produksi hanya SQL additive
dengan persetujuan dan backup; deployment memerlukan persetujuan tersendiri.
Tidak ada commit, push atau deploy yang diminta pada pembuatan inbox ini.
