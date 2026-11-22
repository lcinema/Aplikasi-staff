// Aplikasi Staff — server tanpa dependensi eksternal (Node >= 22.13, node:sqlite)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');

export const TYPES = ['pelanggaran', 'sakit', 'izin_keluar', 'cuti', 'lainnya'];
const SELF_SERVICE_TYPES = ['sakit', 'izin_keluar', 'cuti', 'lainnya'];
const ROLES = ['admin', 'manager', 'staff'];
const SANCTIONS = ['', 'teguran_lisan', 'sp1', 'sp2', 'sp3', 'lainnya'];
const SEVERITY_POINTS = { ringan: 1, sedang: 3, berat: 5 };
const SESSION_TTL_MS = 12 * 3600 * 1000;

// ---------- Database ----------
export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      nik TEXT NOT NULL DEFAULT '',
      position TEXT NOT NULL DEFAULT '',
      department TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL CHECK (role IN ('admin','manager','staff')),
      annual_quota INTEGER NOT NULL DEFAULT 12,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL CHECK (type IN ('pelanggaran','sakit','izin_keluar','cuti','lainnya')),
      user_id INTEGER NOT NULL REFERENCES users(id),
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      time_out TEXT NOT NULL DEFAULT '',
      time_in TEXT NOT NULL DEFAULT '',
      days INTEGER NOT NULL DEFAULT 0,
      category TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      sanction TEXT NOT NULL DEFAULT '',
      points INTEGER NOT NULL DEFAULT 0,
      has_doctor_note INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL CHECK (status IN ('pending','approved','rejected','cancelled','recorded')),
      created_by INTEGER NOT NULL REFERENCES users(id),
      decided_by INTEGER REFERENCES users(id),
      decided_at TEXT,
      decision_note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_records_user ON records(user_id, start_date);
    CREATE INDEX IF NOT EXISTS idx_records_status ON records(status);
  `);
  return db;
}

// ---------- Utilitas ----------
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (m) => new HttpError(400, m);

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}
function verifyPassword(pw, stored) {
  const [saltHex, hashHex] = stored.split(':');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), 64);
  return crypto.timingSafeEqual(actual, expected);
}
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const isTime = (s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const str = (v, max = 2000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const today = () => new Date().toISOString().slice(0, 10);

function daysInclusive(a, b) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000) + 1;
}

const PUBLIC_USER = 'id, username, name, nik, position, department, role, annual_quota, active, created_at';

// ---------- Aplikasi ----------
export function createApp(db) {
  const q = (sql) => db.prepare(sql);

  function leaveUsed(userId, year, includePending, excludeId = 0) {
    const statuses = includePending ? "('approved','pending')" : "('approved')";
    const row = q(
      `SELECT COALESCE(SUM(days),0) AS used FROM records
       WHERE user_id = ? AND type = 'cuti' AND category = 'tahunan'
         AND status IN ${statuses} AND substr(start_date,1,4) = ? AND id != ?`
    ).get(userId, String(year), excludeId);
    return row.used;
  }
  function balance(userId, year) {
    const u = q('SELECT annual_quota FROM users WHERE id = ?').get(userId);
    if (!u) throw new HttpError(404, 'Staff tidak ditemukan');
    const used = leaveUsed(userId, year, false);
    const pending = leaveUsed(userId, year, true) - used;
    return { year, quota: u.annual_quota, used, pending, remaining: u.annual_quota - used - pending };
  }

  const canManage = (u) => u.role === 'admin' || u.role === 'manager';

  function getRecordFor(user, id) {
    const rec = q(`SELECT r.*, u.name AS user_name FROM records r JOIN users u ON u.id = r.user_id WHERE r.id = ?`).get(id);
    if (!rec) throw new HttpError(404, 'Catatan tidak ditemukan');
    if (!canManage(user) && rec.user_id !== user.id) throw new HttpError(403, 'Tidak diizinkan');
    return rec;
  }

  function validateRecord(user, b, existingId = 0) {
    const type = b.type;
    if (!TYPES.includes(type)) throw bad('Jenis catatan tidak valid');
    if (type === 'pelanggaran' && !canManage(user)) throw new HttpError(403, 'Hanya manager/admin yang dapat mencatat pelanggaran');
    if (!canManage(user) && !SELF_SERVICE_TYPES.includes(type)) throw new HttpError(403, 'Tidak diizinkan');

    let targetId = user.id;
    if (canManage(user) && b.user_id) targetId = Number(b.user_id);
    const target = q('SELECT id, active FROM users WHERE id = ?').get(targetId);
    if (!target) throw bad('Staff tidak ditemukan');
    if (!target.active && !existingId) throw bad('Staff sudah tidak aktif');

    const rec = {
      type, user_id: targetId,
      start_date: str(b.start_date, 10), end_date: str(b.end_date || b.start_date, 10),
      time_out: '', time_in: '', days: 0,
      category: str(b.category, 40), description: str(b.description),
      sanction: '', points: 0, has_doctor_note: 0,
    };
    if (!isDate(rec.start_date) || !isDate(rec.end_date)) throw bad('Tanggal tidak valid');
    if (rec.end_date < rec.start_date) throw bad('Tanggal selesai tidak boleh sebelum tanggal mulai');
    if (!rec.description) throw bad('Keterangan/alasan wajib diisi');

    if (type === 'pelanggaran') {
      if (!SEVERITY_POINTS[rec.category]) throw bad('Tingkat pelanggaran harus ringan, sedang, atau berat');
      rec.end_date = rec.start_date;
      rec.sanction = str(b.sanction, 20);
      if (!SANCTIONS.includes(rec.sanction)) throw bad('Sanksi tidak valid');
      const pts = b.points === undefined || b.points === '' ? SEVERITY_POINTS[rec.category] : Number(b.points);
      if (!Number.isInteger(pts) || pts < 0 || pts > 100) throw bad('Poin tidak valid');
      rec.points = pts;
    } else if (type === 'sakit') {
      rec.category = '';
      rec.days = daysInclusive(rec.start_date, rec.end_date);
      rec.has_doctor_note = b.has_doctor_note ? 1 : 0;
    } else if (type === 'izin_keluar') {
      rec.end_date = rec.start_date;
      rec.time_out = str(b.time_out, 5); rec.time_in = str(b.time_in, 5);
      if (!isTime(rec.time_out)) throw bad('Jam keluar tidak valid');
      if (rec.time_in && !isTime(rec.time_in)) throw bad('Jam kembali tidak valid');
      if (rec.time_in && rec.time_in <= rec.time_out) throw bad('Jam kembali harus setelah jam keluar');
    } else if (type === 'cuti') {
      if (!['tahunan', 'besar', 'melahirkan', 'menikah', 'duka', 'tanpa_gaji', 'lainnya'].includes(rec.category)) throw bad('Jenis cuti tidak valid');
      const span = daysInclusive(rec.start_date, rec.end_date);
      const days = b.days === undefined || b.days === '' ? span : Number(b.days);
      if (!Number.isInteger(days) || days < 1 || days > span) throw bad('Jumlah hari cuti tidak valid (1 s/d jumlah hari pada rentang tanggal)');
      rec.days = days;
    } else {
      if (!rec.category) throw bad('Jenis (kategori) wajib diisi untuk catatan lainnya');
      rec.days = daysInclusive(rec.start_date, rec.end_date);
    }
    return rec;
  }

  function checkQuota(rec, excludeId = 0) {
    if (rec.type !== 'cuti' || rec.category !== 'tahunan') return;
    const year = rec.start_date.slice(0, 4);
    const u = q('SELECT annual_quota FROM users WHERE id = ?').get(rec.user_id);
    const committed = leaveUsed(rec.user_id, year, true, excludeId);
    if (committed + rec.days > u.annual_quota) {
      throw bad(`Jatah cuti tahunan tidak cukup (kuota ${u.annual_quota}, terpakai/menunggu ${committed}, diajukan ${rec.days})`);
    }
  }

  // ----- Handlers -----
  const routes = [];
  const route = (method, pattern, handler, opts = {}) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$');
    routes.push({ method, re, keys, handler, public: !!opts.public });
  };

  const loginAttempts = new Map(); // ip+username -> {n, until}
  route('POST', '/api/login', ({ body, ip }) => {
    const username = str(body.username, 60).toLowerCase();
    const key = `${ip}|${username}`;
    const att = loginAttempts.get(key);
    if (att && att.n >= 5 && att.until > Date.now()) throw new HttpError(429, 'Terlalu banyak percobaan. Coba lagi beberapa menit lagi.');
    const u = q('SELECT * FROM users WHERE username = ?').get(username);
    if (!u || !u.active || !verifyPassword(String(body.password ?? ''), u.password_hash)) {
      loginAttempts.set(key, { n: (att && att.until > Date.now() ? att.n : 0) + 1, until: Date.now() + 10 * 60 * 1000 });
      throw new HttpError(401, 'Username atau password salah');
    }
    loginAttempts.delete(key);
    const token = crypto.randomBytes(32).toString('hex');
    q('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
    q('INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)').run(token, u.id, Date.now() + SESSION_TTL_MS);
    return { cookie: token, data: { user: q(`SELECT ${PUBLIC_USER} FROM users WHERE id = ?`).get(u.id) } };
  }, { public: true });

  route('POST', '/api/logout', ({ token }) => {
    q('DELETE FROM sessions WHERE token = ?').run(token);
    return { clearCookie: true, data: { ok: true } };
  });

  route('GET', '/api/me', ({ user }) => ({
    data: { user, balance: balance(user.id, new Date().getFullYear()), severity_points: SEVERITY_POINTS },
  }));

  route('POST', '/api/me/password', ({ user, body }) => {
    const cur = q('SELECT password_hash FROM users WHERE id = ?').get(user.id);
    if (!verifyPassword(String(body.current ?? ''), cur.password_hash)) throw bad('Password lama salah');
    const pw = String(body.password ?? '');
    if (pw.length < 8) throw bad('Password baru minimal 8 karakter');
    q('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(pw), user.id);
    return { data: { ok: true } };
  });

  // --- Staff ---
  route('GET', '/api/users', ({ user, query }) => {
    if (canManage(user)) {
      const all = query.get('all') === '1' && user.role === 'admin';
      return { data: q(`SELECT ${PUBLIC_USER} FROM users ${all ? '' : 'WHERE active = 1'} ORDER BY name`).all() };
    }
    return { data: q(`SELECT ${PUBLIC_USER} FROM users WHERE id = ?`).all(user.id) };
  });

  route('POST', '/api/users', ({ user, body }) => {
    if (user.role !== 'admin') throw new HttpError(403, 'Hanya admin');
    const username = str(body.username, 60).toLowerCase();
    const name = str(body.name, 100);
    const pw = String(body.password ?? '');
    if (!/^[a-z0-9._-]{3,}$/.test(username)) throw bad('Username minimal 3 karakter (huruf kecil, angka, . _ -)');
    if (!name) throw bad('Nama wajib diisi');
    if (pw.length < 8) throw bad('Password minimal 8 karakter');
    if (!ROLES.includes(body.role)) throw bad('Role tidak valid');
    const quota = body.annual_quota === undefined || body.annual_quota === '' ? 12 : Number(body.annual_quota);
    if (!Number.isInteger(quota) || quota < 0 || quota > 365) throw bad('Kuota cuti tidak valid');
    if (q('SELECT 1 FROM users WHERE username = ?').get(username)) throw bad('Username sudah dipakai');
    const r = q(`INSERT INTO users (username, password_hash, name, nik, position, department, role, annual_quota)
                 VALUES (?,?,?,?,?,?,?,?)`).run(username, hashPassword(pw), name, str(body.nik, 40), str(body.position, 80), str(body.department, 80), body.role, quota);
    return { status: 201, data: q(`SELECT ${PUBLIC_USER} FROM users WHERE id = ?`).get(Number(r.lastInsertRowid)) };
  });

  route('PUT', '/api/users/:id', ({ user, params, body }) => {
    if (user.role !== 'admin') throw new HttpError(403, 'Hanya admin');
    const id = Number(params.id);
    const cur = q('SELECT * FROM users WHERE id = ?').get(id);
    if (!cur) throw new HttpError(404, 'Staff tidak ditemukan');
    const name = body.name === undefined ? cur.name : str(body.name, 100);
    if (!name) throw bad('Nama wajib diisi');
    const role = body.role === undefined ? cur.role : body.role;
    if (!ROLES.includes(role)) throw bad('Role tidak valid');
    const active = body.active === undefined ? cur.active : (body.active ? 1 : 0);
    if (id === user.id && (role !== 'admin' || !active)) throw bad('Tidak dapat menurunkan role atau menonaktifkan akun sendiri');
    const quota = body.annual_quota === undefined ? cur.annual_quota : Number(body.annual_quota);
    if (!Number.isInteger(quota) || quota < 0 || quota > 365) throw bad('Kuota cuti tidak valid');
    let hash = cur.password_hash;
    if (body.password) {
      if (String(body.password).length < 8) throw bad('Password minimal 8 karakter');
      hash = hashPassword(String(body.password));
    }
    q(`UPDATE users SET name=?, nik=?, position=?, department=?, role=?, annual_quota=?, active=?, password_hash=? WHERE id=?`)
      .run(name, body.nik === undefined ? cur.nik : str(body.nik, 40), body.position === undefined ? cur.position : str(body.position, 80),
        body.department === undefined ? cur.department : str(body.department, 80), role, quota, active, hash, id);
    if (!active) q('DELETE FROM sessions WHERE user_id = ?').run(id);
    return { data: q(`SELECT ${PUBLIC_USER} FROM users WHERE id = ?`).get(id) };
  });

  route('GET', '/api/balance/:id', ({ user, params, query }) => {
    const id = Number(params.id);
    if (!canManage(user) && id !== user.id) throw new HttpError(403, 'Tidak diizinkan');
    return { data: balance(id, Number(query.get('year')) || new Date().getFullYear()) };
  });

  // --- Catatan ---
  function listRecords(user, query) {
    const where = [], args = [];
    if (!canManage(user)) { where.push('r.user_id = ?'); args.push(user.id); }
    else if (query.get('user_id')) { where.push('r.user_id = ?'); args.push(Number(query.get('user_id'))); }
    const type = query.get('type'); if (type) { where.push('r.type = ?'); args.push(type); }
    const status = query.get('status'); if (status) { where.push('r.status = ?'); args.push(status); }
    const from = query.get('from'); if (from && isDate(from)) { where.push('r.end_date >= ?'); args.push(from); }
    const to = query.get('to'); if (to && isDate(to)) { where.push('r.start_date <= ?'); args.push(to); }
    const s = str(query.get('q') || '', 100);
    if (s) { where.push("(u.name LIKE ? ESCAPE '\\' OR r.description LIKE ? ESCAPE '\\')"); const like = `%${s.replace(/[\\%_]/g, '\\$&')}%`; args.push(like, like); }
    const sql = `SELECT r.*, u.name AS user_name, u.nik AS user_nik, u.department AS user_department,
                        c.name AS created_by_name, d.name AS decided_by_name
                 FROM records r JOIN users u ON u.id = r.user_id
                 JOIN users c ON c.id = r.created_by LEFT JOIN users d ON d.id = r.decided_by
                 ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                 ORDER BY r.start_date DESC, r.id DESC LIMIT 1000`;
    return q(sql).all(...args);
  }

  route('GET', '/api/records', ({ user, query }) => ({ data: listRecords(user, query) }));

  route('POST', '/api/records', ({ user, body }) => {
    const rec = validateRecord(user, body);
    let status = 'pending', decidedBy = null, decidedAt = null;
    if (rec.type === 'pelanggaran') status = 'recorded';
    else if (canManage(user) && rec.user_id !== user.id && body.auto_approve) {
      status = 'approved'; decidedBy = user.id; decidedAt = new Date().toISOString();
    }
    checkQuota(rec);
    const r = q(`INSERT INTO records (type,user_id,start_date,end_date,time_out,time_in,days,category,description,sanction,points,has_doctor_note,status,created_by,decided_by,decided_at)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(rec.type, rec.user_id, rec.start_date, rec.end_date, rec.time_out, rec.time_in, rec.days, rec.category, rec.description,
        rec.sanction, rec.points, rec.has_doctor_note, status, user.id, decidedBy, decidedAt);
    return { status: 201, data: getRecordFor(user, Number(r.lastInsertRowid)) };
  });

  route('PUT', '/api/records/:id', ({ user, params, body }) => {
    const id = Number(params.id);
    const cur = getRecordFor(user, id);
    if (!canManage(user)) {
      if (cur.status !== 'pending' || cur.created_by !== user.id) throw new HttpError(403, 'Hanya pengajuan yang masih menunggu yang dapat diubah');
    } else if (user.role !== 'admin' && cur.type !== 'pelanggaran' && cur.status !== 'pending') {
      throw new HttpError(403, 'Hanya admin yang dapat mengubah pengajuan yang sudah diputuskan');
    }
    const rec = validateRecord(user, { ...body, type: cur.type, user_id: canManage(user) ? (body.user_id || cur.user_id) : cur.user_id }, id);
    if (cur.status === 'approved' || cur.status === 'pending') checkQuota(rec, id);
    q(`UPDATE records SET user_id=?,start_date=?,end_date=?,time_out=?,time_in=?,days=?,category=?,description=?,sanction=?,points=?,has_doctor_note=? WHERE id=?`)
      .run(rec.user_id, rec.start_date, rec.end_date, rec.time_out, rec.time_in, rec.days, rec.category, rec.description, rec.sanction, rec.points, rec.has_doctor_note, id);
    return { data: getRecordFor(user, id) };
  });

  route('POST', '/api/records/:id/decide', ({ user, params, body }) => {
    if (!canManage(user)) throw new HttpError(403, 'Hanya manager/admin yang dapat memutuskan pengajuan');
    const id = Number(params.id);
    const cur = getRecordFor(user, id);
    if (cur.type === 'pelanggaran') throw bad('Pelanggaran tidak memerlukan persetujuan');
    if (cur.status !== 'pending') throw bad('Pengajuan sudah diputuskan');
    if (cur.user_id === user.id) throw new HttpError(403, 'Tidak dapat menyetujui/menolak pengajuan sendiri');
    if (!['approved', 'rejected'].includes(body.status)) throw bad('Keputusan harus approved atau rejected');
    const note = str(body.note, 500);
    if (body.status === 'rejected' && !note) throw bad('Alasan penolakan wajib diisi');
    if (body.status === 'approved') checkQuota(cur, id);
    q(`UPDATE records SET status=?, decided_by=?, decided_at=?, decision_note=? WHERE id=?`)
      .run(body.status, user.id, new Date().toISOString(), note, id);
    return { data: getRecordFor(user, id) };
  });

  route('POST', '/api/records/:id/cancel', ({ user, params }) => {
    const cur = getRecordFor(user, Number(params.id));
    if (cur.created_by !== user.id && user.role !== 'admin') throw new HttpError(403, 'Tidak diizinkan');
    if (cur.status !== 'pending') throw bad('Hanya pengajuan yang masih menunggu yang dapat dibatalkan');
    q("UPDATE records SET status='cancelled' WHERE id=?").run(cur.id);
    return { data: getRecordFor(user, cur.id) };
  });

  route('DELETE', '/api/records/:id', ({ user, params }) => {
    if (user.role !== 'admin') throw new HttpError(403, 'Hanya admin yang dapat menghapus catatan');
    const r = q('DELETE FROM records WHERE id = ?').run(Number(params.id));
    if (!r.changes) throw new HttpError(404, 'Catatan tidak ditemukan');
    return { data: { ok: true } };
  });

  // --- Ringkasan ---
  route('GET', '/api/summary', ({ user, query }) => {
    const year = Number(query.get('year')) || new Date().getFullYear();
    const month = Number(query.get('month')) || 0; // 0 = setahun
    const prefix = month ? `${year}-${String(month).padStart(2, '0')}` : String(year);
    const scope = canManage(user) ? '' : 'AND r.user_id = ' + Number(user.id);
    const counts = q(`SELECT r.type, r.status, COUNT(*) AS n, COALESCE(SUM(r.days),0) AS days
                      FROM records r WHERE substr(r.start_date,1,${prefix.length}) = ? ${scope} GROUP BY r.type, r.status`).all(prefix);
    const perStaff = q(`SELECT u.id, u.name, u.department, u.annual_quota,
        COALESCE(SUM(CASE WHEN r.type='pelanggaran' THEN 1 END),0) AS violations,
        COALESCE(SUM(CASE WHEN r.type='pelanggaran' THEN r.points END),0) AS points,
        COALESCE(SUM(CASE WHEN r.type='sakit' AND r.status='approved' THEN r.days END),0) AS sick_days,
        COALESCE(SUM(CASE WHEN r.type='izin_keluar' AND r.status='approved' THEN 1 END),0) AS out_count,
        COALESCE(SUM(CASE WHEN r.type='cuti' AND r.status='approved' THEN r.days END),0) AS leave_days,
        COALESCE(SUM(CASE WHEN r.type='lainnya' AND r.status='approved' THEN 1 END),0) AS other_count
      FROM users u LEFT JOIN records r ON r.user_id = u.id AND substr(r.start_date,1,${prefix.length}) = ?
      WHERE u.active = 1 ${canManage(user) ? '' : 'AND u.id = ' + Number(user.id)}
      GROUP BY u.id ORDER BY points DESC, u.name`).all(prefix);
    const pending = canManage(user)
      ? q("SELECT COUNT(*) AS n FROM records WHERE status='pending' AND user_id != ?").get(user.id).n
      : q("SELECT COUNT(*) AS n FROM records WHERE status='pending' AND user_id = ?").get(user.id).n;
    const outNow = canManage(user)
      ? q(`SELECT r.id, u.name, r.type, r.category, r.start_date, r.end_date, r.time_out, r.time_in FROM records r JOIN users u ON u.id=r.user_id
           WHERE r.status='approved' AND r.type != 'pelanggaran' AND r.start_date <= ? AND r.end_date >= ? ORDER BY u.name`).all(today(), today())
      : [];
    return { data: { year, month, counts, perStaff, pending, outNow } };
  });

  route('GET', '/api/export.csv', ({ user, query }) => {
    const rows = listRecords(user, query);
    const head = ['ID', 'Jenis', 'Nama', 'NIK', 'Departemen', 'Mulai', 'Selesai', 'Jam Keluar', 'Jam Kembali', 'Hari', 'Kategori', 'Keterangan', 'Sanksi', 'Poin', 'Surat Dokter', 'Status', 'Dicatat Oleh', 'Diputuskan Oleh', 'Catatan Keputusan'];
    // Cegah CSV/formula injection di Excel/Sheets
    const cell = (v) => {
      let s = String(v ?? '');
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
      return `"${s.replace(/"/g, '""')}"`;
    };
    const lines = [head.map(cell).join(',')];
    for (const r of rows) {
      lines.push([r.id, r.type, r.user_name, r.user_nik, r.user_department, r.start_date, r.end_date, r.time_out, r.time_in, r.days, r.category,
        r.description, r.sanction, r.points, r.has_doctor_note ? 'ya' : '', r.status, r.created_by_name, r.decided_by_name, r.decision_note].map(cell).join(','));
    }
    return { raw: '﻿' + lines.join('\r\n'), contentType: 'text/csv; charset=utf-8', filename: `catatan-staff-${today()}.csv` };
  });

  // ----- HTTP -----
  const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
  const SEC = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; frame-ancestors 'none'",
  };

  function sessionUser(req) {
    const m = /(?:^|;\s*)sid=([a-f0-9]{64})/.exec(req.headers.cookie || '');
    if (!m) return {};
    const row = q(`SELECT s.token, s.expires_at, ${PUBLIC_USER.split(', ').map((c) => 'u.' + c).join(', ')} FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND u.active = 1`).get(m[1]);
    if (!row || row.expires_at < Date.now()) return {};
    const { token, expires_at, ...user } = row;
    return { user, token };
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0; const chunks = [];
      req.on('data', (c) => { size += c.length; if (size > 100_000) { reject(new HttpError(413, 'Permintaan terlalu besar')); req.destroy(); } else chunks.push(c); });
      req.on('end', () => {
        if (!chunks.length) return resolve({});
        try { const v = JSON.parse(Buffer.concat(chunks).toString('utf8')); resolve(v && typeof v === 'object' ? v : {}); }
        catch { reject(bad('JSON tidak valid')); }
      });
      req.on('error', reject);
    });
  }

  async function handleApi(req, res, url) {
    const r = routes.find((x) => x.method === req.method && x.re.test(url.pathname));
    if (!r) throw new HttpError(404, 'Endpoint tidak ditemukan');
    const m = r.re.exec(url.pathname);
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    const { user, token } = sessionUser(req);
    if (!r.public && !user) throw new HttpError(401, 'Silakan login');
    let body = {};
    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
      if (!/application\/json/.test(req.headers['content-type'] || '')) throw new HttpError(415, 'Content-Type harus application/json');
      body = await readBody(req);
    }
    const out = r.handler({ req, user, token, params, query: url.searchParams, body, ip: req.socket.remoteAddress });
    const headers = { ...SEC, 'Cache-Control': 'no-store' };
    if (out.cookie) headers['Set-Cookie'] = `sid=${out.cookie}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}${process.env.COOKIE_SECURE === '1' ? '; Secure' : ''}`;
    if (out.clearCookie) headers['Set-Cookie'] = 'sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0';
    if (out.raw !== undefined) {
      headers['Content-Type'] = out.contentType;
      headers['Content-Disposition'] = `attachment; filename="${out.filename}"`;
      res.writeHead(200, headers); return res.end(out.raw);
    }
    headers['Content-Type'] = 'application/json; charset=utf-8';
    res.writeHead(out.status || 200, headers);
    res.end(JSON.stringify(out.data));
  }

  function serveStatic(req, res, url) {
    let rel = url.pathname === '/' ? '/index.html' : url.pathname;
    const file = path.normalize(path.join(PUBLIC_DIR, rel));
    if (!file.startsWith(PUBLIC_DIR + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404, { ...SEC, 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Tidak ditemukan');
    }
    res.writeHead(200, { ...SEC, 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  }

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
      else if (req.method === 'GET') serveStatic(req, res, url);
      else throw new HttpError(405, 'Metode tidak diizinkan');
    } catch (e) {
      if (!(e instanceof HttpError)) console.error(e);
      if (res.headersSent) return res.end();
      const status = e instanceof HttpError ? e.status : 500;
      res.writeHead(status, { ...SEC, 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: e instanceof HttpError ? e.message : 'Terjadi kesalahan pada server' }));
    }
  });
}

export function seedAdmin(db) {
  if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0) return null;
  const pw = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
  db.prepare("INSERT INTO users (username, password_hash, name, role, position) VALUES ('admin', ?, 'Administrator', 'admin', 'HRD')").run(hashPassword(pw));
  return { username: 'admin', password: pw, generated: !process.env.ADMIN_PASSWORD };
}

// ---------- Main ----------
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const db = openDb(process.env.DB_FILE || path.join(__dirname, 'data', 'staff.db'));
  const seeded = seedAdmin(db);
  if (seeded) {
    console.log('==============================================');
    console.log(' Akun admin pertama dibuat:');
    console.log(`   username: ${seeded.username}`);
    console.log(`   password: ${seeded.password}${seeded.generated ? '   (acak — segera ganti di menu Akun)' : ''}`);
    console.log('==============================================');
  }
  const port = Number(process.env.PORT) || 3000;
  createApp(db).listen(port, process.env.HOST || '0.0.0.0', () => console.log(`Aplikasi Staff berjalan di http://localhost:${port}`));
}
