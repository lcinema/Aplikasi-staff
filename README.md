# Catatan Staff

Web app pribadi (mobile-first, bisa dipasang di layar utama iPhone) untuk **mencatat dan merekap**:
pelanggaran, izin sakit, izin keluar jam kerja, cuti, dan catatan lainnya milik staff.

- Tanpa login, tanpa server, tanpa persetujuan — hanya catat & rekap.
- Semua data tersimpan **di browser/HP Anda** (localStorage). Tidak ada yang dikirim ke mana pun.
- Rekap per bulan / per tahun, per staff; unduh CSV (bisa dibuka di Excel/Sheets).
- Cadangan & pemulihan data lewat file JSON (menu Pengaturan).

Kode ada di folder `docs/` (HTML/CSS/JS statis, tanpa build).

## Coba di komputer
```bash
cd docs && python3 -m http.server 8000   # buka http://localhost:8000
```

## Pasang agar bisa dibuka di iPhone
Hosting statis gratis, salah satunya **GitHub Pages**: Settings → Pages → Branch `main` (atau branch ini), folder `/docs`.
Lalu buka alamatnya di **Safari** → Bagikan → **Tambah ke Layar Utama**.

## Penting: data & cadangan
Data hanya ada di perangkat yang dipakai. Browser bisa menghapusnya (bersihkan data situs; Safari menghapus data situs yang tidak dibuka lama bila tidak dipasang di Layar Utama). **Unduh cadangan JSON secara rutin.**
Untuk pindah HP / berbagi ke perangkat lain: unduh cadangan, lalu *Pulihkan dari cadangan* di perangkat tujuan.

## Aturan hitung
- Rekap dihitung berdasarkan **tanggal mulai** catatan (cuti lintas bulan masuk ke bulan awalnya).
- Hari cuti default = selisih tanggal (kalender); bisa diubah manual bila ada hari libur/non-kerja.
- Poin pelanggaran otomatis: ringan 1, sedang 3, berat 5 (bisa diubah per catatan).
- Sisa cuti = kuota tahunan staff − cuti berjenis *Tahunan* pada tahun itu.
