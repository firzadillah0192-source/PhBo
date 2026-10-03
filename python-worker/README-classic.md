# Classic photo compositor

Script mandiri, tanpa AI. Menerima 1–4 foto dan frame dengan 1–4 lubang
transparan yang tertutup. Background transparan di luar frame diabaikan.
Ukuran output sama dengan frame asli. Foto di-resize dan center-crop agar
mengisi slot tanpa distorsi. Orientasi EXIF foto diperbaiki otomatis.

Jalankan dari direktori `backend`:

```powershell
python -m pip install -r python-worker/requirements-classic.txt
python python-worker/classic_compositor.py --frame "C:/Users/admin/Pictures/test/classic frame.png" --photos "foto1.jpg" "foto2.jpg" "foto3.jpg" "foto4.jpg" --output ".local/classic-result.png"
```

Urutan slot: atas ke bawah, lalu kiri ke kanan untuk posisi atas yang sama.
Jika hanya satu foto dipilih, foto itu diulang ke semua slot. Dua foto pada
frame empat slot menghasilkan A, B, A, B; tiga foto menghasilkan A, B, C, A.
Jumlah foto tidak boleh melebihi jumlah slot; tidak ada foto yang dibuang.

Jika lubang foto berwarna hitam **opaque**, tambahkan `--slot-source black`.
Mode ini mengganti area hitam tertutup, sehingga jangan digunakan pada frame
dengan dekorasi hitam besar. PNG transparan lebih disarankan. Deteksi otomatis
mengabaikan area yang lebih kecil dari 1% luas frame (minimal 64 pixel).
Lubang yang menyatu dengan background luar perlu diperbaiki di file frame.

Atur fokus crop dengan `--centering 0.5 0.3` (X/Y antara 0 dan 1).
Output selalu PNG dan mempertahankan transparansi luar frame.

Pemanggilan dari Python:

```python
from classic_compositor import compose_classic

compose_classic("frame.png", ["foto1.jpg", "foto2.jpg"], "hasil.png")
```

Script sudah dipakai oleh `basic_api.py` untuk mode CLASSIC. Upload session dengan
1–4 file pada field multipart `image`, lalu buat generation dengan `mode: CLASSIC`,
`frameId`, dan `photoIds` dari response session. Detail setup dan migration tersedia
di [Generation engines](../docs/GENERATION_ENGINES.md).

Referensi operasi resize/crop dan koreksi orientasi:
[Pillow ImageOps](https://pillow.readthedocs.io/en/stable/reference/ImageOps.html).
