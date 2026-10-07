# Rencana desktop kiosk Photobooth AI

Status: PLANNING diperbarui 2026-10-07 untuk tahap 1 (perapihan dokumen). Keputusan pengguna, rekomendasi teknologi, dan pekerjaan yang belum diuji dibedakan di bawah. Integrasi hardware dan deployment belum dilakukan.

Dokumen utama planning backend dan UI desktop event. Semua struktur file, endpoint baru, skema lokal, dan pilihan teknologi di bawah adalah usulan implementasi, bukan fitur yang sudah tersedia. Dokumen ditulis dalam bahasa Indonesia untuk review di repo PhBo.

Update arsitektur pengguna: lihat [diagram arsi phbo](<arsi phbo.jpeg>) dan [planning API gateway serta jalur foto](PHBO_API_GATEWAY_ARCHITECTURE.md). Request kontrol desktop menggunakan API gateway; upload/download bytes foto menggunakan jalur media tanpa melalui gateway. Kontrak endpoint yang tercantum sebagai source saat ini tetap dibedakan dari route target `kiosk/core/web`.

Perangkat yang ditentukan pengguna: PC Windows dan kamera Canon EOS 2000D melalui kabel data USB. Pilihan pembelian printer saat ini Epson EcoTank L8050, tetapi pengguna meminta agar printer dapat diganti, termasuk ke Canon. L8050 menjadi target profil/uji pertama, bukan batas merek aplikasi. Versi/arsitektur Windows belum ditentukan; USB melalui driver Windows direkomendasikan sebagai koneksi printer awal.

## Ringkasan keputusan dan rekomendasi

| Area | Baseline planning | Status |
| --- | --- | --- |
| OS dan kamera | Windows; Canon EOS 2000D melalui USB | Ditentukan pengguna; versi OS/firmware dan hardware acceptance pending |
| Printer | Adapter cetak Windows lintas merek; profil pertama Epson L8050, Canon dapat memakai profil terpisah | Permintaan pengguna; setiap model wajib test print |
| Advanced | Satu foto pada lembar 4R, 4 × 6 inci (101,6 × 152,4 mm) | Baseline format; crop/borderless divalidasi fisik |
| Classic | Dua strip 2 × 6 inci pada satu lembar 4R, dipotong manual | Baseline format; strip ini bukan ukuran 2R |
| Desktop shell | Electron + React/Vite, proses adapter native C#/.NET | Rekomendasi untuk reuse frontend dan integrasi Windows; keputusan implementasi menunggu PoC/review |
| State lokal | SQLite untuk jurnal; filesystem untuk foto; credential store Windows untuk secret | Rekomendasi; tidak mengganti database server |
| Server | API Express existing, PostgreSQL, worker/provider existing, MinIO | Mengikuti source/runtime; tidak melakukan migrasi backend |
| Gateway | NGINX OSS untuk JSON kontrol; jalur media terpisah | Rekomendasi; belum diimplementasikan |
| Queue | PostgreSQL tetap baseline aktif; Redis queue sesuai diagram sebagai tahap terpisah | Tidak dipindahkan pada tahap gateway |

Keputusan teknologi yang direkomendasikan bukan klaim telah dipilih atau dibangun. Tahap ini menghasilkan dokumen review, tanpa scaffolding, perubahan API, atau deployment.

## Tujuan dan batas lingkup

Desktop app di komputer event mengelola sesi tamu, kamera Canon, dan printer melalui driver Windows. Web tetap menjadi kanal yang sudah ada. Backend generation dan katalog dipakai bersama melalui kontrak API yang disepakati.

MVP diusulkan untuk satu komputer, satu kamera, satu printer aktif, dan satu ukuran kertas 4R dengan profil layout Advanced/Classic. Tidak mencakup pembayaran, Android, Google Drive, fleet management, atau pembangunan ulang admin/template management. QR dapat menjadi tambahan setelah alur kamera sampai cetak lulus; bukan syarat MVP.

## Kondisi source yang ditemukan

- `frontend/` memakai React + Vite; komponen alur capture/review/processing/result sudah ada dan perlu dinilai untuk reuse.
- `backend/` berisi FastAPI; Compose utama masih mendefinisikan layanan ini.
- `backend-express/` berisi jalur native kiosk: sesi foto, upload, generation dengan idempotency key, polling hasil, dan akses result.
- `backend-express/src/controllers/native-kiosk.controller.ts` menyediakan metadata/download rendition cetak. Ini bukan integrasi printer fisik.
- `docs/BACKEND_RESTRUCTURE_REVIEW.md` adalah review baseline/historis. Pada `origin/main` commit `0335a4f`, `backend-express/MIGRATION.md` mencatat Express sebagai API production dan FastAPI dipertahankan untuk rollback. Rencana integrasi desktop memprioritaskan kontrak Express yang sudah ada; base URL dan versi runtime tetap diverifikasi sebelum implementasi.
- Pemeriksaan read-only 2026-10-07: container web/API healthy; `/api/health` melaporkan database, Redis, storage, queue `ok`, queue backend PostgreSQL, provider terhubung. Ini bukan bukti generation nyata atau integrasi kamera/printer; keduanya belum diuji pada pemeriksaan ini.

## Keputusan sebelum implementasi

1. OS sudah Windows; konfirmasi versi dan arsitektur komputer event.
2. Kamera sudah Canon EOS 2000D melalui USB; konfirmasi firmware dan uji live view/autofocus. EOS 2000D tercantum pada daftar kompatibilitas Canon EDSDK v13.19.0 untuk Windows; verifikasi kembali paket SDK yang akan digunakan.
3. Profil pertama Epson L8050; jika diganti Canon/model lain, verifikasi driver Windows, koneksi, ukuran media, borderless, silent print, dan pelaporan status pada model tersebut. Tidak semua printer otomatis kompatibel hanya karena terdaftar di Windows.
4. Baseline Advanced 4R dan Classic dua strip 2 × 6 inci per lembar 4R dengan potong manual. Tetapkan jumlah salinan, jenis kertas, fit/crop, kualitas dan safe area melalui test print; Basic tidak diasumsikan memiliki profil cetak tervalidasi.
5. Mode yang disediakan saat event: Classic, Basic, Advanced, atau subset. Classic ditemukan di source saat ini; Basic/Advanced hanya aktif jika engine/provider benar-benar tersedia.
6. Target API dan credential kiosk; kebijakan event mengenai koneksi internet, penyimpanan foto, serta waktu penghapusan.

## Rancangan yang diusulkan, belum diputuskan

```text
Kamera Canon <-> adapter kamera lokal
                       |
                 Desktop kiosk UI <-> trusted orchestrator lokal
                       |                     |
                       |          kontrol JSON -> API gateway -> API PhBo
                       |          bytes foto -> API media / MinIO (bypass gateway)
                       |
                 adapter cetak lokal <-> antrean OS <-> printer terpilih
                       |
                 file sesi + jurnal pekerjaan lokal
```

Pembagian tanggung jawab:

- Desktop: live view, countdown, shutter, transfer foto, review/retake, penyimpanan lokal sementara, pemulihan sesi, antrean cetak, reset tamu, serta diagnostik operator.
- Backend: validasi upload, katalog, generation, status job, ownership, dan hasil menggunakan kontrak yang sudah ada.
- Gateway: hanya request kontrol/metadata. Trusted backend-client memisahkan control client dan media client; file foto tidak dikirim sebagai multipart/base64 melalui gateway. Request izin/URL media tetap lewat gateway.
- Kamera/printer berada di komputer event; backend VPS tidak mengakses USB perangkat event.
- Capture dan penyimpanan foto dibuat lokal. Generation online memerlukan backend/provider; kemampuan Classic offline merupakan scope tambahan yang perlu keputusan, bukan janji MVP.

Opsi desktop untuk dibandingkan setelah PoC hardware:

| Opsi | Kegunaan | Hal yang harus dibuktikan |
| --- | --- | --- |
| Electron + React + proses adapter native | Reuse UI React yang sudah ada | Integrasi SDK, konsumsi sumber daya, isolasi IPC, packaging adapter |
| .NET desktop + UI native atau WebView | Kandidat jika fokus Windows dan integrasi native | Biaya reuse UI, deployment runtime, integrasi SDK dan cetak |
| Tauri + React + adapter native | Alternatif shell dengan UI React | Binding SDK, packaging, mekanisme cetak, beban maintenance |

Electron + React/Vite dengan adapter C#/.NET menjadi rekomendasi utama dalam planning. Opsi lain dipertahankan sebagai fallback jika PoC hardware/packaging gagal; implementasi framework menunggu review keputusan dan bukti PoC.

## Integrasi kamera

Canon menyediakan EDSDK untuk koneksi USB dan CCAPI untuk HTTP/network. Kandidat awal adalah EDSDK melalui USB; cek model dan firmware pada daftar kompatibilitas resmi terlebih dahulu. Akses SDK dan ketentuan distribusi diperiksa sebelum installer dibuat.

Untuk EOS 2000D pada rencana ini, jalur capture adalah kabel data USB ke PC Windows dengan EDSDK, bukan jalur Wi-Fi. Uji awal memakai EOS Utility sebagai diagnosis koneksi/remote shooting, kemudian tutup EOS Utility saat menguji adapter kiosk untuk memeriksa konflik akses kamera. Verifikasi kabel mampu transfer data, pengaturan power-off, serta kebutuhan daya untuk durasi event. Capture sukses berarti JPEG resolusi penuh sudah ditransfer dan diverifikasi di PC, bukan hanya frame live view.

Kontrak adapter: daftar perangkat, connect/disconnect, mulai/hentikan live view, capture, transfer foto, dan status/error. Jangan menganggap webcam browser identik dengan kontrol kamera Canon.

PoC harus membuktikan live view, shutter, foto resolusi penuh tersimpan, orientasi benar, disconnect/reconnect, timeout, dan kamera busy. Proses native diusulkan terpisah agar kegagalan SDK dapat dipulihkan tanpa kehilangan sesi UI.

## Integrasi printer

Gunakan jalur printer OS yang didukung model terpilih; tidak mengasumsikan SDK kamera bisa mengontrol printer. PoC mencakup discovery printer, driver/protokol, media size, orientation, copies, margins, dan cetak tanpa dialog pelanggan.

Pisahkan master result dari berkas siap cetak. Validasi rasio fisik, bleed/crop, safe area, dan scaling berdasarkan media sebenarnya. Untuk Classic, susun dua strip 2 × 6 inci berdampingan pada satu lembar 4R portrait; pemotongan manual dilakukan setelah cetak. Jangan mengirim kertas 2 × 6 inci sebagai asumsi dukungan driver atau mengklaim auto-cut. Advanced memakai satu foto 4R dengan crop yang sama antara preview dan cetakan.

Jurnal lokal menyimpan ID pekerjaan, result, printer, copies, status, serta waktu submit. Diterima spooler tidak boleh dilaporkan sebagai cetakan fisik selesai. Jika driver tidak memberikan bukti completion, gunakan status accepted/unknown dan konfirmasi operator. Sesudah crash atau timeout ambigu, jangan otomatis mengirim ulang; operator menentukan reprint agar tidak mencetak ganda.

## Alur tamu dan operator

Tamu: mulai -> pilih mode/template -> live view -> countdown -> capture -> review/retake -> generation -> preview -> print -> reset sesi.

Operator: persiapan event -> cek kamera/printer/API -> test capture dan test print -> buka kiosk. Akses operator dilindungi dari tamu; menyediakan reconnect, inspeksi antrean, reprint terkontrol, dan recovery sesi. Gunakan konfigurasi event yang sudah tersedia bila sesuai, tanpa membangun admin baru.

State sesi lokal dipisahkan dari state generation (`QUEUED`, `PROCESSING`, `COMPLETED`, `FAILED`) dan state cetak. Generation selesai tidak berarti print selesai. Satu session ID memetakan capture, upload, job generation, result, dan pekerjaan cetak.

## Ketahanan dan data

- Simpan capture sebelum upload; retry upload/generation dengan ID dan idempotency yang konsisten supaya tidak membuat pekerjaan/biaya ganda.
- Setelah restart, pulihkan jurnal dan periksa status backend sebelum retry. Tidak mengirim ulang print yang hasilnya ambigu.
- Saat internet putus, foto tersimpan; beritahu bahwa generation belum tersedia. Cetak hasil yang sudah tersimpan dapat dilanjutkan jika printer tersedia.
- Reset layar dan data sesi aktif sebelum tamu berikutnya; tamu tidak dapat membuka sesi sebelumnya.
- Credential berada di penyimpanan OS/proses tepercaya, bukan bundle React. IPC hanya mengizinkan operasi tertentu; adapter tidak menerima shell command atau path arbitrary dari UI. Jika memakai localhost, bind loopback dan autentikasi panggilannya.
- Tentukan folder data desktop melalui fasilitas app-data OS dan kebijakan retention event. `/srv/photobooth` tetap untuk runtime VPS; jangan memaksakan path Linux pada Windows.
- Log diagnostik memakai ID dan kode error tanpa foto, secret, atau URL akses sensitif. Penghapusan capture mengikuti retention yang disepakati dan tidak dilakukan saat pekerjaan masih membutuhkannya.
- Engine/provider tidak tersedia harus menghasilkan `BASIC_ENGINE_NOT_CONNECTED` atau `AI_PROVIDER_NOT_CONNECTED`; tidak ada placeholder sukses.

## Tahapan dan kriteria lulus

| Tahap | Deliverable | Kriteria lulus |
| --- | --- | --- |
| 0. Hardware dan keputusan | Model/OS/media/API terpilih, matriks kompatibilitas, keputusan shell | Ketersediaan SDK/driver terverifikasi dan pemilik proyek menyetujui rancangan |
| 1. PoC hardware | Test tool kamera dan printer | Capture asli dan cetak fisik benar; reconnect dan error tercatat pada perangkat target |
| 2. Desktop capture | Installer percobaan, live view, countdown, review, jurnal sesi | Beberapa sesi nyata; retake/reset tidak mencampur foto antartamu; restart memulihkan capture |
| 3. Integrasi backend | Upload, generation, polling, download/cache result | Hasil nyata; disconnect/retry/restart tidak menggandakan job; error engine/provider ditampilkan |
| 4. Cetak | Print profile, antrean persisten, kontrol copies/reprint | Ukuran fisik benar, tanpa dialog tamu, double click tidak menggandakan print; printer offline dan outcome ambigu ditangani |
| 5. Uji event | Installer di komputer event, panduan operator, laporan soak test | Target durasi, jumlah sesi, latency, kapasitas print, recovery, dan retention disepakati lalu diuji |

Setiap tahap dilaporkan dan ditinjau sebelum beralih tahap. Estimasi waktu dibuat setelah model hardware dan hasil PoC tersedia. Uji printer harus memakai cetakan fisik; screenshot UI atau HTTP 200 tidak cukup.

## Referensi resmi

- Canon SDK dan tabel kompatibilitas: https://industrial.imaging.canon.de/integration/sdk/
- Daftar kompatibilitas EDSDK v13.19.0, termasuk EOS 2000D: https://developercommunity.usa.canon.com/resource/1744393287000/CDC_EDSDKRAW_Compat_List
- EOS Utility, kamera yang kompatibel: https://cam.start.canon/en/S003/manual/html/UG-00_Before_0050.html

- [Spesifikasi resmi Epson EcoTank L8050](https://www.epson.co.id/Untuk-Rumah/Printer-untuk-Rumah/Home-Office-Printers/Printer-Tangki-Tinta-Epson-EcoTank-L8050-/p/C11CK37501), diperiksa 2026-10-07: 6 tinta dye, USB 2.0/Wi-Fi, 4R borderless, sekitar 25 detik pada mode Photo Default dengan Epson Premium Glossy Photo Paper. Pengukuran tidak mencakup pemrosesan komputer.

Dukungan printer fisik tetap memerlukan test print pada perangkat pengguna. Spesifikasi L8050 tidak diterapkan pada profil Canon/model lain.

## Struktur aplikasi yang diusulkan

Rekomendasi awal untuk dibandingkan melalui PoC: Electron + React/Vite untuk desktop, proses adapter kamera C#/.NET melalui binding EDSDK, adapter Windows printing, dan SQLite untuk metadata/jurnal lokal. Ini menambah client desktop; tidak mengganti database PostgreSQL, queue, worker, atau provider backend server. Jika PoC menunjukkan shell .NET lebih tepat, struktur tanggung jawab berikut tetap berlaku dan keputusan dicatat sebelum implementasi.

```text
desktop/                          # Paket baru; belum dibuat
  package.json
  electron/
    main.ts                       # Lifecycle window, single instance, kiosk mode
    preload.ts                    # Bridge IPC dengan operasi terbatas
    ipc/
      session.handlers.ts
      camera.handlers.ts
      printer.handlers.ts
      operator.handlers.ts
    services/
      session-orchestrator.ts     # Urutan capture -> upload -> generation -> print
      device-supervisor.ts        # Proses adapter, heartbeat, recovery
      backend-client.ts           # TLS, auth, cookie jar/token, retry
      control-client.ts           # JSON/session/catalog/generation melalui gateway
      media-client.ts             # Upload/download bytes bypass gateway
      catalog-cache.ts
      capture-store.ts            # File aman dan checksum
      upload-outbox.ts            # Upload persisten dan rekonsiliasi
      generation-monitor.ts      # Polling status nyata
      result-cache.ts
      print-preparation.ts        # Layout fisik, profil media
      print-queue.ts              # Submit terurut dan rekonsiliasi spooler
      recovery-service.ts
      retention-service.ts
    repositories/
      local-database.ts
      migrations/
      sessions.repository.ts
      captures.repository.ts
      operations.repository.ts
      print-jobs.repository.ts
    security/
      credential-store.ts         # Penyimpanan credential OS
      operator-access.ts
    diagnostics/
      logger.ts
      support-export.ts          # Tanpa foto/token/secret
  src/
    App.tsx
    screens/                     # UI tamu dan operator, lihat tabel layar
    components/
      LiveView.tsx
      Countdown.tsx
      CaptureSlots.tsx
      TemplateCard.tsx
      ResultPreview.tsx
      DeviceStatus.tsx
      ErrorPanel.tsx
    state/
      session-machine.ts
      operator-state.ts
    bridge/
      kiosk-client.ts             # UI memanggil IPC, bukan USB/secret/backend
    styles/
      kiosk.css
  shared/
    commands.ts
    events.ts
    schemas.ts
    errors.ts
  native/
    CanonCameraBridge/            # Integrasi EOS 2000D dan EDSDK
    WindowsPrintBridge/           # Adapter Windows spooler/driver
  tests/
    unit/
    integration/
    ui/
    hardware/                     # Test manual/otomasi di Windows event
  packaging/
    installer-config.*
  .env.example                    # Tanpa secret nyata

docs/
  DESKTOP_KIOSK_PLAN.md            # Dokumen ini
  desktop/                        # Dokumen lanjutan saat tahap terkait dikerjakan
    HARDWARE_ACCEPTANCE.md
    API_CONTRACT.md
    OPERATOR_GUIDE.md
    RELEASE_CHECKLIST.md
```

Nama file adalah arah organisasi, bukan kewajiban membuat semua scaffolding sekaligus. Buat hanya modul yang diperlukan tahap aktif. Hindari dependency tambahan sampai kebutuhan terbukti.

Reuse frontend dilakukan setelah menilai coupling komponen sekarang terhadap browser API dan session web. Prioritaskan aturan validasi, presentasi template, pesan error, dan tampilan preview. Kamera browser dan fetch web tidak disalin sebagai mekanisme hardware desktop. Jangan memindahkan frontend publik ke desktop atau mengubah frontend web hanya untuk menghindari duplikasi beberapa komponen.

## Struktur backend server dan boundary

Backend desktop lokal adalah orchestrator dan adapter hardware, bukan server generation kedua. Server Photobooth tetap menjadi sumber otoritatif untuk katalog, izin mode, generation, quota, dan result.

Target gateway/domain mengikuti dokumen arsitektur terpisah yang ditautkan di awal. Diagram pengguna menargetkan Redis `queue-classic`/`queue-router`, sementara catatan release repo mencatat PostgreSQL dispatch dan Redis rate limits. Planning desktop tidak otomatis mengganti queue. Perubahan dispatch perlu sprint terpisah.

### Jalur yang sudah ditemukan di Express

```text
/api/v1 route
  -> native-kiosk.controller
  -> native-kiosk.service
  -> customer upload/generation/result services
  -> model/database + storage
  -> generation worker
  -> image engine/provider abstraction
```

Lokasi source relevan:

- `backend-express/src/routes/native-kiosk.routes.ts`
- `backend-express/src/controllers/native-kiosk.controller.ts`
- `backend-express/src/services/native-kiosk.service.ts`
- `backend-express/src/models/native-kiosk.model.ts`
- `backend-express/src/services/customer-generation.service.ts`
- `backend-express/src/services/customer-result.service.ts`
- `frontend/src/nativeKioskApi.js`

Target awal sesuai catatan production repo adalah Express; keberadaan folder FastAPI dan Compose dasar tidak menjadi alasan migrasi kembali. Jika pengguna secara eksplisit memilih FastAPI kemudian, perubahan target membutuhkan keputusan terpisah dan kontrak padanan yang ditulis khusus. Desktop tidak boleh mencoba dua backend bergantian ketika request gagal; satu instalasi mengikat satu API target/version yang teruji.

Dokumen `RETRO_DEPLOYMENT.md` mencatat proxy Express pada release frontend terdahulu, tetapi itu bukan verifikasi runtime API kiosk hari ini. Tahap 0 harus memastikan base URL, version, health, enabled mode, dan endpoint kiosk yang benar-benar aktif. Tidak diperlukan cutover backend atau Docker/PostgreSQL/Redis lokal di PC event untuk rancangan ini.

### Kontrak source saat ini, belum klaim runtime

| Operasi | Endpoint Express yang ditemukan | Input/akses dan hasil penting |
| --- | --- | --- |
| Buat sesi + upload foto | `POST /api/v1/photo-sessions` | `X-API-Key`, multipart field `image` 1–4 file, field `event` opsional; 201 `{data: ...}` berisi `code`, `photos`, `claimToken`, expiry |
| Claim sesi | `POST /api/v1/photo-sessions/:code/claim` | JSON `{token}`; menghasilkan cookie `photo_session` HttpOnly pada path `/api/v1` |
| Baca sesi | `GET /api/v1/photo-sessions/:code` | Cookie sesi; foto, quota, mode/selection yang diizinkan |
| Katalog | `GET /api/v1/frames`, `/templates`, `/experiences`, `/frame-styles`, `/ornaments` | Metadata untuk pilihan pelanggan; server tetap memvalidasi selection |
| Generation | `POST /api/v1/generations` | Cookie + `Idempotency-Key`; JSON selection di bawah; 202 `{data: ...}` |
| Status generation | `GET /api/v1/generations/:id` | Cookie; `status`, `resultId`, error, URL hasil |
| Riwayat sesi | `GET /api/v1/photo-sessions/:code/generations` | Cookie; untuk rekonsiliasi pekerjaan |
| Metadata hasil | `GET /api/v1/results/:id` | Cookie; dimensi, checksum, URL master/download dan print jika tersedia |
| Download master | `GET /api/v1/results/:id/download` | Cookie; bytes image |
| Download rendition print | `GET /api/v1/results/:id/download?rendition=print` | Pada source ini hanya Classic 1:3; output 600×1800 dengan metadata 300 DPI |

Contoh request sesuai parser source, menggunakan placeholder ID dan tidak berisi secret:

```json
{
  "sessionCode": "<kode-sesi-server>",
  "mode": "CLASSIC",
  "photoIds": ["<photo-id-1>", "<photo-id-2>", "<photo-id-3>"],
  "frameId": "<layout-yang-diizinkan>",
  "ornamentIds": []
}
```

Basic memakai satu `photoIds` dan `templateId`; Advanced memakai satu foto, `experienceId`, serta selection frame/ornament sesuai izin. Shot count Classic mengikuti metadata layout dan validasi generation, bukan selalu tiga seperti contoh.

Source result metadata dapat mengandung provider/model. Backend-client desktop membuang field teknis itu dari view model pelanggan. UI tidak menawarkan provider, model ID, prompt, atau API key sebagai pilihan.

### Gap wajib untuk desktop yang andal

1. Sesi upload saat ini langsung menerima 1–4 foto. Capture, retake, dan pemilihan foto dilakukan lokal sebelum sesi server dibuat. Perlu kontrak lanjutan jika event membutuhkan append capture setelah sesi server ada.
2. `photo-sessions` belum menyediakan idempotency upload/session create. Jika respons 201 hilang setelah commit, retry buta berisiko sesi/foto ganda. Idempotency generation saja tidak menyelesaikan gap ini.
3. Cookie dari claim harus dikelola oleh trusted backend-client, terpisah per sesi dan tidak diakses React. Jangan melakukan claim otomatis sebelum menilai konsekuensi single-use claim terhadap QR pelanggan. QR ditunda pada MVP desktop; desain QR berikutnya harus menyediakan ownership desktop dan claim pelanggan yang terpisah.
4. Recovery sesudah restart perlu akses sesi yang aman sampai expiry. Simpan credential akses melalui proteksi OS dan hapus saat masa retensi berakhir; claim token jangan dicetak ke log.
5. Ukuran upload source harus diuji dengan JPEG EOS 2000D. Normalisasi/resizing untuk backend, jika diperlukan, menyimpan original lokal dan mengikuti batas API; jangan memperbesar upload limit tanpa uji memori, keamanan, dan kebutuhan.
6. Rendition print saat ini bukan profil driver/printer Windows tervalidasi. Basic/Advanced belum memiliki dukungan rendition print pada endpoint ini; desktop dapat menyusun master menjadi lembar cetak lokal setelah profilnya diuji.
7. Gateway tidak boleh menerima multipart upload endpoint gabungan saat ini. Target membutuhkan pemisahan create/read sesi (kontrol gateway) dan upload sesi (jalur media). Path `kiosk/session/{sessionCode}/upload` pada diagram pengguna belum ditemukan di source yang diperiksa; URL existing memerlukan compatibility mapping.

### Perubahan server minimum yang diusulkan

Pada API terpilih, tambahkan idempotency ke create session sebelum menetapkan desktop siap event:

Pemecahan sesi kontrol dan upload media harus mempersist operation/session ID sebelum transfer. Idempotency diperlukan untuk create session maupun upload/commit, bukan hanya generation. Detail mapping route dan izin media mengikuti `PHBO_API_GATEWAY_ARCHITECTURE.md`; daftar berikut menjelaskan kebutuhan pada kontrak existing, bukan instruksi melewatkan bytes foto melalui gateway.

- Header `Idempotency-Key` pada upload sesi; scope key ke identity kiosk + event.
- Fingerprint request berdasarkan selection dan hash file yang tervalidasi; key sama + isi berbeda -> 409 `IDEMPOTENCY_CONFLICT`.
- Reservasi key unik secara atomik, status operasi, expiry, dan referensi session. Tangani crash di tengah upload; gunakan status pending/failed yang bisa direkonsiliasi, bukan meninggalkan key sukses tanpa session.
- Replay hasil sukses harus mengembalikan sesi sama. Jika respons replay berisi credential sensitif, persist payload terenkripsi atau rancang pertukaran credential yang aman; hash claim token saat ini tidak bisa dipakai untuk membangun ulang token asli.
- Usulan endpoint baru: `GET /api/v1/kiosk/operations/:key` dengan auth kiosk dan scope yang sama. Respons minimal `PENDING`, `COMPLETED`, atau `FAILED`, serta referensi sesi jika aksesnya sah. Detail credential/replay disepakati dalam kontrak sebelum implementasi.
- Perubahan route, schema, service, model/migration dan pengujian harus berada di satu backend target saja. Tidak membuat migration Express dan FastAPI bersamaan untuk fitur yang sama.

Endpoint operasi di atas BELUM ADA dan tidak boleh dipanggil seolah sudah tersedia. Jika perubahan server ditunda, recovery upload ambigu harus berhenti untuk pemeriksaan operator; release dinyatakan PARTIAL untuk ketahanan event, bukan menjamin exactly-once.

## Model metadata lokal dan penyimpanan file

SQLite diusulkan hanya untuk state desktop persisten, dengan transaksi, migration version, dan locking single-instance. File foto tetap di filesystem. Database ini tidak menggantikan PostgreSQL server.

| Entitas | Field inti yang diusulkan | Aturan |
| --- | --- | --- |
| `event_config` | ID lokal/server, label, allowed modes, selection, printer/profile, version | Konfigurasi tervalidasi; izin server membatasi pilihan |
| `sessions` | ID lokal, event, phase, selection JSON, server code/ID, job/result IDs, timestamps | Credential hanya berupa reference ke secret store; satu sesi aktif tamu |
| `captures` | ID, session, slot, attempt, file reference, checksum, dimensi, accepted | Original tidak ditimpa retake; accepted shot dipilih eksplisit |
| `operations` | ID, session, type, key, fingerprint, status, attempts, retry time, remote ID | Key/fingerprint tetap untuk retry operasi yang sama |
| `results` | ID lokal/server, session, master file, checksum, dimensi | Download diverifikasi sebelum tersedia untuk print |
| `print_profiles` | ID/version, printer, paper mm, DPI target, margins, orientation, layout | Profil tervalidasi lewat cetakan fisik; snapshot per job |
| `print_jobs` | ID, session/result, print file hash, profile snapshot, copies, state, spooler ID, parent reprint ID | Print immutable setelah submit; reprint adalah job baru dengan alasan |
| `audit_events` | ID, session/job reference, action, timestamp, error code | Operator action tanpa foto/secret; retention terpisah |

Layout data memakai path app-data Windows yang dipilih packaging:

```text
<app-data>/PhotoboothKiosk/
  config/                 # Nonsecret
  state/kiosk.sqlite
  sessions/<generated-session-id>/
    captures/
    normalized/
    results/
    print/
  logs/
  cache/catalog/
```

Seluruh path dibuat trusted process dari ID yang dihasilkan aplikasi. UI hanya menerima opaque asset ID/preview, bukan absolute path. File ditulis ke temporary sibling lalu atomic rename; catat hash dan byte size sebelum menjadikan capture/result siap. Startup mendeteksi orphan/missing file dan meminta recovery; jangan otomatis menghapus capture yang belum direkonsiliasi.

## IPC dan kontrak adapter lokal

Untuk pilihan Electron, native adapter berkomunikasi dengan main process melalui pipe/stdio terbingkai; renderer memakai preload bridge. Tidak membuka HTTP port lokal jika tidak diperlukan. Protokol diberi version, request ID, timeout, event, dan validasi schema.

| Command | Input | Hasil/event |
| --- | --- | --- |
| `devices.getStatus` | Tidak ada | Kamera, printer, API, disk, adapter readiness |
| `session.start` | Event/selection ID | Session ID dan state |
| `camera.connect` | Device ID tervalidasi | Connected atau kode error |
| `camera.startLiveView` | Session ID | Preview frames melalui channel bounded |
| `camera.capture` | Session ID, slot ID, operation ID | `capture.started`, lalu `capture.saved` atau error |
| `session.acceptCapture` | Session ID, capture ID | Accepted slot; validasi ownership |
| `session.retake` | Session ID, slot ID | Review/capture state sesuai budget |
| `session.generate` | Session ID | Operation/job reference; tidak menerima prompt/provider |
| `printer.submit` | Session ID, result ID, profile ID, command ID | Job ID lokal lalu update state |
| `session.finish` | Session ID | Reset renderer setelah jurnal tersimpan |
| `operator.unlock` | Credential/PIN | Access sementara, throttling; tidak dicatat ke log |
| `operator.reprint` | Job ID, reason, copies | Job baru; operator access wajib |

Preview memiliki frame sequence/timestamp dan backpressure: drop frame preview lama saat renderer lambat, tetapi tidak boleh drop file capture. Tangani DSLR busy/autofocus failure secara eksplisit; tombol capture tidak memicu command paralel. Kamera hanya dimiliki satu proses adapter.

Untuk Electron: renderer tidak memakai Node integration, gunakan context isolation/sandbox sesuai kemampuan packaging, CSP, dan allowlist navigation. Native process memakai executable tetap dengan argumen tervalidasi; tidak menjalankan command bebas dari renderer. Detail setting dipastikan melalui dokumentasi resmi saat implementasi versi terpilih.

## State machine dan recovery

State sesi lokal yang diusulkan:

```text
IDLE -> SELECTING -> CAPTURING -> REVIEWING
                REVIEWING -> CAPTURING       # slot berikutnya / retake
                REVIEWING -> READY_TO_UPLOAD
READY_TO_UPLOAD -> UPLOADING -> GENERATING -> RESULT_READY
RESULT_READY -> PRINT_QUEUED -> PRINTING_OR_ACCEPTED -> FINISHED -> IDLE
```

`RECOVERY_REQUIRED` dan `CANCELLED` adalah cabang eksplisit. Interupsi printer tidak mengubah job generation menjadi FAILED. State generation memakai empat nilai existing. State print lokal diusulkan `PREPARED`, `SUBMITTING`, `ACCEPTED`, `CONFIRMED`, `FAILED`, `UNKNOWN`, `CANCELLED`:

- Simpan `SUBMITTING` sebelum panggilan spooler. Jika proses crash setelah spooler menerima tetapi sebelum ID dicatat, startup masuk `UNKNOWN`; jangan submit otomatis.
- `CONFIRMED` hanya jika ada bukti yang sesuai kemampuan driver atau konfirmasi operator. UI menampilkan “Dikirim ke printer” untuk `ACCEPTED`, bukan “Foto sudah tercetak”.
- Cancel antrean lokal yang belum submit aman; cancel spooler tidak menjamin lembar belum tercetak. Status outcome tetap dilacak.
- Satu command ID mencegah double click menjadi dua job. Idempotency internal tidak menjamin exactly-once fisik jika driver/OS tidak menyediakan rekonsiliasi.
- Sesi yang sudah ditutup dapat memiliki print job background; operator memiliki akses, tamu berikutnya tidak dapat melihat hasilnya.

| Gangguan | Respons aplikasi | Syarat melanjutkan |
| --- | --- | --- |
| Kamera dicabut | Hentikan capture; simpan slot yang sudah ada; tampilkan pesan jelas | Adapter reconnect dan status ready |
| SDK process crash | Supervisor restart terbatas; jangan ulang shutter ambigu otomatis | Verifikasi file/transfer terakhir, operator jika ambigu |
| Internet putus sebelum upload | Capture tetap lokal, outbox pending | Backend sehat dan pengguna/operator melanjutkan |
| Respons upload hilang | Rekonsiliasi operasi idempotent; jika belum didukung, recovery operator | Server session diketahui secara aman |
| Generation timeout | Periksa job/riwayat dengan key yang sama; tampilkan status nyata | Result atau error definitif dari backend |
| Printer offline/paper issue | Antrean ditahan; instruksi operator | Driver ready atau operator menyelesaikan masalah |
| App restart ketika print submit | Tandai unknown; cek spooler bila memungkinkan | Konfirmasi operator sebelum reprint |
| Disk hampir habis | Cegah sesi baru sebelum shutter; pertahankan sesi existing | Kapasitas memadai menurut ambang tervalidasi |
| Sesi backend expired | Pertahankan file sesuai retention, tampilkan recovery | Pembuatan sesi baru hanya tindakan eksplisit, bukan retry identik |

Polling generation memakai backoff/jitter yang dibatasi dan berhenti saat terminal/expired; heartbeat hardware terpisah. Tidak menampilkan persen progres palsu jika API tidak menyediakan progres.

## Rancangan UI tamu

UI kiosk berorientasi layar sentuh, satu aksi utama per layar, foto/live view dominan. Gunakan gaya visual aplikasi yang sudah ada; tidak mendesain ulang brand. Target resolusi/orientasi harus ditentukan dari monitor event; rencana awal diuji pada 1920×1080 dan skala Windows 100%, 125%, 150%. Target touch area awal minimal 48 CSS px, kontras terbaca, serta indikator fokus untuk operator keyboard.

| Layar/komponen | Isi dan aksi utama | Loading/error/recovery |
| --- | --- | --- |
| `WelcomeScreen` | Nama event, petunjuk posisi, tombol “Mulai” | Tombol nonaktif jika perangkat kritis belum siap; pesan “Hubungi operator” |
| `SelectionScreen` | Mode diizinkan dan kartu template/frame, “Lanjut” | Satu pilihan dapat langsung ditetapkan; katalog unavailable tidak membuka mode palsu |
| `CaptureScreen` | Live view besar, panduan posisi, shot counter, “Ambil foto” | Countdown, tombol terkunci saat shutter/transfer; camera disconnected menahan sesi |
| `ReviewScreen` | Foto tajam yang benar-benar tersimpan, slot sequence, “Pakai foto”, “Ulangi” | Budget retake dari aturan existing/event; tidak memakai frame preview sebagai capture |
| `ReadyScreen` | Ringkasan foto/selection, “Proses foto” | Validasi shot count dan koneksi; offline menjaga foto lokal |
| `ProcessingScreen` | Status upload/antrean/proses berdasarkan operasi nyata | Tampilkan retry atau operator saat error; tidak menjanjikan durasi yang belum diukur |
| `ResultScreen` | Preview hasil, tombol “Cetak”, copies sesuai event | Print disabled sampai file/profil valid; retry download tanpa generation ulang |
| `PrintStatusScreen` | Antrean/“Dikirim ke printer”, instruksi mengambil hasil | Outcome ambigu meminta operator; tombol cetak tidak submit ulang |
| `ThankYouScreen` | Instruksi pengambilan, “Selesai”, countdown reset | Reset memutus akses UI sesi sebelumnya; job background tetap tercatat |
| `RecoveryScreen` | Instruksi singkat pelanggan dan kode masalah | Detail teknis hanya panel operator |

Timeout layar harus berbeda: idle selection boleh reset setelah peringatan; capture/transfer/generation aktif tidak dibatalkan diam-diam oleh timer idle. Lama review dan retake mengikuti aturan produk yang sudah ada, lalu dikonfirmasi untuk event. Tidak menyediakan kembali ke layar yang dapat menggandakan generation/print tanpa guard state.

Wireframe capture dan hasil, untuk arah layout bukan final visual:

```text
CAPTURE
+----------------------------------------------------------+
| Nama event                         Foto 2 dari 3          |
|                                                          |
|                  LIVE VIEW KAMERA                        |
|                [panduan posisi wajah]                    |
|                                                          |
|       [slot 1] [slot 2] [slot 3]     [ AMBIL FOTO ]         |
+----------------------------------------------------------+

RESULT
+----------------------------------------------------------+
| Hasil foto                                               |
|                                                          |
|             PREVIEW HASIL / LAYOUT CETAK                  |
|                                                          |
|     Salinan sesuai pengaturan event       [ CETAK ]       |
+----------------------------------------------------------+
```

## Rancangan UI operator

Operator membuka panel lewat shortcut/akses khusus yang tidak terlihat sebagai pilihan tamu, lalu unlock. Ini proteksi operasional aplikasi, bukan pengganti Windows account/security. Tidak membangun sistem admin web baru.

| Panel | Fungsi yang diperlukan MVP |
| --- | --- |
| `SetupScreen` | Backend URL tervalidasi, event, pemilihan kamera/printer/profile, konfigurasi operator; secret tidak dipantulkan kembali |
| `PreflightScreen` | Camera connect/live view/test capture, API health/auth/katalog, storage, printer availability/test print |
| `OperatorDashboard` | Status hardware/backend, sesi aktif, antrean generation/print, pause/resume penerimaan tamu |
| `PrintQueueScreen` | ID job, thumbnail terbatas, copies, accepted/unknown/failed, reprint beralasan dan konfirmasi |
| `RecoveryPanel` | Pending upload/job, reconnect perangkat, lanjutkan/tutup sesi dengan tindakan eksplisit |
| `DiagnosticsScreen` | Versi aplikasi/adapter, error codes, ekspor log tanpa foto/secret |

Preflight diberi status hijau hanya untuk cek yang sudah dibuktikan; printer terdaftar bukan bukti test print sukses. Simpan waktu test print terakhir dan operator confirmation. Event dapat dimulai jika syarat mode yang dipilih terpenuhi; jika semua mode membutuhkan backend dan API offline, tidak membuka layanan generation seolah siap.

## Print profile dan pipeline gambar

Pipeline: result download -> verifikasi image/checksum -> apply print profile -> simpan print file immutable -> preview yang memakai layout sama -> submit ke driver -> catat status.

Profil berisi ukuran kertas dalam mm, printable area yang diukur, orientation, borderless capability, target DPI, layout single/strip, copies limit, dan fit policy (`contain` atau crop yang dipreview). Resolusi pixel diturunkan dari ukuran fisik dan DPI; DPI metadata saja tidak menentukan ukuran cetak jika driver memakai fit-to-page.

Jangan mengaplikasikan branding/template dua kali. Master tetap disimpan utuh; print preparation hanya membuat turunan. Color handling dimulai dari profil gambar/driver yang diuji; hindari double color management. Uji minimal foto wajah terang/gelap, crop tepi, teks kecil, dan penempatan strip. Durasi cetak dan drying/handling diukur pada printer serta media event untuk menentukan kapasitas antrean dan instruksi operator.

### Adapter printer lintas merek

Gunakan `WindowsPrintBridge` sebagai adapter OS generik, bukan `EpsonPrintBridge` atau SDK kamera untuk printer. UI/operator memilih installed printer lalu profil tervalidasi; tidak menampilkan merek sebagai batas fitur. `printerId` merujuk antrean Windows tertentu, sementara profil mengikat model/driver/media/settings yang sudah diuji. Adapter memeriksa kemampuan yang tersedia melalui driver; field yang tidak tersedia diberi status unknown dan diverifikasi operator.

Profil memiliki `manufacturer`, `model`, `driverName`/versi, `connection`, `printerId`, ukuran kertas, orientation, borderless, media type, quality, fit/crop, safe area, color handling, layout, copies limit, waktu uji dan status validasi. Simpan opsi driver yang spesifik pada profil; jangan mengasumsikan nama setting Epson identik dengan Canon. Antarmuka umum mencakup enumerate/status/validateProfile/submit/cancel/queryJob dengan result/error yang konsisten. Implementasi detail dipastikan pada PoC Windows.

Saat berganti dari Epson ke Canon: pause sesi baru -> selesaikan/rekonsiliasi job printer lama -> pilih printer dan profil baru -> test Advanced serta Classic -> ukur dimensi/crop/warna -> konfirmasi operator -> resume. Job existing mempertahankan snapshot profil; tidak diarahkan otomatis ke printer baru. Jika perlu reprint di printer baru, buat job eksplisit dengan profil baru dan alasan.

Tidak menyediakan auto-cut dalam baseline. Borderless hanya aktif bila driver/media/model mendukung dan hasil uji lulus. Printer tanpa borderless dapat memakai profil bermargin jika format hasil disetujui; tidak mengubah crop diam-diam. Fitur scanner tidak diperlukan untuk alur capture DSLR.

### Profil awal dan pengukuran kecepatan

| Profil planning | Kertas/layout | File awal pada 300 PPI | Validasi |
| --- | --- | --- | --- |
| `l8050-advanced-4r` | 4R portrait; satu foto | 1200 × 1800 px | Ukuran, orientasi, crop/contain, borderless dan warna |
| `l8050-classic-double-strip-4r` | 4R portrait; dua strip 2 × 6 inci | 1200 × 1800 px; masing-masing strip 600 × 1800 px | Garis tengah, safe area, potong manual dan hasil dua strip |
| `<model>-<layout>-4r` | Model lain, termasuk Canon | Turunan sesuai ukuran fisik dan profil | Test print baru; tidak mewarisi validasi L8050 |

300 PPI adalah baseline raster cetak, berbeda dari resolusi maksimum printhead. Render lokal tidak menggambar ulang frame/branding. Borderless driver dapat memperbesar gambar dan memangkas tepi; safe area dan kontrol expansion harus diuji, terutama pada dua strip.

Angka 25 detik L8050 menjadi acuan spesifikasi, bukan SLA aplikasi. Ukur waktu persiapan file, submit/spool, printer mengeluarkan lembar, handling/potong, serta total per sesi; simpan mode kualitas, jenis kertas dan jumlah salinan. Catat P50/P95 dari sesi berulang sebelum menentukan batas antrean dan target sesi/jam. Menghitung 3600/25 saja tidak membuktikan kapasitas event. Konfirmasi fisik operator menjadi sumber waktu selesai jika driver hanya melaporkan accepted. Profil Canon/model lain memakai hasil pengukuran sendiri.

## Packaging, konfigurasi, dan operasional Windows

- Installer mencakup desktop app dan adapter/runtime yang diizinkan lisensinya. Distribusi Canon SDK mengikuti ketentuan paket yang diperoleh; DLL proprietari tidak otomatis masuk repo publik.
- Installer tidak otomatis mengunduh SDK/driver dari sumber tak dikenal. Driver target diverifikasi di PC event; kebutuhan admin saat instalasi dicatat. Aplikasi sehari-hari diusahakan berjalan sebagai user biasa.
- Build/release Windows dikerjakan di runner atau mesin Windows yang disepakati; VPS Linux ini tidak menjadi bukti integrasi USB/driver Windows.
- Single-instance guard mencegah dua app berebut kamera. Shutdown menghentikan live view, flush jurnal, dan menutup proses adapter.
- Update dilakukan sebelum/sesudah event, tidak ketika capture/print berjalan. Migration lokal disertai backup metadata dan rencana rollback; jangan menurunkan binary melintasi schema yang tidak kompatibel.
- Operator memeriksa kabel, power kamera, sleep Windows, media/tinta, printer test, koneksi internet, ruang disk, serta versi release sebelum event. Aplikasi boleh meminta power policy yang disepakati, tetapi tidak mengubah system policy diam-diam.
- Retention berdasarkan persetujuan event, bukan angka arbitrer; foto tidak masuk bundle installer, git, log, atau support export.

## Backlog implementasi dan dependensi

| ID | Pekerjaan | Dependensi | Bukti selesai |
| --- | --- | --- | --- |
| K00 | Konfirmasi versi Windows/profil printer/media/mode/API | Input pengguna dan runtime read-only | Matriks target terisi, dokumen keputusan |
| K01 | Peroleh SDK dan uji EOS 2000D USB | K00, kamera fisik | Live view, shutter, full JPEG, reconnect, busy/timeout report |
| K02 | Driver dan PoC print Windows | K00, printer/media fisik | Cetakan ukuran benar dan hasil uji spooler/offline |
| K03 | Validasi rekomendasi Electron/.NET dan kontrak adapter/IPC | K01–K02 | Keputusan teknologi dan protokol tervalidasi |
| K04 | Shell kiosk, session state, local journal | K03 | Start/reset/restart recovery tests |
| K05 | Capture UI, review/retake/selection | K04 + adapter | Sesi multi-shot nyata tanpa foto tertukar |
| K06 | Idempotent session upload/recovery server | K00 + target API | Contract/integration tests request duplikat, concurrency, crash/replay |
| K07 | Backend-client, outbox, generation monitor | K04, K06 | Upload/job/result nyata dan recovery internet |
| K08 | Print preparation/queue/result UI | K02, K07 | Physical print test, duplicate/unknown guards |
| K09 | Operator preflight, diagnostics, retention | K05, K07–K08 | Error drills, akses operator, cleanup aman |
| K10 | Installer dan uji event lengkap | K09 | Release candidate dan acceptance report di Windows target |

K01 dan K02 dapat dikerjakan independen setelah perangkat tersedia; tabel ini tidak menginstruksikan delegasi agent. Tidak mengimplementasikan seluruh backlog pada satu sprint. Setelah setiap sprint, jalankan tes lingkup terkait, laporkan PASS/PARTIAL/FAIL, lalu berhenti untuk review.

## Matriks pengujian dan acceptance

| Area | Test penting | Tempat/bukti |
| --- | --- | --- |
| State/session | Retake, back, double click, timeout, session reset | Unit/integration dengan state transition nyata |
| Ownership | Capture/result sesi A tidak dibuka sesi B | Repository + API negative tests |
| Server contracts | Wrapper/field mapping, izin selection, error, cookie expiry, quotas | Integration di API target terisolasi |
| Idempotency | Key sama payload sama/beda, respons hilang, konkurensi dan crash | DB-backed integration; bukan mock success saja |
| Storage | File corrupt/missing, EXIF orientation, oversized upload, disk penuh | Local integration dengan temporary data |
| Hardware camera | EOS 2000D USB live view/capture/transfer, cable unplug, EOS Utility conflict | Windows + kamera asli, log dan file hasil |
| Hardware print | Profil ukuran fisik, scaling, copies, offline, reboot saat submit | Windows + printer asli + cetakan yang diperiksa |
| UI | Touch, focus, disabled action, 100/125/150% display scale | UI automation + monitor event |
| Security | IPC invalid schema/path, secret/log redaction, operator throttling | Negative tests terarah |
| End-to-end | Capture -> backend -> hasil nyata -> cetak -> tamu berikutnya | Windows event + backend/provider asli |
| Event soak | Sesi berulang, memory/disk/latency, antrean print, restart recovery | Report dengan durasi/jumlah sesi dan hardware version |

Mock adapter dipakai untuk pengembangan dan error UI tetapi diberi label test; mock tidak memenuhi hardware acceptance. Advanced end-to-end memakai provider nyata yang terhubung; penggunaan berbayar dan quota disepakati pada sprint implementasinya.

Target numerik soak test, latency generation, capture transfer, dan throughput printer ditentukan setelah PoC. Acceptance minimum: foto tidak tertukar, job/print tidak terduplikasi oleh aksi UI atau retry yang dapat diketahui, ambiguous print ditahan, sesi pulih setelah restart, serta mode unavailable tidak dilaporkan sukses.

## Risiko dan keputusan yang masih terbuka

| Risiko/keputusan | Dampak | Tindakan sebelum release |
| --- | --- | --- |
| Pergantian merek/model/driver printer | Setting dan hasil cetak dapat berbeda | Adapter Windows generik, snapshot profil, test print ulang sebelum resume |
| SDK/firmware dan power kamera | Capture dapat gagal atau kamera tidur | Compatibility + real event-duration test |
| Backend target/versi berbeda | Mapping auth/field tidak sesuai | Tetapkan API target tanpa migrasi implisit |
| Single-use claim untuk desktop dan QR | Claim pelanggan bisa terblokir | QR ditunda; design ownership terpisah bila diminta |
| Upload tidak idempotent saat ini | Sesi ganda setelah timeout | K06 atau recovery operator dengan status PARTIAL |
| Driver tidak membuktikan physical completion | Auto retry dapat menggandakan cetak | Accepted/unknown + operator control |
| Jaringan/provider lambat | Antrean tamu meningkat | Ukur latency, pesan jujur, aturan pause dan recovery |
| Semua operasi offline diminta | Perlu engine/katalog lokal tambahan | Scope/arsitektur terpisah untuk diputuskan pengguna |

## Status dokumen dan publikasi

Planning mencakup struktur lokal/server, kontrak API source dan gap, model data, state/recovery, UI tamu/operator, hardware, packaging, backlog, dan acceptance. Implementasi desktop, perubahan backend, deployment, serta uji fisik belum dilakukan. Publikasi dokumen ke repo tidak mengaktifkan fitur kiosk pada aplikasi live.
