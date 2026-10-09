# Rencana pemanfaatan PostHog selama 12 bulan — PhBo dan Gennexbyte

Tanggal penyusunan: 9 Oktober 2026. Status: **rencana siap dibaca; fitur lanjutan dan batas billing belum diaktifkan oleh dokumen ini**.

## 1. Tujuan dan dasar anggaran

Pengguna mengonfirmasi kredit PostHog for Startups **US$50.000**, available credits US$50.000, current bill US$0, dengan siklus tagihan 9 Oktober–9 November 2026. Billing overview juga menunjukkan discount US$50.000 dan tagihan saat ini US$0. Siklus bulanan bukan tanggal kedaluwarsa grant. Program berlaku 12 bulan; tanggal mulai/berakhir yang tepat harus dicatat dari grant atau email persetujuan, bukan diasumsikan dari siklus tersebut.

Tujuan penggunaan:

1. Mengetahui berapa sesi PhBo yang berhasil menghasilkan foto dan apa penyebab kegagalannya.
2. Menurunkan waktu tunggu, biaya percobaan ulang, dan hambatan pembayaran/download.
3. Mengetahui halaman dan sumber kunjungan Gennexbyte yang menghasilkan kontak berkualitas.
4. Menguji perubahan UI berdasarkan hasil pengguna nyata.
5. Membentuk laporan bisnis per event/booth dan pelanggan ketika fitur serta perangkatnya tersedia.

Tetap satu proyek PostHog, dibedakan dengan `app = phbo` atau `app = gennexbyte`. Nilai kredit bukan target belanja. Kuota gratis digunakan dahulu, lalu kredit membayar penggunaan yang memenuhi ketentuan. Tidak perlu menghasilkan traffic atau event buatan untuk menghabiskannya.

## 2. Apa yang bisa memakai kredit

Menurut [ketentuan startup resmi](https://posthog.com/startups), sejak 14 September 2026 kredit startup tidak membayar tagihan AI tools seperti **PostHog AI, Replay Vision, Inbox, PostHog Desktop, dan PostHog Slack app**. AI Observability dan Context Warehouse tetap tercakup. BAA pada Boost dan layanan onboarding berbayar juga dikecualikan. Periksa kontrak grant bila ada ketentuan khusus.

| Produk | Pemanfaatan untuk bisnis ini | Prioritas |
| --- | --- | --- |
| Product Analytics dan Web Analytics | Funnel generate, pembayaran, download; trafik dan konversi kontak | Sekarang |
| Error Tracking | Kelompok error frontend/API/worker; dampak terhadap job dan pengguna | Sekarang |
| Logs | Korelasi request, job, antrean, retry, dan kegagalan provider | Sekarang, metadata terpilih |
| AI Observability | Durasi panggilan AI, retry, error dan biaya aktual per job | Setelah telemetry worker lengkap |
| Session Replay | Melihat hambatan navigasi, pemilihan template dan checkout | Setelah masking lolos pemeriksaan |
| Heatmaps | Melihat interaksi halaman promosi dan tombol UI | Setelah instrumentasi sesuai privasi |
| Surveys | Penilaian hasil dan pertanyaan singkat tentang pengalaman | Setelah generate stabil |
| Feature Flags | Peluncuran perubahan bertahap dan rollback konfigurasi UI | Setelah baseline terbentuk |
| Experiments | A/B test perubahan yang punya hipotesis bisnis | Setelah trafik cukup |
| Cohorts dan retention | Pelanggan kembali, pembeli berulang, pengguna yang berhenti | Setelah identitas dan transaksi konsisten |
| Group Analytics | Aktivitas pelanggan bisnis, event atau booth sebagai satu kelompok | Opsional saat multi-event/B2B nyata |
| Warehouse dan CDP | Menghubungkan transaksi serta metadata operasional dengan event | Setelah kebutuhan join jelas |
| Workflows | Draf onboarding atau follow-up berdasarkan perilaku | Opsional; penerima dan pengiriman perlu disetujui terpisah |

Kredit PostHog membayar layanan PostHog yang eligible. **Biaya provider untuk menghasilkan foto, VPS, penyimpanan foto, kamera, printer, tinta/kertas dan iklan tetap anggaran terpisah.** AI Observability mengukur penggunaan AI; tidak menyediakan saldo untuk API generate PhBo.

Program juga mempunyai partner perks. Periksa email acceptance untuk manfaat yang tersedia, misalnya build container melalui Depot. Manfaat partner terpisah dari saldo PostHog, bukan penukaran saldo menjadi dana VPS.

## 3. Kondisi saat rencana dibuat

- SDK frontend/backend dan dashboard dua aplikasi sudah dipasang. Lihat [integrasi](posthog-integration.md), [deployment](posthog-deployment.md), dan [dashboard](posthog-dashboards.md).
- PhBo sudah memperlihatkan satu alur upload → accepted → completed setelah perbaikan mounted router. Lihat [hasil perbaikan](posthog-router-fix.md). Data sedikit ini belum merupakan baseline pelanggan atau bukti performa pada skala event.
- Accepted dan outcome dashboard memakai `job_id` untuk menghindari hitungan ganda browser/API.
- Outcome masih berdasarkan pengamatan browser/API. Jika browser ditutup dan status tidak dipolling, completion belum dijamin tercatat. Telemetry dari worker menjadi pekerjaan pertama.
- Gennexbyte sudah memiliki pageview, alur kontak, error dan log integrasi. Kualitas lead/penjualan belum dibuktikan oleh event submit saja.
- Session Replay, surveys, flags/experiments dan koneksi warehouse belum menjadi kemampuan operasional yang telah diverifikasi.
- Billing menampilkan trial Scale berakhir 23 Oktober 2026. Periksa pilihan setelah trial sebelum tanggal itu. Trial bukan kedaluwarsa kredit startup.
- Billing overview menampilkan batas bulanan terpisah untuk PostHog AI US$150, Replay Vision US$50, Inbox US$150 dan Desktop US$100. Ini **batas, bukan tagihan**; jangan menganggap produk tersebut dibiayai kredit startup. Dokumen ini tidak mengubah subscription atau batasnya.

## 4. Roadmap dan bukti penyelesaian

Bulan dihitung relatif terhadap tanggal grant yang dikonfirmasi. Tahap boleh dipercepat ketika prasyarat terpenuhi; tidak perlu menunggu kalender untuk mengerjakan hal yang sudah relevan.

| Tahap | Pekerjaan dan deliverable | Bukti selesai |
| --- | --- | --- |
| Minggu 1–2 | Catat expiry grant dan kondisi trial; audit event; kirim terminal status dari worker; definisikan metrik dan dashboard operasi | Satu job sukses dan satu gagal mempunyai jejak utuh walau browser ditutup; retry tidak menambah jumlah job; test tidak masuk KPI |
| Bulan 1–3 | Funnel web/kiosk; waktu antrean dan generate; error/log worker; funnel kontak Gennexbyte; transaksi backend bila tersedia | Dashboard dapat menjelaskan titik gagal, status job, durasi dan kontak yang benar-benar tersimpan; pembayaran sesuai ledger |
| Bulan 4–6 | Replay terbatas di layar aman; survei; AI Observability metadata/biaya; satu perubahan UI dengan flags; eksperimen jika sampel cukup | Masking diperiksa pada payload dan replay; biaya tidak ditebak dari token gambar; rollback diuji; hipotesis dan hasil dicatat |
| Bulan 7–9 | Atribusi kampanye dengan properti yang diizinkan; retention pelanggan; laporan per event/booth; Group Analytics bila diperlukan | Traffic promosi bisa ditautkan ke konversi; kunjungan berulang perangkat kiosk tidak dilaporkan sebagai pelanggan berulang |
| Bulan 10–12 | Warehouse terbatas jika dibutuhkan; kaji ROI; rencana biaya pascakredit; tinjau expiry H-90/H-30/H-7 | Estimasi biaya berbayar disepakati; event/queries penting terdokumentasi; sampling dan limit disesuaikan sebelum kredit berakhir |

Pemilik: developer mengerjakan instrumentasi dan verifikasi, pemilik bisnis menentukan KPI/hipotesis/anggaran, operator memvalidasi alur event fisik. Kamera dan printer diuji saat PC event tersedia; analytics tidak menggantikan pengujian perangkat.

## 5. Dashboard dan metrik yang dituju

### PhBo: operasi

- Job accepted, completed, failed dan masih berjalan, dihitung per ID unik.
- Completion rate untuk cohort job accepted; beri waktu sampai job terminal, jangan membagi angka completed hari ini dengan accepted hari ini bila cohort berbeda.
- p50/p95 waktu antrean dan waktu generate dari timestamp worker; terpisah dari waktu tunggu browser.
- Kegagalan menurut kode error, tahap dan versi aplikasi; retry per job.
- Biaya provider per completed job, termasuk percobaan gagal yang ditagih. Biaya tidak diketahui ditampilkan sebagai unknown, bukan nol.
- Kiosk: sesi selesai, retake per sesi, timeout, status perangkat; print submitted/failed hanya setelah integrasi tersedia. Spooler menerima job tidak membuktikan cetak fisik selesai.

### PhBo: bisnis

- Funnel masuk → upload/capture → pilih template → accepted → completed → download.
- Funnel top-up/checkout → **payment confirmed dari backend/webhook**; klik bayar bukan pendapatan.
- Pendapatan/refund dan biaya provider yang diverifikasi, kemudian estimasi margin setelah biaya lain tersedia. Ledger aplikasi tetap sumber transaksi utama.
- Template/preset yang digunakan, tingkat kegagalan dan rating hasil. Jangan membuat pilihan provider/model/prompt untuk pelanggan demi kebutuhan analytics.
- Pelanggan pembeli berulang dan aktivitas per event/booth. Pisahkan operator kiosk, perangkat, sesi tamu dan akun pelanggan.

### Gennexbyte

- Kunjungan halaman → mulai kontak → kontak tersimpan; conversion menggunakan event backend.
- Sumber kampanye yang menghasilkan kontak; UTM perlu penambahan properti allowlist, belum diasumsikan tersedia sekarang.
- Kualitas lead/konversi penjualan hanya setelah ada data tindak lanjut yang sah dan konsisten.

Setelah dua minggu penggunaan nyata, tetapkan target numerik berdasarkan baseline. Jangan membuat klaim peningkatan dari sesi developer atau satu job.

## 6. Kontrak telemetry dan privasi

Perluas kontrak yang ada, jangan mengganti nama event aktif tanpa migrasi. Properti lintas aplikasi: `app`, `environment`, `surface`, `app_version`, `is_test`, ID korelasi yang diperlukan. PhBo menambahkan `job_id` dan ID sesi booth ketika relevan. Gunakan nama `booth_event_id` untuk acara bisnis agar tidak rancu dengan event analytics.

Frontend mengukur interaksi. Backend/worker mengukur fakta tersimpan dan lifecycle pekerjaan. Hubungkan keduanya dengan ID; jangan menghitung dua sumber sebagai dua konversi. Event terminal worker perlu mekanisme pengiriman tahan retry dan strategi deduplikasi; nilai bisnis dihitung dengan ID job/transaksi unik. Gangguan PostHog tidak boleh menggagalkan generate, login, download atau cetak.

Rencana event tambahan, **belum diimplementasikan**:

| Fakta | Sumber kebenaran | Data minimum |
| --- | --- | --- |
| Mulai/selesai/gagal generate | Worker | Job ID, timestamp, durasi, error code, attempt, versi preset |
| Panggilan provider AI | Provider abstraction/worker | Trace/job ID, durasi, status dan biaya aktual jika tersedia |
| Pembayaran/refund | Handler transaksi backend | Transaction ID, nominal, currency, status; tanpa detail kartu |
| Sesi booth selesai | State machine kiosk | Session/event/booth ID, jumlah foto/retake dan durasi |
| Print submitted/failed | Adapter printer | Print job ID, kode status, durasi; tanpa binary foto |
| Hasil dinilai pengguna | UI setelah hasil | Rating dan job ID; hindari teks bebas sensitif |

Untuk image generation, periksa dukungan integrasi provider dahulu. Jika perlu manual capture, gunakan metadata dan custom cost yang sesuai tagihan nyata. Jangan memakai kalkulasi token LLM sebagai asumsi harga per foto. Bila AI Observability tidak cocok untuk suatu provider, custom analytics tetap dapat mencatat durasi/biaya tanpa memalsukan AI trace.

Aturan privasi:

- Jangan kirim foto/wajah, base64, camera frames, signed download URLs, prompt pelanggan, cookie/token atau isi kontak ke PostHog.
- Replay awal diusulkan sampling 10% pada halaman aman. Mask input dan blok elemen gambar/media. Layar capture, review foto dan hasil foto kiosk dikecualikan; jangan mengaktifkan canvas capture.
- Network request/response bodies dan headers tetap tidak direkam. URL media dan query sensitif juga harus disaring sebelum dikirim.
- Validasi masking melalui payload yang terkirim serta replay, bukan hanya konfigurasi terlihat benar.
- AI Observability memakai privacy mode; manual capture juga hanya mengirim allowlist metadata. Identitas tetap pseudonymous seperti kontrak aplikasi saat ini.
- Survei satu pertanyaan setelah hasil, dengan frekuensi terbatas; jangan mengganggu countdown atau memotret. Flag/survey memerlukan audit konfigurasi SDK karena permintaan flags sekarang dibatasi.
- Analytics di kiosk/desktop harus tahan offline; gunakan default/cached flag dan keputusan konsisten sepanjang satu sesi. PostHog bukan pengendali hardware, otorisasi atau antrean utama.
- `is_test` mengecualikan data dari KPI, tetapi **tidak** membatalkan biaya ingest. Gunakan collector lokal untuk mayoritas tes dan cloud hanya untuk verifikasi terbatas.
- Kontrol training OpenAI/Codex tetap pengaturan akun terpisah; dokumen ini tidak mengubah atau membuktikan statusnya.

Referensi: [privacy replay](https://posthog.com/docs/session-replay/privacy), [network recording](https://posthog.com/docs/session-replay/network-recording), [AI privacy mode](https://posthog.com/docs/ai-observability/privacy-mode), [manual AI capture](https://posthog.com/docs/ai-observability/installation/manual-capture), [cost calculation](https://posthog.com/docs/ai-observability/calculating-costs).

## 7. Anggaran awal: plafon, bukan perkiraan tagihan

Kuota resmi saat disusun: [Product Analytics](https://posthog.com/product-analytics/pricing) 1 juta event/bulan gratis; [web Session Replay](https://posthog.com/session-replay/pricing) 5.000 recording/bulan gratis; [AI Observability](https://posthog.com/ai-observability/pricing) 100.000 event/bulan gratis. Semua tetap mengikuti billing organisasi dan jenis penggunaan. Dua aplikasi dalam satu proyek tidak memberi dua kali kuota gratis.

Contoh skala: 2 juta analytics event/bulan menghasilkan sekitar US$50 biaya Product Analytics berdasarkan tier saat ini. 15.000 web recordings/bulan menghasilkan US$50 biaya web replay. Ini masing-masing produk, belum termasuk produk lain/add-on. Banyak penggunaan awal dapat tetap dalam kuota gratis.

| Periode | Plafon eligible gabungan yang diusulkan | Jumlah bulan | Maksimum tahap |
| --- | ---: | ---: | ---: |
| Bulan 1–3 | US$100/bulan | 3 | US$300 |
| Bulan 4–6 | US$250/bulan | 3 | US$750 |
| Bulan 7–12 | US$500/bulan | 6 | US$3.000 |
| Total rencana awal | | 12 | **US$4.050** |
| Cadangan dari kredit US$50.000 | | | **US$45.950** |

Cadangan dapat digunakan ketika ada banyak event, booth, pelanggan dan kebutuhan data nyata. Naikkan plafon setelah meninjau usage, nilai keputusan bisnis dan biaya pascakredit. US$50.000/12 ≈ US$4.166,67 per bulan adalah batas rata-rata aritmetis, bukan rekomendasi pengeluaran bulanan.

Contoh pembagian plafon US$500/bulan saat skala meningkat:

| Kategori eligible | Plafon usulan |
| --- | ---: |
| Analytics/web/group analytics jika diperlukan | US$100 |
| Session Replay | US$150 |
| Error Tracking dan Logs | US$100 |
| AI Observability | US$75 |
| Feature Flags dan Surveys | US$25 |
| Warehouse/CDP/Workflows jika diperlukan | US$50 |
| Total | **US$500** |

Pembagian di atas adalah anggaran perencanaan, bukan setting limit per produk yang sudah tersimpan. Buat limit sesuai unit/tagihan produk yang benar; jumlah plafon eligible tidak membatasi produk AI yang dikecualikan. Properti `app` membantu analisis, bukan otomatis memisahkan billing atau limit per aplikasi.

Review mingguan: usage per produk, saldo kredit, error ingestion, data hilang, dan produk yang benar-benar memberi keputusan berguna. Review bulanan: biaya per sesi/job/contact, manfaat perubahan produk dan proyeksi berbayar. Waspadai pengulangan polling, log debug dan replay kiosk panjang sebagai sumber volume yang tidak menambah manfaat.

## 8. Eksperimen dan pengembangan opsional

Mulai dengan satu hipotesis: misalnya pilihan template lebih mudah ditemukan, atau instruksi upload mengurangi validation failure. Tentukan unit assignment, primary metric, error guardrail, kebutuhan sampel dan jangka evaluasi sebelum mulai. Jangan menyimpulkan pemenang dari traffic rendah. Flags dapat tetap dipakai untuk rollout tanpa klaim statistik A/B.

Contoh rollout UI: operator uji → 5% → 25% → 100%, setelah metrik dan validasi tahap sebelumnya disetujui. Jangan menggunakan eksperimen untuk mengganti arsitektur, mengekspos provider ke pelanggan atau mengubah capture otomatis tanpa keputusan produk.

Warehouse hanya bila perlu menggabungkan data transaksi/operasi yang tidak cukup diwakili event. Buat projection/schema terpilih read-only, metadata tanpa foto dan tanpa tabel auth. PostgreSQL tetap internal; koneksi yang diperlukan harus dirancang melalui jalur aman dan scope akses disetujui, bukan membuka port publik.

Workflows dapat menjadi draf onboarding pelanggan atau follow-up transaksi. Tidak ada pengiriman email/Slack/WhatsApp atau aktivasi workflow berdasarkan dokumen ini. Channel berbayar pihak ketiga dan izin penerima dinilai terpisah.

## 9. Pekerjaan pertama yang direkomendasikan

**Sprint berikutnya: melengkapi telemetry worker dan dashboard operasi PhBo.** Ini menyelesaikan keterbatasan paling penting: status generate harus tercatat walau browser ditutup.

Lingkup: lifecycle job, korelasi/deduplikasi, durasi queue/generate, error metadata; tetap gunakan integrasi dan arsitektur aplikasi yang ada. Validasi: success, provider failure, retry, browser ditutup, PostHog unavailable, sanitasi payload, dan penyesuaian query tanpa double count. Laporan harus membedakan implementasi yang lolos uji lokal dari pengiriman yang benar-benar teramati di cloud.

Setelah sprint itu tervalidasi, pilih satu tahap berikutnya berdasarkan kebutuhan bisnis. Planning ini tidak mengotorisasi semua tahap untuk berjalan otomatis.

## 10. Review rencana

- Perhitungan anggaran tahunan dan pembagian produk diperiksa.
- Link lokal dan dokumen resmi diperiksa saat penyusunan.
- Tidak ada secret, binary foto atau data pelanggan ditambahkan.
- Tidak ada kode/runtime aplikasi, subscription, billing limit, replay, workflow atau akses database diubah.
- Implementasi tahap berikutnya tetap memerlukan scope tersendiri dan pengujian yang relevan.
