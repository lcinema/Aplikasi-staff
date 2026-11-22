# Aplikasi Staff

Aplikasi web (mobile-first, bisa dipasang di layar utama iPhone sebagai PWA) untuk mencatat **pelanggaran**, **izin sakit**, **izin keluar jam kerja**, **cuti**, dan **catatan lain** terkait staff.
Tanpa dependensi npm — hanya Node.js ≥ 22.13 (SQLite bawaan `node:sqlite`).

## Menjalankan

```bash
npm start            # http://localhost:3000
```

Saat pertama kali jalan, akun `admin` dibuat dengan **password acak yang dicetak di console** (atau set `ADMIN_PASSWORD`). Segera ganti di menu *Akun*.

Variabel lingkungan: `PORT` (3000), `HOST` (0.0.0.0), `DB_FILE` (`data/staff.db`), `ADMIN_PASSWORD`, `COOKIE_SECURE=1` (set bila di belakang HTTPS).
Data tersimpan di `data/staff.db` — **backup file ini secara berkala**.

## Peran

| Peran | Hak akses |
|---|---|
| **Staff** | Mengajukan izin sakit / izin keluar / cuti / lainnya untuk diri sendiri; melihat catatan & sisa cuti sendiri (termasuk pelanggaran yang dicatat atas dirinya); membatalkan/mengubah pengajuan yang masih menunggu |
| **Manager** | Semua di atas + mencatat pelanggaran, mencatat atas nama staff, menyetujui/menolak pengajuan orang lain, melihat rekap semua staff, ekspor CSV |
| **Admin** | Semua di atas + kelola akun staff (kuota cuti, role, nonaktifkan), ubah/hapus catatan |

## Aturan bisnis

- **Pelanggaran**: tingkat ringan/sedang/berat (poin otomatis 1/3/5, bisa diubah), sanksi (teguran lisan, SP1–SP3). Langsung berstatus *Tercatat*.
- **Izin sakit**: rentang tanggal + penanda ada/tidak surat dokter. **Izin keluar**: jam keluar & perkiraan kembali.
- **Cuti**: jenis tahunan/besar/melahirkan/menikah/duka/tanpa gaji/lainnya. Hanya cuti **tahunan** memotong kuota (default 12 hari/tahun, per staff). Jumlah hari dihitung dari rentang tanggal dan dapat diisi manual bila ada hari libur — **sistem tidak mengenal kalender libur/jadwal shift**.
- Pengajuan → *Menunggu* → disetujui/ditolak (penolakan wajib beralasan). Tidak bisa menyetujui pengajuan sendiri.
- Kuota dicek saat pengajuan dan saat persetujuan (pengajuan yang masih menunggu ikut dihitung).

## Keamanan

Password di-hash scrypt, sesi cookie HttpOnly + SameSite=Strict, pembatasan percobaan login, CSP ketat, ekspor CSV dengan proteksi formula injection. Jalankan di belakang HTTPS (reverse proxy) bila diakses lewat internet.

## Tes

```bash
npm test
```

## Dipakai di iPhone

Server harus bisa dijangkau dari HP (jaringan yang sama, VPS, atau tunnel HTTPS). Buka alamatnya di **Safari** → tombol Bagikan → **Tambah ke Layar Utama**. Aplikasi akan terbuka layar penuh seperti app biasa.
