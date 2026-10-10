# NX Photobooth Backend

> **NXBooth native Express runtime:** based on `origin/master` at `4ee0aa9`.
> Read [MIGRATION.md](MIGRATION.md) first. This Express/TypeScript API and worker
> now serve the production application. The notes below include upstream reference
> commands; historical defaults do not describe the active deployment.

CLASSIC accepts 1–4 photos and uses the Python frame compositor. BASIC uses the server-side AI provider with
five themes, each available as a man, a woman without hijab, and a woman wearing hijab: Space Commander,
Cyberpunk Neon, Aviation Captain, Royal Nusantara, and Arctic Expedition; ADVANCED uses NineRouter experience presets. Both AI modes
reserve one credit and call NineRouter through Express. See [Generation engine setup](docs/GENERATION_ENGINES.md)
for current requests, migration, defaults, and runtime requirements. Frames CRUD and
the session/claim flow are retained. Older ORIGINAL/FRAME examples below are historical.

Backend candidate: Express + TypeScript owns customer workflows, PostgreSQL jobs,
and the worker. BASIC and ADVANCED use NineRouter; Python is a private helper for
normalization, print formatting, and Classic composition. The upstream `ORIGINAL`
and `FRAME` examples below are historical and do not describe this candidate.

## Menjalankan

Untuk mode CLASSIC lokal, setelah PostgreSQL dan MinIO aktif, jalankan dari
folder `backend`:

```powershell
pnpm db:generate
pnpm db:migrate
pnpm dev:classic
```

`dev:classic` menjalankan Python compositor, API, dan generation worker dalam satu
terminal. Membutuhkan `uv`, membaca `backend/.env` untuk semua proses, dan menunggu
Python/API siap sebelum worker dijalankan. Isi `AI_ENGINE_API_KEY`; URL Python
lokal default `http://127.0.0.1:8001/generate`. Jangan menjalankan `pnpm dev` atau
`pnpm worker` tambahan bersamaan dengan perintah ini. Biarkan terminal terbuka;
Ctrl+C menghentikan ketiga proses. Restart perintah setelah perubahan source.

Jika status generation tetap `QUEUED`, pastikan terlihat log `Generation worker
started`. Log `Generation processing: <id>` berarti worker sudah mengambil job;
`Generation completed: <id>` berarti hasil tersimpan. Python sendiri tidak
mengambil job dari database. Session lama yang expired perlu diganti dengan
upload dan claim baru.

Gunakan Node.js 22.12+ (disarankan 24), pnpm 11.19.0, dan Docker Compose. Lockfile pnpm disertakan.

```sh
cp .env.example .env
pnpm install
docker compose up -d postgres minio
pnpm db:generate
pnpm db:migrate
pnpm dev
```

PowerShell: gunakan `Copy-Item .env.example .env` untuk langkah pertama. Isi `KIOSK_API_KEY` dan `ADMIN_API_KEY` dengan dua secret berbeda, minimal 32 karakter. Untuk membuat secret: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

Jalankan worker di terminal kedua:

```sh
pnpm worker
```

Development memakai `tsx`; API otomatis restart saat source berubah. Untuk production, compile source ke `dist/`, lalu jalankan API dan worker sebagai dua process:

```sh
pnpm build
pnpm start
# Terminal/process kedua:
pnpm worker:start
```

`pnpm typecheck` memeriksa source, test, dan konfigurasi Prisma tanpa menghasilkan file. `pnpm build` membuat Prisma Client dan mengompilasi source backend dengan `tsconfig.build.json`. Import relatif di file TypeScript memakai ekstensi `.js` agar output ESM langsung dapat dijalankan Node.js.

Atau jalankan seluruh stack (termasuk migration, API, worker):

```sh
docker compose --profile app up --build -d
```

API: `http://localhost:3000/api/v1`. Liveness: `GET /health`. Console MinIO lokal: `http://localhost:9001`. Bucket dibuat otomatis saat startup dan tetap private. Konfigurasi Compose ditujukan untuk development.

`MINIO_ENDPOINT` adalah host yang dihubungi server. `MINIO_PUBLIC_ENDPOINT` adalah host yang dapat diakses browser; backend menandatangani URL menggunakan host ini sejak awal. Untuk pengujian melalui HP, ganti public endpoint dengan IP LAN komputer atau domain MinIO, serta `WEB_URL`/`CORS_ORIGINS` dengan alamat frontend yang sesuai. Jangan mengganti hostname URL setelah ditandatangani. `MINIO_REGION` default `us-east-1`.

## Struktur MVP

```text
src/
  routes/        URL, auth, upload, rate limit
  controllers/   parsing request, validasi DTO, HTTP response
  services/      business logic, MinIO, render gambar
  models/        akses database melalui Prisma, transaksi, queue
  objects/       request schemas (Zod) dan response object models
  middleware/    auth, error handler, multipart upload
  config/        environment dan database/storage clients
  types/         tipe domain Prisma, kontrak repository, dan Express request
  app.ts         Express factory; dapat diuji tanpa koneksi eksternal
  container.ts   dependency wiring
  server.ts      API process
  worker.ts      generation worker process
prisma/
  schema.prisma
  migrations/    initial migration PostgreSQL
test/
  api.test.ts
  models.test.ts
  integration.test.ts
  helpers.ts
tsconfig.json         strict type-check source, test, Prisma config
tsconfig.build.json   build backend ke dist/
```

Alur request: **route → controller → service → model → Prisma**. Object model publik berada di `src/objects/responses.ts`; DTO request dan tipe input diturunkan dari Zod di `src/objects/requests.ts`; tipe entity/relasi mengikuti Prisma di `src/types/domain.ts`. Model database berada di `prisma/schema.prisma`.

Relasi: `PhotoSession` mempunyai satu `Photo` dan banyak `Generation`. `Generation` dapat mempunyai satu `Frame`. `objectId` menyimpan key MinIO lengkap sebagai TEXT (misalnya `event-a/images/<uuid>`), bukan selalu UUID. ID entity tetap UUID. Key UUID lama tetap valid dan tidak dipindahkan. Database tidak menyimpan URL MinIO atau isi gambar. Token claim disimpan sebagai SHA-256 hash; hash credential akses disimpan pada `PhotoSession.accessTokenHash` bersamaan dengan claim. `expiresAt` di PostgreSQL menjadi batas akses tunggal (default 24 jam sejak dibuat), baik sudah maupun belum diklaim. Claim tidak memperpanjang expiry.

Upload multipart ke `POST /api/v1/photo-sessions` (atau `/upload-image`) dan `POST /api/v1/frames` menerima field opsional `event`, misalnya `event-a`. Nama event maksimal 120 karakter, diawali huruf/angka, kemudian huruf, angka, `_`, atau `-`.

- Foto dan hasil generate: `event-a/images/<uuid>`.
- Frame: `event-a/frames/<uuid>`.
- Tanpa `event`: `images/<uuid>` atau `frames/<uuid>` (frame global).

Contoh form-data foto: `image` = file, `event` = `event-a`. Untuk frame tambahkan `name`. MinIO menampilkan folder otomatis setelah upload pertama; tidak perlu membuat folder kosong. Ekstensi tidak diperlukan karena Content-Type disimpan. Hasil generate mengikuti event foto asal. Prefix event hanya mengelompokkan penyimpanan, bukan batas otorisasi; daftar frame tetap global.

Sebelum menjalankan versi ini, jalankan `npm run db:migrate` dan `npm run db:generate` di folder backend untuk mengubah kolom `objectId` dari UUID ke TEXT tanpa mengubah key lama.

## API

Semua route berikut berawalan `/api/v1`. Response sukses `{ "data": ... }`, kecuali DELETE yang mengembalikan `204`. Response error `{ "error": { "code": "...", "message": "..." } }`.

| Method | Endpoint | Auth | Input / hasil |
| --- | --- | --- | --- |
| GET | `/frames` | Publik | Semua frame aktif, termasuk presigned image URL |
| GET | `/frames/:id` | Publik | Detail frame aktif |
| POST | `/frames` | Admin | Multipart: `name`, file `image` |
| PATCH | `/frames/:id` | Admin | JSON: `name` dan/atau boolean `active` |
| DELETE | `/frames/:id` | Admin | Soft delete (`active=false`) |
| POST | `/photo-sessions` | Kiosk | Multipart file `image`; session, photo code, token, QR URL |
| GET | `/photo-sessions/:code` | Browser | Foto metadata, expiresAt, quota tersisa, mode tersedia |
| POST | `/photo-sessions/:code/claim` | Token QR | JSON: `token`; membuat cookie browser session |
| GET | `/photos/:code` | Browser pemilik | Metadata foto original + `imageUrl` presigned |
| POST | `/generations` | Browser pemilik | JSON: `sessionCode`, `mode`, opsional `frameId`; header `Idempotency-Key` |
| GET | `/generations/:id` | Browser pemilik | Status job, hasil presigned URL jika selesai |
| GET | `/photo-sessions/:codeOrId/generations` | Browser pemilik | Semua generation session; menerima code atau UUID session |

Alias kompatibilitas:

- `GET /frame/:id`, `POST /frame`, `PATCH /frame/:id`, `DELETE /frame/:id` sama dengan endpoint plural.
- `POST /upload-image` menjalankan alur lengkap create photo session agar upload langsung mempunyai photo code dan token claim.
- `GET /image/:code` sama dengan `GET /photos/:code` dan menggunakan **photo code**, bukan session code. Keduanya mengembalikan JSON presigned URL, bukan binary atau redirect.

Admin/kiosk memakai header `X-API-Key`, dengan key masing-masing dari `.env`. Jangan taruh admin/kiosk key dalam frontend publik. Browser memakai cookie `photo_session` yang `HttpOnly`, `SameSite=Lax`, dan `Secure` saat production. Frontend memakai `credentials: 'include'`. Production membutuhkan HTTPS dan frontend/API pada site yang sama, misalnya `app.example.com` dan `api.example.com`. `CORS_ORIGINS` berisi origin frontend yang dipisahkan koma.

## Alur kiosk → QR → browser → hasil

### 1. Admin upload frame

Frame harus berupa gambar dengan alpha channel dan area transparan untuk foto. Dimensi frame menentukan dimensi output. Foto di-resize dengan `cover` dan center crop, lalu frame dipasang di atasnya. PATCH mengubah nama/status; untuk gambar frame baru, buat frame baru agar job lama konsisten.

```sh
curl -X POST http://localhost:3000/api/v1/frames \
  -H "X-API-Key: YOUR_ADMIN_KEY" \
  -F "name=Birthday" -F "image=@frame.png"
```

### 2. Kiosk upload foto

```sh
curl -X POST http://localhost:3000/api/v1/photo-sessions \
  -H "X-API-Key: YOUR_KIOSK_KEY" -F "image=@photo.jpg"
```

Response `201` berisi `id`, `code`, `photo.code`, `photo.objectId`, `expiresAt`, `remainingGeneration`, `availableModes`, `claimToken`, dan `qrUrl`. Kiosk membuat QR dari nilai `qrUrl`:

```text
http://localhost:5173/claim/<session-code>#token=<claim-token>
```

Backend mengembalikan URL untuk dijadikan QR, bukan file gambar QR. Halaman frontend `/claim/:code` membaca token dari URL fragment, melakukan claim, lalu menghapus fragment dari address bar. Fragment menjaga token agar tidak ikut terkirim sebagai query ke web server.

### 3. Browser claim sekali

```sh
curl -c cookies.txt -X POST http://localhost:3000/api/v1/photo-sessions/SESSION_CODE/claim \
  -H "Content-Type: application/json" -d '{"token":"CLAIM_TOKEN"}'
```

Claim bersamaan hanya menghasilkan satu pemilik. Browser pemilik yang masih memiliki cookie dapat retry claim. Browser lain menerima `409`. Session info/foto hanya dapat dibuka setelah claim; foto private tidak dapat diakses hanya dengan mengetahui code.

```js
const code = 'SESSION_CODE';
const token = new URLSearchParams(location.hash.slice(1)).get('token');
const response = await fetch(`http://localhost:3000/api/v1/photo-sessions/${code}/claim`, {
  method: 'POST', credentials: 'include',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ token }),
});
if (response.ok) history.replaceState(null, '', location.pathname);
```

### 4. Ambil original photo

```sh
curl -b cookies.txt http://localhost:3000/api/v1/photo-sessions/SESSION_CODE
curl -b cookies.txt http://localhost:3000/api/v1/photos/PHOTO_CODE
```

Gunakan `data.imageUrl` sebagai sumber gambar. URL bersifat sementara; jika kedaluwarsa, minta URL baru dari endpoint. Masa berlaku maksimal default 300 detik dan dibatasi sisa masa aktif photo session.

### 5. Buat generation

```sh
curl -b cookies.txt -X POST http://localhost:3000/api/v1/generations \
  -H "Content-Type: application/json" -H "Idempotency-Key: render-001" \
  -d '{"sessionCode":"SESSION_CODE","mode":"FRAME","frameId":"FRAME_UUID"}'
```

Mode `ORIGINAL` tidak menerima `frameId`. Untuk retry HTTP gunakan key yang sama dan payload yang sama. Untuk generation baru gunakan key baru. Key sama + payload berbeda menghasilkan `409`. Response `202` berisi job ID. Poll:

```sh
curl -b cookies.txt http://localhost:3000/api/v1/generations/GENERATION_UUID
curl -b cookies.txt http://localhost:3000/api/v1/photo-sessions/SESSION_CODE/generations
```

Status: `QUEUED → PROCESSING → COMPLETED` atau `FAILED`. Job selesai mempunyai `objectId` dan `imageUrl`. Job gagal mengembalikan quota tepat sekali; buat request dengan key baru untuk mencoba kembali.

## Perilaku dan batas MVP

- Default: masa session 24 jam, maksimal 3 generation, upload 10 MB, maksimal 25 megapixel. Bisa dikonfigurasi lewat `.env`.
- Input hanya JPEG/PNG/WebP statis. Gambar didekode dan dikonversi menjadi PNG, orientasi EXIF diterapkan dan metadata dibuang.
- Queue durable berada di PostgreSQL. Worker mengambil job dengan `FOR UPDATE SKIP LOCKED`, lease default 120 detik, dan token kepemilikan. Worker yang mati akan diambil alih setelah lease habis; maksimal 3 pengambilan sebelum gagal. Naikkan lease jika proses render biasa lebih lama dari 120 detik.
- Soft delete frame mempertahankan asset untuk generation yang sudah diantrekan. Frame nonaktif tidak dapat dipilih untuk job baru. Reactivate dengan PATCH `{"active":true}`.
- Cookie hilang berarti pengguna perlu photo session/QR baru. MVP belum menyediakan pemulihan claim atau pemindahan perangkat.
- Credential yang dikenali tetapi photo session sudah kedaluwarsa mengembalikan `410`; credential tidak ada/tidak dikenali mengembalikan `401`. Claim yang kedaluwarsa mengembalikan `410`. Expiry membatasi akses; file dan row tidak otomatis dihapus.
- Kegagalan normal menyimpan row akan mencoba menghapus object upload. Crash di antara MinIO dan commit database masih dapat meninggalkan object tanpa referensi karena keduanya tidak berbagi transaksi.
- Rate limit menggunakan memory process untuk MVP. Deployment beberapa API replica memerlukan shared rate-limit store. Bila memakai reverse proxy, konfigurasikan trust proxy secara spesifik sebelum mengandalkan IP client.
- Frontend claim/QR dan dashboard admin tidak termasuk backend ini. Tidak ada provider AI: generation adalah compositing lokal.

## Pengujian

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm exec prisma validate
```

Unit/HTTP tests memakai model dan storage dalam memory, dengan Sharp asli untuk validasi gambar/render. Suite integrasi terpisah memakai Prisma, PostgreSQL, dan MinIO sungguhan:

```sh
docker compose up -d postgres minio
docker compose exec postgres createdb -U photobooth photobooth_test
```

Tambahkan `TEST_DATABASE_URL=postgresql://photobooth:photobooth@localhost:5432/photobooth_test` ke `.env`, lalu jalankan `pnpm test:integration`. Jangan menjalankan worker eksternal pada database test. Suite mensyaratkan nama DB berakhiran `_test`, menerapkan migration, menguji claim bersamaan, retry idempotent, quota bersamaan, render/URL MinIO, lease recovery, dan refund. Fixture yang dibuat suite dibersihkan setelah pengujian.

Prisma menggunakan konfigurasi datasource dan PostgreSQL driver adapter sesuai [dokumentasi Prisma](https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/databases-connections). Akses object/presigned URL menggunakan [MinIO JavaScript SDK](https://github.com/minio/minio-js).

Migrasi penghapusan Redis: jalankan `pnpm db:migrate` dan restart API/worker. Cookie lama dari Redis tidak dapat digunakan; session yang sudah diklaim sebelumnya memerlukan photo session/QR baru. Tidak ada pemindahan token Redis otomatis.
