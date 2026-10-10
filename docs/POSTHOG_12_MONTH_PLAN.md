# Rencana pemanfaatan PostHog selama 12 bulan — PhBo dan Gennexbyte

Tanggal penyusunan: 9 Oktober 2026. Revisi: 10 Oktober 2026, atas permintaan pemanfaatan menyeluruh dengan target konsumsi minimal 50% kredit. Status: **rencana siap dibaca; fitur lanjutan dan batas billing belum diaktifkan oleh dokumen ini**.

## 1. Tujuan dan dasar anggaran

Pengguna mengonfirmasi kredit PostHog for Startups **US$50.000**, available credits US$50.000, current bill US$0, dengan siklus tagihan 9 Oktober–9 November 2026. Billing overview juga menunjukkan discount US$50.000 dan tagihan saat ini US$0. Siklus bulanan bukan tanggal kedaluwarsa grant. Program berlaku 12 bulan; tanggal mulai/berakhir yang tepat harus dicatat dari grant atau email persetujuan, bukan diasumsikan dari siklus tersebut.

Tujuan penggunaan:

1. Mengetahui berapa sesi PhBo yang berhasil menghasilkan foto dan apa penyebab kegagalannya.
2. Menurunkan waktu tunggu, biaya percobaan ulang, dan hambatan pembayaran/download.
3. Mengetahui halaman dan sumber kunjungan Gennexbyte yang menghasilkan kontak berkualitas.
4. Menguji perubahan UI berdasarkan hasil pengguna nyata.
5. Membentuk laporan bisnis per event/booth dan pelanggan ketika fitur serta perangkatnya tersedia.

Tetap satu proyek PostHog, dibedakan dengan `app = phbo` atau `app = gennexbyte`. **Target revisi: memakai sekurangnya US$25.000 (50%) selama masa grant, dengan rentang perencanaan US$25.000–30.000.** Target ini menggantikan plafon konservatif US$4.050 pada versi sebelumnya. Pencapaian berarti kredit benar-benar diterapkan pada tagihan eligible, bukan sekadar saldo dialokasikan atau billing limit dinaikkan. Kuota gratis tetap berlaku; kebutuhan volume dijelaskan pada bagian 7. Jangan membuat traffic, error, email atau sync berulang yang tidak diperlukan demi mengejar target.

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

### Cakupan pemanfaatan menyeluruh dan output konkret

Seluruh area di bawah masuk roadmap. Status awalnya **planned**; fitur yang membutuhkan data, perangkat atau entitlement harus memenuhi prasyarat sebelum aktif. Tidak semua area menambah biaya sendiri.

| Area kerja | Output yang direncanakan | Waktu/prasyarat |
| --- | --- | --- |
| Web analytics dan attribution | Goals kontak/generate, halaman masuk, kanal/UTM yang diizinkan, laporan biaya per konversi jika data iklan tersedia | M1–2; metadata campaign disanitasi |
| Web vitals | LCP/INP/CLS/FCP per route/device dan perbandingan sebelum/sesudah perubahan | M1–2; metadata performance tanpa URL foto |
| Product analytics | Funnel, user paths, segmentasi, correlation dan penggunaan template/mode | M1–3; kontrak event disetujui |
| Revenue/unit economics | Pembayaran, refund, biaya provider, estimasi margin per job/event | M2–4; join ledger dan currency benar |
| Cohorts/retention/lifecycle | Segmen baru, aktif, kembali, berhenti; cohort pembeli dan operator | M3–5; ID stabil dan definisi return event |
| Group analytics | Laporan pelanggan B2B, acara dan booth; cohort kelompok | M4–6; hubungan group dicatat pada event |
| Session replay | Daftar sesi bermasalah yang aman, review UX mingguan, catatan perbaikan | M1–3; masking dan sampling tervalidasi |
| Heatmaps/dead clicks | Peta tombol CTA/template/checkout dan elemen yang membingungkan | M2–3; allowlist elemen, layar foto dikecualikan |
| Error tracking/symbolication | Issue berprioritas bisnis, source maps, release/version, tren regressions | M1–2; payload aman dan delivery terbukti |
| Logs | Jejak request→queue→worker→provider; desktop/perangkat saat tersedia | M1–3; minimum metadata, retensi sesuai kebutuhan |
| Flags dan remote UI configuration | Rollout bertahap, rollback, targeting operator/customer yang tepat | M2–4; default offline, scope UI sesuai produk |
| Experiments | Hipotesis UI template, instruksi upload atau checkout; hasil terukur | M3–12; satu eksperimen aktif pada funnel yang sama, sampel cukup |
| Surveys | Rating hasil, kepuasan operator, alasan berhenti; dashboard feedback | M2–4; frekuensi terbatas, tidak mengganggu kiosk |
| AI observability | Trace biaya/durasi/retry per job dan versi preset | M2–4; provider adapter dan custom pricing terverifikasi |
| AI evaluations | Kajian rule-based terhadap metadata yang tersedia; rating pengguna untuk kualitas foto | M4–6; bukan pemeriksaan kemiripan wajah otomatis |
| Warehouse/sources | Read-only projection transaksi, job, provider runs dan kontak; incremental sync | M2–4; koneksi aman dan scope data diotorisasi |
| SQL views dan metric catalog | Model funnel/job/revenue/contact dengan definisi, owner dan query tersimpan | M3–5; katalog metrik yang bisa direview |
| Data quality | Cek ID wajib, deduplikasi, freshness, referential integrity dan terminal state | M3–6; fitur alpha bila entitlement tersedia, fallback SQL |
| CDP/transformations | Standardisasi properti, redaksi dan validasi ingestion; sumber/destination yang diperlukan | M3–5; sanitasi pada SDK tetap diperlukan |
| Batch exports | Ekspor terjadwal metadata/model penting untuk pelaporan atau portabilitas | M4–6; destination/scope/retensi diotorisasi |
| Workflows | Draf onboarding, follow-up hasil gagal atau lead; statistik delivery | M4–8; publish/send hanya setelah penerima dan channel diotorisasi |
| Dashboards/alerts/subscriptions | Dashboard owner/operasi/marketing/keuangan; alert error, queue dan biaya | M1–3; pengiriman ke orang lain bukan bagian otomatis planning |
| Platform governance | Kontrol member, approval flags, audit perubahan; laporan branded bila perlu | M1–3; Scale/Boost dipilih berdasarkan entitlement dan grant |
| MCP dan dokumentasi analisis | Query tersimpan, playbook diagnosis, review bulanan dan perubahan yang bisa diaudit | M1–12; akses minimum, bukan ekspor foto/prompt ke agent |

Dokumentasi pendukung: [Web vitals](https://posthog.com/docs/web-analytics/web-vitals), [Warehouse](https://posthog.com/docs/data-warehouse), [CDP](https://posthog.com/docs/cdp), [Workflows](https://posthog.com/workflows), [data quality alpha](https://posthog.com/docs/data-warehouse/data-quality/start-here), dan [AI evaluations](https://posthog.com/docs/ai-evals).

Evaluations rule-based bebas biaya LLM; jangan menganggarkan tiap evaluasi sebagai tagihan baru. LLM-as-a-judge memerlukan biaya API/inference tersendiri; eligibility harus diverifikasi dan tidak dimasukkan sebagai kredit pasti. Evaluasi LLM pada teks tidak membuktikan kualitas foto atau kemiripan wajah. Prompt management/playground dapat dievaluasi untuk kebutuhan LLM nyata; belum menjadi pengganti registry preset/provider PhBo. Tidak menambahkan chatbot/LLM ke Gennexbyte demi memakai fitur ini.

AI tools yang dikecualikan tetap dicatat sebagai opsi terpisah: PostHog AI untuk analisis, Replay Vision untuk klasifikasi replay, Inbox/scouts untuk temuan, Desktop/Slack agent untuk bantuan developer. Pilot dapat memakai free allowance yang tersedia bila dibutuhkan dan scope datanya jelas, tetapi **tidak menjadi strategi menghabiskan US$25.000 kredit startup**. Tidak ada langganan atau pilot AI tools diaktifkan oleh revisi ini.

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
| Minggu 1–2 | Catat expiry grant, pilih governance package sesuai grant dan kondisi trial; audit event; kirim terminal status dari worker; definisikan metrik dan dashboard operasi | Satu job sukses dan satu gagal mempunyai jejak utuh walau browser ditutup; retry tidak menambah jumlah job; test tidak masuk KPI |
| Bulan 1–3 | Web vitals/attribution; replay aman; funnel web/kiosk; waktu antrean/generate; error/log worker; funnel kontak; warehouse projection dan transaksi backend | Dashboard dapat menjelaskan titik gagal, status job, durasi dan kontak yang benar-benar tersimpan; pembayaran sesuai ledger |
| Bulan 4–6 | Survei; AI Observability; cohort/retention/group; SQL models/data quality; CDP/ekspor; flags dan eksperimen; draf workflow | Masking diperiksa pada payload dan replay; biaya tidak ditebak dari token gambar; rollback diuji; hipotesis dan hasil dicatat |
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

## 7. Target penggunaan minimal US$25.000

### Alokasi tahunan untuk seluruh area eligible

Alokasi adalah target penggunaan per kategori, bukan tagihan yang sudah terjadi. Banyak fitur berbagi meter billing: funnel, retention, paths dan web analytics bukan empat langganan terpisah; eksperimen ditagih bersama feature flags. Angka antar-kategori dapat dialihkan sesuai penggunaan nyata.

| Area | Target kredit setahun | Hasil bisnis yang harus diperoleh |
| --- | ---: | --- |
| Platform Scale | US$9.000 | Approval perubahan, audit akses, pengaturan anggota, alert dan tata kelola lintas tim |
| Replay dan analisis UX/heatmaps | US$4.500 | Bukti hambatan UI, perbandingan sebelum/sesudah perbaikan, sesi aman untuk diagnosis |
| Product/Web Analytics, identified/group analytics | US$3.500 | Funnel, retention, cohort, revenue dan laporan event/pelanggan bisnis |
| Warehouse dan model bisnis | US$3.000 | Join transaksi, refund, biaya provider dan penggunaan; metrik margin terverifikasi |
| Logs dan Error Tracking | US$2.000 | Diagnosis lintas API/worker/desktop; error berdampak bisnis serta log yang dapat dikorelasikan |
| AI Observability dan evaluasi yang sesuai | US$750 | Biaya/durasi per panggilan, retry, regresi preset; metadata tanpa gambar |
| Feature Flags dan Experiments | US$500 | Rollout terukur, rollback teruji, eksperimen dengan sampel cukup |
| Surveys | US$500 | Rating, alasan gagal menyelesaikan alur, kepuasan operator |
| CDP, destinations dan batch exports | US$750 | Data konsisten, ekspor terjadwal ke tujuan yang diperlukan, kegagalan pengiriman terlihat |
| Workflows | US$500 | Onboarding/follow-up yang relevan setelah channel dan penerima diotorisasi |
| **Target minimum** | **US$25.000** | **50% kredit** |
| Buffer pertumbuhan tambahan | US$5.000 | Volume produksi yang melampaui pembagian di atas |
| Sisa kredit di luar rentang rencana | US$20.000 | Cadangan lonjakan dan kebutuhan nyata berikutnya |

Harga publik [Scale US$750/bulan](https://posthog.com/platform-packages) memberi US$9.000 untuk 12 bulan berbayar penuh. Trial, tanggal aktivasi, prorata dan kondisi grant dapat mengurangi angka aktual. Kredit untuk komponen paket harus dikonfirmasi pada billing sebelum langganan dibuat; BAA dikecualikan. Ketentuan startup juga menyatakan pelanggan startup tidak mendapat priority support/account manager, meskipun membeli platform package; jangan menjadikan SLA dukungan manfaat yang dijanjikan.

Scale diusulkan untuk approval, audit, governance dan alert yang digunakan dalam roadmap ini. Jika tim tidak memakai kemampuan tersebut, Boost US$250/bulan lebih cocok; selisih US$6.000 perlu digantikan penggunaan eligible lain. Boost dan Scale adalah alternatif, bukan dua paket yang dijumlahkan. PostHog Enterprise mempunyai harga custom; penawaran dan eligibility harus diverifikasi sebelum dimasukkan sebagai biaya pasti.

### Jadwal pencapaian

| Tahap | Target konsumsi tahap | Kumulatif | Deliverable utama |
| --- | ---: | ---: | --- |
| Bulan 1–3 | US$3.000 | US$3.000 | Governance, telemetry menyeluruh, dashboard, warehouse projection dan replay aman |
| Bulan 4–6 | US$6.000 | US$9.000 | AI cost, cohort, eksperimen, survei, integrasi sumber bisnis dan pipeline |
| Bulan 7–9 | US$7.000 | US$16.000 | Laporan event/booth, attribution, retention, workflow dan ekspor terjadwal |
| Bulan 10–12 | US$9.000 | **US$25.000** | Perluasan penggunaan nyata, pembuktian ROI dan rencana pascakredit |

Dengan Scale penuh, tiap kuartal memuat US$2.250 biaya platform; penggunaan variabel yang diperlukan masing-masing US$750, US$3.750, US$4.750 dan US$6.750. Ini sasaran pertumbuhan, belum forecast dari traffic saat ini. Bulan relatif terhadap expiry grant terverifikasi, bukan otomatis 12 bulan baru sejak revisi.

### Volume yang benar-benar mencapai 50%

Billing yang diperiksa 10 Oktober menunjukkan 83 analytics events, 2 exceptions, 0 replay, 0 synced rows, 0 AI Observability events, dan tagihan US$0 pada periode yang berjalan. Angka awal ini belum mendukung forecast US$25.000. Menggunakan semua fitur tidak otomatis menghabiskan kredit karena kuota gratis bulanan cukup besar.

Berikut **skenario skala ilustratif**, dihitung dari tier saat pemeriksaan. Volume diasumsikan stabil pada seluruh 12 bulan untuk menunjukkan besaran kebutuhan, bukan klaim bahwa traffic tersebut sudah ada. Skenario terpisah dari alokasi kategori di atas; jika dipilih, alokasi perlu diseimbangkan ulang dalam rentang US$25.000–30.000.

| Penggunaan setiap bulan | Estimasi eligible/bulan | Estimasi 12 bulan |
| --- | ---: | ---: |
| Scale berbayar penuh | US$750 | US$9.000 |
| 200.000 web recordings yang aman | US$457,50 | US$5.490 |
| 10 juta base analytics events | US$324,40 | US$3.892,80 |
| 50 juta warehouse rows synced | US$485 | US$5.820 |
| 1.000 GB log produksi yang diperlukan | US$177,50 | US$2.130 |
| **Total contoh** | **US$2.194,40** | **US$26.332,80 (52,67%)** |

Rumus setelah kuota gratis dan diskon tier:

- Replay: 10.000 × 0,005 + 35.000 × 0,0035 + 100.000 × 0,002 + 50.000 × 0,0017 = US$457,50/bulan.
- Base analytics: 1 juta × 0,00005 + 8 juta × 0,0000343 = US$324,40/bulan.
- Warehouse: 9 juta × 0,000015 + 15 juta × 0,00001 + 25 juta × 0,000008 = US$485/bulan.
- Log ingest: 290 GB × US$0,25 + 700 GB × US$0,15 = US$177,50/bulan.

Sumber: [Analytics pricing](https://posthog.com/product-analytics/pricing), [Replay pricing](https://posthog.com/session-replay/pricing), [Logs pricing](https://posthog.com/logs/pricing), dan tier warehouse pada billing overview organisasi yang dibaca melalui MCP. Angka base analytics belum memuat identified/group add-on; log belum memuat custom retention; skenario tidak memuat flag, survey, workflow, AI Observability atau pajak. Tidak ada double count dengan alokasi sebagai dua anggaran tambahan. Harga/eligibility harus diperiksa ulang sebelum aktivasi.

### Kegiatan bisnis untuk mendukung volume

- Perluas traffic nyata web melalui distribusi, promosi dan kemitraan yang dikelola bisnis; biaya iklan tidak dibayar kredit PostHog.
- Integrasikan telemetry PhBo web, kiosk dan desktop serta Gennexbyte frontend/backend. Tambahkan aplikasi lain milik organisasi hanya dengan instruksi terpisah; jangan menyentuh proyek VPS lain otomatis.
- Hubungkan sumber yang benar-benar ada: metadata generation, payments/refunds, provider runs, kontak/lead, dan event/booth. Gunakan incremental sync; historical sync gratis bukan konsumsi kredit dan full resync buatan tidak menjadi strategi target.
- Utamakan replay aman pada web dengan traffic tinggi. 200.000 recordings/bulan membutuhkan sedikitnya 200.000 sesi yang direkam; dengan sampling 10% perlu sekitar 2 juta sesi eligible/bulan. Sesi event kecil tidak cukup. Jangan membagi satu sesi menjadi banyak rekaman untuk menambah bill.
- 10 juta analytics events dapat berarti sekitar 333.333 sesi/bulan pada asumsi 30 event per sesi. Definisikan event karena diperlukan analisis, bukan untuk menggelembungkan jumlah.
- Log 1 TB/bulan kira-kira 33 GB/hari: volume ini besar untuk dua aplikasi kecil. Hanya masuk akal bila operasi nyata menghasilkan data berguna tersebut. Jangan menambah debug/payload foto demi volume.
- 50 juta synced rows/bulan memerlukan sumber bisnis aktif pada skala sebanding; baris kosong/duplikat dan sync berulang tidak dihitung sebagai manfaat.

**Jika volume tersebut tidak tercapai, konsumsi 50% tidak dapat dijamin oleh pay-as-you-go.** Jalur alternatif adalah meminta penawaran Enterprise/annual commitment yang memenuhi kebutuhan governance dan diperbolehkan oleh grant. Belum ada harga, persetujuan kredit atau penawaran; jangan mencatat kontrak hipotetis sebagai penggunaan pasti. Tidak ada kontak ke PostHog dilakukan melalui revisi ini.

### Kendali pencapaian dan expiry

- Review bulanan: konsumsi eligible sebelum kredit, kredit yang benar-benar diterapkan, saldo, forecast periode berikutnya, volume per produk dan deliverable bisnis. Jangan memakai current bill setelah diskon sebagai ukuran konsumsi kredit.
- Hitung gap = US$25.000 dikurangi kredit eligible yang sudah digunakan. Target rata-rata sisa per bulan = gap dibagi bulan tersisa. Bill/credit yang belum finalized diberi label provisional.
- H-180: bandingkan konsumsi dan forecast dengan target. Bila tertinggal, percepat integrasi data/fitur yang dibutuhkan, perluas penggunaan bisnis, atau kaji paket yang mempunyai manfaat nyata.
- H-90: bila forecast masih di bawah 50%, laporkan gap dan opsi terverifikasi. Kontrak/custom package hanya diperhitungkan setelah eligibility, biaya, expiry dan manfaat jelas.
- H-30/H-7: setujui biaya pascakredit, kurangi fitur yang tidak memberi manfaat, dan simpan definisi/query serta ekspor yang dibutuhkan sebelum data retention berakhir.
- Per-product billing limit adalah batas maksimum, bukan tagihan minimum. Properti `app` tidak membagi kuota atau limit per aplikasi. Jangan berhenti merekam data penting tanpa menilai dampak limit terhadap ingestion.
- US$25.000–30.000 adalah target kredit eligible; AI tools yang dikecualikan, provider API, iklan, perangkat dan layanan pihak ketiga menggunakan anggaran terpisah.

## 8. Eksperimen dan integrasi lanjutan

Mulai dengan satu hipotesis: misalnya pilihan template lebih mudah ditemukan, atau instruksi upload mengurangi validation failure. Tentukan unit assignment, primary metric, error guardrail, kebutuhan sampel dan jangka evaluasi sebelum mulai. Jangan menyimpulkan pemenang dari traffic rendah. Flags dapat tetap dipakai untuk rollout tanpa klaim statistik A/B.

Contoh rollout UI: operator uji → 5% → 25% → 100%, setelah metrik dan validasi tahap sebelumnya disetujui. Jangan menggunakan eksperimen untuk mengganti arsitektur, mengekspos provider ke pelanggan atau mengubah capture otomatis tanpa keputusan produk.

Warehouse hanya bila perlu menggabungkan data transaksi/operasi yang tidak cukup diwakili event. Buat projection/schema terpilih read-only, metadata tanpa foto dan tanpa tabel auth. PostgreSQL tetap internal; koneksi yang diperlukan harus dirancang melalui jalur aman dan scope akses disetujui, bukan membuka port publik.

Workflows dapat menjadi draf onboarding pelanggan atau follow-up transaksi. Tidak ada pengiriman email/Slack/WhatsApp atau aktivasi workflow berdasarkan dokumen ini. Channel berbayar pihak ketiga dan izin penerima dinilai terpisah.

## 9. Pekerjaan pertama yang direkomendasikan

**Sprint berikutnya: melengkapi telemetry worker dan dashboard operasi PhBo.** Ini menyelesaikan keterbatasan paling penting: status generate harus tercatat walau browser ditutup.

Lingkup: lifecycle job, korelasi/deduplikasi, durasi queue/generate, error metadata; tetap gunakan integrasi dan arsitektur aplikasi yang ada. Validasi: success, provider failure, retry, browser ditutup, PostHog unavailable, sanitasi payload, dan penyesuaian query tanpa double count. Laporan harus membedakan implementasi yang lolos uji lokal dari pengiriman yang benar-benar teramati di cloud.

Setelah sprint itu tervalidasi, pilih satu tahap berikutnya berdasarkan kebutuhan bisnis. Planning ini tidak mengotorisasi semua tahap untuk berjalan otomatis.

## 10. Review rencana

- Perhitungan target US$25.000, tahapan kuartal dan skenario volume US$26.332,80 diperiksa.
- Target 50% bersyarat pada penggunaan/kontrak eligible nyata; tidak dilaporkan sebagai forecast yang sudah terbukti.
- Link lokal dan dokumen resmi diperiksa saat penyusunan.
- Tidak ada secret, binary foto atau data pelanggan ditambahkan.
- Tidak ada kode/runtime aplikasi, subscription, billing limit, replay, workflow atau akses database diubah.
- Implementasi tahap berikutnya tetap memerlukan scope tersendiri dan pengujian yang relevan.
